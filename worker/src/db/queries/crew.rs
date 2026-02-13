//! Crew database queries

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;
use chrono::NaiveTime;

use crate::types::crew::{Crew, CreateCrewRequest, UpdateCrewRequest};

/// Create a new crew
pub async fn create_crew(
    pool: &PgPool,
    user_id: Uuid,
    request: CreateCrewRequest,
) -> Result<Crew> {
    let working_start = request.working_hours_start
        .unwrap_or_else(|| NaiveTime::from_hms_opt(8, 0, 0).unwrap());
    let working_end = request.working_hours_end
        .unwrap_or_else(|| NaiveTime::from_hms_opt(17, 0, 0).unwrap());

    let buffer_percent = request.arrival_buffer_percent.unwrap_or(10.0);
    let buffer_fixed = request.arrival_buffer_fixed_minutes.unwrap_or(0.0);

    let crew = sqlx::query_as::<_, Crew>(
        r#"
        INSERT INTO crews (user_id, name, home_depot_id, preferred_areas, working_hours_start, working_hours_end, arrival_buffer_percent, arrival_buffer_fixed_minutes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, user_id, name, home_depot_id, preferred_areas, 
                  working_hours_start, working_hours_end, is_active, arrival_buffer_percent, arrival_buffer_fixed_minutes, created_at, updated_at
        "#
    )
    .bind(user_id)
    .bind(&request.name)
    .bind(request.home_depot_id)
    .bind(&request.preferred_areas)
    .bind(working_start)
    .bind(working_end)
    .bind(buffer_percent)
    .bind(buffer_fixed)
    .fetch_one(pool)
    .await?;

    Ok(crew)
}

/// List crews for a user
pub async fn list_crews(
    pool: &PgPool,
    user_id: Uuid,
    active_only: bool,
) -> Result<Vec<Crew>> {
    let crews = if active_only {
        sqlx::query_as::<_, Crew>(
            r#"
            SELECT id, user_id, name, home_depot_id, preferred_areas,
                   working_hours_start, working_hours_end, is_active, arrival_buffer_percent, arrival_buffer_fixed_minutes, created_at, updated_at
            FROM crews
            WHERE user_id = $1 AND is_active = true
            ORDER BY name ASC
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, Crew>(
            r#"
            SELECT id, user_id, name, home_depot_id, preferred_areas,
                   working_hours_start, working_hours_end, is_active, arrival_buffer_percent, arrival_buffer_fixed_minutes, created_at, updated_at
            FROM crews
            WHERE user_id = $1
            ORDER BY name ASC
            "#
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    };

    Ok(crews)
}

/// Get a single crew by ID
pub async fn get_crew(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<Crew>> {
    let crew = sqlx::query_as::<_, Crew>(
        r#"
        SELECT id, user_id, name, home_depot_id, preferred_areas,
               working_hours_start, working_hours_end, is_active, arrival_buffer_percent, arrival_buffer_fixed_minutes, created_at, updated_at
        FROM crews
        WHERE id = $1 AND user_id = $2
        "#
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(crew)
}

/// Update a crew
pub async fn update_crew(
    pool: &PgPool,
    user_id: Uuid,
    request: UpdateCrewRequest,
) -> Result<Option<Crew>> {
    // First check if crew exists and belongs to user
    let existing = get_crew(pool, request.id, user_id).await?;
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
    let buffer_percent = request.arrival_buffer_percent.unwrap_or(existing.arrival_buffer_percent);
    let buffer_fixed = request.arrival_buffer_fixed_minutes.unwrap_or(existing.arrival_buffer_fixed_minutes);

    let crew = sqlx::query_as::<_, Crew>(
        r#"
        UPDATE crews
        SET name = $1, home_depot_id = $2, preferred_areas = $3,
            working_hours_start = $4, working_hours_end = $5, is_active = $6,
            arrival_buffer_percent = $7, arrival_buffer_fixed_minutes = $8,
            updated_at = NOW()
        WHERE id = $9 AND user_id = $10
        RETURNING id, user_id, name, home_depot_id, preferred_areas,
                  working_hours_start, working_hours_end, is_active, arrival_buffer_percent, arrival_buffer_fixed_minutes, created_at, updated_at
        "#
    )
    .bind(&name)
    .bind(home_depot_id)
    .bind(&preferred_areas)
    .bind(working_start)
    .bind(working_end)
    .bind(is_active)
    .bind(buffer_percent)
    .bind(buffer_fixed)
    .bind(request.id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(crew)
}

/// Delete a crew (soft delete - sets is_active = false)
pub async fn delete_crew(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE crews
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

/// Count crews for a user
pub async fn count_crews(pool: &PgPool, user_id: Uuid, active_only: bool) -> Result<i64> {
    let count: (i64,) = if active_only {
        sqlx::query_as(
            "SELECT COUNT(*) FROM crews WHERE user_id = $1 AND is_active = true"
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT COUNT(*) FROM crews WHERE user_id = $1"
        )
        .bind(user_id)
        .fetch_one(pool)
        .await?
    };

    Ok(count.0)
}
