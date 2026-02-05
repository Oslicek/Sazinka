//! Revision types

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Revision entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: Uuid,
    pub device_id: Uuid,
    pub customer_id: Uuid,
    pub user_id: Uuid,
    pub status: String,
    pub due_date: NaiveDate,
    pub scheduled_date: Option<NaiveDate>,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
    pub result: Option<String>,
    pub findings: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    // Snooze fields (for call queue)
    #[sqlx(default)]
    pub snooze_until: Option<NaiveDate>,
    #[sqlx(default)]
    pub snooze_reason: Option<String>,
    // Vehicle assignment
    #[sqlx(default)]
    pub assigned_vehicle_id: Option<Uuid>,
    #[sqlx(default)]
    pub route_order: Option<i32>,
    // Device info (joined from devices table)
    #[sqlx(default)]
    pub device_name: Option<String>,
    #[sqlx(default)]
    pub device_type: Option<String>,
    // Customer info (joined from customers table)
    #[sqlx(default)]
    pub customer_name: Option<String>,
    #[sqlx(default)]
    pub customer_phone: Option<String>,
    #[sqlx(default)]
    pub customer_street: Option<String>,
    #[sqlx(default)]
    pub customer_city: Option<String>,
    #[sqlx(default)]
    pub customer_postal_code: Option<String>,
}

/// Revision status
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "revision_status", rename_all = "snake_case")]
pub enum RevisionStatus {
    Upcoming,
    DueSoon,
    Overdue,
    Scheduled,
    Confirmed,
    Completed,
    Cancelled,
}

impl RevisionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RevisionStatus::Upcoming => "upcoming",
            RevisionStatus::DueSoon => "due_soon",
            RevisionStatus::Overdue => "overdue",
            RevisionStatus::Scheduled => "scheduled",
            RevisionStatus::Confirmed => "confirmed",
            RevisionStatus::Completed => "completed",
            RevisionStatus::Cancelled => "cancelled",
        }
    }
}

/// Revision result
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "revision_result", rename_all = "snake_case")]
pub enum RevisionResult {
    Passed,
    Failed,
    Conditional,
}

/// Time window for scheduling
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindow {
    pub start: NaiveTime,
    pub end: NaiveTime,
    pub is_hard: bool,  // true = must be respected, false = flexible
}

/// Request to create a revision
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRevisionRequest {
    pub device_id: Uuid,
    pub customer_id: Uuid,
    pub due_date: NaiveDate,
    pub scheduled_date: Option<NaiveDate>,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    pub findings: Option<String>,
}

/// Request to update a revision
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRevisionRequest {
    pub id: Uuid,
    pub status: Option<String>,
    pub due_date: Option<NaiveDate>,
    pub scheduled_date: Option<NaiveDate>,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    pub duration_minutes: Option<i32>,
}

/// Request to complete a revision
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteRevisionRequest {
    pub id: Uuid,
    pub result: String,  // passed, failed, conditional
    pub findings: Option<String>,
    pub duration_minutes: Option<i32>,
}

/// Request to list revisions with filters
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRevisionsRequest {
    pub customer_id: Option<Uuid>,
    pub device_id: Option<Uuid>,
    pub status: Option<String>,
    pub from_date: Option<NaiveDate>,
    pub to_date: Option<NaiveDate>,
    /// Which date field to filter: "due" (default) or "scheduled"
    pub date_type: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Request to get upcoming/overdue revisions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingRevisionsRequest {
    pub days_ahead: Option<i32>,  // default 30
}

/// Revision statistics for dashboard
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionStats {
    pub overdue: i64,
    pub due_this_week: i64,
    pub scheduled_today: i64,
    pub completed_this_month: i64,
}

/// Request to get or delete a revision
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionIdRequest {
    pub id: Uuid,
}

/// Request to get suggested revisions for route planning
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestRevisionsRequest {
    pub date: NaiveDate,            // Target date for planning
    pub max_count: Option<i32>,     // Max suggestions to return (default 50)
    pub exclude_ids: Option<Vec<Uuid>>, // Already selected revision IDs to exclude
}

/// A revision candidate with priority score and customer info
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct RevisionSuggestion {
    // Revision fields
    pub id: Uuid,
    pub device_id: Uuid,
    pub customer_id: Uuid,
    pub user_id: Uuid,
    pub status: String,
    pub due_date: NaiveDate,
    pub scheduled_date: Option<NaiveDate>,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    
    // Customer fields for display and geographic clustering
    pub customer_name: String,
    pub customer_street: String,
    pub customer_city: String,
    pub customer_lat: Option<f64>,
    pub customer_lng: Option<f64>,
    
    // Priority scoring
    pub priority_score: i32,        // 0-100, higher = more urgent
    pub days_until_due: i32,        // Negative = overdue
    pub priority_reason: String,    // e.g., "overdue", "due_soon", "upcoming"
}

/// Response for revision suggestions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestRevisionsResponse {
    pub suggestions: Vec<RevisionSuggestion>,
    pub total_candidates: i64,
}

