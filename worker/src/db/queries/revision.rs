//! Revision database queries

use sqlx::PgPool;
use uuid::Uuid;
use chrono::NaiveDate;
use anyhow::Result;

use crate::types::revision::Revision;

/// List upcoming revisions for a user
pub async fn list_upcoming_revisions(
    pool: &PgPool,
    user_id: Uuid,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Result<Vec<Revision>> {
    let revisions = sqlx::query_as!(
        Revision,
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
        "#,
        user_id,
        from_date,
        to_date,
    )
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
    let revisions = sqlx::query_as!(
        Revision,
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
        "#,
        user_id,
        date,
    )
    .fetch_all(pool)
    .await?;

    Ok(revisions)
}
