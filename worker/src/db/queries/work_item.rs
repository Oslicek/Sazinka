#![allow(dead_code)]
//! Visit work item database queries

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::work_item::{VisitWorkItem, CreateWorkItemRequest, WorkResult};

/// Create a new work item (user_id reserved for future ownership verification of the visit)
pub async fn create_work_item(
    pool: &PgPool,
    _user_id: Uuid,
    req: &CreateWorkItemRequest,
) -> Result<VisitWorkItem> {
    let item = sqlx::query_as::<_, VisitWorkItem>(
        r#"
        INSERT INTO visit_work_items (
            id, visit_id, device_id, revision_id, crew_id,
            work_type, duration_minutes, result,
            result_notes, findings,
            requires_follow_up, follow_up_reason,
            created_at
        )
        VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9, $10,
            $11, $12,
            NOW()
        )
        RETURNING *
        "#
    )
    .bind(Uuid::new_v4())
    .bind(req.visit_id)
    .bind(req.device_id)
    .bind(req.revision_id)
    .bind(req.crew_id)
    .bind(req.work_type)
    .bind(req.duration_minutes)
    .bind(req.result)
    .bind(&req.result_notes)
    .bind(&req.findings)
    .bind(req.requires_follow_up.unwrap_or(false))
    .bind(&req.follow_up_reason)
    .fetch_one(pool)
    .await?;

    Ok(item)
}

/// List work items for a visit (with user ownership verification via visit→revision→user)
pub async fn list_work_items_for_visit(
    pool: &PgPool,
    user_id: Uuid,
    visit_id: Uuid,
) -> Result<Vec<VisitWorkItem>> {
    let items = sqlx::query_as::<_, VisitWorkItem>(
        r#"
        SELECT wi.* FROM visit_work_items wi
        JOIN visits v ON wi.visit_id = v.id
        JOIN revisions r ON v.revision_id = r.id
        WHERE wi.visit_id = $1 AND r.user_id = $2
        ORDER BY wi.created_at ASC
        "#
    )
    .bind(visit_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(items)
}

/// List work items for a revision (with user ownership verification)
pub async fn list_work_items_for_revision(
    pool: &PgPool,
    user_id: Uuid,
    revision_id: Uuid,
) -> Result<Vec<VisitWorkItem>> {
    let items = sqlx::query_as::<_, VisitWorkItem>(
        r#"
        SELECT wi.* FROM visit_work_items wi
        JOIN revisions r ON wi.revision_id = r.id
        WHERE wi.revision_id = $1 AND r.user_id = $2
        ORDER BY wi.created_at ASC
        "#
    )
    .bind(revision_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(items)
}

/// Complete a work item with result (with user ownership verification)
pub async fn complete_work_item(
    pool: &PgPool,
    user_id: Uuid,
    work_item_id: Uuid,
    result: WorkResult,
    duration_minutes: Option<i32>,
    result_notes: Option<&str>,
    findings: Option<&str>,
    requires_follow_up: bool,
    follow_up_reason: Option<&str>,
) -> Result<Option<VisitWorkItem>> {
    let item = sqlx::query_as::<_, VisitWorkItem>(
        r#"
        UPDATE visit_work_items SET
            result = $2,
            duration_minutes = COALESCE($3, duration_minutes),
            result_notes = COALESCE($4, result_notes),
            findings = COALESCE($5, findings),
            requires_follow_up = $6,
            follow_up_reason = COALESCE($7, follow_up_reason)
        WHERE id = $1
          AND id IN (
            SELECT wi.id FROM visit_work_items wi
            LEFT JOIN visits v ON wi.visit_id = v.id
            LEFT JOIN revisions r ON COALESCE(v.revision_id, wi.revision_id) = r.id
            WHERE wi.id = $1 AND r.user_id = $8
          )
        RETURNING *
        "#
    )
    .bind(work_item_id)
    .bind(result)
    .bind(duration_minutes)
    .bind(result_notes)
    .bind(findings)
    .bind(requires_follow_up)
    .bind(follow_up_reason)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(item)
}

/// Get a work item by ID (with user ownership verification)
pub async fn get_work_item(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<Option<VisitWorkItem>> {
    let item = sqlx::query_as::<_, VisitWorkItem>(
        r#"
        SELECT wi.* FROM visit_work_items wi
        LEFT JOIN visits v ON wi.visit_id = v.id
        LEFT JOIN revisions r ON COALESCE(v.revision_id, wi.revision_id) = r.id
        WHERE wi.id = $1 AND r.user_id = $2
        "#
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(item)
}

/// Fulfill a revision from a work item (denormalize result)
pub async fn fulfill_revision(
    pool: &PgPool,
    revision_id: Uuid,
    work_item_id: Uuid,
    result: &str,
    findings: Option<&str>,
    duration_minutes: Option<i32>,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE revisions SET
            status = 'completed',
            result = $3::revision_result,
            findings = $4,
            duration_minutes = $5,
            completed_at = NOW(),
            fulfilled_by_work_item_id = $2
        WHERE id = $1
        "#
    )
    .bind(revision_id)
    .bind(work_item_id)
    .bind(result)
    .bind(findings)
    .bind(duration_minutes)
    .execute(pool)
    .await?;

    Ok(())
}
