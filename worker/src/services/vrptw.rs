//! Vehicle Routing Problem with Time Windows (VRPTW) solver

use chrono::{NaiveTime, Timelike};
use crate::types::{Coordinates, RouteWarning, TimeWindow};
use crate::services::geo;

/// A stop for the VRPTW solver
#[derive(Debug, Clone)]
pub struct VrptwStop {
    pub id: usize,
    pub coordinates: Coordinates,
    pub time_window: Option<TimeWindow>,
    pub service_duration_minutes: i32,
    pub customer_name: String,
    pub revision_id: uuid::Uuid,
    pub customer_id: uuid::Uuid,
    pub address: String,
}

/// Result of VRPTW optimization
#[derive(Debug, Clone)]
pub struct VrptwResult {
    pub order: Vec<usize>,           // Indices into original stops array
    pub total_distance_km: f64,
    pub total_duration_minutes: i32,
    pub optimization_score: i32,     // 0-100
    pub warnings: Vec<RouteWarning>,
}

/// VRPTW Solver
pub struct VrptwSolver {
    start: Coordinates,
    stops: Vec<VrptwStop>,
    distance_matrix: Vec<Vec<f64>>,
    time_matrix: Vec<Vec<f64>>,
    working_hours_start: NaiveTime,
    working_hours_end: NaiveTime,
}

impl VrptwSolver {
    /// Create a new solver
    pub fn new(
        start: Coordinates,
        stops: Vec<VrptwStop>,
        working_hours_start: NaiveTime,
        working_hours_end: NaiveTime,
    ) -> Self {
        // Build coordinate list: [start, stop0, stop1, ...]
        let mut all_points = vec![start];
        for stop in &stops {
            all_points.push(stop.coordinates);
        }

        let distance_matrix = geo::distance_matrix(&all_points);
        let time_matrix = geo::time_matrix(&all_points);

        Self {
            start,
            stops,
            distance_matrix,
            time_matrix,
            working_hours_start,
            working_hours_end,
        }
    }

    /// Solve the VRPTW problem
    pub fn solve(&self) -> VrptwResult {
        if self.stops.is_empty() {
            return VrptwResult {
                order: vec![],
                total_distance_km: 0.0,
                total_duration_minutes: 0,
                optimization_score: 100,
                warnings: vec![],
            };
        }

        // Initial solution using nearest neighbor with time window priority
        let mut order = self.nearest_neighbor_with_time_windows();

        // Local optimization
        order = self.two_opt_improvement(order);

        // Calculate metrics and check feasibility
        let (total_distance, total_duration, warnings) = self.calculate_metrics(&order);
        let score = self.calculate_score(&order, &warnings);

        VrptwResult {
            order,
            total_distance_km: total_distance,
            total_duration_minutes: total_duration as i32,
            optimization_score: score,
            warnings,
        }
    }

    /// Nearest neighbor heuristic with time window priority
    fn nearest_neighbor_with_time_windows(&self) -> Vec<usize> {
        let n = self.stops.len();
        if n == 0 {
            return vec![];
        }

        let mut order = Vec::with_capacity(n);
        let mut visited = vec![false; n];

        // Separate hard and soft time windows
        let hard_window_stops: Vec<usize> = self.stops.iter()
            .enumerate()
            .filter(|(_, s)| s.time_window.as_ref().map(|tw| tw.is_hard).unwrap_or(false))
            .map(|(i, _)| i)
            .collect();

        // Add hard window stops first, sorted by start time
        let mut hard_sorted = hard_window_stops.clone();
        hard_sorted.sort_by(|&a, &b| {
            let ta = self.stops[a].time_window.as_ref().map(|tw| tw.start).unwrap();
            let tb = self.stops[b].time_window.as_ref().map(|tw| tw.start).unwrap();
            ta.cmp(&tb)
        });

        for idx in hard_sorted {
            order.push(idx);
            visited[idx] = true;
        }

        // For remaining stops, use nearest neighbor
        while order.len() < n {
            let mut best_next = None;
            let mut best_dist = f64::MAX;

            for i in 0..n {
                if visited[i] {
                    continue;
                }

                // Distance from current position (start if first, last stop otherwise)
                let from_idx = if order.is_empty() { 0 } else { order[order.len() - 1] + 1 };
                let dist = self.distance_matrix[from_idx][i + 1];

                if dist < best_dist {
                    best_dist = dist;
                    best_next = Some(i);
                }
            }

            if let Some(next) = best_next {
                order.push(next);
                visited[next] = true;
            } else {
                break;
            }
        }

        order
    }

    /// 2-opt local search improvement
    fn two_opt_improvement(&self, mut order: Vec<usize>) -> Vec<usize> {
        let n = order.len();
        if n < 3 {
            return order;
        }

        let mut improved = true;
        let max_iterations = 100;
        let mut iterations = 0;

        while improved && iterations < max_iterations {
            improved = false;
            iterations += 1;

            for i in 0..n - 1 {
                for j in i + 2..n {
                    if self.would_improve_2opt(&order, i, j) {
                        // Reverse the segment between i+1 and j
                        order[i + 1..=j].reverse();
                        improved = true;
                    }
                }
            }
        }

        order
    }

