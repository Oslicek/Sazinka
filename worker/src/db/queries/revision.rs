//! Revision database queries

use sqlx::PgPool;
use uuid::Uuid;
use chrono::{Datelike, NaiveDate, NaiveTime, Utc};
use anyhow::Result;

use crate::types::revision::{Revision, CreateRevisionRequest, UpdateRevisionRequest, RevisionStats};

// Common column list for Revision queries
const REVISION_COLS: &str = r#"
    r.id, r.device_id, r.customer_id, r.user_id,
    r.status::text, r.due_date, r.scheduled_date,
    r.scheduled_time_start, r.scheduled_time_end,
    r.completed_at, r.duration_minutes, r.result::text,
    r.findings, r.fulfilled_by_work_item_id,
    r.created_at, r.updated_at,
    r.snooze_until, r.snooze_reason,
    r.assigned_crew_id, r.route_order
"#;

// Simpler column list without table alias (for single-table queries)
const REVISION_COLS_SIMPLE: &str = r#"
    id, device_id, customer_id, user_id,
    status::text, due_date, scheduled_date,
    scheduled_time_start, scheduled_time_end,
    completed_at, duration_minutes, result::text,
    findings, fulfilled_by_work_item_id,
    created_at, updated_at,
    snooze_until, snooze_reason,
    assigned_crew_id, route_order
"#;

/// Create a new revision
pub async fn create_revision(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreateRevisionRequest,
) -> Result<Revision> {
    let status = req.status.as_deref().unwrap_or("upcoming");
    
    let query = format!(
        r#"
        INSERT INTO revisions (
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result,
            findings, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5::revision_status, $6, $7, $8, $9, $10, $11, $12::revision_result, $13, NOW(), NOW())
        RETURNING {}
        "#,
        REVISION_COLS_SIMPLE
    );
    
    let revision = sqlx::query_as::<_, Revision>(&query)
    .bind(Uuid::new_v4())
    .bind(req.device_id)
    .bind(req.customer_id)
    .bind(user_id)
    .bind(status)
    .bind(req.due_date)
    .bind(req.scheduled_date)
    .bind(req.scheduled_time_start)
    .bind(req.scheduled_time_end)
    .bind(req.completed_at)
    .bind(req.duration_minutes)
    .bind(req.result.as_deref())
    .bind(&req.findings)
    .fetch_one(pool)
    .await?;

    Ok(revision)
}

