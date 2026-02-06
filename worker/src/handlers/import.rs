//! Import batch handlers for CSV import functionality

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use anyhow::Result;
use async_nats::{Client, Subscriber};
use async_nats::jetstream::{self, Context as JsContext};
use chrono::{NaiveDate, NaiveTime, Utc};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn, info};
use uuid::Uuid;

use crate::db::queries;
use crate::types::{
    ErrorResponse, Request, SuccessResponse,
    ImportBatchResponse, ImportIssue, ImportIssueLevel,
    ImportDeviceBatchRequest, ImportDeviceRequest,
    ImportRevisionBatchRequest, ImportRevisionRequest,
    ImportCommunicationBatchRequest, ImportCommunicationRequest,
    ImportWorkLogBatchRequest, ImportWorkLogRequest,
    DeviceType, RevisionStatus, RevisionResult,
    CommunicationType, CommunicationDirection,
    VisitType, VisitStatus, VisitResult,
    WorkType, WorkResult,
    CustomerImportJobRequest, CustomerImportJobStatus, CustomerImportJobStatusUpdate,
    CustomerImportJobSubmitResponse, QueuedCustomerImportJob,
    CreateCustomerRequest, CustomerType,
};

// =============================================================================
// CUSTOMER REFERENCE RESOLUTION
// =============================================================================

/// Find customer by reference (ICO, email, or phone)
pub async fn resolve_customer_ref(pool: &PgPool, user_id: Uuid, customer_ref: &str) -> Result<Option<Uuid>> {
    // Try ICO first (8 digits)
    if customer_ref.chars().all(|c| c.is_ascii_digit()) && customer_ref.len() <= 8 {
        let ico = format!("{:0>8}", customer_ref);
        if let Some(id) = queries::import::find_customer_by_ico(pool, user_id, &ico).await? {
            return Ok(Some(id));
        }
    }
    
    // Try email (contains @)
    if customer_ref.contains('@') {
        let email = customer_ref.to_lowercase();
        if let Some(id) = queries::import::find_customer_by_email(pool, user_id, &email).await? {
            return Ok(Some(id));
        }
    }
    
    // Try phone (starts with + or is digits only)
    if customer_ref.starts_with('+') || customer_ref.chars().all(|c| c.is_ascii_digit()) {
        let phone = customer_ref.replace([' ', '-', '(', ')'], "");
        if let Some(id) = queries::import::find_customer_by_phone(pool, user_id, &phone).await? {
            return Ok(Some(id));
        }
    }
    
    Ok(None)
}

/// Find device by reference for a customer.
/// Resolution order: serial_number → device_name → device_type (if unique)
pub async fn resolve_device_ref(pool: &PgPool, _user_id: Uuid, customer_id: Uuid, device_ref: &str) -> Result<Option<Uuid>> {
    // 1. Try serial_number
    if let Some(id) = queries::import::find_device_by_serial(pool, customer_id, device_ref).await? {
        return Ok(Some(id));
    }
    // 2. Try device_name
    if let Some(id) = queries::import::find_device_by_name(pool, customer_id, device_ref).await? {
        return Ok(Some(id));
    }
    // 3. Try device_type (only if customer has exactly 1 device of that type)
    if let Some(id) = queries::import::find_device_by_type_single(pool, customer_id, device_ref).await? {
        return Ok(Some(id));
    }
    Ok(None)
}

// =============================================================================
// TYPE PARSING
// =============================================================================

fn parse_device_type(s: &str) -> Option<DeviceType> {
    match s.to_lowercase().as_str() {
        "gas_boiler" | "kotel" | "plynový kotel" | "plynovy kotel" => Some(DeviceType::GasBoiler),
        "gas_water_heater" | "ohřívač" | "ohrivac" | "bojler" => Some(DeviceType::GasWaterHeater),
        "chimney" | "komín" | "komin" | "kouřovod" | "kourovod" => Some(DeviceType::Chimney),
        "fireplace" | "krb" | "krbová vložka" | "krbova vlozka" => Some(DeviceType::Fireplace),
        "gas_stove" | "sporák" | "sporak" | "plynový sporák" | "plynovy sporak" => Some(DeviceType::GasStove),
        "other" | "jiné" | "jine" | "ostatní" | "ostatni" => Some(DeviceType::Other),
        _ => None,
    }
}

fn parse_revision_status(s: &str) -> Option<RevisionStatus> {
    match s.to_lowercase().as_str() {
        "upcoming" | "nadcházející" | "nadchazejici" | "budoucí" | "budouci" | "plánovaná" | "planovana" => Some(RevisionStatus::Upcoming),
        "scheduled" | "naplánováno" | "naplanovano" | "plánováno" | "planovano" => Some(RevisionStatus::Scheduled),
        "confirmed" | "potvrzeno" => Some(RevisionStatus::Confirmed),
        "completed" | "dokončeno" | "dokonceno" | "hotovo" | "provedeno" => Some(RevisionStatus::Completed),
        "cancelled" | "zrušeno" | "zruseno" | "storno" => Some(RevisionStatus::Cancelled),
        _ => None,
    }
}

