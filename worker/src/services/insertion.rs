#![allow(dead_code)]
//! Shared insertion heuristics for route and slot planning.

use chrono::{NaiveTime, Timelike};

use crate::services::routing::DistanceTimeMatrices;

#[derive(Debug, Clone)]
pub struct StopMeta {
    pub name: String,
    pub arrival_time: Option<NaiveTime>,
    pub departure_time: Option<NaiveTime>,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
    /// Service duration at this stop in minutes (used for departure estimation)
    pub service_duration_minutes: i32,
}

#[derive(Debug, Clone)]
pub struct InsertionPositionResult {
    pub insert_after_index: i32,
    pub insert_after_name: String,
    pub insert_before_name: String,
    pub delta_km: f64,
    pub delta_min: f64,
    pub estimated_arrival: NaiveTime,
    pub estimated_departure: NaiveTime,
    pub status: String,
    pub conflict_reason: Option<String>,
    pub slack_before_minutes: Option<i32>,
    pub slack_after_minutes: Option<i32>,
}

fn add_minutes(time: NaiveTime, minutes: i64) -> NaiveTime {
    let total_secs = time.num_seconds_from_midnight() as i64 + minutes * 60;
    let clamped = total_secs.clamp(0, 24 * 60 * 60 - 1) as u32;
    NaiveTime::from_num_seconds_from_midnight_opt(clamped, 0)
        .unwrap_or_else(|| NaiveTime::from_hms_opt(23, 59, 59).expect("valid time"))
}

fn diff_minutes(a: NaiveTime, b: NaiveTime) -> i32 {
    (a - b).num_minutes() as i32
}

/// Round a time UP to the next quarter-hour boundary (00, 15, 30, 45).
/// If already exactly on a quarter-hour, keep as-is.
fn ceil_quarter_hour(t: NaiveTime) -> NaiveTime {
    let total_mins = (t.num_seconds_from_midnight() + 59) / 60; // ceil to minute
    let remainder = total_mins % 15;
    if remainder == 0 {
        NaiveTime::from_hms_opt(total_mins / 60, total_mins % 60, 0).unwrap_or(t)
    } else {
        let rounded = total_mins + (15 - remainder);
        let clamped = rounded.min(23 * 60 + 45);
        NaiveTime::from_hms_opt(clamped / 60, clamped % 60, 0).unwrap_or(t)
    }
}

