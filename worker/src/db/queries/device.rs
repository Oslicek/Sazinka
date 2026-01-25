//! Device database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;

use crate::types::device::{Device, CreateDeviceRequest};

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
