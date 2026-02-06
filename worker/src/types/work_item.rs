//! Visit work item types
//!
//! A work item represents a single task performed during a visit.
//! This is the source of truth for work results; revisions are denormalized.

use chrono::DateTime;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Work type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "work_type", rename_all = "snake_case")]
pub enum WorkType {
    Revision,
    Repair,
    Installation,
    Consultation,
    FollowUp,
}

impl WorkType {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkType::Revision => "revision",
            WorkType::Repair => "repair",
            WorkType::Installation => "installation",
            WorkType::Consultation => "consultation",
            WorkType::FollowUp => "follow_up",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "revision" => Some(WorkType::Revision),
            "repair" => Some(WorkType::Repair),
            "installation" => Some(WorkType::Installation),
            "consultation" => Some(WorkType::Consultation),
            "follow_up" => Some(WorkType::FollowUp),
            _ => None,
        }
    }
}

/// Work result enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "work_result", rename_all = "snake_case")]
pub enum WorkResult {
    Successful,
    Partial,
    Failed,
    CustomerAbsent,
    Rescheduled,
}

impl WorkResult {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkResult::Successful => "successful",
            WorkResult::Partial => "partial",
            WorkResult::Failed => "failed",
            WorkResult::CustomerAbsent => "customer_absent",
            WorkResult::Rescheduled => "rescheduled",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "successful" => Some(WorkResult::Successful),
            "partial" => Some(WorkResult::Partial),
            "failed" => Some(WorkResult::Failed),
            "customer_absent" => Some(WorkResult::CustomerAbsent),
            "rescheduled" => Some(WorkResult::Rescheduled),
            _ => None,
        }
    }
}

/// Visit work item entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VisitWorkItem {
    pub id: Uuid,
    pub visit_id: Uuid,
    pub device_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub crew_id: Option<Uuid>,
    pub work_type: WorkType,
    pub duration_minutes: Option<i32>,
    pub result: Option<WorkResult>,
    pub result_notes: Option<String>,
    pub findings: Option<String>,
    pub requires_follow_up: bool,
    pub follow_up_reason: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Request to create a work item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkItemRequest {
    pub visit_id: Uuid,
    pub device_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub crew_id: Option<Uuid>,
    pub work_type: WorkType,
    pub duration_minutes: Option<i32>,
    pub result: Option<WorkResult>,
    pub result_notes: Option<String>,
    pub findings: Option<String>,
    pub requires_follow_up: Option<bool>,
    pub follow_up_reason: Option<String>,
}

/// Request to complete a work item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteWorkItemRequest {
    pub id: Uuid,
    pub result: WorkResult,
    pub duration_minutes: Option<i32>,
    pub result_notes: Option<String>,
    pub findings: Option<String>,
    pub requires_follow_up: Option<bool>,
    pub follow_up_reason: Option<String>,
}

/// Request to list work items for a visit
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkItemsRequest {
    pub visit_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
}

/// Response for listing work items
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListWorkItemsResponse {
    pub items: Vec<VisitWorkItem>,
    pub total: i64,
}

