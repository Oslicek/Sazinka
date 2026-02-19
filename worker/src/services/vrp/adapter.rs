//! Adapter to build vrp-pragmatic inputs.

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, Timelike, Utc};
use serde_json::{json, Value};
use vrp_pragmatic::format::problem::Matrix;

use crate::services::routing::DistanceTimeMatrices;
use super::{VrpProblem, StopTimeWindow};

pub const DEFAULT_PROFILE: &str = "car";
pub const DEFAULT_VEHICLE_ID: &str = "vehicle_1";
pub const DEFAULT_VEHICLE_TYPE: &str = "vehicle";

/// Compute the average travel time (in seconds) from all other locations to `target_index`.
/// `target_index` is 0-based in the distance matrix (depot=0, stop[0]=1, etc.).
fn avg_travel_time_to(matrices: &DistanceTimeMatrices, target_index: usize) -> u64 {
    let mut sum: u64 = 0;
    let mut count: u64 = 0;
    for src in 0..matrices.size {
        if src == target_index {
            continue;
        }
        let d = matrices.duration(src, target_index);
        if d > 0 {
            sum += d as u64;
            count += 1;
        }
    }
    if count > 0 { sum / count } else { 0 }
}

/// Shift a time window start earlier by `buffer_percent` of the estimated segment duration
/// plus `buffer_fixed_minutes` of fixed time.
/// Returns a new StopTimeWindow with adjusted start.
/// The end is kept as-is (hard deadline).
fn apply_arrival_buffer(
    window: &StopTimeWindow,
    avg_segment_seconds: u64,
    buffer_percent: f64,
    buffer_fixed_minutes: f64,
) -> StopTimeWindow {
    // Skip buffer for point windows (start == end): these represent scheduled
    // visits where service must start at exactly the agreed time.
    let has_percent = buffer_percent > 0.0 && avg_segment_seconds > 0;
    let has_fixed = buffer_fixed_minutes > 0.0;
    if (!has_percent && !has_fixed) || !window.is_hard || window.start == window.end {
        return window.clone();
    }
    let percent_buffer_secs = if has_percent {
        (avg_segment_seconds as f64 * buffer_percent / 100.0).round() as i64
    } else {
        0
    };
    let fixed_buffer_secs = (buffer_fixed_minutes * 60.0).round() as i64;
    let total_buffer_secs = percent_buffer_secs + fixed_buffer_secs;
    let start_total_secs = window.start.num_seconds_from_midnight() as i64;
    let new_start_secs = (start_total_secs - total_buffer_secs).max(0) as u32;
    StopTimeWindow {
        start: NaiveTime::from_num_seconds_from_midnight_opt(new_start_secs, 0)
            .unwrap_or(window.start),
        end: window.end,
        is_hard: window.is_hard,
    }
}