// ============================================================================
// Call Queue Types
// ============================================================================

/// Request to get the call queue (revisions needing customer contact)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CallQueueRequest {
    /// Filter by area (PSČ prefix)
    pub area: Option<String>,
    /// Filter by device type
    pub device_type: Option<String>,
    /// Filter: 'overdue', 'due_soon', 'upcoming', or 'all'
    pub priority_filter: Option<String>,
    /// Only include customers with valid geocoded coordinates
    pub geocoded_only: Option<bool>,
    /// Max items to return
    pub limit: Option<i32>,
    /// Offset for pagination
    pub offset: Option<i32>,
}

/// A single item in the call queue
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CallQueueItem {
    // Revision fields
    pub id: Uuid,
    pub device_id: Uuid,
    pub customer_id: Uuid,
    pub user_id: Uuid,
    pub status: String,
    pub due_date: NaiveDate,
    pub snooze_until: Option<NaiveDate>,
    pub snooze_reason: Option<String>,
    
    // Customer fields
    pub customer_name: String,
    pub customer_phone: Option<String>,
    pub customer_email: Option<String>,
    pub customer_street: String,
    pub customer_city: String,
    pub customer_postal_code: Option<String>,
    pub customer_lat: Option<f64>,
    pub customer_lng: Option<f64>,
    pub customer_geocode_status: String,
    
    // Device fields
    pub device_name: Option<String>,
    pub device_type: String,
    
    // Computed fields
    pub days_until_due: i32,
    pub priority: String,           // 'overdue', 'due_this_week', 'due_soon', 'upcoming'
    pub last_contact_at: Option<DateTime<Utc>>,
    pub contact_attempts: i64,
}

/// Response for call queue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallQueueResponse {
    pub items: Vec<CallQueueItem>,
    pub total: i64,
    pub overdue_count: i64,
    pub due_soon_count: i64,
}

/// Request to snooze a revision (postpone contact)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnoozeRevisionRequest {
    pub id: Uuid,
    pub snooze_until: NaiveDate,
    pub reason: Option<String>,
}

/// Request to schedule a revision (set date and time window)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRevisionRequest {
    pub id: Uuid,
    pub scheduled_date: NaiveDate,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    pub assigned_vehicle_id: Option<Uuid>,
    pub duration_minutes: Option<i32>,
    pub notes: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_snooze_request_deserialize() {
        let json = r#"{
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "snoozeUntil": "2026-02-15",
            "reason": "Customer on vacation"
        }"#;

        let request: SnoozeRevisionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.snooze_until, NaiveDate::from_ymd_opt(2026, 2, 15).unwrap());
        assert_eq!(request.reason, Some("Customer on vacation".to_string()));
    }

    #[test]
    fn test_schedule_request_deserialize() {
        let json = r#"{
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "scheduledDate": "2026-02-10",
            "timeWindowStart": "10:00:00",
            "timeWindowEnd": "12:00:00",
            "durationMinutes": 45
        }"#;

        let request: ScheduleRevisionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.scheduled_date, NaiveDate::from_ymd_opt(2026, 2, 10).unwrap());
        assert_eq!(request.time_window_start, Some(NaiveTime::from_hms_opt(10, 0, 0).unwrap()));
        assert_eq!(request.duration_minutes, Some(45));
    }

    #[test]
    fn test_call_queue_request_default() {
        let request = CallQueueRequest::default();
        assert!(request.area.is_none());
        assert!(request.limit.is_none());
    }
}
