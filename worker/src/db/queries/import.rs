//! Import-related database queries

use anyhow::Result;
use chrono::{NaiveDate, NaiveTime};
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::{
    DeviceType, RevisionStatus, RevisionResult,
    CommunicationType, CommunicationDirection,
    VisitStatus,
};
use crate::types::work_item::{WorkType, WorkResult};

// Helper functions to convert enums to database strings

fn visit_status_to_str(status: VisitStatus) -> &'static str {
    match status {
        VisitStatus::Planned => "planned",
        VisitStatus::InProgress => "in_progress",
        VisitStatus::Completed => "completed",
        VisitStatus::Cancelled => "cancelled",
        VisitStatus::Rescheduled => "rescheduled",
    }
}

fn comm_type_to_str(ctype: CommunicationType) -> &'static str {
    match ctype {
        CommunicationType::Call => "call",
        CommunicationType::EmailSent => "email_sent",
        CommunicationType::EmailReceived => "email_received",
        CommunicationType::Note => "note",
        CommunicationType::Sms => "sms",
    }
}

fn comm_direction_to_str(dir: CommunicationDirection) -> &'static str {
    match dir {
        CommunicationDirection::Outbound => "outbound",
        CommunicationDirection::Inbound => "inbound",
    }
}

fn device_type_to_str(dtype: DeviceType) -> &'static str {
    match dtype {
        DeviceType::GasBoiler => "gas_boiler",
        DeviceType::GasWaterHeater => "gas_water_heater",
        DeviceType::Chimney => "chimney",
        DeviceType::Fireplace => "fireplace",
        DeviceType::GasStove => "gas_stove",
        DeviceType::Other => "other",
    }
}

fn revision_status_to_str(status: RevisionStatus) -> &'static str {
    status.as_str()
}

fn revision_result_to_str(result: RevisionResult) -> &'static str {
    match result {
        RevisionResult::Passed => "passed",
        RevisionResult::Failed => "failed",
        RevisionResult::Conditional => "conditional",
    }
}

// =============================================================================
// CUSTOMER LOOKUP
// =============================================================================

/// Find customer by ICO
pub async fn find_customer_by_ico(pool: &PgPool, user_id: Uuid, ico: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM customers WHERE user_id = $1 AND ico = $2"#,
        user_id, ico
    ).fetch_optional(pool).await?;
    Ok(result)
}

/// Find customer by email
pub async fn find_customer_by_email(pool: &PgPool, user_id: Uuid, email: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM customers WHERE user_id = $1 AND LOWER(email) = LOWER($2)"#,
        user_id, email
    ).fetch_optional(pool).await?;
    Ok(result)
}

/// Find customer by phone
pub async fn find_customer_by_phone(pool: &PgPool, user_id: Uuid, phone: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM customers WHERE user_id = $1 AND phone = $2"#,
        user_id, phone
    ).fetch_optional(pool).await?;
    Ok(result)
}

// =============================================================================
// DEVICE OPERATIONS
// =============================================================================

/// Find device by serial number for a customer
pub async fn find_device_by_serial(pool: &PgPool, customer_id: Uuid, serial_number: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM devices WHERE customer_id = $1 AND serial_number = $2"#,
        customer_id, serial_number
    ).fetch_optional(pool).await?;
    Ok(result)
}

/// Find device by device_name (case-insensitive) for a customer
pub async fn find_device_by_name(pool: &PgPool, customer_id: Uuid, device_name: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM devices WHERE customer_id = $1 AND device_name ILIKE $2"#,
        customer_id, device_name
    ).fetch_optional(pool).await?;
    Ok(result)
}

/// Find device by device_type for a customer (only if exactly one device of that type exists)
pub async fn find_device_by_type_single(pool: &PgPool, customer_id: Uuid, device_type: &str) -> Result<Option<Uuid>> {
    let result: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT id FROM devices WHERE customer_id = $1 AND device_type::text = $2"#,
    )
    .bind(customer_id)
    .bind(device_type)
    .fetch_all(pool).await?;
    
    if result.len() == 1 {
        Ok(Some(result[0]))
    } else {
        Ok(None) // 0 or >1 matches -> ambiguous
    }
}

