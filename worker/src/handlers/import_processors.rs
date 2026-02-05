//! Async import processors for all entity types
//! Uses JetStream for reliable background job processing

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::io::{Read as IoRead, Cursor};
use anyhow::Result;
use async_nats::{Client, Subscriber};
use async_nats::jetstream::{self, Context as JsContext};
use chrono::{NaiveDate, NaiveTime};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{error, warn, info};
use uuid::Uuid;

use crate::db::queries;
use crate::types::{
    ErrorResponse, Request, SuccessResponse,
    CreateDeviceRequest, CreateRevisionRequest, CreateCustomerRequest, CustomerType,
    // Device import types
    DeviceImportJobRequest, DeviceImportJobStatus, DeviceImportJobStatusUpdate,
    DeviceImportJobSubmitResponse, QueuedDeviceImportJob,
    // Revision import types
    RevisionImportJobRequest, RevisionImportJobStatus, RevisionImportJobStatusUpdate,
    RevisionImportJobSubmitResponse, QueuedRevisionImportJob,
    // Communication import types
    CommunicationImportJobRequest, CommunicationImportJobStatus, CommunicationImportJobStatusUpdate,
    CommunicationImportJobSubmitResponse, QueuedCommunicationImportJob,
    // Visit import types
    VisitImportJobRequest, VisitImportJobStatus, VisitImportJobStatusUpdate,
    VisitImportJobSubmitResponse, QueuedVisitImportJob,
    // ZIP import types
    ZipImportJobRequest, ZipImportJobStatus, ZipImportJobStatusUpdate,
    ZipImportJobSubmitResponse, QueuedZipImportJob, ZipImportFileInfo, ZipImportFileType,
    ZipImportFileResult,
};
use crate::services::job_history::JOB_HISTORY;

use super::import::{resolve_customer_ref, resolve_device_ref};

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
            message: "Import úloha byla zařazena do fronty".to_string(),
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
        let job: QueuedDeviceImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
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
                let error_msg = format!("Chyba při parsování CSV: {}", e);
                self.publish_status(job_id, DeviceImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.device", started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "CSV soubor neobsahuje žádné záznamy".to_string();
            self.publish_status(job_id, DeviceImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.device", started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, DeviceImportJobStatus::Parsing { progress: 100 }).await?;
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut errors: Vec<String> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
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
                    let row_num = idx + 2;
                    errors.push(format!("Řádek {}: {}", row_num, e));
                }
            }
        }
        
        let report = self.generate_report(&job.request.filename, total, succeeded, failed, &errors);
        
        self.publish_status(job_id, DeviceImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.device",
            started_at,
            Some(format!("{}/{} úspěšně importováno", succeeded, total)),
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
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zákazníka"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zákazník '{}' nenalezen", customer_ref))?;
        
        let device_type_str = row.device_type.as_deref().unwrap_or("other");
        let device_type = parse_device_type(device_type_str);
        
        let revision_interval = row.revision_interval_months.unwrap_or(12);
        
        let installation_date = row.installation_date.as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                .or_else(|| NaiveDate::parse_from_str(d, "%d.%m.%Y").ok()));
        
        let request = CreateDeviceRequest {
            customer_id,
            device_type: device_type.to_string(),
            manufacturer: row.manufacturer.clone(),
            model: row.model.clone(),
            serial_number: row.serial_number.clone(),
            installation_date,
            revision_interval_months: revision_interval,
            notes: row.notes.clone(),
        };
        
        let device = queries::device::create_device(
            &self.pool,
            customer_id,
            &request,
        ).await?;
        
        Ok(device.id)
    }
    
    fn generate_report(&self, filename: &str, total: u32, succeeded: u32, failed: u32, errors: &[String]) -> String {
        let mut report = format!("Import zařízení ze souboru '{}'\n", filename);
        report.push_str(&format!("Celkem záznamů: {}\n", total));
        report.push_str(&format!("Úspěšně importováno: {}\n", succeeded));
        report.push_str(&format!("Chyby: {}\n", failed));
        
        if !errors.is_empty() {
            report.push_str("\nDetail chyb:\n");
            for (i, err) in errors.iter().take(20).enumerate() {
                report.push_str(&format!("{}. {}\n", i + 1, err));
            }
            if errors.len() > 20 {
                report.push_str(&format!("... a dalších {} chyb\n", errors.len() - 20));
            }
        }
        
        report
    }
}

