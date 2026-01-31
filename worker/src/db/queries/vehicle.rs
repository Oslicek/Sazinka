//! Vehicle database queries

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;
use chrono::NaiveTime;

use crate::types::vehicle::{Vehicle, CreateVehicleRequest, UpdateVehicleRequest};

/// Create a new vehicle
pub async fn create_vehicle(
    pool: &PgPool,
    user_id: Uuid,
    request: CreateVehicleRequest,
) -> Result<Vehicle> {
    let working_start = request.working_hours_start
        .unwrap_or_else(|| NaiveTime::from_hms_opt(8, 0, 0).unwrap());
    let working_end = request.working_hours_end
        .unwrap_or_else(|| NaiveTime::from_hms_opt(17, 0, 0).unwrap());

    let vehicle = sqlx::query_as::<_, Vehicle>(
        r#"
        INSERT INTO vehicles (user_id, name, home_depot_id, preferred_areas, working_hours_start, working_hours_end)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id, name, home_depot_id, preferred_areas, 
                  working_hours_start, working_hours_end, is_active, created_at, updated_at
        "#
    )
    .bind(user_id)
    .bind(&request.name)
    .bind(request.home_depot_id)
    .bind(&request.preferred_areas)
    .bind(working_start)
    .bind(working_end)
    .fetch_one(pool)
    .await?;

    Ok(vehicle)
}

/// List vehicles for a user
pub async fn list_vehicles(
    pool: &PgPool,
    user_id: Uuid,
    active_only: bool,
) -> Result<Vec<Vehicle>> {
    let vehicles = if active_only {
        sqlx::query_as::<_, Vehicle>(
            r#"
            SELECT id, user_id, name, home_depot_id, preferred_areas,
                   working_hours_start, working_hours_end, is_active, created_at, updated_at
            FROM vehicles
            WHERE user_id = $1 AND is_active = true
            ORDER BY name ASC
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, Vehicle>(
            r#"
            SELECT id, user_id, name, home_depot_id, preferred_areas,
                   working_hours_start, working_hours_end, is_active, created_at, updated_at
            FROM vehicles
            WHERE user_id = $1
            ORDER BY name ASC
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    };

    Ok(vehicles)
}

/// Get a single vehicle by ID
pub async fn get_vehicle(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<Vehicle>> {
    let vehicle = sqlx::query_as::<_, Vehicle>(
        r#"
        SELECT id, user_id, name, home_depot_id, preferred_areas,
               working_hours_start, working_hours_end, is_active, created_at, updated_at
        FROM vehicles
        WHERE id = $1 AND user_id = $2
        "#
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(vehicle)
}

/// Update a vehicle
pub async fn update_vehicle(
    pool: &PgPool,
    user_id: Uuid,
    request: UpdateVehicleRequest,
) -> Result<Option<Vehicle>> {
    // First check if vehicle exists and belongs to user
    let existing = get_vehicle(pool, request.id, user_id).await?;
    if existing.is_none() {
        return Ok(None);
    }
    let existing = existing.unwrap();

    let name = request.name.unwrap_or(existing.name);
    let home_depot_id = request.home_depot_id.or(existing.home_depot_id);
    let preferred_areas = request.preferred_areas.unwrap_or(existing.preferred_areas);
    let working_start = request.working_hours_start.unwrap_or(existing.working_hours_start);
    let working_end = request.working_hours_end.unwrap_or(existing.working_hours_end);
    let is_active = request.is_active.unwrap_or(existing.is_active);

    let vehicle = sqlx::query_as::<_, Vehicle>(
        r#"
        UPDATE vehicles
        SET name = $1, home_depot_id = $2, preferred_areas = $3,
            working_hours_start = $4, working_hours_end = $5, is_active = $6,
            updated_at = NOW()
        WHERE id = $7 AND user_id = $8
        RETURNING id, user_id, name, home_depot_id, preferred_areas,
                  working_hours_start, working_hours_end, is_active, created_at, updated_at
        "#
    )
    .bind(&name)
    .bind(home_depot_id)
    .bind(&preferred_areas)
    .bind(working_start)
    .bind(working_end)
    .bind(is_active)
    .bind(request.id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(vehicle)
}

/// Delete a vehicle (soft delete - sets is_active = false)
pub async fn delete_vehicle(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE vehicles
        SET is_active = false, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        "#
    )
    .bind(id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Count vehicles for a user
pub async fn count_vehicles(pool: &PgPool, user_id: Uuid, active_only: bool) -> Result<i64> {
    let count: (i64,) = if active_only {
        sqlx::query_as(
            "SELECT COUNT(*) FROM vehicles WHERE user_id = $1 AND is_active = true"
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT COUNT(*) FROM vehicles WHERE user_id = $1"
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?
    };

    Ok(count.0)
}
