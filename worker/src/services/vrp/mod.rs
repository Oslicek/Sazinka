//! VRP (Vehicle Routing Problem) solver
//!
//! Wraps the vrp-pragmatic crate for VRPTW optimization.

mod problem;
mod solution;
mod config;

pub use problem::{VrpProblem, VrpStop, Depot, StopTimeWindow};
pub use solution::{RouteSolution, PlannedStop, RouteWarning};
pub use config::SolverConfig;

use anyhow::Result;
use tracing::{debug, info, warn};

use crate::services::routing::DistanceTimeMatrices;

/// VRP Solver using vrp-pragmatic crate
pub struct VrpSolver {
    config: SolverConfig,
}

impl VrpSolver {
    pub fn new(config: SolverConfig) -> Self {
        Self { config }
    }

    /// Solve VRPTW problem
    pub fn solve(
        &self,
        problem: &VrpProblem,
        matrices: &DistanceTimeMatrices,
    ) -> Result<RouteSolution> {
        if problem.stops.is_empty() {
            debug!("No stops to optimize, returning empty solution");
            return Ok(RouteSolution::empty());
        }

        info!(
            "Solving VRP with {} stops, max_time={}s",
            problem.stops.len(),
            self.config.max_time_seconds
        );

        // Build vrp-pragmatic problem JSON
        let pragmatic_problem = problem.to_pragmatic_json(matrices)?;
        
        debug!("Built pragmatic problem JSON");

        // Use vrp-pragmatic to solve
        let solution_json = self.solve_with_vrp_pragmatic(&pragmatic_problem)?;

        // Parse solution back to our format
        let solution = RouteSolution::from_pragmatic_json(&solution_json, problem)?;

        info!(
            "VRP solved: {} stops, {:.1} km, score={}",
            solution.stops.len(),
            solution.total_distance_meters as f64 / 1000.0,
            solution.optimization_score
        );

        Ok(solution)
    }

    fn solve_with_vrp_pragmatic(&self, problem_json: &serde_json::Value) -> Result<serde_json::Value> {
        use vrp_pragmatic::format::problem::Problem;
        use vrp_pragmatic::format::solution::Solution;
        use vrp_pragmatic::core::prelude::*;
        use vrp_pragmatic::core::solver::Builder;
        use std::sync::Arc;
        use std::io::BufReader;

        // Serialize problem to string for parsing
        let problem_str = serde_json::to_string(problem_json)?;
        
        // Parse problem
        let problem = Problem::read_pragmatic(
            &mut BufReader::new(problem_str.as_bytes()),
            None
        ).map_err(|e| anyhow::anyhow!("Failed to parse VRP problem: {:?}", e))?;

        let problem = Arc::new(problem);

        // Build and configure solver
        let (solution, _, _) = Builder::new(problem.clone())
            .with_max_time(Some(self.config.max_time_seconds as u64))
            .with_max_generations(Some(self.config.max_generations))
            .build()?
            .solve()?;

        // Serialize solution to JSON
        let solution_json = Solution::write_pragmatic_json(&problem, &solution)
            .map_err(|e| anyhow::anyhow!("Failed to serialize VRP solution: {:?}", e))?;

        // Parse the JSON string back to Value
        let solution_value: serde_json::Value = serde_json::from_str(&solution_json)?;

        Ok(solution_value)
    }
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

    #[test]
    fn test_empty_problem() {
        let solver = VrpSolver::default();
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let matrices = mock_matrices(1);
        let solution = solver.solve(&problem, &matrices).unwrap();

        assert!(solution.stops.is_empty());
        assert_eq!(solution.total_distance_meters, 0);
        assert_eq!(solution.optimization_score, 100);
    }

    #[test]
    fn test_single_stop_problem() {
        let solver = VrpSolver::new(SolverConfig::fast());
        let problem = VrpProblem {
            depot: Depot { coordinates: prague() },
            stops: vec![make_stop("Customer A", 50.1, 14.5)],
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
        };

        let matrices = mock_matrices(2); // depot + 1 stop
        let solution = solver.solve(&problem, &matrices).unwrap();

        assert_eq!(solution.stops.len(), 1);
        assert_eq!(solution.stops[0].order, 1);
    }

    #[test]
    fn test_multiple_stops_all_assigned() {
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
        let solution = solver.solve(&problem, &matrices).unwrap();

        // All stops should be assigned
        assert_eq!(solution.stops.len(), 3);
        assert!(solution.unassigned.is_empty());

        // Orders should be 1, 2, 3
        let orders: Vec<u32> = solution.stops.iter().map(|s| s.order).collect();
        assert!(orders.contains(&1));
        assert!(orders.contains(&2));
        assert!(orders.contains(&3));
    }

    #[test]
    fn test_solution_has_positive_metrics() {
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
        let solution = solver.solve(&problem, &matrices).unwrap();

        assert!(solution.total_distance_meters > 0);
        assert!(solution.total_duration_seconds > 0);
        assert!(solution.optimization_score > 0);
    }
}
