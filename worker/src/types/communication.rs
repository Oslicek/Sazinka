//! Communication types for CRM

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Communication type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CommunicationType {
    EmailSent,
    EmailReceived,
    Call,
    Note,
    Sms,
}

impl CommunicationType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::EmailSent => "email_sent",
            Self::EmailReceived => "email_received",
            Self::Call => "call",
            Self::Note => "note",
            Self::Sms => "sms",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "email_sent" => Some(Self::EmailSent),
            "email_received" => Some(Self::EmailReceived),
            "call" => Some(Self::Call),
            "note" => Some(Self::Note),
            "sms" => Some(Self::Sms),
            _ => None,
        }
    }
}

/// Communication direction
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CommunicationDirection {
    Outbound,
    Inbound,
}

impl CommunicationDirection {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Outbound => "outbound",
            Self::Inbound => "inbound",
        }
    }
}

/// Email delivery status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EmailStatus {
    Sent,
    Delivered,
    Opened,
    Bounced,
    Failed,
}

/// Communication entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Communication {
    pub id: Uuid,
    pub user_id: Uuid,
    pub customer_id: Uuid,
    pub revision_id: Option<Uuid>,
    
    pub comm_type: String,
    pub direction: String,
    
    pub subject: Option<String>,
    pub content: String,
    
    pub contact_name: Option<String>,
    pub contact_phone: Option<String>,
    
    pub email_status: Option<String>,
    pub duration_minutes: Option<i32>,
    
    pub follow_up_date: Option<NaiveDate>,
    pub follow_up_completed: Option<bool>,
    
    pub created_at: DateTime<Utc>,
}

/// Request to create a communication
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCommunicationRequest {
    pub customer_id: Uuid,
    pub revision_id: Option<Uuid>,
    pub comm_type: String,
    pub direction: String,
    pub subject: Option<String>,
    pub content: String,
    pub contact_name: Option<String>,
    pub contact_phone: Option<String>,
    pub duration_minutes: Option<i32>,
    pub follow_up_date: Option<NaiveDate>,
}

/// Request to update a communication
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCommunicationRequest {
    pub id: Uuid,
    pub subject: Option<String>,
    pub content: Option<String>,
    pub follow_up_date: Option<NaiveDate>,
    pub follow_up_completed: Option<bool>,
}

/// Request to list communications
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCommunicationsRequest {
    pub customer_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub comm_type: Option<String>,
    pub follow_up_pending: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Response for listing communications
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCommunicationsResponse {
    pub communications: Vec<Communication>,
    pub total: i64,
}
