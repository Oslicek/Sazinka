//! Revision types

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Revision entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
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
pub struct TimeWindow {
    pub start: NaiveTime,
    pub end: NaiveTime,
    pub is_hard: bool,  // true = must be respected, false = flexible
}
