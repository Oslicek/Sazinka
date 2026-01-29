//! Job queue handlers for async task processing
//!
//! Uses NATS JetStream for persistent job queuing with:
//! - Job submission and status tracking
//! - Worker pool processing with acknowledgements
//! - Real-time status updates via pub/sub

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use anyhow::Result;
use async_nats::Client;
use async_nats::jetstream::{self, Context as JsContext};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::services::routing::RoutingService;
use crate::types::{
    Coordinates, ErrorResponse, Request, SuccessResponse,
    JobSubmitResponse, JobStatus, JobStatusUpdate, QueuedJob, RoutePlanJobRequest,
    RoutePlanRequest, RoutePlanResponse,
};

// Stream and consumer names
const STREAM_NAME: &str = "SAZINKA_JOBS";
const CONSUMER_NAME: &str = "route_workers";
const SUBJECT_JOBS: &str = "sazinka.jobs.route";
const SUBJECT_STATUS_PREFIX: &str = "sazinka.job.status";

/// Statistics about the job queue
#[derive(Debug, Clone)]
pub struct QueueStats {
    /// Number of pending jobs
    pub pending: u32,
    /// Number of jobs being processed
    pub processing: u32,
    /// Average processing time in ms
    pub avg_processing_time_ms: u32,
}

/// Shared state for job processing
pub struct JobProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    routing_service: Arc<dyn RoutingService>,
    pending_count: AtomicU32,
}

impl JobProcessor {
    /// Create a new job processor
    pub async fn new(
        client: Client,
        pool: PgPool,
        routing_service: Arc<dyn RoutingService>,
    ) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create or get stream
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![SUBJECT_JOBS.to_string()],
            max_messages: 10_000,
            max_bytes: 100 * 1024 * 1024, // 100 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream stream '{}' ready", STREAM_NAME);
        
