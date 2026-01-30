//! Revision database queries

use sqlx::PgPool;
use uuid::Uuid;
use chrono::{Datelike, NaiveDate, Utc};
use anyhow::Result;

use crate::types::revision::{Revision, CreateRevisionRequest, UpdateRevisionRequest, RevisionStats};

/// Create a new revision
pub async fn create_revision(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreateRevisionRequest,
) -> Result<Revision> {
    let revision = sqlx::query_as::<_, Revision>(
        r#"
        INSERT INTO revisions (
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            findings, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 'upcoming', $5, $6, $7, $8, $9, NOW(), NOW())
        RETURNING
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings,
            created_at, updated_at
        "#
    )
    .bind(Uuid::new_v4())
    .bind(req.device_id)
    .bind(req.customer_id)
    .bind(user_id)
    .bind(req.due_date)
    .bind(req.scheduled_date)
    .bind(req.scheduled_time_start)
    .bind(req.scheduled_time_end)
    .bind(&req.findings)
    .fetch_one(pool)
    .await?;

    Ok(revision)
}

/// Get a single revision by ID
pub async fn get_revision(pool: &PgPool, revision_id: Uuid, user_id: Uuid) -> Result<Option<Revision>> {
    let revision = sqlx::query_as::<_, Revision>(
        r#"
        SELECT
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings,
            created_at, updated_at
        FROM revisions
        WHERE id = $1 AND user_id = $2
        "#
    )
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
    let revision = sqlx::query_as::<_, Revision>(
        r#"
        UPDATE revisions SET
            status = COALESCE($3, status),
            due_date = COALESCE($4, due_date),
            scheduled_date = COALESCE($5, scheduled_date),
            scheduled_time_start = COALESCE($6, scheduled_time_start),
            scheduled_time_end = COALESCE($7, scheduled_time_end),
            duration_minutes = COALESCE($8, duration_minutes),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings,
            created_at, updated_at
        "#
    )
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
    let revision = sqlx::query_as::<_, Revision>(
        r#"
        UPDATE revisions SET
            status = 'completed',
            result = $3,
            findings = $4,
            duration_minutes = COALESCE($5, duration_minutes),
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings,
            created_at, updated_at
        "#
    )
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
        r#"
        DELETE FROM revisions
        WHERE id = $1 AND user_id = $2
        "#
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
    let revisions = sqlx::query_as::<_, Revision>(
        r#"
        SELECT
            r.id, r.device_id, r.customer_id, r.user_id,
            r.status, r.due_date, r.scheduled_date,
            r.scheduled_time_start, r.scheduled_time_end,
            r.completed_at, r.duration_minutes, r.result,
            r.findings, r.created_at, r.updated_at
        FROM revisions r
        WHERE r.user_id = $1
          AND r.due_date >= $2
          AND r.due_date <= $3
          AND r.status != 'completed'
          AND r.status != 'cancelled'
        ORDER BY r.due_date ASC
        "#
    )
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
    let revisions = sqlx::query_as::<_, Revision>(
        r#"
        SELECT
            r.id, r.device_id, r.customer_id, r.user_id,
            r.status, r.due_date, r.scheduled_date,
            r.scheduled_time_start, r.scheduled_time_end,
            r.completed_at, r.duration_minutes, r.result,
            r.findings, r.created_at, r.updated_at
        FROM revisions r
        WHERE r.user_id = $1 AND r.scheduled_date = $2
        ORDER BY r.scheduled_time_start ASC NULLS LAST
        "#
    )
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
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Revision>> {
    let limit = limit.unwrap_or(100);
    let offset = offset.unwrap_or(0);
    
    let revisions = sqlx::query_as::<_, Revision>(
        r#"
        SELECT
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings,
            created_at, updated_at
        FROM revisions
        WHERE user_id = $1
          AND ($2::uuid IS NULL OR customer_id = $2)
          AND ($3::uuid IS NULL OR device_id = $3)
          AND ($4::text IS NULL OR status = $4)
          AND ($5::date IS NULL OR due_date >= $5)
          AND ($6::date IS NULL OR due_date <= $6)
        ORDER BY due_date ASC
        LIMIT $7 OFFSET $8
        "#
    )
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

/// List overdue revisions (due_date < today, not completed/cancelled)
pub async fn list_overdue_revisions(pool: &PgPool, user_id: Uuid) -> Result<Vec<Revision>> {
    let today = Utc::now().date_naive();
    
    let revisions = sqlx::query_as::<_, Revision>(
        r#"
        SELECT
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings,
            created_at, updated_at
        FROM revisions
        WHERE user_id = $1
          AND due_date < $2
          AND status NOT IN ('completed', 'cancelled')
        ORDER BY due_date ASC
        "#
    )
    .bind(user_id)
    .bind(today)
    .fetch_all(pool)
    .await?;

    Ok(revisions)
}

/// List revisions due soon (within N days from today)
pub async fn list_due_soon_revisions(pool: &PgPool, user_id: Uuid, days: i32) -> Result<Vec<Revision>> {
    let today = Utc::now().date_naive();
    let end_date = today + chrono::Duration::days(days as i64);
    
    let revisions = sqlx::query_as::<_, Revision>(
        r#"
        SELECT
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings,
            created_at, updated_at
        FROM revisions
        WHERE user_id = $1
          AND due_date >= $2
          AND due_date <= $3
          AND status NOT IN ('completed', 'cancelled')
        ORDER BY due_date ASC
        "#
    )
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
    
    // Count overdue
    let overdue: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM revisions
        WHERE user_id = $1 AND due_date < $2 AND status NOT IN ('completed', 'cancelled')
        "#
    )
    .bind(user_id)
    .bind(today)
    .fetch_one(pool)
    .await?;
    
    // Count due this week
    let due_this_week: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM revisions
        WHERE user_id = $1 AND due_date >= $2 AND due_date <= $3 AND status NOT IN ('completed', 'cancelled')
        "#
    )
    .bind(user_id)
    .bind(today)
    .bind(week_end)
    .fetch_one(pool)
    .await?;
    
    // Count scheduled today
    let scheduled_today: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM revisions
        WHERE user_id = $1 AND scheduled_date = $2 AND status NOT IN ('completed', 'cancelled')
        "#
    )
    .bind(user_id)
    .bind(today)
    .fetch_one(pool)
    .await?;
    
    // Count completed this month
    let completed_this_month: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM revisions
        WHERE user_id = $1 AND status = 'completed' AND completed_at >= $2
        "#
    )
    .bind(user_id)
    .bind(month_start)
    .fetch_one(pool)
    .await?;
    
    Ok(RevisionStats {
        overdue: overdue.0,
        due_this_week: due_this_week.0,
        scheduled_today: scheduled_today.0,
        completed_this_month: completed_this_month.0,
    })
}

