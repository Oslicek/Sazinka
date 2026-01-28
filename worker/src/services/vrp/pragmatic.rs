//! vrp-pragmatic solver integration.

use std::collections::HashMap;
use std::io::BufWriter;
use std::sync::Arc;

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, NaiveTime};
use vrp_cli::extensions::solve::config::{Config, TerminationConfig, create_builder_from_config};
use vrp_core::solver::Solver;
use vrp_pragmatic::format::problem::{Matrix, PragmaticProblem, Problem};
use vrp_pragmatic::format::solution::{PragmaticOutputType, Solution as PragmaticSolution, write_pragmatic};

use crate::services::routing::DistanceTimeMatrices;
use super::{
    build_pragmatic_matrix, build_pragmatic_problem, DEFAULT_PROFILE, PlannedStop, RouteSolution,
    RouteWarning, SolverConfig, VrpProblem,
};

pub fn solve_pragmatic(
    problem: &VrpProblem,
    matrices: &DistanceTimeMatrices,
    date: NaiveDate,
    config: &SolverConfig,
) -> Result<RouteSolution> {
    if problem.stops.is_empty() {
        return Ok(RouteSolution::empty());
    }

    let problem_json = build_pragmatic_problem(problem, date);
    let problem_format: Problem = serde_json::from_value(problem_json)
        .context("Failed to deserialize pragmatic problem")?;

    let matrix: Matrix = build_pragmatic_matrix(matrices, DEFAULT_PROFILE);
    let core_problem = (problem_format, vec![matrix])
        .read_pragmatic()
        .context("Failed to build core problem from pragmatic format")?;

    let core_problem = Arc::new(core_problem);
    let solver_config = build_solver_config(core_problem.clone(), config)?;

    let solution = Solver::new(core_problem.clone(), solver_config)
        .solve()
        .context("Failed to solve VRP with vrp-pragmatic")?;

    let pragmatic = write_pragmatic_solution(core_problem.as_ref(), &solution)?;
    Ok(map_solution(problem, &pragmatic))
}

fn build_solver_config(
    problem: Arc<vrp_core::models::Problem>,
    config: &SolverConfig,
) -> Result<vrp_core::rosomaxa::evolution::EvolutionConfig<
    vrp_core::solver::RefinementContext,
    vrp_core::models::GoalContext,
    vrp_core::construction::heuristics::InsertionContext,
>> {
    let config = Config {
        termination: Some(TerminationConfig {
            max_time: Some(config.max_time_seconds as usize),
            max_generations: Some(config.max_generations),
            variation: None,
        }),
        evolution: None,
        hyper: None,
        environment: None,
        telemetry: None,
        output: None,
    };

    let builder = create_builder_from_config(problem, Vec::new(), &config)
        .context("Failed to create solver builder")?;

    builder.build().context("Failed to build solver configuration")
}

fn write_pragmatic_solution(
    problem: &vrp_core::models::Problem,
    solution: &vrp_core::models::Solution,
) -> Result<PragmaticSolution> {
    let mut writer = BufWriter::new(Vec::new());
    write_pragmatic(problem, solution, PragmaticOutputType::default(), &mut writer)
        .context("Failed to serialize pragmatic solution")?;

    let bytes = writer.into_inner().context("Failed to flush solution writer")?;
    let json = String::from_utf8(bytes).context("Solution is not valid UTF-8")?;
    let parsed: PragmaticSolution = serde_json::from_str(&json)
        .context("Failed to parse pragmatic solution JSON")?;

    Ok(parsed)
}

fn map_solution(problem: &VrpProblem, solution: &PragmaticSolution) -> RouteSolution {
    let mut stop_by_id: HashMap<&str, &super::VrpStop> = HashMap::new();
    for stop in &problem.stops {
        stop_by_id.insert(stop.id.as_str(), stop);
    }

    let mut planned_stops = Vec::new();
    let mut warnings = Vec::new();

    if let Some(tour) = solution.tours.first() {
        for stop in &tour.stops {
            let schedule = stop.schedule();
            let arrival_time = parse_time(&schedule.arrival).unwrap_or(problem.shift_start);
            let departure_time = parse_time(&schedule.departure).unwrap_or(problem.shift_start);

            for activity in stop.activities() {
                if activity.activity_type == "departure" || activity.activity_type == "arrival" {
                    continue;
                }

                let stop_id = activity.job_id.as_str();
                if let Some(definition) = stop_by_id.get(stop_id) {
                    planned_stops.push(PlannedStop {
                        stop_id: definition.id.clone(),
                        customer_id: definition.customer_id,
                        customer_name: definition.customer_name.clone(),
                        order: (planned_stops.len() + 1) as u32,
                        arrival_time,
                        departure_time,
                        waiting_time_minutes: 0,
                    });
                } else {
                    warnings.push(RouteWarning {
                        stop_id: Some(activity.job_id.clone()),
                        warning_type: "UNKNOWN_JOB".to_string(),
                        message: "Job in solution does not exist in input".to_string(),
                    });
                }
            }
        }
    }

    let unassigned = solution
        .unassigned
        .as_ref()
        .map(|items| items.iter().map(|job| job.job_id.clone()).collect())
        .unwrap_or_else(Vec::new);

    let total_distance = solution.statistic.distance.max(0) as u64;
    let total_duration = solution.statistic.duration.max(0) as u64;

    RouteSolution {
        stops: planned_stops,
        total_distance_meters: total_distance,
        total_duration_seconds: total_duration,
        optimization_score: if unassigned.is_empty() { 100 } else { 80 },
        warnings,
        unassigned,
    }
}

fn parse_time(value: &str) -> Option<NaiveTime> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|parsed| parsed.time())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use uuid::Uuid;

    use crate::types::Coordinates;
    use super::super::{Depot, VrpStop};

    fn test_problem() -> VrpProblem {
        VrpProblem {
            depot: Depot { coordinates: Coordinates { lat: 50.0755, lng: 14.4378 } },
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "stop-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Customer A".to_string(),
                    coordinates: Coordinates { lat: 49.1951, lng: 16.6068 },
                    service_duration_minutes: 20,
                    time_window: None,
                    priority: 1,
                },
                VrpStop {
                    id: "stop-2".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Customer B".to_string(),
                    coordinates: Coordinates { lat: 49.8209, lng: 18.2625 },
                    service_duration_minutes: 15,
                    time_window: None,
                    priority: 1,
                },
            ],
        }
    }

    #[test]
    fn solve_pragmatic_small_problem_returns_all_stops() {
        let problem = test_problem();
        let matrices = DistanceTimeMatrices {
            distances: vec![
                vec![0, 10000, 20000],
                vec![10000, 0, 15000],
                vec![20000, 15000, 0],
            ],
            durations: vec![
                vec![0, 600, 1200],
                vec![600, 0, 900],
                vec![1200, 900, 0],
            ],
            size: 3,
        };

        let solution = solve_pragmatic(
            &problem,
            &matrices,
            NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            &SolverConfig::instant(),
        ).unwrap();

        assert_eq!(solution.stops.len(), 2);
        assert!(solution.unassigned.is_empty());
    }
}