pub async fn handle_device_import_submit(
    client: Client,
    mut subscriber: Subscriber,
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
            message: "Import úloha byla zařazena do fronty".to_string(),
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
        let job: QueuedRevisionImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
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
                let error_msg = format!("Chyba při parsování CSV: {}", e);
                self.publish_status(job_id, RevisionImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.revision", started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "CSV soubor neobsahuje žádné záznamy".to_string();
            self.publish_status(job_id, RevisionImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.revision", started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, RevisionImportJobStatus::Parsing { progress: 100 }).await?;
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut errors: Vec<String> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
            if processed % 10 == 0 || processed == total {
                self.publish_status(job_id, RevisionImportJobStatus::Importing {
                    processed,
                    total,
                    succeeded,
                    failed,
                }).await?;
            }
            
            match self.create_revision(user_id, row).await {
                Ok(_) => succeeded += 1,
                Err(e) => {
                    failed += 1;
                    let row_num = idx + 2;
                    errors.push(format!("Řádek {}: {}", row_num, e));
                }
            }
        }
        
        let report = self.generate_report(&job.request.filename, total, succeeded, failed, &errors);
        
        self.publish_status(job_id, RevisionImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.revision",
            started_at,
            Some(format!("{}/{} úspěšně importováno", succeeded, total)),
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
    
    async fn create_revision(&self, user_id: Uuid, row: &CsvRevisionRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zákazníka"))?;
        let device_ref = row.device_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zařízení"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zákazník '{}' nenalezen", customer_ref))?;
        
        let device_id = resolve_device_ref(&self.pool, user_id, customer_id, device_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zařízení '{}' nenalezeno", device_ref))?;
        
        let due_date_str = row.due_date.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí termín revize"))?;
        let due_date = NaiveDate::parse_from_str(due_date_str, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(due_date_str, "%d.%m.%Y"))
            .map_err(|_| anyhow::anyhow!("Neplatný formát data: {}", due_date_str))?;
        
        let scheduled_date = row.scheduled_date.as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                .or_else(|| NaiveDate::parse_from_str(d, "%d.%m.%Y").ok()));
        
        let scheduled_time_start = row.scheduled_time_start.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()
                .or_else(|| NaiveTime::parse_from_str(t, "%H:%M:%S").ok()));
        
        let scheduled_time_end = row.scheduled_time_end.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()
                .or_else(|| NaiveTime::parse_from_str(t, "%H:%M:%S").ok()));
        
        let request = CreateRevisionRequest {
            device_id,
            customer_id,
            due_date,
            scheduled_date,
            scheduled_time_start,
            scheduled_time_end,
            findings: row.findings.clone(),
        };
        
        let revision = queries::revision::create_revision(
            &self.pool,
            user_id,
            &request,
        ).await?;
        
        Ok(revision.id)
    }
    
    fn generate_report(&self, filename: &str, total: u32, succeeded: u32, failed: u32, errors: &[String]) -> String {
        let mut report = format!("Import revizí ze souboru '{}'\n", filename);
        report.push_str(&format!("Celkem záznamů: {}\n", total));
        report.push_str(&format!("Úspěšně importováno: {}\n", succeeded));
        report.push_str(&format!("Chyby: {}\n", failed));
        
        if !errors.is_empty() {
            report.push_str("\nDetail chyb:\n");
            for (i, err) in errors.iter().take(20).enumerate() {
                report.push_str(&format!("{}. {}\n", i + 1, err));
            }
            if errors.len() > 20 {
                report.push_str(&format!("... a dalších {} chyb\n", errors.len() - 20));
            }
        }
        
        report
    }
}