/// List revisions by device
pub async fn list_revisions_by_device(pool: &PgPool, device_id: Uuid, user_id: Uuid) -> Result<Vec<Revision>> {
    let revisions = sqlx::query_as::<_, Revision>(
        r#"
        SELECT
            id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings,
            created_at, updated_at
        FROM revisions
        WHERE device_id = $1 AND user_id = $2
        ORDER BY due_date DESC
        "#
    )
    .bind(device_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(revisions)
}

use crate::types::revision::RevisionSuggestion;

/// Get suggested revisions for route planning with priority scoring
/// 
/// Priority algorithm:
/// - Overdue: 100 points
/// - Due within 7 days: 80 points  
/// - Due within 14 days: 60 points
/// - Due within 30 days: 40 points
/// - Due later: 20 points
pub async fn get_revision_suggestions(
    pool: &PgPool,
    user_id: Uuid,
    target_date: NaiveDate,
    max_count: i32,
    exclude_ids: &[Uuid],
) -> Result<(Vec<RevisionSuggestion>, i64)> {
    let today = Utc::now().date_naive();
    
    // Build exclusion clause
    let exclude_clause = if exclude_ids.is_empty() {
        "TRUE".to_string()
    } else {
        let ids: Vec<String> = exclude_ids.iter().map(|id| format!("'{}'", id)).collect();
        format!("r.id NOT IN ({})", ids.join(","))
    };
    
    // Query with priority scoring
    let query = format!(
        r#"
        WITH scored_revisions AS (
            SELECT
                r.id,
                r.device_id,
                r.customer_id,
                r.user_id,
                r.status,
                r.due_date,
                r.scheduled_date,
                r.scheduled_time_start,
                r.scheduled_time_end,
                c.name as customer_name,
                c.street as customer_street,
                c.city as customer_city,
                c.lat as customer_lat,
                c.lng as customer_lng,
                (r.due_date - $2::date)::int as days_until_due,
                CASE
                    WHEN r.due_date < $2 THEN 100  -- Overdue
                    WHEN r.due_date <= $2 + INTERVAL '7 days' THEN 80  -- Due within week
                    WHEN r.due_date <= $2 + INTERVAL '14 days' THEN 60  -- Due within 2 weeks
                    WHEN r.due_date <= $2 + INTERVAL '30 days' THEN 40  -- Due within month
                    ELSE 20  -- Due later
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
              AND c.lat IS NOT NULL
              AND c.lng IS NOT NULL
              AND {}
        )
        SELECT * FROM scored_revisions
        ORDER BY priority_score DESC, days_until_due ASC
        LIMIT $4
        "#,
        exclude_clause
    );
    
    let suggestions = sqlx::query_as::<_, RevisionSuggestion>(&query)
        .bind(user_id)
        .bind(today)
        .bind(target_date)
        .bind(max_count as i64)
        .fetch_all(pool)
        .await?;
    
    // Get total count of candidates
    let count_query = format!(
        r#"
        SELECT COUNT(*)
        FROM revisions r
        INNER JOIN customers c ON r.customer_id = c.id
        WHERE r.user_id = $1
          AND r.status NOT IN ('completed', 'cancelled')
          AND (r.scheduled_date IS NULL OR r.scheduled_date = $2)
          AND c.lat IS NOT NULL
          AND c.lng IS NOT NULL
          AND {}
        "#,
        exclude_clause
    );
    
    let total: (i64,) = sqlx::query_as(&count_query)
        .bind(user_id)
        .bind(target_date)
        .fetch_one(pool)
        .await?;
    
    Ok((suggestions, total.0))
}