fn parse_revision_result(s: &str) -> Option<RevisionResult> {
    match s.to_lowercase().as_str() {
        "passed" | "ok" | "v pořádku" | "v poradku" | "bez závad" | "bez zavad" => Some(RevisionResult::Passed),
        "conditional" | "s výhradami" | "s vyhradami" | "podmíněně" | "podminene" => Some(RevisionResult::Conditional),
        "failed" | "nevyhovělo" | "nevyhovelo" | "závada" | "zavada" | "nok" => Some(RevisionResult::Failed),
        _ => None,
    }
}

fn parse_communication_type(s: &str) -> Option<CommunicationType> {
    match s.to_lowercase().as_str() {
        "call" | "hovor" | "telefon" | "telefonát" | "telefonat" => Some(CommunicationType::Call),
        "email_sent" | "email" | "mail" | "odeslaný email" | "odeslany email" => Some(CommunicationType::EmailSent),
        "email_received" | "přijatý email" | "prijaty email" | "příchozí email" | "prichozi email" => Some(CommunicationType::EmailReceived),
        "note" | "poznámka" | "poznamka" | "záznam" | "zaznam" => Some(CommunicationType::Note),
        "sms" => Some(CommunicationType::Sms),
        _ => None,
    }
}

fn parse_communication_direction(s: &str) -> Option<CommunicationDirection> {
    match s.to_lowercase().as_str() {
        "outbound" | "odchozí" | "odchozi" | "ven" | "out" => Some(CommunicationDirection::Outbound),
        "inbound" | "příchozí" | "prichozi" | "dovnitř" | "dovnitr" | "in" => Some(CommunicationDirection::Inbound),
        _ => None,
    }
}

fn parse_visit_type(s: &str) -> Option<VisitType> {
    match s.to_lowercase().as_str() {
        "revision" | "revize" | "kontrola" => Some(VisitType::Revision),
        "installation" | "instalace" | "montáž" | "montaz" => Some(VisitType::Installation),
        "repair" | "oprava" | "servis" => Some(VisitType::Repair),
        "consultation" | "konzultace" | "poradenství" | "poradenstvi" => Some(VisitType::Consultation),
        "follow_up" | "následná" | "nasledna" | "follow-up" => Some(VisitType::FollowUp),
        _ => None,
    }
}

fn parse_visit_status(s: &str) -> Option<VisitStatus> {
    match s.to_lowercase().as_str() {
        "planned" | "naplánováno" | "naplanovano" | "plánováno" | "planovano" => Some(VisitStatus::Planned),
        "in_progress" | "probíhá" | "probiha" => Some(VisitStatus::InProgress),
        "completed" | "dokončeno" | "dokonceno" | "hotovo" => Some(VisitStatus::Completed),
        "cancelled" | "zrušeno" | "zruseno" => Some(VisitStatus::Cancelled),
        "rescheduled" | "přeplánováno" | "preplanovano" => Some(VisitStatus::Rescheduled),
        _ => None,
    }
}

fn parse_visit_result(s: &str) -> Option<VisitResult> {
    match s.to_lowercase().as_str() {
        "successful" | "úspěšná" | "uspesna" | "ok" => Some(VisitResult::Successful),
        "partial" | "částečná" | "castecna" | "částečně" | "castecne" => Some(VisitResult::Partial),
        "failed" | "neúspěšná" | "neuspesna" | "nok" => Some(VisitResult::Failed),
        "customer_absent" | "nepřítomen" | "nepritomen" | "nikdo doma" => Some(VisitResult::CustomerAbsent),
        "rescheduled" | "přeplánováno" | "preplanovano" | "odloženo" | "odlozeno" => Some(VisitResult::Rescheduled),
        _ => None,
    }
}

fn parse_work_type(s: &str) -> Option<WorkType> {
    match s.to_lowercase().as_str() {
        "revision" | "revize" | "kontrola" => Some(WorkType::Revision),
        "repair" | "oprava" | "servis" => Some(WorkType::Repair),
        "installation" | "instalace" | "montáž" | "montaz" => Some(WorkType::Installation),
        "consultation" | "konzultace" | "poradenství" | "poradenstvi" => Some(WorkType::Consultation),
        "follow_up" | "následná" | "nasledna" | "follow-up" => Some(WorkType::FollowUp),
        _ => None,
    }
}

