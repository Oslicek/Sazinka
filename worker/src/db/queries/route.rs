//! Route database queries

use sqlx::PgPool;
use uuid::Uuid;
use chrono::{NaiveDate, NaiveTime};
use anyhow::Result;

use crate::types::route::Route;

/// A stop in a saved route
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRouteStop {
    pub id: Uuid,
    pub route_id: Uuid,
    pub customer_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub stop_order: i32,
    pub estimated_arrival: Option<NaiveTime>,
    pub estimated_departure: Option<NaiveTime>,
    pub distance_from_previous_km: Option<f64>,
    pub duration_from_previous_minutes: Option<i32>,
    pub status: String,
}

/// Get route for a specific date and optional crew
pub async fn get_route_for_date(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
) -> Result<Option<Route>> {
    let route = sqlx::query_as::<_, Route>(
        r#"
        SELECT
            id, user_id, crew_id, date, status::text,
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

/// Route with crew info and stops count
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteWithCrewInfo {
    pub id: Uuid,
    pub user_id: Uuid,
    pub crew_id: Option<Uuid>,
    pub crew_name: Option<String>,
    pub date: NaiveDate,
    pub status: String,
    pub total_distance_km: Option<f64>,
    pub total_duration_minutes: Option<i32>,
    pub optimization_score: Option<i32>,
    pub stops_count: Option<i64>,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

/// List all routes for a specific date (all crews)
pub async fn list_routes_for_date(
    pool: &PgPool,
    user_id: Uuid,
    date: NaiveDate,
) -> Result<Vec<RouteWithCrewInfo>> {
    let routes = sqlx::query_as::<_, RouteWithCrewInfo>(
        r#"
        SELECT
            r.id,
            r.user_id,
            r.crew_id,
            c.name as crew_name,
            r.date,
            r.status::text as status,
            r.total_distance_km,
            r.total_duration_minutes,
            r.optimization_score,
            COUNT(rs.id) as stops_count,
            r.created_at,
            r.updated_at
        FROM routes r
        LEFT JOIN crews c ON c.id = r.crew_id
        LEFT JOIN route_stops rs ON rs.route_id = r.id
        WHERE r.user_id = $1 AND r.date = $2
        GROUP BY r.id, c.name
        ORDER BY c.name NULLS LAST
        "#
    )
    .bind(user_id)
    .bind(date)
    .fetch_all(pool)
    .await?;

    Ok(routes)
}

/// Create or update route (with crew_id)
pub async fn upsert_route(
    pool: &PgPool,
    user_id: Uuid,
    crew_id: Option<Uuid>,
    date: NaiveDate,
    status: &str,
    total_distance_km: Option<f64>,
    total_duration_minutes: Option<i32>,
    optimization_score: Option<i32>,
) -> Result<Route> {
    let route = sqlx::query_as::<_, Route>(
        r#"
        INSERT INTO routes (
            id, user_id, crew_id, date, status,
            total_distance_km, total_duration_minutes,
            optimization_score, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5::route_status, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (user_id, date, crew_id)
        DO UPDATE SET
            status = $5::route_status,
            total_distance_km = $6,
            total_duration_minutes = $7,
            optimization_score = $8,
            updated_at = NOW()
        RETURNING
            id, user_id, crew_id, date, status::text,
            total_distance_km, total_duration_minutes,
            optimization_score, created_at, updated_at
        "#
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(crew_id)
    .bind(date)
    .bind(status)
    .bind(total_distance_km)
    .bind(total_duration_minutes)
    .bind(optimization_score)
    .fetch_one(pool)
    .await?;

    Ok(route)
}

/// Delete all stops for a route
pub async fn delete_route_stops(pool: &PgPool, route_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM route_stops WHERE route_id = $1")
        .bind(route_id).execute(pool).await?;
    Ok(())
}

/// Insert a route stop (customer_id based, with optional visit_id and revision_id)
pub async fn insert_route_stop(
    pool: &PgPool,
    route_id: Uuid,
    customer_id: Uuid,
    visit_id: Option<Uuid>,
    revision_id: Option<Uuid>,
    stop_order: i32,
    estimated_arrival: Option<NaiveTime>,
    estimated_departure: Option<NaiveTime>,
    distance_from_previous_km: Option<f64>,
    duration_from_previous_minutes: Option<i32>,
) -> Result<SavedRouteStop> {
    let stop = sqlx::query_as::<_, SavedRouteStop>(
        r#"
        INSERT INTO route_stops (
            id, route_id, customer_id, visit_id, revision_id,
            stop_order, estimated_arrival, estimated_departure,
            distance_from_previous_km, duration_from_previous_minutes,
            status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
        RETURNING
            id, route_id, customer_id, visit_id, revision_id,
            stop_order, estimated_arrival, estimated_departure,
            distance_from_previous_km, duration_from_previous_minutes,
            status
        "#
    )
    .bind(Uuid::new_v4())
    .bind(route_id)
    .bind(customer_id)
    .bind(visit_id)
    .bind(revision_id)
    .bind(stop_order)
    .bind(estimated_arrival)
    .bind(estimated_departure)
    .bind(distance_from_previous_km)
    .bind(duration_from_previous_minutes)
    .fetch_one(pool)
    .await?;
    
    Ok(stop)
}

/// Route stop with customer info for loading saved routes
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStopWithInfo {
    pub id: Uuid,
    pub route_id: Uuid,
    pub customer_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub stop_order: i32,
    pub estimated_arrival: Option<NaiveTime>,
    pub estimated_departure: Option<NaiveTime>,
    pub distance_from_previous_km: Option<f64>,
    pub duration_from_previous_minutes: Option<i32>,
    pub status: String,
    pub customer_name: Option<String>,
    pub address: Option<String>,
    pub customer_lat: Option<f64>,
    pub customer_lng: Option<f64>,
}

/// Get all stops for a route with customer info
pub async fn get_route_stops_with_info(
    pool: &PgPool,
    route_id: Uuid,
) -> Result<Vec<RouteStopWithInfo>> {
    let stops = sqlx::query_as::<_, RouteStopWithInfo>(
        r#"
        SELECT
            rs.id, rs.route_id, rs.customer_id,
            rs.visit_id, rs.revision_id,
            rs.stop_order, rs.estimated_arrival, rs.estimated_departure,
            rs.distance_from_previous_km, rs.duration_from_previous_minutes,
            rs.status,
            c.name as customer_name,
            CONCAT(COALESCE(c.street, ''), ', ', COALESCE(c.city, '')) as address,
            c.lat as customer_lat,
            c.lng as customer_lng
        FROM route_stops rs
        INNER JOIN customers c ON rs.customer_id = c.id
        WHERE rs.route_id = $1
        ORDER BY rs.stop_order ASC
        "#
    )
    .bind(route_id)
    .fetch_all(pool)
    .await?;
    
    Ok(stops)
}

/// Delete a route and all its stops
pub async fn delete_route(pool: &PgPool, user_id: Uuid, date: NaiveDate) -> Result<bool> {
    let result = sqlx::query("DELETE FROM routes WHERE user_id = $1 AND date = $2")
        .bind(user_id).bind(date).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}
