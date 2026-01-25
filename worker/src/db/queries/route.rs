//! Route database queries

use sqlx::PgPool;
use uuid::Uuid;
use chrono::NaiveDate;
use anyhow::Result;

use crate::types::route::Route;

/// Get route for a specific date
pub async fn get_route_for_date(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
) -> Result<Option<Route>> {
    let route = sqlx::query_as::<_, Route>(
        r#"
        SELECT
            id, user_id, date, status,
            total_distance_km, total_duration_minutes,
            optimization_score, created_at, updated_at
        FROM routes
        WHERE user_id = $1 AND date = $2
        "#
    )
    .bind(user_id)
    .bind(date)
    .fetch_optional(pool)
    .await?;

    Ok(route)
}

/// Create or update route
pub async fn upsert_route(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
    status: &str,
    total_distance_km: Option<f64>,
    total_duration_minutes: Option<i32>,
    optimization_score: Option<i32>,
) -> Result<Route> {
    let route = sqlx::query_as::<_, Route>(
        r#"
        INSERT INTO routes (
            id, user_id, date, status,
            total_distance_km, total_duration_minutes,
            optimization_score, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        ON CONFLICT (user_id, date)
        DO UPDATE SET
            status = $4,
            total_distance_km = $5,
            total_duration_minutes = $6,
            optimization_score = $7,
            updated_at = NOW()
        RETURNING
            id, user_id, date, status,
            total_distance_km, total_duration_minutes,
            optimization_score, created_at, updated_at
        "#
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(date)
    .bind(status)
    .bind(total_distance_km)
    .bind(total_duration_minutes)
    .bind(optimization_score)
    .fetch_one(pool)
    .await?;

    Ok(route)
}