    /// Check if 2-opt swap would improve the route
    fn would_improve_2opt(&self, order: &[usize], i: usize, j: usize) -> bool {
        let n = order.len();

        // Current edges: (i, i+1) and (j, j+1 or back to start)
        let a = if i == 0 { 0 } else { order[i - 1] + 1 };
        let b = order[i] + 1;
        let c = order[j] + 1;
        let d = if j + 1 >= n { 0 } else { order[j + 1] + 1 };

        let current_dist = self.distance_matrix[a][b] + self.distance_matrix[c][d];
        let new_dist = self.distance_matrix[a][c] + self.distance_matrix[b][d];

        new_dist < current_dist - 0.01 // Small threshold to avoid floating point issues
    }

    /// Calculate total distance, duration, and warnings
    fn calculate_metrics(&self, order: &[usize]) -> (f64, f64, Vec<RouteWarning>) {
        let mut total_distance = 0.0;
        let mut total_duration = 0.0;
        let mut warnings = Vec::new();

        let mut current_time = self.working_hours_start;
        let mut prev_idx = 0; // Start position

        for (order_idx, &stop_idx) in order.iter().enumerate() {
            let stop = &self.stops[stop_idx];
            let matrix_idx = stop_idx + 1;

            // Travel time and distance
            let travel_time = self.time_matrix[prev_idx][matrix_idx];
            let travel_dist = self.distance_matrix[prev_idx][matrix_idx];

            total_distance += travel_dist;
            total_duration += travel_time;

            // Update current time
            let arrival_minutes = time_to_minutes(current_time) + travel_time as i32;
            let arrival_time = minutes_to_time(arrival_minutes);

            // Check time window
            if let Some(tw) = &stop.time_window {
                if arrival_time > tw.end {
                    warnings.push(RouteWarning {
                        stop_index: Some(order_idx as i32),
                        warning_type: "TIME_WINDOW_MISSED".to_string(),
                        message: format!(
                            "Arrival at {} ({}) is after time window end ({})",
                            stop.customer_name,
                            arrival_time.format("%H:%M"),
                            tw.end.format("%H:%M")
                        ),
                    });
                } else if arrival_time < tw.start {
                    // We arrive early, must wait
                    let wait_time = time_to_minutes(tw.start) - arrival_minutes;
                    total_duration += wait_time as f64;
                }
            }

            // Add service duration
            total_duration += stop.service_duration_minutes as f64;

            current_time = minutes_to_time(arrival_minutes + stop.service_duration_minutes);
            prev_idx = matrix_idx;
        }

        // Check if we exceed working hours
        let end_minutes = time_to_minutes(self.working_hours_start) + total_duration as i32;
        if end_minutes > time_to_minutes(self.working_hours_end) {
            warnings.push(RouteWarning {
                stop_index: None,
                warning_type: "EXCEEDS_WORKING_HOURS".to_string(),
                message: format!(
                    "Route ends at {} which is after working hours end ({})",
                    minutes_to_time(end_minutes).format("%H:%M"),
                    self.working_hours_end.format("%H:%M")
                ),
            });
        }

        (total_distance, total_duration, warnings)
    }

    /// Calculate optimization score (0-100)
    fn calculate_score(&self, _order: &[usize], warnings: &[RouteWarning]) -> i32 {
        let mut score = 100;

        // Deduct for each warning
        for warning in warnings {
            match warning.warning_type.as_str() {
                "TIME_WINDOW_MISSED" => score -= 20,
                "EXCEEDS_WORKING_HOURS" => score -= 15,
                _ => score -= 5,
            }
        }

        score.max(0)
    }
}

/// Convert NaiveTime to minutes since midnight
fn time_to_minutes(time: NaiveTime) -> i32 {
    time.hour() as i32 * 60 + time.minute() as i32
}

/// Convert minutes since midnight to NaiveTime
fn minutes_to_time(minutes: i32) -> NaiveTime {
    let hours = (minutes / 60).min(23) as u32;
    let mins = (minutes % 60) as u32;
    NaiveTime::from_hms_opt(hours, mins, 0).unwrap_or(NaiveTime::from_hms_opt(23, 59, 0).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_stop(id: usize, lat: f64, lng: f64) -> VrptwStop {
        VrptwStop {
            id,
            coordinates: Coordinates { lat, lng },
            time_window: None,
            service_duration_minutes: 30,
            customer_name: format!("Customer {}", id),
            revision_id: Uuid::new_v4(),
            customer_id: Uuid::new_v4(),
            address: format!("Address {}", id),
        }
    }

    #[test]
    fn test_empty_stops() {
        let solver = VrptwSolver::new(
            Coordinates { lat: 50.0, lng: 14.0 },
            vec![],
            NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        );

        let result = solver.solve();

        assert!(result.order.is_empty());
        assert_eq!(result.optimization_score, 100);
    }

    #[test]
    fn test_single_stop() {
        let stops = vec![make_stop(0, 50.1, 14.1)];

        let solver = VrptwSolver::new(
            Coordinates { lat: 50.0, lng: 14.0 },
            stops,
            NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        );

        let result = solver.solve();

        assert_eq!(result.order, vec![0]);
        assert!(result.total_distance_km > 0.0);
    }

    #[test]
    fn test_multiple_stops() {
        let stops = vec![
            make_stop(0, 50.1, 14.1),
            make_stop(1, 50.2, 14.2),
            make_stop(2, 50.15, 14.15),
        ];

        let solver = VrptwSolver::new(
            Coordinates { lat: 50.0, lng: 14.0 },
            stops,
            NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        );

        let result = solver.solve();

        // Should visit all stops
        assert_eq!(result.order.len(), 3);
        assert!(result.total_distance_km > 0.0);
        assert!(result.total_duration_minutes > 0);
    }
}