/// Request to get or delete a work item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemIdRequest {
    pub id: Uuid,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_work_type_serialization_roundtrip() {
        let types = vec![
            WorkType::Revision,
            WorkType::Repair,
            WorkType::Installation,
            WorkType::Consultation,
            WorkType::FollowUp,
        ];
        for wt in types {
            let json = serde_json::to_string(&wt).unwrap();
            let deserialized: WorkType = serde_json::from_str(&json).unwrap();
            assert_eq!(wt, deserialized);
        }
    }

    #[test]
    fn test_work_type_snake_case_serde() {
        assert_eq!(serde_json::to_string(&WorkType::FollowUp).unwrap(), "\"follow_up\"");
        assert_eq!(serde_json::to_string(&WorkType::Revision).unwrap(), "\"revision\"");
        assert_eq!(serde_json::to_string(&WorkType::Installation).unwrap(), "\"installation\"");
    }

    #[test]
    fn test_work_result_serialization_roundtrip() {
        let results = vec![
            WorkResult::Successful,
            WorkResult::Partial,
            WorkResult::Failed,
            WorkResult::CustomerAbsent,
            WorkResult::Rescheduled,
        ];
        for wr in results {
            let json = serde_json::to_string(&wr).unwrap();
            let deserialized: WorkResult = serde_json::from_str(&json).unwrap();
            assert_eq!(wr, deserialized);
        }
    }

    #[test]
    fn test_work_result_snake_case_serde() {
        assert_eq!(serde_json::to_string(&WorkResult::CustomerAbsent).unwrap(), "\"customer_absent\"");
        assert_eq!(serde_json::to_string(&WorkResult::Successful).unwrap(), "\"successful\"");
    }

    #[test]
    fn test_work_type_as_str() {
        assert_eq!(WorkType::Revision.as_str(), "revision");
        assert_eq!(WorkType::FollowUp.as_str(), "follow_up");
    }

    #[test]
    fn test_work_type_from_str() {
        assert_eq!(WorkType::from_str("revision"), Some(WorkType::Revision));
        assert_eq!(WorkType::from_str("follow_up"), Some(WorkType::FollowUp));
        assert_eq!(WorkType::from_str("unknown"), None);
    }

    #[test]
    fn test_work_result_as_str() {
        assert_eq!(WorkResult::Successful.as_str(), "successful");
        assert_eq!(WorkResult::CustomerAbsent.as_str(), "customer_absent");
    }

    #[test]
    fn test_work_result_from_str() {
        assert_eq!(WorkResult::from_str("successful"), Some(WorkResult::Successful));
        assert_eq!(WorkResult::from_str("customer_absent"), Some(WorkResult::CustomerAbsent));
        assert_eq!(WorkResult::from_str("unknown"), None);
    }

    #[test]
    fn test_create_work_item_request_deserialize() {
        let json = r#"{
            "visitId": "123e4567-e89b-12d3-a456-426614174000",
            "deviceId": "223e4567-e89b-12d3-a456-426614174000",
            "revisionId": "323e4567-e89b-12d3-a456-426614174000",
            "workType": "revision",
            "durationMinutes": 45,
            "result": "successful",
            "findings": "Bez závad"
        }"#;

        let req: CreateWorkItemRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.work_type, WorkType::Revision);
        assert_eq!(req.duration_minutes, Some(45));
        assert_eq!(req.result, Some(WorkResult::Successful));
        assert_eq!(req.findings, Some("Bez závad".to_string()));
        assert!(req.crew_id.is_none());
        assert!(req.requires_follow_up.is_none());
    }

    #[test]
    fn test_create_work_item_request_minimal() {
        let json = r#"{
            "visitId": "123e4567-e89b-12d3-a456-426614174000",
            "workType": "repair"
        }"#;

        let req: CreateWorkItemRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.work_type, WorkType::Repair);
        assert!(req.device_id.is_none());
        assert!(req.revision_id.is_none());
        assert!(req.result.is_none());
    }

    #[test]
    fn test_complete_work_item_request_deserialize() {
        let json = r#"{
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "result": "partial",
            "durationMinutes": 30,
            "resultNotes": "Čeká se na díl",
            "requiresFollowUp": true,
            "followUpReason": "Kontrola po opravě"
        }"#;

        let req: CompleteWorkItemRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.result, WorkResult::Partial);
        assert_eq!(req.duration_minutes, Some(30));
        assert_eq!(req.requires_follow_up, Some(true));
    }

    #[test]
    fn test_visit_work_item_serialize() {
        let item = VisitWorkItem {
            id: Uuid::nil(),
            visit_id: Uuid::nil(),
            device_id: None,
            revision_id: None,
            crew_id: None,
            work_type: WorkType::Revision,
            duration_minutes: Some(45),
            result: Some(WorkResult::Successful),
            result_notes: None,
            findings: Some("OK".to_string()),
            requires_follow_up: false,
            follow_up_reason: None,
            created_at: Utc::now(),
        };

        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"workType\":\"revision\""));
        assert!(json.contains("\"result\":\"successful\""));
        assert!(json.contains("\"durationMinutes\":45"));
        assert!(json.contains("\"requiresFollowUp\":false"));
    }

    #[test]
    fn test_list_work_items_request_deserialize() {
        let json = r#"{"visitId": "123e4567-e89b-12d3-a456-426614174000"}"#;
        let req: ListWorkItemsRequest = serde_json::from_str(json).unwrap();
        assert!(req.visit_id.is_some());
        assert!(req.revision_id.is_none());
    }
}
