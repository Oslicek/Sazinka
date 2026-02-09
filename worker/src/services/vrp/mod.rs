//! VRP (Vehicle Routing Problem) solver
//!
//! Uses nearest neighbor heuristic for fast, simple optimization.
//! Can be upgraded to vrp-pragmatic for better results later.

mod problem;
mod solution;
mod config;
mod adapter;
mod pragmatic;

pub use problem::{VrpProblem, VrpStop, Depot, StopTimeWindow};
pub use solution::{RouteSolution, PlannedStop, RouteWarning};
pub use config::SolverConfig;
pub use adapter::{build_pragmatic_problem, build_pragmatic_problem_with_buffer, build_pragmatic_matrix, DEFAULT_PROFILE};
pub use pragmatic::solve_pragmatic;

use anyhow::Result;
use chrono::{NaiveDate, NaiveTime, Timelike};
use tracing::{debug, info, warn};
use std::time::Instant;

use crate::services::routing::DistanceTimeMatrices;

/// VRP Solver using nearest neighbor heuristic
pub struct VrpSolver {
    config: SolverConfig,
}

impl VrpSolver {
    pub fn new(config: SolverConfig) -> Self {
        Self { config }
    }

    /// Solve VRP problem with timeout protection.
    /// Uses vrp-pragmatic with a hard timeout, falling back to heuristic if it fails or times out.
    pub async fn solve(
        &self,
        problem: &VrpProblem,
        matrices: &DistanceTimeMatrices,
        date: NaiveDate,
    ) -> Result<RouteSolution> {
        let started_at = Instant::now();
        let mut solver_log = Vec::new();

        if problem.stops.is_empty() {
            debug!("No stops to optimize, returning empty solution");
            let mut solution = RouteSolution::empty();
            solution.solve_time_ms = started_at.elapsed().as_millis() as u64;
            solution.algorithm = "none".to_string();
            solution.solver_log = vec!["no_stops".to_string()];
            return Ok(solution);
        }

        info!(
            "Solving VRP with {} stops using vrp-pragmatic",
            problem.stops.len(),
        );

        // Hard timeout: config time + 10s buffer. solve_pragmatic is CPU-bound,
        // so we run it in spawn_blocking and wrap with tokio timeout.
        let timeout_secs = self.config.max_time_seconds as u64 + 10;
        let problem_clone = problem.clone();
        let matrices_clone = matrices.clone();
        let config_clone = self.config.clone();

        let pragmatic_result = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            tokio::task::spawn_blocking(move || {
                solve_pragmatic(&problem_clone, &matrices_clone, date, &config_clone)
            }),
        )
        .await;

        match pragmatic_result {
            Ok(Ok(Ok(mut solution))) => {
                // solve_pragmatic succeeded within timeout
                solution.algorithm = "vrp-pragmatic".to_string();
                solution.solve_time_ms = started_at.elapsed().as_millis() as u64;
                
                let mut final_log = Vec::new();
                final_log.push(format!(
                    "algorithm=vrp-pragmatic time_ms={}",
                    solution.solve_time_ms
                ));
                final_log.push(format!(
                    "stops={} unassigned={}",
                    solution.stops.len(),
                    solution.unassigned.len()
                ));
                final_log.extend(solution.solver_log.drain(..));
                solution.solver_log = final_log;
                
                info!(
                    "VRP solved with vrp-pragmatic: {} stops, {:.1} km in {}ms",
                    solution.stops.len(),
                    solution.total_distance_meters as f64 / 1000.0,
                    solution.solve_time_ms,
                );
                return Ok(solution);
            }
            Ok(Ok(Err(err))) => {
                // solve_pragmatic returned an error
                warn!("vrp-pragmatic failed, falling back to heuristic: {}", err);
                solver_log.push(format!("pragmatic_error={}", err));
            }
            Ok(Err(join_err)) => {
                // spawn_blocking panicked
                warn!("vrp-pragmatic panicked, falling back to heuristic: {}", join_err);
                solver_log.push(format!("pragmatic_panic={}", join_err));
            }
            Err(_elapsed) => {
                // Timeout reached
                warn!(
                    "vrp-pragmatic timed out after {}s, falling back to heuristic",
                    timeout_secs
                );
                solver_log.push(format!("pragmatic_timeout={}s", timeout_secs));
            }
        }

        // Fallback: use nearest neighbor heuristic (time-window-aware)
        let ordered_indices = self.nearest_neighbor(problem, matrices);
        
