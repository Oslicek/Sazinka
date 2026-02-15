//! Import batch types for CSV import functionality

use serde::{Deserialize, Serialize};

/// Import issue level
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportIssueLevel {
    Info,
    Warning,
    Error,
}

/// Machine-readable error codes for import issues
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ImportIssueCode {
    CustomerNotFound,
    DeviceNotFound,
    DuplicateRecord,
    MissingField,
    InvalidDate,
    InvalidValue,
    InvalidStatus,
    InvalidResult,
    DbError,
    ParseError,
    Unknown,
}

/// Single import issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub row_number: i32,
    pub level: ImportIssueLevel,
    pub code: ImportIssueCode,
    pub field: String,
    pub message: String,
    pub original_value: Option<String>,
}

/// Structured import report generated after an import job completes.
/// Persisted as JSON files in logs/import-reports/{jobId}.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub job_id: Uuid,
    pub job_type: String,
    pub filename: String,
    pub imported_at: String,
    pub duration_ms: u64,
    pub total_rows: u32,
    pub imported_count: u32,
    pub updated_count: u32,
    pub skipped_count: u32,
    pub issues: Vec<ImportIssue>,
}

/// Generic batch import response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchResponse {
    pub imported_count: i32,
    pub updated_count: i32,
    pub errors: Vec<ImportIssue>,
}

// =============================================================================
// DEVICE IMPORT
// =============================================================================

/// Request to import a single device
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDeviceRequest {
    pub customer_ref: String,
    pub device_type: String,
    pub device_name: Option<String>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub installation_date: Option<String>,
    pub revision_interval_months: i32,
    pub notes: Option<String>,
}

/// Request to import devices in batch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDeviceBatchRequest {
    pub devices: Vec<ImportDeviceRequest>,
}

// =============================================================================
// REVISION IMPORT
// =============================================================================

/// Request to import a single revision
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRevisionRequest {
    pub device_ref: String,
    pub customer_ref: String,
    pub due_date: String,
    pub status: Option<String>,
    pub scheduled_date: Option<String>,
    pub scheduled_time_start: Option<String>,
    pub scheduled_time_end: Option<String>,
    pub completed_at: Option<String>,
    pub duration_minutes: Option<i32>,
    pub result: Option<String>,
    pub findings: Option<String>,
}

/// Request to import revisions in batch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRevisionBatchRequest {
    pub revisions: Vec<ImportRevisionRequest>,
}

// =============================================================================
// COMMUNICATION IMPORT
// =============================================================================

/// Request to import a single communication
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommunicationRequest {
    pub customer_ref: String,
    pub date: String,
    pub comm_type: String,
    pub direction: String,
    pub subject: Option<String>,
    pub content: String,
    pub contact_name: Option<String>,
    pub contact_phone: Option<String>,
    pub duration_minutes: Option<i32>,
}

/// Request to import communications in batch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommunicationBatchRequest {
    pub communications: Vec<ImportCommunicationRequest>,
}

// =============================================================================
// WORK LOG IMPORT (replaces visit import)
// =============================================================================

/// Request to import a single work log entry
/// Rows with same customer_ref + scheduled_date are grouped into one visit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWorkLogRequest {
    pub customer_ref: String,
    pub scheduled_date: String,
    pub scheduled_time_start: Option<String>,
    pub scheduled_time_end: Option<String>,
    pub device_ref: Option<String>,
    pub work_type: String,
    pub status: Option<String>,
    pub result: Option<String>,
    pub duration_minutes: Option<i32>,
    pub result_notes: Option<String>,
    pub findings: Option<String>,
    pub requires_follow_up: Option<bool>,
    pub follow_up_reason: Option<String>,
}

/// Request to import work log entries in batch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportWorkLogBatchRequest {
    pub entries: Vec<ImportWorkLogRequest>,
}

// =============================================================================
// CUSTOMER IMPORT JOB (async background processing)
// =============================================================================

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Request to submit a customer import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerImportJobRequest {
    pub csv_content: String,
    pub filename: String,
}

