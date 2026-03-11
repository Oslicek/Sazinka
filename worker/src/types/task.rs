#![allow(dead_code)]
//! Task and TaskType types

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use uuid::Uuid;

// ============================================================================
// ENTITIES
// ============================================================================

/// User-definable category for tasks (revision, installation, callback, etc.)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TaskType {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub label_key: Option<String>,
    pub is_system: bool,
    pub is_active: bool,
    pub payload_schema: Option<JsonValue>,
    pub created_at: DateTime<Utc>,
}

/// Generic unit of work (replaces revisions after Phase 6)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: Uuid,
    pub user_id: Uuid,
    pub task_type_id: Uuid,
    pub customer_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
    pub status: String,
    pub payload: Option<JsonValue>,
    pub due_date: Option<NaiveDate>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Joined fields
    #[sqlx(default)]
    pub task_type_name: Option<String>,
    #[sqlx(default)]
    pub task_type_label_key: Option<String>,
}

// ============================================================================
// REQUEST TYPES
// ============================================================================

/// Request to create a new task type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskTypeRequest {
    pub name: String,
    pub label_key: Option<String>,
    pub payload_schema: Option<JsonValue>,
}

/// Request to update a task type
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskTypeRequest {
    pub id: Uuid,
    pub name: Option<String>,
    pub label_key: Option<String>,
    pub is_active: Option<bool>,
    pub payload_schema: Option<JsonValue>,
}

/// Request to create a new task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskRequest {
    pub task_type_id: Uuid,
    pub customer_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
    pub payload: Option<JsonValue>,
    pub due_date: Option<NaiveDate>,
}

/// Request to update a task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskRequest {
    pub id: Uuid,
    pub status: Option<String>,
    pub payload: Option<JsonValue>,
    pub due_date: Option<NaiveDate>,
}

/// Request to list tasks
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListTasksRequest {
    pub customer_id: Option<Uuid>,
    pub task_type_id: Option<Uuid>,
    pub status: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// Response for listing tasks
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskListResponse {
    pub items: Vec<Task>,
    pub total: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_type_serializes_camel_case() {
        let tt = TaskType {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            name: "Revision".to_string(),
            label_key: Some("task_type.revision".to_string()),
            is_system: true,
            is_active: true,
            payload_schema: None,
            created_at: DateTime::from_timestamp(0, 0).unwrap(),
        };
        let json = serde_json::to_string(&tt).unwrap();
        assert!(json.contains("\"labelKey\""));
        assert!(json.contains("\"isSystem\""));
        assert!(json.contains("\"isActive\""));
    }

    #[test]
    fn create_task_request_deserializes() {
        let json = r#"{
            "taskTypeId": "00000000-0000-0000-0000-000000000001",
            "customerId": "00000000-0000-0000-0000-000000000002",
            "dueDate": "2026-06-01"
        }"#;
        let req: CreateTaskRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.customer_id, Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap());
        assert!(req.due_date.is_some());
        assert!(req.payload.is_none());
    }

    #[test]
    fn create_task_request_optional_fields_default_to_none() {
        let json = r#"{
            "taskTypeId": "00000000-0000-0000-0000-000000000001",
            "customerId": "00000000-0000-0000-0000-000000000002"
        }"#;
        let req: CreateTaskRequest = serde_json::from_str(json).unwrap();
        assert!(req.visit_id.is_none());
        assert!(req.device_id.is_none());
        assert!(req.payload.is_none());
        assert!(req.due_date.is_none());
    }
}
