#![allow(dead_code)]
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
                return_to_depot_distance_km: None,
                return_to_depot_duration_minutes: None,
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
            time_windows: vec![],
            arrival_buffer_percent: 10.0,
            arrival_buffer_fixed_minutes: 0.0,
        };
        
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("userId"));
        assert!(json.contains("customerIds"));
        assert!(json.contains("startLocation"));
    }

    // ==========================================================================
    // CustomerTimeWindow and time_windows field tests
    // ==========================================================================

    #[test]
    fn test_customer_time_window_serializes_to_camel_case() {
        let tw = CustomerTimeWindow {
            customer_id: Uuid::nil(),
            start: "08:00".to_string(),
            end: "09:00".to_string(),
        };

        let json = serde_json::to_string(&tw).unwrap();
        // Must use camelCase keys to match frontend conventions
        assert!(json.contains("customerId"), "Expected camelCase customerId, got: {}", json);
        assert!(json.contains("\"start\":\"08:00\""));
        assert!(json.contains("\"end\":\"09:00\""));
    }

    #[test]
    fn test_customer_time_window_deserializes_from_camel_case() {
        let json = r#"{
            "customerId": "00000000-0000-0000-0000-000000000001",
            "start": "14:00",
            "end": "15:00"
        }"#;

        let tw: CustomerTimeWindow = serde_json::from_str(json).unwrap();
        assert_eq!(tw.customer_id, Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap());
        assert_eq!(tw.start, "14:00");
        assert_eq!(tw.end, "15:00");
    }

    #[test]
    fn test_route_plan_job_request_with_time_windows_deserializes() {
        // This simulates what the frontend sends via NATS
        let json = r#"{
            "customerIds": ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"],
            "date": "2026-02-10",
            "startLocation": { "lat": 49.19, "lng": 16.60 },
            "timeWindows": [
                { "customerId": "00000000-0000-0000-0000-000000000001", "start": "08:00", "end": "09:00" },
                { "customerId": "00000000-0000-0000-0000-000000000002", "start": "10:00", "end": "11:00" }
            ]
        }"#;

        let request: RoutePlanJobRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.customer_ids.len(), 2);
        assert_eq!(request.time_windows.len(), 2);
        assert_eq!(request.time_windows[0].start, "08:00");
        assert_eq!(request.time_windows[0].end, "09:00");
        assert_eq!(request.time_windows[1].start, "10:00");
        assert_eq!(request.time_windows[1].end, "11:00");
    }

    #[test]
    fn test_route_plan_job_request_without_time_windows_uses_default() {
        // When the frontend omits timeWindows, serde(default) should give empty vec
        let json = r#"{
            "customerIds": ["00000000-0000-0000-0000-000000000001"],
            "date": "2026-02-10",
            "startLocation": { "lat": 49.19, "lng": 16.60 }
        }"#;

        let request: RoutePlanJobRequest = serde_json::from_str(json).unwrap();
        assert!(request.time_windows.is_empty(), "time_windows should default to empty vec when omitted");
    }

    #[test]
    fn test_route_plan_job_request_with_empty_time_windows_array() {
        // Frontend sends explicit empty array
        let json = r#"{
            "customerIds": ["00000000-0000-0000-0000-000000000001"],
            "date": "2026-02-10",
            "startLocation": { "lat": 49.19, "lng": 16.60 },
            "timeWindows": []
        }"#;

        let request: RoutePlanJobRequest = serde_json::from_str(json).unwrap();
        assert!(request.time_windows.is_empty());
    }

    #[test]
    fn test_route_plan_job_request_roundtrip_preserves_time_windows() {
        let cid = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let request = RoutePlanJobRequest {
            user_id: Some(Uuid::nil()),
            customer_ids: vec![cid],
            date: chrono::NaiveDate::from_ymd_opt(2026, 2, 10).unwrap(),
            start_location: crate::types::Coordinates { lat: 49.19, lng: 16.60 },
            crew_id: None,
            time_windows: vec![
                CustomerTimeWindow {
                    customer_id: cid,
                    start: "08:00".to_string(),
                    end: "09:00".to_string(),
                },
            ],
            arrival_buffer_percent: 10.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let json = serde_json::to_string(&request).unwrap();
        let deserialized: RoutePlanJobRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.time_windows.len(), 1);
        assert_eq!(deserialized.time_windows[0].customer_id, cid);
        assert_eq!(deserialized.time_windows[0].start, "08:00");
        assert_eq!(deserialized.time_windows[0].end, "09:00");
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
    /// Job cancelled by user
    #[serde(rename_all = "camelCase")]
    Cancelled {
        message: String,
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

/// Time window passed from the frontend for a specific customer.
/// Contains the scheduled start/end times as "HH:MM" strings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerTimeWindow {
    pub customer_id: Uuid,
    /// Scheduled time start, e.g. "14:00"
    pub start: String,
    /// Scheduled time end, e.g. "15:00"
    pub end: String,
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
    /// Crew ID — if provided, crew-specific settings are used
    #[serde(default)]
    pub crew_id: Option<Uuid>,
    /// Time windows for customers, passed directly from the saved route stops.
    /// Takes priority over DB lookup (revisions/visits) when present.
    #[serde(default)]
    pub time_windows: Vec<CustomerTimeWindow>,
    /// Arrival buffer as percentage of travel time (default 10%)
    #[serde(default = "default_buffer_percent")]
    pub arrival_buffer_percent: f64,
    /// Fixed arrival buffer in minutes (default 0)
    #[serde(default)]
    pub arrival_buffer_fixed_minutes: f64,
}

fn default_buffer_percent() -> f64 { 10.0 }

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
    /// Job cancelled by user
    #[serde(rename_all = "camelCase")]
    Cancelled {
        processed: u32,
        total: u32,
    },
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
