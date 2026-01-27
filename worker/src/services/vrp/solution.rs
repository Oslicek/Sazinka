//! VRP Solution parser
//!
//! Converts vrp-pragmatic solution JSON to our domain types.

use chrono::NaiveTime;
use uuid::Uuid;
use anyhow::Result;
use tracing::warn;

use super::problem::VrpProblem;

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

    /// Parse vrp-pragmatic solution JSON
    pub fn from_pragmatic_json(
        solution: &serde_json::Value,
        problem: &VrpProblem,
    ) -> Result<Self> {
        let mut stops = Vec::new();
        let mut warnings = Vec::new();
        let mut unassigned = Vec::new();

        // Parse tours
        if let Some(tours) = solution["tours"].as_array() {
            for tour in tours {
                Self::parse_tour(tour, problem, &mut stops)?;
            }
        }

        // Parse unassigned jobs
        if let Some(unassigned_arr) = solution["unassigned"].as_array() {
            for job in unassigned_arr {
                if let Some(job_id) = job["jobId"].as_str() {
                    unassigned.push(job_id.to_string());
                    warnings.push(RouteWarning {
                        stop_id: Some(job_id.to_string()),
                        warning_type: "UNASSIGNED".to_string(),
                        message: format!("Stop '{}' could not be scheduled", job_id),
                    });
                }
            }
        }

        // Parse statistics
        let total_distance = solution["statistic"]["distance"]
            .as_u64()
            .unwrap_or(0);
        let total_duration = solution["statistic"]["duration"]
            .as_u64()
            .unwrap_or(0);

        // Calculate score
        let score = Self::calculate_score(&stops, &unassigned, problem);

        Ok(Self {
            stops,
            total_distance_meters: total_distance,
            total_duration_seconds: total_duration,
            optimization_score: score,
            warnings,
            unassigned,
        })
    }

    fn parse_tour(
        tour: &serde_json::Value,
        problem: &VrpProblem,
        stops: &mut Vec<PlannedStop>,
    ) -> Result<()> {
        let tour_stops = match tour["stops"].as_array() {
            Some(s) => s,
            None => return Ok(()),
        };

        let mut order = 0u32;

        for stop in tour_stops {
            let activities = match stop["activities"].as_array() {
                Some(a) => a,
                None => continue,
            };

            for activity in activities {
                let activity_type = activity["type"].as_str().unwrap_or("");
                
                // Skip non-delivery activities (departure, arrival, etc.)
                if activity_type != "delivery" {
                    continue;
                }

                let job_id = match activity["jobId"].as_str() {
                    Some(id) => id.to_string(),
                    None => continue,
                };

                // Find original stop info
                let original = problem.stops.iter().find(|s| s.id == job_id);
                let (customer_id, customer_name) = match original {
                    Some(o) => (o.customer_id, o.customer_name.clone()),
                    None => {
                        warn!("Could not find original stop for job_id: {}", job_id);
                        (Uuid::nil(), "Unknown".to_string())
                    }
                };

                order += 1;

                // Parse times
                let arrival = parse_pragmatic_time(
                    stop["time"]["arrival"].as_str()
                );
                let departure = parse_pragmatic_time(
                    stop["time"]["departure"].as_str()
                );

                // Calculate waiting time (if we arrived before service started)
                let waiting_time_minutes = 0; // TODO: calculate from activity timing

                stops.push(PlannedStop {
                    stop_id: job_id,
                    customer_id,
                    customer_name,
                    order,
                    arrival_time: arrival,
                    departure_time: departure,
                    waiting_time_minutes,
                });
            }
        }

        Ok(())
    }

    fn calculate_score(
        stops: &[PlannedStop],
        unassigned: &[String],
        problem: &VrpProblem,
    ) -> u8 {
        let total = problem.stops.len();
        if total == 0 {
            return 100;
        }

        let assigned = stops.len();
        let base_score = (assigned * 100 / total) as u8;

        // Penalize for unassigned high-priority stops
        let penalty: u8 = unassigned.iter()
            .filter_map(|id| problem.stops.iter().find(|s| &s.id == id))
            .map(|s| (s.priority.max(0).min(10)) as u8)
            .sum::<u8>()
            .min(30);

        base_score.saturating_sub(penalty)
    }
}