pub async fn handle_revision_import_submit(
    client: Client,
    mut subscriber: Subscriber,
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
            message: "Import úloha byla zařazena do fronty".to_string(),
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
        let job: QueuedCommunicationImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
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
                let error_msg = format!("Chyba při parsování CSV: {}", e);
                self.publish_status(job_id, CommunicationImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.communication", started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "CSV soubor neobsahuje žádné záznamy".to_string();
            self.publish_status(job_id, CommunicationImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.communication", started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, CommunicationImportJobStatus::Parsing { progress: 100 }).await?;
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut errors: Vec<String> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
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
                    let row_num = idx + 2;
                    errors.push(format!("Řádek {}: {}", row_num, e));
                }
            }
        }
        
        let report = self.generate_report(&job.request.filename, total, succeeded, failed, &errors);
        
        self.publish_status(job_id, CommunicationImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.communication",
            started_at,
            Some(format!("{}/{} úspěšně importováno", succeeded, total)),
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
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zákazníka"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zákazník '{}' nenalezen", customer_ref))?;
        
        let comm_type = parse_communication_type(row.comm_type.as_deref().unwrap_or("note"));
        let direction = parse_communication_direction(row.direction.as_deref().unwrap_or("outbound"));
        
        let content = row.content.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí obsah komunikace"))?;
        
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
    
    fn generate_report(&self, filename: &str, total: u32, succeeded: u32, failed: u32, errors: &[String]) -> String {
        let mut report = format!("Import komunikací ze souboru '{}'\n", filename);
        report.push_str(&format!("Celkem záznamů: {}\n", total));
        report.push_str(&format!("Úspěšně importováno: {}\n", succeeded));
        report.push_str(&format!("Chyby: {}\n", failed));
        
        if !errors.is_empty() {
            report.push_str("\nDetail chyb:\n");
            for (i, err) in errors.iter().take(20).enumerate() {
                report.push_str(&format!("{}. {}\n", i + 1, err));
            }
            if errors.len() > 20 {
                report.push_str(&format!("... a dalších {} chyb\n", errors.len() - 20));
            }
        }
        
        report
    }
}

pub async fn handle_communication_import_submit(
    client: Client,
    mut subscriber: Subscriber,
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

pub struct VisitImportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    pending_count: AtomicU32,
}

impl VisitImportProcessor {
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
    
