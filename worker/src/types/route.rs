//! Route types

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{Coordinates, TimeWindow};

/// Route entity (a day's planned visits)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Route {
    pub id: Uuid,
    pub user_id: Uuid,
    pub date: NaiveDate,
    pub status: String,
    pub total_distance_km: Option<f64>,
    pub total_duration_minutes: Option<i32>,
    pub optimization_score: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Route status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteStatus {
    Draft,
    Optimized,
    Confirmed,
    InProgress,
    Completed,
}

/// A stop on the route
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteStop {
    pub order: i32,
    pub revision_id: Uuid,
    pub customer_id: Uuid,
    pub customer_name: String,
    pub address: String,
    pub lat: f64,
    pub lng: f64,
    pub estimated_arrival: NaiveTime,
    pub estimated_departure: NaiveTime,
    pub time_window: Option<TimeWindow>,
    pub distance_from_previous_km: Option<f64>,
    pub duration_from_previous_minutes: Option<i32>,
    pub service_duration_minutes: i32,
}

/// Request to optimize a route
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizeRouteRequest {
    pub date: NaiveDate,
    pub revision_ids: Vec<Uuid>,
}

/// Result of route optimization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizeRouteResult {
    pub stops: Vec<RouteStop>,
    pub total_distance_km: f64,
    pub total_duration_minutes: i32,
    pub optimization_score: i32,
    pub warnings: Vec<RouteWarning>,
}

/// Warning about route issues
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteWarning {
    pub stop_index: Option<i32>,
    pub warning_type: String,
    pub message: String,
}

/// Request to plan/optimize a route
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlanRequest {
    /// Starting location (technician's home/office)
    pub start_location: Coordinates,
    /// Customer IDs to visit
    pub customer_ids: Vec<Uuid>,
    /// Date for the route
    pub date: NaiveDate,
    /// Working hours
    pub working_hours: Option<WorkingHours>,
}

/// Working hours configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingHours {
    pub start: NaiveTime,
    pub end: NaiveTime,
}

impl Default for WorkingHours {
    fn default() -> Self {
        Self {
            start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        }
    }
}

/// Response from route planning
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePlanResponse {
    /// Planned stops in optimal order
    pub stops: Vec<PlannedRouteStop>,
    /// Total distance in kilometers
    pub total_distance_km: f64,
    /// Total duration in minutes
    pub total_duration_minutes: i32,
    /// Optimization score (0-100)
    pub optimization_score: i32,
    /// Warnings about the route
    pub warnings: Vec<RouteWarning>,
    /// Customer IDs that couldn't be scheduled
    pub unassigned: Vec<Uuid>,
}

/// A planned stop in the route
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedRouteStop {
    /// Customer ID
    pub customer_id: Uuid,
    /// Customer name
    pub customer_name: String,
    /// Address
    pub address: String,
    /// Coordinates
    pub coordinates: Coordinates,
    /// Order in route (1-based)
    pub order: i32,
    /// Estimated time of arrival
    pub eta: NaiveTime,
    /// Estimated time of departure
    pub etd: NaiveTime,
    /// Service duration in minutes
    pub service_duration_minutes: i32,
    /// Time window (if any)
    pub time_window: Option<TimeWindow>,
}
