//! NATS message types

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};

/// Generic request wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request<T> {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    #[serde(default)]
    pub token: Option<String>,  // JWT access token
    pub payload: T,
}

impl<T> Request<T> {
    pub fn with_token(token: String, payload: T) -> Self {
        Self {
            id: Uuid::new_v4(),
            timestamp: Utc::now(),
            token: Some(token),
            payload,
        }
    }
}

/// Generic success response wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuccessResponse<T> {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub payload: T,
}

impl<T> SuccessResponse<T> {
    pub fn new(request_id: Uuid, payload: T) -> Self {
        Self {
            id: request_id,
            timestamp: Utc::now(),
            payload,
        }
    }
}

/// Error response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorResponse {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub error: ErrorDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

impl ErrorResponse {
    pub fn new(request_id: Uuid, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            id: request_id,
            timestamp: Utc::now(),
            error: ErrorDetail {
                code: code.into(),
                message: message.into(),
                details: None,
            },
        }
    }
}

/// Empty payload that accepts both `null` and `{}`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EmptyPayload {}

/// List request with pagination
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    #[serde(default)]
    pub search: Option<String>,
}

fn default_limit() -> i64 {
    50
}

/// List response with pagination info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResponse<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}
