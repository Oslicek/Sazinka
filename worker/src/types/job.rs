//! Job queue types for async task processing
//!
//! These types support the JetStream-based job queue for long-running operations
//! like route planning, batch geocoding, etc.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::route::RoutePlanResponse;
use super::Coordinates;

// ==========================================================================
// Tests First (TDD)
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // JobSubmitResponse tests
    #[test]
    fn test_job_submit_response_serializes_to_camel_case() {
        let response = JobSubmitResponse {
            job_id: Uuid::nil(),
            position: 5,
            estimated_wait_seconds: 10,
        };
        
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("jobId"));
        assert!(json.contains("estimatedWaitSeconds"));
        assert!(!json.contains("job_id"));
    }

    #[test]
    fn test_job_submit_response_deserializes_from_camel_case() {
        let json = r#"{"jobId":"00000000-0000-0000-0000-000000000000","position":3,"estimatedWaitSeconds":5}"#;
        let response: JobSubmitResponse = serde_json::from_str(json).unwrap();
        
        assert_eq!(response.position, 3);
        assert_eq!(response.estimated_wait_seconds, 5);
    }

    // JobStatus tests
    #[test]
    fn test_job_status_queued_serializes_correctly() {
        let status = JobStatus::Queued { 
            position: 5, 
            estimated_wait_seconds: 10 
        };
        
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("queued"));
        assert!(json.contains("position"));
    }

    #[test]
    fn test_job_status_processing_serializes_correctly() {
        let status = JobStatus::Processing { 
            progress: 50, 
            message: "Calculating routes...".to_string() 
        };
        
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("processing"));
        assert!(json.contains("progress"));
        assert!(json.contains("50"));
    }

    #[test]
    fn test_job_status_completed_serializes_correctly() {
        let status = JobStatus::Completed { 
            result: RoutePlanResponse {
                stops: vec![],
                total_distance_km: 100.5,
                total_duration_minutes: 120,
                algorithm: "vrp-pragmatic".to_string(),
                solve_time_ms: 500,
                solver_log: vec![],
                optimization_score: 95,
                warnings: vec![],
                unassigned: vec![],
                geometry: vec![],
            }
        };
        
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("completed"));
        assert!(json.contains("result"));
        assert!(json.contains("totalDistanceKm"));
    }

    #[test]
    fn test_job_status_failed_serializes_correctly() {
        let status = JobStatus::Failed { 
            error: "No customers found".to_string() 
        };
        
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("failed"));
        assert!(json.contains("error"));
        assert!(json.contains("No customers found"));
    }

    // JobStatusUpdate tests
    #[test]
    fn test_job_status_update_includes_job_id_and_timestamp() {
        let update = JobStatusUpdate {
            job_id: Uuid::nil(),
            timestamp: chrono::Utc::now(),
            status: JobStatus::Queued { position: 1, estimated_wait_seconds: 5 },
        };
        
        let json = serde_json::to_string(&update).unwrap();
        assert!(json.contains("jobId"));
        assert!(json.contains("timestamp"));
        assert!(json.contains("status"));
    }

    // JobRequest tests
    #[test]
    fn test_route_plan_job_request_serializes() {
        let request = RoutePlanJobRequest {
            user_id: Some(Uuid::nil()),
            customer_ids: vec![Uuid::nil()],
            date: chrono::NaiveDate::from_ymd_opt(2026, 1, 29).unwrap(),
            start_location: crate::types::Coordinates { lat: 50.0, lng: 14.0 },
            crew_id: None,
        };
        
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("userId"));
        assert!(json.contains("customerIds"));
        assert!(json.contains("startLocation"));
    }

    // Priority tests
    #[test]
    fn test_job_priority_ordering() {
        assert!(JobPriority::High as u8 > JobPriority::Normal as u8);
        assert!(JobPriority::Normal as u8 > JobPriority::Low as u8);
    }

    // ==========================================================================
    // Geocoding Job Tests
    // ==========================================================================

    #[test]
    fn test_geocode_job_request_serializes() {
        let request = GeocodeJobRequest {
            user_id: Uuid::nil(),
            customer_ids: vec![Uuid::nil()],
        };
        
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("userId"));
        assert!(json.contains("customerIds"));
    }

    #[test]
    fn test_geocode_job_status_processing_shows_progress() {
        let status = GeocodeJobStatus::Processing {
            processed: 5,
            total: 10,
            succeeded: 4,
            failed: 1,
        };
        
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("processing"));
        assert!(json.contains("\"processed\":5"));
        assert!(json.contains("\"total\":10"));
    }

    #[test]
    fn test_geocode_job_status_completed_has_summary() {
        let status = GeocodeJobStatus::Completed {
            total: 100,
            succeeded: 95,
            failed: 5,
            failed_addresses: vec!["Bad Address 1".to_string()],
        };
        
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("completed"));
        assert!(json.contains("failedAddresses"));
    }

    #[test]
    fn test_geocode_job_result_serializes_correctly() {
        let result = GeocodeJobResult {
            customer_id: Uuid::nil(),
            success: true,
            error: None,
        };
        
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("customerId"));
        assert!(json.contains("\"success\":true"));
    }

    #[test]
    fn test_geocode_address_job_status_completed_serializes() {
        let status = GeocodeAddressJobStatus::Completed {
            coordinates: Coordinates { lat: 50.0, lng: 14.0 },
            display_name: Some("Test".to_string()),
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("completed"));
        assert!(json.contains("coordinates"));
    }

    #[test]
    fn test_reverse_geocode_job_status_completed_serializes() {
        let status = ReverseGeocodeJobStatus::Completed {
            street: "Street 1".to_string(),
            city: "City".to_string(),
            postal_code: "10000".to_string(),
            display_name: Some("Street 1, City".to_string()),
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("completed"));
        assert!(json.contains("postalCode"));
    }
}

