//! Import JetStream processor
//!
//! Wraps CSV import operations with JetStream for:
//! - Automatic backpressure
//! - Real-time progress updates
//! - Persistence across restarts
//!
//! ## Streams
//! - `SAZINKA_IMPORT_JOBS` - All import types (device, revision, communication, visit)

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
    ImportJobRequest, ImportJobStatus, ImportJobStatusUpdate,
    QueuedImportJob, ImportJobSubmitResponse, ImportIssue,
};

// Stream and consumer names
const STREAM_NAME: &str = "SAZINKA_IMPORT_JOBS";
const CONSUMER_NAME: &str = "import_workers";
const SUBJECT: &str = "sazinka.jobs.import";
const STATUS_PREFIX: &str = "sazinka.job.import.status";

/// Import job processor with JetStream integration
pub struct ImportProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
}

impl ImportProcessor {
    /// Create a new import processor, initializing JetStream stream
    pub async fn new(client: Client, pool: PgPool) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create import stream
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![format!("{}.*", SUBJECT)], // sazinka.jobs.import.*
            max_messages: 1_000,
            max_bytes: 100 * 1024 * 1024, // 100 MB (imports can be large)
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream import stream '{}' ready", STREAM_NAME);
        
        Ok(Self {
            client,
            js,
            pool,
        })
    }
    
    /// Submit an import job to the queue
    pub async fn submit_job(&self, user_id: Uuid, request: ImportJobRequest) -> Result<ImportJobSubmitResponse> {
        let job = QueuedImportJob::new(user_id, request);
        let job_id = job.id;
        let item_count = job.request.item_count();
        let import_type = job.request.type_name().to_string();
        
        // Determine subject based on import type
        let subject = format!("{}.{}", SUBJECT, import_type);
        
        // Publish to JetStream
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(subject, payload.into()).await?.await?;
        
        info!("Import job {} submitted: {} {} items", job_id, item_count, import_type);
        
        // Publish initial status
        self.publish_status(job_id, ImportJobStatus::Queued { position: 1 }).await?;
        
        Ok(ImportJobSubmitResponse {
            job_id,
            import_type,
            item_count,
            message: "Import job submitted".to_string(),
        })
    }
    
    /// Publish an import job status update
    pub async fn publish_status(&self, job_id: Uuid, status: ImportJobStatus) -> Result<()> {
        let update = ImportJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Start processing import jobs from the queue
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3, // Retry up to 3 times
            filter_subject: format!("{}.>", SUBJECT), // Match all import subjects
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(CONSUMER_NAME, consumer_config).await?;
        info!("JetStream import consumer '{}' ready", CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    // Process job (sequential to prevent DB overload)
                    if let Err(e) = processor.process_job(msg).await {
                        error!("Failed to process import job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving import message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single import job
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        let start_time = Instant::now();
        let job: QueuedImportJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let user_id = job.user_id;
        let total = job.request.item_count() as u32;
        
        info!("Processing import job {} ({} items)", job_id, total);
        
        // Publish processing status
        self.publish_status(
            job_id,
            ImportJobStatus::Processing {
                processed: 0,
                total,
                imported: 0,
                updated: 0,
                failed: 0,
            },
        ).await?;
        
        // Process based on import type
        let result = match job.request {
            ImportJobRequest::Device(batch) => {
                self.process_device_import(job_id, user_id, batch).await
            }
            ImportJobRequest::Revision(batch) => {
                self.process_revision_import(job_id, user_id, batch).await
            }
            ImportJobRequest::Communication(batch) => {
                self.process_communication_import(job_id, user_id, batch).await
            }
            ImportJobRequest::Visit(batch) => {
                self.process_visit_import(job_id, user_id, batch).await
            }
        };
        
        let duration_ms = start_time.elapsed().as_millis() as u64;
        
        match result {
            Ok((imported, updated, errors)) => {
                self.publish_status(
                    job_id,
                    ImportJobStatus::Completed {
                        imported_count: imported,
                        updated_count: updated,
                        failed_count: errors.len() as u32,
                        errors,
                        duration_ms,
                    },
                ).await?;
                
                if let Err(e) = msg.ack().await {
                    error!("Failed to ack import job {}: {:?}", job_id, e);
                }
                
                info!("Import job {} completed in {}ms: {} imported, {} updated", 
                      job_id, duration_ms, imported, updated);
            }
            Err(e) => {
                warn!("Import job {} failed: {}", job_id, e);
                
                self.publish_status(
                    job_id,
                    ImportJobStatus::Failed {
                        error: e.to_string(),
                    },
                ).await?;
                
                // Ack to prevent infinite retries on permanent failures
                if let Err(e) = msg.ack().await {
                    error!("Failed to ack failed import job {}: {:?}", job_id, e);
                }
            }
        }
        
        Ok(())
    }
    
    // ==========================================================================
    // Import Processing Methods (delegate to existing import logic)
    // ==========================================================================
    
    async fn process_device_import(
        &self,
        job_id: Uuid,
        _user_id: Uuid,
        batch: crate::types::ImportDeviceBatchRequest,
    ) -> Result<(u32, u32, Vec<ImportIssue>)> {
        let total = batch.devices.len() as u32;
        
        // Note: In a full implementation, we would move the import logic from handlers/import.rs
        // to this service. For now, we just track progress.
        // The actual import logic would be called here.
        
        info!("Device import job {} would process {} devices", job_id, total);
        
        // Publish progress update
        self.publish_status(
            job_id,
            ImportJobStatus::Processing {
                processed: total,
                total,
                imported: 0,
                updated: 0,
                failed: 0,
            },
        ).await?;
        
        // TODO: Implement actual device import processing
        // For now, return placeholder result
        Ok((0, 0, vec![ImportIssue {
            row_number: 0,
            level: crate::types::ImportIssueLevel::Info,
            field: "".to_string(),
            message: "JetStream import processor not yet fully implemented".to_string(),
            original_value: None,
        }]))
    }
    
    async fn process_revision_import(
        &self,
        job_id: Uuid,
        _user_id: Uuid,
        batch: crate::types::ImportRevisionBatchRequest,
    ) -> Result<(u32, u32, Vec<ImportIssue>)> {
        let total = batch.revisions.len() as u32;
        info!("Revision import job {} would process {} revisions", job_id, total);
        
        // TODO: Implement actual revision import processing
        Ok((0, 0, vec![]))
    }
    
    async fn process_communication_import(
        &self,
        job_id: Uuid,
        _user_id: Uuid,
        batch: crate::types::ImportCommunicationBatchRequest,
    ) -> Result<(u32, u32, Vec<ImportIssue>)> {
        let total = batch.communications.len() as u32;
        info!("Communication import job {} would process {} communications", job_id, total);
        
        // TODO: Implement actual communication import processing
        Ok((0, 0, vec![]))
    }
    
    async fn process_visit_import(
        &self,
        job_id: Uuid,
        _user_id: Uuid,
        batch: crate::types::ImportVisitBatchRequest,
    ) -> Result<(u32, u32, Vec<ImportIssue>)> {
        let total = batch.visits.len() as u32;
        info!("Visit import job {} would process {} visits", job_id, total);
        
        // TODO: Implement actual visit import processing
        Ok((0, 0, vec![]))
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
        assert_eq!(STREAM_NAME, "SAZINKA_IMPORT_JOBS");
        assert!(SUBJECT.starts_with("sazinka.jobs.import"));
    }

    #[test]
    fn test_status_prefix() {
        assert!(STATUS_PREFIX.starts_with("sazinka.job.import.status"));
    }
}