/// Parse vrp-pragmatic datetime to NaiveTime
fn parse_pragmatic_time(time_str: Option<&str>) -> NaiveTime {
    time_str
        .and_then(|s| {
            // Parse "2026-01-01T08:30:00Z" -> 08:30
            s.get(11..16)
                .and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok())
        })
        .unwrap_or_else(|| NaiveTime::from_hms_opt(0, 0, 0).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Coordinates;
    use crate::services::vrp::problem::{Depot, VrpStop};

    fn sample_problem() -> VrpProblem {
        VrpProblem {
            depot: Depot {
                coordinates: Coordinates { lat: 50.0, lng: 14.0 },
            },
            stops: vec![
                VrpStop {
                    id: "stop-1".to_string(),
                    customer_id: Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap(),
                    customer_name: "Customer A".to_string(),
                    coordinates: Coordinates { lat: 50.1, lng: 14.1 },
                    service_duration_minutes: 30,
                    time_window: None,
                    priority: 1,
                },
                VrpStop {
                    id: "stop-2".to_string(),
                    customer_id: Uuid::parse_str("00000000-0000-0000-0000-000000000002").unwrap(),
                    customer_name: "Customer B".to_string(),
                    coordinates: Coordinates { lat: 50.2, lng: 14.2 },
                    service_duration_minutes: 45,
                    time_window: None,
                    priority: 2,
                },
            ],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        }
    }

    #[test]
    fn test_parse_pragmatic_time_valid() {
        let time = parse_pragmatic_time(Some("2026-01-01T10:30:00Z"));
        assert_eq!(time.hour(), 10);
        assert_eq!(time.minute(), 30);
    }

    #[test]
    fn test_parse_pragmatic_time_invalid() {
        let time = parse_pragmatic_time(Some("invalid"));
        assert_eq!(time.hour(), 0);
        assert_eq!(time.minute(), 0);
    }

    #[test]
    fn test_parse_pragmatic_time_none() {
        let time = parse_pragmatic_time(None);
        assert_eq!(time.hour(), 0);
    }

    #[test]
    fn test_empty_solution() {
        let solution = RouteSolution::empty();
        assert!(solution.stops.is_empty());
        assert_eq!(solution.optimization_score, 100);
    }

    #[test]
    fn test_calculate_score_all_assigned() {
        let problem = sample_problem();
        let stops = vec![
            PlannedStop {
                stop_id: "stop-1".to_string(),
                customer_id: Uuid::nil(),
                customer_name: "A".to_string(),
                order: 1,
                arrival_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                departure_time: NaiveTime::from_hms_opt(9, 30, 0).unwrap(),
                waiting_time_minutes: 0,
            },
            PlannedStop {
                stop_id: "stop-2".to_string(),
                customer_id: Uuid::nil(),
                customer_name: "B".to_string(),
                order: 2,
                arrival_time: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
                departure_time: NaiveTime::from_hms_opt(10, 45, 0).unwrap(),
                waiting_time_minutes: 0,
            },
        ];

        let score = RouteSolution::calculate_score(&stops, &[], &problem);
        assert_eq!(score, 100);
    }

    #[test]
    fn test_calculate_score_with_unassigned() {
        let problem = sample_problem();
        let stops = vec![
            PlannedStop {
                stop_id: "stop-1".to_string(),
                customer_id: Uuid::nil(),
                customer_name: "A".to_string(),
                order: 1,
                arrival_time: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
                departure_time: NaiveTime::from_hms_opt(9, 30, 0).unwrap(),
                waiting_time_minutes: 0,
            },
        ];
        let unassigned = vec!["stop-2".to_string()];

        let score = RouteSolution::calculate_score(&stops, &unassigned, &problem);
        // 1/2 = 50%, minus penalty for priority 2 stop
        assert!(score < 50);
    }

    #[test]
    fn test_from_pragmatic_json_empty() {
        let problem = sample_problem();
        let solution_json = serde_json::json!({
            "tours": [],
            "unassigned": [],
            "statistic": {
                "distance": 0,
                "duration": 0
            }
        });

        let solution = RouteSolution::from_pragmatic_json(&solution_json, &problem).unwrap();
        assert!(solution.stops.is_empty());
    }

    #[test]
    fn test_from_pragmatic_json_with_stops() {
        let problem = sample_problem();
        let solution_json = serde_json::json!({
            "tours": [{
                "vehicleId": "technician_1",
                "stops": [
                    {
                        "location": { "lat": 50.0, "lng": 14.0 },
                        "time": {
                            "arrival": "2026-01-01T08:00:00Z",
                            "departure": "2026-01-01T08:00:00Z"
                        },
                        "activities": [{
                            "type": "departure"
                        }]
                    },
                    {
                        "location": { "lat": 50.1, "lng": 14.1 },
                        "time": {
                            "arrival": "2026-01-01T09:00:00Z",
                            "departure": "2026-01-01T09:30:00Z"
                        },
                        "activities": [{
                            "type": "delivery",
                            "jobId": "stop-1"
                        }]
                    },
                    {
                        "location": { "lat": 50.2, "lng": 14.2 },
                        "time": {
                            "arrival": "2026-01-01T10:00:00Z",
                            "departure": "2026-01-01T10:45:00Z"
                        },
                        "activities": [{
                            "type": "delivery",
                            "jobId": "stop-2"
                        }]
                    }
                ]
            }],
            "unassigned": [],
            "statistic": {
                "distance": 50000,
                "duration": 9000
            }
        });

        let solution = RouteSolution::from_pragmatic_json(&solution_json, &problem).unwrap();
        
        assert_eq!(solution.stops.len(), 2);
        assert_eq!(solution.stops[0].stop_id, "stop-1");
        assert_eq!(solution.stops[0].order, 1);
        assert_eq!(solution.stops[0].arrival_time.hour(), 9);
        assert_eq!(solution.stops[1].stop_id, "stop-2");
        assert_eq!(solution.stops[1].order, 2);
        
        assert_eq!(solution.total_distance_meters, 50000);
        assert_eq!(solution.total_duration_seconds, 9000);
        assert!(solution.unassigned.is_empty());
    }

    #[test]
    fn test_from_pragmatic_json_with_unassigned() {
        let problem = sample_problem();
        let solution_json = serde_json::json!({
            "tours": [{
                "vehicleId": "technician_1",
                "stops": [
                    {
                        "location": { "lat": 50.1, "lng": 14.1 },
                        "time": {
                            "arrival": "2026-01-01T09:00:00Z",
                            "departure": "2026-01-01T09:30:00Z"
                        },
                        "activities": [{
                            "type": "delivery",
                            "jobId": "stop-1"
                        }]
                    }
                ]
            }],
            "unassigned": [{
                "jobId": "stop-2",
                "reasons": [{
                    "code": "TIME_WINDOW_CONSTRAINT"
                }]
            }],
            "statistic": {
                "distance": 20000,
                "duration": 3600
            }
        });

        let solution = RouteSolution::from_pragmatic_json(&solution_json, &problem).unwrap();
        
        assert_eq!(solution.stops.len(), 1);
        assert_eq!(solution.unassigned.len(), 1);
        assert_eq!(solution.unassigned[0], "stop-2");
        
        // Should have a warning about the unassigned stop
        assert!(!solution.warnings.is_empty());
        assert_eq!(solution.warnings[0].warning_type, "UNASSIGNED");
    }
}