    pub async fn submit_job(&self, user_id: Uuid, request: VisitImportJobRequest) -> Result<VisitImportJobSubmitResponse> {
        let job = QueuedVisitImportJob::new(user_id, request);
        let job_id = job.id;
        
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(VISIT_IMPORT_SUBJECT, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        
        info!("Visit import job {} submitted, position {} in queue", job_id, pending);
        
        self.publish_status(job_id, VisitImportJobStatus::Queued { position: pending }).await?;
        
        Ok(VisitImportJobSubmitResponse {
            job_id,
            message: "Import úloha byla zařazena do fronty".to_string(),
        })
    }
    
    pub async fn publish_status(&self, job_id: Uuid, status: VisitImportJobStatus) -> Result<()> {
        let update = VisitImportJobStatusUpdate::new(job_id, status);
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
        let job: QueuedVisitImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        
        info!("Processing visit import job {} from file '{}'", job_id, job.request.filename);
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // ACK immediately to prevent redelivery during long processing
        if let Err(e) = msg.ack().await {
            error!("Failed to ack visit import job {}: {:?}", job_id, e);
        }
        
        self.publish_status(job_id, VisitImportJobStatus::Parsing { progress: 0 }).await?;
        
        let rows = match self.parse_csv(&job.request.csv_content).await {
            Ok(rows) => rows,
            Err(e) => {
                let error_msg = format!("Chyba při parsování CSV: {}", e);
                self.publish_status(job_id, VisitImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.visit", started_at, error_msg);
                return Ok(());
            }
        };
        
        let total = rows.len() as u32;
        if total == 0 {
            let error_msg = "CSV soubor neobsahuje žádné záznamy".to_string();
            self.publish_status(job_id, VisitImportJobStatus::Failed { error: error_msg.clone() }).await?;
            JOB_HISTORY.record_failed(job_id, "import.visit", started_at, error_msg);
            return Ok(());
        }
        
        self.publish_status(job_id, VisitImportJobStatus::Parsing { progress: 100 }).await?;
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut errors: Vec<String> = Vec::new();
        
        for (idx, row) in rows.iter().enumerate() {
            let processed = (idx + 1) as u32;
            
            if processed % 10 == 0 || processed == total {
                self.publish_status(job_id, VisitImportJobStatus::Importing {
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
                    let row_num = idx + 2;
                    errors.push(format!("Řádek {}: {}", row_num, e));
                }
            }
        }
        
        let report = self.generate_report(&job.request.filename, total, succeeded, failed, &errors);
        
        self.publish_status(job_id, VisitImportJobStatus::Completed {
            total,
            succeeded,
            failed,
            report: report.clone(),
        }).await?;
        
        JOB_HISTORY.record_completed(
            job_id,
            "import.visit",
            started_at,
            Some(format!("{}/{} úspěšně importováno", succeeded, total)),
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
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zákazníka"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zákazník '{}' nenalezen", customer_ref))?;
        
        let scheduled_date_str = row.scheduled_date.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí datum návštěvy"))?;
        let scheduled_date = NaiveDate::parse_from_str(scheduled_date_str, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(scheduled_date_str, "%d.%m.%Y"))
            .map_err(|_| anyhow::anyhow!("Neplatný formát data: {}", scheduled_date_str))?;
        
        let scheduled_time_start = row.scheduled_time_start.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()
                .or_else(|| NaiveTime::parse_from_str(t, "%H:%M:%S").ok()));
        
        let scheduled_time_end = row.scheduled_time_end.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok()
                .or_else(|| NaiveTime::parse_from_str(t, "%H:%M:%S").ok()));
        
        let visit_type = parse_visit_type(row.visit_type.as_deref().unwrap_or("revision"));
        
        let visit = queries::visit::create_visit(
            &self.pool,
            user_id,
            customer_id,
            None, // revision_id
            scheduled_date,
            scheduled_time_start,
            scheduled_time_end,
            visit_type,
        ).await?;
        
        Ok(visit.id)
    }
    
    fn generate_report(&self, filename: &str, total: u32, succeeded: u32, failed: u32, errors: &[String]) -> String {
        let mut report = format!("Import návštěv ze souboru '{}'\n", filename);
        report.push_str(&format!("Celkem záznamů: {}\n", total));
        report.push_str(&format!("Úspěšně importováno: {}\n", succeeded));
        report.push_str(&format!("Chyby: {}\n", failed));
        
        if !errors.is_empty() {
            report.push_str("\nDetail chyb:\n");
            for (i, err) in errors.iter().take(20).enumerate() {
                report.push_str(&format!("{}. {}\n", i + 1, err));
            }
            if errors.len() > 20 {
                report.push_str(&format!("... a dalších {} chyb\n", errors.len() - 20));
            }
        }
        
        report
    }
}

