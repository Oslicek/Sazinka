#![allow(dead_code)]
//! Planned action types

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use uuid::Uuid;

/// Status of a planned action
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "action_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ActionStatus {
    Open,
    Completed,
    Cancelled,
    Snoozed,
}

impl Default for ActionStatus {
    fn default() -> Self {
        ActionStatus::Open
    }
}

impl ActionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ActionStatus::Open => "open",
            ActionStatus::Completed => "completed",
            ActionStatus::Cancelled => "cancelled",
            ActionStatus::Snoozed => "snoozed",
        }
    }

    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "open" => Ok(ActionStatus::Open),
            "completed" => Ok(ActionStatus::Completed),
            "cancelled" => Ok(ActionStatus::Cancelled),
            "snoozed" => Ok(ActionStatus::Snoozed),
            other => Err(format!("Unknown action_status: {}", other)),
        }
    }
}

/// Kind of target an action_target points to
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "action_target_kind", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ActionTargetKind {
    Task,
    Visit,
    Project,
    Other,
}

impl ActionTargetKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ActionTargetKind::Task => "task",
            ActionTargetKind::Visit => "visit",
            ActionTargetKind::Project => "project",
            ActionTargetKind::Other => "other",
        }
    }
}

/// A planned action — the scheduling layer for any future customer interaction
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PlannedAction {
    pub id: Uuid,
    pub user_id: Uuid,
    pub customer_id: Uuid,
    pub status: ActionStatus,
    pub due_date: NaiveDate,
    pub snooze_until: Option<NaiveDate>,
    pub snooze_reason: Option<String>,
    pub action_target_id: Option<Uuid>,
    // Legacy transitional links (Phase 1-4)
    pub revision_id: Option<Uuid>,
    #[sqlx(rename = "visit_id")]
    pub visit_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
    pub note: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Request to create a planned action
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlannedActionRequest {
    pub customer_id: Uuid,
    pub due_date: NaiveDate,
    pub note: Option<String>,
    pub snooze_until: Option<NaiveDate>,
    pub snooze_reason: Option<String>,
    pub action_target_id: Option<Uuid>,
    // Legacy links
    pub revision_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
}

/// Request to update a planned action
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlannedActionRequest {
    pub id: Uuid,
    pub status: Option<ActionStatus>,
    pub due_date: Option<NaiveDate>,
    pub note: Option<String>,
    pub snooze_until: Option<NaiveDate>,
    pub snooze_reason: Option<String>,
}

/// Request to list planned actions for a customer
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListPlannedActionsRequest {
    pub customer_id: Option<Uuid>,
    pub status: Option<ActionStatus>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// Response for list of planned actions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedActionListResponse {
    pub items: Vec<PlannedAction>,
    pub total: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_status_from_str_open() {
        assert_eq!(ActionStatus::from_str("open").unwrap(), ActionStatus::Open);
    }

    #[test]
    fn action_status_from_str_completed() {
        assert_eq!(ActionStatus::from_str("completed").unwrap(), ActionStatus::Completed);
    }

    #[test]
    fn action_status_from_str_invalid() {
        assert!(ActionStatus::from_str("invalid").is_err());
    }

    #[test]
    fn action_status_as_str_round_trips() {
        for status in [ActionStatus::Open, ActionStatus::Completed, ActionStatus::Cancelled, ActionStatus::Snoozed] {
            assert_eq!(ActionStatus::from_str(status.as_str()).unwrap(), status);
        }
    }

    #[test]
    fn planned_action_serializes_camel_case() {
        let action = PlannedAction {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            customer_id: Uuid::nil(),
            status: ActionStatus::Open,
            due_date: chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap(),
            snooze_until: None,
            snooze_reason: None,
            action_target_id: None,
            revision_id: None,
            visit_id: None,
            device_id: None,
            note: None,
            completed_at: None,
            created_at: chrono::DateTime::from_timestamp(0, 0).unwrap(),
            updated_at: chrono::DateTime::from_timestamp(0, 0).unwrap(),
        };
        let json = serde_json::to_string(&action).unwrap();
        assert!(json.contains("\"customerId\""));
        assert!(json.contains("\"dueDate\""));
        assert!(json.contains("\"userId\""));
        assert!(!json.contains("\"customer_id\""));
    }
}
