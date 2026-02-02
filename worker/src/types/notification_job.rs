//! Email and SMS notification job types for JetStream-based async processing
//!
//! These types support the JetStream job queue for:
//! - Email notifications (revision reminders, confirmations)
//! - SMS notifications

use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ==========================================================================
// Tests First (TDD)
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // EmailJobRequest tests
    #[test]
    fn test_email_job_request_reminder_serializes() {
        let request = EmailJobRequest::RevisionReminder(RevisionReminderRequest {
            revision_id: Uuid::nil(),
            customer_id: Uuid::nil(),
            days_until_due: 7,
        });
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("revisionReminder"));
    }

    #[test]
    fn test_email_job_request_confirmation_serializes() {
        let request = EmailJobRequest::AppointmentConfirmation(AppointmentConfirmationRequest {
            revision_id: Uuid::nil(),
            customer_id: Uuid::nil(),
            scheduled_date: "2026-02-15".to_string(),
            time_window: Some("08:00-10:00".to_string()),
        });
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("appointmentConfirmation"));
    }

    // EmailJobStatus tests
    #[test]
    fn test_email_job_status_sent_serializes() {
        let status = EmailJobStatus::Sent {
            message_id: "msg-123".to_string(),
            recipient: "test@example.com".to_string(),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("sent"));
        assert!(json.contains("messageId"));
    }

    // SmsJobRequest tests
    #[test]
    fn test_sms_job_request_serializes() {
        let request = SmsJobRequest::Reminder(SmsReminderRequest {
            revision_id: Uuid::nil(),
            customer_id: Uuid::nil(),
            phone_number: "+420123456789".to_string(),
            message: "Reminder text".to_string(),
        });
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("reminder"));
    }

    // QueuedEmailJob tests
    #[test]
    fn test_queued_email_job_creates_with_uuid() {
        let request = EmailJobRequest::Custom(CustomEmailRequest {
            to: "test@example.com".to_string(),
            subject: "Test".to_string(),
            body_html: "<p>Test</p>".to_string(),
            body_text: Some("Test".to_string()),
        });
        let job = QueuedEmailJob::new(Uuid::nil(), request);
        assert!(!job.id.is_nil());
    }
}

// ==========================================================================
// Email Job Types
// ==========================================================================

/// Request for revision reminder email
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionReminderRequest {
    pub revision_id: Uuid,
    pub customer_id: Uuid,
    pub days_until_due: i32,
}

/// Request for appointment confirmation email
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppointmentConfirmationRequest {
    pub revision_id: Uuid,
    pub customer_id: Uuid,
    pub scheduled_date: String,
    pub time_window: Option<String>,
}

/// Request for custom email
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomEmailRequest {
    pub to: String,
    pub subject: String,
    pub body_html: String,
    pub body_text: Option<String>,
}

/// Type of email job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EmailJobRequest {
    /// Revision reminder email
    #[serde(rename_all = "camelCase")]
    RevisionReminder(RevisionReminderRequest),
    /// Appointment confirmation email
    #[serde(rename_all = "camelCase")]
    AppointmentConfirmation(AppointmentConfirmationRequest),
    /// Custom email
    #[serde(rename_all = "camelCase")]
    Custom(CustomEmailRequest),
}

impl EmailJobRequest {
    pub fn type_name(&self) -> &'static str {
        match self {
            EmailJobRequest::RevisionReminder(_) => "revision_reminder",
            EmailJobRequest::AppointmentConfirmation(_) => "appointment_confirmation",
            EmailJobRequest::Custom(_) => "custom",
        }
    }
}

/// Status of an email job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EmailJobStatus {
    /// Job is waiting in queue
    #[serde(rename_all = "camelCase")]
    Queued {
        position: u32,
    },
    /// Email is being sent
    #[serde(rename_all = "camelCase")]
    Sending,
    /// Email sent successfully
    #[serde(rename_all = "camelCase")]
    Sent {
        /// Email provider message ID
        message_id: String,
        /// Recipient email address
        recipient: String,
    },
    /// Email sending failed
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
        retries: u32,
    },
}

/// A queued email job in JetStream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedEmailJob {
    /// Unique job ID
    pub id: Uuid,
    /// User who triggered the email
    pub user_id: Uuid,
    /// When the job was submitted
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    /// The email request
    pub request: EmailJobRequest,
}

impl QueuedEmailJob {
    pub fn new(user_id: Uuid, request: EmailJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: chrono::Utc::now(),
            request,
        }
    }
}

/// Status update for email job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub status: EmailJobStatus,
}

impl EmailJobStatusUpdate {
    pub fn new(job_id: Uuid, status: EmailJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

/// Response when an email job is submitted
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailJobSubmitResponse {
    pub job_id: Uuid,
    pub email_type: String,
    pub message: String,
}

// ==========================================================================
// SMS Job Types
// ==========================================================================

/// Request for SMS reminder
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsReminderRequest {
    pub revision_id: Uuid,
    pub customer_id: Uuid,
    pub phone_number: String,
    pub message: String,
}

/// Request for SMS confirmation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsConfirmationRequest {
    pub revision_id: Uuid,
    pub customer_id: Uuid,
    pub phone_number: String,
    pub scheduled_date: String,
    pub time_window: Option<String>,
}

/// Type of SMS job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SmsJobRequest {
    /// SMS reminder
    #[serde(rename_all = "camelCase")]
    Reminder(SmsReminderRequest),
    /// SMS confirmation
    #[serde(rename_all = "camelCase")]
    Confirmation(SmsConfirmationRequest),
}

impl SmsJobRequest {
    pub fn type_name(&self) -> &'static str {
        match self {
            SmsJobRequest::Reminder(_) => "reminder",
            SmsJobRequest::Confirmation(_) => "confirmation",
        }
    }
    
    pub fn phone_number(&self) -> &str {
        match self {
            SmsJobRequest::Reminder(r) => &r.phone_number,
            SmsJobRequest::Confirmation(r) => &r.phone_number,
        }
    }
}

/// Status of an SMS job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SmsJobStatus {
    /// Job is waiting in queue
    #[serde(rename_all = "camelCase")]
    Queued {
        position: u32,
    },
    /// SMS is being sent
    #[serde(rename_all = "camelCase")]
    Sending,
    /// SMS sent successfully
    #[serde(rename_all = "camelCase")]
    Sent {
        /// SMS provider message SID
        message_sid: String,
        /// Recipient phone number
        recipient: String,
    },
    /// SMS sending failed
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
        retries: u32,
    },
}

/// A queued SMS job in JetStream
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSmsJob {
    /// Unique job ID
    pub id: Uuid,
    /// User who triggered the SMS
    pub user_id: Uuid,
    /// When the job was submitted
    pub submitted_at: chrono::DateTime<chrono::Utc>,
    /// The SMS request
    pub request: SmsJobRequest,
}

impl QueuedSmsJob {
    pub fn new(user_id: Uuid, request: SmsJobRequest) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            submitted_at: chrono::Utc::now(),
            request,
        }
    }
}

/// Status update for SMS job
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsJobStatusUpdate {
    pub job_id: Uuid,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub status: SmsJobStatus,
}

impl SmsJobStatusUpdate {
    pub fn new(job_id: Uuid, status: SmsJobStatus) -> Self {
        Self {
            job_id,
            timestamp: chrono::Utc::now(),
            status,
        }
    }
}

/// Response when an SMS job is submitted
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmsJobSubmitResponse {
    pub job_id: Uuid,
    pub sms_type: String,
    pub message: String,
}
