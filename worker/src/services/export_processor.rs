//! Export JetStream processor for asynchronous Export+ jobs.

use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyhow::{anyhow, Result};
use async_nats::jetstream::{self, Context as JsContext};
use async_nats::Client;
use chrono::{DateTime, Duration, NaiveDate, Utc};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;
use zip::write::SimpleFileOptions;

use crate::db::queries;
use crate::services::job_history::JOB_HISTORY;

const STREAM_NAME: &str = "SAZINKA_EXPORT_JOBS";
const CONSUMER_NAME: &str = "export_workers";
const SUBJECT: &str = "sazinka.jobs.export";
const STATUS_PREFIX: &str = "sazinka.job.export.status";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportScope {
    CustomerOnly,
    AllWorkersCombined,
    AllWorkersSplit,
    SingleWorker,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFile {
    Customers,
    Devices,
    Revisions,
    Communications,
    WorkLog,
    Routes,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlusFilters {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub revision_statuses: Option<Vec<String>>,
    pub visit_statuses: Option<Vec<String>>,
    pub route_statuses: Option<Vec<String>>,
    pub crew_ids: Option<Vec<String>>,
    pub depot_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlusRequest {
    pub scope: ExportScope,
    pub selected_files: Vec<ExportFile>,
    #[serde(default)]
    pub filters: ExportPlusFilters,
    pub selected_worker_id: Option<String>,
    pub user_time_zone: Option<String>,
    pub user_time_zone_offset_minutes: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSubmitResponse {
    pub job_id: Uuid,
    pub position: u32,
    pub estimated_wait_seconds: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDownloadRequest {
    pub job_id: Uuid,
    pub user_time_zone: Option<String>,
    pub user_time_zone_offset_minutes: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDownloadResponse {
    pub filename: String,
    pub content_type: String,
    pub file_base64: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueuedExportJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    pub request: ExportPlusRequest,
}

impl QueuedExportJob {
    fn new(user_id: Uuid, request: ExportPlusRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: chrono::Utc::now(),
            request,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusUpdate {
    job_id: Uuid,
    timestamp: chrono::DateTime<chrono::Utc>,
    status: serde_json::Value,
}

#[derive(Clone)]
struct WorkerCtx {
    worker_uuid: String,
}

struct ExportDataSet {
    customers: Vec<crate::types::Customer>,
    devices: Vec<crate::types::Device>,
    revisions: Vec<crate::types::Revision>,
    communications: Vec<crate::types::Communication>,
    visits: Vec<crate::types::VisitWithCustomer>,
    routes: Vec<queries::route::RouteWithCrewInfo>,
    route_stops: Vec<queries::route::RouteStopWithInfo>,
}

pub struct ExportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
}

impl ExportProcessor {
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![format!("{}.>", SUBJECT)],
            max_messages: 1000,
            max_bytes: 200 * 1024 * 1024,
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream export stream '{}' ready", STREAM_NAME);

        Ok(Self { client, js, pool })
    }

    pub async fn submit_job(&self, user_id: Uuid, request: ExportPlusRequest) -> Result<ExportSubmitResponse> {
        if request.selected_files.is_empty() {
            return Err(anyhow!("No export files selected"));
        }

        let job = QueuedExportJob::new(user_id, request);
        let job_id = job.id;
        let payload = serde_json::to_vec(&job)?;
        let subject = format!("{}.submit", SUBJECT);
        self.js.publish(subject, payload.into()).await?.await?;

        self.publish_status(job_id, json!({ "type": "queued", "position": 1 })).await?;

        Ok(ExportSubmitResponse {
            job_id,
            position: 1,
            estimated_wait_seconds: 3,
            message: "Export job submitted".to_string(),
        })
    }

    pub async fn load_export_file(
        &self,
        user_id: Uuid,
        job_id: Uuid,
        tz_offset_minutes: Option<i32>,
    ) -> Result<(String, Vec<u8>)> {
        let path = Self::export_file_path(user_id, job_id);
        if !path.exists() {
            return Err(anyhow!("Export file not found"));
        }

        let bytes = fs::read(&path)?;
        let timestamp = fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .map(DateTime::<Utc>::from)
            .unwrap_or_else(Utc::now);
        Ok((export_download_filename(timestamp, tz_offset_minutes, job_id), bytes))
    }

    async fn publish_status(&self, job_id: Uuid, status: serde_json::Value) -> Result<()> {
        let update = StatusUpdate {
            job_id,
            timestamp: Utc::now(),
            status,
        };
        let subject = format!("{}.{}", STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }

    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            filter_subject: format!("{}.>", SUBJECT),
            ..Default::default()
        };

        let consumer = stream.get_or_create_consumer(CONSUMER_NAME, consumer_config).await?;
        let mut messages = consumer.messages().await?;

        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    if let Err(e) = processor.process_job(msg).await {
                        error!("Failed to process export job: {}", e);
                    }
                }
                Err(e) => error!("Error receiving export message: {}", e),
            }
        }

        Ok(())
    }

    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        let started_wall = Utc::now();
        let started = Instant::now();
        let job: QueuedExportJob = serde_json::from_slice(&msg.payload)?;

        let job_id = job.id;
        let user_id = job.user_id;

        self.publish_status(
            job_id,
            json!({ "type": "processing", "progress": 5, "message": "Načítání dat..." }),
        )
        .await?;

        let outcome = self.build_export_zip(user_id, &job.request, job_id).await;

        match outcome {
            Ok((row_count, file_size, file_name)) => {
                self.publish_status(
                    job_id,
                    json!({
                        "type": "completed",
                        "result": {
                            "jobId": job_id,
                            "fileName": file_name,
                            "fileSizeBytes": file_size,
                            "rowCount": row_count,
                            "downloadReady": true
                        }
                    }),
                )
                .await?;

                JOB_HISTORY.record_completed(
                    job_id,
                    "export",
                    started_wall,
                    Some(format!("{} řádků, {} B", row_count, file_size)),
                );
            }
            Err(e) => {
                warn!("Export job {} failed: {}", job_id, e);
                self.publish_status(job_id, json!({ "type": "failed", "error": e.to_string() }))
                    .await?;
                JOB_HISTORY.record_failed(job_id, "export", started_wall, e.to_string());
            }
        }

        if let Err(e) = msg.ack().await {
            error!("Failed to ack export job {}: {:?}", job_id, e);
        }

        info!(
            "Export job {} finished in {} ms",
            job_id,
            started.elapsed().as_millis()
        );
        Ok(())
    }

    async fn build_export_zip(
        &self,
        user_id: Uuid,
        request: &ExportPlusRequest,
        job_id: Uuid,
    ) -> Result<(u32, u64, String)> {
        let filters = &request.filters;
        let date_from = parse_date_opt(filters.date_from.as_deref())?.unwrap_or_else(|| {
            NaiveDate::from_ymd_opt(2000, 1, 1).expect("valid static default date")
        });
        let date_to = parse_date_opt(filters.date_to.as_deref())?.unwrap_or_else(|| {
            NaiveDate::from_ymd_opt(2100, 1, 1).expect("valid static default date")
        });

        let dataset = self.load_dataset(user_id, filters, date_from, date_to).await?;

        self.publish_status(
            job_id,
            json!({ "type": "processing", "progress": 45, "message": "Generování CSV..." }),
        )
        .await?;

        let worker_contexts = self.resolve_worker_contexts(user_id, request).await?;
        let mut files: Vec<(String, String)> = Vec::new();

        match request.scope {
            ExportScope::CustomerOnly => {
                self.collect_files_for_context(
                    request.selected_files.as_slice(),
                    &dataset,
                    None,
                    false,
                    "",
                    &mut files,
                );
            }
            ExportScope::AllWorkersCombined => {
                let mut merged: HashMap<String, String> = HashMap::new();
                for ctx in &worker_contexts {
                    let mut local_files = Vec::new();
                    self.collect_files_for_context(
                        request.selected_files.as_slice(),
                        &dataset,
                        Some(ctx),
                        true,
                        "",
                        &mut local_files,
                    );
                    for (name, content) in local_files {
                        if let Some(existing) = merged.get_mut(&name) {
                            let mut incoming = content.lines();
                            let _ = incoming.next();
                            for row in incoming {
                                if !row.is_empty() {
                                    existing.push('\n');
                                    existing.push_str(row);
                                }
                            }
                        } else {
                            merged.insert(name, content);
                        }
                    }
                }
                files.extend(merged.into_iter());
            }
            ExportScope::AllWorkersSplit | ExportScope::SingleWorker => {
                for ctx in &worker_contexts {
                    let prefix = format!("{}_", ctx.worker_uuid);
                    self.collect_files_for_context(
                        request.selected_files.as_slice(),
                        &dataset,
                        Some(ctx),
                        true,
                        &prefix,
                        &mut files,
                    );
                }
            }
        }

        self.publish_status(
            job_id,
            json!({ "type": "processing", "progress": 80, "message": "Balení ZIP..." }),
        )
        .await?;

        let mut zip_writer = zip::ZipWriter::new(Cursor::new(Vec::<u8>::new()));
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut total_rows: u32 = 0;

        for (name, content) in files {
            total_rows += content.lines().skip(1).count() as u32;
            zip_writer.start_file(name, options)?;
            zip_writer.write_all(content.as_bytes())?;
        }

        let zip_cursor = zip_writer.finish()?;
        let zip_bytes = zip_cursor.into_inner();
        let file_size = zip_bytes.len() as u64;
        Self::save_export_file(user_id, job_id, &zip_bytes)?;

        Ok((
            total_rows,
            file_size,
            export_download_filename(Utc::now(), request.user_time_zone_offset_minutes, job_id),
        ))
    }

    async fn load_dataset(
        &self,
        user_id: Uuid,
        filters: &ExportPlusFilters,
        date_from: NaiveDate,
        date_to: NaiveDate,
    ) -> Result<ExportDataSet> {
        let customers = queries::customer::list_customers(&self.pool, user_id, 10_000, 0).await?;

        let mut devices = Vec::new();
        for c in &customers {
            devices.extend(queries::device::list_devices(&self.pool, user_id, c.id).await.unwrap_or_default());
        }

        let mut revisions = queries::revision::list_revisions(
            &self.pool,
            user_id,
            None,
            None,
            None,
            Some(date_from),
            Some(date_to),
            None,
            Some(10_000),
            Some(0),
        )
        .await?;
        if let Some(statuses) = &filters.revision_statuses {
            revisions.retain(|r| statuses.contains(&r.status));
        }

        let (mut communications, _) = queries::communication::list_communications(
            &self.pool,
            user_id,
            None,
            None,
            None,
            None,
            10_000,
            0,
        )
        .await?;
        communications.retain(|c| {
            let d = c.created_at.date_naive();
            d >= date_from && d <= date_to
        });

        let (mut visits, _) = queries::visit::list_visits(
            &self.pool,
            user_id,
            None,
            Some(date_from),
            Some(date_to),
            None,
            None,
            10_000,
            0,
        )
        .await?;
        if let Some(statuses) = &filters.visit_statuses {
            visits.retain(|v| statuses.contains(&v.status));
        }

        let crew_filter = parse_uuid_opt_list(filters.crew_ids.as_ref());
        let depot_filter = parse_uuid_opt_list(filters.depot_ids.as_ref());

        let mut routes = queries::route::list_routes(
            &self.pool,
            user_id,
            date_from,
            date_to,
            None,
            None,
        )
        .await?;
        if let Some(route_statuses) = &filters.route_statuses {
            routes.retain(|r| route_statuses.contains(&r.status));
        }
        if let Some(crew_ids) = &crew_filter {
            routes.retain(|r| r.crew_id.map(|id| crew_ids.contains(&id)).unwrap_or(false));
        }
        if let Some(depot_ids) = &depot_filter {
            routes.retain(|r| r.depot_id.map(|id| depot_ids.contains(&id)).unwrap_or(false));
        }

        let mut route_stops = Vec::new();
        for route in &routes {
            route_stops.extend(
                queries::route::get_route_stops_with_info(&self.pool, route.id)
                    .await
                    .unwrap_or_default(),
            );
        }

        Ok(ExportDataSet {
            customers,
            devices,
            revisions,
            communications,
            visits,
            routes,
            route_stops,
        })
    }

    async fn resolve_worker_contexts(
        &self,
        user_id: Uuid,
        request: &ExportPlusRequest,
    ) -> Result<Vec<WorkerCtx>> {
        let workers = queries::user::list_workers(&self.pool, user_id).await.unwrap_or_default();
        let mut contexts: Vec<WorkerCtx> = workers
            .iter()
            .map(|w| WorkerCtx {
                worker_uuid: w.id.to_string(),
            })
            .collect();

        match request.scope {
            ExportScope::CustomerOnly => Ok(Vec::new()),
            ExportScope::SingleWorker => {
                let selected = request
                    .selected_worker_id
                    .as_ref()
                    .ok_or_else(|| anyhow!("selectedWorkerId is required for single_worker scope"))?;
                contexts.retain(|c| &c.worker_uuid == selected);
                if contexts.is_empty() {
                    return Err(anyhow!("Selected worker not found"));
                }
                Ok(contexts)
            }
            ExportScope::AllWorkersCombined | ExportScope::AllWorkersSplit => {
                if contexts.is_empty() {
                    contexts.push(WorkerCtx {
                        worker_uuid: user_id.to_string(),
                    });
                }
                Ok(contexts)
            }
        }
    }

    fn collect_files_for_context(
        &self,
        selected: &[ExportFile],
        dataset: &ExportDataSet,
        worker: Option<&WorkerCtx>,
        include_worker_uuid_col: bool,
        filename_prefix: &str,
        out: &mut Vec<(String, String)>,
    ) {
        for file in selected {
            match file {
                ExportFile::Customers => out.push((
                    format!("{}customers.csv", filename_prefix),
                    build_customers_csv(dataset, worker, include_worker_uuid_col),
                )),
                ExportFile::Devices => out.push((
                    format!("{}devices.csv", filename_prefix),
                    build_devices_csv(dataset, worker, include_worker_uuid_col),
                )),
                ExportFile::Revisions => out.push((
                    format!("{}revisions.csv", filename_prefix),
                    build_revisions_csv(dataset, worker, include_worker_uuid_col),
                )),
                ExportFile::Communications => out.push((
                    format!("{}communications.csv", filename_prefix),
                    build_communications_csv(dataset, worker, include_worker_uuid_col),
                )),
                ExportFile::WorkLog => out.push((
                    format!("{}work_log.csv", filename_prefix),
                    build_work_log_csv(dataset, worker, include_worker_uuid_col),
                )),
                ExportFile::Routes => {
                    out.push((
                        format!("{}routes.csv", filename_prefix),
                        build_routes_csv(dataset, worker, include_worker_uuid_col),
                    ));
                    out.push((
                        format!("{}route_stops.csv", filename_prefix),
                        build_route_stops_csv(dataset, worker, include_worker_uuid_col),
                    ));
                }
            }
        }
    }

    fn export_base_dir() -> PathBuf {
        PathBuf::from("exports")
    }

    fn export_file_path(user_id: Uuid, job_id: Uuid) -> PathBuf {
        Self::export_base_dir()
            .join(user_id.to_string())
            .join(format!("{}.zip", job_id))
    }

    fn save_export_file(user_id: Uuid, job_id: Uuid, bytes: &[u8]) -> Result<()> {
        let user_dir = Self::export_base_dir().join(user_id.to_string());
        fs::create_dir_all(&user_dir)?;
        let path = Self::export_file_path(user_id, job_id);
        fs::write(path, bytes)?;
        Ok(())
    }
}

fn parse_date_opt(value: Option<&str>) -> Result<Option<NaiveDate>> {
    match value {
        Some(v) if !v.trim().is_empty() => Ok(Some(NaiveDate::parse_from_str(v, "%Y-%m-%d")?)),
        _ => Ok(None),
    }
}

fn parse_uuid_opt_list(values: Option<&Vec<String>>) -> Option<Vec<Uuid>> {
    values.map(|arr| {
        arr.iter()
            .filter_map(|s| Uuid::parse_str(s).ok())
            .collect::<Vec<_>>()
    })
}

fn export_download_filename(
    timestamp_utc: DateTime<Utc>,
    tz_offset_minutes: Option<i32>,
    job_id: Uuid,
) -> String {
    // JS Date.getTimezoneOffset() returns (UTC - local) in minutes.
    // local_time = utc_time - offset.
    let safe_offset = tz_offset_minutes.map(|m| m.clamp(-14 * 60, 14 * 60));
    let local_timestamp = match safe_offset {
        Some(offset) => timestamp_utc - Duration::minutes(i64::from(offset)),
        None => timestamp_utc,
    };
    let short = job_id.simple().to_string();
    let suffix = short.get(0..2).unwrap_or("00").to_uppercase();
    format!(
        "export-{}-{}.zip",
        local_timestamp.format("%Y%m%d-%H%M%S"),
        suffix
    )
}

fn fnv1a(input: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for b in input.as_bytes() {
        hash ^= *b as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{:08x}", hash)
}

fn pseudo_id(worker_uuid: Option<&str>, entity: &str, source_id: Uuid) -> String {
    let worker = worker_uuid.unwrap_or("owner");
    format!("{}_{}", entity, fnv1a(&format!("{}:{}:{}", worker, entity, source_id)))
}

fn csv_escape(value: impl ToString) -> String {
    let mut text = value.to_string();
    if text.contains(',') || text.contains('"') || text.contains('\n') {
        text = text.replace('"', "\"\"");
        format!("\"{}\"", text)
    } else {
        text
    }
}

fn write_csv(headers: &[&str], rows: &[Vec<String>]) -> String {
    let mut out = String::new();
    out.push_str(&headers.iter().map(csv_escape).collect::<Vec<_>>().join(","));
    out.push('\n');
    for row in rows {
        out.push_str(&row.iter().map(csv_escape).collect::<Vec<_>>().join(","));
        out.push('\n');
    }
    out
}

fn build_customers_csv(dataset: &ExportDataSet, worker: Option<&WorkerCtx>, include_worker: bool) -> String {
    let mut headers = vec![
        "type", "name", "contact_person", "ico", "dic", "street", "city", "postal_code", "country", "phone", "email",
        "notes",
    ];
    if include_worker {
        headers.insert(0, "worker_uuid");
    }

    let rows = dataset
        .customers
        .iter()
        .map(|c| {
            let mut row = vec![
                match c.customer_type {
                    crate::types::customer::CustomerType::Person => "person".to_string(),
                    crate::types::customer::CustomerType::Company => "company".to_string(),
                },
                c.name.clone().unwrap_or_default(),
                c.contact_person.clone().unwrap_or_default(),
                c.ico.clone().unwrap_or_default(),
                c.dic.clone().unwrap_or_default(),
                c.street.clone().unwrap_or_default(),
                c.city.clone().unwrap_or_default(),
                c.postal_code.clone().unwrap_or_default(),
                c.country.clone().unwrap_or_default(),
                c.phone.clone().unwrap_or_default(),
                c.email.clone().unwrap_or_default(),
                c.notes.clone().unwrap_or_default(),
            ];
            if include_worker {
                row.insert(0, worker.map(|w| w.worker_uuid.clone()).unwrap_or_default());
            }
            row
        })
        .collect::<Vec<_>>();

    write_csv(&headers, &rows)
}

fn build_devices_csv(dataset: &ExportDataSet, worker: Option<&WorkerCtx>, include_worker: bool) -> String {
    let mut headers = vec![
        "customer_ref",
        "device_type",
        "manufacturer",
        "model",
        "serial_number",
        "installation_date",
        "revision_interval_months",
        "notes",
    ];
    if include_worker {
        headers.insert(0, "worker_uuid");
    }

    let worker_uuid = worker.map(|w| w.worker_uuid.as_str());
    let rows = dataset
        .devices
        .iter()
        .map(|d| {
            let mut row = vec![
                pseudo_id(worker_uuid, "customer", d.customer_id),
                d.device_type.clone(),
                d.manufacturer.clone().unwrap_or_default(),
                d.model.clone().unwrap_or_default(),
                d.serial_number.clone().unwrap_or_default(),
                d.installation_date.map(|x| x.to_string()).unwrap_or_default(),
                d.revision_interval_months.to_string(),
                d.notes.clone().unwrap_or_default(),
            ];
            if include_worker {
                row.insert(0, worker.map(|w| w.worker_uuid.clone()).unwrap_or_default());
            }
            row
        })
        .collect::<Vec<_>>();

    write_csv(&headers, &rows)
}

fn build_revisions_csv(dataset: &ExportDataSet, worker: Option<&WorkerCtx>, include_worker: bool) -> String {
    let mut headers = vec![
        "device_ref",
        "customer_ref",
        "due_date",
        "status",
        "scheduled_date",
        "scheduled_time_start",
        "scheduled_time_end",
        "completed_at",
        "duration_minutes",
        "result",
        "findings",
    ];
    if include_worker {
        headers.insert(0, "worker_uuid");
    }

    let worker_uuid = worker.map(|w| w.worker_uuid.as_str());
    let rows = dataset
        .revisions
        .iter()
        .map(|r| {
            let mut row = vec![
                pseudo_id(worker_uuid, "device", r.device_id),
                pseudo_id(worker_uuid, "customer", r.customer_id),
                r.due_date.to_string(),
                r.status.clone(),
                r.scheduled_date.map(|d| d.to_string()).unwrap_or_default(),
                r.scheduled_time_start.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                r.scheduled_time_end.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                r.completed_at.map(|d| d.to_rfc3339()).unwrap_or_default(),
                r.duration_minutes.map(|d| d.to_string()).unwrap_or_default(),
                r.result.clone().unwrap_or_default(),
                r.findings.clone().unwrap_or_default(),
            ];
            if include_worker {
                row.insert(0, worker.map(|w| w.worker_uuid.clone()).unwrap_or_default());
            }
            row
        })
        .collect::<Vec<_>>();

    write_csv(&headers, &rows)
}

fn build_communications_csv(dataset: &ExportDataSet, worker: Option<&WorkerCtx>, include_worker: bool) -> String {
    let mut headers = vec![
        "customer_ref",
        "date",
        "comm_type",
        "direction",
        "subject",
        "content",
        "contact_name",
        "contact_phone",
        "duration_minutes",
    ];
    if include_worker {
        headers.insert(0, "worker_uuid");
    }

    let worker_uuid = worker.map(|w| w.worker_uuid.as_str());
    let rows = dataset
        .communications
        .iter()
        .map(|c| {
            let mut row = vec![
                pseudo_id(worker_uuid, "customer", c.customer_id),
                c.created_at.date_naive().to_string(),
                c.comm_type.clone(),
                c.direction.clone(),
                c.subject.clone().unwrap_or_default(),
                c.content.clone(),
                c.contact_name.clone().unwrap_or_default(),
                c.contact_phone.clone().unwrap_or_default(),
                c.duration_minutes.map(|d| d.to_string()).unwrap_or_default(),
            ];
            if include_worker {
                row.insert(0, worker.map(|w| w.worker_uuid.clone()).unwrap_or_default());
            }
            row
        })
        .collect::<Vec<_>>();

    write_csv(&headers, &rows)
}

fn build_work_log_csv(dataset: &ExportDataSet, worker: Option<&WorkerCtx>, include_worker: bool) -> String {
    let mut headers = vec![
        "customer_ref",
        "scheduled_date",
        "scheduled_time_start",
        "scheduled_time_end",
        "device_ref",
        "work_type",
        "status",
        "result",
        "duration_minutes",
        "result_notes",
        "findings",
        "requires_follow_up",
        "follow_up_reason",
    ];
    if include_worker {
        headers.insert(0, "worker_uuid");
    }

    let worker_uuid = worker.map(|w| w.worker_uuid.as_str());
    let rows = dataset
        .visits
        .iter()
        .map(|v| {
            let mut row = vec![
                pseudo_id(worker_uuid, "customer", v.customer_id),
                v.scheduled_date.to_string(),
                v.scheduled_time_start.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                v.scheduled_time_end.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                v.device_id
                    .map(|id| pseudo_id(worker_uuid, "device", id))
                    .unwrap_or_default(),
                v.visit_type.clone(),
                v.status.clone(),
                v.result.clone().unwrap_or_default(),
                String::new(),
                v.result_notes.clone().unwrap_or_default(),
                String::new(),
                v.requires_follow_up.unwrap_or(false).to_string(),
                v.follow_up_reason.clone().unwrap_or_default(),
            ];
            if include_worker {
                row.insert(0, worker.map(|w| w.worker_uuid.clone()).unwrap_or_default());
            }
            row
        })
        .collect::<Vec<_>>();

    write_csv(&headers, &rows)
}

fn build_routes_csv(dataset: &ExportDataSet, worker: Option<&WorkerCtx>, include_worker: bool) -> String {
    let mut headers = vec![
        "route_id",
        "date",
        "status",
        "crew_id",
        "crew_name",
        "depot_id",
        "total_distance_km",
        "total_duration_minutes",
        "optimization_score",
        "stops_count",
    ];
    if include_worker {
        headers.insert(0, "worker_uuid");
    }

    let worker_uuid = worker.map(|w| w.worker_uuid.as_str());
    let rows = dataset
        .routes
        .iter()
        .map(|r| {
            let mut row = vec![
                pseudo_id(worker_uuid, "route", r.id),
                r.date.to_string(),
                r.status.clone(),
                r.crew_id.map(|id| pseudo_id(worker_uuid, "crew", id)).unwrap_or_default(),
                r.crew_name.clone().unwrap_or_default(),
                r.depot_id.map(|id| pseudo_id(worker_uuid, "depot", id)).unwrap_or_default(),
                r.total_distance_km.map(|d| d.to_string()).unwrap_or_default(),
                r.total_duration_minutes.map(|d| d.to_string()).unwrap_or_default(),
                r.optimization_score.map(|d| d.to_string()).unwrap_or_default(),
                r.stops_count.map(|d| d.to_string()).unwrap_or_default(),
            ];
            if include_worker {
                row.insert(0, worker.map(|w| w.worker_uuid.clone()).unwrap_or_default());
            }
            row
        })
        .collect::<Vec<_>>();

    write_csv(&headers, &rows)
}

fn build_route_stops_csv(dataset: &ExportDataSet, worker: Option<&WorkerCtx>, include_worker: bool) -> String {
    let mut headers = vec![
        "route_id",
        "stop_order",
        "stop_type",
        "customer_ref",
        "revision_ref",
        "customer_name",
        "address",
        "eta",
        "etd",
        "break_duration_minutes",
        "break_time_start",
        "scheduled_date",
        "scheduled_time_start",
        "scheduled_time_end",
        "revision_status",
    ];
    if include_worker {
        headers.insert(0, "worker_uuid");
    }

    let worker_uuid = worker.map(|w| w.worker_uuid.as_str());
    let rows = dataset
        .route_stops
        .iter()
        .map(|s| {
            let mut row = vec![
                pseudo_id(worker_uuid, "route", s.route_id),
                s.stop_order.to_string(),
                s.stop_type.clone(),
                s.customer_id
                    .map(|id| pseudo_id(worker_uuid, "customer", id))
                    .unwrap_or_default(),
                s.revision_id
                    .map(|id| pseudo_id(worker_uuid, "revision", id))
                    .unwrap_or_default(),
                s.customer_name.clone().unwrap_or_default(),
                s.address.clone().unwrap_or_default(),
                s.estimated_arrival.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                s.estimated_departure.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                s.break_duration_minutes.map(|d| d.to_string()).unwrap_or_default(),
                s.break_time_start.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                s.scheduled_date.map(|d| d.to_string()).unwrap_or_default(),
                s.scheduled_time_start.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                s.scheduled_time_end.map(|t| t.format("%H:%M").to_string()).unwrap_or_default(),
                s.revision_status.clone().unwrap_or_default(),
            ];
            if include_worker {
                row.insert(0, worker.map(|w| w.worker_uuid.clone()).unwrap_or_default());
            }
            row
        })
        .collect::<Vec<_>>();

    write_csv(&headers, &rows)
}
