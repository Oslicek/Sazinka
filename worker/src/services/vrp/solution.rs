//! VRP Solution types

use chrono::NaiveTime;
use uuid::Uuid;

/// Optimized route solution
#[derive(Debug, Clone)]
pub struct RouteSolution {
    /// Planned stops in order
    pub stops: Vec<PlannedStop>,
    /// Total distance in meters
    pub total_distance_meters: u64,
    /// Total duration in seconds
    pub total_duration_seconds: u64,
    /// Optimization score (0-100)
    pub optimization_score: u8,
    /// Warnings about the solution
    pub warnings: Vec<RouteWarning>,
    /// Stop IDs that couldn't be scheduled
    pub unassigned: Vec<String>,
}

/// A planned stop in the optimized route
#[derive(Debug, Clone)]
pub struct PlannedStop {
    /// Stop ID (matches VrpStop.id)
    pub stop_id: String,
    /// Customer UUID
    pub customer_id: Uuid,
    /// Customer name
    pub customer_name: String,
    /// Order in the route (1-based)
    pub order: u32,
    /// Estimated arrival time
    pub arrival_time: NaiveTime,
    /// Estimated departure time
    pub departure_time: NaiveTime,
    /// Waiting time in minutes (if arrived early)
    pub waiting_time_minutes: u32,
}

/// Warning about the route
#[derive(Debug, Clone)]
pub struct RouteWarning {
    /// Related stop ID (if applicable)
    pub stop_id: Option<String>,
    /// Warning type code
    pub warning_type: String,
    /// Human-readable message
    pub message: String,
}

impl RouteSolution {
    /// Create empty solution (for empty problems)
    pub fn empty() -> Self {
        Self {
            stops: vec![],
            total_distance_meters: 0,
            total_duration_seconds: 0,
            optimization_score: 100,
            warnings: vec![],
            unassigned: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_solution() {
        let solution = RouteSolution::empty();
        assert!(solution.stops.is_empty());
        assert_eq!(solution.optimization_score, 100);
        assert_eq!(solution.total_distance_meters, 0);
    }

    #[test]
    fn test_planned_stop() {
        let stop = PlannedStop {
            stop_id: "stop-1".to_string(),
            customer_id: Uuid::new_v4(),
            customer_name: "Customer A".to_string(),
            order: 1,
            arrival_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            departure_time: NaiveTime::from_hms_opt(9, 30, 0).unwrap(),
            waiting_time_minutes: 0,
        };

        assert_eq!(stop.order, 1);
        assert_eq!(stop.arrival_time.hour(), 9);
    }

    #[test]
    fn test_route_warning() {
        let warning = RouteWarning {
            stop_id: Some("stop-1".to_string()),
            warning_type: "TIME_WINDOW".to_string(),
            message: "Arrival after time window".to_string(),
        };

        assert_eq!(warning.warning_type, "TIME_WINDOW");
    }
}