fn parse_work_result(s: &str) -> Option<WorkResult> {
    match s.to_lowercase().as_str() {
        "successful" | "úspěšná" | "uspesna" | "ok" => Some(WorkResult::Successful),
        "partial" | "částečná" | "castecna" => Some(WorkResult::Partial),
        "failed" | "neúspěšná" | "neuspesna" | "nok" => Some(WorkResult::Failed),
        "customer_absent" | "nepřítomen" | "nepritomen" => Some(WorkResult::CustomerAbsent),
        "rescheduled" | "přeplánováno" | "preplanovano" => Some(WorkResult::Rescheduled),
        _ => None,
    }
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    // Try YYYY-MM-DD
    if let Ok(date) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(date);
    }
    // Try DD.MM.YYYY
    if let Ok(date) = NaiveDate::parse_from_str(s, "%d.%m.%Y") {
        return Some(date);
    }
    None
}

fn parse_time(s: &str) -> Option<NaiveTime> {
    // Try HH:MM
    if let Ok(time) = NaiveTime::parse_from_str(s, "%H:%M") {
        return Some(time);
    }
    // Try HH:MM:SS
    if let Ok(time) = NaiveTime::parse_from_str(s, "%H:%M:%S") {
        return Some(time);
    }
    None
}

// =============================================================================
// DEVICE IMPORT HANDLER
// =============================================================================

pub async fn handle_device_import(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received import.device message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<ImportDeviceBatchRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let mut imported_count = 0;
        let mut updated_count = 0;
        let mut errors = Vec::new();

        for (idx, device_req) in request.payload.devices.iter().enumerate() {
            let row_number = (idx + 2) as i32; // +2 for header and 1-based indexing
            
            // Resolve customer
            let customer_id = match resolve_customer_ref(&pool, user_id, &device_req.customer_ref).await {
                Ok(Some(id)) => id,
                Ok(None) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Zákazník nenalezen: {}", device_req.customer_ref),
                        original_value: Some(device_req.customer_ref.clone()),
                    });
                    continue;
                }
                Err(e) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Chyba při hledání zákazníka: {}", e),
                        original_value: Some(device_req.customer_ref.clone()),
                    });
                    continue;
                }
            };

            // Parse device type
            let device_type = match parse_device_type(&device_req.device_type) {
                Some(dt) => dt,
                None => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "device_type".to_string(),
                        message: format!("Neznámý typ zařízení: {}", device_req.device_type),
                        original_value: Some(device_req.device_type.clone()),
                    });
                    continue;
                }
            };

            // Parse installation date
            let installation_date = device_req.installation_date.as_ref()
                .and_then(|d| parse_date(d));

            // Check for existing device (by serial number)
            let existing_device = if let Some(ref serial) = device_req.serial_number {
                queries::import::find_device_by_serial(&pool, customer_id, serial).await.ok().flatten()
            } else {
                None
            };

            if let Some(device_id) = existing_device {
                // Update existing device
                match queries::import::update_device_import(
                    &pool, 
                    device_id,
                    device_type,
                    device_req.device_name.as_deref(),
                    device_req.manufacturer.as_deref(),
                    device_req.model.as_deref(),
                    installation_date,
                    device_req.revision_interval_months,
                    device_req.notes.as_deref(),
                ).await {
                    Ok(_) => updated_count += 1,
                    Err(e) => {
                        errors.push(ImportIssue {
                            row_number,
                            level: ImportIssueLevel::Error,
                            field: "database".to_string(),
                            message: format!("Chyba při aktualizaci: {}", e),
                            original_value: None,
                        });
                    }
                }
            } else {
                // Create new device
                match queries::import::create_device_import(
                    &pool,
                    user_id,
                    customer_id,
                    device_type,
                    device_req.device_name.as_deref(),
                    device_req.manufacturer.as_deref(),
                    device_req.model.as_deref(),
                    device_req.serial_number.as_deref(),
                    installation_date,
                    device_req.revision_interval_months,
                    device_req.notes.as_deref(),
                ).await {
                    Ok(_) => imported_count += 1,
                    Err(e) => {
                        errors.push(ImportIssue {
                            row_number,
                            level: ImportIssueLevel::Error,
                            field: "database".to_string(),
                            message: format!("Chyba při vytváření: {}", e),
                            original_value: None,
                        });
                    }
                }
            }
        }

        info!("Device import: {} imported, {} updated, {} errors", imported_count, updated_count, errors.len());

        let response = SuccessResponse::new(request.id, ImportBatchResponse {
            imported_count,
            updated_count,
            errors,
        });
        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

// =============================================================================
// REVISION IMPORT HANDLER
// =============================================================================

