//! Route types

use chrono::{DateTime, NaiveDate, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::{Coordinates, TimeWindow};

/// Route entity (a day's planned visits)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    pub id: Uuid,
    pub user_id: Uuid,
    pub crew_id: Option<Uuid>,
    pub depot_id: Option<Uuid>,
    pub date: NaiveDate,
    pub status: RouteStatus,
    pub total_distance_km: Option<f64>,
    pub total_duration_minutes: Option<i32>,
    pub optimization_score: Option<i32>,
    pub return_to_depot_distance_km: Option<f64>,
    pub return_to_depot_duration_minutes: Option<i32>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Route status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "route_status", rename_all = "snake_case")]
pub enum RouteStatus {
    Draft,
    Optimized,
    Confirmed,
    InProgress,
    Completed,
}

impl RouteStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            RouteStatus::Draft => "draft",
            RouteStatus::Optimized => "optimized",
            RouteStatus::Confirmed => "confirmed",
            RouteStatus::InProgress => "in_progress",
            RouteStatus::Completed => "completed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopType {
    Customer,
    Break,
}

impl StopType {
    pub const fn as_str(self) -> &'static str {
        match self {
            StopType::Customer => "customer",
            StopType::Break => "break",
        }
    }
}

/// A stop on the route
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStop {
    pub order: i32,
    pub customer_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub revision_id: Option<Uuid>,
    pub customer_name: Option<String>,
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
    /// Crew ID — if provided, crew-specific settings (arrival buffer) are used
    pub crew_id: Option<Uuid>,
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
            start: NaiveTime::from_hms_opt(0, 0, 0).expect("valid static full-day start"),
            end: NaiveTime::from_hms_opt(23, 59, 59).expect("valid static full-day end"),
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
    /// Algorithm used for optimization
    pub algorithm: String,
    /// Solver runtime in milliseconds
    pub solve_time_ms: u64,
    /// Solver log lines
    pub solver_log: Vec<String>,
    /// Optimization score (0-100)
    pub optimization_score: i32,
    /// Warnings about the route
    pub warnings: Vec<RouteWarning>,
    /// Customer IDs that couldn't be scheduled
    pub unassigned: Vec<Uuid>,
    /// Route geometry as GeoJSON coordinates [[lng, lat], ...]
    /// Empty if route geometry is not available
    #[serde(default)]
    pub geometry: Vec<[f64; 2]>,
    /// Return leg distance from last stop back to depot (km)
    #[serde(default)]
    pub return_to_depot_distance_km: Option<f64>,
    /// Return leg duration from last stop back to depot (minutes)
    #[serde(default)]
    pub return_to_depot_duration_minutes: Option<i32>,
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
    /// Stop type (customer or break)
    #[serde(default)]
    pub stop_type: Option<StopType>,
    /// Break duration in minutes (for break stops)
    #[serde(default)]
    pub break_duration_minutes: Option<i32>,
    /// Break start time (for break stops)
    #[serde(default)]
    pub break_time_start: Option<NaiveTime>,
    /// Distance from previous location in km (Valhalla matrix based)
    #[serde(default)]
    pub distance_from_previous_km: Option<f64>,
    /// Duration from previous location in minutes (Valhalla matrix based)
    #[serde(default)]
    pub duration_from_previous_minutes: Option<i32>,
}
