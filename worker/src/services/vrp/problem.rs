//! VRP Problem types

use chrono::NaiveTime;
use uuid::Uuid;

use crate::types::Coordinates;

/// VRP Problem definition
#[derive(Debug, Clone)]
pub struct VrpProblem {
    /// Starting point (depot)
    pub depot: Depot,
    /// Stops to visit
    pub stops: Vec<VrpStop>,
    /// Working hours start
    pub shift_start: NaiveTime,
    /// Working hours end
    pub shift_end: NaiveTime,
}

/// Depot (starting/ending point)
#[derive(Debug, Clone)]
pub struct Depot {
    pub coordinates: Coordinates,
}

/// A stop in the VRP problem
#[derive(Debug, Clone)]
pub struct VrpStop {
    /// Unique identifier for this stop
    pub id: String,
    /// Customer UUID
    pub customer_id: Uuid,
    /// Customer name for display
    pub customer_name: String,
    /// Location coordinates
    pub coordinates: Coordinates,
    /// Service duration in minutes
    pub service_duration_minutes: u32,
    /// Optional time window constraint
    pub time_window: Option<StopTimeWindow>,
    /// Priority (higher = more important to visit)
    pub priority: i32,
}

/// Time window for a stop
#[derive(Debug, Clone)]
pub struct StopTimeWindow {
    /// Earliest arrival time
    pub start: NaiveTime,
    /// Latest arrival time
    pub end: NaiveTime,
    /// If true, time window is hard constraint; if false, soft (penalty)
    pub is_hard: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prague() -> Coordinates {
        Coordinates { lat: 50.0755, lng: 14.4378 }
    }

    #[test]
    fn test_vrp_problem_creation() {
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        assert!(problem.stops.is_empty());
        assert_eq!(problem.shift_start.hour(), 8);
        assert_eq!(problem.shift_end.hour(), 17);
    }

    #[test]
    fn test_vrp_stop_creation() {
        let stop = VrpStop {
            id: "stop-1".to_string(),
            customer_id: Uuid::new_v4(),
            customer_name: "Test Customer".to_string(),
            coordinates: prague(),
            service_duration_minutes: 30,
            time_window: None,
            priority: 1,
        };

        assert_eq!(stop.id, "stop-1");
        assert_eq!(stop.service_duration_minutes, 30);
    }

    #[test]
    fn test_time_window() {
        let tw = StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };

        assert_eq!(tw.start.hour(), 10);
        assert_eq!(tw.end.hour(), 12);
        assert!(tw.is_hard);
    }
}
