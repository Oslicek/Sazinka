#![allow(dead_code)]
//! Planned action database queries

use anyhow::Result;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::planned_action::{
    CreatePlannedActionRequest, ListPlannedActionsRequest, PlannedAction,
    PlannedActionListResponse, UpdatePlannedActionRequest,
};
use crate::types::inbox::{InboxItem, InboxRequest, InboxResponse};
use crate::types::scoring::CustomerScoringInput;
use crate::services::scoring as scoring_service;
use crate::db::queries::scoring as scoring_queries;

// Column list for SELECT / RETURNING (excludes computed lifecycle columns)
const PLANNED_ACTION_COLS: &str = r#"
    id, user_id, customer_id, status,
    due_date, snooze_until, snooze_reason,
    action_target_id,
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
            note, created_at, updated_at
        )
        VALUES (
            $1, $2, $3, 'open'::action_status,
            $4, $5, $6,
            $7,
            $8, NOW(), NOW()
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

/// Customer-centric inbox query (Phase 4B — unified score-based sorting)
///
/// Sorting is always by `urgency_score DESC, customer_created_at ASC`.
/// If no rule set is requested, the user's default (`is_default = TRUE`) is used automatically.
pub async fn get_customer_inbox(
    pool: &PgPool,
    user_id: Uuid,
    req: InboxRequest,
) -> Result<InboxResponse> {
    let limit = req.limit.unwrap_or(25) as i64;
    let offset = req.offset.unwrap_or(0) as i64;
    let sql_parts = build_inbox_sql_parts(&req);

    // Resolve rule set: explicit request → user default → no factors (score = 0)
    let resolved_rule_set_id = if let Some(id) = req.selected_rule_set_id {
        Some(id)
    } else {
        sqlx::query_as::<_, (Uuid,)>(
            "SELECT id FROM scoring_rule_sets WHERE user_id = $1 AND is_default = TRUE AND is_archived = FALSE LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .map(|(id,)| id)
    };

    // Load scoring factors for the resolved rule set
    let factors = if let Some(rule_set_id) = resolved_rule_set_id {
        scoring_queries::get_factors(pool, rule_set_id).await.unwrap_or_default()
    } else {
        vec![]
    };

    // Fetch all matching customers (without LIMIT/OFFSET) for scoring, then sort+page in Rust
    // This is the "compute-on-query" strategy: load all, score in Rust, sort, then slice.
    let query = format!(
        r#"
        SELECT
            c.id, c.name, c.phone, c.email, c.street, c.city, c.postal_code,
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
            -- Next action details
            NULL::text AS next_action_kind,
            NULL::text AS next_action_label_key,
            NULL::text AS next_action_label_fallback,
            pa.due_date AS next_action_due,
            pa.note     AS next_action_note,
            -- Device info (via action_targets → tasks → devices)
            tk.device_id,
            d.device_name,
            d.device_type::text AS device_type,
            -- Contact history
            (SELECT COUNT(*) FROM communications cm WHERE cm.customer_id = c.id)::bigint AS total_communications,
            (SELECT MAX(created_at) FROM communications cm WHERE cm.customer_id = c.id) AS last_contact_at,
            -- Revision scheduling status (scheduled/confirmed or NULL)
            (SELECT rev.status::text
             FROM revisions rev
             WHERE rev.customer_id = c.id
               AND rev.status IN ('scheduled', 'confirmed')
             ORDER BY rev.scheduled_date DESC NULLS LAST
             LIMIT 1) AS revision_status,
            -- ID of the latest scheduled/confirmed revision (for unschedule)
            (SELECT rev.id
             FROM revisions rev
             WHERE rev.customer_id = c.id
               AND rev.status IN ('scheduled', 'confirmed')
             ORDER BY rev.scheduled_date DESC NULLS LAST
             LIMIT 1) AS latest_scheduled_revision_id,
            -- Count of scheduled/confirmed revisions (for ambiguity guard)
            (SELECT COUNT(*)
             FROM revisions rev
             WHERE rev.customer_id = c.id
               AND rev.status IN ('scheduled', 'confirmed'))::bigint AS scheduled_revision_count,
            -- Urgency score placeholder (overwritten in Rust below)
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
        LEFT JOIN action_targets agt ON agt.id = pa.action_target_id
        LEFT JOIN tasks tk ON tk.id = agt.task_id
        LEFT JOIN devices d ON d.id = tk.device_id
        WHERE {}
        "#,
        sql_parts.where_clause
    );

    let mut qb = sqlx::query_as::<_, InboxItem>(&query).bind(user_id);

    if let Some(ref pattern) = sql_parts.area_pattern {
        qb = qb.bind(pattern);
    }

    let mut items = qb.fetch_all(pool).await?;

    // Compute urgency scores in Rust and apply to items
    if !factors.is_empty() {
        let today = chrono::Utc::now().date_naive();
        for item in &mut items {
            let days_overdue = item.next_action_due.map(|due| {
                (today - due).num_days()
            });
            let days_since_last_contact = item.last_contact_at.map(|last| {
                (today - last.date_naive()).num_days()
            });
            let days_until_due = item.next_action_due.map(|due| {
                (due - today).num_days()
            });
            let customer_age_days = (today - item.customer_created_at.date_naive()).num_days();
            let input = CustomerScoringInput {
                customer_id: item.id,
                days_overdue,
                geocode_failed: item.geocode_status == "failed",
                total_communications: item.total_communications,
                days_since_last_contact,
                has_open_action: item.lifecycle_state == "active",
                lifecycle_rank: Some(item.lifecycle_rank),
                days_until_due,
                customer_age_days: Some(customer_age_days),
            };
            let (score, breakdown) = scoring_service::compute_urgency_with_breakdown(&input, &factors);
            item.urgency_score = score;
            item.score_breakdown = breakdown;
        }
    }

    // Unified sort: urgency_score DESC, then customer_created_at ASC as tiebreaker.
    // All ordering logic is now encoded in the scoring profile weights (lifecycle_rank,
    // days_until_due, customer_age_days factors). No separate hardcoded sort path.
    let total = items.len() as i64;
    items.sort_by(|a, b| {
        b.urgency_score
            .partial_cmp(&a.urgency_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.customer_created_at.cmp(&b.customer_created_at))
    });

    // Apply pagination after sorting
    let offset_usize = offset as usize;
    let limit_usize = limit as usize;
    let items: Vec<InboxItem> = items
        .into_iter()
        .skip(offset_usize)
        .take(limit_usize)
        .collect();

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

/// Upsert a snoozed planned_action for a revision/task (Phase 6).
/// Finds or creates an action_target for the task (revision migrated to task with same ID),
/// then upserts the planned_action via action_target_id.
pub async fn upsert_snooze_for_revision(
    pool: &PgPool,
    user_id: Uuid,
    revision_id: Uuid,
    req: &CreatePlannedActionRequest,
) -> Result<PlannedAction> {
    let action_target_id: Uuid = sqlx::query_as::<_, (Uuid,)>(
        r#"
        WITH existing AS (
            SELECT id FROM action_targets
            WHERE task_id = $1 AND user_id = $2
            LIMIT 1
        ),
        inserted AS (
            INSERT INTO action_targets (id, user_id, target_kind, task_id, created_at)
            SELECT $3, $2, 'task'::action_target_kind, $1, NOW()
            WHERE NOT EXISTS (SELECT 1 FROM existing)
            RETURNING id
        )
        SELECT id FROM existing
        UNION ALL
        SELECT id FROM inserted
        LIMIT 1
        "#,
    )
    .bind(revision_id)
    .bind(user_id)
    .bind(Uuid::new_v4())
    .fetch_one(pool)
    .await?
    .0;

    let action = sqlx::query_as::<_, PlannedAction>(&format!(
        r#"
        INSERT INTO planned_actions (
            id, user_id, customer_id, status,
            due_date, snooze_until, snooze_reason,
            action_target_id,
            note, created_at, updated_at
        )
        VALUES (
            $1, $2, $3, 'snoozed'::action_status,
            $4, $5, $6,
            $7,
            $8, NOW(), NOW()
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
    .bind(action_target_id)
    .bind(&req.note)
    .fetch_optional(pool)
    .await?;

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
        WHERE action_target_id = $5 AND user_id = $6
          AND status IN ('open', 'snoozed')
        RETURNING {}
        "#,
        PLANNED_ACTION_COLS
    ))
    .bind(req.due_date)
    .bind(req.snooze_until)
    .bind(&req.snooze_reason)
    .bind(&req.note)
    .bind(action_target_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(updated)
}

/// Complete all open planned_actions linked to a task (via action_targets).
/// Called when a task is completed (Phase 6).
pub async fn complete_planned_actions_for_task(
    pool: &PgPool,
    user_id: Uuid,
    task_id: Uuid,
) -> Result<u64> {
    let result = sqlx::query(
        r#"
        UPDATE planned_actions pa
        SET status = 'completed'::action_status,
            completed_at = NOW(),
            updated_at = NOW()
        FROM action_targets at
        WHERE at.id = pa.action_target_id
          AND at.task_id = $1
          AND pa.user_id = $2
          AND pa.status IN ('open', 'snoozed')
        "#,
    )
    .bind(task_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

/// Auto-create a planned_action for a communication follow-up.
/// Only creates if no open/snoozed planned_action already exists for this customer
/// on that date without an action_target (i.e. a standalone follow-up).
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
            action_target_id,
            note, created_at, updated_at
        )
        SELECT $1, $2, $3, 'open'::action_status,
               $4, NULL, NULL,
               NULL,
               $5, NOW(), NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM planned_actions
            WHERE customer_id = $3
              AND user_id = $2
              AND due_date = $4
              AND status IN ('open', 'snoozed')
              AND action_target_id IS NULL
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