pub async fn handle_revision_import(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received import.revision message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ImportRevisionBatchRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let mut imported_count = 0;
        let mut updated_count = 0;
        let mut errors = Vec::new();

        for (idx, rev_req) in request.payload.revisions.iter().enumerate() {
            let row_number = (idx + 2) as i32;

            // Resolve customer
            let customer_id = match resolve_customer_ref(&pool, user_id, &rev_req.customer_ref).await {
                Ok(Some(id)) => id,
                Ok(None) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Zákazník nenalezen: {}", rev_req.customer_ref),
                        original_value: Some(rev_req.customer_ref.clone()),
                    });
                    continue;
                }
                Err(e) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Chyba: {}", e),
                        original_value: Some(rev_req.customer_ref.clone()),
                    });
                    continue;
                }
            };

            // Resolve device
            let device_id = match resolve_device_ref(&pool, user_id, customer_id, &rev_req.device_ref).await {
                Ok(Some(id)) => id,
                Ok(None) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "device_ref".to_string(),
                        message: format!("Zařízení nenalezeno: {}", rev_req.device_ref),
                        original_value: Some(rev_req.device_ref.clone()),
                    });
                    continue;
                }
                Err(e) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "device_ref".to_string(),
                        message: format!("Chyba: {}", e),
                        original_value: Some(rev_req.device_ref.clone()),
                    });
                    continue;
                }
            };

            // Parse due_date
            let due_date = match parse_date(&rev_req.due_date) {
                Some(d) => d,
                None => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "due_date".to_string(),
                        message: format!("Neplatné datum: {}", rev_req.due_date),
                        original_value: Some(rev_req.due_date.clone()),
                    });
                    continue;
                }
            };

            let status = rev_req.status.as_ref()
                .and_then(|s| parse_revision_status(s))
                .unwrap_or(RevisionStatus::Upcoming);
            
            let result = rev_req.result.as_ref()
                .and_then(|r| parse_revision_result(r));

            let scheduled_date = rev_req.scheduled_date.as_ref().and_then(|d| parse_date(d));
            let scheduled_time_start = rev_req.scheduled_time_start.as_ref().and_then(|t| parse_time(t));
            let scheduled_time_end = rev_req.scheduled_time_end.as_ref().and_then(|t| parse_time(t));

            // Parse completed_at from the CSV field
            let completed_at = rev_req.completed_at.as_ref().and_then(|s| {
                chrono::DateTime::parse_from_rfc3339(s).ok()
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .or_else(|| {
                        // Try YYYY-MM-DDTHH:MM:SS format
                        chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok()
                            .map(|ndt| chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc))
                    })
            });

            // Check for existing revision (by device + due_date)
            let existing = queries::import::find_revision_by_device_and_date(&pool, device_id, due_date).await.ok().flatten();

            if let Some(revision_id) = existing {
                match queries::import::update_revision_import(
                    &pool,
                    revision_id,
                    status,
                    scheduled_date,
                    scheduled_time_start,
                    scheduled_time_end,
                    completed_at,
                    rev_req.duration_minutes,
                    result,
                    rev_req.findings.as_deref(),
                ).await {
                    Ok(_) => updated_count += 1,
                    Err(e) => {
                        errors.push(ImportIssue {
                            row_number,
                            level: ImportIssueLevel::Error,
                            field: "database".to_string(),
                            message: format!("Chyba při aktualizaci: {}", e),
                            original_value: None,
                        });
                    }
                }
            } else {
                match queries::import::create_revision_import(
                    &pool,
                    device_id,
                    customer_id,
                    user_id,
                    due_date,
                    status,
                    scheduled_date,
                    scheduled_time_start,
                    scheduled_time_end,
                    completed_at,
                    rev_req.duration_minutes,
                    result,
                    rev_req.findings.as_deref(),
                ).await {
                    Ok(_) => imported_count += 1,
                    Err(e) => {
                        errors.push(ImportIssue {
                            row_number,
                            level: ImportIssueLevel::Error,
                            field: "database".to_string(),
                            message: format!("Chyba při vytváření: {}", e),
                            original_value: None,
                        });
                    }
                }
            }
        }

        info!("Revision import: {} imported, {} updated, {} errors", imported_count, updated_count, errors.len());

        let response = SuccessResponse::new(request.id, ImportBatchResponse {
            imported_count,
            updated_count,
            errors,
        });
        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

// =============================================================================
// COMMUNICATION IMPORT HANDLER
// =============================================================================