/// Build pragmatic problem JSON with buffer support.
/// `matrices`: if provided, used to estimate segment durations for buffer calculation.
/// `buffer_percent`: percentage of segment duration to arrive early (0 = no buffer).
/// `buffer_fixed_minutes`: fixed minutes to arrive early on top of percentage (0 = no fixed buffer).
pub fn build_pragmatic_problem_with_buffer(
    problem: &VrpProblem,
    date: NaiveDate,
    matrices: Option<&DistanceTimeMatrices>,
    buffer_percent: f64,
    buffer_fixed_minutes: f64,
) -> Value {
    let jobs: Vec<Value> = problem
        .stops
        .iter()
        .enumerate()
        .map(|(index, stop)| {
            let place = json!({
                "location": { "index": index + 1 },
                "duration": (stop.service_duration_minutes as i64) * 60,
            });

            let place = match &stop.time_window {
                Some(window) => {
                    // Apply buffer if matrices are available and any buffer > 0
                    let adjusted = if let Some(m) = matrices {
                        if (buffer_percent > 0.0 || buffer_fixed_minutes > 0.0) && window.is_hard {
                            let avg_secs = avg_travel_time_to(m, index + 1);
                            apply_arrival_buffer(window, avg_secs, buffer_percent, buffer_fixed_minutes)
                        } else {
                            window.clone()
                        }
                    } else {
                        window.clone()
                    };
                    add_time_window(place, date, &adjusted)
                }
                None => place,
            };

            json!({
                "id": stop.id,
                "services": [{
                    "places": [place]
                }]
            })
        })
        .collect();

    json!({
        "plan": {
            "jobs": jobs
        },
        "fleet": {
            "vehicles": [{
                "typeId": DEFAULT_VEHICLE_TYPE,
                "vehicleIds": [DEFAULT_VEHICLE_ID],
                "profile": { "matrix": DEFAULT_PROFILE },
                "costs": {
                    "fixed": 0.0,
                    "distance": 1.0,
                    "time": 1.0
                },
                "shifts": [{
                    "start": {
                        "earliest": format_rfc3339(date, problem.shift_start),
                        "location": { "index": 0 }
                    },
                    "end": {
                        "latest": format_rfc3339(date, problem.shift_end),
                        "location": { "index": 0 }
                    },
                    "breaks": if let Some(ref break_cfg) = problem.break_config {
                        vec![json!({
                            "time": {
                                "earliest": format_rfc3339(date, break_cfg.earliest_time),
                                "latest": format_rfc3339(date, break_cfg.latest_time)
                            },
                            "duration": (break_cfg.duration_minutes as i64) * 60
                        })]
                    } else {
                        vec![]
                    }
                }],
                "capacity": [1000]
            }],
            "profiles": [{
                "name": DEFAULT_PROFILE
            }]
        }
    })
}

/// Build pragmatic routing matrix from distance/time matrices.
pub fn build_pragmatic_matrix(
    matrices: &DistanceTimeMatrices,
    profile: &str,
) -> Matrix {
    let size = matrices.size;
    let mut travel_times = Vec::with_capacity(size * size);
    let mut distances = Vec::with_capacity(size * size);

    for i in 0..size {
        for j in 0..size {
            travel_times.push(matrices.duration(i, j) as i64);
            distances.push(matrices.distance(i, j) as i64);
        }
    }

    Matrix {
        profile: Some(profile.to_string()),
        timestamp: None,
        travel_times,
        distances,
        error_codes: None,
    }
}

fn add_time_window(base: Value, date: NaiveDate, window: &StopTimeWindow) -> Value {
    let start = format_rfc3339(date, window.start);
    let end = format_rfc3339(date, window.end);

    json!({
        "location": base["location"].clone(),
        "duration": base["duration"].clone(),
        "times": [[start, end]]
    })
}