/// Create a new device from import (with device_name and user_id)
pub async fn create_device_import(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    device_type: DeviceType,
    device_name: Option<&str>,
    manufacturer: Option<&str>,
    model: Option<&str>,
    serial_number: Option<&str>,
    installation_date: Option<NaiveDate>,
    revision_interval_months: i32,
    notes: Option<&str>,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    
    sqlx::query(
        r#"
        INSERT INTO devices (id, customer_id, user_id, device_type, device_name,
            manufacturer, model, serial_number, installation_date,
            revision_interval_months, notes, created_at, updated_at)
        VALUES ($1, $2, $3, $4::device_type_enum, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
        "#,
    )
    .bind(id)
    .bind(customer_id)
    .bind(user_id)
    .bind(device_type_to_str(device_type))
    .bind(device_name)
    .bind(manufacturer)
    .bind(model)
    .bind(serial_number)
    .bind(installation_date)
    .bind(revision_interval_months)
    .bind(notes)
    .execute(pool)
    .await?;
    
    Ok(id)
}

/// Update device from import
pub async fn update_device_import(
    pool: &PgPool,
    device_id: Uuid,
    device_type: DeviceType,
    device_name: Option<&str>,
    manufacturer: Option<&str>,
    model: Option<&str>,
    installation_date: Option<NaiveDate>,
    revision_interval_months: i32,
    notes: Option<&str>,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE devices 
        SET device_type = $2::device_type_enum,
            device_name = COALESCE($3, device_name),
            manufacturer = COALESCE($4, manufacturer),
            model = COALESCE($5, model),
            installation_date = COALESCE($6, installation_date),
            revision_interval_months = $7,
            notes = COALESCE($8, notes)
        WHERE id = $1
        "#,
    )
    .bind(device_id)
    .bind(device_type_to_str(device_type))
    .bind(device_name)
    .bind(manufacturer)
    .bind(model)
    .bind(installation_date)
    .bind(revision_interval_months)
    .bind(notes)
    .execute(pool)
    .await?;
    
    Ok(())
}

/// Count devices of a specific type for a customer
pub async fn count_devices_for_customer(pool: &PgPool, customer_id: Uuid) -> Result<i64> {
    let count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM devices WHERE customer_id = $1"
    ).bind(customer_id).fetch_one(pool).await?;
    Ok(count.0)
}

// =============================================================================
// REVISION OPERATIONS
// =============================================================================

/// Find revision by device and due date
pub async fn find_revision_by_device_and_date(pool: &PgPool, device_id: Uuid, due_date: NaiveDate) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM revisions WHERE device_id = $1 AND due_date = $2"#,
        device_id, due_date
    ).fetch_optional(pool).await?;
    Ok(result)
}

/// Create a new revision from import
pub async fn create_revision_import(
    pool: &PgPool,
    device_id: Uuid,
    customer_id: Uuid,
    user_id: Uuid,
    due_date: NaiveDate,
    status: RevisionStatus,
    scheduled_date: Option<NaiveDate>,
    scheduled_time_start: Option<NaiveTime>,
    scheduled_time_end: Option<NaiveTime>,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
    duration_minutes: Option<i32>,
    result: Option<RevisionResult>,
    findings: Option<&str>,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    let result_str = result.map(revision_result_to_str);
    
    sqlx::query(
        r#"
        INSERT INTO revisions (id, device_id, customer_id, user_id, status,
            due_date, scheduled_date, scheduled_time_start, scheduled_time_end,
            completed_at, duration_minutes, result, findings, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5::revision_status, $6, $7, $8, $9, $10, $11, $12::revision_result, $13, NOW(), NOW())
        "#,
    )
    .bind(id)
    .bind(device_id)
    .bind(customer_id)
    .bind(user_id)
    .bind(revision_status_to_str(status))
    .bind(due_date)
    .bind(scheduled_date)
    .bind(scheduled_time_start)
    .bind(scheduled_time_end)
    .bind(completed_at)
    .bind(duration_minutes)
    .bind(result_str)
    .bind(findings)
    .execute(pool)
    .await?;
    
    Ok(id)
}

