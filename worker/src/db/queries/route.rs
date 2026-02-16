//! Route database queries

use sqlx::PgPool;
use uuid::Uuid;
use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use anyhow::Result;

use crate::types::route::Route;

/// A stop in a saved route
#[derive(Debug, Clone, sqlx::FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRouteStop {
    pub id: Uuid,
    pub route_id: Uuid,
    pub customer_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub stop_order: i32,
    pub estimated_arrival: Option<NaiveTime>,
    pub estimated_departure: Option<NaiveTime>,
    pub distance_from_previous_km: Option<f64>,
    pub duration_from_previous_minutes: Option<i32>,
    pub status: String,
    pub stop_type: String,
    pub break_duration_minutes: Option<i32>,
    pub break_time_start: Option<NaiveTime>,
    pub service_duration_minutes: Option<i32>,
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
            id, user_id, crew_id, depot_id, date, status,
            total_distance_km, total_duration_minutes,
            optimization_score,
            arrival_buffer_percent, arrival_buffer_fixed_minutes,
            return_to_depot_distance_km, return_to_depot_duration_minutes,
            created_at, updated_at
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

/// Get a specific route by ID (with user check)
pub async fn get_route_by_id(
    pool: &PgPool,
    user_id: Uuid,
    route_id: Uuid,
) -> Result<Option<Route>> {
    let route = sqlx::query_as::<_, Route>(
        r#"
        SELECT
            id, user_id, crew_id, depot_id, date, status,
            total_distance_km, total_duration_minutes,
            optimization_score,
            arrival_buffer_percent, arrival_buffer_fixed_minutes,
            return_to_depot_distance_km, return_to_depot_duration_minutes,
            created_at, updated_at
        FROM routes
        WHERE id = $1 AND user_id = $2
        "#
    )
    .bind(route_id)
    .bind(user_id)
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
    pub depot_id: Option<Uuid>,
    pub date: NaiveDate,
    pub status: String,
    pub total_distance_km: Option<f64>,
    pub total_duration_minutes: Option<i32>,
    pub optimization_score: Option<i32>,
    pub arrival_buffer_percent: f64,
    pub arrival_buffer_fixed_minutes: f64,
    pub return_to_depot_distance_km: Option<f64>,
    pub return_to_depot_duration_minutes: Option<i32>,
    pub stops_count: Option<i64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
            r.depot_id,
            r.date,
            r.status::text as status,
            r.total_distance_km,
            r.total_duration_minutes,
            r.optimization_score,
            r.arrival_buffer_percent,
            r.arrival_buffer_fixed_minutes,
            r.return_to_depot_distance_km,
            r.return_to_depot_duration_minutes,
            COUNT(rs.id) FILTER (WHERE rs.stop_type = 'customer') as stops_count,
            r.created_at,
            r.updated_at
        FROM routes r
        LEFT JOIN crews c ON c.id = r.crew_id
        LEFT JOIN route_stops rs ON rs.route_id = r.id
        WHERE r.user_id = $1 AND r.date = $2
        GROUP BY r.id, c.name, r.depot_id
        ORDER BY c.name NULLS LAST
        "#
    )
    .bind(user_id)
    .bind(date)
    .fetch_all(pool)
    .await?;

    Ok(routes)
}