pub async fn handle_communication_import(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received import.communication message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ImportCommunicationBatchRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let mut imported_count = 0;
        let errors_list: Vec<ImportIssue> = Vec::new();
        let mut errors = errors_list;

        for (idx, comm_req) in request.payload.communications.iter().enumerate() {
            let row_number = (idx + 2) as i32;

            // Resolve customer
            let customer_id = match resolve_customer_ref(&pool, user_id, &comm_req.customer_ref).await {
                Ok(Some(id)) => id,
                Ok(None) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Zákazník nenalezen: {}", comm_req.customer_ref),
                        original_value: Some(comm_req.customer_ref.clone()),
                    });
                    continue;
                }
                Err(e) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Chyba: {}", e),
                        original_value: Some(comm_req.customer_ref.clone()),
                    });
                    continue;
                }
            };

            // Parse date
            let date = match parse_date(&comm_req.date) {
                Some(d) => d,
                None => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "date".to_string(),
                        message: format!("Neplatné datum: {}", comm_req.date),
                        original_value: Some(comm_req.date.clone()),
                    });
                    continue;
                }
            };

            // Parse comm_type
            let comm_type = match parse_communication_type(&comm_req.comm_type) {
                Some(ct) => ct,
                None => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "comm_type".to_string(),
                        message: format!("Neznámý typ: {}", comm_req.comm_type),
                        original_value: Some(comm_req.comm_type.clone()),
                    });
                    continue;
                }
            };

            // Parse direction
            let direction = match parse_communication_direction(&comm_req.direction) {
                Some(d) => d,
                None => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "direction".to_string(),
                        message: format!("Neznámý směr: {}", comm_req.direction),
                        original_value: Some(comm_req.direction.clone()),
                    });
                    continue;
                }
            };

            match queries::import::create_communication_import(
                &pool,
                user_id,
                customer_id,
                date,
                comm_type,
                direction,
                comm_req.subject.as_deref(),
                &comm_req.content,
                comm_req.contact_name.as_deref(),
                comm_req.contact_phone.as_deref(),
                comm_req.duration_minutes,
            ).await {
                Ok(_) => imported_count += 1,
                Err(e) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "database".to_string(),
                        message: format!("Chyba: {}", e),
                        original_value: None,
                    });
                }
            }
        }

        info!("Communication import: {} imported, {} errors", imported_count, errors.len());

        let response = SuccessResponse::new(request.id, ImportBatchResponse {
            imported_count,
            updated_count: 0,
            errors,
        });
        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

// =============================================================================
// WORK LOG IMPORT HANDLER (replaces old visit import)
// =============================================================================

/// Group key for work log entries that belong to the same visit
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct VisitGroupKey {
    customer_ref: String,
    scheduled_date: String,
}

pub async fn handle_work_log_import(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    use std::collections::HashMap;

    while let Some(msg) = subscriber.next().await {
        debug!("Received import.worklog message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ImportWorkLogBatchRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let mut imported_count = 0;
        let mut errors = Vec::new();

        // Group entries by (customer_ref, scheduled_date) to create one visit per group
        let mut groups: HashMap<VisitGroupKey, Vec<(usize, &ImportWorkLogRequest)>> = HashMap::new();
        for (idx, entry) in request.payload.entries.iter().enumerate() {
            let key = VisitGroupKey {
                customer_ref: entry.customer_ref.clone(),
                scheduled_date: entry.scheduled_date.clone(),
            };
            groups.entry(key).or_default().push((idx, entry));
        }

        for (key, entries) in &groups {
            let first_idx = entries[0].0;
            let row_number = (first_idx + 2) as i32;

            // Resolve customer
            let customer_id = match resolve_customer_ref(&pool, user_id, &key.customer_ref).await {
                Ok(Some(id)) => id,
                Ok(None) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Zákazník nenalezen: {}", key.customer_ref),
                        original_value: Some(key.customer_ref.clone()),
                    });
                    continue;
                }
                Err(e) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Chyba: {}", e),
                        original_value: Some(key.customer_ref.clone()),
                    });
                    continue;
                }
            };

            // Parse scheduled_date
            let scheduled_date = match parse_date(&key.scheduled_date) {
                Some(d) => d,
                None => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "scheduled_date".to_string(),
                        message: format!("Neplatné datum: {}", key.scheduled_date),
                        original_value: Some(key.scheduled_date.clone()),
                    });
                    continue;
                }
            };

            // Use time from first entry
            let first_entry = entries[0].1;
            let scheduled_time_start = first_entry.scheduled_time_start.as_ref().and_then(|t| parse_time(t));
            let scheduled_time_end = first_entry.scheduled_time_end.as_ref().and_then(|t| parse_time(t));

            // Determine overall visit status from entries
            let visit_status = first_entry.status.as_ref()
                .and_then(|s| parse_visit_status(s))
                .unwrap_or(VisitStatus::Planned);

            // Determine visit_type from first entry's work_type
            let visit_type_str = first_entry.work_type.as_str();

            // Create the visit
            let visit_id = match queries::import::create_visit_from_work_log(
                &pool,
                user_id,
                customer_id,
                None, // crew_id
                scheduled_date,
                scheduled_time_start,
                scheduled_time_end,
                visit_status,
                visit_type_str,
            ).await {
                Ok(id) => id,
                Err(e) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "database".to_string(),
                        message: format!("Chyba při vytváření návštěvy: {}", e),
                        original_value: None,
                    });
                    continue;
                }
            };

            // Create work items for each entry in the group
            for (idx, entry) in entries {
                let entry_row = (*idx + 2) as i32;

                // Parse work_type
                let work_type = match parse_work_type(&entry.work_type) {
                    Some(wt) => wt,
                    None => {
                        errors.push(ImportIssue {
                            row_number: entry_row,
                            level: ImportIssueLevel::Error,
                            field: "work_type".to_string(),
                            message: format!("Neznámý typ práce: {}", entry.work_type),
                            original_value: Some(entry.work_type.clone()),
                        });
                        continue;
                    }
                };

                // Resolve device (optional)
                let device_id = if let Some(ref device_ref) = entry.device_ref {
                    match resolve_device_ref(&pool, user_id, customer_id, device_ref).await {
                        Ok(id) => id,
                        Err(_) => None,
                    }
                } else {
                    None
                };

                let result = entry.result.as_ref().and_then(|r| parse_work_result(r));
                let requires_follow_up = entry.requires_follow_up.unwrap_or(false);

                match queries::import::create_work_item_from_import(
                    &pool,
                    visit_id,
                    device_id,
                    None, // revision_id - linked later if work_type=revision
                    None, // crew_id
                    work_type,
                    entry.duration_minutes,
                    result,
                    entry.result_notes.as_deref(),
                    entry.findings.as_deref(),
                    requires_follow_up,
                    entry.follow_up_reason.as_deref(),
                ).await {
                    Ok(_) => {}
                    Err(e) => {
                        errors.push(ImportIssue {
                            row_number: entry_row,
                            level: ImportIssueLevel::Error,
                            field: "database".to_string(),
                            message: format!("Chyba při vytváření úkonu: {}", e),
                            original_value: None,
                        });
                    }
                }
            }

            imported_count += 1;
        }

        info!("Work log import: {} visits imported, {} errors", imported_count, errors.len());

        let response = SuccessResponse::new(request.id, ImportBatchResponse {
            imported_count,
            updated_count: 0,
            errors,
        });
        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