// ==========================================================================
// Implementation
// ==========================================================================

/// Response when a job is submitted to the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSubmitResponse {
    /// Unique job identifier
    pub job_id: Uuid,
    /// Current position in queue (1-based)
    pub position: u32,
    /// Estimated wait time in seconds
    pub estimated_wait_seconds: u32,
}

/// Status of a job in the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum JobStatus {
    /// Job is waiting in queue
    #[serde(rename_all = "camelCase")]
    Queued {
        position: u32,
        estimated_wait_seconds: u32,
    },
    /// Job is being processed
    #[serde(rename_all = "camelCase")]
    Processing {
        /// Progress percentage (0-100)
        progress: u8,
        /// Human-readable status message
        message: String,
    },
    /// Job completed successfully
    #[serde(rename_all = "camelCase")]
    Completed {
        result: RoutePlanResponse,
    },
    /// Job failed
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
    },
}

/// A status update message published to the job status subject
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatusUpdate {
    /// Job ID this update is for
    pub job_id: Uuid,
    /// When this update was generated
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Current status
    pub status: JobStatus,
}

impl JobStatusUpdate {
    pub fn new(job_id: Uuid, status: JobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

/// Job priority levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobPriority {
    /// Low priority (batch jobs, background tasks)
    Low = 0,
    /// Normal priority (standard user requests)
    Normal = 1,
    /// High priority (premium users, urgent tasks)
    High = 2,
}

impl Default for JobPriority {
    fn default() -> Self {
        Self::Normal
    }
}

/// Request to plan a route (stored in job queue)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlanJobRequest {
    /// User making the request (optional - filled from Request wrapper if missing)
    #[serde(default)]
    pub user_id: Option<Uuid>,
    /// Customers to include in route
    pub customer_ids: Vec<Uuid>,
    /// Date for the route
    pub date: chrono::NaiveDate,
    /// Starting location (depot)
    pub start_location: crate::types::Coordinates,
    /// Crew ID — if provided, crew-specific settings (arrival buffer) are used
    #[serde(default)]
    pub crew_id: Option<Uuid>,
}