/// Create or update route (with crew_id and depot_id)
pub async fn upsert_route(
    pool: &PgPool,
    user_id: Uuid,
    crew_id: Option<Uuid>,
    depot_id: Option<Uuid>,
    date: NaiveDate,
    status: &str,
    total_distance_km: Option<f64>,
    total_duration_minutes: Option<i32>,
    optimization_score: Option<i32>,
    return_to_depot_distance_km: Option<f64>,
    return_to_depot_duration_minutes: Option<i32>,
    arrival_buffer_percent: f64,
    arrival_buffer_fixed_minutes: f64,
) -> Result<Route> {
    // Two-step upsert to handle NULL crew_id (NULL != NULL in SQL unique index)
    let existing = if let Some(cid) = crew_id {
        sqlx::query_as::<_, Route>(
            "SELECT id, user_id, crew_id, depot_id, date, status, total_distance_km, total_duration_minutes, optimization_score, arrival_buffer_percent, arrival_buffer_fixed_minutes, return_to_depot_distance_km, return_to_depot_duration_minutes, created_at, updated_at FROM routes WHERE user_id = $1 AND date = $2 AND crew_id = $3"
        )
        .bind(user_id).bind(date).bind(cid)
        .fetch_optional(pool).await?
    } else {
        sqlx::query_as::<_, Route>(
            "SELECT id, user_id, crew_id, depot_id, date, status, total_distance_km, total_duration_minutes, optimization_score, arrival_buffer_percent, arrival_buffer_fixed_minutes, return_to_depot_distance_km, return_to_depot_duration_minutes, created_at, updated_at FROM routes WHERE user_id = $1 AND date = $2 AND crew_id IS NULL"
        )
        .bind(user_id).bind(date)
        .fetch_optional(pool).await?
    };

    let route = if let Some(existing_route) = existing {
        // Update existing route
        sqlx::query_as::<_, Route>(
            r#"
            UPDATE routes SET
                status = $2::route_status,
                total_distance_km = $3,
                total_duration_minutes = $4,
                optimization_score = $5,
                return_to_depot_distance_km = $6,
                return_to_depot_duration_minutes = $7,
                arrival_buffer_percent = $8,
                arrival_buffer_fixed_minutes = $9,
                updated_at = NOW()
            WHERE id = $1
            RETURNING
                id, user_id, crew_id, depot_id, date, status,
                total_distance_km, total_duration_minutes,
                optimization_score,
                arrival_buffer_percent, arrival_buffer_fixed_minutes,
                return_to_depot_distance_km, return_to_depot_duration_minutes,
                created_at, updated_at
            "#
        )
        .bind(existing_route.id)
        .bind(status)
        .bind(total_distance_km)
        .bind(total_duration_minutes)
        .bind(optimization_score)
        .bind(return_to_depot_distance_km)
        .bind(return_to_depot_duration_minutes)
        .bind(arrival_buffer_percent)
        .bind(arrival_buffer_fixed_minutes)
        .fetch_one(pool).await?
    } else {
        // Insert new route
        sqlx::query_as::<_, Route>(
            r#"
            INSERT INTO routes (
                id, user_id, crew_id, depot_id, date, status,
                total_distance_km, total_duration_minutes,
                optimization_score,
                arrival_buffer_percent, arrival_buffer_fixed_minutes,
                return_to_depot_distance_km, return_to_depot_duration_minutes,
                created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6::route_status, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
            RETURNING
                id, user_id, crew_id, depot_id, date, status,
                total_distance_km, total_duration_minutes,
                optimization_score,
                arrival_buffer_percent, arrival_buffer_fixed_minutes,
                return_to_depot_distance_km, return_to_depot_duration_minutes,
                created_at, updated_at
            "#
        )
        .bind(Uuid::new_v4())
        .bind(user_id)
        .bind(crew_id)
        .bind(depot_id)
        .bind(date)
        .bind(status)
        .bind(total_distance_km)
        .bind(total_duration_minutes)
        .bind(optimization_score)
        .bind(arrival_buffer_percent)
        .bind(arrival_buffer_fixed_minutes)
        .bind(return_to_depot_distance_km)
        .bind(return_to_depot_duration_minutes)
        .fetch_one(pool).await?
    };

    Ok(route)
}

/// Delete all stops for a route
pub async fn delete_route_stops(pool: &PgPool, route_id: Uuid) -> Result<()> {
    sqlx::query("DELETE FROM route_stops WHERE route_id = $1")
        .bind(route_id).execute(pool).await?;
    Ok(())
}

/// Insert a route stop (supports both customer and break stops)
pub async fn insert_route_stop(
    pool: &PgPool,
    route_id: Uuid,
    customer_id: Option<Uuid>,
    visit_id: Option<Uuid>,
    revision_id: Option<Uuid>,
    stop_order: i32,
    estimated_arrival: Option<NaiveTime>,
    estimated_departure: Option<NaiveTime>,
    distance_from_previous_km: Option<f64>,
    duration_from_previous_minutes: Option<i32>,
    stop_type: String,
    break_duration_minutes: Option<i32>,
    break_time_start: Option<NaiveTime>,
    status: Option<&str>,
    service_duration_minutes: Option<i32>,
) -> Result<SavedRouteStop> {
    let stop = sqlx::query_as::<_, SavedRouteStop>(
        r#"
        INSERT INTO route_stops (
            id, route_id, customer_id, visit_id, revision_id,
            stop_order, estimated_arrival, estimated_departure,
            distance_from_previous_km, duration_from_previous_minutes,
            status, stop_type, break_duration_minutes, break_time_start,
            service_duration_minutes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($14, 'pending'), $11, $12, $13, $15)
        RETURNING
            id, route_id, customer_id, visit_id, revision_id,
            stop_order, estimated_arrival, estimated_departure,
            distance_from_previous_km, duration_from_previous_minutes,
            status, stop_type, break_duration_minutes, break_time_start,
            service_duration_minutes
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
    .bind(stop_type)
    .bind(break_duration_minutes)
    .bind(break_time_start)
    .bind(status)
    .bind(service_duration_minutes)
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
    pub customer_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub stop_order: i32,
    pub estimated_arrival: Option<NaiveTime>,
    pub estimated_departure: Option<NaiveTime>,
    pub distance_from_previous_km: Option<f64>,
    pub duration_from_previous_minutes: Option<i32>,
    pub status: String,
    pub stop_type: String,
    pub customer_name: Option<String>,
    pub address: Option<String>,
    pub customer_lat: Option<f64>,
    pub customer_lng: Option<f64>,
    pub customer_phone: Option<String>,
    pub customer_email: Option<String>,
    pub scheduled_date: Option<NaiveDate>,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    pub revision_status: Option<String>,
    pub break_duration_minutes: Option<i32>,
    pub break_time_start: Option<NaiveTime>,
    pub service_duration_minutes: Option<i32>,
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
            rs.status, rs.stop_type,
            c.name as customer_name,
            CONCAT(COALESCE(c.street, ''), ', ', COALESCE(c.city, '')) as address,
            c.lat as customer_lat,
            c.lng as customer_lng,
            c.phone as customer_phone,
            c.email as customer_email,
            rev.scheduled_date,
            rev.scheduled_time_start,
            rev.scheduled_time_end,
            rev.status::text as revision_status,
            rs.break_duration_minutes,
            rs.break_time_start,
            rs.service_duration_minutes
        FROM route_stops rs
        LEFT JOIN customers c ON rs.customer_id = c.id
        LEFT JOIN revisions rev ON rs.revision_id = rev.id
        WHERE rs.route_id = $1
        ORDER BY rs.stop_order ASC
        "#
    )
    .bind(route_id)
    .fetch_all(pool)
    .await?;
    
    Ok(stops)
}

/// List routes with optional filters (date range, crew, depot)
pub async fn list_routes(
    pool: &PgPool,
    user_id: Uuid,
    date_from: NaiveDate,
    date_to: NaiveDate,
    crew_id: Option<Uuid>,
    depot_id: Option<Uuid>,
) -> Result<Vec<RouteWithCrewInfo>> {
    let routes = sqlx::query_as::<_, RouteWithCrewInfo>(
        r#"
        SELECT
            r.id,
            r.user_id,
            r.crew_id,
            c.name as crew_name,
            r.depot_id,
            r.date,
            r.status::text as status,
            r.total_distance_km,
            r.total_duration_minutes,
            r.optimization_score,
            r.arrival_buffer_percent,
            r.arrival_buffer_fixed_minutes,
            r.return_to_depot_distance_km,
            r.return_to_depot_duration_minutes,
            COUNT(rs.id) FILTER (WHERE rs.stop_type = 'customer') as stops_count,
            r.created_at,
            r.updated_at
        FROM routes r
        LEFT JOIN crews c ON c.id = r.crew_id
        LEFT JOIN route_stops rs ON rs.route_id = r.id
        WHERE r.user_id = $1
          AND r.date >= $2
          AND r.date <= $3
          AND ($4::uuid IS NULL OR r.crew_id = $4)
          AND ($5::uuid IS NULL OR c.home_depot_id = $5)
        GROUP BY r.id, c.name, r.depot_id
        ORDER BY r.date ASC, c.name NULLS LAST
        "#
    )
    .bind(user_id)
    .bind(date_from)
    .bind(date_to)
    .bind(crew_id)
    .bind(depot_id)
    .fetch_all(pool)
    .await?;

    Ok(routes)
}

/// Update a route's crew_id, depot_id, or status
pub async fn update_route(
    pool: &PgPool,
    route_id: Uuid,
    user_id: Uuid,
    crew_id: Option<Option<Uuid>>,
    depot_id: Option<Option<Uuid>>,
    status: Option<&str>,
) -> Result<bool> {
    // Build dynamic UPDATE query
    let mut set_clauses = Vec::new();
    let mut param_index = 3u32; // $1 = route_id, $2 = user_id

    if crew_id.is_some() {
        set_clauses.push(format!("crew_id = ${}", param_index));
        param_index += 1;
    }
    if depot_id.is_some() {
        set_clauses.push(format!("depot_id = ${}", param_index));
        param_index += 1;
    }
    if status.is_some() {
        set_clauses.push(format!("status = ${}", param_index));
        // param_index += 1; // not needed after last
    }

    if set_clauses.is_empty() {
        return Ok(false);
    }

    set_clauses.push("updated_at = NOW()".to_string());

    let sql = format!(
        "UPDATE routes SET {} WHERE id = $1 AND user_id = $2",
        set_clauses.join(", ")
    );

    let mut query = sqlx::query(&sql)
        .bind(route_id)
        .bind(user_id);

    if let Some(cid) = crew_id {
        query = query.bind(cid);
    }
    if let Some(did) = depot_id {
        query = query.bind(did);
    }
    if let Some(s) = status {
        query = query.bind(s);
    }

    let result = query.execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

/// Delete a route and all its stops (by user_id + date)
pub async fn delete_route(pool: &PgPool, user_id: Uuid, date: NaiveDate) -> Result<bool> {
    let result = sqlx::query("DELETE FROM routes WHERE user_id = $1 AND date = $2")
        .bind(user_id).bind(date).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

/// Delete a route by route ID (checks user ownership)
pub async fn delete_route_by_id(pool: &PgPool, route_id: Uuid, user_id: Uuid) -> Result<bool> {
    // First delete stops (FK cascade might handle this, but be explicit)
    let _ = sqlx::query("DELETE FROM route_stops WHERE route_id = $1")
        .bind(route_id).execute(pool).await?;
    let result = sqlx::query("DELETE FROM routes WHERE id = $1 AND user_id = $2")
        .bind(route_id).bind(user_id).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}
