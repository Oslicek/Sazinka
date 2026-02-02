//! Export JetStream processor
//!
//! Wraps CSV export operations with JetStream for:
//! - Automatic backpressure
//! - Real-time progress updates
//! - Persistence across restarts
//!
//! ## Streams
//! - `SAZINKA_EXPORT_JOBS` - All export types (customers, revisions, communications)

use std::sync::Arc;
use std::time::Instant;
use anyhow::Result;
use async_nats::Client;
use async_nats::jetstream::{self, Context as JsContext};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{info, warn, error};
use uuid::Uuid;

use crate::types::{
    ExportJobRequest, ExportJobStatus, ExportJobStatusUpdate,
    QueuedExportJob, ExportJobSubmitResponse,
};

// Stream and consumer names
const STREAM_NAME: &str = "SAZINKA_EXPORT_JOBS";
const CONSUMER_NAME: &str = "export_workers";
const SUBJECT: &str = "sazinka.jobs.export";
const STATUS_PREFIX: &str = "sazinka.job.export.status";

/// Export job processor with JetStream integration
pub struct ExportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
}

impl ExportProcessor {
    /// Create a new export processor, initializing JetStream stream
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create export stream
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![format!("{}.*", SUBJECT)], // sazinka.jobs.export.*
            max_messages: 500,
            max_bytes: 50 * 1024 * 1024, // 50 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream export stream '{}' ready", STREAM_NAME);
        
        Ok(Self {
            client,
            js,
            pool,
        })
    }
    
    /// Submit an export job to the queue
    pub async fn submit_job(&self, user_id: Uuid, request: ExportJobRequest) -> Result<ExportJobSubmitResponse> {
        let job = QueuedExportJob::new(user_id, request);
        let job_id = job.id;
        let export_type = job.request.type_name().to_string();
        
        // Determine subject based on export type
        let subject = format!("{}.{}", SUBJECT, export_type);
        
        // Publish to JetStream
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(subject, payload.into()).await?.await?;
        
        info!("Export job {} submitted: {}", job_id, export_type);
        
        // Publish initial status
        self.publish_status(job_id, ExportJobStatus::Queued { position: 1 }).await?;
        
        Ok(ExportJobSubmitResponse {
            job_id,
            export_type,
            message: "Export job submitted".to_string(),
        })
    }
    
    /// Publish an export job status update
    pub async fn publish_status(&self, job_id: Uuid, status: ExportJobStatus) -> Result<()> {
        let update = ExportJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Start processing export jobs from the queue
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3, // Retry up to 3 times
            filter_subject: format!("{}.>", SUBJECT), // Match all export subjects
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(CONSUMER_NAME, consumer_config).await?;
        info!("JetStream export consumer '{}' ready", CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    // Process job (sequential for resource management)
                    if let Err(e) = processor.process_job(msg).await {
                        error!("Failed to process export job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving export message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single export job
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        let start_time = Instant::now();
        let job: QueuedExportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        
        info!("Processing export job {} ({})", job_id, job.request.type_name());
        
        // Publish processing status
        self.publish_status(
            job_id,
            ExportJobStatus::Processing {
                processed: 0,
                estimated_total: 0,
                message: "Starting export...".to_string(),
            },
        ).await?;
        
        // Process based on export type
        let result = match job.request {
            ExportJobRequest::Customers(req) => {
                self.process_customers_export(job_id, user_id, req).await
            }
            ExportJobRequest::Revisions(req) => {
                self.process_revisions_export(job_id, user_id, req).await
            }
            ExportJobRequest::Communications(req) => {
                self.process_communications_export(job_id, user_id, req).await
            }
        };
        
        let duration_ms = start_time.elapsed().as_millis() as u64;
        
        match result {
            Ok((row_count, file_size, download_url)) => {
                self.publish_status(
                    job_id,
                    ExportJobStatus::Completed {
                        row_count,
                        file_size_bytes: file_size,
                        download_url,
                        duration_ms,
                    },
                ).await?;
                
                if let Err(e) = msg.ack().await {
                    error!("Failed to ack export job {}: {:?}", job_id, e);
                }
                
                info!("Export job {} completed in {}ms: {} rows", job_id, duration_ms, row_count);
            }
            Err(e) => {
                warn!("Export job {} failed: {}", job_id, e);
                
                self.publish_status(
                    job_id,
                    ExportJobStatus::Failed {
                        error: e.to_string(),
                    },
                ).await?;
                
                // Ack to prevent infinite retries
                if let Err(e) = msg.ack().await {
                    error!("Failed to ack failed export job {}: {:?}", job_id, e);
                }
            }
        }
        
        Ok(())
    }
    
    // ==========================================================================
    // Export Processing Methods
    // ==========================================================================
    
    async fn process_customers_export(
        &self,
        job_id: Uuid,
        user_id: Uuid,
        _req: crate::types::ExportCustomersRequest,
    ) -> Result<(u32, u64, String)> {
        info!("Customers export job {} for user {}", job_id, user_id);
        
        // TODO: Implement actual customer export processing
        // 1. Query customers from database
        // 2. Generate CSV content
        // 3. Store to file system or object storage
        // 4. Return download URL
        
        // Placeholder result
        Ok((0, 0, format!("/exports/{}/customers.csv", job_id)))
    }
    
    async fn process_revisions_export(
        &self,
        job_id: Uuid,
        user_id: Uuid,
        _req: crate::types::ExportRevisionsRequest,
    ) -> Result<(u32, u64, String)> {
        info!("Revisions export job {} for user {}", job_id, user_id);
        
        // TODO: Implement actual revision export processing
        
        Ok((0, 0, format!("/exports/{}/revisions.csv", job_id)))
    }
    
    async fn process_communications_export(
        &self,
        job_id: Uuid,
        user_id: Uuid,
        _req: crate::types::ExportCommunicationsRequest,
    ) -> Result<(u32, u64, String)> {
        info!("Communications export job {} for user {}", job_id, user_id);
        
        // TODO: Implement actual communication export processing
        
        Ok((0, 0, format!("/exports/{}/communications.csv", job_id)))
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
        assert_eq!(STREAM_NAME, "SAZINKA_EXPORT_JOBS");
        assert!(SUBJECT.starts_with("sazinka.jobs.export"));
    }

    #[test]
    fn test_status_prefix() {
        assert!(STATUS_PREFIX.starts_with("sazinka.job.export.status"));
    }
}