/// Shared insertion calculation used by:
/// - route.insertion.calculate
/// - slots.suggest.v2
pub fn calculate_insertion_positions(
    matrices: &DistanceTimeMatrices,
    candidate_idx: usize,
    depot_idx: usize,
    stop_indices: &[usize],
    stops_meta: &[StopMeta],
    candidate_service_minutes: i32,
    workday_start: NaiveTime,
    workday_end: NaiveTime,
) -> Vec<InsertionPositionResult> {
    if stop_indices.len() != stops_meta.len() {
        return vec![];
    }

    let num_stops = stop_indices.len();
    let mut positions: Vec<InsertionPositionResult> = Vec::with_capacity(num_stops + 1);

    for insert_idx in 0..=num_stops {
        let from_matrix_idx = if insert_idx == 0 { depot_idx } else { stop_indices[insert_idx - 1] };
        let to_matrix_idx = if insert_idx >= num_stops { depot_idx } else { stop_indices[insert_idx] };

        let current_distance_m = matrices.distances[from_matrix_idx][to_matrix_idx] as f64;
        let current_time_s = matrices.durations[from_matrix_idx][to_matrix_idx] as f64;

        let dist_from_to_candidate = matrices.distances[from_matrix_idx][candidate_idx] as f64;
        let dist_candidate_to_next = matrices.distances[candidate_idx][to_matrix_idx] as f64;
        let time_from_to_candidate = matrices.durations[from_matrix_idx][candidate_idx] as f64;
        let time_candidate_to_next = matrices.durations[candidate_idx][to_matrix_idx] as f64;

        let delta_km = (dist_from_to_candidate + dist_candidate_to_next - current_distance_m) / 1000.0;
        let delta_min =
            (time_from_to_candidate + time_candidate_to_next - current_time_s) / 60.0 + candidate_service_minutes as f64;

        let insert_after_name = if insert_idx == 0 {
            "Depo".to_string()
        } else {
            stops_meta[insert_idx - 1].name.clone()
        };
        let insert_before_name = if insert_idx >= num_stops {
            "Konec trasy".to_string()
        } else {
            stops_meta[insert_idx].name.clone()
        };

        let travel_from_min = (time_from_to_candidate / 60.0).round() as i64;
        let travel_to_next_min = (time_candidate_to_next / 60.0).round() as i64;

        let prev_departure = if insert_idx == 0 {
            workday_start
        } else {
            let meta = &stops_meta[insert_idx - 1];
            // Priority: departure_time (from optimization) is most accurate
            meta.departure_time.unwrap_or_else(|| {
                // Estimate: crew arrives at time_window_start (or arrival_time),
                // works for service_duration_minutes, then departs
                meta.time_window_start
                    .or(meta.arrival_time)
                    .map(|t| add_minutes(t, meta.service_duration_minutes as i64))
                    .unwrap_or(workday_start)
            })
        };

        let earliest_start = ceil_quarter_hour(add_minutes(prev_departure, travel_from_min));
        let latest_start = if insert_idx >= num_stops {
            // Last position: no next stop, constrained only by workday end
            add_minutes(workday_end, -(candidate_service_minutes as i64))
        } else {
            let next_meta = &stops_meta[insert_idx];
            // Use arrival_time (optimized) or time_window_end (latest acceptable arrival)
            // as the deadline by which we must finish candidate service + travel to next stop
            let next_deadline = next_meta.arrival_time
                .or(next_meta.time_window_end)
                .unwrap_or(workday_end);
            add_minutes(next_deadline, -(candidate_service_minutes as i64 + travel_to_next_min))
        };

        let estimated_arrival = earliest_start;
        let estimated_departure = add_minutes(estimated_arrival, candidate_service_minutes as i64);
        let slack_before = Some(0);
        let slack_after = Some(diff_minutes(latest_start, estimated_arrival));

        let status = if latest_start < earliest_start {
            "conflict"
        } else if slack_after.unwrap_or(0) < 15 {
            "tight"
        } else {
            "ok"
        };

        let conflict_reason = if latest_start < earliest_start {
            Some("Časový konflikt s okolními zastávkami".to_string())
        } else if estimated_arrival < workday_start || estimated_departure > workday_end {
            Some("Mimo pracovní dobu".to_string())
        } else {
            None
        };

        positions.push(InsertionPositionResult {
            insert_after_index: insert_idx as i32 - 1,
            insert_after_name,
            insert_before_name,
            delta_km,
            delta_min,
            estimated_arrival,
            estimated_departure,
            status: status.to_string(),
            conflict_reason,
            slack_before_minutes: slack_before,
            slack_after_minutes: slack_after,
        });
    }

    positions.sort_by(|a, b| a.delta_min.partial_cmp(&b.delta_min).unwrap_or(std::cmp::Ordering::Equal));
    positions
}

pub fn status_from_delta(delta_min: f64) -> &'static str {
    if delta_min < 15.0 {
        "ok"
    } else if delta_min < 30.0 {
        "tight"
    } else {
        "conflict"
    }
}