/// Status of a customer import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CustomerImportJobStatus {
    #[serde(rename_all = "camelCase")]
    Queued { position: u32 },
    #[serde(rename_all = "camelCase")]
    Parsing { progress: u8 },
    #[serde(rename_all = "camelCase")]
    Importing { processed: u32, total: u32, succeeded: u32, failed: u32 },
    #[serde(rename_all = "camelCase")]
    Completed { total: u32, succeeded: u32, failed: u32, report: ImportReport },
    #[serde(rename_all = "camelCase")]
    Failed { error: String },
    #[serde(rename_all = "camelCase")]
    Cancelled { processed: u32, total: u32 },
}

/// Status update message for customer import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerImportJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub status: CustomerImportJobStatus,
}

impl CustomerImportJobStatusUpdate {
    pub fn new(job_id: Uuid, status: CustomerImportJobStatus) -> Self {
        Self {
            job_id,
            timestamp: Utc::now(),
            status,
        }
    }
}

/// Response when submitting an import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerImportJobSubmitResponse {
    pub job_id: Uuid,
    pub message: String,
}

/// Queued customer import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedCustomerImportJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub request: CustomerImportJobRequest,
}

impl QueuedCustomerImportJob {
    pub fn new(user_id: Uuid, request: CustomerImportJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: Utc::now(),
            request,
        }
    }
}

// =============================================================================
// DEVICE IMPORT JOB (async background processing)
// =============================================================================

/// Request to submit a device import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceImportJobRequest {
    pub csv_content: String,
    pub filename: String,
}

/// Status of a device import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum DeviceImportJobStatus {
    #[serde(rename_all = "camelCase")]
    Queued { position: u32 },
    #[serde(rename_all = "camelCase")]
    Parsing { progress: u8 },
    #[serde(rename_all = "camelCase")]
    Importing { processed: u32, total: u32, succeeded: u32, failed: u32 },
    #[serde(rename_all = "camelCase")]
    Completed { total: u32, succeeded: u32, failed: u32, report: ImportReport },
    #[serde(rename_all = "camelCase")]
    Failed { error: String },
    #[serde(rename_all = "camelCase")]
    Cancelled { processed: u32, total: u32 },
}

/// Status update message for device import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceImportJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub status: DeviceImportJobStatus,
}

impl DeviceImportJobStatusUpdate {
    pub fn new(job_id: Uuid, status: DeviceImportJobStatus) -> Self {
        Self {
            job_id,
            timestamp: Utc::now(),
            status,
        }
    }
}

/// Response when submitting a device import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceImportJobSubmitResponse {
    pub job_id: Uuid,
    pub message: String,
}

/// Queued device import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedDeviceImportJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub request: DeviceImportJobRequest,
}

impl QueuedDeviceImportJob {
    pub fn new(user_id: Uuid, request: DeviceImportJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: Utc::now(),
            request,
        }
    }
}

// =============================================================================
// REVISION IMPORT JOB (async background processing)
// =============================================================================

/// Request to submit a revision import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionImportJobRequest {
    pub csv_content: String,
    pub filename: String,
}

/// Status of a revision import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RevisionImportJobStatus {
    #[serde(rename_all = "camelCase")]
    Queued { position: u32 },
    #[serde(rename_all = "camelCase")]
    Parsing { progress: u8 },
    #[serde(rename_all = "camelCase")]
    Importing { processed: u32, total: u32, succeeded: u32, failed: u32 },
    #[serde(rename_all = "camelCase")]
    Completed { total: u32, succeeded: u32, failed: u32, report: ImportReport },
    #[serde(rename_all = "camelCase")]
    Failed { error: String },
    #[serde(rename_all = "camelCase")]
    Cancelled { processed: u32, total: u32 },
}

/// Status update message for revision import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionImportJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub status: RevisionImportJobStatus,
}