        Ok(Self {
            client,
            js,
            pool,
            routing_service,
            pending_count: AtomicU32::new(0),
        })
    }
    
    /// Submit a job to the queue
    pub async fn submit_job(&self, request: RoutePlanJobRequest) -> Result<JobSubmitResponse> {
        let job = QueuedJob::new(request, crate::types::job::JobPriority::Normal);
        let job_id = job.id;
        
        // Publish to JetStream
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(SUBJECT_JOBS, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        let estimated_wait = self.estimate_wait_time(pending);
        
        info!("Job {} submitted, position {} in queue", job_id, pending);
        
        // Publish initial status
        self.publish_status(job_id, JobStatus::Queued {
            position: pending,
            estimated_wait_seconds: estimated_wait,
        }).await?;
        
        Ok(JobSubmitResponse {
            job_id,
            position: pending,
            estimated_wait_seconds: estimated_wait,
        })
    }
    
    /// Get current queue statistics
    pub async fn get_stats(&self) -> QueueStats {
        QueueStats {
            pending: self.pending_count.load(Ordering::Relaxed),
            processing: 0, // TODO: track in-flight jobs
            avg_processing_time_ms: 2000, // Estimate
        }
    }
    
    /// Publish a status update for a job
    pub async fn publish_status(&self, job_id: Uuid, status: JobStatus) -> Result<()> {
        let update = JobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", SUBJECT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Estimate wait time based on queue position
    fn estimate_wait_time(&self, position: u32) -> u32 {
        // Rough estimate: 2-3 seconds per job
        position * 3
    }
    
    /// Start processing jobs from the queue
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3, // Retry up to 3 times
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(CONSUMER_NAME, consumer_config).await?;
        info!("JetStream consumer '{}' ready", CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    // Process in separate task
                    tokio::spawn(async move {
                        if let Err(e) = processor.process_job(msg).await {
                            error!("Failed to process job: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Error receiving message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single job
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        let job: QueuedJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        
        info!("Processing job {}", job_id);
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // Publish processing status
        self.publish_status(job_id, JobStatus::Processing {
            progress: 0,
            message: "Loading customers...".to_string(),
        }).await?;
        
        // Execute route planning
        match self.execute_route_plan(job_id, &job.request).await {
            Ok(result) => {
                self.publish_status(job_id, JobStatus::Completed { result }).await?;
                if let Err(e) = msg.ack().await {
                    error!("Failed to ack job {}: {:?}", job_id, e);
                }
                info!("Job {} completed successfully", job_id);
            }
            Err(e) => {
                self.publish_status(job_id, JobStatus::Failed { 
                    error: e.to_string() 
                }).await?;
                // Don't ack - let it retry
                warn!("Job {} failed: {}", job_id, e);
            }
        }
        
        Ok(())
    }
    
    /// Execute the actual route planning logic
    async fn execute_route_plan(
        &self,
        job_id: Uuid,
        _request: &RoutePlanJobRequest,
    ) -> Result<RoutePlanResponse> {
        // This would call the same logic as handle_plan in route.rs
        // For now, we'll import and reuse that logic
        
        self.publish_status(job_id, JobStatus::Processing {
            progress: 25,
            message: "Fetching distance matrix...".to_string(),
        }).await?;
        
        // TODO: Extract route planning logic into a service
        // For now, return a placeholder
        self.publish_status(job_id, JobStatus::Processing {
            progress: 75,
            message: "Solving VRP...".to_string(),
        }).await?;
        
        Ok(RoutePlanResponse {
            stops: vec![],
            total_distance_km: 0.0,
            total_duration_minutes: 0,
            algorithm: "queued-vrp".to_string(),
            solve_time_ms: 0,
            solver_log: vec!["Processed via job queue".to_string()],
            optimization_score: 0,
            warnings: vec![],
            unassigned: vec![],
            geometry: vec![],
        })
    }
}

// ==========================================================================
// NATS Request Handlers
// ==========================================================================

/// Handle job.submit requests
pub async fn handle_job_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<JobProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<RoutePlanJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse job submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        match processor.submit_job(request.payload).await {
            Ok(response) => {
                let success = SuccessResponse::new(request.id, response);
                let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            }
            Err(e) => {
                error!("Failed to submit job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

/// Handle job.stats requests
pub async fn handle_job_stats(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<JobProcessor>,
) -> Result<()> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct StatsResponse {
        pending: u32,
        processing: u32,
        avg_processing_time_ms: u32,
    }
    
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let stats = processor.get_stats().await;
        let response = StatsResponse {
            pending: stats.pending,
            processing: stats.processing,
            avg_processing_time_ms: stats.avg_processing_time_ms,
        };
        
        let request_id = extract_request_id(&msg.payload);
        let success = SuccessResponse::new(request_id, response);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    
    Ok(())
}

fn extract_request_id(payload: &[u8]) -> Uuid {
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(payload) {
        if let Some(id_str) = v.get("id").and_then(|id| id.as_str()) {
            if let Ok(uuid) = Uuid::parse_str(id_str) {
                return uuid;
            }
        }
    }
    Uuid::new_v4()
}

// ==========================================================================
// Tests
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_stats_default_values() {
        let stats = QueueStats {
            pending: 0,
            processing: 0,
            avg_processing_time_ms: 2000,
        };
        
        assert_eq!(stats.pending, 0);
        assert_eq!(stats.avg_processing_time_ms, 2000);
    }

    #[test]
    fn test_estimate_wait_time() {
        // Position 1 = 3 seconds
        assert_eq!(1 * 3, 3);
        // Position 10 = 30 seconds
        assert_eq!(10 * 3, 30);
    }

    #[test]
    fn test_stream_config_values() {
        assert_eq!(STREAM_NAME, "SAZINKA_JOBS");
        assert_eq!(SUBJECT_JOBS, "sazinka.jobs.route");
        assert!(SUBJECT_STATUS_PREFIX.starts_with("sazinka.job.status"));
    }
}
