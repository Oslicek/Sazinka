//! Async import processors for all entity types
//! Uses JetStream for reliable background job processing

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::io::{Read as IoRead, Cursor};
use anyhow::Result;
use async_nats::{Client, Subscriber};
use async_nats::jetstream::{self, Context as JsContext};
use chrono::{NaiveDate, NaiveTime, Utc};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{error, warn, info};
use uuid::Uuid;

use serde_json::json;

use crate::auth;
use crate::db::queries;
use crate::types::{
    ErrorResponse, Request, SuccessResponse,
    CreateDeviceRequest, CreateRevisionRequest, CreateCustomerRequest, CustomerType,
    ImportIssue, ImportIssueLevel, ImportIssueCode, ImportReport,
    // Device import types
    DeviceImportJobRequest, DeviceImportJobStatus, DeviceImportJobStatusUpdate,
    DeviceImportJobSubmitResponse, QueuedDeviceImportJob,
    // Revision import types
    RevisionImportJobRequest, RevisionImportJobStatus, RevisionImportJobStatusUpdate,
    RevisionImportJobSubmitResponse, QueuedRevisionImportJob,
    // Communication import types
    CommunicationImportJobRequest, CommunicationImportJobStatus, CommunicationImportJobStatusUpdate,
    CommunicationImportJobSubmitResponse, QueuedCommunicationImportJob,
    // Work log import types (formerly visit import)
    WorkLogImportJobRequest, WorkLogImportJobStatus, WorkLogImportJobStatusUpdate,
    WorkLogImportJobSubmitResponse, QueuedWorkLogImportJob,
    // ZIP import types
    ZipImportJobRequest, ZipImportJobStatus, ZipImportJobStatusUpdate,
    ZipImportJobSubmitResponse, QueuedZipImportJob, ZipImportFileInfo, ZipImportFileType,
    ZipImportFileResult,
};
use crate::services::job_history::JOB_HISTORY;

use super::import::{resolve_customer_ref, resolve_device_ref};

// =============================================================================
// IMPORT REPORT HELPERS
// =============================================================================

/// Classify an error message into a machine-readable error code
pub fn classify_error(error_msg: &str) -> (ImportIssueCode, &'static str) {
    let lower = error_msg.to_lowercase();
    // Match i18n keys first
    if lower.contains("import:customer_not_found") {
        (ImportIssueCode::CustomerNotFound, "customer_ref")
    } else if lower.contains("import:device_not_found") {
        (ImportIssueCode::DeviceNotFound, "device_ref")
    } else if lower.contains("import:missing_") {
        (ImportIssueCode::MissingField, "")
    } else if lower.contains("import:invalid_date_format") {
        (ImportIssueCode::InvalidDate, "")
    } else if lower.contains("import:revision_already_exists") {
        (ImportIssueCode::DuplicateRecord, "device_ref+due_date")
    // Fallback to English patterns
    } else if lower.contains("not found") && lower.contains("customer") {
        (ImportIssueCode::CustomerNotFound, "customer_ref")
    } else if lower.contains("not found") && lower.contains("device") {
        (ImportIssueCode::DeviceNotFound, "device_ref")
    } else if lower.contains("duplicate") || lower.contains("unique") || lower.contains("already exists") || lower.contains("unique_violation") {
        (ImportIssueCode::DuplicateRecord, "")
    } else if lower.contains("missing") {
        (ImportIssueCode::MissingField, "")
    } else if lower.contains("date") || lower.contains("invalid_date") {
        (ImportIssueCode::InvalidDate, "")
    } else if lower.contains("format") || lower.contains("invalid") {
        (ImportIssueCode::InvalidValue, "")
    } else if lower.contains("db") || lower.contains("database") || lower.contains("sqlx") || lower.contains("constraint") {
        (ImportIssueCode::DbError, "")
    } else {
        (ImportIssueCode::Unknown, "")
    }
}

/// Build a structured ImportReport
pub fn build_import_report(
    job_id: Uuid,
    job_type: &str,
    filename: &str,
    started_at: chrono::DateTime<Utc>,
    total: u32,
    succeeded: u32,
    failed: u32,
    issues: Vec<ImportIssue>,
) -> ImportReport {
    let now = Utc::now();
    let duration_ms = (now - started_at).num_milliseconds().max(0) as u64;
    ImportReport {
        job_id,
        job_type: job_type.to_string(),
        filename: filename.to_string(),
        imported_at: now.to_rfc3339(),
        duration_ms,
        total_rows: total,
        imported_count: succeeded,
        updated_count: 0,
        skipped_count: total - succeeded - failed,
        issues,
    }
}

/// Persist the report as a JSON file in logs/import-reports/
pub fn persist_report(report: &ImportReport) {
    let dir = std::path::Path::new("logs/import-reports");
    if let Err(e) = std::fs::create_dir_all(dir) {
        warn!("Failed to create import reports directory: {}", e);
        return;
    }
    let path = dir.join(format!("{}.json", report.job_id));
    match serde_json::to_string_pretty(report) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                warn!("Failed to write import report to {:?}: {}", path, e);
            } else {
                info!("Import report saved to {:?}", path);
            }
        }
        Err(e) => warn!("Failed to serialize import report: {}", e),
    }
}

// =============================================================================
// CSV ROW TYPES
// =============================================================================

