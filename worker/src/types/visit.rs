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
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Visit {
    pub id: Uuid,
    pub user_id: Uuid,
    pub customer_id: Uuid,
    pub revision_id: Option<Uuid>,
    
    pub scheduled_date: NaiveDate,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    
    pub status: String,
    pub visit_type: String,
    
    pub actual_arrival: Option<DateTime<Utc>>,
    pub actual_departure: Option<DateTime<Utc>>,
    
    pub result: Option<String>,
    pub result_notes: Option<String>,
    
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
    pub revision_id: Option<Uuid>,
    
    pub scheduled_date: NaiveDate,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    
    pub status: String,
    pub visit_type: String,
    
    pub actual_arrival: Option<DateTime<Utc>>,
    pub actual_departure: Option<DateTime<Utc>>,
    
    pub result: Option<String>,
    pub result_notes: Option<String>,
    
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVisitRequest {
    pub customer_id: Uuid,
    pub revision_id: Option<Uuid>,
    pub scheduled_date: NaiveDate,
    pub scheduled_time_start: Option<NaiveTime>,
    pub scheduled_time_end: Option<NaiveTime>,
    pub visit_type: String,
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
    pub result_notes: Option<String>,
    pub actual_arrival: Option<DateTime<Utc>>,
    pub actual_departure: Option<DateTime<Utc>>,
    pub requires_follow_up: Option<bool>,
    pub follow_up_reason: Option<String>,
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
