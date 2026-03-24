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
use aws_sdk_sesv2::types::{Body, Content, Destination, EmailContent, Message};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::services::{domain_verification, email_data, template_renderer};
use crate::types::{
    AppointmentConfirmationRequest, CustomEmailRequest, EmailJobRequest, EmailJobStatus,
    EmailJobStatusUpdate, EmailJobSubmitResponse, QueuedEmailJob, RevisionReminderRequest,
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
// Error types (Phase 5)
// ============================================================================

/// Errors that can occur during email sending.
///
/// `Transient` errors are NOT acked — JetStream will redeliver (up to `max_deliver`).
/// All other variants cause the job to be acked and marked Failed.
#[derive(Debug, thiserror::Error)]
pub enum EmailSendError {
    #[error("SES not configured")]
    NotConfigured,

    #[error("Recipient has no email address")]
    NoRecipient,

    #[error("Permanent SES error: {0}")]
    Permanent(String),

    #[error("Transient SES error: {0}")]
    Transient(String),
}

/// Classify an AWS SDK SES error into transient vs permanent.
pub fn classify_ses_error(err: &aws_sdk_sesv2::Error) -> EmailSendError {
    match err {
        aws_sdk_sesv2::Error::TooManyRequestsException(_)
        | aws_sdk_sesv2::Error::InternalServiceErrorException(_) => {
            EmailSendError::Transient(err.to_string())
        }
        _ => EmailSendError::Permanent(err.to_string()),
    }
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

        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![format!("{}.*", SUBJECT)],
            max_messages: 10_000,
            max_bytes: 50 * 1024 * 1024,
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

    /// Submit an email job to the queue.
    pub async fn submit_job(
        &self,
        user_id: Uuid,
        request: EmailJobRequest,
    ) -> Result<EmailJobSubmitResponse> {
        let job = QueuedEmailJob::new(user_id, request);
        let job_id = job.id;
        let email_type = job.request.type_name().to_string();

        let subject = format!("{}.{}", SUBJECT, email_type);
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(subject, payload.into()).await?.await?;

        info!("Email job {} submitted: {}", job_id, email_type);
        self.publish_status(job_id, EmailJobStatus::Queued { position: 1 })
            .await?;

        Ok(EmailJobSubmitResponse {
            job_id,
            email_type,
            message: "Email job submitted".to_string(),
        })
    }

    /// Publish an email job status update.
    pub async fn publish_status(&self, job_id: Uuid, status: EmailJobStatus) -> Result<()> {
        let update = EmailJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }

    /// Start processing email jobs from the queue.
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;

        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 5,
            filter_subject: format!("{}.>", SUBJECT),
            ..Default::default()
        };

        let consumer = stream
            .get_or_create_consumer(CONSUMER_NAME, consumer_config)
            .await?;
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

    // -------------------------------------------------------------------------
    // Phase 6 — process_job pipeline
    // -------------------------------------------------------------------------

    /// Process a single email job from JetStream.
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        let job: QueuedEmailJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;

        // Pre-cancel check
        if crate::services::cancellation::CANCELLATION.is_cancelled(&job_id) {
            msg.ack().await.ok();
            crate::services::cancellation::CANCELLATION.remove(&job_id);
            return Ok(());
        }

        info!("Processing email job {} ({})", job_id, job.request.type_name());
        self.publish_status(job_id, EmailJobStatus::Sending).await?;

        if self.ses_client.is_none() {
            warn!("Email job {} skipped — SES not configured", job_id);
            self.publish_status(
                job_id,
                EmailJobStatus::Failed {
                    error: "Email service not configured".to_string(),
                    retries: 0,
                },
            )
            .await?;
            msg.ack().await.ok();
            return Ok(());
        }

        let result = match &job.request {
            EmailJobRequest::AppointmentConfirmation(req) => {
                self.process_confirmation(job.user_id, req).await
            }
            EmailJobRequest::RevisionReminder(req) => {
                self.process_reminder(job.user_id, req).await
            }
            EmailJobRequest::Custom(req) => self.process_custom(job.user_id, req).await,
        };

        match result {
            Ok((message_id, recipient)) => {
                self.publish_status(
                    job_id,
                    EmailJobStatus::Sent {
                        message_id,
                        recipient,
                    },
                )
                .await?;
                msg.ack().await.ok();
            }
            Err(EmailSendError::Transient(e)) => {
                error!("Transient email error for job {}: {}", job_id, e);
                // Do NOT ack — JetStream will redeliver up to max_deliver
            }
            Err(e) => {
                error!("Permanent email error for job {}: {}", job_id, e);
                self.publish_status(
                    job_id,
                    EmailJobStatus::Failed {
                        error: e.to_string(),
                        retries: 0,
                    },
                )
                .await?;
                msg.ack().await.ok();
            }
        }

        Ok(())
    }

    /// Process an appointment-confirmation job.
    async fn process_confirmation(
        &self,
        user_id: Uuid,
        req: &AppointmentConfirmationRequest,
    ) -> Result<(String, String), EmailSendError> {
        let data = email_data::resolve_confirmation_data(
            &self.pool,
            user_id,
            req.customer_id,
            req.revision_id,
        )
        .await
        .map_err(|e| EmailSendError::Permanent(e.to_string()))?
        .ok_or(EmailSendError::NoRecipient)?;

        let vars = template_renderer::build_confirmation_vars(
            &data.customer_name,
            &data.address,
            &data.scheduled_date,
            data.time_window.as_deref(),
            &data.company_name,
            &data.company_phone,
            &data.company_email,
        );

        let subject = template_renderer::render_template(&data.subject_template, &vars);
        let body_html = template_renderer::render_template_html(&data.body_template, &vars);
        let body_text = template_renderer::render_template(&data.body_template, &vars);

        let message_id = self
            .send_email(user_id, &data.recipient_email, &subject, &body_html, &body_text)
            .await?;

        self.log_communication(
            user_id,
            req.customer_id,
            Some(req.revision_id),
            &subject,
            &body_html,
            &data.recipient_email,
            &message_id,
        )
        .await;

        Ok((message_id, data.recipient_email))
    }

    /// Process a revision-reminder job.
    async fn process_reminder(
        &self,
        user_id: Uuid,
        req: &RevisionReminderRequest,
    ) -> Result<(String, String), EmailSendError> {
        let data = email_data::resolve_reminder_data(
            &self.pool,
            user_id,
            req.customer_id,
            req.revision_id,
        )
        .await
        .map_err(|e| EmailSendError::Permanent(e.to_string()))?
        .ok_or(EmailSendError::NoRecipient)?;

        let vars = template_renderer::build_reminder_vars(
            &data.customer_name,
            &data.device_type,
            &data.due_date,
            &data.company_name,
            &data.company_phone,
            &data.company_email,
        );

        let subject = template_renderer::render_template(&data.subject_template, &vars);
        let body_html = template_renderer::render_template_html(&data.body_template, &vars);
        let body_text = template_renderer::render_template(&data.body_template, &vars);

        let message_id = self
            .send_email(user_id, &data.recipient_email, &subject, &body_html, &body_text)
            .await?;

        self.log_communication(
            user_id,
            req.customer_id,
            Some(req.revision_id),
            &subject,
            &body_html,
            &data.recipient_email,
            &message_id,
        )
        .await;

        Ok((message_id, data.recipient_email))
    }

    /// Process a custom email job (no DB lookup needed).
    async fn process_custom(
        &self,
        user_id: Uuid,
        req: &CustomEmailRequest,
    ) -> Result<(String, String), EmailSendError> {
        let body_text = req.body_text.as_deref().unwrap_or(&req.body_html);
        let message_id = self
            .send_email(user_id, &req.to, &req.subject, &req.body_html, body_text)
            .await?;
        Ok((message_id, req.to.clone()))
    }

    // -------------------------------------------------------------------------
    // Phase 5 — SES send function
    // -------------------------------------------------------------------------

    /// Send an email via SES. Resolves the correct `From` address dynamically.
    async fn send_email(
        &self,
        user_id: Uuid,
        to: &str,
        subject: &str,
        body_html: &str,
        body_text: &str,
    ) -> Result<String, EmailSendError> {
        let ses = self
            .ses_client
            .as_ref()
            .ok_or(EmailSendError::NotConfigured)?;

        // Load active domain for this user (if any) to decide sender
        let active_domain = domain_verification::get_active_domain(&self.pool, user_id)
            .await
            .map_err(|e| EmailSendError::Permanent(e.to_string()))?;

        // We need the user's business name and email for fallback display/reply-to.
        // For now we use the fallback brand name; the business name is loaded from
        // the domain row's from_name if present, or the fallback_from_name.
        let sender = domain_verification::select_from_address(
            active_domain.as_ref(),
            &self.fallback_from_email,
            &self.fallback_from_name,
            "", // business_name resolved from domain.from_name or fallback
            "", // business_email — set via Reply-To when domain row has it
        );

        let subject_content = Content::builder()
            .data(subject)
            .charset("UTF-8")
            .build()
            .map_err(|e| EmailSendError::Permanent(e.to_string()))?;

        let html_content = Content::builder()
            .data(body_html)
            .charset("UTF-8")
            .build()
            .map_err(|e| EmailSendError::Permanent(e.to_string()))?;

        let text_content = Content::builder()
            .data(body_text)
            .charset("UTF-8")
            .build()
            .map_err(|e| EmailSendError::Permanent(e.to_string()))?;

        let body = Body::builder()
            .html(html_content)
            .text(text_content)
            .build();

        let message = Message::builder()
            .subject(subject_content)
            .body(body)
            .build();

        let email_content = EmailContent::builder().simple(message).build();

        let destination = Destination::builder().to_addresses(to).build();

        let mut req_builder = ses
            .send_email()
            .from_email_address(&sender.from)
            .destination(destination)
            .content(email_content);

        if let Some(reply_to) = sender.reply_to.as_deref() {
            req_builder = req_builder.reply_to_addresses(reply_to);
        }
        if let Some(ref cs) = self.configuration_set {
            req_builder = req_builder.configuration_set_name(cs);
        }

        let output = req_builder.send().await.map_err(|sdk_err| {
            let ses_err: aws_sdk_sesv2::Error = sdk_err.into_service_error().into();
            classify_ses_error(&ses_err)
        })?;

        Ok(output.message_id().unwrap_or("unknown").to_string())
    }

    // -------------------------------------------------------------------------
    // Phase 7 — CRM communication logging
    // -------------------------------------------------------------------------

    /// Log a sent email to the communications table. Non-fatal: errors are logged
    /// but do not affect the job outcome (email was already sent).
    async fn log_communication(
        &self,
        user_id: Uuid,
        customer_id: Uuid,
        revision_id: Option<Uuid>,
        subject: &str,
        content: &str,
        _recipient: &str,
        _message_id: &str,
    ) {
        if let Err(e) = crate::db::queries::communication::create_communication(
            &self.pool,
            user_id,
            customer_id,
            revision_id,
            "email_sent",
            "outbound",
            Some(subject),
            content,
            None,
            None,
            None,
        )
        .await
        {
            error!("Failed to log email communication: {}", e);
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- SesEmailConfig ----

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
        assert_eq!(
            config.configuration_set,
            Some("sazinka-tracking".to_string())
        );
    }

    #[test]
    fn test_stream_names() {
        assert_eq!(STREAM_NAME, "SAZINKA_EMAIL_JOBS");
        assert!(SUBJECT.starts_with("sazinka.jobs.email"));
    }

    // ---- EmailSendError display ----

    #[test]
    fn email_send_error_display_not_configured() {
        assert_eq!(
            EmailSendError::NotConfigured.to_string(),
            "SES not configured"
        );
    }

    #[test]
    fn email_send_error_display_no_recipient() {
        assert_eq!(
            EmailSendError::NoRecipient.to_string(),
            "Recipient has no email address"
        );
    }

    #[test]
    fn email_send_error_display_permanent() {
        let e = EmailSendError::Permanent("bad address".to_string());
        assert_eq!(e.to_string(), "Permanent SES error: bad address");
    }

    #[test]
    fn email_send_error_display_transient() {
        let e = EmailSendError::Transient("throttled".to_string());
        assert_eq!(e.to_string(), "Transient SES error: throttled");
    }

    // ---- classify_ses_error ----

    #[test]
    fn classify_too_many_requests_as_transient() {
        let err = aws_sdk_sesv2::Error::TooManyRequestsException(
            aws_sdk_sesv2::types::error::TooManyRequestsException::builder().build(),
        );
        assert!(matches!(classify_ses_error(&err), EmailSendError::Transient(_)));
    }

    #[test]
    fn classify_internal_service_error_as_transient() {
        let err = aws_sdk_sesv2::Error::InternalServiceErrorException(
            aws_sdk_sesv2::types::error::InternalServiceErrorException::builder().build(),
        );
        assert!(matches!(classify_ses_error(&err), EmailSendError::Transient(_)));
    }

    #[test]
    fn classify_message_rejected_as_permanent() {
        let err = aws_sdk_sesv2::Error::MessageRejected(
            aws_sdk_sesv2::types::error::MessageRejected::builder().build(),
        );
        assert!(matches!(classify_ses_error(&err), EmailSendError::Permanent(_)));
    }

    #[test]
    fn classify_mail_from_domain_not_verified_as_permanent() {
        let err = aws_sdk_sesv2::Error::MailFromDomainNotVerifiedException(
            aws_sdk_sesv2::types::error::MailFromDomainNotVerifiedException::builder().build(),
        );
        assert!(matches!(classify_ses_error(&err), EmailSendError::Permanent(_)));
    }

    #[test]
    fn classify_account_suspended_as_permanent() {
        let err = aws_sdk_sesv2::Error::AccountSuspendedException(
            aws_sdk_sesv2::types::error::AccountSuspendedException::builder().build(),
        );
        assert!(matches!(classify_ses_error(&err), EmailSendError::Permanent(_)));
    }
}