// =============================================================================
// CUSTOMER IMPORT JOB PROCESSOR (async background processing)
// =============================================================================

// Stream and consumer names for customer import
const CUSTOMER_IMPORT_STREAM: &str = "SAZINKA_CUSTOMER_IMPORT_JOBS";
const CUSTOMER_IMPORT_CONSUMER: &str = "customer_import_workers";
const CUSTOMER_IMPORT_SUBJECT: &str = "sazinka.jobs.import.customer";
const CUSTOMER_IMPORT_STATUS_PREFIX: &str = "sazinka.job.import.status";

/// Processor for customer import jobs
pub struct CustomerImportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    pending_count: AtomicU32,
}

impl CustomerImportProcessor {
    /// Create a new customer import processor
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create or get stream for customer import jobs
        let stream_config = jetstream::stream::Config {
            name: CUSTOMER_IMPORT_STREAM.to_string(),
            subjects: vec![CUSTOMER_IMPORT_SUBJECT.to_string()],
            max_messages: 1_000,
            max_bytes: 500 * 1024 * 1024, // 500 MB (CSV files can be large)
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream customer import stream '{}' ready", CUSTOMER_IMPORT_STREAM);
        
        Ok(Self {
            client,
            js,
            pool,
            pending_count: AtomicU32::new(0),
        })
    }
    
