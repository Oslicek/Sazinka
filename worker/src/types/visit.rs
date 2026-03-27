#![allow(dead_code)]
//! Visit types for CRM

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Visit status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VisitStatus {
    Planned,
    InProgress,
    Completed,
    Cancelled,
    Rescheduled,
}

impl VisitStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Rescheduled => "rescheduled",
        }
    }
}

/// Visit type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VisitType {
    Revision,
    Installation,
    Repair,
    Consultation,
    FollowUp,
}

impl VisitType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Revision => "revision",
            Self::Installation => "installation",
            Self::Repair => "repair",
            Self::Consultation => "consultation",
            Self::FollowUp => "follow_up",
        }
    }
}

/// Visit result
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum VisitResult {
    Successful,
    Partial,
    Failed,
    CustomerAbsent,
    Rescheduled,
}

/// Visit entity
/// Represents a physical trip to a customer. Work items describe what was done.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Visit {
    pub id: Uuid,
    pub user_id: Uuid,
    pub customer_id: Uuid,
    pub crew_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
    
    pub scheduled_date: NaiveDate,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    
    pub status: String,
    pub visit_type: String,    // legacy, authority is work_items
    
    pub actual_arrival: Option<DateTime<Utc>>,
    pub actual_departure: Option<DateTime<Utc>>,
    
    pub result: Option<String>,
    /// Rich-text field notes in Markdown (renamed from result_notes)
    pub field_notes: Option<String>,

    pub requires_follow_up: Option<bool>,
    pub follow_up_reason: Option<String>,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Visit with joined customer data
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct VisitWithCustomer {
    pub id: Uuid,
    pub user_id: Uuid,
    pub customer_id: Uuid,
    pub crew_id: Option<Uuid>,
    pub device_id: Option<Uuid>,

    pub scheduled_date: NaiveDate,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,

    pub status: String,
    pub visit_type: String,

    pub actual_arrival: Option<DateTime<Utc>>,
    pub actual_departure: Option<DateTime<Utc>>,

    pub result: Option<String>,
    /// Rich-text field notes in Markdown (renamed from result_notes)
    pub field_notes: Option<String>,

    pub requires_follow_up: Option<bool>,
    pub follow_up_reason: Option<String>,
    
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    
    // Joined customer data
    pub customer_name: Option<String>,
    pub customer_street: Option<String>,
    pub customer_city: Option<String>,
}

/// Request to create a visit
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVisitRequest {
    pub customer_id: Uuid,
    pub crew_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
    pub scheduled_date: NaiveDate,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    pub visit_type: Option<String>,
    pub status: Option<String>,
}

/// Request to update a visit
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVisitRequest {
    pub id: Uuid,
    pub scheduled_date: Option<NaiveDate>,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    pub status: Option<String>,
    pub visit_type: Option<String>,
}

/// Request to complete a visit
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteVisitRequest {
    pub id: Uuid,
    pub result: String,
    pub actual_arrival: Option<DateTime<Utc>>,
    pub actual_departure: Option<DateTime<Utc>>,
    /// Optional final note state — persisted atomically in the same transaction
    pub field_notes: Option<String>,
    /// Browser-tab session id for audit upsert
    pub session_id: Option<Uuid>,
    pub requires_follow_up: Option<bool>,
    pub follow_up_reason: Option<String>,
}

/// Request to update visit field notes (NATS: sazinka.visit.update_field_notes)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFieldNotesRequest {
    pub visit_id: Uuid,
    pub session_id: Uuid,
    /// Markdown content, max 10,000 chars
    pub field_notes: String,
}

/// Request to list note history for a visit (NATS: sazinka.visit.notes.history)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotesHistoryRequest {
    pub visit_id: Uuid,
}

/// A single session-level audit snapshot
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NotesHistoryEntry {
    pub id: Uuid,
    pub session_id: Uuid,
    pub edited_by_user_id: Uuid,
    pub edited_by_name: Option<String>,
    pub field_notes: String,
    pub first_edited_at: DateTime<Utc>,
    pub last_edited_at: DateTime<Utc>,
    pub change_count: i32,
}

/// Response listing all note audit entries for a visit
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotesHistoryResponse {
    pub entries: Vec<NotesHistoryEntry>,
}

/// Request to list visits
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListVisitsRequest {
    pub customer_id: Option<Uuid>,
    pub date_from: Option<NaiveDate>,
    pub date_to: Option<NaiveDate>,
    pub status: Option<String>,
    pub visit_type: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Response for listing visits
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListVisitsResponse {
    pub visits: Vec<VisitWithCustomer>,
    pub total: i64,
}

/// Request to get a single visit by ID
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisitIdRequest {
    pub id: Uuid,
}

/// Response with visit, customer, and work items
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetVisitResponse {
    pub visit: Visit,
    pub customer_name: Option<String>,
    pub customer_street: Option<String>,
    pub customer_city: Option<String>,
    pub customer_postal_code: Option<String>,
    pub customer_phone: Option<String>,
    pub customer_lat: Option<f64>,
    pub customer_lng: Option<f64>,
    pub work_items: Vec<crate::types::work_item::VisitWorkItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_visit_has_crew_id_and_device_id_no_revision_id() {
        let visit = Visit {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            customer_id: Uuid::nil(),
            crew_id: Some(Uuid::nil()),
            device_id: Some(Uuid::nil()),
            scheduled_date: NaiveDate::from_ymd_opt(2026, 3, 15).unwrap(),
            scheduled_time_start: None,
            scheduled_time_end: None,
            status: "planned".to_string(),
            visit_type: "revision".to_string(),
            actual_arrival: None,
            actual_departure: None,
            result: None,
            field_notes: None,
            requires_follow_up: None,
            follow_up_reason: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&visit).unwrap();
        assert!(json.contains("\"crewId\""));
        assert!(json.contains("\"deviceId\""));
        // revision_id no longer exists on Visit
        assert!(!json.contains("\"revisionId\""));
    }

    #[test]
    fn test_visit_status_enum_roundtrip() {
        let statuses = vec![
            VisitStatus::Planned,
            VisitStatus::InProgress,
            VisitStatus::Completed,
            VisitStatus::Cancelled,
            VisitStatus::Rescheduled,
        ];
        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let deserialized: VisitStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, deserialized);
        }
    }

    #[test]
    fn test_visit_type_enum_roundtrip() {
        let types = vec![
            VisitType::Revision,
            VisitType::Installation,
            VisitType::Repair,
            VisitType::Consultation,
            VisitType::FollowUp,
        ];
        for vt in types {
            let json = serde_json::to_string(&vt).unwrap();
            let deserialized: VisitType = serde_json::from_str(&json).unwrap();
            assert_eq!(vt, deserialized);
        }
    }

    #[test]
    fn test_create_visit_request_with_crew_no_revision() {
        let json = r#"{
            "customerId": "123e4567-e89b-12d3-a456-426614174000",
            "crewId": "223e4567-e89b-12d3-a456-426614174000",
            "scheduledDate": "2026-03-15",
            "visitType": "revision"
        }"#;

        let req: CreateVisitRequest = serde_json::from_str(json).unwrap();
        assert!(req.crew_id.is_some());
        assert!(req.device_id.is_none());
    }

    #[test]
    fn test_create_visit_request_minimal() {
        let json = r#"{
            "customerId": "123e4567-e89b-12d3-a456-426614174000",
            "scheduledDate": "2026-03-15"
        }"#;

        let req: CreateVisitRequest = serde_json::from_str(json).unwrap();
        assert!(req.crew_id.is_none());
        assert!(req.visit_type.is_none());
        assert!(req.status.is_none());
    }
}
