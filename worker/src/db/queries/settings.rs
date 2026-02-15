//! Settings database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;
use chrono::NaiveTime;

use crate::types::settings::{
    Depot, CreateDepotRequest, UpdateDepotRequest,
    UserWithSettings, UpdateWorkConstraintsRequest,
    UpdateBusinessInfoRequest, UpdateEmailTemplatesRequest,
    UpdatePreferencesRequest, UpdateBreakSettingsRequest,
};

// ============================================================================
// User Settings Queries
// ============================================================================

/// Get user with all settings fields
pub async fn get_user_settings(pool: &PgPool, user_id: Uuid) -> Result<Option<UserWithSettings>> {
    let user = sqlx::query_as::<_, UserWithSettings>(
        r#"
        SELECT
            id, email, password_hash, name, phone,
            business_name, street, city, postal_code, country,
            lat, lng,
            default_revision_interval_months,
            working_hours_start, working_hours_end,
            max_revisions_per_day,
            default_service_duration_minutes,
            reminder_days_before,
            ico, dic,
            email_subject_template, email_body_template,
            email_confirmation_subject_template, email_confirmation_body_template,
            email_reminder_subject_template, email_reminder_body_template,
            email_reminder_send_time,
            email_third_subject_template, email_third_body_template,
            default_crew_id, default_depot_id,
            break_enabled, break_duration_minutes,
            break_earliest_time, break_latest_time,
            break_min_km, break_max_km,
            locale, company_locale,
            created_at, updated_at
        FROM users
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

/// Update work constraints
pub async fn update_work_constraints(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateWorkConstraintsRequest,
) -> Result<()> {
    // Parse time strings if provided
    let start_time = req.working_hours_start.as_ref()
        .map(|s| NaiveTime::parse_from_str(s, "%H:%M"))
        .transpose()?;
    
    let end_time = req.working_hours_end.as_ref()
        .map(|s| NaiveTime::parse_from_str(s, "%H:%M"))
        .transpose()?;

    sqlx::query(
        r#"
        UPDATE users SET
            working_hours_start = COALESCE($2, working_hours_start),
            working_hours_end = COALESCE($3, working_hours_end),
            max_revisions_per_day = COALESCE($4, max_revisions_per_day),
            default_service_duration_minutes = COALESCE($5, default_service_duration_minutes),
            default_revision_interval_months = COALESCE($6, default_revision_interval_months),
            reminder_days_before = COALESCE($7, reminder_days_before)
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .bind(start_time)
    .bind(end_time)
    .bind(req.max_revisions_per_day)
    .bind(req.default_service_duration_minutes)
    .bind(req.default_revision_interval_months)
    .bind(&req.reminder_days_before)
    .execute(pool)
    .await?;

    Ok(())
}

/// Update business info
pub async fn update_business_info(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateBusinessInfoRequest,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE users SET
            name = COALESCE($2, name),
            phone = COALESCE($3, phone),
            business_name = COALESCE($4, business_name),
            ico = COALESCE($5, ico),
            dic = COALESCE($6, dic),
            street = COALESCE($7, street),
            city = COALESCE($8, city),
            postal_code = COALESCE($9, postal_code),
            country = COALESCE($10, country),
            company_locale = COALESCE($11, company_locale)
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.phone)
    .bind(&req.business_name)
    .bind(&req.ico)
    .bind(&req.dic)
    .bind(&req.street)
    .bind(&req.city)
    .bind(&req.postal_code)
    .bind(&req.country)
    .bind(&req.company_locale)
    .execute(pool)
    .await?;

    Ok(())
}

/// Update email templates
pub async fn update_email_templates(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateEmailTemplatesRequest,
) -> Result<()> {
    let reminder_send_time = req.reminder_send_time.as_ref()
        .map(|s| NaiveTime::parse_from_str(s, "%H:%M"))
        .transpose()?;

    sqlx::query(
        r#"
        UPDATE users SET
            email_confirmation_subject_template = COALESCE($2, email_confirmation_subject_template),
            email_confirmation_body_template = COALESCE($3, email_confirmation_body_template),
            email_reminder_subject_template = COALESCE($4, email_reminder_subject_template),
            email_reminder_body_template = COALESCE($5, email_reminder_body_template),
            email_reminder_send_time = COALESCE($6, email_reminder_send_time),
            email_third_subject_template = COALESCE($7, email_third_subject_template),
            email_third_body_template = COALESCE($8, email_third_body_template),
            -- Backward compatibility: keep legacy columns in sync with reminder template.
            email_subject_template = COALESCE($4, email_subject_template),
            email_body_template = COALESCE($5, email_body_template)
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .bind(&req.confirmation_subject_template)
    .bind(&req.confirmation_body_template)
    .bind(&req.reminder_subject_template)
    .bind(&req.reminder_body_template)
    .bind(reminder_send_time)
    .bind(&req.third_subject_template)
    .bind(&req.third_body_template)
    .execute(pool)
    .await?;

    Ok(())
}

/// Update user preferences
pub async fn update_preferences(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdatePreferencesRequest,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE users SET
            default_crew_id = $2,
            default_depot_id = $3,
            locale = $4
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .bind(req.default_crew_id)
    .bind(req.default_depot_id)
    .bind(&req.locale)
    .execute(pool)
    .await?;

    Ok(())
}

/// Update break settings
pub async fn update_break_settings(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateBreakSettingsRequest,
) -> Result<()> {
    // Parse time strings if provided
    let earliest_time = req.break_earliest_time.as_ref()
        .map(|s| NaiveTime::parse_from_str(s, "%H:%M"))
        .transpose()?;
    
    let latest_time = req.break_latest_time.as_ref()
        .map(|s| NaiveTime::parse_from_str(s, "%H:%M"))
        .transpose()?;

    sqlx::query(
        r#"
        UPDATE users SET
            break_enabled = COALESCE($2, break_enabled),
            break_duration_minutes = COALESCE($3, break_duration_minutes),
            break_earliest_time = COALESCE($4, break_earliest_time),
            break_latest_time = COALESCE($5, break_latest_time),
            break_min_km = COALESCE($6, break_min_km),
            break_max_km = COALESCE($7, break_max_km)
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .bind(req.break_enabled)
    .bind(req.break_duration_minutes)
    .bind(earliest_time)
    .bind(latest_time)
    .bind(req.break_min_km)
    .bind(req.break_max_km)
    .execute(pool)
    .await?;

    Ok(())
}

// ============================================================================
// Depot Queries
// ============================================================================

/// List all depots for a user
pub async fn list_depots(pool: &PgPool, user_id: Uuid) -> Result<Vec<Depot>> {
    let depots = sqlx::query_as::<_, Depot>(
        r#"
        SELECT
            id, user_id, name,
            street, city, postal_code, country,
            lat, lng, is_primary,
            created_at, updated_at
        FROM depots
        WHERE user_id = $1
        ORDER BY is_primary DESC, name ASC
        "#
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(depots)
}

/// Get a single depot
pub async fn get_depot(pool: &PgPool, depot_id: Uuid, user_id: Uuid) -> Result<Option<Depot>> {
    let depot = sqlx::query_as::<_, Depot>(
        r#"
        SELECT
            id, user_id, name,
            street, city, postal_code, country,
            lat, lng, is_primary,
            created_at, updated_at
        FROM depots
        WHERE id = $1 AND user_id = $2
        "#
    )
    .bind(depot_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(depot)
}

/// Create a new depot
pub async fn create_depot(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreateDepotRequest,
) -> Result<Depot> {
    let is_primary = req.is_primary.unwrap_or(false);
    
    // If this is primary, unset any existing primary
    if is_primary {
        sqlx::query("UPDATE depots SET is_primary = false WHERE user_id = $1")
            .bind(user_id)
            .execute(pool)
            .await?;
    }

    let depot = sqlx::query_as::<_, Depot>(
        r#"
        INSERT INTO depots (
            user_id, name, street, city, postal_code, country,
            lat, lng, is_primary
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING
            id, user_id, name,
            street, city, postal_code, country,
            lat, lng, is_primary,
            created_at, updated_at
        "#
    )
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.street)
    .bind(&req.city)
    .bind(&req.postal_code)
    .bind(req.country.as_deref().unwrap_or("CZ"))
    .bind(req.lat)
    .bind(req.lng)
    .bind(is_primary)
    .fetch_one(pool)
    .await?;

    Ok(depot)
}

/// Update a depot
pub async fn update_depot(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateDepotRequest,
) -> Result<Option<Depot>> {
    // If setting as primary, unset any existing primary first
    if req.is_primary == Some(true) {
        sqlx::query("UPDATE depots SET is_primary = false WHERE user_id = $1 AND id != $2")
            .bind(user_id)
            .bind(req.id)
            .execute(pool)
            .await?;
    }

    let depot = sqlx::query_as::<_, Depot>(
        r#"
        UPDATE depots SET
            name = COALESCE($3, name),
            street = COALESCE($4, street),
            city = COALESCE($5, city),
            postal_code = COALESCE($6, postal_code),
            country = COALESCE($7, country),
            lat = COALESCE($8, lat),
            lng = COALESCE($9, lng),
            is_primary = COALESCE($10, is_primary)
        WHERE id = $1 AND user_id = $2
        RETURNING
            id, user_id, name,
            street, city, postal_code, country,
            lat, lng, is_primary,
            created_at, updated_at
        "#
    )
    .bind(req.id)
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.street)
    .bind(&req.city)
    .bind(&req.postal_code)
    .bind(&req.country)
    .bind(req.lat)
    .bind(req.lng)
    .bind(req.is_primary)
    .fetch_optional(pool)
    .await?;

    Ok(depot)
}

/// Delete a depot
pub async fn delete_depot(pool: &PgPool, depot_id: Uuid, user_id: Uuid) -> Result<bool> {
    let result = sqlx::query("DELETE FROM depots WHERE id = $1 AND user_id = $2")
        .bind(depot_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

/// Get primary depot for a user
pub async fn get_primary_depot(pool: &PgPool, user_id: Uuid) -> Result<Option<Depot>> {
    let depot = sqlx::query_as::<_, Depot>(
        r#"
        SELECT
            id, user_id, name,
            street, city, postal_code, country,
            lat, lng, is_primary,
            created_at, updated_at
        FROM depots
        WHERE user_id = $1 AND is_primary = true
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(depot)
}