/// Get a single revision by ID
pub async fn get_revision(pool: &PgPool, revision_id: Uuid, user_id: Uuid) -> Result<Option<Revision>> {
    let query = format!(
        "SELECT {} FROM revisions r WHERE r.id = $1 AND r.user_id = $2",
        REVISION_COLS
    );
    
    let revision = sqlx::query_as::<_, Revision>(&query)
    .bind(revision_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(revision)
}

/// Update a revision
pub async fn update_revision(
    pool: &PgPool,
    revision_id: Uuid,
    user_id: Uuid,
    req: &UpdateRevisionRequest,
) -> Result<Option<Revision>> {
    let query = format!(
        r#"
        UPDATE revisions SET
            status = COALESCE($3::revision_status, status),
            due_date = COALESCE($4, due_date),
            scheduled_date = COALESCE($5, scheduled_date),
            scheduled_time_start = COALESCE($6, scheduled_time_start),
            scheduled_time_end = COALESCE($7, scheduled_time_end),
            duration_minutes = COALESCE($8, duration_minutes),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING {}
        "#,
        REVISION_COLS_SIMPLE
    );
    
    let revision = sqlx::query_as::<_, Revision>(&query)
    .bind(revision_id)
    .bind(user_id)
    .bind(&req.status)
    .bind(req.due_date)
    .bind(req.scheduled_date)
    .bind(req.scheduled_time_start)
    .bind(req.scheduled_time_end)
    .bind(req.duration_minutes)
    .fetch_optional(pool)
    .await?;

    Ok(revision)
}

/// Complete a revision with result and findings
pub async fn complete_revision(
    pool: &PgPool,
    revision_id: Uuid,
    user_id: Uuid,
    result: &str,
    findings: Option<&str>,
    duration_minutes: Option<i32>,
) -> Result<Option<Revision>> {
    let query = format!(
        r#"
        UPDATE revisions SET
            status = 'completed',
            result = $3::revision_result,
            findings = $4,
            duration_minutes = COALESCE($5, duration_minutes),
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING {}
        "#,
        REVISION_COLS_SIMPLE
    );
    
    let revision = sqlx::query_as::<_, Revision>(&query)
    .bind(revision_id)
    .bind(user_id)
    .bind(result)
    .bind(findings)
    .bind(duration_minutes)
    .fetch_optional(pool)
    .await?;

    Ok(revision)
}

/// Delete a revision
pub async fn delete_revision(pool: &PgPool, revision_id: Uuid, user_id: Uuid) -> Result<bool> {
    let result = sqlx::query(
        r#"DELETE FROM revisions WHERE id = $1 AND user_id = $2"#
    )
    .bind(revision_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// List upcoming revisions for a user
pub async fn list_upcoming_revisions(
    pool: &PgPool,
    user_id: Uuid,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<Revision>> {
    let query = format!(
        r#"
        SELECT {}
        FROM revisions r
        WHERE r.user_id = $1
          AND r.due_date >= $2
          AND r.due_date <= $3
          AND r.status NOT IN ('completed', 'cancelled')
        ORDER BY r.due_date ASC
        "#,
        REVISION_COLS
    );
    
    let revisions = sqlx::query_as::<_, Revision>(&query)
    .bind(user_id)
    .bind(from_date)
    .bind(to_date)
    .fetch_all(pool)
    .await?;

    Ok(revisions)
}

/// List revisions scheduled for a specific date (for route planning)
pub async fn list_revisions_for_date(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
) -> Result<Vec<Revision>> {
    let query = format!(
        r#"
        SELECT {}
        FROM revisions r
        WHERE r.user_id = $1 AND r.scheduled_date = $2
        ORDER BY r.scheduled_time_start ASC NULLS LAST
        "#,
        REVISION_COLS
    );
    
    let revisions = sqlx::query_as::<_, Revision>(&query)
    .bind(user_id)
    .bind(date)
    .fetch_all(pool)
    .await?;

    Ok(revisions)
}

/// List revisions with optional filters
pub async fn list_revisions(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Option<Uuid>,
    device_id: Option<Uuid>,
    status: Option<&str>,
    from_date: Option<NaiveDate>,
    to_date: Option<NaiveDate>,
    date_type: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Revision>> {
    let limit = limit.unwrap_or(100);
    let offset = offset.unwrap_or(0);
    let use_scheduled = date_type == Some("scheduled");
    
    let (date_field, order_field) = if use_scheduled {
        ("r.scheduled_date", "r.scheduled_date ASC, r.scheduled_time_start ASC NULLS LAST")
    } else {
        ("r.due_date", "r.due_date ASC")
    };
    
    let query = format!(
        r#"
        SELECT
            {revision_cols},
            d.device_name, d.device_type::text as device_type,
            c.name as customer_name, c.phone as customer_phone,
            c.street as customer_street, c.city as customer_city, 
            c.postal_code as customer_postal_code
        FROM revisions r
        LEFT JOIN devices d ON r.device_id = d.id
        LEFT JOIN customers c ON r.customer_id = c.id
        WHERE r.user_id = $1
          AND ($2::uuid IS NULL OR r.customer_id = $2)
          AND ($3::uuid IS NULL OR r.device_id = $3)
          AND ($4::text IS NULL OR r.status::text = $4)
          AND ($5::date IS NULL OR {date_field} >= $5)
          AND ($6::date IS NULL OR {date_field} <= $6)
        ORDER BY {order_field}
        LIMIT $7 OFFSET $8
        "#,
        revision_cols = REVISION_COLS,
        date_field = date_field,
        order_field = order_field
    );
    
    let revisions = sqlx::query_as::<_, Revision>(&query)
        .bind(user_id)
        .bind(customer_id)
        .bind(device_id)
        .bind(status)
        .bind(from_date)
        .bind(to_date)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

    Ok(revisions)
}

/// List overdue revisions
pub async fn list_overdue_revisions(pool: &PgPool, user_id: Uuid) -> Result<Vec<Revision>> {
    let today = Utc::now().date_naive();
    
    let query = format!(
        r#"
        SELECT {}
        FROM revisions r
        WHERE r.user_id = $1
          AND r.due_date < $2
          AND r.status NOT IN ('completed', 'cancelled')
        ORDER BY r.due_date ASC
        "#,
        REVISION_COLS
    );
    
    let revisions = sqlx::query_as::<_, Revision>(&query)
    .bind(user_id)
    .bind(today)
    .fetch_all(pool)
    .await?;

    Ok(revisions)
}

/// List revisions due soon
pub async fn list_due_soon_revisions(pool: &PgPool, user_id: Uuid, days: i32) -> Result<Vec<Revision>> {
    let today = Utc::now().date_naive();
    let end_date = today + chrono::Duration::days(days as i64);
    
    let query = format!(
        r#"
        SELECT {}
        FROM revisions r
        WHERE r.user_id = $1
          AND r.due_date >= $2
          AND r.due_date <= $3
          AND r.status NOT IN ('completed', 'cancelled')
        ORDER BY r.due_date ASC
        "#,
        REVISION_COLS
    );
    
    let revisions = sqlx::query_as::<_, Revision>(&query)
    .bind(user_id)
    .bind(today)
    .bind(end_date)
    .fetch_all(pool)
    .await?;

    Ok(revisions)
}

/// Get revision statistics for dashboard
pub async fn get_revision_stats(pool: &PgPool, user_id: Uuid) -> Result<RevisionStats> {
    let today = Utc::now().date_naive();
    let week_end = today + chrono::Duration::days(7);
    let month_start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap_or(today);
    
    let overdue: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM revisions WHERE user_id = $1 AND due_date < $2 AND status NOT IN ('completed', 'cancelled')"
    ).bind(user_id).bind(today).fetch_one(pool).await?;
    
    let due_this_week: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM revisions WHERE user_id = $1 AND due_date >= $2 AND due_date <= $3 AND status NOT IN ('completed', 'cancelled')"
    ).bind(user_id).bind(today).bind(week_end).fetch_one(pool).await?;
    
    let scheduled_today: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM revisions WHERE user_id = $1 AND scheduled_date = $2 AND status NOT IN ('completed', 'cancelled')"
    ).bind(user_id).bind(today).fetch_one(pool).await?;
    
    let completed_this_month: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM revisions WHERE user_id = $1 AND status = 'completed' AND completed_at >= $2"
    ).bind(user_id).bind(month_start).fetch_one(pool).await?;
    
    Ok(RevisionStats {
        overdue: overdue.0,
        due_this_week: due_this_week.0,
        scheduled_today: scheduled_today.0,
        completed_this_month: completed_this_month.0,
    })
}

/// List revisions by device
pub async fn list_revisions_by_device(pool: &PgPool, device_id: Uuid, user_id: Uuid) -> Result<Vec<Revision>> {
    let query = format!(
        r#"
        SELECT {}
        FROM revisions r
        WHERE r.device_id = $1 AND r.user_id = $2
        ORDER BY r.due_date DESC
        "#,
        REVISION_COLS
    );
    
    let revisions = sqlx::query_as::<_, Revision>(&query)
    .bind(device_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(revisions)
}

use crate::types::revision::RevisionSuggestion;

/// Get suggested revisions for route planning with priority scoring
pub async fn get_revision_suggestions(
    pool: &PgPool,
    user_id: Uuid,
    target_date: NaiveDate,
    max_count: i32,
    exclude_ids: &[Uuid],
) -> Result<(Vec<RevisionSuggestion>, i64)> {
    let today = Utc::now().date_naive();
    
    // Build exclude clause using parameterized binding (NOT r.id = ANY($N))
    // Never format UUIDs directly into SQL strings.
    let has_excludes = !exclude_ids.is_empty();
    let exclude_param = if has_excludes { "NOT (r.id = ANY($5))" } else { "TRUE" };
    
    let query = format!(
        r#"
        WITH scored_revisions AS (
            SELECT
                r.id, r.device_id, r.customer_id, r.user_id,
                r.status::text, r.due_date, r.scheduled_date,
                r.scheduled_time_start, r.scheduled_time_end,
                c.name as customer_name,
                c.street as customer_street,
                c.city as customer_city,
                c.lat as customer_lat,
                c.lng as customer_lng,
                (r.due_date - $2::date)::int as days_until_due,
                CASE
                    WHEN r.due_date < $2 THEN 100
                    WHEN r.due_date <= $2 + INTERVAL '7 days' THEN 80
                    WHEN r.due_date <= $2 + INTERVAL '14 days' THEN 60
                    WHEN r.due_date <= $2 + INTERVAL '30 days' THEN 40
                    ELSE 20
                END as priority_score,
                CASE
                    WHEN r.due_date < $2 THEN 'overdue'
                    WHEN r.due_date <= $2 + INTERVAL '7 days' THEN 'due_this_week'
                    WHEN r.due_date <= $2 + INTERVAL '14 days' THEN 'due_soon'
                    WHEN r.due_date <= $2 + INTERVAL '30 days' THEN 'due_this_month'
                    ELSE 'upcoming'
                END as priority_reason
            FROM revisions r
            INNER JOIN customers c ON r.customer_id = c.id
            WHERE r.user_id = $1
              AND r.status NOT IN ('completed', 'cancelled')
              AND (r.scheduled_date IS NULL OR r.scheduled_date = $3)
              AND c.lat IS NOT NULL AND c.lng IS NOT NULL
              AND {exclude}
        )
        SELECT * FROM scored_revisions
        ORDER BY priority_score DESC, days_until_due ASC
        LIMIT $4
        "#,
        exclude = exclude_param
    );
    
    let mut query_builder = sqlx::query_as::<_, RevisionSuggestion>(&query)
        .bind(user_id).bind(today).bind(target_date).bind(max_count as i64);

    if has_excludes {
        query_builder = query_builder.bind(exclude_ids);
    }

    let suggestions = query_builder.fetch_all(pool).await?;
    
    // Count query uses same exclude pattern
    let count_exclude = if has_excludes { "NOT (r.id = ANY($3))" } else { "TRUE" };
    let count_query = format!(
        r#"
        SELECT COUNT(*) FROM revisions r
        INNER JOIN customers c ON r.customer_id = c.id
        WHERE r.user_id = $1 AND r.status NOT IN ('completed', 'cancelled')
          AND (r.scheduled_date IS NULL OR r.scheduled_date = $2)
          AND c.lat IS NOT NULL AND c.lng IS NOT NULL AND {exclude}
        "#,
        exclude = count_exclude
    );
    
    let mut count_builder = sqlx::query_as::<_, (i64,)>(&count_query)
        .bind(user_id).bind(target_date);

    if has_excludes {
        count_builder = count_builder.bind(exclude_ids);
    }

    let total: (i64,) = count_builder.fetch_one(pool).await?;
    
    Ok((suggestions, total.0))
}

// ============================================================================
// Call Queue Queries
// ============================================================================

use crate::types::revision::{CallQueueItem, CallQueueRequest, CallQueueResponse};

/// Get the call queue
pub async fn get_call_queue(
    pool: &PgPool,
    user_id: Uuid,
    request: CallQueueRequest,
) -> Result<CallQueueResponse> {
    let today = Utc::now().date_naive();
    let limit = request.limit.unwrap_or(50) as i64;
    let offset = request.offset.unwrap_or(0) as i64;

    // Dynamic query builder: all user-provided values MUST use $N parameterized
    // bindings. NEVER interpolate user input into SQL via format!().
    let mut conditions = vec![
        "r.user_id = $1".to_string(),
        "r.status IN ('upcoming', 'scheduled')".to_string(),
        "r.scheduled_date IS NULL".to_string(),
        "(r.snooze_until IS NULL OR r.snooze_until <= $2)".to_string(),
        "r.due_date BETWEEN $2 - INTERVAL '30 days' AND $2 + INTERVAL '60 days'".to_string(),
    ];

    // Next parameter index (after user_id=$1, today=$2, limit=$3, offset=$4)
    let mut param_idx: usize = 4;

    // Area filter (postal code prefix) — parameterized to prevent SQL injection
    let area_pattern = request.area.as_ref().map(|a| format!("{}%", a));
    if area_pattern.is_some() {
        param_idx += 1;
        conditions.push(format!("c.postal_code LIKE ${}", param_idx));
    }

    // Device type filter — parameterized to prevent SQL injection
    if request.device_type.is_some() {
        param_idx += 1;
        conditions.push(format!("d.device_type::text = ${}", param_idx));
    }

    if let Some(ref priority) = request.priority_filter {
        match priority.as_str() {
            "overdue" => conditions.push("r.due_date < $2".to_string()),
            "due_soon" => conditions.push("r.due_date BETWEEN $2 AND $2 + INTERVAL '7 days'".to_string()),
            "upcoming" => conditions.push("r.due_date > $2 + INTERVAL '7 days'".to_string()),
            _ => {}
        }
    }
    if request.geocoded_only.unwrap_or(false) {
        conditions.push("c.geocode_status = 'success'".to_string());
    }

    let where_clause = conditions.join(" AND ");

    let query = format!(
        r#"
        SELECT
            r.id, r.device_id, r.customer_id, r.user_id,
            r.status::text, r.due_date, r.snooze_until, r.snooze_reason,
            c.name as customer_name, c.phone as customer_phone,
            c.email as customer_email, c.street as customer_street,
            c.city as customer_city, c.postal_code as customer_postal_code,
            c.lat as customer_lat, c.lng as customer_lng,
            c.geocode_status::text as customer_geocode_status,
            d.device_name, d.device_type::text,
            (r.due_date - $2::date)::int as days_until_due,
            CASE
                WHEN r.due_date < $2 THEN 'overdue'
                WHEN r.due_date <= $2 + INTERVAL '7 days' THEN 'due_this_week'
                WHEN r.due_date <= $2 + INTERVAL '14 days' THEN 'due_soon'
                ELSE 'upcoming'
            END as priority,
            (SELECT MAX(created_at) FROM communications WHERE customer_id = c.id) as last_contact_at,
            (SELECT COUNT(*) FROM communications WHERE customer_id = c.id AND created_at > $2 - INTERVAL '30 days') as contact_attempts
        FROM revisions r
        INNER JOIN customers c ON r.customer_id = c.id
        INNER JOIN devices d ON r.device_id = d.id
        WHERE {}
        ORDER BY CASE WHEN r.due_date < $2 THEN 0 ELSE 1 END, r.due_date ASC
        LIMIT $3 OFFSET $4
        "#,
        where_clause
    );

    let mut query_builder = sqlx::query_as::<_, CallQueueItem>(&query)
        .bind(user_id).bind(today).bind(limit).bind(offset);

    if let Some(ref pattern) = area_pattern {
        query_builder = query_builder.bind(pattern);
    }
    if let Some(ref dt) = request.device_type {
        query_builder = query_builder.bind(dt);
    }

    let items = query_builder.fetch_all(pool).await?;

    let count_query = format!(
        "SELECT COUNT(*) FROM revisions r INNER JOIN customers c ON r.customer_id = c.id INNER JOIN devices d ON r.device_id = d.id WHERE {}",
        where_clause
    );
    let mut count_builder = sqlx::query_as::<_, (i64,)>(&count_query)
        .bind(user_id).bind(today);

    if let Some(ref pattern) = area_pattern {
        count_builder = count_builder.bind(pattern);
    }
    if let Some(ref dt) = request.device_type {
        count_builder = count_builder.bind(dt);
    }

    let total: (i64,) = count_builder.fetch_one(pool).await?;

    let overdue_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM revisions r WHERE r.user_id = $1 AND r.status IN ('upcoming', 'scheduled') AND r.scheduled_date IS NULL AND (r.snooze_until IS NULL OR r.snooze_until <= $2) AND r.due_date < $2"
    ).bind(user_id).bind(today).fetch_one(pool).await?;

    let due_soon_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM revisions r WHERE r.user_id = $1 AND r.status IN ('upcoming', 'scheduled') AND r.scheduled_date IS NULL AND (r.snooze_until IS NULL OR r.snooze_until <= $2) AND r.due_date BETWEEN $2 AND $2 + INTERVAL '7 days'"
    ).bind(user_id).bind(today).fetch_one(pool).await?;

    Ok(CallQueueResponse {
        items,
        total: total.0,
        overdue_count: overdue_count.0,
        due_soon_count: due_soon_count.0,
    })
}

