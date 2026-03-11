#![allow(dead_code)]
//! Planned action database queries

use anyhow::Result;
use chrono::{NaiveDate, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::planned_action::{
    CreatePlannedActionRequest, ListPlannedActionsRequest, PlannedAction,
    PlannedActionListResponse, UpdatePlannedActionRequest,
};
use crate::types::inbox::{InboxItem, InboxRequest, InboxResponse};

// Column list for SELECT / RETURNING (excludes computed lifecycle columns)
const PLANNED_ACTION_COLS: &str = r#"
    id, user_id, customer_id, status,
    due_date, snooze_until, snooze_reason,
    action_target_id,
    revision_id, visit_id, device_id,
    note, completed_at, created_at, updated_at
"#;

// ============================================================================
// CRUD
// ============================================================================

/// Create a new planned action
pub async fn create_planned_action(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreatePlannedActionRequest,
) -> Result<PlannedAction> {
    let action = sqlx::query_as::<_, PlannedAction>(&format!(
        r#"
        INSERT INTO planned_actions (
            id, user_id, customer_id, status,
            due_date, snooze_until, snooze_reason,
            action_target_id,
            revision_id, visit_id, device_id,
            note, created_at, updated_at
        )
        VALUES (
            $1, $2, $3, 'open'::action_status,
            $4, $5, $6,
            $7,
            $8, $9, $10,
            $11, NOW(), NOW()
        )
        RETURNING {}
        "#,
        PLANNED_ACTION_COLS
    ))
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(req.customer_id)
    .bind(req.due_date)
    .bind(req.snooze_until)
    .bind(&req.snooze_reason)
    .bind(req.action_target_id)
    .bind(req.revision_id)
    .bind(req.visit_id)
    .bind(req.device_id)
    .bind(&req.note)
    .fetch_one(pool)
    .await?;

    Ok(action)
}

/// Get a single planned action by ID (scoped to user)
pub async fn get_planned_action(
    pool: &PgPool,
    user_id: Uuid,
    action_id: Uuid,
) -> Result<Option<PlannedAction>> {
    let action = sqlx::query_as::<_, PlannedAction>(&format!(
        "SELECT {} FROM planned_actions WHERE id = $1 AND user_id = $2",
        PLANNED_ACTION_COLS
    ))
    .bind(action_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(action)
}

/// List planned actions, optionally filtered by customer and/or status
pub async fn list_planned_actions(
    pool: &PgPool,
    user_id: Uuid,
    req: &ListPlannedActionsRequest,
) -> Result<PlannedActionListResponse> {
    let limit = req.limit.unwrap_or(50) as i64;
    let offset = req.offset.unwrap_or(0) as i64;

    let mut conditions = vec!["user_id = $1".to_string()];
    let mut param_idx: usize = 1;

    if req.customer_id.is_some() {
        param_idx += 1;
        conditions.push(format!("customer_id = ${}", param_idx));
    }
    if req.status.is_some() {
        param_idx += 1;
        conditions.push(format!("status = ${}::action_status", param_idx));
    }

    let where_clause = conditions.join(" AND ");
    let query = format!(
        "SELECT {} FROM planned_actions WHERE {} ORDER BY due_date ASC LIMIT ${} OFFSET ${}",
        PLANNED_ACTION_COLS,
        where_clause,
        param_idx + 1,
        param_idx + 2,
    );

    let mut qb = sqlx::query_as::<_, PlannedAction>(&query).bind(user_id);
    if let Some(cid) = req.customer_id {
        qb = qb.bind(cid);
    }
    if let Some(status) = req.status {
        qb = qb.bind(status.as_str());
    }
    let items = qb.bind(limit).bind(offset).fetch_all(pool).await?;

    let count_query = format!(
        "SELECT COUNT(*) FROM planned_actions WHERE {}",
        where_clause
    );
    let mut count_qb = sqlx::query_as::<_, (i64,)>(&count_query).bind(user_id);
    if let Some(cid) = req.customer_id {
        count_qb = count_qb.bind(cid);
    }
    if let Some(status) = req.status {
        count_qb = count_qb.bind(status.as_str());
    }
    let (total,) = count_qb.fetch_one(pool).await?;

    Ok(PlannedActionListResponse { items, total })
}

/// Update a planned action (status, due_date, note, snooze)
pub async fn update_planned_action(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdatePlannedActionRequest,
) -> Result<Option<PlannedAction>> {
    // Build SET clause dynamically
    let mut sets = vec!["updated_at = NOW()".to_string()];
    let mut param_idx: usize = 2; // $1 = id, $2 starts dynamic params

    if req.status.is_some() {
        param_idx += 1;
        sets.push(format!("status = ${}::action_status", param_idx));
        // Auto-set completed_at when transitioning to completed
        sets.push(format!(
            "completed_at = CASE WHEN ${}::action_status = 'completed' THEN NOW() ELSE NULL END",
            param_idx
        ));
    }
    if req.due_date.is_some() {
        param_idx += 1;
        sets.push(format!("due_date = ${}", param_idx));
    }
    if req.note.is_some() {
        param_idx += 1;
        sets.push(format!("note = ${}", param_idx));
    }
    if req.snooze_until.is_some() {
        param_idx += 1;
        sets.push(format!("snooze_until = ${}", param_idx));
    }
    if req.snooze_reason.is_some() {
        param_idx += 1;
        sets.push(format!("snooze_reason = ${}", param_idx));
    }

    let query = format!(
        "UPDATE planned_actions SET {} WHERE id = $1 AND user_id = $2 RETURNING {}",
        sets.join(", "),
        PLANNED_ACTION_COLS
    );

    let mut qb = sqlx::query_as::<_, PlannedAction>(&query)
        .bind(req.id)
        .bind(user_id);

    if let Some(status) = req.status {
        qb = qb.bind(status.as_str());
    }
    if let Some(due_date) = req.due_date {
        qb = qb.bind(due_date);
    }
    if let Some(ref note) = req.note {
        qb = qb.bind(note);
    }
    if let Some(snooze_until) = req.snooze_until {
        qb = qb.bind(snooze_until);
    }
    if let Some(ref snooze_reason) = req.snooze_reason {
        qb = qb.bind(snooze_reason);
    }

    let action = qb.fetch_optional(pool).await?;
    Ok(action)
}

/// Cancel a planned action (sets status = cancelled)
pub async fn cancel_planned_action(
    pool: &PgPool,
    user_id: Uuid,
    action_id: Uuid,
) -> Result<Option<PlannedAction>> {
    let action = sqlx::query_as::<_, PlannedAction>(&format!(
        r#"
        UPDATE planned_actions
        SET status = 'cancelled'::action_status, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING {}
        "#,
        PLANNED_ACTION_COLS
    ))
    .bind(action_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(action)
}

/// Complete a planned action (sets status = completed, completed_at = now)
pub async fn complete_planned_action(
    pool: &PgPool,
    user_id: Uuid,
    action_id: Uuid,
) -> Result<Option<PlannedAction>> {
    let action = sqlx::query_as::<_, PlannedAction>(&format!(
        r#"
        UPDATE planned_actions
        SET status = 'completed'::action_status,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING {}
        "#,
        PLANNED_ACTION_COLS
    ))
    .bind(action_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(action)
}

/// Snooze a planned action until a given date
pub async fn snooze_planned_action(
    pool: &PgPool,
    user_id: Uuid,
    action_id: Uuid,
    snooze_until: NaiveDate,
    snooze_reason: Option<&str>,
) -> Result<Option<PlannedAction>> {
    let action = sqlx::query_as::<_, PlannedAction>(&format!(
        r#"
        UPDATE planned_actions
        SET status = 'snoozed'::action_status,
            snooze_until = $3,
            snooze_reason = $4,
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING {}
        "#,
        PLANNED_ACTION_COLS
    ))
    .bind(action_id)
    .bind(user_id)
    .bind(snooze_until)
    .bind(snooze_reason)
    .fetch_optional(pool)
    .await?;

    Ok(action)
}

// ============================================================================
// CUSTOMER INBOX QUERY (Phase 2 — no scoring)
// ============================================================================

/// Build the SQL WHERE clause parts for the inbox query
struct InboxSqlParts {
    where_clause: String,
    area_pattern: Option<String>,
}

fn build_inbox_sql_parts(req: &InboxRequest) -> InboxSqlParts {
    let mut conditions = vec![
        "c.user_id = $1".to_string(),
        "c.is_anonymized = FALSE".to_string(),
        "c.is_abandoned = FALSE".to_string(),
    ];
    let mut param_idx: usize = 3; // $1=user_id, $2=limit, $3=offset start after base params

    let area_pattern = req.area_filter.as_ref().map(|a| format!("{}%", a));
    if area_pattern.is_some() {
        param_idx += 1;
        conditions.push(format!("c.postal_code LIKE ${}", param_idx));
    }

    if req.geocoded_only.unwrap_or(false) {
        conditions.push("c.geocode_status::text = 'success'".to_string());
    }

    InboxSqlParts {
        where_clause: conditions.join(" AND "),
        area_pattern,
    }
}

/// Customer-centric inbox query (Phase 2 — rank-first ordering, no urgency scoring)
pub async fn get_customer_inbox(
    pool: &PgPool,
    user_id: Uuid,
    req: InboxRequest,
) -> Result<InboxResponse> {
    let limit = req.limit.unwrap_or(25) as i64;
    let offset = req.offset.unwrap_or(0) as i64;
    let sql_parts = build_inbox_sql_parts(&req);

    let query = format!(
        r#"
        WITH queue AS (
            SELECT
                c.id, c.name, c.phone, c.city, c.postal_code,
                c.lat, c.lng, c.geocode_status::text AS geocode_status,
                c.created_at AS customer_created_at,
                -- Lifecycle state
                CASE
                    WHEN NOT EXISTS (SELECT 1 FROM communications cm WHERE cm.customer_id = c.id)
                         AND NOT EXISTS (SELECT 1 FROM planned_actions p0 WHERE p0.customer_id = c.id)
                        THEN 'untouched'
                    WHEN pa.id IS NOT NULL
                        THEN 'active'
                    ELSE 'needs_action'
                END AS lifecycle_state,
                -- Rank for ordering
                CASE
                    WHEN NOT EXISTS (SELECT 1 FROM communications cm WHERE cm.customer_id = c.id)
                         AND NOT EXISTS (SELECT 1 FROM planned_actions p0 WHERE p0.customer_id = c.id)
                        THEN 0
                    WHEN pa.id IS NOT NULL AND pa.due_date < CURRENT_DATE
                        THEN 1
                    WHEN pa.id IS NOT NULL
                        THEN 2
                    ELSE 3
                END AS lifecycle_rank,
                -- Next action details (NULL for untouched/needs_action)
                NULL::text AS next_action_kind,
                NULL::text AS next_action_label_key,
                NULL::text AS next_action_label_fallback,
                pa.due_date AS next_action_due,
                pa.note     AS next_action_note,
                -- Legacy device info (Phase 2-4)
                r.device_id,
                d.device_name,
                d.device_type::text AS device_type,
                -- Contact history
                (SELECT COUNT(*) FROM communications cm WHERE cm.customer_id = c.id)::bigint AS total_communications,
                (SELECT MAX(created_at) FROM communications cm WHERE cm.customer_id = c.id) AS last_contact_at,
                -- Urgency score placeholder (Phase 4)
                0.0::float8 AS urgency_score
            FROM customers c
            LEFT JOIN LATERAL (
                SELECT * FROM planned_actions pa
                WHERE pa.customer_id = c.id
                  AND pa.status IN ('open', 'snoozed')
                  AND (pa.snooze_until IS NULL OR pa.snooze_until <= CURRENT_DATE)
                ORDER BY pa.due_date ASC
                LIMIT 1
            ) pa ON TRUE
            LEFT JOIN revisions r ON pa.revision_id = r.id
            LEFT JOIN devices d ON r.device_id = d.id
            WHERE {}
        )
        SELECT *
        FROM queue
        ORDER BY
            lifecycle_rank ASC,
            CASE WHEN lifecycle_rank = 1 THEN next_action_due END ASC,
            CASE WHEN lifecycle_rank = 2 THEN next_action_due END ASC,
            CASE WHEN lifecycle_rank = 3 THEN COALESCE(last_contact_at, customer_created_at) END ASC,
            customer_created_at ASC
        LIMIT $2 OFFSET $3
        "#,
        sql_parts.where_clause
    );

    let mut qb = sqlx::query_as::<_, InboxItem>(&query)
        .bind(user_id)
        .bind(limit)
        .bind(offset);

    if let Some(ref pattern) = sql_parts.area_pattern {
        qb = qb.bind(pattern);
    }

    let items = qb.fetch_all(pool).await?;

    // Total count
    let count_query = format!(
        "SELECT COUNT(*) FROM customers c WHERE {}",
        sql_parts.where_clause
    );
    let mut count_qb = sqlx::query_as::<_, (i64,)>(&count_query).bind(user_id);
    if let Some(ref pattern) = sql_parts.area_pattern {
        count_qb = count_qb.bind(pattern);
    }
    let (total,) = count_qb.fetch_one(pool).await?;

    // Overdue count
    let (overdue_count,): (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(DISTINCT c.id)
        FROM customers c
        INNER JOIN planned_actions pa ON pa.customer_id = c.id
        WHERE c.user_id = $1
          AND c.is_anonymized = FALSE
          AND c.is_abandoned = FALSE
          AND pa.status IN ('open', 'snoozed')
          AND (pa.snooze_until IS NULL OR pa.snooze_until <= CURRENT_DATE)
          AND pa.due_date < CURRENT_DATE
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    // Due soon count (within 7 days)
    let (due_soon_count,): (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(DISTINCT c.id)
        FROM customers c
        INNER JOIN planned_actions pa ON pa.customer_id = c.id
        WHERE c.user_id = $1
          AND c.is_anonymized = FALSE
          AND c.is_abandoned = FALSE
          AND pa.status IN ('open', 'snoozed')
          AND (pa.snooze_until IS NULL OR pa.snooze_until <= CURRENT_DATE)
          AND pa.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(InboxResponse {
        items,
        total,
        overdue_count,
        due_soon_count,
    })
}

// ============================================================================
// PHASE 5: DUAL-WRITE HELPERS
// ============================================================================

/// Upsert a snoozed planned_action for a revision (Phase 5 dual-write).
/// If an open/snoozed planned_action already exists for this revision, update it.
/// Otherwise create a new one with status = 'snoozed'.
pub async fn upsert_snooze_for_revision(
    pool: &PgPool,
    user_id: Uuid,
    revision_id: Uuid,
    req: &CreatePlannedActionRequest,
) -> Result<PlannedAction> {
    let action = sqlx::query_as::<_, PlannedAction>(&format!(
        r#"
        INSERT INTO planned_actions (
            id, user_id, customer_id, status,
            due_date, snooze_until, snooze_reason,
            action_target_id, revision_id, visit_id, device_id,
            note, created_at, updated_at
        )
        VALUES (
            $1, $2, $3, 'snoozed'::action_status,
            $4, $5, $6,
            NULL, $7, NULL, $8,
            $9, NOW(), NOW()
        )
        ON CONFLICT DO NOTHING
        RETURNING {}
        "#,
        PLANNED_ACTION_COLS
    ))
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(req.customer_id)
    .bind(req.due_date)
    .bind(req.snooze_until)
    .bind(&req.snooze_reason)
    .bind(revision_id)
    .bind(req.device_id)
    .bind(&req.note)
    .fetch_optional(pool)
    .await?;

    // If the INSERT was a no-op (conflict), update the existing open/snoozed action
    if let Some(a) = action {
        return Ok(a);
    }

    let updated = sqlx::query_as::<_, PlannedAction>(&format!(
        r#"
        UPDATE planned_actions
        SET status = 'snoozed'::action_status,
            due_date = $1,
            snooze_until = $2,
            snooze_reason = $3,
            note = COALESCE($4, note),
            updated_at = NOW()
        WHERE revision_id = $5 AND user_id = $6
          AND status IN ('open', 'snoozed')
        RETURNING {}
        "#,
        PLANNED_ACTION_COLS
    ))
    .bind(req.due_date)
    .bind(req.snooze_until)
    .bind(&req.snooze_reason)
    .bind(&req.note)
    .bind(revision_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(updated)
}

/// Auto-create a planned_action for a communication follow-up (Phase 5 dual-write).
/// Only creates if no open/snoozed planned_action already exists for this customer on that date.
pub async fn create_followup_action_for_communication(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    follow_up_date: NaiveDate,
    note: Option<String>,
) -> Result<Option<PlannedAction>> {
    let action = sqlx::query_as::<_, PlannedAction>(&format!(
        r#"
        INSERT INTO planned_actions (
            id, user_id, customer_id, status,
            due_date, snooze_until, snooze_reason,
            action_target_id, revision_id, visit_id, device_id,
            note, created_at, updated_at
        )
        SELECT $1, $2, $3, 'open'::action_status,
               $4, NULL, NULL,
               NULL, NULL, NULL, NULL,
               $5, NOW(), NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM planned_actions
            WHERE customer_id = $3
              AND user_id = $2
              AND due_date = $4
              AND status IN ('open', 'snoozed')
              AND revision_id IS NULL
              AND visit_id IS NULL
        )
        RETURNING {}
        "#,
        PLANNED_ACTION_COLS
    ))
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(customer_id)
    .bind(follow_up_date)
    .bind(&note)
    .fetch_optional(pool)
    .await?;

    Ok(action)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::inbox::InboxRequest;

    #[test]
    fn inbox_sql_default_excludes_abandoned_and_anonymized() {
        let req = InboxRequest::default();
        let parts = build_inbox_sql_parts(&req);
        assert!(parts.where_clause.contains("c.is_anonymized = FALSE"));
        assert!(parts.where_clause.contains("c.is_abandoned = FALSE"));
        assert!(parts.where_clause.contains("c.user_id = $1"));
    }

    #[test]
    fn inbox_sql_no_revision_filters() {
        let req = InboxRequest::default();
        let parts = build_inbox_sql_parts(&req);
        // Must NOT contain revision-specific filters from the old call queue
        assert!(!parts.where_clause.contains("r.status"));
        assert!(!parts.where_clause.contains("r.due_date BETWEEN"));
        assert!(!parts.where_clause.contains("snooze_until"));
    }

    #[test]
    fn inbox_sql_area_filter_parameterized() {
        let req = InboxRequest {
            area_filter: Some("120".to_string()),
            ..Default::default()
        };
        let parts = build_inbox_sql_parts(&req);
        assert!(parts.where_clause.contains("c.postal_code LIKE $4"));
        assert_eq!(parts.area_pattern.as_deref(), Some("120%"));
    }

    #[test]
    fn inbox_sql_geocoded_only_filter() {
        let req = InboxRequest {
            geocoded_only: Some(true),
            ..Default::default()
        };
        let parts = build_inbox_sql_parts(&req);
        assert!(parts.where_clause.contains("c.geocode_status::text = 'success'"));
    }

    #[test]
    fn inbox_sql_area_and_geocoded_combined() {
        let req = InboxRequest {
            area_filter: Some("150".to_string()),
            geocoded_only: Some(true),
            ..Default::default()
        };
        let parts = build_inbox_sql_parts(&req);
        assert!(parts.where_clause.contains("c.postal_code LIKE $4"));
        assert!(parts.where_clause.contains("c.geocode_status::text = 'success'"));
    }
}
