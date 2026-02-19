#![allow(dead_code)]
//! Valhalla JetStream processor
//!
//! Wraps Valhalla routing engine with JetStream for:
//! - Automatic backpressure
//! - Retry on failure (up to 3 times)
//! - Persistence across restarts
//! - Real-time status updates
//!
//! ## Streams
//! - `SAZINKA_ROUTING_MATRIX_JOBS` - Distance/time matrix calculations
//! - `SAZINKA_ROUTING_GEOMETRY_JOBS` - Route polyline geometry

use std::sync::Arc;
use anyhow::Result;
use async_nats::Client;
use async_nats::jetstream::{self, Context as JsContext};
use futures::StreamExt;
use tracing::{info, warn, error};
use uuid::Uuid;

use crate::services::routing::{ValhallaClient, ValhallaConfig, RoutingService};
use crate::types::{
    Coordinates,
    MatrixJobRequest, MatrixJobStatus, MatrixJobStatusUpdate,
    QueuedMatrixJob, MatrixJobSubmitResponse,
    GeometryJobRequest, GeometryJobStatus, GeometryJobStatusUpdate,
    QueuedGeometryJob, GeometryJobSubmitResponse,
};

// Stream and consumer names
const MATRIX_STREAM_NAME: &str = "SAZINKA_ROUTING_MATRIX_JOBS";
const MATRIX_CONSUMER_NAME: &str = "matrix_workers";
const MATRIX_SUBJECT: &str = "sazinka.jobs.valhalla.matrix";
const MATRIX_STATUS_PREFIX: &str = "sazinka.job.valhalla.matrix.status";

const GEOMETRY_STREAM_NAME: &str = "SAZINKA_ROUTING_GEOMETRY_JOBS";
const GEOMETRY_CONSUMER_NAME: &str = "geometry_workers";
const GEOMETRY_SUBJECT: &str = "sazinka.jobs.valhalla.geometry";
const GEOMETRY_STATUS_PREFIX: &str = "sazinka.job.valhalla.geometry.status";

/// Valhalla job processor with JetStream integration
pub struct ValhallaProcessor {
    client: Client,
    js: JsContext,
    valhalla: ValhallaClient,
}