/// A job stored in the JetStream queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedJob {
    /// Unique job ID
    pub id: Uuid,
    /// When the job was submitted
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    /// Job priority
    pub priority: JobPriority,
    /// The actual job request
    pub request: RoutePlanJobRequest,
}

impl QueuedJob {
    pub fn new(request: RoutePlanJobRequest, priority: JobPriority) -> Self {
        Self {
            id: Uuid::new_v4(),
            submitted_at: chrono::Utc::now(),
            priority,
            request,
        }
    }
}

// ==========================================================================
// Geocoding Job Types
// ==========================================================================

/// Request to geocode a batch of customers
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodeJobRequest {
    /// User who initiated the geocoding
    pub user_id: Uuid,
    /// Customer IDs to geocode (those without coordinates)
    pub customer_ids: Vec<Uuid>,
}

/// Status of a geocoding batch job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GeocodeJobStatus {
    /// Job is waiting in queue
    #[serde(rename_all = "camelCase")]
    Queued {
        position: u32,
    },
    /// Job is being processed
    #[serde(rename_all = "camelCase")]
    Processing {
        /// Number of customers processed so far
        processed: u32,
        /// Total number of customers to process
        total: u32,
        /// Number of successful geocodes
        succeeded: u32,
        /// Number of failed geocodes
        failed: u32,
    },
    /// Job completed
    #[serde(rename_all = "camelCase")]
    Completed {
        /// Total customers processed
        total: u32,
        /// Successfully geocoded
        succeeded: u32,
        /// Failed to geocode
        failed: u32,
        /// List of addresses that failed (for display)
        failed_addresses: Vec<String>,
    },
    /// Job failed entirely
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
    },
}

/// Result of geocoding a single customer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodeJobResult {
    /// Customer ID
    pub customer_id: Uuid,
    /// Whether geocoding succeeded
    pub success: bool,
    /// Error message if failed
    pub error: Option<String>,
}

/// A geocoding job stored in JetStream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedGeocodeJob {
    /// Unique job ID
    pub id: Uuid,
    /// When the job was submitted
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    /// The geocoding request
    pub request: GeocodeJobRequest,
}

impl QueuedGeocodeJob {
    pub fn new(request: GeocodeJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            submitted_at: chrono::Utc::now(),
            request,
        }
    }
}

/// Status update for geocoding job (published via pub/sub)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodeJobStatusUpdate {
    /// Job ID
    pub job_id: Uuid,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Current status
    pub status: GeocodeJobStatus,
}

impl GeocodeJobStatusUpdate {
    pub fn new(job_id: Uuid, status: GeocodeJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

/// Request to geocode a single address (preview)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodeAddressJobRequest {
    pub street: String,
    pub city: String,
    pub postal_code: String,
}

/// Status of a geocode address job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GeocodeAddressJobStatus {
    #[serde(rename_all = "camelCase")]
    Queued { position: u32 },
    #[serde(rename_all = "camelCase")]
    Processing,
    #[serde(rename_all = "camelCase")]
    Completed {
        coordinates: Coordinates,
        display_name: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed { error: String },
}

/// Status update for geocode address job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodeAddressJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub status: GeocodeAddressJobStatus,
}

impl GeocodeAddressJobStatusUpdate {
    pub fn new(job_id: Uuid, status: GeocodeAddressJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

/// Request to reverse geocode a point for a customer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseGeocodeJobRequest {
    pub customer_id: Uuid,
    pub lat: f64,
    pub lng: f64,
}

/// Status of a reverse geocode job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ReverseGeocodeJobStatus {
    #[serde(rename_all = "camelCase")]
    Queued { position: u32 },
    #[serde(rename_all = "camelCase")]
    Processing,
    #[serde(rename_all = "camelCase")]
    Completed {
        street: String,
        city: String,
        postal_code: String,
        display_name: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed { error: String },
}

/// Status update for reverse geocode job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseGeocodeJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub status: ReverseGeocodeJobStatus,
}

impl ReverseGeocodeJobStatusUpdate {
    pub fn new(job_id: Uuid, status: ReverseGeocodeJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}
