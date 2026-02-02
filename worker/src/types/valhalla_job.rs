//! Valhalla routing job types for JetStream-based async processing
//!
//! These types support the JetStream job queue for routing operations:
//! - Matrix calculations (distance/time between locations)
//! - Route geometry (polyline for map display)

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::Coordinates;
use crate::services::routing::DistanceTimeMatrices;

// ==========================================================================
// Tests First (TDD)
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // MatrixJobRequest tests
    #[test]
    fn test_matrix_job_request_serializes_to_camel_case() {
        let request = MatrixJobRequest {
            locations: vec![
                Coordinates { lat: 50.0, lng: 14.0 },
                Coordinates { lat: 49.0, lng: 16.0 },
            ],
        };
        
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("locations"));
        assert!(json.contains("50.0"));
    }

    #[test]
    fn test_matrix_job_request_deserializes() {
        let json = r#"{"locations":[{"lat":50.0,"lng":14.0}]}"#;
        let request: MatrixJobRequest = serde_json::from_str(json).unwrap();
        
        assert_eq!(request.locations.len(), 1);
        assert_eq!(request.locations[0].lat, 50.0);
    }

    // GeometryJobRequest tests
    #[test]
    fn test_geometry_job_request_serializes() {
        let request = GeometryJobRequest {
            locations: vec![
                Coordinates { lat: 50.0, lng: 14.0 },
                Coordinates { lat: 49.0, lng: 16.0 },
            ],
        };
        
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("locations"));
    }

    // MatrixJobStatus tests
    #[test]
    fn test_matrix_job_status_queued_serializes() {
        let status = MatrixJobStatus::Queued { position: 5 };
        let json = serde_json::to_string(&status).unwrap();
        
        assert!(json.contains("queued"));
        assert!(json.contains("position"));
        assert!(json.contains("5"));
    }

    #[test]
    fn test_matrix_job_status_processing_serializes() {
        let status = MatrixJobStatus::Processing {
            message: "Calculating distances...".to_string(),
        };
        let json = serde_json::to_string(&status).unwrap();
        
        assert!(json.contains("processing"));
        assert!(json.contains("Calculating distances"));
    }

    #[test]
    fn test_matrix_job_status_completed_serializes() {
        let status = MatrixJobStatus::Completed {
            distances: vec![vec![0, 100], vec![100, 0]],
            durations: vec![vec![0, 60], vec![60, 0]],
            size: 2,
        };
        let json = serde_json::to_string(&status).unwrap();
        
        assert!(json.contains("completed"));
        assert!(json.contains("distances"));
        assert!(json.contains("durations"));
        assert!(json.contains("size"));
    }

    #[test]
    fn test_matrix_job_status_failed_serializes() {
        let status = MatrixJobStatus::Failed {
            error: "Connection timeout".to_string(),
            retries: 3,
        };
        let json = serde_json::to_string(&status).unwrap();
        
        assert!(json.contains("failed"));
        assert!(json.contains("Connection timeout"));
        assert!(json.contains("retries"));
    }

    // GeometryJobStatus tests
    #[test]
    fn test_geometry_job_status_completed_serializes() {
        let status = GeometryJobStatus::Completed {
            coordinates: vec![[14.0, 50.0], [16.0, 49.0]],
        };
        let json = serde_json::to_string(&status).unwrap();
        
        assert!(json.contains("completed"));
        assert!(json.contains("coordinates"));
    }

    // QueuedMatrixJob tests
    #[test]
    fn test_queued_matrix_job_creates_with_uuid() {
        let request = MatrixJobRequest {
            locations: vec![Coordinates { lat: 50.0, lng: 14.0 }],
        };
        let job = QueuedMatrixJob::new(request);
        
        assert!(!job.id.is_nil());
        assert_eq!(job.request.locations.len(), 1);
    }

    // StatusUpdate tests
    #[test]
    fn test_matrix_job_status_update_serializes() {
        let update = MatrixJobStatusUpdate::new(
            Uuid::nil(),
            MatrixJobStatus::Queued { position: 1 },
        );
        let json = serde_json::to_string(&update).unwrap();
        
        assert!(json.contains("jobId"));
        assert!(json.contains("timestamp"));
        assert!(json.contains("status"));
    }
}