impl RevisionImportJobStatusUpdate {
    pub fn new(job_id: Uuid, status: RevisionImportJobStatus) -> Self {
        Self {
            job_id,
            timestamp: Utc::now(),
            status,
        }
    }
}

/// Response when submitting a revision import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionImportJobSubmitResponse {
    pub job_id: Uuid,
    pub message: String,
}

/// Queued revision import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedRevisionImportJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub request: RevisionImportJobRequest,
}

impl QueuedRevisionImportJob {
    pub fn new(user_id: Uuid, request: RevisionImportJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: Utc::now(),
            request,
        }
    }
}

// =============================================================================
// COMMUNICATION IMPORT JOB (async background processing)
// =============================================================================

/// Request to submit a communication import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunicationImportJobRequest {
    pub csv_content: String,
    pub filename: String,
}

/// Status of a communication import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CommunicationImportJobStatus {
    #[serde(rename_all = "camelCase")]
    Queued { position: u32 },
    #[serde(rename_all = "camelCase")]
    Parsing { progress: u8 },
    #[serde(rename_all = "camelCase")]
    Importing { processed: u32, total: u32, succeeded: u32, failed: u32 },
    #[serde(rename_all = "camelCase")]
    Completed { total: u32, succeeded: u32, failed: u32, report: ImportReport },
    #[serde(rename_all = "camelCase")]
    Failed { error: String },
    #[serde(rename_all = "camelCase")]
    Cancelled { processed: u32, total: u32 },
}

/// Status update message for communication import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunicationImportJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub status: CommunicationImportJobStatus,
}

impl CommunicationImportJobStatusUpdate {
    pub fn new(job_id: Uuid, status: CommunicationImportJobStatus) -> Self {
        Self {
            job_id,
            timestamp: Utc::now(),
            status,
        }
    }
}

/// Response when submitting a communication import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunicationImportJobSubmitResponse {
    pub job_id: Uuid,
    pub message: String,
}

/// Queued communication import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedCommunicationImportJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub request: CommunicationImportJobRequest,
}

impl QueuedCommunicationImportJob {
    pub fn new(user_id: Uuid, request: CommunicationImportJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: Utc::now(),
            request,
        }
    }
}

// =============================================================================
// WORK LOG IMPORT JOB (async background processing)
// =============================================================================

/// Request to submit a work log import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogImportJobRequest {
    pub csv_content: String,
    pub filename: String,
}

/// Status of a work log import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WorkLogImportJobStatus {
    #[serde(rename_all = "camelCase")]
    Queued { position: u32 },
    #[serde(rename_all = "camelCase")]
    Parsing { progress: u8 },
    #[serde(rename_all = "camelCase")]
    Importing { processed: u32, total: u32, succeeded: u32, failed: u32 },
    #[serde(rename_all = "camelCase")]
    Completed { total: u32, succeeded: u32, failed: u32, report: ImportReport },
    #[serde(rename_all = "camelCase")]
    Failed { error: String },
    #[serde(rename_all = "camelCase")]
    Cancelled { processed: u32, total: u32 },
}

/// Status update message for work log import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogImportJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub status: WorkLogImportJobStatus,
}

impl WorkLogImportJobStatusUpdate {
    pub fn new(job_id: Uuid, status: WorkLogImportJobStatus) -> Self {
        Self {
            job_id,
            timestamp: Utc::now(),
            status,
        }
    }
}

/// Response when submitting a work log import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkLogImportJobSubmitResponse {
    pub job_id: Uuid,
    pub message: String,
}

/// Queued work log import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedWorkLogImportJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub request: WorkLogImportJobRequest,
}

impl QueuedWorkLogImportJob {
    pub fn new(user_id: Uuid, request: WorkLogImportJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: Utc::now(),
            request,
        }
    }
}

// =============================================================================
// ZIP IMPORT JOB (async background processing)
// =============================================================================

/// File type in ZIP import
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ZipImportFileType {
    Customers,
    Devices,
    Revisions,
    Communications,
    WorkLog,
}

