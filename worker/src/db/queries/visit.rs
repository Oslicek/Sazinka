//! Visit database queries

use anyhow::Result;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::{Visit, VisitWithCustomer};

/// Create a new visit
pub async fn create_visit(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    revision_id: Option<Uuid>,
    scheduled_date: NaiveDate,
    scheduled_time_start: Option<NaiveTime>,
    scheduled_time_end: Option<NaiveTime>,
    visit_type: &str,
) -> Result<Visit> {
    let visit = sqlx::query_as::<_, Visit>(
        r#"
        INSERT INTO visits (
            id, user_id, customer_id, revision_id,
            scheduled_date, scheduled_time_start, scheduled_time_end,
            status, visit_type, requires_follow_up,
            created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned', $8, FALSE, NOW(), NOW())
        RETURNING
            id, user_id, customer_id, revision_id,
            scheduled_date, scheduled_time_start, scheduled_time_end,
            status, visit_type,
            actual_arrival, actual_departure,
            result, result_notes,
            requires_follow_up, follow_up_reason,
            created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(customer_id)
    .bind(revision_id)
    .bind(scheduled_date)
    .bind(scheduled_time_start)
    .bind(scheduled_time_end)
    .bind(visit_type)
    .fetch_one(pool)
    .await?;

    Ok(visit)
}

/// Get a visit by ID
pub async fn get_visit(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<Option<Visit>> {
    let visit = sqlx::query_as::<_, Visit>(
        r#"
        SELECT
            id, user_id, customer_id, revision_id,
            scheduled_date, scheduled_time_start, scheduled_time_end,
            status, visit_type,
            actual_arrival, actual_departure,
            result, result_notes,
            requires_follow_up, follow_up_reason,
            created_at, updated_at
        FROM visits
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(visit)
}

/// List visits with filters and customer info
pub async fn list_visits(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Option<Uuid>,
    date_from: Option<NaiveDate>,
    date_to: Option<NaiveDate>,
    status: Option<&str>,
    visit_type: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<VisitWithCustomer>, i64)> {
    // Build WHERE conditions dynamically
    let mut conditions = vec!["v.user_id = $1".to_string()];
    let mut param_idx = 1;

    if customer_id.is_some() {
        param_idx += 1;
        conditions.push(format!("v.customer_id = ${}", param_idx));
    }
    if date_from.is_some() {
        param_idx += 1;
        conditions.push(format!("v.scheduled_date >= ${}", param_idx));
    }
    if date_to.is_some() {
        param_idx += 1;
        conditions.push(format!("v.scheduled_date <= ${}", param_idx));
    }
    if status.is_some() {
        param_idx += 1;
        conditions.push(format!("v.status = ${}", param_idx));
    }
    if visit_type.is_some() {
        param_idx += 1;
        conditions.push(format!("v.visit_type = ${}", param_idx));
    }

    let where_clause = conditions.join(" AND ");

    let query = format!(
        r#"
        SELECT
            v.id, v.user_id, v.customer_id, v.revision_id,
            v.scheduled_date, v.scheduled_time_start, v.scheduled_time_end,
            v.status, v.visit_type,
            v.actual_arrival, v.actual_departure,
            v.result, v.result_notes,
            v.requires_follow_up, v.follow_up_reason,
            v.created_at, v.updated_at,
            c.name as customer_name,
            c.street as customer_street,
            c.city as customer_city
        FROM visits v
        INNER JOIN customers c ON v.customer_id = c.id
        WHERE {}
        ORDER BY v.scheduled_date DESC, v.scheduled_time_start DESC
        LIMIT ${} OFFSET ${}
        "#,
        where_clause,
        param_idx + 1,
        param_idx + 2
    );

    let count_query = format!(
        "SELECT COUNT(*) FROM visits v WHERE {}",
        where_clause.replace("c.", "")
    );

    // Build query with bindings
    let mut query_builder = sqlx::query_as::<_, VisitWithCustomer>(&query).bind(user_id);
    let mut count_builder = sqlx::query_scalar::<_, i64>(&count_query).bind(user_id);

    if let Some(cid) = customer_id {
        query_builder = query_builder.bind(cid);
        count_builder = count_builder.bind(cid);
    }
    if let Some(df) = date_from {
        query_builder = query_builder.bind(df);
        count_builder = count_builder.bind(df);
    }
    if let Some(dt) = date_to {
        query_builder = query_builder.bind(dt);
        count_builder = count_builder.bind(dt);
    }
    if let Some(s) = status {
        query_builder = query_builder.bind(s);
        count_builder = count_builder.bind(s);
    }
    if let Some(vt) = visit_type {
        query_builder = query_builder.bind(vt);
        count_builder = count_builder.bind(vt);
    }

    query_builder = query_builder.bind(limit).bind(offset);

    let visits = query_builder.fetch_all(pool).await?;
    let total = count_builder.fetch_one(pool).await?;

    Ok((visits, total))
}

/// Update a visit
pub async fn update_visit(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    scheduled_date: Option<NaiveDate>,
    scheduled_time_start: Option<NaiveTime>,
    scheduled_time_end: Option<NaiveTime>,
    status: Option<&str>,
    visit_type: Option<&str>,
) -> Result<Option<Visit>> {
    let visit = sqlx::query_as::<_, Visit>(
        r#"
        UPDATE visits
        SET
            scheduled_date = COALESCE($3, scheduled_date),
            scheduled_time_start = COALESCE($4, scheduled_time_start),
            scheduled_time_end = COALESCE($5, scheduled_time_end),
            status = COALESCE($6, status),
            visit_type = COALESCE($7, visit_type),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id, user_id, customer_id, revision_id,
            scheduled_date, scheduled_time_start, scheduled_time_end,
            status, visit_type,
            actual_arrival, actual_departure,
            result, result_notes,
            requires_follow_up, follow_up_reason,
            created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(scheduled_date)
    .bind(scheduled_time_start)
    .bind(scheduled_time_end)
    .bind(status)
    .bind(visit_type)
    .fetch_optional(pool)
    .await?;

    Ok(visit)
}

/// Complete a visit with result
pub async fn complete_visit(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    result: &str,
    result_notes: Option<&str>,
    actual_arrival: Option<DateTime<Utc>>,
    actual_departure: Option<DateTime<Utc>>,
    requires_follow_up: bool,
    follow_up_reason: Option<&str>,
) -> Result<Option<Visit>> {
    let visit = sqlx::query_as::<_, Visit>(
        r#"
        UPDATE visits
        SET
            status = 'completed',
            result = $3,
            result_notes = $4,
            actual_arrival = $5,
            actual_departure = $6,
            requires_follow_up = $7,
            follow_up_reason = $8,
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id, user_id, customer_id, revision_id,
            scheduled_date, scheduled_time_start, scheduled_time_end,
            status, visit_type,
            actual_arrival, actual_departure,
            result, result_notes,
            requires_follow_up, follow_up_reason,
            created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(result)
    .bind(result_notes)
    .bind(actual_arrival)
    .bind(actual_departure)
    .bind(requires_follow_up)
    .bind(follow_up_reason)
    .fetch_optional(pool)
    .await?;

    Ok(visit)
}

/// Delete a visit
pub async fn delete_visit(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<bool> {
    let result = sqlx::query("DELETE FROM visits WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

/// Get visits for a customer (for timeline)
pub async fn get_customer_visits(
    pool: &PgPool,
    customer_id: Uuid,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<Visit>> {
    let visits = sqlx::query_as::<_, Visit>(
        r#"
        SELECT
            id, user_id, customer_id, revision_id,
            scheduled_date, scheduled_time_start, scheduled_time_end,
            status, visit_type,
            actual_arrival, actual_departure,
            result, result_notes,
            requires_follow_up, follow_up_reason,
            created_at, updated_at
        FROM visits
        WHERE customer_id = $1 AND user_id = $2
        ORDER BY scheduled_date DESC, created_at DESC
        LIMIT $3
        "#,
    )
    .bind(customer_id)
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(visits)
}