#[derive(Debug, serde::Deserialize)]
struct CsvDeviceRow {
    #[serde(alias = "zakaznik", alias = "customer", alias = "customer_ref")]
    customer_ref: Option<String>,
    #[serde(alias = "typ", alias = "type", alias = "device_type")]
    device_type: Option<String>,
    #[serde(alias = "vyrobce", alias = "manufacturer")]
    manufacturer: Option<String>,
    #[serde(alias = "model")]
    model: Option<String>,
    #[serde(alias = "seriove_cislo", alias = "serial", alias = "serial_number")]
    serial_number: Option<String>,
    #[serde(alias = "datum_instalace", alias = "installation_date")]
    installation_date: Option<String>,
    #[serde(alias = "interval_revizi", alias = "revision_interval", alias = "revision_interval_months")]
    revision_interval_months: Option<i32>,
    #[serde(alias = "poznamky", alias = "notes")]
    notes: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct CsvRevisionRow {
    #[serde(alias = "zarizeni", alias = "device", alias = "device_ref")]
    device_ref: Option<String>,
    #[serde(alias = "zakaznik", alias = "customer", alias = "customer_ref")]
    customer_ref: Option<String>,
    #[serde(alias = "termin", alias = "due_date")]
    due_date: Option<String>,
    #[serde(alias = "stav", alias = "status")]
    status: Option<String>,
    #[serde(alias = "naplanovano", alias = "scheduled_date")]
    scheduled_date: Option<String>,
    #[serde(alias = "cas_od", alias = "scheduled_time_start")]
    scheduled_time_start: Option<String>,
    #[serde(alias = "cas_do", alias = "scheduled_time_end")]
    scheduled_time_end: Option<String>,
    #[serde(alias = "dokonceno", alias = "completed_at")]
    completed_at: Option<String>,
    #[serde(alias = "trvani", alias = "duration", alias = "duration_minutes")]
    duration_minutes: Option<i32>,
    #[serde(alias = "vysledek", alias = "result")]
    result: Option<String>,
    #[serde(alias = "nalezy", alias = "findings")]
    findings: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct CsvCommunicationRow {
    #[serde(alias = "zakaznik", alias = "customer", alias = "customer_ref")]
    customer_ref: Option<String>,
    #[serde(alias = "datum", alias = "date")]
    date: Option<String>,
    #[serde(alias = "typ", alias = "type", alias = "comm_type")]
    comm_type: Option<String>,
    #[serde(alias = "smer", alias = "direction")]
    direction: Option<String>,
    #[serde(alias = "predmet", alias = "subject")]
    subject: Option<String>,
    #[serde(alias = "obsah", alias = "content")]
    content: Option<String>,
    #[serde(alias = "kontakt_jmeno", alias = "contact_name")]
    contact_name: Option<String>,
    #[serde(alias = "kontakt_telefon", alias = "contact_phone")]
    contact_phone: Option<String>,
    #[serde(alias = "trvani", alias = "duration", alias = "duration_minutes")]
    duration_minutes: Option<i32>,
}

#[derive(Debug, serde::Deserialize)]
struct CsvVisitRow {
    #[serde(alias = "zakaznik", alias = "customer", alias = "customer_ref")]
    customer_ref: Option<String>,
    #[serde(alias = "zarizeni", alias = "device", alias = "device_ref")]
    device_ref: Option<String>,
    #[serde(alias = "datum", alias = "scheduled_date")]
    scheduled_date: Option<String>,
    #[serde(alias = "cas_od", alias = "scheduled_time_start")]
    scheduled_time_start: Option<String>,
    #[serde(alias = "cas_do", alias = "scheduled_time_end")]
    scheduled_time_end: Option<String>,
    #[serde(alias = "typ", alias = "type", alias = "visit_type")]
    visit_type: Option<String>,
    #[serde(alias = "stav", alias = "status")]
    status: Option<String>,
    #[serde(alias = "vysledek", alias = "result")]
    result: Option<String>,
    #[serde(alias = "poznamky", alias = "result_notes")]
    result_notes: Option<String>,
    #[serde(alias = "vyzaduje_navstevu", alias = "requires_follow_up")]
    requires_follow_up: Option<String>,
    #[serde(alias = "duvod_navstevy", alias = "follow_up_reason")]
    follow_up_reason: Option<String>,
}

// =============================================================================
// DEVICE IMPORT PROCESSOR
// =============================================================================

const DEVICE_IMPORT_STREAM: &str = "SAZINKA_DEVICE_IMPORT_JOBS";
const DEVICE_IMPORT_CONSUMER: &str = "device_import_workers";
const DEVICE_IMPORT_SUBJECT: &str = "sazinka.jobs.import.device";
const DEVICE_IMPORT_STATUS_PREFIX: &str = "sazinka.job.import.device.status";

pub struct DeviceImportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    pending_count: AtomicU32,
}

impl DeviceImportProcessor {
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        let stream_config = jetstream::stream::Config {
            name: DEVICE_IMPORT_STREAM.to_string(),
            subjects: vec![DEVICE_IMPORT_SUBJECT.to_string()],
            max_messages: 1_000,
            max_bytes: 500 * 1024 * 1024,
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream device import stream '{}' ready", DEVICE_IMPORT_STREAM);
        
        Ok(Self {
            client,
            js,
            pool,
            pending_count: AtomicU32::new(0),
        })
    }
    