impl ZipImportFileType {
    /// Get import order priority (lower = imported first)
    pub fn import_order(&self) -> u8 {
        match self {
            ZipImportFileType::Customers => 1,
            ZipImportFileType::Devices => 2,
            ZipImportFileType::Revisions => 3,
            ZipImportFileType::Communications => 4,
            ZipImportFileType::WorkLog => 5,
        }
    }
    
    /// Get human-readable type name
    pub fn type_name(&self) -> &'static str {
        match self {
            ZipImportFileType::Customers => "customers",
            ZipImportFileType::Devices => "devices",
            ZipImportFileType::Revisions => "revisions",
            ZipImportFileType::Communications => "communications",
            ZipImportFileType::WorkLog => "work_log",
        }
    }
    
    /// Try to detect file type from filename
    pub fn from_filename(filename: &str) -> Option<Self> {
        let lower = filename.to_lowercase();
        if lower.contains("customer") || lower.contains("zakazn") {
            Some(ZipImportFileType::Customers)
        } else if lower.contains("device") || lower.contains("zariz") {
            Some(ZipImportFileType::Devices)
        } else if lower.contains("revision") || lower.contains("reviz") {
            Some(ZipImportFileType::Revisions)
        } else if lower.contains("communication") || lower.contains("komunik") {
            Some(ZipImportFileType::Communications)
        } else if lower.contains("work_log") || lower.contains("worklog") || lower.contains("pracovni") {
            Some(ZipImportFileType::WorkLog)
        } else {
            None
        }
    }
}

/// Info about a file in a ZIP archive
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipImportFileInfo {
    pub filename: String,
    pub file_type: ZipImportFileType,
    pub size: u64,
}

/// Request to submit a ZIP import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipImportJobRequest {
    /// Base64 encoded ZIP content
    pub zip_content_base64: String,
    pub filename: String,
}

/// Result of importing a single file from ZIP
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipImportFileResult {
    pub filename: String,
    pub file_type: ZipImportFileType,
    pub succeeded: u32,
    pub failed: u32,
    pub report: ImportReport,
}

/// Status of a ZIP import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ZipImportJobStatus {
    #[serde(rename_all = "camelCase")]
    Queued { position: u32 },
    #[serde(rename_all = "camelCase")]
    Extracting { progress: u8 },
    #[serde(rename_all = "camelCase")]
    Analyzing { files: Vec<ZipImportFileInfo> },
    #[serde(rename_all = "camelCase")]
    Importing {
        current_file: String,
        current_file_type: ZipImportFileType,
        file_progress: u8,
        total_files: u32,
        completed_files: u32,
    },
    #[serde(rename_all = "camelCase")]
    Completed {
        total_files: u32,
        results: Vec<ZipImportFileResult>,
    },
    #[serde(rename_all = "camelCase")]
    Failed { error: String },
    #[serde(rename_all = "camelCase")]
    Cancelled { completed_files: u32, total_files: u32 },
}

/// Status update message for ZIP import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipImportJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub status: ZipImportJobStatus,
}

impl ZipImportJobStatusUpdate {
    pub fn new(job_id: Uuid, status: ZipImportJobStatus) -> Self {
        Self {
            job_id,
            timestamp: Utc::now(),
            status,
        }
    }
}

/// Response when submitting a ZIP import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipImportJobSubmitResponse {
    pub job_id: Uuid,
    pub message: String,
    pub detected_files: Vec<ZipImportFileInfo>,
}

/// Queued ZIP import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedZipImportJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub submitted_at: DateTime<Utc>,
    pub request: ZipImportJobRequest,
    /// Detected files to import (sorted by import order)
    pub files: Vec<ZipImportFileInfo>,
}

impl QueuedZipImportJob {
    pub fn new(user_id: Uuid, request: ZipImportJobRequest, files: Vec<ZipImportFileInfo>) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: Utc::now(),
            request,
            files,
        }
    }
}
