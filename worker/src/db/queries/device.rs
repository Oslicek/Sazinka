//! Device database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;

use crate::types::device::{Device, CreateDeviceRequest, UpdateDeviceRequest};

/// Create a new device
pub async fn create_device(
    pool: &PgPool,
    customer_id: Uuid,
    req: &CreateDeviceRequest,
) -> Result<Device> {
    let device = sqlx::query_as::<_, Device>(
        r#"
        INSERT INTO devices (
            id, customer_id, device_type, manufacturer, model,
            serial_number, installation_date, revision_interval_months,
            notes, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING
            id, customer_id, device_type, manufacturer, model,
            serial_number, installation_date, revision_interval_months,
            notes, created_at
        "#
    )
    .bind(Uuid::new_v4())
    .bind(customer_id)
    .bind(&req.device_type)
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
            id, customer_id, device_type, manufacturer, model,
            serial_number, installation_date, revision_interval_months,
            notes, created_at
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
            id, customer_id, device_type, manufacturer, model,
            serial_number, installation_date, revision_interval_months,
            notes, created_at
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
            device_type = COALESCE($3, device_type),
            manufacturer = COALESCE($4, manufacturer),
            model = COALESCE($5, model),
            serial_number = COALESCE($6, serial_number),
            installation_date = COALESCE($7, installation_date),
            revision_interval_months = COALESCE($8, revision_interval_months),
            notes = COALESCE($9, notes)
        WHERE id = $1 AND customer_id = $2
        RETURNING
            id, customer_id, device_type, manufacturer, model,
            serial_number, installation_date, revision_interval_months,
            notes, created_at
        "#
    )
    .bind(device_id)
    .bind(customer_id)
    .bind(&req.device_type)
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