fn format_rfc3339(date: NaiveDate, time: NaiveTime) -> String {
    let naive = NaiveDateTime::new(date, time);
    DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use uuid::Uuid;
    use vrp_pragmatic::format::problem::{Problem, VehicleBreak};

    use crate::types::Coordinates;
    use crate::services::routing::DistanceTimeMatrices;
    use super::super::{BreakConfig, Depot, VrpStop, VrpProblem};

    fn test_problem() -> VrpProblem {
        VrpProblem {
            depot: Depot {
                coordinates: Coordinates { lat: 50.0755, lng: 14.4378 },
            },
            shift_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "stop-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Customer A".to_string(),
                    coordinates: Coordinates { lat: 49.1951, lng: 16.6068 },
                    service_duration_minutes: 30,
                    time_window: Some(StopTimeWindow {
                        start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
                        end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
                        is_hard: true,
                    }),
                    priority: 1,
                },
                VrpStop {
                    id: "stop-2".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Customer B".to_string(),
                    coordinates: Coordinates { lat: 49.8209, lng: 18.2625 },
                    service_duration_minutes: 20,
                    time_window: None,
                    priority: 1,
                },
            ],
            break_config: None,
        }
    }

    #[test]
    fn build_pragmatic_problem_contains_jobs_and_shift_times() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 26).unwrap();
        let problem = test_problem();

        let json = build_pragmatic_problem(&problem, date);

        let jobs = json["plan"]["jobs"].as_array().unwrap();
        assert_eq!(jobs.len(), 2);
        assert_eq!(jobs[0]["id"], "stop-1");
        assert_eq!(jobs[1]["id"], "stop-2");

        let vehicle = &json["fleet"]["vehicles"][0];
        assert_eq!(vehicle["shifts"][0]["start"]["location"]["index"], 0);
        assert_eq!(vehicle["shifts"][0]["end"]["location"]["index"], 0);
    }

    #[test]
    fn build_pragmatic_problem_encodes_service_duration_and_times() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 26).unwrap();
        let problem = test_problem();

        let json = build_pragmatic_problem(&problem, date);
        let place = &json["plan"]["jobs"][0]["services"][0]["places"][0];

        assert_eq!(place["duration"], 1800);
        let times = place["times"].as_array().unwrap();
        assert_eq!(times.len(), 1);
        assert!(times[0][0].as_str().unwrap().starts_with("2026-01-26T10:00:00Z"));
        assert!(times[0][1].as_str().unwrap().starts_with("2026-01-26T12:00:00Z"));
    }

    #[test]
    fn build_pragmatic_problem_is_valid_for_deserialize() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 26).unwrap();
        let problem = test_problem();

        let json = build_pragmatic_problem(&problem, date);
        let parsed: Problem = serde_json::from_value(json).unwrap();

        assert_eq!(parsed.plan.jobs.len(), 2);
        assert_eq!(parsed.fleet.vehicles.len(), 1);
    }

    #[test]
    fn build_pragmatic_matrix_flattens_row_major() {
        let matrices = DistanceTimeMatrices {
            distances: vec![vec![0, 5], vec![7, 0]],
            durations: vec![vec![0, 10], vec![20, 0]],
            size: 2,
        };

        let matrix = build_pragmatic_matrix(&matrices, "car");

        assert_eq!(matrix.distances, vec![0, 5, 7, 0]);
        assert_eq!(matrix.travel_times, vec![0, 10, 20, 0]);
        assert_eq!(matrix.profile.as_deref(), Some("car"));
    }

    // ==========================================================================
    // Buffer logic tests
    // ==========================================================================

    #[test]
    fn avg_travel_time_to_computes_correctly() {
        // 3 locations: depot(0), stop-1(1), stop-2(2)
        let matrices = DistanceTimeMatrices {
            distances: vec![
                vec![0, 100, 200],
                vec![100, 0, 150],
                vec![200, 150, 0],
            ],
            durations: vec![
                vec![0, 600, 1200],  // depot->s1=600s, depot->s2=1200s
                vec![600, 0, 900],   // s1->s2=900s
                vec![1200, 900, 0],
            ],
            size: 3,
        };

        // Avg travel time to stop-1 (index=1): from depot(600) + from stop-2(900) = 1500/2 = 750
        assert_eq!(avg_travel_time_to(&matrices, 1), 750);
        // Avg travel time to stop-2 (index=2): from depot(1200) + from stop-1(900) = 2100/2 = 1050
        assert_eq!(avg_travel_time_to(&matrices, 2), 1050);
    }

    #[test]
    fn apply_arrival_buffer_shifts_start_earlier() {
        let window = StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };

        // 10% of 600s segment = 60s buffer (no fixed)
        let adjusted = apply_arrival_buffer(&window, 600, 10.0, 0.0);
        assert_eq!(adjusted.start, NaiveTime::from_hms_opt(9, 59, 0).unwrap());
        assert_eq!(adjusted.end, NaiveTime::from_hms_opt(12, 0, 0).unwrap());
    }

    #[test]
    fn apply_arrival_buffer_with_fixed_minutes() {
        let window = StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };

        // 10% of 600s = 60s + 5 min fixed = 360s → total 360s = 6 min
        let adjusted = apply_arrival_buffer(&window, 600, 10.0, 5.0);
        assert_eq!(adjusted.start, NaiveTime::from_hms_opt(9, 54, 0).unwrap());
        assert_eq!(adjusted.end, NaiveTime::from_hms_opt(12, 0, 0).unwrap());
    }

    #[test]
    fn apply_arrival_buffer_fixed_only() {
        let window = StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };

        // 0% + 10 min fixed = 600s
        let adjusted = apply_arrival_buffer(&window, 600, 0.0, 10.0);
        assert_eq!(adjusted.start, NaiveTime::from_hms_opt(9, 50, 0).unwrap());
        assert_eq!(adjusted.end, NaiveTime::from_hms_opt(12, 0, 0).unwrap());
    }

    #[test]
    fn apply_arrival_buffer_does_not_go_before_midnight() {
        let window = StopTimeWindow {
            start: NaiveTime::from_hms_opt(0, 0, 30).unwrap(),
            end: NaiveTime::from_hms_opt(1, 0, 0).unwrap(),
            is_hard: true,
        };

        // 50% of 3600s = 1800s buffer, but start is only 30s from midnight
        let adjusted = apply_arrival_buffer(&window, 3600, 50.0, 0.0);
        assert_eq!(adjusted.start, NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    }

    #[test]
    fn apply_arrival_buffer_noop_for_soft_window() {
        let window = StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: false,
        };

        let adjusted = apply_arrival_buffer(&window, 600, 10.0, 0.0);
        // Soft windows are not shifted
        assert_eq!(adjusted.start, window.start);
    }

    #[test]
    fn apply_arrival_buffer_noop_for_zero_both() {
        let window = StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(12, 0, 0).unwrap(),
            is_hard: true,
        };

        let adjusted = apply_arrival_buffer(&window, 600, 0.0, 0.0);
        assert_eq!(adjusted.start, window.start);
    }

    #[test]
    fn build_pragmatic_problem_with_buffer_shifts_hard_windows() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 26).unwrap();
        let problem = test_problem();

        // 3 locations: depot(0), stop-1(1), stop-2(2)
        let matrices = DistanceTimeMatrices {
            distances: vec![
                vec![0, 100000, 200000],
                vec![100000, 0, 150000],
                vec![200000, 150000, 0],
            ],
            durations: vec![
                vec![0, 3600, 7200],   // depot->s1=3600s(1h), depot->s2=7200s(2h)
                vec![3600, 0, 5400],   // s1->s2=5400s(1.5h)
                vec![7200, 5400, 0],
            ],
            size: 3,
        };

        // 10% buffer: avg to stop-1 = (3600+5400)/2=4500s, 10% = 450s = 7min30s
        // Original window: 10:00-12:00 → Shifted to 09:52:30-12:00
        let json = build_pragmatic_problem_with_buffer(&problem, date, Some(&matrices), 10.0, 0.0);
        let place = &json["plan"]["jobs"][0]["services"][0]["places"][0];
        let times = place["times"].as_array().unwrap();
        let start_str = times[0][0].as_str().unwrap();
        assert!(start_str.starts_with("2026-01-26T09:52:30Z"), "Expected shifted start, got: {}", start_str);
        // End should be unchanged
        let end_str = times[0][1].as_str().unwrap();
        assert!(end_str.starts_with("2026-01-26T12:00:00Z"));
    }

    #[test]
    fn apply_arrival_buffer_noop_for_point_window() {
        // Point windows (start == end) represent scheduled visits;
        // buffer must NOT shift them.
        let window = StopTimeWindow {
            start: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            end: NaiveTime::from_hms_opt(10, 0, 0).unwrap(),
            is_hard: true,
        };

        let adjusted = apply_arrival_buffer(&window, 3600, 10.0, 5.0);
        // Must remain unchanged despite non-zero buffer
        assert_eq!(adjusted.start, NaiveTime::from_hms_opt(10, 0, 0).unwrap());
        assert_eq!(adjusted.end, NaiveTime::from_hms_opt(10, 0, 0).unwrap());
    }

    #[test]
    fn build_pragmatic_problem_without_buffer_unchanged() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 26).unwrap();
        let problem = test_problem();

        // No buffer — original function
        let json = build_pragmatic_problem(&problem, date);
        let place = &json["plan"]["jobs"][0]["services"][0]["places"][0];
        let times = place["times"].as_array().unwrap();
        let start_str = times[0][0].as_str().unwrap();
        assert!(start_str.starts_with("2026-01-26T10:00:00Z"));
    }

    /// Verify that a point time window (start == end) serializes correctly
    /// and is accepted by the vrp-pragmatic deserializer.
    /// This is how we model scheduled visits: arrival must be exactly at slot start.
    #[test]
    fn build_pragmatic_problem_with_point_time_window_is_valid() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 26).unwrap();
        let problem = VrpProblem {
            depot: Depot {
                coordinates: Coordinates { lat: 50.0755, lng: 14.4378 },
            },
            shift_start: NaiveTime::from_hms_opt(7, 0, 0).unwrap(),
            shift_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            stops: vec![
                VrpStop {
                    id: "scheduled-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Scheduled Customer".to_string(),
                    coordinates: Coordinates { lat: 49.1951, lng: 16.6068 },
                    // Service = slot length (08:00-09:00 = 60 min)
                    service_duration_minutes: 60,
                    // Point window: arrival must be at 08:00
                    time_window: Some(StopTimeWindow {
                        start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                        end: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                        is_hard: true,
                    }),
                    priority: 1,
                },
                VrpStop {
                    id: "unscheduled-1".to_string(),
                    customer_id: Uuid::new_v4(),
                    customer_name: "Unscheduled Customer".to_string(),
                    coordinates: Coordinates { lat: 49.8209, lng: 18.2625 },
                    // Default service duration from settings
                    service_duration_minutes: 30,
                    time_window: None,
                    priority: 1,
                },
            ],
            break_config: None,
        };

        let json = build_pragmatic_problem(&problem, date);

        // Scheduled customer: duration = 60min = 3600s, point window [08:00, 08:00]
        let place_scheduled = &json["plan"]["jobs"][0]["services"][0]["places"][0];
        assert_eq!(place_scheduled["duration"], 3600);
        let times = place_scheduled["times"].as_array().unwrap();
        assert_eq!(times[0][0].as_str().unwrap(), "2026-01-26T08:00:00Z");
        assert_eq!(times[0][1].as_str().unwrap(), "2026-01-26T08:00:00Z");

        // Unscheduled customer: duration = 30min = 1800s, no window
        let place_unscheduled = &json["plan"]["jobs"][1]["services"][0]["places"][0];
        assert_eq!(place_unscheduled["duration"], 1800);
        assert!(place_unscheduled["times"].is_null());

        // Must deserialize without errors
        let parsed: Problem = serde_json::from_value(json).unwrap();
        assert_eq!(parsed.plan.jobs.len(), 2);
    }

    #[test]
    fn build_pragmatic_problem_with_break_deserializes_vehicle_break() {
        let date = NaiveDate::from_ymd_opt(2026, 1, 26).unwrap();
        let mut problem = test_problem();
        problem.break_config = Some(BreakConfig {
            earliest_time: NaiveTime::from_hms_opt(11, 30, 0).unwrap(),
            latest_time: NaiveTime::from_hms_opt(13, 0, 0).unwrap(),
            duration_minutes: 45,
        });

        let json = build_pragmatic_problem(&problem, date);
        let parsed: Problem = serde_json::from_value(json).unwrap();

        let breaks = parsed.fleet.vehicles[0].shifts[0]
            .breaks
            .as_ref()
            .expect("expected one configured break");
        assert_eq!(breaks.len(), 1);
        match &breaks[0] {
            VehicleBreak::Required { duration, .. } => {
                assert_eq!(*duration, 45.0 * 60.0);
            }
            _ => panic!("expected required break variant"),
        }
    }
}