impl ValhallaProcessor {
    /// Create a new Valhalla processor, initializing JetStream streams
    pub async fn new(client: Client, valhalla_url: &str) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create matrix stream
        let matrix_stream_config = jetstream::stream::Config {
            name: MATRIX_STREAM_NAME.to_string(),
            subjects: vec![MATRIX_SUBJECT.to_string()],
            max_messages: 1_000,
            max_bytes: 50 * 1024 * 1024, // 50 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(matrix_stream_config).await?;
        info!("JetStream Valhalla matrix stream '{}' ready", MATRIX_STREAM_NAME);
        
        // Create geometry stream
        let geometry_stream_config = jetstream::stream::Config {
            name: GEOMETRY_STREAM_NAME.to_string(),
            subjects: vec![GEOMETRY_SUBJECT.to_string()],
            max_messages: 1_000,
            max_bytes: 100 * 1024 * 1024, // 100 MB (geometry can be large)
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(geometry_stream_config).await?;
        info!("JetStream Valhalla geometry stream '{}' ready", GEOMETRY_STREAM_NAME);
        
        // Create Valhalla client
        let config = ValhallaConfig::new(valhalla_url);
        let valhalla = ValhallaClient::new(config);
        
        Ok(Self {
            client,
            js,
            valhalla,
        })
    }
    
    // ==========================================================================
    // Matrix Job Methods
    // ==========================================================================
    
    /// Submit a matrix calculation job to the queue
    pub async fn submit_matrix_job(&self, locations: Vec<Coordinates>) -> Result<MatrixJobSubmitResponse> {
        let request = MatrixJobRequest { locations };
        let job = QueuedMatrixJob::new(request);
        let job_id = job.id;
        
        // Publish to JetStream
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(MATRIX_SUBJECT, payload.into()).await?.await?;
        
        info!("Matrix job {} submitted with {} locations", job_id, job.request.locations.len());
        
        // Publish initial status
        self.publish_matrix_status(job_id, MatrixJobStatus::Queued { position: 1 }).await?;
        
        Ok(MatrixJobSubmitResponse {
            job_id,
            message: "Matrix calculation job submitted".to_string(),
        })
    }
    
    /// Publish a matrix job status update
    pub async fn publish_matrix_status(&self, job_id: Uuid, status: MatrixJobStatus) -> Result<()> {
        let update = MatrixJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", MATRIX_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Start processing matrix jobs from the queue
    pub async fn start_matrix_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(MATRIX_STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(MATRIX_CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3, // Retry up to 3 times
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(MATRIX_CONSUMER_NAME, consumer_config).await?;
        info!("JetStream Valhalla matrix consumer '{}' ready", MATRIX_CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    // Process job (sequential to prevent Valhalla overload)
                    if let Err(e) = processor.process_matrix_job(msg).await {
                        error!("Failed to process matrix job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving matrix message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single matrix job
    async fn process_matrix_job(&self, msg: jetstream::Message) -> Result<()> {
        let job: QueuedMatrixJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let locations = &job.request.locations;
        
        // Lazy pre-cancel check for atomic job
        if crate::services::cancellation::CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            crate::services::cancellation::CANCELLATION.remove(&job_id);
            return Ok(());
        }
        
        info!("Processing matrix job {} with {} locations", job_id, locations.len());
        
        // Publish processing status
        self.publish_matrix_status(
            job_id,
            MatrixJobStatus::Processing {
                message: format!("Calculating distances for {} locations...", locations.len()),
            },
        ).await?;
        
        // Calculate matrix using Valhalla
        match self.valhalla.get_matrices(locations).await {
            Ok(matrices) => {
                // Publish completed status with results
                self.publish_matrix_status(
                    job_id,
                    MatrixJobStatus::from_matrices(&matrices),
                ).await?;
                
                // Acknowledge the message
                if let Err(e) = msg.ack().await {
                    error!("Failed to ack matrix job {}: {:?}", job_id, e);
                }
                
                info!("Matrix job {} completed: {}x{} matrix", job_id, matrices.size, matrices.size);
            }
            Err(e) => {
                let delivery_count = msg.info().map(|i| i.delivered).unwrap_or(0);
                warn!("Matrix job {} failed (attempt {}): {}", job_id, delivery_count, e);
                
                // Publish failed status
                self.publish_matrix_status(
                    job_id,
                    MatrixJobStatus::Failed {
                        error: e.to_string(),
                        retries: delivery_count as u32,
                    },
                ).await?;
                
                // Don't ack - let JetStream retry (up to max_deliver)
                if delivery_count >= 3 {
                    // Final failure - ack to remove from queue
                    if let Err(e) = msg.ack().await {
                        error!("Failed to ack failed matrix job {}: {:?}", job_id, e);
                    }
                }
            }
        }
        
        Ok(())
    }
    
    // ==========================================================================
    // Geometry Job Methods
    // ==========================================================================
    
    /// Submit a geometry calculation job to the queue
    pub async fn submit_geometry_job(&self, locations: Vec<Coordinates>) -> Result<GeometryJobSubmitResponse> {
        let request = GeometryJobRequest { locations };
        let job = QueuedGeometryJob::new(request);
        let job_id = job.id;
        
        // Publish to JetStream
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(GEOMETRY_SUBJECT, payload.into()).await?.await?;
        
        info!("Geometry job {} submitted with {} locations", job_id, job.request.locations.len());
        
        // Publish initial status
        self.publish_geometry_status(job_id, GeometryJobStatus::Queued { position: 1 }).await?;
        
        Ok(GeometryJobSubmitResponse {
            job_id,
            message: "Route geometry job submitted".to_string(),
        })
    }
    
    /// Publish a geometry job status update
    pub async fn publish_geometry_status(&self, job_id: Uuid, status: GeometryJobStatus) -> Result<()> {
        let update = GeometryJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", GEOMETRY_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Start processing geometry jobs from the queue
    pub async fn start_geometry_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(GEOMETRY_STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(GEOMETRY_CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3, // Retry up to 3 times
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(GEOMETRY_CONSUMER_NAME, consumer_config).await?;
        info!("JetStream Valhalla geometry consumer '{}' ready", GEOMETRY_CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    // Process job
                    if let Err(e) = processor.process_geometry_job(msg).await {
                        error!("Failed to process geometry job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving geometry message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single geometry job
    async fn process_geometry_job(&self, msg: jetstream::Message) -> Result<()> {
        let job: QueuedGeometryJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let locations = &job.request.locations;
        
        // Lazy pre-cancel check for atomic job
        if crate::services::cancellation::CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            crate::services::cancellation::CANCELLATION.remove(&job_id);
            return Ok(());
        }
        
        info!("Processing geometry job {} with {} locations", job_id, locations.len());
        
        // Publish processing status
        self.publish_geometry_status(
            job_id,
            GeometryJobStatus::Processing {
                message: format!("Calculating route geometry for {} stops...", locations.len()),
            },
        ).await?;
        
        // Get route geometry from Valhalla
        match self.valhalla.get_route_geometry(locations).await {
            Ok(geometry) => {
                // Publish completed status with results
                self.publish_geometry_status(
                    job_id,
                    GeometryJobStatus::Completed {
                        coordinates: geometry.coordinates,
                    },
                ).await?;
                
                // Acknowledge the message
                if let Err(e) = msg.ack().await {
                    error!("Failed to ack geometry job {}: {:?}", job_id, e);
                }
                
                info!("Geometry job {} completed", job_id);
            }
            Err(e) => {
                let delivery_count = msg.info().map(|i| i.delivered).unwrap_or(0);
                warn!("Geometry job {} failed (attempt {}): {}", job_id, delivery_count, e);
                
                // Publish failed status
                self.publish_geometry_status(
                    job_id,
                    GeometryJobStatus::Failed {
                        error: e.to_string(),
                        retries: delivery_count as u32,
                    },
                ).await?;
                
                // Don't ack - let JetStream retry (up to max_deliver)
                if delivery_count >= 3 {
                    // Final failure - ack to remove from queue
                    if let Err(e) = msg.ack().await {
                        error!("Failed to ack failed geometry job {}: {:?}", job_id, e);
                    }
                }
            }
        }
        
        Ok(())
    }
    
    // ==========================================================================
    // Synchronous Methods (for backwards compatibility)
    // ==========================================================================
    
    /// Get matrices synchronously (for existing code compatibility)
    /// This still uses the Valhalla client directly, but can be migrated to async later
    pub async fn get_matrices_sync(&self, locations: &[Coordinates]) -> Result<crate::services::routing::DistanceTimeMatrices> {
        self.valhalla.get_matrices(locations).await
    }
    
    /// Get route geometry synchronously (for existing code compatibility)
    pub async fn get_route_geometry_sync(&self, locations: &[Coordinates]) -> Result<crate::services::routing::RouteGeometry> {
        self.valhalla.get_route_geometry(locations).await
    }
    
    /// Get the underlying Valhalla client (for downcasting in route.rs)
    pub fn valhalla_client(&self) -> &ValhallaClient {
        &self.valhalla
    }
}

// ==========================================================================
// Tests
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_names() {
        assert_eq!(MATRIX_STREAM_NAME, "SAZINKA_ROUTING_MATRIX_JOBS");
        assert_eq!(GEOMETRY_STREAM_NAME, "SAZINKA_ROUTING_GEOMETRY_JOBS");
    }

    #[test]
    fn test_subject_names() {
        assert_eq!(MATRIX_SUBJECT, "sazinka.jobs.valhalla.matrix");
        assert_eq!(GEOMETRY_SUBJECT, "sazinka.jobs.valhalla.geometry");
    }

    #[test]
    fn test_status_prefix() {
        assert!(MATRIX_STATUS_PREFIX.starts_with("sazinka.job.valhalla.matrix.status"));
        assert!(GEOMETRY_STATUS_PREFIX.starts_with("sazinka.job.valhalla.geometry.status"));
    }
}
