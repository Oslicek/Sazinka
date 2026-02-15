//! Email notification JetStream processor
//!
//! Skeleton for future email notification implementation using Resend.
//!
//! ## Features (Future)
//! - Revision reminder emails
//! - Appointment confirmation emails
//! - Custom transactional emails
//!
//! ## Provider
//! Will use Resend (https://resend.com) for email delivery
//!
//! ## Streams
//! - `SAZINKA_EMAIL_JOBS` - All email types

use std::sync::Arc;
use anyhow::Result;
use async_nats::Client;
use async_nats::jetstream::{self, Context as JsContext};
use futures::StreamExt;
use tracing::{info, warn, error};
use uuid::Uuid;

use crate::types::{
    EmailJobRequest, EmailJobStatus, EmailJobStatusUpdate,
    QueuedEmailJob, EmailJobSubmitResponse,
};

// Stream and consumer names
const STREAM_NAME: &str = "SAZINKA_EMAIL_JOBS";
const CONSUMER_NAME: &str = "email_workers";
const SUBJECT: &str = "sazinka.jobs.email";
const STATUS_PREFIX: &str = "sazinka.job.email.status";

/// Email processor configuration
#[derive(Debug, Clone)]
pub struct EmailConfig {
    /// Resend API key
    pub api_key: String,
    /// Default sender email
    pub from_email: String,
    /// Default sender name
    pub from_name: String,
}

impl EmailConfig {
    pub fn new(api_key: &str, from_email: &str, from_name: &str) -> Self {
        Self {
            api_key: api_key.to_string(),
            from_email: from_email.to_string(),
            from_name: from_name.to_string(),
        }
    }
    
    /// Create config from environment variables
    pub fn from_env() -> Option<Self> {
        let api_key = std::env::var("RESEND_API_KEY").ok()?;
        let from_email = std::env::var("EMAIL_FROM_ADDRESS").unwrap_or_else(|_| "noreply@ariadline.cz".to_string());
        let from_name = std::env::var("EMAIL_FROM_NAME").unwrap_or_else(|_| "Ariadline".to_string());
        
        Some(Self::new(&api_key, &from_email, &from_name))
    }
}

/// Email job processor with JetStream integration
pub struct EmailProcessor {
    client: Client,
    js: JsContext,
    config: Option<EmailConfig>,
}

impl EmailProcessor {
    /// Create a new email processor, initializing JetStream stream
    pub async fn new(client: Client, config: Option<EmailConfig>) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create email stream
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![format!("{}.*", SUBJECT)], // sazinka.jobs.email.*
            max_messages: 10_000,
            max_bytes: 50 * 1024 * 1024, // 50 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream email stream '{}' ready", STREAM_NAME);
        
        if config.is_none() {
            warn!("Email processor started without configuration - emails will not be sent");
        }
        
        Ok(Self {
            client,
            js,
            config,
        })
    }
    
    /// Submit an email job to the queue
    pub async fn submit_job(&self, user_id: Uuid, request: EmailJobRequest) -> Result<EmailJobSubmitResponse> {
        let job = QueuedEmailJob::new(user_id, request);
        let job_id = job.id;
        let email_type = job.request.type_name().to_string();
        
        let subject = format!("{}.{}", SUBJECT, email_type);
        
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(subject, payload.into()).await?.await?;
        
        info!("Email job {} submitted: {}", job_id, email_type);
        
        self.publish_status(job_id, EmailJobStatus::Queued { position: 1 }).await?;
        
        Ok(EmailJobSubmitResponse {
            job_id,
            email_type,
            message: "Email job submitted".to_string(),
        })
    }
    
    /// Publish an email job status update
    pub async fn publish_status(&self, job_id: Uuid, status: EmailJobStatus) -> Result<()> {
        let update = EmailJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Start processing email jobs from the queue
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 5, // More retries for email delivery
            filter_subject: format!("{}.>", SUBJECT),
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(CONSUMER_NAME, consumer_config).await?;
        info!("JetStream email consumer '{}' ready", CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    if let Err(e) = processor.process_job(msg).await {
                        error!("Failed to process email job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving email message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single email job
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        let job: QueuedEmailJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        
        // Lazy pre-cancel check for atomic job
        if crate::services::cancellation::CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            crate::services::cancellation::CANCELLATION.remove(&job_id);
            return Ok(());
        }
        
        info!("Processing email job {} ({})", job_id, job.request.type_name());
        
        self.publish_status(job_id, EmailJobStatus::Sending).await?;
        
        // Check if we have configuration
        if self.config.is_none() {
            warn!("Email job {} skipped - no email configuration", job_id);
            self.publish_status(
                job_id,
                EmailJobStatus::Failed {
                    error: "Email service not configured".to_string(),
                    retries: 0,
                },
            ).await?;
            if let Err(e) = msg.ack().await {
                error!("Failed to ack email job {}: {:?}", job_id, e);
            }
            return Ok(());
        }
        
        // TODO: Implement actual email sending using Resend
        // For now, just mark as failed with "not implemented"
        
        warn!("Email sending not yet implemented for job {}", job_id);
        
        self.publish_status(
            job_id,
            EmailJobStatus::Failed {
                error: "Email sending not yet implemented".to_string(),
                retries: 0,
            },
        ).await?;
        
        if let Err(e) = msg.ack().await {
            error!("Failed to ack email job {}: {:?}", job_id, e);
        }
        
        Ok(())
    }
}

// ==========================================================================
// Tests
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_email_config_creation() {
        let config = EmailConfig::new("test-key", "test@example.com", "Test Sender");
        assert_eq!(config.api_key, "test-key");
        assert_eq!(config.from_email, "test@example.com");
    }

    #[test]
    fn test_stream_names() {
        assert_eq!(STREAM_NAME, "SAZINKA_EMAIL_JOBS");
        assert!(SUBJECT.starts_with("sazinka.jobs.email"));
    }
}