        // Build solution from ordered indices
        let mut solution = self.build_solution(problem, matrices, &ordered_indices);
        solution.algorithm = "heuristic-fallback".to_string();
        solution.solve_time_ms = started_at.elapsed().as_millis() as u64;
        solver_log.push(format!(
            "algorithm=heuristic-fallback time_ms={}",
            solution.solve_time_ms
        ));
        solver_log.push(format!(
            "stops={} unassigned={}",
            solution.stops.len(),
            solution.unassigned.len()
        ));
        solution.solver_log = solver_log;
        solution.warnings.push(RouteWarning {
            stop_id: None,
            warning_type: "SOLVER_FALLBACK".to_string(),
            message: "Optimalizátor selhal nebo vypršel čas, použita jednoduchá heuristika".to_string(),
        });

        info!(
            "VRP solved: {} stops, {:.1} km, score={}",
            solution.stops.len(),
            solution.total_distance_meters as f64 / 1000.0,
            solution.optimization_score
        );

        Ok(solution)
    }

    /// Time-window-aware nearest neighbor heuristic.
    /// Stops with hard time windows are scheduled first (sorted by window start).
    /// Remaining stops without windows are inserted by nearest neighbor.
    /// Returns indices of stops in visit order (1..n, where 0 = depot).
    fn nearest_neighbor(&self, problem: &VrpProblem, matrices: &DistanceTimeMatrices) -> Vec<usize> {
        let n = matrices.size;
        if n <= 1 {
            return vec![];
        }

        // Separate stops into those with hard time windows and those without
        let mut windowed: Vec<(usize, NaiveTime)> = Vec::new(); // (matrix_index, window_start)
        let mut unwindowed: Vec<usize> = Vec::new();

        for (i, stop) in problem.stops.iter().enumerate() {
            let matrix_idx = i + 1; // 0 is depot
            match &stop.time_window {
                Some(tw) if tw.is_hard => {
                    windowed.push((matrix_idx, tw.start));
                }
                _ => {
                    unwindowed.push(matrix_idx);
                }
            }
        }

        // Sort windowed stops by window start (earliest first)
        windowed.sort_by_key(|&(_, start)| start);

        let mut visited = vec![false; n];
        let mut route = Vec::with_capacity(n - 1);
        visited[0] = true;
        let mut current = 0;

        // Phase 1: Schedule windowed stops in order of their time window start
        for (idx, _start) in &windowed {
            visited[*idx] = true;
            route.push(*idx);
            current = *idx;
        }

        // Phase 2: Fill remaining stops by nearest neighbor from last position
        let remaining_count = unwindowed.len();
        for _ in 0..remaining_count {
            let mut best_next = None;
            let mut best_distance = u64::MAX;

            for &j in &unwindowed {
                if !visited[j] {
                    let dist = matrices.distance(current, j);
                    if dist < best_distance {
                        best_distance = dist;
                        best_next = Some(j);
                    }
                }
            }

            if let Some(next) = best_next {
                visited[next] = true;
                route.push(next);
                current = next;
            }
        }

        route
    }

    /// Build solution from ordered stop indices
    fn build_solution(
        &self,
        problem: &VrpProblem,
        matrices: &DistanceTimeMatrices,
        ordered_indices: &[usize],
    ) -> RouteSolution {
        let mut planned_stops = Vec::new();
        let mut total_distance: u64 = 0;
        let mut total_duration: u64 = 0;
        
        // Start time from shift start
        let mut current_time = problem.shift_start;
        let mut prev_idx = 0; // Start from depot

        for (order, &stop_idx) in ordered_indices.iter().enumerate() {
            // stop_idx is 1-based in matrices (0 is depot)
            // but problem.stops is 0-indexed
            let stop = &problem.stops[stop_idx - 1];
            
            // Travel from previous location
            let travel_distance = matrices.distance(prev_idx, stop_idx);
            let travel_duration = matrices.duration(prev_idx, stop_idx);
            
            total_distance += travel_distance;
            total_duration += travel_duration;
            
            // Calculate arrival time
            let arrival_time = add_seconds_to_time(current_time, travel_duration as i64);
            
            // Service time
            let service_seconds = stop.service_duration_minutes as i64 * 60;
            let departure_time = add_seconds_to_time(arrival_time, service_seconds);
            
            total_duration += service_seconds as u64;
            
            planned_stops.push(PlannedStop {
                stop_id: stop.id.clone(),
                customer_id: stop.customer_id,
                customer_name: stop.customer_name.clone(),
                order: (order + 1) as u32,
                arrival_time,
                departure_time,
                waiting_time_minutes: 0,
            });
            
            current_time = departure_time;
            prev_idx = stop_idx;
        }

        // Add return to depot
        if !ordered_indices.is_empty() {
            let return_distance = matrices.distance(prev_idx, 0);
            let return_duration = matrices.duration(prev_idx, 0);
            total_distance += return_distance;
            total_duration += return_duration;
        }

        // Calculate optimization score (simple heuristic: 80-100 based on route efficiency)
        let score = if planned_stops.is_empty() {
            100
        } else {
            // Score based on average distance per stop
            let avg_dist = total_distance / planned_stops.len() as u64;
            // Lower average = better score
            if avg_dist < 5000 { 95 }
            else if avg_dist < 10000 { 90 }
            else if avg_dist < 20000 { 85 }
            else { 80 }
        };

        RouteSolution {
            stops: planned_stops,
            total_distance_meters: total_distance,
            total_duration_seconds: total_duration,
            optimization_score: score,
            algorithm: "heuristic".to_string(),
            solve_time_ms: 0,
            solver_log: vec![],
            warnings: vec![],
            unassigned: vec![],
        }
    }
}