/// Update revision from import
pub async fn update_revision_import(
    pool: &PgPool,
    revision_id: Uuid,
    status: RevisionStatus,
    scheduled_date: Option<NaiveDate>,
    scheduled_time_start: Option<NaiveTime>,
    scheduled_time_end: Option<NaiveTime>,
    completed_at: Option<chrono::DateTime<chrono::Utc>>,
    duration_minutes: Option<i32>,
    result: Option<RevisionResult>,
    findings: Option<&str>,
) -> Result<()> {
    let result_str = result.map(revision_result_to_str);
    
    sqlx::query(
        r#"
        UPDATE revisions 
        SET status = $2::revision_status,
            scheduled_date = COALESCE($3, scheduled_date),
            scheduled_time_start = COALESCE($4, scheduled_time_start),
            scheduled_time_end = COALESCE($5, scheduled_time_end),
            completed_at = COALESCE($6, completed_at),
            duration_minutes = COALESCE($7, duration_minutes),
            result = COALESCE($8::revision_result, result),
            findings = COALESCE($9, findings),
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(revision_id)
    .bind(revision_status_to_str(status))
    .bind(scheduled_date)
    .bind(scheduled_time_start)
    .bind(scheduled_time_end)
    .bind(completed_at)
    .bind(duration_minutes)
    .bind(result_str)
    .bind(findings)
    .execute(pool)
    .await?;
    
    Ok(())
}

// =============================================================================
// COMMUNICATION OPERATIONS
// =============================================================================

/// Create a new communication from import
pub async fn create_communication_import(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    date: NaiveDate,
    comm_type: CommunicationType,
    direction: CommunicationDirection,
    subject: Option<&str>,
    content: &str,
    contact_name: Option<&str>,
    contact_phone: Option<&str>,
    duration_minutes: Option<i32>,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    let created_at = date.and_hms_opt(12, 0, 0).unwrap();
    
    sqlx::query(
        r#"
        INSERT INTO communications (id, user_id, customer_id, comm_type, direction,
            subject, content, contact_name, contact_phone, duration_minutes,
            follow_up_completed, created_at, updated_at)
        VALUES ($1, $2, $3, $4::comm_type, $5::comm_direction, $6, $7, $8, $9, $10, false, $11, $11)
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(customer_id)
    .bind(comm_type_to_str(comm_type))
    .bind(comm_direction_to_str(direction))
    .bind(subject)
    .bind(content)
    .bind(contact_name)
    .bind(contact_phone)
    .bind(duration_minutes)
    .bind(created_at)
    .execute(pool)
    .await?;
    
    Ok(id)
}

// =============================================================================
// WORK LOG OPERATIONS (replaces visit import)
// =============================================================================

/// Create a visit from work log import
pub async fn create_visit_from_work_log(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    crew_id: Option<Uuid>,
    scheduled_date: NaiveDate,
    scheduled_time_start: Option<NaiveTime>,
    scheduled_time_end: Option<NaiveTime>,
    status: VisitStatus,
    visit_type: &str,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    
    sqlx::query(
        r#"
        INSERT INTO visits (id, user_id, customer_id, crew_id,
            scheduled_date, scheduled_time_start, scheduled_time_end,
            status, visit_type, requires_follow_up, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::visit_status, $9, FALSE, NOW(), NOW())
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(customer_id)
    .bind(crew_id)
    .bind(scheduled_date)
    .bind(scheduled_time_start)
    .bind(scheduled_time_end)
    .bind(visit_status_to_str(status))
    .bind(visit_type)
    .execute(pool)
    .await?;
    
    Ok(id)
}

/// Create a work item from work log import
pub async fn create_work_item_from_import(
    pool: &PgPool,
    visit_id: Uuid,
    device_id: Option<Uuid>,
    revision_id: Option<Uuid>,
    crew_id: Option<Uuid>,
    work_type: WorkType,
    duration_minutes: Option<i32>,
    result: Option<WorkResult>,
    result_notes: Option<&str>,
    findings: Option<&str>,
    requires_follow_up: bool,
    follow_up_reason: Option<&str>,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    
    sqlx::query(
        r#"
        INSERT INTO visit_work_items (id, visit_id, device_id, revision_id, crew_id,
            work_type, duration_minutes, result, result_notes, findings,
            requires_follow_up, follow_up_reason, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
        "#,
    )
    .bind(id)
    .bind(visit_id)
    .bind(device_id)
    .bind(revision_id)
    .bind(crew_id)
    .bind(work_type)
    .bind(duration_minutes)
    .bind(result)
    .bind(result_notes)
    .bind(findings)
    .bind(requires_follow_up)
    .bind(follow_up_reason)
    .execute(pool)
    .await?;
    
    Ok(id)
}
