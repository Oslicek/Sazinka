//! VRP Problem builder
//!
//! Converts our domain types to vrp-pragmatic JSON format.

use chrono::NaiveTime;
use uuid::Uuid;
use serde::{Serialize, Deserialize};
use anyhow::Result;

use crate::types::Coordinates;
use crate::services::routing::DistanceTimeMatrices;

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

impl VrpProblem {
    /// Convert to vrp-pragmatic JSON format
    pub fn to_pragmatic_json(&self, matrices: &DistanceTimeMatrices) -> Result<serde_json::Value> {
        // Build jobs (one per stop)
        let jobs: Vec<serde_json::Value> = self.stops
            .iter()
            .enumerate()
            .map(|(idx, stop)| self.build_job(stop, idx))
            .collect();

        // Build vehicle
        let vehicle = self.build_vehicle();

        // Build matrix profile
        let matrix = self.build_matrix(matrices);

        // Assemble full problem
        let problem = serde_json::json!({
            "plan": {
                "jobs": jobs
            },
            "fleet": {
                "vehicles": [vehicle],
                "profiles": [{
                    "name": "car",
                    "type": "car"
                }]
            },
            "matrices": [matrix]
        });

        Ok(problem)
    }

    fn build_job(&self, stop: &VrpStop, _index: usize) -> serde_json::Value {
        let duration_seconds = stop.service_duration_minutes as u64 * 60;

        let mut place = serde_json::json!({
            "location": {
                "lat": stop.coordinates.lat,
                "lng": stop.coordinates.lng
            },
            "duration": duration_seconds
        });

        // Add time window if specified
        if let Some(tw) = &stop.time_window {
            let times = vec![vec![
                format_time_for_pragmatic(tw.start),
                format_time_for_pragmatic(tw.end),
            ]];
            place["times"] = serde_json::json!(times);
        }

        serde_json::json!({
            "id": stop.id,
            "deliveries": [{
                "places": [place],
                "demand": [1]
            }],
            "priority": stop.priority
        })
    }

    fn build_vehicle(&self) -> serde_json::Value {
        serde_json::json!({
            "typeId": "technician",
            "vehicleIds": ["technician_1"],
            "profile": {
                "matrix": "car"
            },
            "costs": {
                "fixed": 0.0,
                "distance": 0.001,  // Cost per meter
                "time": 0.0001     // Cost per second
            },
            "shifts": [{
                "start": {
                    "earliest": format_time_for_pragmatic(self.shift_start),
                    "location": {
                        "lat": self.depot.coordinates.lat,
                        "lng": self.depot.coordinates.lng
                    }
                },
                "end": {
                    "latest": format_time_for_pragmatic(self.shift_end),
                    "location": {
                        "lat": self.depot.coordinates.lat,
                        "lng": self.depot.coordinates.lng
                    }
                }
            }],
            "capacity": [100]  // More than enough for daily stops
        })
    }

    fn build_matrix(&self, matrices: &DistanceTimeMatrices) -> serde_json::Value {
        // Flatten matrices to 1D arrays (row-major order)
        let distances: Vec<u64> = matrices.distances
            .iter()
            .flatten()
            .copied()
            .collect();

        let durations: Vec<u64> = matrices.durations
            .iter()
            .flatten()
            .copied()
            .collect();

        serde_json::json!({
            "profile": "car",
            "distances": distances,
            "durations": durations
        })
    }
}