/// Add seconds to NaiveTime, wrapping at midnight
fn add_seconds_to_time(time: NaiveTime, seconds: i64) -> NaiveTime {
    let total_seconds = time.num_seconds_from_midnight() as i64 + seconds;
    let wrapped = total_seconds % 86400; // Wrap at midnight
    NaiveTime::from_num_seconds_from_midnight_opt(wrapped as u32, 0)
        .unwrap_or(time)
}

impl Default for VrpSolver {
    fn default() -> Self {
        Self::new(SolverConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Coordinates;
    use chrono::NaiveTime;
    use uuid::Uuid;

    fn make_stop(name: &str, lat: f64, lng: f64) -> VrpStop {
        VrpStop {
            id: Uuid::new_v4().to_string(),
            customer_id: Uuid::new_v4(),
            customer_name: name.to_string(),
            coordinates: Coordinates { lat, lng },
            service_duration_minutes: 30,
            time_window: None,
            priority: 1,
        }
    }

    fn prague() -> Coordinates {
        Coordinates { lat: 50.0755, lng: 14.4378 }
    }

    // Create mock matrices for testing
    fn mock_matrices(n: usize) -> DistanceTimeMatrices {
        // Simple mock: distance and duration proportional to index difference
        let mut distances = vec![vec![0u64; n]; n];
        let mut durations = vec![vec![0u64; n]; n];

        for i in 0..n {
            for j in 0..n {
                if i != j {
                    let diff = ((i as i64 - j as i64).abs() as u64) + 1;
                    distances[i][j] = diff * 10000; // 10 km per step
                    durations[i][j] = diff * 600;   // 10 min per step
                }
            }
        }

        DistanceTimeMatrices {
            distances,
            durations,
            size: n,
        }
    }

    #[test]
    fn test_solver_config_default() {
        let config = SolverConfig::default();
        assert_eq!(config.max_time_seconds, 30);
        assert!(config.max_generations > 0);
    }

    #[test]
    fn test_solver_config_fast() {
        let config = SolverConfig::fast();
        assert!(config.max_time_seconds < 10);
    }

    #[tokio::test]
    async fn test_empty_problem() {
        let solver = VrpSolver::default();
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let matrices = mock_matrices(1);
        let solution = solver
            .solve(
                &problem,
                &matrices,
                chrono::NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            )
            .await
            .unwrap();

        assert!(solution.stops.is_empty());
        assert_eq!(solution.total_distance_meters, 0);
        assert_eq!(solution.optimization_score, 100);
    }

    #[tokio::test]
    async fn test_single_stop_problem() {
        let solver = VrpSolver::new(SolverConfig::fast());
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![make_stop("Customer A", 50.1, 14.5)],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let matrices = mock_matrices(2); // depot + 1 stop
        let solution = solver
            .solve(
                &problem,
                &matrices,
                chrono::NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(solution.stops.len(), 1);
        assert_eq!(solution.stops[0].order, 1);
    }

    #[tokio::test]
    async fn test_multiple_stops_all_assigned() {
        let solver = VrpSolver::new(SolverConfig::fast());
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![
                make_stop("Customer A", 50.1, 14.5),
                make_stop("Customer B", 50.2, 14.6),
                make_stop("Customer C", 50.15, 14.55),
            ],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let matrices = mock_matrices(4); // depot + 3 stops
        let solution = solver
            .solve(
                &problem,
                &matrices,
                chrono::NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            )
            .await
            .unwrap();

        // All stops should be assigned
        assert_eq!(solution.stops.len(), 3);
        assert!(solution.unassigned.is_empty());

        // Orders should be 1, 2, 3
        let orders: Vec<u32> = solution.stops.iter().map(|s| s.order).collect();
        assert!(orders.contains(&1));
        assert!(orders.contains(&2));
        assert!(orders.contains(&3));
    }

    #[tokio::test]
    async fn test_solution_has_positive_metrics() {
        let solver = VrpSolver::new(SolverConfig::fast());
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![
                make_stop("Customer A", 50.1, 14.5),
                make_stop("Customer B", 50.2, 14.6),
            ],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let matrices = mock_matrices(3);
        let solution = solver
            .solve(
                &problem,
                &matrices,
                chrono::NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            )
            .await
            .unwrap();

        assert!(solution.total_distance_meters > 0);
        assert!(solution.total_duration_seconds > 0);
        assert!(solution.optimization_score > 0);
    }

    #[test]
    fn test_add_seconds_to_time() {
        let time = NaiveTime::from_hms_opt(8, 0, 0).unwrap();
        
        // Add 30 minutes
        let result = add_seconds_to_time(time, 1800);
        assert_eq!(result.hour(), 8);
        assert_eq!(result.minute(), 30);
        
        // Add 2 hours
        let result = add_seconds_to_time(time, 7200);
        assert_eq!(result.hour(), 10);
        assert_eq!(result.minute(), 0);
    }

    #[test]
    fn test_nearest_neighbor_ordering_no_windows() {
        let solver = VrpSolver::default();
        
        // Problem with no time windows - pure nearest neighbor
        let problem = VrpProblem {
            depot: Depot { coordinates: Coordinates { lat: 50.0, lng: 14.0 } },
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "s1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "A".to_string(),
                    coordinates: Coordinates { lat: 49.0, lng: 16.0 },
                    service_duration_minutes: 30,
                    time_window: None,
                    priority: 1,
                },
                VrpStop {
                    id: "s2".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "B".to_string(),
                    coordinates: Coordinates { lat: 49.5, lng: 15.0 },
                    service_duration_minutes: 30,
                    time_window: None,
                    priority: 1,
                },
            ],
        };

        // Create a matrix where stop 2 is closest to depot, then stop 1
        let mut distances = vec![vec![0u64; 3]; 3];
        distances[0][1] = 20000; // depot -> stop1: 20km
        distances[0][2] = 10000; // depot -> stop2: 10km
        distances[1][0] = 20000;
        distances[1][2] = 15000; // stop1 -> stop2: 15km
        distances[2][0] = 10000;
        distances[2][1] = 15000; // stop2 -> stop1: 15km
        
        let matrices = DistanceTimeMatrices {
            distances,
            durations: vec![vec![600u64; 3]; 3],
            size: 3,
        };
        
        let route = solver.nearest_neighbor(&problem, &matrices);
        
        // Should visit stop 2 first (closer to depot), then stop 1
        assert_eq!(route, vec![2, 1]);
    }

    #[test]
    fn test_nearest_neighbor_with_time_windows_orders_by_window() {
        let solver = VrpSolver::default();
        
        // Stop 1 is closer but has LATER time window, stop 2 has EARLIER window
        let problem = VrpProblem {
            depot: Depot { coordinates: Coordinates { lat: 50.0, lng: 14.0 } },
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "s1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "A".to_string(),
                    coordinates: Coordinates { lat: 49.0, lng: 16.0 },
                    service_duration_minutes: 30,
                    time_window: Some(StopTimeWindow {
                        start: NaiveTime::from_hms_opt(14, 0, 0).unwrap(), // later
                        end: NaiveTime::from_hms_opt(16, 0, 0).unwrap(),
                        is_hard: true,
                    }),
                    priority: 1,
                },
                VrpStop {
                    id: "s2".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "B".to_string(),
                    coordinates: Coordinates { lat: 49.5, lng: 15.0 },
                    service_duration_minutes: 30,
                    time_window: Some(StopTimeWindow {
                        start: NaiveTime::from_hms_opt(9, 0, 0).unwrap(), // earlier
                        end: NaiveTime::from_hms_opt(11, 0, 0).unwrap(),
                        is_hard: true,
                    }),
                    priority: 1,
                },
            ],
        };

        let matrices = DistanceTimeMatrices {
            distances: vec![vec![10000u64; 3]; 3],
            durations: vec![vec![600u64; 3]; 3],
            size: 3,
        };
        
        let route = solver.nearest_neighbor(&problem, &matrices);
        
        // Should visit stop 2 first (earlier window 09:00), then stop 1 (14:00)
        assert_eq!(route, vec![2, 1]);
    }
}
