//! Import-related database queries

use anyhow::Result;
use chrono::{NaiveDate, NaiveTime};
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::{
    DeviceType, RevisionStatus, RevisionResult,
    CommunicationType, CommunicationDirection,
    VisitType, VisitStatus, VisitResult,
};

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

fn visit_type_to_str(vtype: VisitType) -> &'static str {
    match vtype {
        VisitType::Revision => "revision",
        VisitType::Installation => "installation",
        VisitType::Repair => "repair",
        VisitType::Consultation => "consultation",
        VisitType::FollowUp => "follow_up",
    }
}

fn visit_result_to_str(result: VisitResult) -> &'static str {
    match result {
        VisitResult::Successful => "successful",
        VisitResult::Partial => "partial",
        VisitResult::Failed => "failed",
        VisitResult::CustomerAbsent => "customer_absent",
        VisitResult::Rescheduled => "rescheduled",
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

// =============================================================================
// CUSTOMER LOOKUP
// =============================================================================

/// Find customer by ICO
pub async fn find_customer_by_ico(pool: &PgPool, user_id: Uuid, ico: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM customers WHERE user_id = $1 AND ico = $2"#,
        user_id,
        ico
    )
    .fetch_optional(pool)
    .await?;
    
    Ok(result)
}

/// Find customer by email
pub async fn find_customer_by_email(pool: &PgPool, user_id: Uuid, email: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM customers WHERE user_id = $1 AND LOWER(email) = LOWER($2)"#,
        user_id,
        email
    )
    .fetch_optional(pool)
    .await?;
    
    Ok(result)
}

/// Find customer by phone
pub async fn find_customer_by_phone(pool: &PgPool, user_id: Uuid, phone: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM customers WHERE user_id = $1 AND phone = $2"#,
        user_id,
        phone
    )
    .fetch_optional(pool)
    .await?;
    
    Ok(result)
}

// =============================================================================
// DEVICE OPERATIONS
// =============================================================================

/// Find device by serial number for a customer
pub async fn find_device_by_serial(pool: &PgPool, customer_id: Uuid, serial_number: &str) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM devices WHERE customer_id = $1 AND serial_number = $2"#,
        customer_id,
        serial_number
    )
    .fetch_optional(pool)
    .await?;
    
    Ok(result)
}

/// Create a new device from import
pub async fn create_device_import(
    pool: &PgPool,
    customer_id: Uuid,
    device_type: DeviceType,
    manufacturer: Option<&str>,
    model: Option<&str>,
    serial_number: Option<&str>,
    installation_date: Option<NaiveDate>,
    revision_interval_months: i32,
    notes: Option<&str>,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    
    sqlx::query!(
        r#"
        INSERT INTO devices (id, customer_id, device_type, manufacturer, model, serial_number, installation_date, revision_interval_months, notes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        "#,
        id,
        customer_id,
        device_type as DeviceType,
        manufacturer,
        model,
        serial_number,
        installation_date,
        revision_interval_months,
        notes
    )
    .execute(pool)
    .await?;
    
    Ok(id)
}

/// Update device from import
pub async fn update_device_import(
    pool: &PgPool,
    device_id: Uuid,
    device_type: DeviceType,
    manufacturer: Option<&str>,
    model: Option<&str>,
    installation_date: Option<NaiveDate>,
    revision_interval_months: i32,
    notes: Option<&str>,
) -> Result<()> {
    sqlx::query!(
        r#"
        UPDATE devices 
        SET device_type = $2,
            manufacturer = COALESCE($3, manufacturer),
            model = COALESCE($4, model),
            installation_date = COALESCE($5, installation_date),
            revision_interval_months = $6,
            notes = COALESCE($7, notes)
        WHERE id = $1
        "#,
        device_id,
        device_type as DeviceType,
        manufacturer,
        model,
        installation_date,
        revision_interval_months,
        notes
    )
    .execute(pool)
    .await?;
    
    Ok(())
}

// =============================================================================
// REVISION OPERATIONS
// =============================================================================

/// Find revision by device and due date
pub async fn find_revision_by_device_and_date(pool: &PgPool, device_id: Uuid, due_date: NaiveDate) -> Result<Option<Uuid>> {
    let result = sqlx::query_scalar!(
        r#"SELECT id FROM revisions WHERE device_id = $1 AND due_date = $2"#,
        device_id,
        due_date
    )
    .fetch_optional(pool)
    .await?;
    
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
    duration_minutes: Option<i32>,
    result: Option<RevisionResult>,
    findings: Option<&str>,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    
    sqlx::query!(
        r#"
        INSERT INTO revisions (id, device_id, customer_id, user_id, status, due_date, scheduled_date, scheduled_time_start, scheduled_time_end, duration_minutes, result, findings, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        "#,
        id,
        device_id,
        customer_id,
        user_id,
        status as RevisionStatus,
        due_date,
        scheduled_date,
        scheduled_time_start,
        scheduled_time_end,
        duration_minutes,
        result as Option<RevisionResult>,
        findings
    )
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
    duration_minutes: Option<i32>,
    result: Option<RevisionResult>,
    findings: Option<&str>,
) -> Result<()> {
    sqlx::query!(
        r#"
        UPDATE revisions 
        SET status = $2,
            scheduled_date = COALESCE($3, scheduled_date),
            scheduled_time_start = COALESCE($4, scheduled_time_start),
            scheduled_time_end = COALESCE($5, scheduled_time_end),
            duration_minutes = COALESCE($6, duration_minutes),
            result = COALESCE($7, result),
            findings = COALESCE($8, findings),
            updated_at = NOW()
        WHERE id = $1
        "#,
        revision_id,
        status as RevisionStatus,
        scheduled_date,
        scheduled_time_start,
        scheduled_time_end,
        duration_minutes,
        result as Option<RevisionResult>,
        findings
    )
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
        INSERT INTO communications (id, user_id, customer_id, comm_type, direction, subject, content, contact_name, contact_phone, duration_minutes, follow_up_completed, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11)
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
// VISIT OPERATIONS
// =============================================================================

/// Create a new visit from import
pub async fn create_visit_import(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    _device_id: Option<Uuid>,
    scheduled_date: NaiveDate,
    scheduled_time_start: Option<NaiveTime>,
    scheduled_time_end: Option<NaiveTime>,
    visit_type: VisitType,
    status: VisitStatus,
    result: Option<VisitResult>,
    result_notes: Option<&str>,
    requires_follow_up: bool,
    follow_up_reason: Option<&str>,
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    let result_str = result.map(visit_result_to_str);
    
    // Note: revision_id is not set during import - visits imported separately from revisions
    sqlx::query(
        r#"
        INSERT INTO visits (id, user_id, customer_id, scheduled_date, scheduled_time_start, scheduled_time_end, status, visit_type, result, result_notes, requires_follow_up, follow_up_reason, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(customer_id)
    .bind(scheduled_date)
    .bind(scheduled_time_start)
    .bind(scheduled_time_end)
    .bind(visit_status_to_str(status))
    .bind(visit_type_to_str(visit_type))
    .bind(result_str)
    .bind(result_notes)
    .bind(requires_follow_up)
    .bind(follow_up_reason)
    .execute(pool)
    .await?;
    
    Ok(id)
}
