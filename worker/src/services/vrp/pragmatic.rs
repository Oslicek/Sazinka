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
    build_pragmatic_matrix, build_pragmatic_problem_with_buffer, DEFAULT_PROFILE, PlannedStop,
    RouteSolution, RouteWarning, SolverConfig, VrpProblem,
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

    let problem_json = build_pragmatic_problem_with_buffer(
        problem,
        date,
        Some(matrices),
        config.arrival_buffer_percent,
        config.arrival_buffer_fixed_minutes,
    );
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
    let mut solver_log = Vec::new();

    if let Some(tour) = solution.tours.first() {
        for stop in &tour.stops {
            let schedule = stop.schedule();
            let arrival_time = parse_time(&schedule.arrival).unwrap_or(problem.shift_start);
            let departure_time = parse_time(&schedule.departure).unwrap_or(problem.shift_start);

            for activity in stop.activities() {
                if activity.activity_type == "departure" || activity.activity_type == "arrival" {
                    continue;
                }
                if activity.activity_type == "break" {
                    // Use activity-level timing when available (a break may share a stop
                    // with a job, so the stop-level schedule covers the whole visit).
                    let (break_arrival, break_departure) = activity
                        .time
                        .as_ref()
                        .and_then(|interval| {
                            let a = parse_time(&interval.start)?;
                            let d = parse_time(&interval.end)?;
                            Some((a, d))
                        })
                        .unwrap_or((arrival_time, departure_time));

                    let break_duration = (break_departure - break_arrival).num_minutes().max(0) as u32;
                    planned_stops.push(PlannedStop {
                        stop_id: format!("break-{}", planned_stops.len() + 1),
                        customer_id: uuid::Uuid::nil(),
                        customer_name: "jobs:break_label".to_string(),
                        order: (planned_stops.len() + 1) as u32,
                        arrival_time: break_arrival,
                        departure_time: break_departure,
                        waiting_time_minutes: break_duration,
                    });
                    solver_log.push(format!(
                        "break: {}-{}",
                        break_arrival.format("%H:%M"),
                        break_departure.format("%H:%M")
                    ));
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

                    // Post-solve validation: compare arrival vs original (unshifted) time window
                    if let Some(tw) = &definition.time_window {
                        if tw.is_hard {
                            validate_arrival_vs_window(
                                &definition.id,
                                &definition.customer_name,
                                arrival_time,
                                tw,
                                &mut warnings,
                            );
                        }
                    }
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

    // Extract unassigned jobs with their reasons
    let mut unassigned = Vec::new();
    if let Some(unassigned_jobs) = &solution.unassigned {
        for job in unassigned_jobs {
            unassigned.push(job.job_id.clone());
            
            // Get customer name for better readability
            let customer_name = stop_by_id
                .get(job.job_id.as_str())
                .map(|s| s.customer_name.as_str())
                .unwrap_or(&job.job_id);
            
            // Extract reasons for this job
            let reasons: Vec<String> = job.reasons.iter().map(|r| {
                let desc = if r.description.is_empty() { None } else { Some(r.description.as_str()) };
                format_unassigned_reason(&r.code, desc)
            }).collect();
            
            let reasons_str = if reasons.is_empty() {
                "unknown reason".to_string()
            } else {
                reasons.join(", ")
            };
            
            solver_log.push(format!("unassigned: {} - {}", customer_name, reasons_str));
        }
    }

    let total_distance = solution.statistic.distance.max(0) as u64;
    let total_duration = solution.statistic.duration.max(0) as u64;

    RouteSolution {
        stops: planned_stops,
        total_distance_meters: total_distance,
        total_duration_seconds: total_duration,
        optimization_score: if unassigned.is_empty() { 100 } else { 80 },
        algorithm: "vrp-pragmatic".to_string(),
        solve_time_ms: 0,
        solver_log,
        warnings,
        unassigned,
    }
}

/// Format unassigned reason code to human-readable message
fn format_unassigned_reason(code: &str, description: Option<&str>) -> String {
    let reason = match code {
        "NO_VEHICLE_SHIFT_TIME" => "shift time exceeded",
        "CAPACITY_CONSTRAINT" => "vehicle capacity exceeded", 
        "TIME_WINDOW_CONSTRAINT" => "time window violated",
        "BREAK_CONSTRAINT" => "break constraint violated",
        "LOCKING_CONSTRAINT" => "locking constraint violated",
        "PRIORITY_CONSTRAINT" => "priority constraint violated",
        "AREA_CONSTRAINT" => "area constraint violated",
        "SKILL_CONSTRAINT" => "skill constraint violated",
        "REACHABLE_CONSTRAINT" => "location not reachable",
        "MAX_DISTANCE_CONSTRAINT" => "max distance exceeded",
        "MAX_DURATION_CONSTRAINT" => "max duration exceeded",
        "MAX_TRAVEL_TIME_CONSTRAINT" => "max travel time exceeded",
        _ => code,
    };
    
    if let Some(desc) = description {
        format!("{} ({})", reason, desc)
    } else {
        reason.to_string()
    }
}

/// Validate that the solver's planned arrival respects the original time window.
/// Generates LATE_ARRIVAL if arrival is after window end,
/// and INSUFFICIENT_BUFFER if arrival is after window start (no buffer).
fn validate_arrival_vs_window(
    stop_id: &str,
    customer_name: &str,
    arrival_time: NaiveTime,
    window: &super::StopTimeWindow,
    warnings: &mut Vec<RouteWarning>,
) {
    if arrival_time > window.end {
        warnings.push(RouteWarning {
            stop_id: Some(stop_id.to_string()),
            warning_type: "LATE_ARRIVAL".to_string(),
            message: serde_json::json!({"key": "planner:warning.arrival_after_window", "params": {"name": customer_name, "arrival": arrival_time.format("%H:%M").to_string(), "windowEnd": window.end.format("%H:%M").to_string()}}).to_string(),
        });
    } else if arrival_time > window.start {
        let late_by_seconds = (arrival_time - window.start).num_seconds();
        warnings.push(RouteWarning {
            stop_id: Some(stop_id.to_string()),
            warning_type: "INSUFFICIENT_BUFFER".to_string(),
            message: serde_json::json!({"key": "planner:warning.arrival_late_after_start", "params": {"name": customer_name, "arrival": arrival_time.format("%H:%M").to_string(), "lateMinutes": late_by_seconds / 60, "windowStart": window.start.format("%H:%M").to_string()}}).to_string(),
        });
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
    use super::super::{BreakConfig, Depot, VrpStop};

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
            break_config: None,
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

    #[test]
    fn solve_pragmatic_includes_service_duration_in_total() {
        // Problem with 2 stops, each with 30 min service duration = 1800 seconds each
        let problem = VrpProblem {
            depot: Depot { coordinates: Coordinates { lat: 50.0755, lng: 14.4378 } },
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "stop-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Customer A".to_string(),
                    coordinates: Coordinates { lat: 49.1951, lng: 16.6068 },
                    service_duration_minutes: 30, // 30 min = 1800 seconds
                    time_window: None,
                    priority: 1,
                },
                VrpStop {
                    id: "stop-2".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Customer B".to_string(),
                    coordinates: Coordinates { lat: 49.8209, lng: 18.2625 },
                    service_duration_minutes: 30, // 30 min = 1800 seconds
                    time_window: None,
                    priority: 1,
                },
            ],
            break_config: None,
        };

        // Very short travel times to isolate service duration effect
        let matrices = DistanceTimeMatrices {
            distances: vec![
                vec![0, 100, 100],
                vec![100, 0, 100],
                vec![100, 100, 0],
            ],
            // Travel times: 60 seconds between any two points
            durations: vec![
                vec![0, 60, 60],
                vec![60, 0, 60],
                vec![60, 60, 0],
            ],
            size: 3,
        };

        let solution = solve_pragmatic(
            &problem,
            &matrices,
            NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            &SolverConfig::instant(),
        ).unwrap();

        // Total service duration = 2 stops × 30 min = 60 min = 3600 seconds
        // Travel time = depot->A + A->B + B->depot = 3 × 60s = 180 seconds
        // Total expected = 3600 + 180 = 3780 seconds (63 minutes)
        
        // Assert that total duration includes at least the service time
        let min_expected_duration_seconds = 3600u64; // At least 60 min service time
        assert!(
            solution.total_duration_seconds >= min_expected_duration_seconds,
            "Total duration {} seconds should be >= {} seconds (service time)",
            solution.total_duration_seconds,
            min_expected_duration_seconds
        );

        // Also verify both stops are assigned
        assert_eq!(solution.stops.len(), 2);
    }

    #[test]
    fn solve_pragmatic_longer_service_duration_increases_total() {
        // Same setup, but with longer service duration
        let short_problem = VrpProblem {
            depot: Depot { coordinates: Coordinates { lat: 50.0755, lng: 14.4378 } },
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "stop-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Customer A".to_string(),
                    coordinates: Coordinates { lat: 49.1951, lng: 16.6068 },
                    service_duration_minutes: 15, // Short: 15 min
                    time_window: None,
                    priority: 1,
                },
            ],
            break_config: None,
        };

        let long_problem = VrpProblem {
            depot: Depot { coordinates: Coordinates { lat: 50.0755, lng: 14.4378 } },
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "stop-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Customer A".to_string(),
                    coordinates: Coordinates { lat: 49.1951, lng: 16.6068 },
                    service_duration_minutes: 60, // Long: 60 min
                    time_window: None,
                    priority: 1,
                },
            ],
            break_config: None,
        };

        let matrices = DistanceTimeMatrices {
            distances: vec![vec![0, 100], vec![100, 0]],
            durations: vec![vec![0, 60], vec![60, 0]],
            size: 2,
        };

        let short_solution = solve_pragmatic(
            &short_problem,
            &matrices,
            NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            &SolverConfig::instant(),
        ).unwrap();

        let long_solution = solve_pragmatic(
            &long_problem,
            &matrices,
            NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            &SolverConfig::instant(),
        ).unwrap();

        // Long service duration should result in longer total duration
        // Difference should be at least 45 min (60-15) = 2700 seconds
        let duration_difference = long_solution.total_duration_seconds as i64 
            - short_solution.total_duration_seconds as i64;
        
        assert!(
            duration_difference >= 2700,
            "Long service ({} sec) should be at least 45 min (2700 sec) longer than short ({} sec), but difference is {} sec",
            long_solution.total_duration_seconds,
            short_solution.total_duration_seconds,
            duration_difference
        );
    }

    #[test]
    fn solve_pragmatic_with_break_config_returns_solution() {
        let mut problem = test_problem();
        problem.break_config = Some(BreakConfig {
            earliest_time: NaiveTime::from_hms_opt(11, 30, 0).unwrap(),
            latest_time: NaiveTime::from_hms_opt(13, 0, 0).unwrap(),
            duration_minutes: 45,
        });

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
        );

        assert!(
            solution.is_ok(),
            "vrp-pragmatic should accept break config, got error: {:?}",
            solution.err()
        );
    }

    /// Verify that the solver actually PLACES a break activity in the solution
    /// when break_config is provided and a natural gap exists in the schedule.
    #[test]
    fn solve_pragmatic_with_break_config_includes_break_stop() {
        // Build a scenario with a gap between stop 1 and stop 2 that
        // falls within the break window (11:30–13:00).
        // Stop 1 scheduled at 08:00-09:00, Stop 2 scheduled at 14:00-15:00.
        // Travel times are short (10 min), so there's a natural 5h gap.
        let problem = VrpProblem {
            depot: Depot { coordinates: Coordinates { lat: 50.0755, lng: 14.4378 } },
            shift_start: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "stop-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Morning Customer".to_string(),
                    coordinates: Coordinates { lat: 49.1951, lng: 16.6068 },
                    service_duration_minutes: 60,
                    time_window: Some(super::super::StopTimeWindow {
                        start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                        end: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                        is_hard: true,
                    }),
                    priority: 1,
                },
                VrpStop {
                    id: "stop-2".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Afternoon Customer".to_string(),
                    coordinates: Coordinates { lat: 49.8209, lng: 18.2625 },
                    service_duration_minutes: 60,
                    time_window: Some(super::super::StopTimeWindow {
                        start: NaiveTime::from_hms_opt(14, 0, 0).unwrap(),
                        end: NaiveTime::from_hms_opt(14, 0, 0).unwrap(),
                        is_hard: true,
                    }),
                    priority: 1,
                },
            ],
            break_config: Some(BreakConfig {
                earliest_time: NaiveTime::from_hms_opt(11, 30, 0).unwrap(),
                latest_time: NaiveTime::from_hms_opt(13, 0, 0).unwrap(),
                duration_minutes: 45,
            }),
        };

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
        ).expect("solver should succeed with break config");

        // Both customer stops should be assigned
        let customer_stops: Vec<_> = solution.stops.iter().filter(|s| !s.customer_id.is_nil()).collect();
        assert_eq!(customer_stops.len(), 2, "both customer stops should be assigned");

        // The solution must include a break stop (Uuid::nil customer_id)
        let break_stop = solution.stops.iter().find(|s| s.customer_id.is_nil());
        assert!(
            break_stop.is_some(),
            "solver should include a break stop (nil UUID) when break_config is provided. \
            Total stops: {}, solver log: {:?}",
            solution.stops.len(),
            solution.solver_log,
        );

        // Break should fall within the configured window (11:30-13:00)
        let brk = break_stop.unwrap();
        let break_start = NaiveTime::from_hms_opt(11, 30, 0).unwrap();
        let break_end = NaiveTime::from_hms_opt(13, 0, 0).unwrap();
        assert!(
            brk.arrival_time >= break_start && brk.arrival_time <= break_end,
            "break arrival {:?} should be within window {:?}-{:?}",
            brk.arrival_time, break_start, break_end,
        );
    }

    /// Verify that the solver handles point time windows (start == end)
    /// correctly — the stop must still be assigned and arrival is at/before the window.
    #[test]
    fn solve_pragmatic_with_point_time_window_assigns_stop() {
        let problem = VrpProblem {
            depot: Depot { coordinates: Coordinates { lat: 50.0755, lng: 14.4378 } },
            shift_start: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "scheduled-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Scheduled Customer".to_string(),
                    coordinates: Coordinates { lat: 49.1951, lng: 16.6068 },
                    // Slot 10:00-11:00 → service = 60 min, arrival = exactly 10:00
                    service_duration_minutes: 60,
                    time_window: Some(super::super::StopTimeWindow {
                        start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
                        end: NaiveTime::from_hms_opt(10, 0, 0).unwrap(), // Point window
                        is_hard: true,
                    }),
                    priority: 1,
                },
            ],
            break_config: None,
        };

        // Travel time depot→stop = 600s (10 min), so vehicle can easily arrive by 10:00
        let matrices = DistanceTimeMatrices {
            distances: vec![vec![0, 10000], vec![10000, 0]],
            durations: vec![vec![0, 600], vec![600, 0]],
            size: 2,
        };

        let solution = solve_pragmatic(
            &problem,
            &matrices,
            NaiveDate::from_ymd_opt(2026, 1, 26).unwrap(),
            &SolverConfig::instant(),
        ).expect("solver should accept point time window");

        assert_eq!(solution.stops.len(), 1, "scheduled stop must be assigned");
        assert!(solution.unassigned.is_empty(), "no stops should be unassigned");

        // Arrival must be at or before 10:00
        let arrival = solution.stops[0].arrival_time;
        let window_start = NaiveTime::from_hms_opt(10, 0, 0).unwrap();
        assert!(
            arrival <= window_start,
            "arrival {} should be at or before window start {}",
            arrival.format("%H:%M:%S"),
            window_start.format("%H:%M:%S"),
        );
    }

    // ==========================================================================
    // Post-solve validation tests
    // ==========================================================================

    #[test]
    fn validate_arrival_before_window_no_warning() {
        let window = super::super::StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };
        let mut warnings = Vec::new();
        validate_arrival_vs_window(
            "s1", "Customer A",
            NaiveTime::from_hms_opt(9, 50, 0).unwrap(),
            &window, &mut warnings,
        );
        assert!(warnings.is_empty(), "No warning when arriving before window start");
    }

    #[test]
    fn validate_arrival_exactly_at_start_no_warning() {
        let window = super::super::StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };
        let mut warnings = Vec::new();
        validate_arrival_vs_window(
            "s1", "Customer A",
            NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            &window, &mut warnings,
        );
        assert!(warnings.is_empty(), "No warning when arriving exactly at window start");
    }

    #[test]
    fn validate_arrival_after_start_insufficient_buffer() {
        let window = super::super::StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };
        let mut warnings = Vec::new();
        validate_arrival_vs_window(
            "s1", "Customer A",
            NaiveTime::from_hms_opt(10, 5, 0).unwrap(), // 5 min late
            &window, &mut warnings,
        );
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].warning_type, "INSUFFICIENT_BUFFER");
        assert!(warnings[0].message.contains("Customer A"));
    }

    #[test]
    fn validate_arrival_after_end_late_arrival() {
        let window = super::super::StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };
        let mut warnings = Vec::new();
        validate_arrival_vs_window(
            "s1", "Customer A",
            NaiveTime::from_hms_opt(12, 30, 0).unwrap(), // after end
            &window, &mut warnings,
        );
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].warning_type, "LATE_ARRIVAL");
    }
}
