//! Device database queries

use sqlx::PgPool;
use uuid::Uuid;
use chrono::NaiveDate;
use anyhow::Result;

use crate::types::device::{Device, CreateDeviceRequest, UpdateDeviceRequest};

/// Create a new device
pub async fn create_device(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    req: &CreateDeviceRequest,
) -> Result<Device> {
    let device = sqlx::query_as::<_, Device>(
        r#"
        INSERT INTO devices (
            id, customer_id, user_id, device_type, device_name,
            manufacturer, model, serial_number, installation_date,
            revision_interval_months, notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4::device_type_enum, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
        RETURNING
            id, customer_id, user_id,
            device_type::text, device_name,
            manufacturer, model, serial_number,
            installation_date, revision_interval_months,
            next_due_date, notes, created_at, updated_at
        "#
    )
    .bind(Uuid::new_v4())
    .bind(customer_id)
    .bind(user_id)
    .bind(&req.device_type)
    .bind(&req.device_name)
    .bind(&req.manufacturer)
    .bind(&req.model)
    .bind(&req.serial_number)
    .bind(req.installation_date)
    .bind(req.revision_interval_months)
    .bind(&req.notes)
    .fetch_one(pool)
    .await?;

    Ok(device)
}

/// List devices for a customer
pub async fn list_devices(pool: &PgPool, customer_id: Uuid) -> Result<Vec<Device>> {
    let devices = sqlx::query_as::<_, Device>(
        r#"
        SELECT
            id, customer_id, user_id,
            device_type::text, device_name,
            manufacturer, model, serial_number,
            installation_date, revision_interval_months,
            next_due_date, notes, created_at, updated_at
        FROM devices
        WHERE customer_id = $1
        ORDER BY created_at DESC
        "#
    )
    .bind(customer_id)
    .fetch_all(pool)
    .await?;

    Ok(devices)
}

/// Get a single device by ID (with customer ownership verification)
pub async fn get_device(pool: &PgPool, device_id: Uuid, customer_id: Uuid) -> Result<Option<Device>> {
    let device = sqlx::query_as::<_, Device>(
        r#"
        SELECT
            id, customer_id, user_id,
            device_type::text, device_name,
            manufacturer, model, serial_number,
            installation_date, revision_interval_months,
            next_due_date, notes, created_at, updated_at
        FROM devices
        WHERE id = $1 AND customer_id = $2
        "#
    )
    .bind(device_id)
    .bind(customer_id)
    .fetch_optional(pool)
    .await?;

    Ok(device)
}

/// Update a device
pub async fn update_device(
    pool: &PgPool,
    device_id: Uuid,
    customer_id: Uuid,
    req: &UpdateDeviceRequest,
) -> Result<Option<Device>> {
    let device = sqlx::query_as::<_, Device>(
        r#"
        UPDATE devices SET
            device_type = COALESCE($3::device_type_enum, device_type),
            device_name = COALESCE($4, device_name),
            manufacturer = COALESCE($5, manufacturer),
            model = COALESCE($6, model),
            serial_number = COALESCE($7, serial_number),
            installation_date = COALESCE($8, installation_date),
            revision_interval_months = COALESCE($9, revision_interval_months),
            notes = COALESCE($10, notes)
        WHERE id = $1 AND customer_id = $2
        RETURNING
            id, customer_id, user_id,
            device_type::text, device_name,
            manufacturer, model, serial_number,
            installation_date, revision_interval_months,
            next_due_date, notes, created_at, updated_at
        "#
    )
    .bind(device_id)
    .bind(customer_id)
    .bind(&req.device_type)
    .bind(&req.device_name)
    .bind(&req.manufacturer)
    .bind(&req.model)
    .bind(&req.serial_number)
    .bind(req.installation_date)
    .bind(req.revision_interval_months)
    .bind(&req.notes)
    .fetch_optional(pool)
    .await?;

    Ok(device)
}

/// Update next_due_date on a device
pub async fn update_next_due_date(
    pool: &PgPool,
    device_id: Uuid,
    next_due_date: NaiveDate,
) -> Result<()> {
    sqlx::query(
        r#"UPDATE devices SET next_due_date = $2 WHERE id = $1"#
    )
    .bind(device_id)
    .bind(next_due_date)
    .execute(pool)
    .await?;

    Ok(())
}

/// Delete a device
pub async fn delete_device(pool: &PgPool, device_id: Uuid, customer_id: Uuid) -> Result<bool> {
    let result = sqlx::query(
        r#"
        DELETE FROM devices
        WHERE id = $1 AND customer_id = $2
        "#
    )
    .bind(device_id)
    .bind(customer_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}