// ==========================================================================
// Matrix Job Types
// ==========================================================================

/// Request to calculate distance/time matrix between locations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixJobRequest {
    /// List of locations (first is typically depot)
    pub locations: Vec<Coordinates>,
}

/// Status of a matrix calculation job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MatrixJobStatus {
    /// Job is waiting in queue
    #[serde(rename_all = "camelCase")]
    Queued {
        position: u32,
    },
    /// Job is being processed
    #[serde(rename_all = "camelCase")]
    Processing {
        message: String,
    },
    /// Job completed successfully
    #[serde(rename_all = "camelCase")]
    Completed {
        /// Distance matrix in meters [i][j]
        distances: Vec<Vec<u64>>,
        /// Duration matrix in seconds [i][j]
        durations: Vec<Vec<u64>>,
        /// Number of locations
        size: usize,
    },
    /// Job failed
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
        retries: u32,
    },
}

impl MatrixJobStatus {
    /// Create completed status from DistanceTimeMatrices
    pub fn from_matrices(matrices: &DistanceTimeMatrices) -> Self {
        Self::Completed {
            distances: matrices.distances.clone(),
            durations: matrices.durations.clone(),
            size: matrices.size,
        }
    }
}

/// A matrix job stored in the JetStream queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedMatrixJob {
    /// Unique job ID
    pub id: Uuid,
    /// When the job was submitted
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    /// The matrix calculation request
    pub request: MatrixJobRequest,
}

impl QueuedMatrixJob {
    pub fn new(request: MatrixJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            submitted_at: chrono::Utc::now(),
            request,
        }
    }
}

/// Status update for matrix job (published via pub/sub)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixJobStatusUpdate {
    /// Job ID
    pub job_id: Uuid,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Current status
    pub status: MatrixJobStatus,
}

impl MatrixJobStatusUpdate {
    pub fn new(job_id: Uuid, status: MatrixJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

// ==========================================================================
// Geometry Job Types
// ==========================================================================

/// Request to get route geometry (polyline) between locations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryJobRequest {
    /// Ordered list of locations for the route
    pub locations: Vec<Coordinates>,
}

/// Status of a geometry calculation job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GeometryJobStatus {
    /// Job is waiting in queue
    #[serde(rename_all = "camelCase")]
    Queued {
        position: u32,
    },
    /// Job is being processed
    #[serde(rename_all = "camelCase")]
    Processing {
        message: String,
    },
    /// Job completed successfully
    #[serde(rename_all = "camelCase")]
    Completed {
        /// GeoJSON coordinates [lng, lat] for the route polyline
        coordinates: Vec<[f64; 2]>,
    },
    /// Job failed
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
        retries: u32,
    },
}

/// A geometry job stored in the JetStream queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedGeometryJob {
    /// Unique job ID
    pub id: Uuid,
    /// When the job was submitted
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    /// The geometry request
    pub request: GeometryJobRequest,
}

impl QueuedGeometryJob {
    pub fn new(request: GeometryJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            submitted_at: chrono::Utc::now(),
            request,
        }
    }
}

/// Status update for geometry job (published via pub/sub)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryJobStatusUpdate {
    /// Job ID
    pub job_id: Uuid,
    /// Timestamp
    pub timestamp: chrono::DateTime<chrono::Utc>,
    /// Current status
    pub status: GeometryJobStatus,
}

impl GeometryJobStatusUpdate {
    pub fn new(job_id: Uuid, status: GeometryJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

// ==========================================================================
// Response Types for NATS Request/Response
// ==========================================================================

/// Response when a matrix job is submitted
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixJobSubmitResponse {
    /// Unique job identifier
    pub job_id: Uuid,
    /// Message
    pub message: String,
}

/// Response when a geometry job is submitted
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryJobSubmitResponse {
    /// Unique job identifier
    pub job_id: Uuid,
    /// Message
    pub message: String,
}
