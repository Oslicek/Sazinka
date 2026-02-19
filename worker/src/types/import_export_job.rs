#![allow(dead_code)]
//! Import/Export job types for JetStream-based async processing
//!
//! These types support the JetStream job queue for:
//! - Batch CSV imports (devices, revisions, communications, visits)
//! - CSV exports with progress tracking

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    ImportDeviceBatchRequest, ImportRevisionBatchRequest,
    ImportCommunicationBatchRequest, ImportWorkLogBatchRequest,
    ImportIssue,
};

// ==========================================================================
// Tests First (TDD)
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ImportJobRequest tests
    #[test]
    fn test_import_job_request_device_serializes() {
        let request = ImportJobRequest::Device(ImportDeviceBatchRequest {
            devices: vec![],
        });
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("device"));
    }

    #[test]
    fn test_import_job_request_revision_serializes() {
        let request = ImportJobRequest::Revision(ImportRevisionBatchRequest {
            revisions: vec![],
        });
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("revision"));
    }

    // ImportJobStatus tests
    #[test]
    fn test_import_job_status_queued_serializes() {
        let status = ImportJobStatus::Queued { position: 3 };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("queued"));
        assert!(json.contains("position"));
    }

    #[test]
    fn test_import_job_status_processing_serializes() {
        let status = ImportJobStatus::Processing {
            processed: 50,
            total: 100,
            imported: 45,
            updated: 3,
            failed: 2,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("processing"));
        assert!(json.contains("processed"));
        assert!(json.contains("total"));
    }

    #[test]
    fn test_import_job_status_completed_serializes() {
        let status = ImportJobStatus::Completed {
            imported_count: 95,
            updated_count: 3,
            failed_count: 2,
            errors: vec![],
            duration_ms: 5000,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("completed"));
        assert!(json.contains("importedCount"));
        assert!(json.contains("durationMs"));
    }

    // ExportJobRequest tests
    #[test]
    fn test_export_job_request_customers_serializes() {
        let request = ExportJobRequest::Customers(ExportCustomersRequest {
            include_devices: true,
            include_revisions: false,
        });
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("customers"));
    }

    #[test]
    fn test_export_job_request_revisions_serializes() {
        let request = ExportJobRequest::Revisions(ExportRevisionsRequest {
            status_filter: Some(vec!["completed".to_string()]),
            date_from: None,
            date_to: None,
        });
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("revisions"));
    }

    // ExportJobStatus tests
    #[test]
    fn test_export_job_status_completed_has_download_url() {
        let status = ExportJobStatus::Completed {
            row_count: 500,
            file_size_bytes: 102400,
            download_url: "https://example.com/export.csv".to_string(),
            duration_ms: 3000,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("downloadUrl"));
        assert!(json.contains("rowCount"));
    }

    // QueuedImportJob tests
    #[test]
    fn test_queued_import_job_creates_with_uuid() {
        let request = ImportJobRequest::Device(ImportDeviceBatchRequest {
            devices: vec![],
        });
        let job = QueuedImportJob::new(Uuid::nil(), request);
        assert!(!job.id.is_nil());
    }
}

// ==========================================================================
// Import Job Types
// ==========================================================================

/// Type of import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ImportJobRequest {
    /// Device batch import
    #[serde(rename_all = "camelCase")]
    Device(ImportDeviceBatchRequest),
    /// Revision batch import
    #[serde(rename_all = "camelCase")]
    Revision(ImportRevisionBatchRequest),
    /// Communication batch import
    #[serde(rename_all = "camelCase")]
    Communication(ImportCommunicationBatchRequest),
    /// Work log batch import (replaces visit import)
    #[serde(rename_all = "camelCase")]
    WorkLog(ImportWorkLogBatchRequest),
}

impl ImportJobRequest {
    /// Get the total number of items in the import
    pub fn item_count(&self) -> usize {
        match self {
            ImportJobRequest::Device(r) => r.devices.len(),
            ImportJobRequest::Revision(r) => r.revisions.len(),
            ImportJobRequest::Communication(r) => r.communications.len(),
            ImportJobRequest::WorkLog(r) => r.entries.len(),
        }
    }
    
    /// Get the import type name
    pub fn type_name(&self) -> &'static str {
        match self {
            ImportJobRequest::Device(_) => "device",
            ImportJobRequest::Revision(_) => "revision",
            ImportJobRequest::Communication(_) => "communication",
            ImportJobRequest::WorkLog(_) => "work_log",
        }
    }
}

