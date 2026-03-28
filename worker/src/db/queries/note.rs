//! Database queries for the unified notes system.

use anyhow::{bail, Result};
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::note::MAX_CONTENT_CHARS;
use crate::types::{Note, NoteHistoryEntry};

// ============================================================
// Ownership / polymorphic entity validation
// ============================================================

/// Check that the entity identified by (entity_type, entity_id) belongs to the given user.
/// Returns `Ok(true)` if it does, `Ok(false)` if the entity doesn't exist or belongs to another user.
pub async fn entity_belongs_to_user(
    pool: &PgPool,
    entity_type: &str,
    entity_id: Uuid,
    user_id: Uuid,
) -> Result<bool> {
    let exists: bool = match entity_type {
        "customer" => {
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM customers WHERE id = $1 AND user_id = $2)",
            )
            .bind(entity_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?
        }
        "device" => {
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM devices WHERE id = $1 AND user_id = $2)",
            )
            .bind(entity_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?
        }
        "visit" => {
            sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM visits WHERE id = $1 AND user_id = $2)",
            )
            .bind(entity_id)
            .bind(user_id)
            .fetch_one(pool)
            .await?
        }
        _ => return Ok(false),
    };
    Ok(exists)
}

// ============================================================
// note.create
// ============================================================

/// Create a new note entry. Returns the created note.
pub async fn create_note(
    pool: &PgPool,
    user_id: Uuid,
    entity_type: &str,
    entity_id: Uuid,
    visit_id: Option<Uuid>,
    content: &str,
) -> Result<Note> {
    if content.chars().count() > MAX_CONTENT_CHARS {
        bail!("NOTE_CONTENT_TOO_LONG");
    }
    let note = sqlx::query_as::<_, Note>(
        r#"
        INSERT INTO notes (id, user_id, entity_type, entity_id, visit_id, content, created_at, updated_at)
        VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, NOW(), NOW())
        RETURNING id, user_id, entity_type, entity_id, visit_id, content, created_at, updated_at, deleted_at
        "#,
    )
    .bind(user_id)
    .bind(entity_type)
    .bind(entity_id)
    .bind(visit_id)
    .bind(content)
    .fetch_one(pool)
    .await?;
    Ok(note)
}

// ============================================================
// note.update
// ============================================================

/// Update note content and upsert a session-level audit row.
/// Returns None if the note doesn't exist or belongs to another user.
pub async fn update_note(
    pool: &PgPool,
    note_id: Uuid,
    user_id: Uuid,
    session_id: Uuid,
    content: &str,
) -> Result<Option<Note>> {
    if content.chars().count() > MAX_CONTENT_CHARS {
        bail!("NOTE_CONTENT_TOO_LONG");
    }

    let mut tx = pool.begin().await?;

    // Atomic UPDATE + RETURNING — skips the note if concurrently deleted.
    let note = sqlx::query_as::<_, Note>(
        r#"
        UPDATE notes SET content = $3, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
        RETURNING id, user_id, entity_type, entity_id, visit_id, content, created_at, updated_at, deleted_at
        "#,
    )
    .bind(note_id)
    .bind(user_id)
    .bind(content)
    .fetch_optional(&mut *tx)
    .await?;

    // Only upsert audit when the update actually affected a row.
    if note.is_some() {
        sqlx::query(
            r#"
            INSERT INTO notes_history
                (id, note_id, session_id, edited_by_user_id, content, first_edited_at, last_edited_at, change_count)
            VALUES
                (uuid_generate_v4(), $1, $2, $3, $4, NOW(), NOW(), 1)
            ON CONFLICT (note_id, session_id) DO UPDATE SET
                content           = EXCLUDED.content,
                last_edited_at    = NOW(),
                edited_by_user_id = EXCLUDED.edited_by_user_id,
                change_count      = notes_history.change_count + 1
            "#,
        )
        .bind(note_id)
        .bind(session_id)
        .bind(user_id)
        .bind(content)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(note)
}

// ============================================================
// note.list
// ============================================================

/// List all active (non-deleted) notes for an entity, ordered by created_at ASC.
pub async fn list_notes(
    pool: &PgPool,
    entity_type: &str,
    entity_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<Note>> {
    let notes = sqlx::query_as::<_, Note>(
        r#"
        SELECT id, user_id, entity_type, entity_id, visit_id, content, created_at, updated_at, deleted_at
        FROM notes
        WHERE entity_type = $1
          AND entity_id   = $2
          AND user_id     = $3
          AND deleted_at  IS NULL
        ORDER BY created_at ASC
        "#,
    )
    .bind(entity_type)
    .bind(entity_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(notes)
}

// ============================================================
// note.audit
// ============================================================

/// Fetch session-level audit trail for a specific note.
/// Returns empty vec if the note doesn't exist or belongs to another user.
pub async fn list_note_audit(
    pool: &PgPool,
    note_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<NoteHistoryEntry>> {
    // Verify the note belongs to this user first
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM notes WHERE id = $1 AND user_id = $2)",
    )
    .bind(note_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if !exists {
        return Ok(vec![]);
    }

    let entries = sqlx::query_as::<_, NoteHistoryEntry>(
        r#"
        SELECT id, note_id, session_id, edited_by_user_id, content, first_edited_at, last_edited_at, change_count
        FROM notes_history
        WHERE note_id = $1
        ORDER BY last_edited_at DESC
        "#,
    )
    .bind(note_id)
    .fetch_all(pool)
    .await?;
    Ok(entries)
}

// ============================================================
// note.delete (soft)
// ============================================================

/// Soft-delete a note by setting deleted_at = NOW().
/// Idempotent — second call on an already-deleted note is a no-op returning true.
/// Returns false if the note doesn't exist or belongs to another user.
pub async fn delete_note(
    pool: &PgPool,
    note_id: Uuid,
    user_id: Uuid,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE notes SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(note_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

// ============================================================
// GDPR redaction
// ============================================================

#[allow(dead_code)]
/// Redact all note content for a user (GDPR delete workflow).
/// Sets notes.content and notes_history.content to '[GDPR-REDACTED]'.
/// Structural metadata (timestamps, ids, change_count) is preserved.
pub async fn redact_notes_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        UPDATE notes_history
        SET content = '[GDPR-REDACTED]'
        WHERE note_id IN (SELECT id FROM notes WHERE user_id = $1)
        "#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        UPDATE notes SET content = '[GDPR-REDACTED]', updated_at = NOW()
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

// ============================================================
// Export — all non-deleted notes for a user
// ============================================================

/// Return all non-deleted notes owned by `user_id`, ordered by entity_type, entity_id, created_at.
/// Used by the export processor to build notes.csv.
pub async fn list_all_notes_for_user(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Note>> {
    let notes = sqlx::query_as::<_, Note>(
        r#"
        SELECT id, user_id, entity_type, entity_id, visit_id, content, created_at, updated_at, deleted_at
        FROM notes
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY entity_type, entity_id, created_at ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(notes)
}

// ============================================================
// Compact projection (latest note content for a given entity)
// ============================================================

#[allow(dead_code)]
/// Returns the latest note content (created_at DESC) for an entity, or None if no notes exist.
pub async fn latest_note_content(
    pool: &PgPool,
    entity_type: &str,
    entity_id: Uuid,
    user_id: Uuid,
) -> Result<Option<String>> {
    let content: Option<String> = sqlx::query_scalar(
        r#"
        SELECT content FROM notes
        WHERE entity_type = $1 AND entity_id = $2 AND user_id = $3 AND deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        "#,
    )
    .bind(entity_type)
    .bind(entity_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .flatten();
    Ok(content)
}