pub fn time_overlap_minutes(
    start_a: NaiveTime,
    end_a: NaiveTime,
    start_b: NaiveTime,
    end_b: NaiveTime,
) -> i32 {
    let a0 = start_a.num_seconds_from_midnight() as i32;
    let a1 = end_a.num_seconds_from_midnight() as i32;
    let b0 = start_b.num_seconds_from_midnight() as i32;
    let b1 = end_b.num_seconds_from_midnight() as i32;
    ((a1.min(b1) - a0.max(b0)).max(0)) / 60
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::routing::DistanceTimeMatrices;

    fn make_time(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).expect("valid time")
    }

    /// Build a symmetric NxN matrix with given pairwise durations (seconds) and distances (meters).
    /// `entries`: Vec of (from, to, distance_m, duration_s) - auto-mirrors to (to, from).
    fn build_matrices(n: usize, entries: &[(usize, usize, u64, u64)]) -> DistanceTimeMatrices {
        let mut distances = vec![vec![0u64; n]; n];
        let mut durations = vec![vec![0u64; n]; n];
        for &(i, j, d, t) in entries {
            distances[i][j] = d;
            distances[j][i] = d;
            durations[i][j] = t;
            durations[j][i] = t;
        }
        DistanceTimeMatrices {
            distances,
            durations,
            size: n,
        }
    }

    // ── time_overlap_minutes ──

    #[test]
    fn test_time_overlap_full() {
        // A=[09:00-10:00], B=[09:00-10:00] → 60 min overlap
        assert_eq!(
            time_overlap_minutes(make_time(9, 0), make_time(10, 0), make_time(9, 0), make_time(10, 0)),
            60
        );
    }

    #[test]
    fn test_time_overlap_partial() {
        // A=[09:00-10:00], B=[09:30-10:30] → 30 min overlap
        assert_eq!(
            time_overlap_minutes(make_time(9, 0), make_time(10, 0), make_time(9, 30), make_time(10, 30)),
            30
        );
    }

    #[test]
    fn test_time_overlap_none() {
        // A=[09:00-10:00], B=[10:30-11:30] → 0
        assert_eq!(
            time_overlap_minutes(make_time(9, 0), make_time(10, 0), make_time(10, 30), make_time(11, 30)),
            0
        );
    }

    #[test]
    fn test_time_overlap_adjacent() {
        // A=[09:00-10:00], B=[10:00-11:00] → 0
        assert_eq!(
            time_overlap_minutes(make_time(9, 0), make_time(10, 0), make_time(10, 0), make_time(11, 0)),
            0
        );
    }

    // ── status_from_delta ──

    #[test]
    fn test_status_from_delta() {
        assert_eq!(status_from_delta(5.0), "ok");
        assert_eq!(status_from_delta(14.9), "ok");
        assert_eq!(status_from_delta(15.0), "tight");
        assert_eq!(status_from_delta(29.9), "tight");
        assert_eq!(status_from_delta(30.0), "conflict");
        assert_eq!(status_from_delta(60.0), "conflict");
    }

    // ── calculate_insertion_positions ──

    #[test]
    fn test_mismatched_indices_meta_returns_empty() {
        let matrices = build_matrices(2, &[(0, 1, 5000, 600)]);
        let result = calculate_insertion_positions(
            &matrices,
            0, 1,
            &[2], // 1 index
            &[],  // 0 metas → mismatch
            30,
            make_time(8, 0),
            make_time(16, 0),
        );
        assert!(result.is_empty());
    }

    #[test]
    fn test_empty_route_single_position() {
        // Locations: candidate(0), depot(1)
        // Depot <-> candidate: 5 km, 10 min
        let matrices = build_matrices(2, &[(0, 1, 5000, 600)]);
        let positions = calculate_insertion_positions(
            &matrices,
            0, 1,
            &[],  // no existing stops
            &[],
            30,   // 30 min service
            make_time(8, 0),
            make_time(16, 0),
        );
        assert_eq!(positions.len(), 1);
        let p = &positions[0];
        assert_eq!(p.insert_after_name, "Depo");
        assert_eq!(p.insert_before_name, "Konec trasy");
        // delta_km = (5000 + 5000 - 0) / 1000 = 10.0
        assert!((p.delta_km - 10.0).abs() < 0.1);
        assert_eq!(p.status, "ok");
    }

    #[test]
    fn test_single_stop_two_positions() {
        // Locations: candidate(0), depot(1), stopA(2)
        // depot<->stopA: 3km/5min, depot<->candidate: 5km/10min, candidate<->stopA: 2km/3min
        let matrices = build_matrices(3, &[
            (1, 2, 3000, 300),  // depot <-> stopA
            (0, 1, 5000, 600),  // candidate <-> depot
            (0, 2, 2000, 180),  // candidate <-> stopA
        ]);
        let stops_meta = vec![StopMeta {
            name: "Stop A".into(),
            arrival_time: Some(make_time(9, 0)),
            departure_time: Some(make_time(9, 30)),
            time_window_start: Some(make_time(9, 0)),
            time_window_end: Some(make_time(9, 30)),
            service_duration_minutes: 30,
        }];
        let positions = calculate_insertion_positions(
            &matrices,
            0, 1,
            &[2],
            &stops_meta,
            30,
            make_time(8, 0),
            make_time(16, 0),
        );
        // 2 positions: before stopA (depot→candidate→stopA) and after stopA (stopA→candidate→depot)
        assert_eq!(positions.len(), 2);
        // Position names should be correct
        let names: Vec<(&str, &str)> = positions
            .iter()
            .map(|p| (p.insert_after_name.as_str(), p.insert_before_name.as_str()))
            .collect();
        assert!(names.contains(&("Depo", "Stop A")));
        assert!(names.contains(&("Stop A", "Konec trasy")));
    }

    #[test]
    fn test_positions_sorted_by_delta_min() {
        // 3 stops, candidate favours position between stop B and stop C (shortest detour)
        // Locations: candidate(0), depot(1), A(2), B(3), C(4)
        let matrices = build_matrices(5, &[
            (1, 2, 3000, 300),   // depot <-> A
            (2, 3, 3000, 300),   // A <-> B
            (3, 4, 3000, 300),   // B <-> C
            (4, 1, 3000, 300),   // C <-> depot
            (0, 1, 10000, 1200), // candidate <-> depot (far)
            (0, 2, 8000, 900),   // candidate <-> A (medium)
            (0, 3, 1000, 60),    // candidate <-> B (close!)
            (0, 4, 1500, 120),   // candidate <-> C (close)
        ]);
        let stops_meta = vec![
            StopMeta {
                name: "A".into(),
                arrival_time: Some(make_time(9, 0)),
                departure_time: Some(make_time(9, 30)),
                time_window_start: None,
                time_window_end: None,
                service_duration_minutes: 30,
            },
            StopMeta {
                name: "B".into(),
                arrival_time: Some(make_time(10, 0)),
                departure_time: Some(make_time(10, 30)),
                time_window_start: None,
                time_window_end: None,
                service_duration_minutes: 30,
            },
            StopMeta {
                name: "C".into(),
                arrival_time: Some(make_time(11, 0)),
                departure_time: Some(make_time(11, 30)),
                time_window_start: None,
                time_window_end: None,
                service_duration_minutes: 30,
            },
        ];
        let positions = calculate_insertion_positions(
            &matrices,
            0, 1,
            &[2, 3, 4],
            &stops_meta,
            30,
            make_time(8, 0),
            make_time(16, 0),
        );
        assert_eq!(positions.len(), 4); // 3 stops + 1
        // First result should have the lowest delta_min
        for i in 1..positions.len() {
            assert!(positions[i - 1].delta_min <= positions[i].delta_min,
                "Not sorted: {} > {}", positions[i - 1].delta_min, positions[i].delta_min);
        }
    }

    #[test]
    fn test_conflict_when_schedule_too_tight() {
        // Candidate(0), Depot(1), StopA(2) — stopA at 08:20, travel to candidate 15min
        // With 30min service, earliest_start=08:20+15=08:35, need to return by stop departure
        // StopB(3) starts 08:40 — not enough time for 30min service + 10min travel
        let matrices = build_matrices(4, &[
            (1, 2, 3000, 300),  // depot <-> A: 5 min
            (2, 3, 3000, 300),  // A <-> B: 5 min
            (3, 1, 3000, 300),  // B <-> depot: 5 min
            (0, 1, 5000, 600),  // candidate <-> depot: 10 min
            (0, 2, 8000, 900),  // candidate <-> A: 15 min
            (0, 3, 6000, 600),  // candidate <-> B: 10 min
        ]);
        let stops_meta = vec![
            StopMeta {
                name: "A".into(),
                arrival_time: Some(make_time(8, 10)),
                departure_time: Some(make_time(8, 20)),
                time_window_start: None,
                time_window_end: None,
                service_duration_minutes: 30,
            },
            StopMeta {
                name: "B".into(),
                arrival_time: Some(make_time(8, 40)),
                departure_time: Some(make_time(8, 50)),
                time_window_start: None,
                time_window_end: None,
                service_duration_minutes: 30,
            },
        ];
        let positions = calculate_insertion_positions(
            &matrices,
            0, 1,
            &[2, 3],
            &stops_meta,
            30,
            make_time(8, 0),
            make_time(16, 0),
        );
        // The position between A and B should be "conflict" — only 20min gap for 30min service + travel
        let between = positions.iter().find(|p| p.insert_after_name == "A" && p.insert_before_name == "B");
        assert!(between.is_some(), "Position between A and B should exist");
        assert_eq!(between.unwrap().status, "conflict");
    }
}

