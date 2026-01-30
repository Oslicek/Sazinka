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

/// Single import issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub row_number: i32,
    pub level: ImportIssueLevel,
    pub field: String,
    pub message: String,
    pub original_value: Option<String>,
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
// VISIT IMPORT
// =============================================================================

/// Request to import a single visit
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportVisitRequest {
    pub customer_ref: String,
    pub device_ref: Option<String>,
    pub scheduled_date: String,
    pub scheduled_time_start: Option<String>,
    pub scheduled_time_end: Option<String>,
    pub visit_type: String,
    pub status: Option<String>,
    pub result: Option<String>,
    pub result_notes: Option<String>,
    pub requires_follow_up: Option<bool>,
    pub follow_up_reason: Option<String>,
}

/// Request to import visits in batch
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportVisitBatchRequest {
    pub visits: Vec<ImportVisitRequest>,
}
