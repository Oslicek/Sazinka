#![allow(dead_code)]
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
    let config_id: Uuid = sqlx::query_scalar(
        r#"SELECT dtc.id FROM device_type_configs dtc
           JOIN user_tenants ut ON ut.tenant_id = dtc.tenant_id
           WHERE ut.user_id = $1 AND dtc.device_type_key = $2
           LIMIT 1"#
    )
    .bind(user_id)
    .bind(&req.device_type)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!(
        "No device_type_config found for type '{}' — ensure tenant has been set up",
        req.device_type
    ))?;

    let device = sqlx::query_as::<_, Device>(
        r#"
        INSERT INTO devices (
            id, customer_id, user_id, device_type, device_type_config_id, device_name,
            manufacturer, model, serial_number, installation_date,
            revision_interval_months, notes, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4::device_type_enum, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
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
    .bind(config_id)
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

/// List devices for a customer (with user ownership verification)
pub async fn list_devices(pool: &PgPool, user_id: Uuid, customer_id: Uuid) -> Result<Vec<Device>> {
    let devices = sqlx::query_as::<_, Device>(
        r#"
        SELECT
            d.id, d.customer_id, d.user_id,
            d.device_type::text, d.device_name,
            d.manufacturer, d.model, d.serial_number,
            d.installation_date, d.revision_interval_months,
            d.next_due_date, d.notes, d.created_at, d.updated_at
        FROM devices d
        WHERE d.customer_id = $1
          AND d.user_id = $2
        ORDER BY d.created_at DESC
        "#
    )
    .bind(customer_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(devices)
}

/// Get a single device by ID (with customer and user ownership verification)
pub async fn get_device(pool: &PgPool, user_id: Uuid, device_id: Uuid, customer_id: Uuid) -> Result<Option<Device>> {
    let device = sqlx::query_as::<_, Device>(
        r#"
        SELECT
            id, customer_id, user_id,
            device_type::text, device_name,
            manufacturer, model, serial_number,
            installation_date, revision_interval_months,
            next_due_date, notes, created_at, updated_at
        FROM devices
        WHERE id = $1 AND customer_id = $2 AND user_id = $3
        "#
    )
    .bind(device_id)
    .bind(customer_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(device)
}

/// Update a device (with user ownership verification)
pub async fn update_device(
    pool: &PgPool,
    user_id: Uuid,
    device_id: Uuid,
    customer_id: Uuid,
    req: &UpdateDeviceRequest,
) -> Result<Option<Device>> {
    let device = sqlx::query_as::<_, Device>(
        r#"
        UPDATE devices SET
            device_type = COALESCE($4::device_type_enum, device_type),
            device_name = COALESCE($5, device_name),
            manufacturer = COALESCE($6, manufacturer),
            model = COALESCE($7, model),
            serial_number = COALESCE($8, serial_number),
            installation_date = COALESCE($9, installation_date),
            revision_interval_months = COALESCE($10, revision_interval_months),
            notes = COALESCE($11, notes)
        WHERE id = $1 AND customer_id = $2 AND user_id = $3
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
    .bind(user_id)
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

/// Delete a device (with user ownership verification)
pub async fn delete_device(pool: &PgPool, user_id: Uuid, device_id: Uuid, customer_id: Uuid) -> Result<bool> {
    let result = sqlx::query(
        r#"
        DELETE FROM devices
        WHERE id = $1 AND customer_id = $2 AND user_id = $3
        "#
    )
    .bind(device_id)
    .bind(customer_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}
