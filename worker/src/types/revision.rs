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
}

/// Revision status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