/// Status of an import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ImportJobStatus {
    /// Job is waiting in queue
    #[serde(rename_all = "camelCase")]
    Queued {
        position: u32,
    },
    /// Job is being processed
    #[serde(rename_all = "camelCase")]
    Processing {
        /// Number of rows processed so far
        processed: u32,
        /// Total number of rows
        total: u32,
        /// Successfully imported
        imported: u32,
        /// Successfully updated (existing records)
        updated: u32,
        /// Failed rows
        failed: u32,
    },
    /// Job completed
    #[serde(rename_all = "camelCase")]
    Completed {
        /// Total imported count
        imported_count: u32,
        /// Total updated count
        updated_count: u32,
        /// Total failed count
        failed_count: u32,
        /// List of errors/issues
        errors: Vec<ImportIssue>,
        /// Duration in milliseconds
        duration_ms: u64,
    },
    /// Job failed entirely
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
    },
}

/// A queued import job in JetStream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedImportJob {
    /// Unique job ID
    pub id: Uuid,
    /// User who submitted the import
    pub user_id: Uuid,
    /// When the job was submitted
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    /// The import request
    pub request: ImportJobRequest,
}

impl QueuedImportJob {
    pub fn new(user_id: Uuid, request: ImportJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: chrono::Utc::now(),
            request,
        }
    }
}

/// Status update for import job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobStatusUpdate {
    /// Job ID
    pub job_id: Uuid,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Current status
    pub status: ImportJobStatus,
}

impl ImportJobStatusUpdate {
    pub fn new(job_id: Uuid, status: ImportJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

/// Response when an import job is submitted
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJobSubmitResponse {
    /// Unique job identifier
    pub job_id: Uuid,
    /// Import type
    pub import_type: String,
    /// Number of items to import
    pub item_count: usize,
    /// Message
    pub message: String,
}

// ==========================================================================
// Export Job Types
// ==========================================================================

/// Request to export customers
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCustomersRequest {
    /// Include device information
    pub include_devices: bool,
    /// Include revision information
    pub include_revisions: bool,
}

/// Request to export revisions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRevisionsRequest {
    /// Filter by status
    pub status_filter: Option<Vec<String>>,
    /// Date range start
    pub date_from: Option<String>,
    /// Date range end
    pub date_to: Option<String>,
}

/// Request to export communications
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCommunicationsRequest {
    /// Filter by type
    pub type_filter: Option<Vec<String>>,
    /// Date range start
    pub date_from: Option<String>,
    /// Date range end
    pub date_to: Option<String>,
}

/// Type of export job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExportJobRequest {
    /// Customer export
    #[serde(rename_all = "camelCase")]
    Customers(ExportCustomersRequest),
    /// Revision export
    #[serde(rename_all = "camelCase")]
    Revisions(ExportRevisionsRequest),
    /// Communication export
    #[serde(rename_all = "camelCase")]
    Communications(ExportCommunicationsRequest),
}

impl ExportJobRequest {
    /// Get the export type name
    pub fn type_name(&self) -> &'static str {
        match self {
            ExportJobRequest::Customers(_) => "customers",
            ExportJobRequest::Revisions(_) => "revisions",
            ExportJobRequest::Communications(_) => "communications",
        }
    }
}

/// Status of an export job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExportJobStatus {
    /// Job is waiting in queue
    #[serde(rename_all = "camelCase")]
    Queued {
        position: u32,
    },
    /// Job is being processed
    #[serde(rename_all = "camelCase")]
    Processing {
        /// Number of rows processed so far
        processed: u32,
        /// Estimated total rows (may change during processing)
        estimated_total: u32,
        /// Status message
        message: String,
    },
    /// Job completed
    #[serde(rename_all = "camelCase")]
    Completed {
        /// Number of rows exported
        row_count: u32,
        /// File size in bytes
        file_size_bytes: u64,
        /// URL to download the exported file
        download_url: String,
        /// Duration in milliseconds
        duration_ms: u64,
    },
    /// Job failed
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
    },
    /// Job cancelled by user
    #[serde(rename_all = "camelCase")]
    Cancelled {
        message: String,
    },
}

/// A queued export job in JetStream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedExportJob {
    /// Unique job ID
    pub id: Uuid,
    /// User who submitted the export
    pub user_id: Uuid,
    /// When the job was submitted
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    /// The export request
    pub request: ExportJobRequest,
}

impl QueuedExportJob {
    pub fn new(user_id: Uuid, request: ExportJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: chrono::Utc::now(),
            request,
        }
    }
}

/// Status update for export job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJobStatusUpdate {
    /// Job ID
    pub job_id: Uuid,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Current status
    pub status: ExportJobStatus,
}

impl ExportJobStatusUpdate {
    pub fn new(job_id: Uuid, status: ExportJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

/// Response when an export job is submitted
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJobSubmitResponse {
    /// Unique job identifier
    pub job_id: Uuid,
    /// Export type
    pub export_type: String,
    /// Message
    pub message: String,
}