/// Snooze a revision
pub async fn snooze_revision(
    pool: &PgPool,
    user_id: Uuid,
    revision_id: Uuid,
    snooze_until: NaiveDate,
    reason: Option<String>,
) -> Result<Option<Revision>> {
    let query = format!(
        r#"
        UPDATE revisions
        SET snooze_until = $1, snooze_reason = $2, updated_at = NOW()
        WHERE id = $3 AND user_id = $4
        RETURNING {}
        "#,
        REVISION_COLS_SIMPLE
    );
    
    let revision = sqlx::query_as::<_, Revision>(&query)
    .bind(snooze_until).bind(reason)
    .bind(revision_id).bind(user_id)
    .fetch_optional(pool).await?;

    Ok(revision)
}

/// Clear snooze
pub async fn clear_snooze(
    pool: &PgPool,
    user_id: Uuid,
    revision_id: Uuid,
) -> Result<Option<Revision>> {
    let query = format!(
        r#"
        UPDATE revisions
        SET snooze_until = NULL, snooze_reason = NULL, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING {}
        "#,
        REVISION_COLS_SIMPLE
    );
    
    let revision = sqlx::query_as::<_, Revision>(&query)
    .bind(revision_id).bind(user_id)
    .fetch_optional(pool).await?;

    Ok(revision)
}

/// Schedule a revision
pub async fn schedule_revision(
    pool: &PgPool,
    user_id: Uuid,
    revision_id: Uuid,
    scheduled_date: NaiveDate,
    time_start: Option<NaiveTime>,
    time_end: Option<NaiveTime>,
    crew_id: Option<Uuid>,
    duration_minutes: Option<i32>,
) -> Result<Option<Revision>> {
    let query = format!(
        r#"
        UPDATE revisions
        SET scheduled_date = $1, scheduled_time_start = $2, scheduled_time_end = $3,
            assigned_crew_id = $4, duration_minutes = COALESCE($5, duration_minutes),
            status = 'scheduled', snooze_until = NULL, snooze_reason = NULL, updated_at = NOW()
        WHERE id = $6 AND user_id = $7
        RETURNING {}
        "#,
        REVISION_COLS_SIMPLE
    );
    
    let revision = sqlx::query_as::<_, Revision>(&query)
    .bind(scheduled_date).bind(time_start).bind(time_end)
    .bind(crew_id).bind(duration_minutes)
    .bind(revision_id).bind(user_id)
    .fetch_optional(pool).await?;

    Ok(revision)
}
