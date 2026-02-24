
//! Transactional email sending abstraction.
//!
//! `EmailSender` is the core trait — swap in `ResendEmailSender` in production,
//! `LogEmailSender` in dev/staging (logs to tracing), `FakeEmailSender` in tests.
//!
//! The trait is object-safe so callers can hold `Arc<dyn EmailSender>`.

use std::collections::HashMap;
use std::sync::Mutex;

use anyhow::Result;
use async_trait::async_trait;
use tracing::info;

// =============================================================================
// Core trait
// =============================================================================

/// Represents a rendered email message ready to send.
#[derive(Debug, Clone)]
pub struct EmailMessage {
    pub to: String,
    pub subject: String,
    pub html: String,
    pub text: String,
}

/// Abstraction over an email transport.
#[async_trait]
pub trait EmailSender: Send + Sync {
    async fn send(&self, msg: EmailMessage) -> Result<()>;
}

// =============================================================================
// LogEmailSender — writes to tracing (dev / staging)
// =============================================================================

pub struct LogEmailSender;

#[async_trait]
impl EmailSender for LogEmailSender {
    async fn send(&self, msg: EmailMessage) -> Result<()> {
        info!(
            to = %msg.to,
            subject = %msg.subject,
            "[LogEmailSender] Would send email\n---HTML---\n{}\n---TEXT---\n{}",
            msg.html,
            msg.text,
        );
        Ok(())
    }
}

// =============================================================================
// FakeEmailSender — captures sent messages in a Vec (tests)
// =============================================================================

/// Collects sent messages in memory for assertion in tests.
#[derive(Default)]
pub struct FakeEmailSender {
    pub sent: Mutex<Vec<EmailMessage>>,
}

impl FakeEmailSender {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sent_messages(&self) -> Vec<EmailMessage> {
        self.sent.lock().unwrap().clone()
    }

    pub fn last_message(&self) -> Option<EmailMessage> {
        self.sent.lock().unwrap().last().cloned()
    }
}

#[async_trait]
impl EmailSender for FakeEmailSender {
    async fn send(&self, msg: EmailMessage) -> Result<()> {
        self.sent.lock().unwrap().push(msg);
        Ok(())
    }
}

// =============================================================================
// ResendEmailSender — live Resend.com API
// =============================================================================

pub struct ResendEmailSender {
    api_key: String,
    from: String,
}

impl ResendEmailSender {
    pub fn new(api_key: impl Into<String>, from: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            from: from.into(),
        }
    }

    /// Build from env vars `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS`.
    /// Returns `None` if `RESEND_API_KEY` is not set.
    pub fn from_env() -> Option<Self> {
        let api_key = std::env::var("RESEND_API_KEY").ok()?;
        let from = std::env::var("EMAIL_FROM_ADDRESS")
            .unwrap_or_else(|_| "noreply@ariadline.cz".to_string());
        Some(Self::new(api_key, from))
    }
}

#[async_trait]
impl EmailSender for ResendEmailSender {
    async fn send(&self, msg: EmailMessage) -> Result<()> {
        let client = reqwest::Client::new();

        let mut body = HashMap::new();
        body.insert("from", self.from.as_str());
        body.insert("to", msg.to.as_str());
        body.insert("subject", msg.subject.as_str());
        body.insert("html", msg.html.as_str());
        body.insert("text", msg.text.as_str());

        let response = client
            .post("https://api.resend.com/emails")
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Resend API error {}: {}", status, body));
        }

        info!(to = %msg.to, subject = %msg.subject, "Email sent via Resend");
        Ok(())
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fake_sender_captures_messages() {
        let sender = FakeEmailSender::new();
        sender
            .send(EmailMessage {
                to: "user@example.com".into(),
                subject: "Verify your email".into(),
                html: "<p>Click here</p>".into(),
                text: "Click here".into(),
            })
            .await
            .unwrap();

        let msgs = sender.sent_messages();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].to, "user@example.com");
        assert_eq!(msgs[0].subject, "Verify your email");
    }

    #[tokio::test]
    async fn fake_sender_captures_multiple() {
        let sender = FakeEmailSender::new();
        for i in 0..3 {
            sender
                .send(EmailMessage {
                    to: format!("user{}@example.com", i),
                    subject: "Test".into(),
                    html: "<p>.</p>".into(),
                    text: ".".into(),
                })
                .await
                .unwrap();
        }
        assert_eq!(sender.sent_messages().len(), 3);
    }

    #[tokio::test]
    async fn log_sender_does_not_error() {
        let sender = LogEmailSender;
        sender
            .send(EmailMessage {
                to: "user@example.com".into(),
                subject: "Test".into(),
                html: "<p>Test</p>".into(),
                text: "Test".into(),
            })
            .await
            .unwrap();
    }
}
