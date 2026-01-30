//! Import batch handlers for CSV import functionality

use anyhow::Result;
use async_nats::{Client, Subscriber};
use chrono::{NaiveDate, NaiveTime};
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
    ImportVisitBatchRequest, ImportVisitRequest,
    DeviceType, RevisionStatus, RevisionResult,
    CommunicationType, CommunicationDirection,
    VisitType, VisitStatus, VisitResult,
};

// =============================================================================
// CUSTOMER REFERENCE RESOLUTION
// =============================================================================

/// Find customer by reference (ICO, email, or phone)
async fn resolve_customer_ref(pool: &PgPool, user_id: Uuid, customer_ref: &str) -> Result<Option<Uuid>> {
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

/// Find device by serial number for a customer
async fn resolve_device_ref(pool: &PgPool, customer_id: Uuid, device_ref: &str) -> Result<Option<Uuid>> {
    queries::import::find_device_by_serial(pool, customer_id, device_ref).await
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
        "upcoming" | "nadcházející" | "nadchazejici" | "budoucí" | "budouci" => Some(RevisionStatus::Upcoming),
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
                    customer_id,
                    device_type,
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
            let device_id = match resolve_device_ref(&pool, customer_id, &rev_req.device_ref).await {
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
// VISIT IMPORT HANDLER
// =============================================================================

pub async fn handle_visit_import(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received import.visit message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ImportVisitBatchRequest> = match serde_json::from_slice(&msg.payload) {
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

        for (idx, visit_req) in request.payload.visits.iter().enumerate() {
            let row_number = (idx + 2) as i32;

            // Resolve customer
            let customer_id = match resolve_customer_ref(&pool, user_id, &visit_req.customer_ref).await {
                Ok(Some(id)) => id,
                Ok(None) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Zákazník nenalezen: {}", visit_req.customer_ref),
                        original_value: Some(visit_req.customer_ref.clone()),
                    });
                    continue;
                }
                Err(e) => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "customer_ref".to_string(),
                        message: format!("Chyba: {}", e),
                        original_value: Some(visit_req.customer_ref.clone()),
                    });
                    continue;
                }
            };

            // Resolve device (optional)
            let device_id = if let Some(ref device_ref) = visit_req.device_ref {
                match resolve_device_ref(&pool, customer_id, device_ref).await {
                    Ok(id) => id,
                    Err(_) => None,
                }
            } else {
                None
            };

            // Parse scheduled_date
            let scheduled_date = match parse_date(&visit_req.scheduled_date) {
                Some(d) => d,
                None => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "scheduled_date".to_string(),
                        message: format!("Neplatné datum: {}", visit_req.scheduled_date),
                        original_value: Some(visit_req.scheduled_date.clone()),
                    });
                    continue;
                }
            };

            // Parse visit_type
            let visit_type = match parse_visit_type(&visit_req.visit_type) {
                Some(vt) => vt,
                None => {
                    errors.push(ImportIssue {
                        row_number,
                        level: ImportIssueLevel::Error,
                        field: "visit_type".to_string(),
                        message: format!("Neznámý typ: {}", visit_req.visit_type),
                        original_value: Some(visit_req.visit_type.clone()),
                    });
                    continue;
                }
            };

            let status = visit_req.status.as_ref()
                .and_then(|s| parse_visit_status(s))
                .unwrap_or(VisitStatus::Planned);

            let result = visit_req.result.as_ref()
                .and_then(|r| parse_visit_result(r));

            let scheduled_time_start = visit_req.scheduled_time_start.as_ref().and_then(|t| parse_time(t));
            let scheduled_time_end = visit_req.scheduled_time_end.as_ref().and_then(|t| parse_time(t));

            match queries::import::create_visit_import(
                &pool,
                user_id,
                customer_id,
                device_id,
                scheduled_date,
                scheduled_time_start,
                scheduled_time_end,
                visit_type,
                status,
                result,
                visit_req.result_notes.as_deref(),
                visit_req.requires_follow_up.unwrap_or(false),
                visit_req.follow_up_reason.as_deref(),
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

        info!("Visit import: {} imported, {} errors", imported_count, errors.len());

        let response = SuccessResponse::new(request.id, ImportBatchResponse {
            imported_count,
            updated_count: 0,
            errors,
        });
        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}
