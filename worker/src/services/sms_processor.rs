//! SMS notification JetStream processor
//!
//! Skeleton for future SMS notification implementation using Twilio.
//!
//! ## Features (Future)
//! - Revision reminder SMS
//! - Appointment confirmation SMS
//!
//! ## Provider
//! Will use Twilio (https://twilio.com) for SMS delivery
//!
//! ## Streams
//! - `SAZINKA_SMS_JOBS` - All SMS types

use std::sync::Arc;
use anyhow::Result;
use async_nats::Client;
use async_nats::jetstream::{self, Context as JsContext};
use futures::StreamExt;
use tracing::{info, warn, error};
use uuid::Uuid;

use crate::types::{
    SmsJobRequest, SmsJobStatus, SmsJobStatusUpdate,
    QueuedSmsJob, SmsJobSubmitResponse,
};

// Stream and consumer names
const STREAM_NAME: &str = "SAZINKA_SMS_JOBS";
const CONSUMER_NAME: &str = "sms_workers";
const SUBJECT: &str = "sazinka.jobs.sms";
const STATUS_PREFIX: &str = "sazinka.job.sms.status";

/// SMS processor configuration (Twilio)
#[derive(Debug, Clone)]
pub struct SmsConfig {
    /// Twilio Account SID
    pub account_sid: String,
    /// Twilio Auth Token
    pub auth_token: String,
    /// Twilio phone number (sender)
    pub from_number: String,
}

impl SmsConfig {
    pub fn new(account_sid: &str, auth_token: &str, from_number: &str) -> Self {
        Self {
            account_sid: account_sid.to_string(),
            auth_token: auth_token.to_string(),
            from_number: from_number.to_string(),
        }
    }
    
    /// Create config from environment variables
    pub fn from_env() -> Option<Self> {
        let account_sid = std::env::var("TWILIO_ACCOUNT_SID").ok()?;
        let auth_token = std::env::var("TWILIO_AUTH_TOKEN").ok()?;
        let from_number = std::env::var("TWILIO_FROM_NUMBER").ok()?;
        
        Some(Self::new(&account_sid, &auth_token, &from_number))
    }
}

/// SMS job processor with JetStream integration
pub struct SmsProcessor {
    client: Client,
    js: JsContext,
    config: Option<SmsConfig>,
}

impl SmsProcessor {
    /// Create a new SMS processor, initializing JetStream stream
    pub async fn new(client: Client, config: Option<SmsConfig>) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create SMS stream
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![format!("{}.*", SUBJECT)], // sazinka.jobs.sms.*
            max_messages: 10_000,
            max_bytes: 10 * 1024 * 1024, // 10 MB (SMS are small)
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream SMS stream '{}' ready", STREAM_NAME);
        
        if config.is_none() {
            warn!("SMS processor started without configuration - SMS will not be sent");
        }
        
        Ok(Self {
            client,
            js,
            config,
        })
    }
    
    /// Submit an SMS job to the queue
    pub async fn submit_job(&self, user_id: Uuid, request: SmsJobRequest) -> Result<SmsJobSubmitResponse> {
        let job = QueuedSmsJob::new(user_id, request);
        let job_id = job.id;
        let sms_type = job.request.type_name().to_string();
        
        let subject = format!("{}.{}", SUBJECT, sms_type);
        
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(subject, payload.into()).await?.await?;
        
        info!("SMS job {} submitted: {}", job_id, sms_type);
        
        self.publish_status(job_id, SmsJobStatus::Queued { position: 1 }).await?;
        
        Ok(SmsJobSubmitResponse {
            job_id,
            sms_type,
            message: "SMS job submitted".to_string(),
        })
    }
    
    /// Publish an SMS job status update
    pub async fn publish_status(&self, job_id: Uuid, status: SmsJobStatus) -> Result<()> {
        let update = SmsJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Start processing SMS jobs from the queue
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 5, // More retries for SMS delivery
            filter_subject: format!("{}.>", SUBJECT),
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(CONSUMER_NAME, consumer_config).await?;
        info!("JetStream SMS consumer '{}' ready", CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    if let Err(e) = processor.process_job(msg).await {
                        error!("Failed to process SMS job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving SMS message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single SMS job
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        let job: QueuedSmsJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        
        info!("Processing SMS job {} ({})", job_id, job.request.type_name());
        
        self.publish_status(job_id, SmsJobStatus::Sending).await?;
        
        // Check if we have configuration
        if self.config.is_none() {
            warn!("SMS job {} skipped - no SMS configuration", job_id);
            self.publish_status(
                job_id,
                SmsJobStatus::Failed {
                    error: "SMS service not configured".to_string(),
                    retries: 0,
                },
            ).await?;
            if let Err(e) = msg.ack().await {
                error!("Failed to ack SMS job {}: {:?}", job_id, e);
            }
            return Ok(());
        }
        
        // TODO: Implement actual SMS sending using Twilio
        // For now, just mark as failed with "not implemented"
        
        warn!("SMS sending not yet implemented for job {}", job_id);
        
        self.publish_status(
            job_id,
            SmsJobStatus::Failed {
                error: "SMS sending not yet implemented".to_string(),
                retries: 0,
            },
        ).await?;
        
        if let Err(e) = msg.ack().await {
            error!("Failed to ack SMS job {}: {:?}", job_id, e);
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
    fn test_sms_config_creation() {
        let config = SmsConfig::new("test-sid", "test-token", "+1234567890");
        assert_eq!(config.account_sid, "test-sid");
        assert_eq!(config.from_number, "+1234567890");
    }

    #[test]
    fn test_stream_names() {
        assert_eq!(STREAM_NAME, "SAZINKA_SMS_JOBS");
        assert!(SUBJECT.starts_with("sazinka.jobs.sms"));
    }
}