pub async fn handle_visit_import_submit(
    client: Client,
    mut subscriber: Subscriber,
    processor: Arc<VisitImportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<VisitImportJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse visit import submit request: {}", e);
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
            return Err(anyhow::anyhow!("ZIP neobsahuje žádné rozpoznané CSV soubory"));
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
            message: format!("ZIP import úloha byla zařazena do fronty ({} souborů)", detected_files.len()),
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
        let job: QueuedZipImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let started_at = job.submitted_at;
        let total_files = job.files.len() as u32;
        
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
                let error_msg = format!("Chyba při dekódování ZIP: {}", e);
                self.publish_status(job_id, ZipImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.zip", started_at, error_msg);
                return Ok(());
            }
        };
        
        let cursor = Cursor::new(&zip_data);
        let mut archive = match zip::ZipArchive::new(cursor) {
            Ok(a) => a,
            Err(e) => {
                let error_msg = format!("Chyba při otevření ZIP: {}", e);
                self.publish_status(job_id, ZipImportJobStatus::Failed { error: error_msg.clone() }).await?;
                JOB_HISTORY.record_failed(job_id, "import.zip", started_at, error_msg);
                return Ok(());
            }
        };
        
        self.publish_status(job_id, ZipImportJobStatus::Extracting { progress: 100 }).await?;
        self.publish_status(job_id, ZipImportJobStatus::Analyzing { files: job.files.clone() }).await?;
        
        // Process each file in order
        let mut results: Vec<ZipImportFileResult> = Vec::new();
        let mut completed_files = 0u32;
        
        for file_info in &job.files {
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
                    results.push(ZipImportFileResult {
                        filename: file_info.filename.clone(),
                        file_type: file_info.file_type,
                        succeeded: 0,
                        failed: 1,
                    });
                    completed_files += 1;
                    continue;
                }
            };
            
            // Import the file based on type
            let (succeeded, failed) = match self.import_csv_by_type(
                user_id, 
                &csv_content, 
                file_info.file_type
            ).await {
                Ok((s, f)) => (s, f),
                Err(e) => {
                    warn!("Failed to import '{}': {}", file_info.filename, e);
                    (0, 1)
                }
            };
            
            results.push(ZipImportFileResult {
                filename: file_info.filename.clone(),
                file_type: file_info.file_type,
                succeeded,
                failed,
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
            started_at,
            Some(format!("{} souborů, {} záznamů úspěšně, {} chyb", 
                         total_files, total_succeeded, total_failed)),
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
    
    async fn import_csv_by_type(&self, user_id: Uuid, csv_content: &str, file_type: ZipImportFileType) -> Result<(u32, u32)> {
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
            ZipImportFileType::Visits => {
                self.import_visits(user_id, csv_content).await
            }
        }
    }
    
    async fn import_customers(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32)> {
        use super::import::CsvCustomerRow;
        
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        
        for result in reader.deserialize::<CsvCustomerRow>() {
            match result {
                Ok(row) => {
                    match self.create_customer_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(_) => failed += 1,
                    }
                }
                Err(_) => failed += 1,
            }
        }
        
        Ok((succeeded, failed))
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
            name: row.name.clone(),
            contact_person: row.contact_person.clone(),
            ico: row.ico.clone(),
            dic: row.dic.clone(),
            email,
            phone,
            phone_raw: row.phone.clone(),
            street: row.street.clone().unwrap_or_default(),
            city: row.city.clone().unwrap_or_default(),
            postal_code: row.postal_code.clone().unwrap_or_default(),
            country: row.country.clone(),
            lat: None,
            lng: None,
            notes: row.notes.clone(),
        };
        
        let customer = queries::customer::create_customer(&self.pool, user_id, &request).await?;
        Ok(customer.id)
    }
    
    async fn import_devices(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32)> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        
        for result in reader.deserialize::<CsvDeviceRow>() {
            match result {
                Ok(row) => {
                    match self.create_device_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(_) => failed += 1,
                    }
                }
                Err(_) => failed += 1,
            }
        }
        
        Ok((succeeded, failed))
    }
    
    async fn create_device_from_row(&self, user_id: Uuid, row: &CsvDeviceRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zákazníka"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zákazník nenalezen"))?;
        
        let device_type = parse_device_type(row.device_type.as_deref().unwrap_or("other"));
        let revision_interval = row.revision_interval_months.unwrap_or(12);
        
        let installation_date = row.installation_date.as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                .or_else(|| NaiveDate::parse_from_str(d, "%d.%m.%Y").ok()));
        
        let request = CreateDeviceRequest {
            customer_id,
            device_type: device_type.to_string(),
            manufacturer: row.manufacturer.clone(),
            model: row.model.clone(),
            serial_number: row.serial_number.clone(),
            installation_date,
            revision_interval_months: revision_interval,
            notes: row.notes.clone(),
        };
        
        let device = queries::device::create_device(
            &self.pool,
            customer_id,
            &request,
        ).await?;
        
        Ok(device.id)
    }
    
    async fn import_revisions(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32)> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        
        for result in reader.deserialize::<CsvRevisionRow>() {
            match result {
                Ok(row) => {
                    match self.create_revision_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(_) => failed += 1,
                    }
                }
                Err(_) => failed += 1,
            }
        }
        
        Ok((succeeded, failed))
    }
    
    async fn create_revision_from_row(&self, user_id: Uuid, row: &CsvRevisionRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zákazníka"))?;
        let device_ref = row.device_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zařízení"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zákazník nenalezen"))?;
        let device_id = resolve_device_ref(&self.pool, user_id, customer_id, device_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zařízení nenalezeno"))?;
        
        let due_date_str = row.due_date.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí termín"))?;
        let due_date = NaiveDate::parse_from_str(due_date_str, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(due_date_str, "%d.%m.%Y"))?;
        
        let scheduled_date = row.scheduled_date.as_ref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()
                .or_else(|| NaiveDate::parse_from_str(d, "%d.%m.%Y").ok()));
        
        let scheduled_time_start = row.scheduled_time_start.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
        
        let scheduled_time_end = row.scheduled_time_end.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
        
        let request = CreateRevisionRequest {
            device_id,
            customer_id,
            due_date,
            scheduled_date,
            scheduled_time_start,
            scheduled_time_end,
            findings: row.findings.clone(),
        };
        
        let revision = queries::revision::create_revision(
            &self.pool,
            user_id,
            &request,
        ).await?;
        
        Ok(revision.id)
    }
    
    async fn import_communications(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32)> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        
        for result in reader.deserialize::<CsvCommunicationRow>() {
            match result {
                Ok(row) => {
                    match self.create_communication_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(_) => failed += 1,
                    }
                }
                Err(_) => failed += 1,
            }
        }
        
        Ok((succeeded, failed))
    }
    
    async fn create_communication_from_row(&self, user_id: Uuid, row: &CsvCommunicationRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zákazníka"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zákazník nenalezen"))?;
        
        let comm_type = parse_communication_type(row.comm_type.as_deref().unwrap_or("note"));
        let direction = parse_communication_direction(row.direction.as_deref().unwrap_or("outbound"));
        
        let content = row.content.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí obsah"))?;
        
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
    
    async fn import_visits(&self, user_id: Uuid, csv_content: &str) -> Result<(u32, u32)> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b';')
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_content.as_bytes());
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        
        for result in reader.deserialize::<CsvVisitRow>() {
            match result {
                Ok(row) => {
                    match self.create_visit_from_row(user_id, &row).await {
                        Ok(_) => succeeded += 1,
                        Err(_) => failed += 1,
                    }
                }
                Err(_) => failed += 1,
            }
        }
        
        Ok((succeeded, failed))
    }
    
    async fn create_visit_from_row(&self, user_id: Uuid, row: &CsvVisitRow) -> Result<Uuid> {
        let customer_ref = row.customer_ref.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí reference zákazníka"))?;
        
        let customer_id = resolve_customer_ref(&self.pool, user_id, customer_ref).await?
            .ok_or_else(|| anyhow::anyhow!("Zákazník nenalezen"))?;
        
        let scheduled_date_str = row.scheduled_date.as_ref()
            .ok_or_else(|| anyhow::anyhow!("Chybí datum"))?;
        let scheduled_date = NaiveDate::parse_from_str(scheduled_date_str, "%Y-%m-%d")
            .or_else(|_| NaiveDate::parse_from_str(scheduled_date_str, "%d.%m.%Y"))?;
        
        let scheduled_time_start = row.scheduled_time_start.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
        
        let scheduled_time_end = row.scheduled_time_end.as_ref()
            .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
        
        let visit_type = parse_visit_type(row.visit_type.as_deref().unwrap_or("revision"));
        
        let visit = queries::visit::create_visit(
            &self.pool,
            user_id,
            customer_id,
            None, // revision_id
            scheduled_date,
            scheduled_time_start,
            scheduled_time_end,
            visit_type,
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