    pub async fn submit_job(&self, user_id: Uuid, request: DeviceImportJobRequest) -> Result<DeviceImportJobSubmitResponse> {
        let job = QueuedDeviceImportJob::new(user_id, request);
        let job_id = job.id;
        
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(DEVICE_IMPORT_SUBJECT, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        
        info!("Device import job {} submitted, position {} in queue", job_id, pending);
        
        self.publish_status(job_id, DeviceImportJobStatus::Queued { position: pending }).await?;
        
        Ok(DeviceImportJobSubmitResponse {
            job_id,
            message: "import:job_queued".to_string(),
        })
    }
    
    pub async fn publish_status(&self, job_id: Uuid, status: DeviceImportJobStatus) -> Result<()> {
        let update = DeviceImportJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", DEVICE_IMPORT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(DEVICE_IMPORT_STREAM).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(DEVICE_IMPORT_CONSUMER.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(DEVICE_IMPORT_CONSUMER, consumer_config).await?;
        info!("JetStream device import consumer '{}' ready", DEVICE_IMPORT_CONSUMER);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    tokio::spawn(async move {
                        if let Err(e) = processor.process_job(msg).await {
                            error!("Failed to process device import job: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Error receiving device import message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::cancellation::CANCELLATION;
        
        let job: QueuedDeviceImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
        let _guard = CANCELLATION.register(job_id, user_id);
        if CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            self.publish_status(job_id, DeviceImportJobStatus::Cancelled { processed: 0, total: 0 }).await?;
            JOB_HISTORY.record_cancelled(job_id, "import.device", user_id, started_at);
            return Ok(());
        }
        
        info!("Processing device import job {} from file '{}'", job_id, job.request.filename);
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // ACK immediately to prevent redelivery during long processing
        if let Err(e) = msg.ack().await {
            error!("Failed to ack device import job {}: {:?}", job_id, e);
        }
        
        self.publish_status(job_id, DeviceImportJobStatus::Parsing { progress: 0 }).await?;
        
        let rows = match self.parse_csv(&job.request.csv_content).await {
            Ok(rows) => rows,
            Err(e) => {
                let error_msg = json!({"key": "import:csv_parse_error", "params": {"error": e.to_string()}}).to_string();
                self.publish_status(job_id, DeviceImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.device", user_id, started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "import:csv_empty".to_string();
            self.publish_status(job_id, DeviceImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.device", user_id, started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, DeviceImportJobStatus::Parsing { progress: 100 }).await?;
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues: Vec<ImportIssue> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
            if idx % 50 == 0 && CANCELLATION.is_cancelled(&job_id) {
                self.publish_status(job_id, DeviceImportJobStatus::Cancelled { processed: idx as u32, total }).await?;
                JOB_HISTORY.record_cancelled(job_id, "import.device", user_id, started_at);
                return Ok(());
            }
            
            if processed % 10 == 0 || processed == total {
                self.publish_status(job_id, DeviceImportJobStatus::Importing {
                    processed,
                    total,
                    succeeded,
                    failed,
                }).await?;
            }
            
            match self.create_device(user_id, row).await {
                Ok(_) => succeeded += 1,
                Err(e) => {
                    failed += 1;
                    let row_num = (idx + 2) as i32;
                    let err_msg = e.to_string();
                    let (code, field) = classify_error(&err_msg);
                    issues.push(ImportIssue {
                        row_number: row_num,
                        level: ImportIssueLevel::Error,
                        code,
                        field: field.to_string(),
                        message: err_msg,
                        original_value: None,
                    });
                }
            }
        }
        
        let report = build_import_report(
            job_id, "import.device", &job.request.filename,
            started_at, total, succeeded, failed, issues,
        );
        persist_report(&report);
        
        self.publish_status(job_id, DeviceImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.device",
            user_id,
            started_at,
            Some(json!({"key": "import:completed_summary", "params": {"succeeded": succeeded, "total": total}}).to_string()),
        );
        
        info!("Device import job {} completed: {}/{} succeeded", job_id, succeeded, total);
        
        Ok(())
    }
    
    async fn parse_csv(&self, content: &str) -> Result<Vec<CsvDeviceRow>> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(content.as_bytes());
        
        let mut rows = Vec::new();
        for result in reader.deserialize() {
            let row: CsvDeviceRow = result?;
            rows.push(row);
        }
        Ok(rows)
    }
    
    async fn create_device(&self, user_id: Uuid, row: &CsvDeviceRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_customer_ref"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("{}", json!({"key": "import:customer_not_found", "params": {"name": customer_ref}})))?;
        
        let device_type_str = row.device_type.as_deref().unwrap_or("other");
        let device_type = parse_device_type(device_type_str);
        
        let revision_interval = row.revision_interval_months.unwrap_or(12);
        
        let installation_date = row.installation_date.as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                .or_else(|| NaiveDate::parse_from_str(d, "%d.%m.%Y").ok()));
        
        let request = CreateDeviceRequest {
            customer_id,
            device_type: device_type.to_string(),
            device_name: None,
            manufacturer: row.manufacturer.clone(),
            model: row.model.clone(),
            serial_number: row.serial_number.clone(),
            installation_date,
            revision_interval_months: revision_interval,
            notes: row.notes.clone(),
        };
        
        let device = queries::device::create_device(
            &self.pool,
            user_id,
            customer_id,
            &request,
        ).await?;
        
        Ok(device.id)
    }
}

pub async fn handle_device_import_submit(
    client: Client,
    mut subscriber: Subscriber,
    jwt_secret: Arc<String>,
    processor: Arc<DeviceImportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<DeviceImportJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse device import submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
                error!("Failed to submit device import job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

// =============================================================================
// REVISION IMPORT PROCESSOR
// =============================================================================

const REVISION_IMPORT_STREAM: &str = "SAZINKA_REVISION_IMPORT_JOBS";
const REVISION_IMPORT_CONSUMER: &str = "revision_import_workers";
const REVISION_IMPORT_SUBJECT: &str = "sazinka.jobs.import.revision";
const REVISION_IMPORT_STATUS_PREFIX: &str = "sazinka.job.import.revision.status";

pub struct RevisionImportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    pending_count: AtomicU32,
}

impl RevisionImportProcessor {
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        let stream_config = jetstream::stream::Config {
            name: REVISION_IMPORT_STREAM.to_string(),
            subjects: vec![REVISION_IMPORT_SUBJECT.to_string()],
            max_messages: 1_000,
            max_bytes: 500 * 1024 * 1024,
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream revision import stream '{}' ready", REVISION_IMPORT_STREAM);
        
        Ok(Self {
            client,
            js,
            pool,
            pending_count: AtomicU32::new(0),
        })
    }
    
    pub async fn submit_job(&self, user_id: Uuid, request: RevisionImportJobRequest) -> Result<RevisionImportJobSubmitResponse> {
        let job = QueuedRevisionImportJob::new(user_id, request);
        let job_id = job.id;
        
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(REVISION_IMPORT_SUBJECT, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        
        info!("Revision import job {} submitted, position {} in queue", job_id, pending);
        
        self.publish_status(job_id, RevisionImportJobStatus::Queued { position: pending }).await?;
        
        Ok(RevisionImportJobSubmitResponse {
            job_id,
            message: "import:job_queued".to_string(),
        })
    }
    
    pub async fn publish_status(&self, job_id: Uuid, status: RevisionImportJobStatus) -> Result<()> {
        let update = RevisionImportJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", REVISION_IMPORT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(REVISION_IMPORT_STREAM).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(REVISION_IMPORT_CONSUMER.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(REVISION_IMPORT_CONSUMER, consumer_config).await?;
        info!("JetStream revision import consumer '{}' ready", REVISION_IMPORT_CONSUMER);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    tokio::spawn(async move {
                        if let Err(e) = processor.process_job(msg).await {
                            error!("Failed to process revision import job: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Error receiving revision import message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::cancellation::CANCELLATION;
        
        let job: QueuedRevisionImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
        let _guard = CANCELLATION.register(job_id, user_id);
        if CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            self.publish_status(job_id, RevisionImportJobStatus::Cancelled { processed: 0, total: 0 }).await?;
            JOB_HISTORY.record_cancelled(job_id, "import.revision", user_id, started_at);
            return Ok(());
        }
        
        info!("Processing revision import job {} from file '{}'", job_id, job.request.filename);
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // ACK immediately to prevent redelivery during long processing
        if let Err(e) = msg.ack().await {
            error!("Failed to ack revision import job {}: {:?}", job_id, e);
        }
        
        self.publish_status(job_id, RevisionImportJobStatus::Parsing { progress: 0 }).await?;
        
        let rows = match self.parse_csv(&job.request.csv_content).await {
            Ok(rows) => rows,
            Err(e) => {
                let error_msg = json!({"key": "import:csv_parse_error", "params": {"error": e.to_string()}}).to_string();
                self.publish_status(job_id, RevisionImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.revision", user_id, started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "import:csv_empty".to_string();
            self.publish_status(job_id, RevisionImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.revision", user_id, started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, RevisionImportJobStatus::Parsing { progress: 100 }).await?;
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues: Vec<ImportIssue> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
            if idx % 50 == 0 && CANCELLATION.is_cancelled(&job_id) {
                self.publish_status(job_id, RevisionImportJobStatus::Cancelled { processed: idx as u32, total }).await?;
                JOB_HISTORY.record_cancelled(job_id, "import.revision", user_id, started_at);
                return Ok(());
            }
            
            if processed % 10 == 0 || processed == total {
                self.publish_status(job_id, RevisionImportJobStatus::Importing {
                    processed,
                    total,
                    succeeded,
                    failed,
                }).await?;
            }
            
            match self.create_revision(user_id, row, (idx + 2) as i32, &mut issues).await {
                Ok(_) => succeeded += 1,
                Err(e) => {
                    failed += 1;
                    let row_num = (idx + 2) as i32;
                    let err_msg = e.to_string();
                    let (code, field) = classify_error(&err_msg);
                    issues.push(ImportIssue {
                        row_number: row_num,
                        level: ImportIssueLevel::Error,
                        code,
                        field: field.to_string(),
                        message: err_msg,
                        original_value: None,
                    });
                }
            }
        }
        
        let report = build_import_report(
            job_id, "import.revision", &job.request.filename,
            started_at, total, succeeded, failed, issues,
        );
        persist_report(&report);
        
        self.publish_status(job_id, RevisionImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.revision",
            user_id,
            started_at,
            Some(json!({"key": "import:completed_summary", "params": {"succeeded": succeeded, "total": total}}).to_string()),
        );
        
        info!("Revision import job {} completed: {}/{} succeeded", job_id, succeeded, total);
        
        Ok(())
    }
    
    async fn parse_csv(&self, content: &str) -> Result<Vec<CsvRevisionRow>> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(content.as_bytes());
        
        let mut rows = Vec::new();
        for result in reader.deserialize() {
            let row: CsvRevisionRow = result?;
            rows.push(row);
        }
        Ok(rows)
    }
    
    /// Create a revision from a CSV row. Uses upsert logic to handle duplicates gracefully.
    async fn create_revision(&self, user_id: Uuid, row: &CsvRevisionRow, row_num: i32, issues: &mut Vec<ImportIssue>) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_customer_ref"))?;
        let device_ref = row.device_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_device_ref"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("{}", json!({"key": "import:customer_not_found", "params": {"name": customer_ref}})))?;
        
        let device_id = resolve_device_ref(&self.pool, user_id, customer_id, device_ref).await?
            .ok_or_else(|| anyhow::anyhow!("{}", json!({"key": "import:device_not_found", "params": {"name": device_ref}})))?;
        
        let due_date_str = row.due_date.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_due_date"))?;
        let due_date = NaiveDate::parse_from_str(due_date_str, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(due_date_str, "%d.%m.%Y"))
            .map_err(|_| anyhow::anyhow!("{}", json!({"key": "import:invalid_date_format", "params": {"value": due_date_str}})))?;
        
        let scheduled_date = row.scheduled_date.as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                .or_else(|| NaiveDate::parse_from_str(d, "%d.%m.%Y").ok()));
        
        let scheduled_time_start = row.scheduled_time_start.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()
                .or_else(|| NaiveTime::parse_from_str(t, "%H:%M:%S").ok()));
        
        let scheduled_time_end = row.scheduled_time_end.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()
                .or_else(|| NaiveTime::parse_from_str(t, "%H:%M:%S").ok()));
        
        // Parse completed_at from row
        let completed_at = row.completed_at.as_ref().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s).ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .or_else(|| {
                    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok()
                        .map(|ndt| chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc))
                })
        });

        // Check for existing revision (same device + due_date) to handle duplicates
        let existing = queries::import::find_revision_by_device_and_date(
            &self.pool, device_id, due_date
        ).await?;
        
        if existing.is_some() {
            // Record as warning, not error - the revision already exists
            issues.push(ImportIssue {
                row_number: row_num,
                level: ImportIssueLevel::Warning,
                code: ImportIssueCode::DuplicateRecord,
                field: "device_ref+due_date".to_string(),
                message: json!({"key": "import:revision_already_exists", "params": {"device": device_ref, "dueDate": due_date.to_string()}}).to_string(),
                original_value: Some(format!("{} / {}", device_ref, due_date_str)),
            });
            return Ok(existing.unwrap());
        }

        let request = CreateRevisionRequest {
            device_id,
            customer_id,
            due_date,
            status: row.status.clone(),
            scheduled_date,
            scheduled_time_start,
            scheduled_time_end,
            completed_at,
            duration_minutes: row.duration_minutes,
            result: row.result.clone(),
            findings: row.findings.clone(),
        };
        
        let revision = queries::revision::create_revision(
            &self.pool,
            user_id,
            &request,
        ).await?;
        
        Ok(revision.id)
    }
}

pub async fn handle_revision_import_submit(
    client: Client,
    mut subscriber: Subscriber,
    jwt_secret: Arc<String>,
    processor: Arc<RevisionImportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<RevisionImportJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse revision import submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
                error!("Failed to submit revision import job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

// =============================================================================
// COMMUNICATION IMPORT PROCESSOR
// =============================================================================

const COMMUNICATION_IMPORT_STREAM: &str = "SAZINKA_COMMUNICATION_IMPORT_JOBS";
const COMMUNICATION_IMPORT_CONSUMER: &str = "communication_import_workers";
const COMMUNICATION_IMPORT_SUBJECT: &str = "sazinka.jobs.import.communication";
const COMMUNICATION_IMPORT_STATUS_PREFIX: &str = "sazinka.job.import.communication.status";

pub struct CommunicationImportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    pending_count: AtomicU32,
}

impl CommunicationImportProcessor {
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        let stream_config = jetstream::stream::Config {
            name: COMMUNICATION_IMPORT_STREAM.to_string(),
            subjects: vec![COMMUNICATION_IMPORT_SUBJECT.to_string()],
            max_messages: 1_000,
            max_bytes: 500 * 1024 * 1024,
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream communication import stream '{}' ready", COMMUNICATION_IMPORT_STREAM);
        
        Ok(Self {
            client,
            js,
            pool,
            pending_count: AtomicU32::new(0),
        })
    }
    
    pub async fn submit_job(&self, user_id: Uuid, request: CommunicationImportJobRequest) -> Result<CommunicationImportJobSubmitResponse> {
        let job = QueuedCommunicationImportJob::new(user_id, request);
        let job_id = job.id;
        
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(COMMUNICATION_IMPORT_SUBJECT, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        
        info!("Communication import job {} submitted, position {} in queue", job_id, pending);
        
        self.publish_status(job_id, CommunicationImportJobStatus::Queued { position: pending }).await?;
        
        Ok(CommunicationImportJobSubmitResponse {
            job_id,
            message: "import:job_queued".to_string(),
        })
    }
    
    pub async fn publish_status(&self, job_id: Uuid, status: CommunicationImportJobStatus) -> Result<()> {
        let update = CommunicationImportJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", COMMUNICATION_IMPORT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(COMMUNICATION_IMPORT_STREAM).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(COMMUNICATION_IMPORT_CONSUMER.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(COMMUNICATION_IMPORT_CONSUMER, consumer_config).await?;
        info!("JetStream communication import consumer '{}' ready", COMMUNICATION_IMPORT_CONSUMER);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    tokio::spawn(async move {
                        if let Err(e) = processor.process_job(msg).await {
                            error!("Failed to process communication import job: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Error receiving communication import message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::cancellation::CANCELLATION;
        
        let job: QueuedCommunicationImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
        let _guard = CANCELLATION.register(job_id, user_id);
        if CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            self.publish_status(job_id, CommunicationImportJobStatus::Cancelled { processed: 0, total: 0 }).await?;
            JOB_HISTORY.record_cancelled(job_id, "import.communication", user_id, started_at);
            return Ok(());
        }
        
        info!("Processing communication import job {} from file '{}'", job_id, job.request.filename);
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // ACK immediately to prevent redelivery during long processing
        if let Err(e) = msg.ack().await {
            error!("Failed to ack communication import job {}: {:?}", job_id, e);
        }
        
        self.publish_status(job_id, CommunicationImportJobStatus::Parsing { progress: 0 }).await?;
        
        let rows = match self.parse_csv(&job.request.csv_content).await {
            Ok(rows) => rows,
            Err(e) => {
                let error_msg = json!({"key": "import:csv_parse_error", "params": {"error": e.to_string()}}).to_string();
                self.publish_status(job_id, CommunicationImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.communication", user_id, started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "import:csv_empty".to_string();
            self.publish_status(job_id, CommunicationImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.communication", user_id, started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, CommunicationImportJobStatus::Parsing { progress: 100 }).await?;
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues: Vec<ImportIssue> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
            if idx % 50 == 0 && CANCELLATION.is_cancelled(&job_id) {
                self.publish_status(job_id, CommunicationImportJobStatus::Cancelled { processed: idx as u32, total }).await?;
                JOB_HISTORY.record_cancelled(job_id, "import.communication", user_id, started_at);
                return Ok(());
            }
            
            if processed % 10 == 0 || processed == total {
                self.publish_status(job_id, CommunicationImportJobStatus::Importing {
                    processed,
                    total,
                    succeeded,
                    failed,
                }).await?;
            }
            
            match self.create_communication(user_id, row).await {
                Ok(_) => succeeded += 1,
                Err(e) => {
                    failed += 1;
                    let row_num = (idx + 2) as i32;
                    let err_msg = e.to_string();
                    let (code, field) = classify_error(&err_msg);
                    issues.push(ImportIssue {
                        row_number: row_num,
                        level: ImportIssueLevel::Error,
                        code,
                        field: field.to_string(),
                        message: err_msg,
                        original_value: None,
                    });
                }
            }
        }
        
        let report = build_import_report(
            job_id, "import.communication", &job.request.filename,
            started_at, total, succeeded, failed, issues,
        );
        persist_report(&report);
        
        self.publish_status(job_id, CommunicationImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.communication",
            user_id,
            started_at,
            Some(json!({"key": "import:completed_summary", "params": {"succeeded": succeeded, "total": total}}).to_string()),
        );
        
        info!("Communication import job {} completed: {}/{} succeeded", job_id, succeeded, total);
        
        Ok(())
    }
    
    async fn parse_csv(&self, content: &str) -> Result<Vec<CsvCommunicationRow>> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(content.as_bytes());
        
        let mut rows = Vec::new();
        for result in reader.deserialize() {
            let row: CsvCommunicationRow = result?;
            rows.push(row);
        }
        Ok(rows)
    }
    
    async fn create_communication(&self, user_id: Uuid, row: &CsvCommunicationRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_customer_ref"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("{}", json!({"key": "import:customer_not_found", "params": {"name": customer_ref}})))?;
        
        let comm_type = parse_communication_type(row.comm_type.as_deref().unwrap_or("note"));
        let direction = parse_communication_direction(row.direction.as_deref().unwrap_or("outbound"));
        
        let content = row.content.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_content"))?;
        
        let communication = queries::communication::create_communication(
            &self.pool,
            user_id,
            customer_id,
            None, // revision_id
            comm_type,
            direction,
            row.subject.as_deref(),
            content,
            row.contact_name.as_deref(),
            row.contact_phone.as_deref(),
            row.duration_minutes,
            None, // follow_up_date
        ).await?;
        
        Ok(communication.id)
    }
}

pub async fn handle_communication_import_submit(
    client: Client,
    mut subscriber: Subscriber,
    jwt_secret: Arc<String>,
    processor: Arc<CommunicationImportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<CommunicationImportJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse communication import submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
                error!("Failed to submit communication import job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

// =============================================================================
// VISIT IMPORT PROCESSOR
// =============================================================================

const VISIT_IMPORT_STREAM: &str = "SAZINKA_VISIT_IMPORT_JOBS";
const VISIT_IMPORT_CONSUMER: &str = "visit_import_workers";
const VISIT_IMPORT_SUBJECT: &str = "sazinka.jobs.import.visit";
const VISIT_IMPORT_STATUS_PREFIX: &str = "sazinka.job.import.visit.status";

pub struct WorkLogImportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    pending_count: AtomicU32,
}

impl WorkLogImportProcessor {
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        let stream_config = jetstream::stream::Config {
            name: VISIT_IMPORT_STREAM.to_string(),
            subjects: vec![VISIT_IMPORT_SUBJECT.to_string()],
            max_messages: 1_000,
            max_bytes: 500 * 1024 * 1024,
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream visit import stream '{}' ready", VISIT_IMPORT_STREAM);
        
        Ok(Self {
            client,
            js,
            pool,
            pending_count: AtomicU32::new(0),
        })
    }
    
    pub async fn submit_job(&self, user_id: Uuid, request: WorkLogImportJobRequest) -> Result<WorkLogImportJobSubmitResponse> {
        let job = QueuedWorkLogImportJob::new(user_id, request);
        let job_id = job.id;
        
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(VISIT_IMPORT_SUBJECT, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        
        info!("Visit import job {} submitted, position {} in queue", job_id, pending);
        
        self.publish_status(job_id, WorkLogImportJobStatus::Queued { position: pending }).await?;
        
        Ok(WorkLogImportJobSubmitResponse {
            job_id,
            message: "import:job_queued".to_string(),
        })
    }
    
    pub async fn publish_status(&self, job_id: Uuid, status: WorkLogImportJobStatus) -> Result<()> {
        let update = WorkLogImportJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", VISIT_IMPORT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(VISIT_IMPORT_STREAM).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(VISIT_IMPORT_CONSUMER.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(VISIT_IMPORT_CONSUMER, consumer_config).await?;
        info!("JetStream visit import consumer '{}' ready", VISIT_IMPORT_CONSUMER);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    tokio::spawn(async move {
                        if let Err(e) = processor.process_job(msg).await {
                            error!("Failed to process visit import job: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Error receiving visit import message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::cancellation::CANCELLATION;
        
        let job: QueuedWorkLogImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
        let _guard = CANCELLATION.register(job_id, user_id);
        if CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            self.publish_status(job_id, WorkLogImportJobStatus::Cancelled { processed: 0, total: 0 }).await?;
            JOB_HISTORY.record_cancelled(job_id, "import.visit", user_id, started_at);
            return Ok(());
        }
        
        info!("Processing visit import job {} from file '{}'", job_id, job.request.filename);
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // ACK immediately to prevent redelivery during long processing
        if let Err(e) = msg.ack().await {
            error!("Failed to ack visit import job {}: {:?}", job_id, e);
        }
        
        self.publish_status(job_id, WorkLogImportJobStatus::Parsing { progress: 0 }).await?;
        
        let rows = match self.parse_csv(&job.request.csv_content).await {
            Ok(rows) => rows,
            Err(e) => {
                let error_msg = json!({"key": "import:csv_parse_error", "params": {"error": e.to_string()}}).to_string();
                self.publish_status(job_id, WorkLogImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.visit", user_id, started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "import:csv_empty".to_string();
            self.publish_status(job_id, WorkLogImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.visit", user_id, started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, WorkLogImportJobStatus::Parsing { progress: 100 }).await?;
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues: Vec<ImportIssue> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
            if idx % 50 == 0 && CANCELLATION.is_cancelled(&job_id) {
                self.publish_status(job_id, WorkLogImportJobStatus::Cancelled { processed: idx as u32, total }).await?;
                JOB_HISTORY.record_cancelled(job_id, "import.visit", user_id, started_at);
                return Ok(());
            }
            
            if processed % 10 == 0 || processed == total {
                self.publish_status(job_id, WorkLogImportJobStatus::Importing {
                    processed,
                    total,
                    succeeded,
                    failed,
                }).await?;
            }
            
            match self.create_visit(user_id, row).await {
                Ok(_) => succeeded += 1,
                Err(e) => {
                    failed += 1;
                    let row_num = (idx + 2) as i32;
                    let err_msg = e.to_string();
                    let (code, field) = classify_error(&err_msg);
                    issues.push(ImportIssue {
                        row_number: row_num,
                        level: ImportIssueLevel::Error,
                        code,
                        field: field.to_string(),
                        message: err_msg,
                        original_value: None,
                    });
                }
            }
        }
        
        let report = build_import_report(
            job_id, "import.visit", &job.request.filename,
            started_at, total, succeeded, failed, issues,
        );
        persist_report(&report);
        
        self.publish_status(job_id, WorkLogImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.visit",
            user_id,
            started_at,
            Some(json!({"key": "import:completed_summary", "params": {"succeeded": succeeded, "total": total}}).to_string()),
        );
        
        info!("Visit import job {} completed: {}/{} succeeded", job_id, succeeded, total);
        
        Ok(())
    }
    
    async fn parse_csv(&self, content: &str) -> Result<Vec<CsvVisitRow>> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(content.as_bytes());
        
        let mut rows = Vec::new();
        for result in reader.deserialize() {
            let row: CsvVisitRow = result?;
            rows.push(row);
        }
        Ok(rows)
    }
    
    async fn create_visit(&self, user_id: Uuid, row: &CsvVisitRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_customer_ref"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("{}", json!({"key": "import:customer_not_found", "params": {"name": customer_ref}})))?;
        
        let scheduled_date_str = row.scheduled_date.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_visit_date"))?;
        let scheduled_date = NaiveDate::parse_from_str(scheduled_date_str, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(scheduled_date_str, "%d.%m.%Y"))
            .map_err(|_| anyhow::anyhow!("{}", json!({"key": "import:invalid_date_format", "params": {"value": scheduled_date_str}})))?;
        
        let scheduled_time_start = row.scheduled_time_start.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()
                .or_else(|| NaiveTime::parse_from_str(t, "%H:%M:%S").ok()));
        
        let scheduled_time_end = row.scheduled_time_end.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()
                .or_else(|| NaiveTime::parse_from_str(t, "%H:%M:%S").ok()));
        
        let visit_type = parse_visit_type(row.visit_type.as_deref().unwrap_or("revision"));
        
        let status = row.status.as_deref()
            .and_then(parse_visit_status_str);
        
        let visit = queries::visit::create_visit(
            &self.pool,
            user_id,
            customer_id,
            None, // crew_id
            None, // device_id
            scheduled_date,
            scheduled_time_start,
            scheduled_time_end,
            visit_type,
            status,
        ).await?;
        
        Ok(visit.id)
    }
}

pub async fn handle_work_log_import_submit(
    client: Client,
    mut subscriber: Subscriber,
    jwt_secret: Arc<String>,
    processor: Arc<WorkLogImportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<WorkLogImportJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse visit import submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
                error!("Failed to submit visit import job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

// =============================================================================
// ZIP IMPORT PROCESSOR
// =============================================================================

const ZIP_IMPORT_STREAM: &str = "SAZINKA_ZIP_IMPORT_JOBS";
const ZIP_IMPORT_CONSUMER: &str = "zip_import_workers";
const ZIP_IMPORT_SUBJECT: &str = "sazinka.jobs.import.zip";
const ZIP_IMPORT_STATUS_PREFIX: &str = "sazinka.job.import.zip.status";

pub struct ZipImportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    pending_count: AtomicU32,
}

impl ZipImportProcessor {
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        let stream_config = jetstream::stream::Config {
            name: ZIP_IMPORT_STREAM.to_string(),
            subjects: vec![ZIP_IMPORT_SUBJECT.to_string()],
            max_messages: 100,
            max_bytes: 1024 * 1024 * 1024, // 1 GB (ZIP files can be large)
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream ZIP import stream '{}' ready", ZIP_IMPORT_STREAM);
        
        Ok(Self {
            client,
            js,
            pool,
            pending_count: AtomicU32::new(0),
        })
    }
    
    pub async fn submit_job(&self, user_id: Uuid, request: ZipImportJobRequest) -> Result<ZipImportJobSubmitResponse> {
        // First, analyze the ZIP to detect files
        let zip_data = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &request.zip_content_base64
        )?;
        
        let detected_files = self.analyze_zip(&zip_data)?;
        
        if detected_files.is_empty() {
            return Err(anyhow::anyhow!("import:zip_no_csv_files"));
        }
        
        let job = QueuedZipImportJob::new(user_id, request, detected_files.clone());
        let job_id = job.id;
        
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(ZIP_IMPORT_SUBJECT, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        
        info!("ZIP import job {} submitted with {} files, position {} in queue", 
              job_id, detected_files.len(), pending);
        
        self.publish_status(job_id, ZipImportJobStatus::Queued { position: pending }).await?;
        
        Ok(ZipImportJobSubmitResponse {
            job_id,
            message: json!({"key": "import:zip_job_queued", "params": {"fileCount": detected_files.len()}}).to_string(),
            detected_files,
        })
    }
    
    fn analyze_zip(&self, zip_data: &[u8]) -> Result<Vec<ZipImportFileInfo>> {
        let cursor = Cursor::new(zip_data);
        let mut archive = zip::ZipArchive::new(cursor)?;
        
        let mut files = Vec::new();
        
        for i in 0..archive.len() {
            let file = archive.by_index(i)?;
            let name = file.name().to_string();
            
            // Skip directories and non-CSV files
            if file.is_dir() || !name.to_lowercase().ends_with(".csv") {
                continue;
            }
            
            // Try to detect file type from name
            if let Some(file_type) = ZipImportFileType::from_filename(&name) {
                files.push(ZipImportFileInfo {
                    filename: name,
                    file_type,
                    size: file.size(),
                });
            } else {
                warn!("Could not detect file type for '{}', skipping", name);
            }
        }
        
        // Sort by import order
        files.sort_by_key(|f| f.file_type.import_order());
        
        Ok(files)
    }
    
    pub async fn publish_status(&self, job_id: Uuid, status: ZipImportJobStatus) -> Result<()> {
        let update = ZipImportJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", ZIP_IMPORT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(ZIP_IMPORT_STREAM).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(ZIP_IMPORT_CONSUMER.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(ZIP_IMPORT_CONSUMER, consumer_config).await?;
        info!("JetStream ZIP import consumer '{}' ready", ZIP_IMPORT_CONSUMER);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    tokio::spawn(async move {
                        if let Err(e) = processor.process_job(msg).await {
                            error!("Failed to process ZIP import job: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Error receiving ZIP import message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::cancellation::CANCELLATION;
        
        let job: QueuedZipImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        let total_files = job.files.len() as u32;
        
        let _guard = CANCELLATION.register(job_id, user_id);
        if CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            self.publish_status(job_id, ZipImportJobStatus::Cancelled { completed_files: 0, total_files }).await?;
            JOB_HISTORY.record_cancelled(job_id, "import.zip", user_id, started_at);
            return Ok(());
        }
        
        info!("Processing ZIP import job {} from file '{}' with {} files", 
              job_id, job.request.filename, total_files);
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // ACK immediately to prevent redelivery during long processing
        // Import jobs should not be retried automatically - failures are reported via status
        if let Err(e) = msg.ack().await {
            error!("Failed to ack ZIP import job {}: {:?}", job_id, e);
        }
        
        // Extract ZIP
        self.publish_status(job_id, ZipImportJobStatus::Extracting { progress: 0 }).await?;
        
        let zip_data = match base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &job.request.zip_content_base64
        ) {
            Ok(data) => data,
            Err(e) => {
                let error_msg = json!({"key": "import:zip_decode_error", "params": {"error": e.to_string()}}).to_string();
                self.publish_status(job_id, ZipImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.zip", user_id, started_at, error_msg);
                return Ok(());
            }
        };
        
        let cursor = Cursor::new(&zip_data);
        let mut archive = match zip::ZipArchive::new(cursor) {
            Ok(a) => a,
            Err(e) => {
                let error_msg = json!({"key": "import:zip_open_error", "params": {"error": e.to_string()}}).to_string();
                self.publish_status(job_id, ZipImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.zip", user_id, started_at, error_msg);
                return Ok(());
            }
        };
        
        self.publish_status(job_id, ZipImportJobStatus::Extracting { progress: 100 }).await?;
        self.publish_status(job_id, ZipImportJobStatus::Analyzing { files: job.files.clone() }).await?;
        
        // Process each file in order
        let mut results: Vec<ZipImportFileResult> = Vec::new();
        let mut completed_files = 0u32;
        
        for file_info in &job.files {
            // Check cancellation before each file
            if CANCELLATION.is_cancelled(&job_id) {
                self.publish_status(job_id, ZipImportJobStatus::Cancelled { completed_files, total_files }).await?;
                JOB_HISTORY.record_cancelled(job_id, "import.zip", user_id, started_at);
                return Ok(());
            }
            
            self.publish_status(job_id, ZipImportJobStatus::Importing {
                current_file: file_info.filename.clone(),
                current_file_type: file_info.file_type,
                file_progress: 0,
                total_files,
                completed_files,
            }).await?;
            
            // Read file content from ZIP
            let csv_content = match self.read_file_from_zip(&mut archive, &file_info.filename) {
                Ok(content) => content,
                Err(e) => {
                    warn!("Failed to read '{}' from ZIP: {}", file_info.filename, e);
                    let error_report = build_import_report(
                        job_id, &format!("import.zip.{}", file_info.file_type.type_name()),
                        &file_info.filename, started_at, 0, 0, 1,
                        vec![ImportIssue {
                            row_number: 0,
                            level: ImportIssueLevel::Error,
                            code: ImportIssueCode::ParseError,
                            field: String::new(),
                            message: json!({"key": "import:zip_read_file_error", "params": {"error": e.to_string()}}).to_string(),
                            original_value: None,
                        }],
                    );
                    results.push(ZipImportFileResult {
                        filename: file_info.filename.clone(),
                        file_type: file_info.file_type,
                        succeeded: 0,
                        failed: 1,
                        report: error_report,
                    });
                    completed_files += 1;
                    continue;
                }
            };
            
            // Import the file based on type
            let (succeeded, failed, file_issues) = match self.import_csv_by_type(
                user_id, 
                &csv_content, 
                file_info.file_type
            ).await {
                Ok((s, f, issues)) => (s, f, issues),
                Err(e) => {
                    warn!("Failed to import '{}': {}", file_info.filename, e);
                    (0, 1, vec![ImportIssue {
                        row_number: 0,
                        level: ImportIssueLevel::Error,
                        code: ImportIssueCode::Unknown,
                        field: String::new(),
                        message: e.to_string(),
                        original_value: None,
                    }])
                }
            };
            
            let file_report = build_import_report(
                job_id, &format!("import.zip.{}", file_info.file_type.type_name()),
                &file_info.filename, started_at, succeeded + failed, succeeded, failed, file_issues,
            );
            persist_report(&file_report);
            
            results.push(ZipImportFileResult {
                filename: file_info.filename.clone(),
                file_type: file_info.file_type,
                succeeded,
                failed,
                report: file_report,
            });
            
            completed_files += 1;
            
            self.publish_status(job_id, ZipImportJobStatus::Importing {
                current_file: file_info.filename.clone(),
                current_file_type: file_info.file_type,
                file_progress: 100,
                total_files,
                completed_files,
            }).await?;
        }
        
        // Publish completion
        self.publish_status(job_id, ZipImportJobStatus::Completed {
            total_files,
            results: results.clone(),
        }).await?;
        
        let total_succeeded: u32 = results.iter().map(|r| r.succeeded).sum();
        let total_failed: u32 = results.iter().map(|r| r.failed).sum();
        
        // Check if customers were imported and trigger geocoding
        let customers_imported = results.iter()
            .find(|r| r.file_type == ZipImportFileType::Customers)
            .map(|r| r.succeeded)
            .unwrap_or(0);
        
        if customers_imported > 0 {
            if let Err(e) = self.trigger_geocoding(user_id).await {
                warn!("Failed to trigger geocoding after ZIP import: {}", e);
            }
        }
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.zip",
            user_id,
            started_at,
            Some(json!({"key": "import:zip_completed_summary", "params": {"files": total_files, "succeeded": total_succeeded, "failed": total_failed}}).to_string()),
        );
        
        info!("ZIP import job {} completed: {} files, {} succeeded, {} failed", 
              job_id, total_files, total_succeeded, total_failed);
        
        Ok(())
    }
    
    fn read_file_from_zip(&self, archive: &mut zip::ZipArchive<Cursor<&Vec<u8>>>, filename: &str) -> Result<String> {
        let mut file = archive.by_name(filename)?;
        let mut content = String::new();
        file.read_to_string(&mut content)?;
        Ok(content)
    }
    
    async fn import_csv_by_type(&self, user_id: Uuid, csv_content: &str, file_type: ZipImportFileType) -> Result<(u32, u32, Vec<ImportIssue>)> {
        match file_type {
            ZipImportFileType::Customers => {
                self.import_customers(user_id, csv_content).await
            }
            ZipImportFileType::Devices => {
                self.import_devices(user_id, csv_content).await
            }
            ZipImportFileType::Revisions => {
                self.import_revisions(user_id, csv_content).await
            }
            ZipImportFileType::Communications => {
                self.import_communications(user_id, csv_content).await
            }
            ZipImportFileType::WorkLog => {
                self.import_visits(user_id, csv_content).await
            }
        }
    }
    
    async fn import_customers(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32, Vec<ImportIssue>)> {
        use super::import::CsvCustomerRow;
        
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues = Vec::new();
        
        for (idx, result) in reader.deserialize::<CsvCustomerRow>().enumerate() {
            let row_num = (idx + 2) as i32;
            match result {
                Ok(row) => {
                    match self.create_customer_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(e) => {
                            failed += 1;
                            let err_msg = e.to_string();
                            let (code, field) = classify_error(&err_msg);
                            issues.push(ImportIssue {
                                row_number: row_num,
                                level: ImportIssueLevel::Error,
                                code, field: field.to_string(),
                                message: err_msg, original_value: None,
                            });
                        }
                    }
                }
                Err(e) => {
                    failed += 1;
                    issues.push(ImportIssue {
                        row_number: row_num,
                        level: ImportIssueLevel::Error,
                        code: ImportIssueCode::ParseError,
                        field: String::new(),
                        message: e.to_string(),
                        original_value: None,
                    });
                }
            }
        }
        
        Ok((succeeded, failed, issues))
    }
    
    async fn create_customer_from_row(&self, user_id: Uuid, row: &super::import::CsvCustomerRow) -> Result<Uuid> {
        let customer_type = if row.ico.is_some() || row.dic.is_some() || row.contact_person.is_some() {
            CustomerType::Company
        } else {
            CustomerType::Person
        };
        
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
        
        let email = row.email.as_ref().map(|e| e.to_lowercase());
        
        let request = CreateCustomerRequest {
            customer_type: Some(customer_type),
            name: Some(row.name.clone()),
            contact_person: row.contact_person.clone(),
            ico: row.ico.clone(),
            dic: row.dic.clone(),
            email,
            phone,
            phone_raw: row.phone.clone(),
            street: row.street.clone(),
            city: row.city.clone(),
            postal_code: row.postal_code.clone(),
            country: row.country.clone(),
            lat: None,
            lng: None,
            notes: row.notes.clone(),
        };
        
        let customer = queries::customer::create_customer(&self.pool, user_id, &request).await?;
        Ok(customer.id)
    }
    
    async fn import_devices(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32, Vec<ImportIssue>)> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues = Vec::new();
        
        for (idx, result) in reader.deserialize::<CsvDeviceRow>().enumerate() {
            let row_num = (idx + 2) as i32;
            match result {
                Ok(row) => {
                    match self.create_device_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(e) => {
                            failed += 1;
                            let err_msg = e.to_string();
                            let (code, field) = classify_error(&err_msg);
                            issues.push(ImportIssue {
                                row_number: row_num, level: ImportIssueLevel::Error,
                                code, field: field.to_string(),
                                message: err_msg, original_value: None,
                            });
                        }
                    }
                }
                Err(e) => {
                    failed += 1;
                    issues.push(ImportIssue {
                        row_number: row_num, level: ImportIssueLevel::Error,
                        code: ImportIssueCode::ParseError, field: String::new(),
                        message: e.to_string(), original_value: None,
                    });
                }
            }
        }
        
        Ok((succeeded, failed, issues))
    }
    
    async fn create_device_from_row(&self, user_id: Uuid, row: &CsvDeviceRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_customer_ref"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("import:customer_not_found_simple"))?;
        
        let device_type = parse_device_type(row.device_type.as_deref().unwrap_or("other"));
        let revision_interval = row.revision_interval_months.unwrap_or(12);
        
        let installation_date = row.installation_date.as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                .or_else(|| NaiveDate::parse_from_str(d, "%d.%m.%Y").ok()));
        
        let request = CreateDeviceRequest {
            customer_id,
            device_type: device_type.to_string(),
            device_name: None,
            manufacturer: row.manufacturer.clone(),
            model: row.model.clone(),
            serial_number: row.serial_number.clone(),
            installation_date,
            revision_interval_months: revision_interval,
            notes: row.notes.clone(),
        };
        
        let device = queries::device::create_device(
            &self.pool,
            user_id,
            customer_id,
            &request,
        ).await?;
        
        Ok(device.id)
    }
    
    async fn import_revisions(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32, Vec<ImportIssue>)> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues = Vec::new();
        
        for (idx, result) in reader.deserialize::<CsvRevisionRow>().enumerate() {
            let row_num = (idx + 2) as i32;
            match result {
                Ok(row) => {
                    match self.create_revision_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(e) => {
                            failed += 1;
                            let err_msg = e.to_string();
                            let (code, field) = classify_error(&err_msg);
                            issues.push(ImportIssue {
                                row_number: row_num, level: ImportIssueLevel::Error,
                                code, field: field.to_string(),
                                message: err_msg, original_value: None,
                            });
                        }
                    }
                }
                Err(e) => {
                    failed += 1;
                    issues.push(ImportIssue {
                        row_number: row_num, level: ImportIssueLevel::Error,
                        code: ImportIssueCode::ParseError, field: String::new(),
                        message: e.to_string(), original_value: None,
                    });
                }
            }
        }
        
        Ok((succeeded, failed, issues))
    }
    
    async fn create_revision_from_row(&self, user_id: Uuid, row: &CsvRevisionRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_customer_ref"))?;
        let device_ref = row.device_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_device_ref"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("import:customer_not_found_simple"))?;
        let device_id = resolve_device_ref(&self.pool, user_id, customer_id, device_ref).await?
            .ok_or_else(|| anyhow::anyhow!("import:device_not_found_simple"))?;
        
        let due_date_str = row.due_date.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_due_date"))?;
        let due_date = NaiveDate::parse_from_str(due_date_str, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(due_date_str, "%d.%m.%Y"))?;
        
        let scheduled_date = row.scheduled_date.as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                .or_else(|| NaiveDate::parse_from_str(d, "%d.%m.%Y").ok()));
        
        let scheduled_time_start = row.scheduled_time_start.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
        
        let scheduled_time_end = row.scheduled_time_end.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
        
        // Parse completed_at from row
        let completed_at = row.completed_at.as_ref().and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(s).ok()
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .or_else(|| {
                    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok()
                        .map(|ndt| chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(ndt, chrono::Utc))
                })
        });

        let request = CreateRevisionRequest {
            device_id,
            customer_id,
            due_date,
            status: row.status.clone(),
            scheduled_date,
            scheduled_time_start,
            scheduled_time_end,
            completed_at,
            duration_minutes: row.duration_minutes,
            result: row.result.clone(),
            findings: row.findings.clone(),
        };
        
        let revision = queries::revision::create_revision(
            &self.pool,
            user_id,
            &request,
        ).await?;
        
        Ok(revision.id)
    }
    
    async fn import_communications(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32, Vec<ImportIssue>)> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues = Vec::new();
        
        for (idx, result) in reader.deserialize::<CsvCommunicationRow>().enumerate() {
            let row_num = (idx + 2) as i32;
            match result {
                Ok(row) => {
                    match self.create_communication_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(e) => {
                            failed += 1;
                            let err_msg = e.to_string();
                            let (code, field) = classify_error(&err_msg);
                            issues.push(ImportIssue {
                                row_number: row_num, level: ImportIssueLevel::Error,
                                code, field: field.to_string(),
                                message: err_msg, original_value: None,
                            });
                        }
                    }
                }
                Err(e) => {
                    failed += 1;
                    issues.push(ImportIssue {
                        row_number: row_num, level: ImportIssueLevel::Error,
                        code: ImportIssueCode::ParseError, field: String::new(),
                        message: e.to_string(), original_value: None,
                    });
                }
            }
        }
        
        Ok((succeeded, failed, issues))
    }
    
    async fn create_communication_from_row(&self, user_id: Uuid, row: &CsvCommunicationRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_customer_ref"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("import:customer_not_found_simple"))?;
        
        let comm_type = parse_communication_type(row.comm_type.as_deref().unwrap_or("note"));
        let direction = parse_communication_direction(row.direction.as_deref().unwrap_or("outbound"));
        
        let content = row.content.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_content"))?;
        
        let communication = queries::communication::create_communication(
            &self.pool,
            user_id,
            customer_id,
            None, // revision_id
            comm_type,
            direction,
            row.subject.as_deref(),
            content,
            row.contact_name.as_deref(),
            row.contact_phone.as_deref(),
            row.duration_minutes,
            None, // follow_up_date
        ).await?;
        
        Ok(communication.id)
    }
    
    async fn import_visits(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32, Vec<ImportIssue>)> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut issues = Vec::new();
        
        for (idx, result) in reader.deserialize::<CsvVisitRow>().enumerate() {
            let row_num = (idx + 2) as i32;
            match result {
                Ok(row) => {
                    match self.create_visit_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(e) => {
                            failed += 1;
                            let err_msg = e.to_string();
                            let (code, field) = classify_error(&err_msg);
                            issues.push(ImportIssue {
                                row_number: row_num, level: ImportIssueLevel::Error,
                                code, field: field.to_string(),
                                message: err_msg, original_value: None,
                            });
                        }
                    }
                }
                Err(e) => {
                    failed += 1;
                    issues.push(ImportIssue {
                        row_number: row_num, level: ImportIssueLevel::Error,
                        code: ImportIssueCode::ParseError, field: String::new(),
                        message: e.to_string(), original_value: None,
                    });
                }
            }
        }
        
        Ok((succeeded, failed, issues))
    }
    
    async fn create_visit_from_row(&self, user_id: Uuid, row: &CsvVisitRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_customer_ref"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("import:customer_not_found_simple"))?;
        
        let scheduled_date_str = row.scheduled_date.as_ref()
            .ok_or_else(|| anyhow::anyhow!("import:missing_date"))?;
        let scheduled_date = NaiveDate::parse_from_str(scheduled_date_str, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(scheduled_date_str, "%d.%m.%Y"))?;
        
        let scheduled_time_start = row.scheduled_time_start.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
        
        let scheduled_time_end = row.scheduled_time_end.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
        
        let visit_type = parse_visit_type(row.visit_type.as_deref().unwrap_or("revision"));
        
        let status = row.status.as_deref()
            .and_then(parse_visit_status_str);
        
        let visit = queries::visit::create_visit(
            &self.pool,
            user_id,
            customer_id,
            None, // crew_id
            None, // device_id
            scheduled_date,
            scheduled_time_start,
            scheduled_time_end,
            visit_type,
            status,
        ).await?;
        
        Ok(visit.id)
    }
    
    /// Trigger geocoding for all pending customers after import
    async fn trigger_geocoding(&self, user_id: Uuid) -> Result<()> {
        use crate::types::{GeocodeJobRequest, QueuedGeocodeJob, GeocodeJobStatus, GeocodeJobStatusUpdate};
        
        // Get customers with pending geocode status
        let pending_customers = queries::customer::list_pending_geocode(&self.pool, user_id).await?;
        
        if pending_customers.is_empty() {
            info!("No customers pending geocoding after ZIP import");
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
        
        // Publish to geocode queue
        let payload = serde_json::to_vec(&job)?;
        self.js.publish("sazinka.jobs.geocode", payload.into()).await?.await?;
        
        info!("Triggered geocoding job {} for {} customers after ZIP import", job_id, count);
        
        // Publish initial status
        let status_update = GeocodeJobStatusUpdate::new(job_id, GeocodeJobStatus::Queued { position: 1 });
        let status_subject = format!("sazinka.job.geocode.status.{}", job_id);
        let status_payload = serde_json::to_vec(&status_update)?;
        self.client.publish(status_subject, status_payload.into()).await?;
        
        Ok(())
    }
}

pub async fn handle_zip_import_submit(
    client: Client,
    mut subscriber: Subscriber,
    jwt_secret: Arc<String>,
    processor: Arc<ZipImportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<ZipImportJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse ZIP import submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
                error!("Failed to submit ZIP import job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

fn parse_device_type(s: &str) -> &'static str {
    let lower = s.to_lowercase();
    match lower.as_str() {
        "kotel" | "boiler" | "gas_boiler" => "gas_boiler",
        "plynovy_sporák" | "plynovy_sporak" | "gas_stove" => "gas_stove",
        "ohrivac" | "ohřívač" | "water_heater" | "gas_water_heater" => "gas_water_heater",
        "komín" | "komin" | "chimney" => "chimney",
        "krb" | "fireplace" => "fireplace",
        _ => "other",
    }
}

fn parse_communication_type(s: &str) -> &'static str {
    let lower = s.to_lowercase();
    match lower.as_str() {
        "telefon" | "phone" | "call" => "call",
        "email" | "e-mail" | "email_sent" => "email_sent",
        "email_prijaty" | "email_received" => "email_received",
        "sms" => "sms",
        _ => "note",
    }
}

fn parse_communication_direction(s: &str) -> &'static str {
    let lower = s.to_lowercase();
    match lower.as_str() {
        "prichozi" | "příchozí" | "incoming" | "in" | "inbound" => "inbound",
        _ => "outbound",
    }
}

fn parse_visit_type(s: &str) -> &'static str {
    let lower = s.to_lowercase();
    match lower.as_str() {
        "revize" | "revision" => "revision",
        "oprava" | "repair" => "repair",
        "instalace" | "installation" => "installation",
        "konzultace" | "consultation" => "consultation",
        "follow_up" | "followup" | "navsteva" => "follow_up",
        _ => "revision",
    }
}

fn parse_visit_status_str(s: &str) -> Option<&'static str> {
    match s.to_lowercase().as_str() {
        "planned" | "naplánováno" | "naplanovano" | "plánováno" | "planovano" => Some("planned"),
        "in_progress" | "probíhá" | "probiha" => Some("in_progress"),
        "completed" | "dokončeno" | "dokonceno" | "hotovo" => Some("completed"),
        "cancelled" | "zrušeno" | "zruseno" => Some("cancelled"),
        "rescheduled" | "přeplánováno" | "preplanovano" => Some("rescheduled"),
        _ => None,
    }
}