    /// Submit a customer import job to the queue
    pub async fn submit_job(&self, user_id: Uuid, request: CustomerImportJobRequest) -> Result<CustomerImportJobSubmitResponse> {
        let job = QueuedCustomerImportJob::new(user_id, request);
        let job_id = job.id;
        
        // Publish to JetStream
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(CUSTOMER_IMPORT_SUBJECT, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        
        info!("Customer import job {} submitted, position {} in queue", job_id, pending);
        
        // Publish initial status
        self.publish_status(job_id, CustomerImportJobStatus::Queued {
            position: pending,
        }).await?;
        
        Ok(CustomerImportJobSubmitResponse {
            job_id,
            message: "Import úloha byla zařazena do fronty".to_string(),
        })
    }
    
    /// Publish a status update for a job
    pub async fn publish_status(&self, job_id: Uuid, status: CustomerImportJobStatus) -> Result<()> {
        let update = CustomerImportJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", CUSTOMER_IMPORT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Start processing jobs from the queue
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(CUSTOMER_IMPORT_STREAM).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CUSTOMER_IMPORT_CONSUMER.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(CUSTOMER_IMPORT_CONSUMER, consumer_config).await?;
        info!("JetStream customer import consumer '{}' ready", CUSTOMER_IMPORT_CONSUMER);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    // Process in separate task
                    tokio::spawn(async move {
                        if let Err(e) = processor.process_job(msg).await {
                            error!("Failed to process customer import job: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Error receiving customer import message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single customer import job
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::job_history::JOB_HISTORY;
        
        let job: QueuedCustomerImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
        info!("Processing customer import job {} from file '{}'", job_id, job.request.filename);
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // ACK immediately to prevent redelivery during long processing
        if let Err(e) = msg.ack().await {
            error!("Failed to ack customer import job {}: {:?}", job_id, e);
        }
        
        // Publish parsing status
        self.publish_status(job_id, CustomerImportJobStatus::Parsing { progress: 0 }).await?;
        
        // Parse CSV
        let csv_content = &job.request.csv_content;
        let rows = match self.parse_csv(csv_content).await {
            Ok(rows) => rows,
            Err(e) => {
                let error_msg = format!("Chyba při parsování CSV: {}", e);
                self.publish_status(job_id, CustomerImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.customer", started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "CSV soubor neobsahuje žádné záznamy".to_string();
            self.publish_status(job_id, CustomerImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.customer", started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, CustomerImportJobStatus::Parsing { progress: 100 }).await?;
        
        // Import customers
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut errors: Vec<String> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
            // Publish progress every 10 customers or at milestones
            if processed % 10 == 0 || processed == total {
                self.publish_status(job_id, CustomerImportJobStatus::Importing {
                    processed,
                    total,
                    succeeded,
                    failed,
                }).await?;
            }
            
            // Create customer
            match self.create_customer(user_id, row).await {
                Ok(_) => succeeded += 1,
                Err(e) => {
                    failed += 1;
                    let row_num = idx + 2; // +2 for header and 1-based indexing
                    errors.push(format!("Řádek {}: {}", row_num, e));
                }
            }
        }
        
        // Generate report
        let report = self.generate_report(&job.request.filename, total, succeeded, failed, &errors);
        
        // Publish completion
        self.publish_status(job_id, CustomerImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        // Record in job history
        JOB_HISTORY.record_completed(
            job_id,
            "import.customer",
            started_at,
            Some(format!("{}/{} úspěšně importováno", succeeded, total)),
        );
        
        info!("Customer import job {} completed: {}/{} succeeded", job_id, succeeded, total);
        
        // Trigger geocoding for newly imported customers (if any were successfully imported)
        if succeeded > 0 {
            if let Err(e) = self.trigger_geocoding(user_id).await {
                warn!("Failed to trigger geocoding after import: {}", e);
            }
        }
        
        Ok(())
    }
    
    /// Trigger geocoding for all pending customers
    async fn trigger_geocoding(&self, user_id: Uuid) -> Result<()> {
        use crate::types::{GeocodeJobRequest, QueuedGeocodeJob, GeocodeJobStatus, GeocodeJobStatusUpdate};
        
        // Get customers with pending geocode status
        let pending_customers = queries::customer::list_pending_geocode(&self.pool, user_id).await?;
        
        if pending_customers.is_empty() {
            info!("No customers pending geocoding after import");
            return Ok(());
        }
        
        let customer_ids: Vec<Uuid> = pending_customers.iter().map(|c| c.id).collect();
        let count = customer_ids.len();
        
        // Create geocode job request
        let request = GeocodeJobRequest {
            user_id,
            customer_ids,
        };
        
        let job = QueuedGeocodeJob::new(request);
        let job_id = job.id;
        
        // Get JetStream context and publish
        let js = jetstream::new(self.client.clone());
        let payload = serde_json::to_vec(&job)?;
        js.publish("sazinka.jobs.geocode", payload.into()).await?.await?;
        
        info!("Triggered geocoding job {} for {} customers after import", job_id, count);
        
        // Publish initial status
        let status_update = GeocodeJobStatusUpdate::new(job_id, GeocodeJobStatus::Queued { position: 1 });
        let status_subject = format!("sazinka.job.geocode.status.{}", job_id);
        let status_payload = serde_json::to_vec(&status_update)?;
        self.client.publish(status_subject, status_payload.into()).await?;
        
        Ok(())
    }
    
    /// Parse CSV content into customer rows
    async fn parse_csv(&self, content: &str) -> Result<Vec<CsvCustomerRow>> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(content.as_bytes());
        
        let mut rows = Vec::new();
        
        for result in reader.deserialize() {
            let row: CsvCustomerRow = result?;
            rows.push(row);
        }
        
        Ok(rows)
    }
    
    /// Create a customer from CSV row
    async fn create_customer(&self, user_id: Uuid, row: &CsvCustomerRow) -> Result<Uuid> {
        // Determine customer type
        let customer_type = if row.ico.is_some() || row.dic.is_some() || row.contact_person.is_some() {
            CustomerType::Company
        } else {
            CustomerType::Person
        };
        
        // Normalize phone
        let phone = row.phone.as_ref().map(|p| {
            let cleaned = p.replace([' ', '-', '(', ')'], "");
            if cleaned.starts_with('+') {
                cleaned
            } else if cleaned.starts_with("00") {
                format!("+{}", &cleaned[2..])
            } else if cleaned.len() == 9 && cleaned.chars().all(|c| c.is_ascii_digit()) {
                format!("+420{}", cleaned)
            } else {
                cleaned
            }
        });
        
        // Normalize email
        let email = row.email.as_ref().map(|e| e.to_lowercase());
        
        // Normalize postal code (required field, use empty string if missing)
        let postal_code = row.postal_code.as_ref()
            .map(|p| p.replace([' ', '-'], ""))
            .unwrap_or_default();
        
        // Normalize ICO (pad to 8 digits)
        let ico = row.ico.as_ref().map(|i| {
            let cleaned = i.replace(' ', "");
            format!("{:0>8}", cleaned)
        });
        
        // Normalize DIC
        let dic = row.dic.as_ref().map(|d| {
            let cleaned = d.replace(' ', "").to_uppercase();
            if cleaned.starts_with("CZ") {
                cleaned
            } else {
                format!("CZ{}", cleaned)
            }
        });
        
        let customer = queries::customer::create_customer(
            &self.pool,
            user_id,
            &CreateCustomerRequest {
                name: Some(row.name.clone()),
                customer_type: Some(customer_type),
                contact_person: row.contact_person.clone(),
                ico,
                dic,
                email,
                phone: phone.clone(),
                phone_raw: row.phone.clone(),
                street: row.street.clone(),
                city: row.city.clone(),
                postal_code: Some(postal_code),
                country: row.country.clone(),
                lat: None,
                lng: None,
                notes: row.notes.clone(),
            },
        ).await?;
        
        Ok(customer.id)
    }
    
    /// Generate import report
    fn generate_report(&self, filename: &str, total: u32, succeeded: u32, failed: u32, errors: &[String]) -> String {
        let mut report = String::new();
        report.push_str(&format!("Import zákazníků: {}\n", filename));
        report.push_str(&format!("Datum: {}\n", Utc::now().format("%d.%m.%Y %H:%M")));
        report.push_str("─────────────────────────────────\n");
        report.push_str(&format!("Celkem řádků: {}\n", total));
        report.push_str(&format!("Úspěšně importováno: {}\n", succeeded));
        report.push_str(&format!("Chyby: {}\n", failed));
        
        if !errors.is_empty() {
            report.push_str("\nChyby:\n");
            for (i, error) in errors.iter().take(50).enumerate() {
                report.push_str(&format!("  {}. {}\n", i + 1, error));
            }
            if errors.len() > 50 {
                report.push_str(&format!("  ... a dalších {} chyb\n", errors.len() - 50));
            }
        }
        
        report
    }
}

/// CSV row for customer import
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CsvCustomerRow {
    #[serde(alias = "name", alias = "nazev", alias = "jmeno", alias = "firma")]
    pub name: String,
    #[serde(alias = "contact_person", alias = "kontaktni_osoba", alias = "kontakt")]
    pub contact_person: Option<String>,
    #[serde(alias = "ico", alias = "ic")]
    pub ico: Option<String>,
    #[serde(alias = "dic")]
    pub dic: Option<String>,
    #[serde(alias = "email", alias = "e-mail")]
    pub email: Option<String>,
    #[serde(alias = "phone", alias = "telefon", alias = "tel")]
    pub phone: Option<String>,
    #[serde(alias = "street", alias = "ulice", alias = "adresa")]
    pub street: Option<String>,
    #[serde(alias = "city", alias = "mesto", alias = "obec")]
    pub city: Option<String>,
    #[serde(alias = "postal_code", alias = "psc", alias = "zip")]
    pub postal_code: Option<String>,
    #[serde(alias = "country", alias = "zeme", alias = "stat")]
    pub country: Option<String>,
    #[serde(alias = "notes", alias = "poznamka", alias = "poznamky")]
    pub notes: Option<String>,
}

/// Handle customer import job submission
pub async fn handle_customer_import_submit(
    client: Client,
    mut subscriber: Subscriber,
    processor: Arc<CustomerImportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<CustomerImportJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse customer import submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        match processor.submit_job(user_id, request.payload).await {
            Ok(response) => {
                let success = SuccessResponse::new(request.id, response);
                let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            }
            Err(e) => {
                error!("Failed to submit customer import job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}
