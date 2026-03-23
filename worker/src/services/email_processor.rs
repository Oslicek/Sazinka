#![allow(dead_code)]
//! Email notification JetStream processor.
//!
//! Processes email jobs from the `SAZINKA_EMAIL_JOBS` JetStream stream using
//! Amazon SES v2 for delivery.
//!
//! ## Streams
//! - `SAZINKA_EMAIL_JOBS` — All email types

use std::sync::Arc;
use anyhow::Result;
use async_nats::Client;
use async_nats::jetstream::{self, Context as JsContext};
use futures::StreamExt;
use sqlx::PgPool;
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

// ============================================================================
// Configuration
// ============================================================================

/// SES-specific email processor configuration.
#[derive(Debug, Clone)]
pub struct SesEmailConfig {
    /// AWS region (e.g. "eu-central-1")
    pub region: String,
    /// Platform fallback sender address (e.g. "noreply@ariadline.cz")
    pub from_email: String,
    /// Platform brand name used in fallback display name composition
    pub from_name: String,
    /// Optional SES configuration set name for delivery tracking
    pub configuration_set: Option<String>,
}

// ============================================================================
// EmailProcessor
// ============================================================================

/// Email job processor with JetStream integration and SES delivery.
pub struct EmailProcessor {
    client: Client,
    js: JsContext,
    ses_client: Option<aws_sdk_sesv2::Client>,
    fallback_from_email: String,
    fallback_from_name: String,
    configuration_set: Option<String>,
    pool: PgPool,
}

impl EmailProcessor {
    /// Create a new email processor, initializing JetStream stream.
    pub async fn new(
        client: Client,
        pool: PgPool,
        ses_config: Option<SesEmailConfig>,
    ) -> Result<Self> {
        let js = jetstream::new(client.clone());

        // Create email stream
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![format!("{}.*", SUBJECT)],
            max_messages: 10_000,
            max_bytes: 50 * 1024 * 1024, // 50 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream email stream '{}' ready", STREAM_NAME);

        let (ses_client, fallback_from_email, fallback_from_name, configuration_set) =
            match ses_config {
                Some(cfg) => {
                    let aws_cfg = aws_config::defaults(aws_config::BehaviorVersion::latest())
                        .region(aws_config::Region::new(cfg.region))
                        .load()
                        .await;
                    (
                        Some(aws_sdk_sesv2::Client::new(&aws_cfg)),
                        cfg.from_email,
                        cfg.from_name,
                        cfg.configuration_set,
                    )
                }
                None => {
                    warn!("SES not configured — emails will not be sent");
                    (None, String::new(), String::new(), None)
                }
            };

        Ok(Self {
            client,
            js,
            ses_client,
            fallback_from_email,
            fallback_from_name,
            configuration_set,
            pool,
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
        if self.ses_client.is_none() {
            warn!("Email job {} skipped — SES not configured", job_id);
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
    fn test_ses_config_creation() {
        let config = SesEmailConfig {
            region: "eu-central-1".to_string(),
            from_email: "noreply@ariadline.cz".to_string(),
            from_name: "Ariadline".to_string(),
            configuration_set: None,
        };
        assert_eq!(config.region, "eu-central-1");
        assert_eq!(config.from_email, "noreply@ariadline.cz");
        assert_eq!(config.from_name, "Ariadline");
        assert!(config.configuration_set.is_none());
    }

    #[test]
    fn test_ses_config_with_configuration_set() {
        let config = SesEmailConfig {
            region: "eu-central-1".to_string(),
            from_email: "noreply@ariadline.cz".to_string(),
            from_name: "Ariadline".to_string(),
            configuration_set: Some("sazinka-tracking".to_string()),
        };
        assert_eq!(config.configuration_set, Some("sazinka-tracking".to_string()));
    }

    #[test]
    fn test_stream_names() {
        assert_eq!(STREAM_NAME, "SAZINKA_EMAIL_JOBS");
        assert!(SUBJECT.starts_with("sazinka.jobs.email"));
    }
}