/// Format NaiveTime for vrp-pragmatic (ISO 8601 with fixed date)
fn format_time_for_pragmatic(time: NaiveTime) -> String {
    // vrp-pragmatic expects full datetime, we use a fixed date
    format!("2026-01-01T{}:00Z", time.format("%H:%M"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prague() -> Coordinates {
        Coordinates { lat: 50.0755, lng: 14.4378 }
    }

    fn brno() -> Coordinates {
        Coordinates { lat: 49.1951, lng: 16.6068 }
    }

    fn mock_matrices(n: usize) -> DistanceTimeMatrices {
        let distances = vec![vec![10000u64; n]; n];
        let durations = vec![vec![600u64; n]; n];
        DistanceTimeMatrices {
            distances,
            durations,
            size: n,
        }
    }

    #[test]
    fn test_format_time_morning() {
        let time = NaiveTime::from_hms_opt(8, 30, 0).unwrap();
        let formatted = format_time_for_pragmatic(time);
        assert_eq!(formatted, "2026-01-01T08:30:00Z");
    }

    #[test]
    fn test_format_time_afternoon() {
        let time = NaiveTime::from_hms_opt(14, 0, 0).unwrap();
        let formatted = format_time_for_pragmatic(time);
        assert_eq!(formatted, "2026-01-01T14:00:00Z");
    }

    #[test]
    fn test_build_job_without_time_window() {
        let stop = VrpStop {
            id: "stop-1".to_string(),
            customer_id: Uuid::new_v4(),
            customer_name: "Test Customer".to_string(),
            coordinates: brno(),
            service_duration_minutes: 45,
            time_window: None,
            priority: 1,
        };

        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![stop],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let job = problem.build_job(&problem.stops[0], 0);

        assert_eq!(job["id"], "stop-1");
        assert_eq!(job["deliveries"][0]["places"][0]["duration"], 2700); // 45 * 60
        assert!(job["deliveries"][0]["places"][0].get("times").is_none());
    }

    #[test]
    fn test_build_job_with_time_window() {
        let stop = VrpStop {
            id: "stop-1".to_string(),
            customer_id: Uuid::new_v4(),
            customer_name: "Test Customer".to_string(),
            coordinates: brno(),
            service_duration_minutes: 30,
            time_window: Some(StopTimeWindow {
                start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
                end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
                is_hard: true,
            }),
            priority: 2,
        };

        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![stop],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let job = problem.build_job(&problem.stops[0], 0);

        assert_eq!(job["priority"], 2);
        let times = &job["deliveries"][0]["places"][0]["times"];
        assert!(times.is_array());
        assert_eq!(times[0][0], "2026-01-01T10:00:00Z");
        assert_eq!(times[0][1], "2026-01-01T12:00:00Z");
    }

    #[test]
    fn test_build_vehicle() {
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let vehicle = problem.build_vehicle();

        assert_eq!(vehicle["typeId"], "technician");
        assert_eq!(vehicle["shifts"][0]["start"]["earliest"], "2026-01-01T08:00:00Z");
        assert_eq!(vehicle["shifts"][0]["end"]["latest"], "2026-01-01T17:00:00Z");
        
        // Check depot coordinates
        let start_loc = &vehicle["shifts"][0]["start"]["location"];
        assert!((start_loc["lat"].as_f64().unwrap() - 50.0755).abs() < 0.001);
    }

    #[test]
    fn test_build_matrix() {
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let matrices = mock_matrices(3);
        let matrix = problem.build_matrix(&matrices);

        assert_eq!(matrix["profile"], "car");
        
        // 3x3 = 9 elements
        let distances = matrix["distances"].as_array().unwrap();
        assert_eq!(distances.len(), 9);
    }

    #[test]
    fn test_to_pragmatic_json_structure() {
        let stop = VrpStop {
            id: "stop-1".to_string(),
            customer_id: Uuid::new_v4(),
            customer_name: "Customer A".to_string(),
            coordinates: brno(),
            service_duration_minutes: 30,
            time_window: None,
            priority: 1,
        };

        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![stop],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let matrices = mock_matrices(2);
        let json = problem.to_pragmatic_json(&matrices).unwrap();

        // Check top-level structure
        assert!(json.get("plan").is_some());
        assert!(json.get("fleet").is_some());
        assert!(json.get("matrices").is_some());

        // Check jobs
        let jobs = json["plan"]["jobs"].as_array().unwrap();
        assert_eq!(jobs.len(), 1);

        // Check vehicles
        let vehicles = json["fleet"]["vehicles"].as_array().unwrap();
        assert_eq!(vehicles.len(), 1);

        // Check profiles
        let profiles = json["fleet"]["profiles"].as_array().unwrap();
        assert_eq!(profiles.len(), 1);
    }
}
