//! Sequential schedule computation for route ETA/ETD recalculation.
//!
//! Given an ordered list of stops, depot location, and a distance/time matrix,
//! this module walks the route sequentially and computes arrival/departure times
//! for each stop. This is the "quick recalc" used after inserting a candidate
//! into the route — it does NOT re-optimise the order, just recomputes times.

use chrono::{NaiveTime, Timelike};

/// Input for sequential schedule computation.
#[derive(Debug, Clone)]
pub struct ScheduleInput {
    /// Index of the depot in the matrix (always 0 by convention).
    pub depot_matrix_idx: usize,
    /// Ordered stop descriptors.
    pub stops: Vec<ScheduleStop>,
    /// Matrix indices for each stop (parallel to `stops`).
    pub stop_matrix_indices: Vec<usize>,
    /// Working day start (departure from depot).
    pub workday_start: NaiveTime,
    /// Default service duration for customer stops without an explicit value.
    pub default_service_minutes: i32,
}

/// A single stop descriptor fed into the schedule computation.
#[derive(Debug, Clone)]
pub struct ScheduleStop {
    pub stop_type: StopType,
    /// Agreed/scheduled earliest arrival (type-1 slot).
    pub scheduled_time_start: Option<NaiveTime>,
    /// Agreed/scheduled latest departure (type-1 slot).
    pub scheduled_time_end: Option<NaiveTime>,
    /// Explicit per-stop service duration. Falls back to `default_service_minutes`.
    pub service_duration_minutes: Option<i32>,
    /// For break stops only.
    pub break_duration_minutes: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopType {
    Customer,
    Break,
}

/// Result of the sequential schedule computation.
#[derive(Debug, Clone)]
pub struct ScheduleResult {
    /// Per-stop computed schedule (parallel to input `stops`).
    pub stops: Vec<ComputedStopSchedule>,
    /// Travel distance from last stop back to depot (km).
    pub return_to_depot_distance_km: f64,
    /// Travel duration from last stop back to depot (minutes).
    pub return_to_depot_duration_minutes: i32,
    /// Total route distance including return (km).
    pub total_distance_km: f64,
    /// Total travel time (minutes, NOT including service/break time).
    pub total_travel_minutes: i32,
    /// Total service/break time (minutes).
    pub total_service_minutes: i32,
}

/// Computed arrival/departure for a single stop.
#[derive(Debug, Clone)]
pub struct ComputedStopSchedule {
    pub estimated_arrival: NaiveTime,
    pub estimated_departure: NaiveTime,
    pub distance_from_previous_km: f64,
    pub duration_from_previous_minutes: i32,
    pub service_duration_minutes: i32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn add_minutes(time: NaiveTime, minutes: i32) -> NaiveTime {
    let total_secs = time.num_seconds_from_midnight() as i64 + minutes as i64 * 60;
    let clamped = total_secs.clamp(0, 24 * 60 * 60 - 1) as u32;
    NaiveTime::from_num_seconds_from_midnight_opt(clamped, 0)
        .unwrap_or_else(|| NaiveTime::from_hms_opt(23, 59, 59).expect("valid time"))
}

fn time_to_minutes(t: NaiveTime) -> i32 {
    (t.num_seconds_from_midnight() / 60) as i32
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/// Compute a sequential schedule for the given route.
///
/// Matrix layout: positions correspond to `depot_matrix_idx` (depot) and
/// `stop_matrix_indices[i]` (stop i). Distances are in **meters**, durations
/// in **seconds** — matching `DistanceTimeMatrices` from `routing`.
pub fn compute_sequential_schedule(
    input: &ScheduleInput,
    distance_matrix: &[Vec<u64>],
    duration_matrix: &[Vec<u64>],
) -> ScheduleResult {
    let n = input.stops.len();
    let mut result_stops: Vec<ComputedStopSchedule> = Vec::with_capacity(n);

    let mut cursor = input.workday_start;
    let mut total_distance_m: u64 = 0;
    let mut total_travel_seconds: u64 = 0;
    let mut total_service_min: i32 = 0;

    let mut prev_matrix_idx = input.depot_matrix_idx;

    for i in 0..n {
        let stop = &input.stops[i];
        let stop_mx = input.stop_matrix_indices[i];

        // Travel leg from previous location to this stop.
        let travel_dist_m = distance_matrix[prev_matrix_idx][stop_mx];
        let travel_dur_s = duration_matrix[prev_matrix_idx][stop_mx];
        let travel_min = (travel_dur_s as f64 / 60.0).ceil() as i32;

        let earliest_arrival = add_minutes(cursor, travel_min);

        // If there is a scheduled (agreed) start time and it is later than
        // our earliest possible arrival, we wait until the scheduled time.
        let arrival = match stop.scheduled_time_start {
            Some(sched) if sched > earliest_arrival => sched,
            _ => earliest_arrival,
        };

        // Service duration for this stop.
        let service_min = match stop.stop_type {
            StopType::Break => stop.break_duration_minutes.unwrap_or(30),
            StopType::Customer => {
                // 1. Explicit per-stop value
                // 2. Derived from scheduled window (end - start)
                // 3. Global default
                if let Some(explicit) = stop.service_duration_minutes {
                    explicit
                } else if let (Some(s), Some(e)) = (stop.scheduled_time_start, stop.scheduled_time_end) {
                    let diff = time_to_minutes(e) - time_to_minutes(s);
                    if diff > 0 { diff } else { input.default_service_minutes }
                } else {
                    input.default_service_minutes
                }
            }
        };

        let departure = add_minutes(arrival, service_min);

        result_stops.push(ComputedStopSchedule {
            estimated_arrival: arrival,
            estimated_departure: departure,
            distance_from_previous_km: travel_dist_m as f64 / 1000.0,
            duration_from_previous_minutes: travel_min,
            service_duration_minutes: service_min,
        });

        total_distance_m += travel_dist_m;
        total_travel_seconds += travel_dur_s;
        total_service_min += service_min;
        cursor = departure;
        prev_matrix_idx = stop_mx;
    }

    // Return leg to depot.
    let return_dist_m = if n > 0 {
        distance_matrix[prev_matrix_idx][input.depot_matrix_idx]
    } else {
        0
    };
    let return_dur_s = if n > 0 {
        duration_matrix[prev_matrix_idx][input.depot_matrix_idx]
    } else {
        0
    };
    let return_dur_min = (return_dur_s as f64 / 60.0).ceil() as i32;

    total_distance_m += return_dist_m;
    total_travel_seconds += return_dur_s;

    ScheduleResult {
        stops: result_stops,
        return_to_depot_distance_km: return_dist_m as f64 / 1000.0,
        return_to_depot_duration_minutes: return_dur_min,
        total_distance_km: total_distance_m as f64 / 1000.0,
        total_travel_minutes: (total_travel_seconds as f64 / 60.0).ceil() as i32,
        total_service_minutes: total_service_min,
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveTime;

    fn hm(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    /// Build a trivial symmetric matrix where travel between any two different
    /// locations takes `dist_m` metres / `dur_s` seconds.
    fn uniform_matrix(size: usize, dist_m: u64, dur_s: u64) -> (Vec<Vec<u64>>, Vec<Vec<u64>>) {
        let mut d = vec![vec![0u64; size]; size];
        let mut t = vec![vec![0u64; size]; size];
        for i in 0..size {
            for j in 0..size {
                if i != j {
                    d[i][j] = dist_m;
                    t[i][j] = dur_s;
                }
            }
        }
        (d, t)
    }

    // -----------------------------------------------------------------------
    // 1. Empty route
    // -----------------------------------------------------------------------
    #[test]
    fn empty_route_returns_zeros() {
        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![],
            stop_matrix_indices: vec![],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };
        let (dm, tm) = uniform_matrix(1, 10_000, 600);
        let result = compute_sequential_schedule(&input, &dm, &tm);

        assert!(result.stops.is_empty());
        assert_eq!(result.return_to_depot_distance_km, 0.0);
        assert_eq!(result.return_to_depot_duration_minutes, 0);
        assert_eq!(result.total_distance_km, 0.0);
        assert_eq!(result.total_travel_minutes, 0);
        assert_eq!(result.total_service_minutes, 0);
    }

    // -----------------------------------------------------------------------
    // 2. Single stop, no time window — uses default service duration
    // -----------------------------------------------------------------------
    #[test]
    fn single_stop_no_window_uses_default_service() {
        // Matrix: [depot=0, stop=1]. Travel 10 km / 15 min each way.
        let (dm, tm) = uniform_matrix(2, 10_000, 900); // 900s = 15 min

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: None,
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);

        assert_eq!(result.stops.len(), 1);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(8, 15));
        assert_eq!(s.estimated_departure, hm(9, 15)); // +60 min service
        assert_eq!(s.distance_from_previous_km, 10.0);
        assert_eq!(s.duration_from_previous_minutes, 15);
        assert_eq!(s.service_duration_minutes, 60);
        // Return: 10 km / 15 min
        assert_eq!(result.return_to_depot_distance_km, 10.0);
        assert_eq!(result.return_to_depot_duration_minutes, 15);
        // Totals: 20 km travel, 30 min travel, 60 min service
        assert_eq!(result.total_distance_km, 20.0);
        assert_eq!(result.total_travel_minutes, 30);
        assert_eq!(result.total_service_minutes, 60);
    }

    // -----------------------------------------------------------------------
    // 3. Single stop with scheduled window — service derived from window
    // -----------------------------------------------------------------------
    #[test]
    fn single_stop_with_scheduled_window() {
        // Travel: 5 km / 10 min. Scheduled 09:00–10:30 (90 min service).
        let (dm, tm) = uniform_matrix(2, 5_000, 600); // 600s = 10 min

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 30)),
                service_duration_minutes: None,
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];

        // Earliest arrival = 08:10, but scheduled start = 09:00 → wait.
        assert_eq!(s.estimated_arrival, hm(9, 0));
        // Service = 90 min (from 09:00–10:30 window).
        assert_eq!(s.service_duration_minutes, 90);
        assert_eq!(s.estimated_departure, hm(10, 30));
    }

    // -----------------------------------------------------------------------
    // 4. Two stops, sequential — no gaps
    // -----------------------------------------------------------------------
    #[test]
    fn two_stops_sequential_no_gaps() {
        // Matrix layout: [depot=0, A=1, B=2]
        // All travel: 5 km / 10 min.
        let (dm, tm) = uniform_matrix(3, 5_000, 600);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None,
                    scheduled_time_end: None,
                    service_duration_minutes: Some(30),
                    break_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None,
                    scheduled_time_end: None,
                    service_duration_minutes: Some(45),
                    break_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![1, 2],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.stops.len(), 2);

        // Stop A: depart depot 08:00, arrive 08:10, serve 30 min, depart 08:40
        let a = &result.stops[0];
        assert_eq!(a.estimated_arrival, hm(8, 10));
        assert_eq!(a.estimated_departure, hm(8, 40));
        assert_eq!(a.service_duration_minutes, 30);

        // Stop B: depart A 08:40, travel 10 min, arrive 08:50, serve 45 min, depart 09:35
        let b = &result.stops[1];
        assert_eq!(b.estimated_arrival, hm(8, 50));
        assert_eq!(b.estimated_departure, hm(9, 35));
        assert_eq!(b.service_duration_minutes, 45);

        // Return: 5 km / 10 min
        assert_eq!(result.return_to_depot_distance_km, 5.0);
        assert_eq!(result.return_to_depot_duration_minutes, 10);
        // Total travel distance: depot→A(5) + A→B(5) + B→depot(5) = 15 km
        assert_eq!(result.total_distance_km, 15.0);
    }

    // -----------------------------------------------------------------------
    // 5. Two stops with waiting gap
    // -----------------------------------------------------------------------
    #[test]
    fn two_stops_with_gap_waits_for_scheduled() {
        // A has no window. B is scheduled at 11:00.
        // Travel 10 min everywhere, service 30 min.
        let (dm, tm) = uniform_matrix(3, 5_000, 600);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None,
                    scheduled_time_end: None,
                    service_duration_minutes: Some(30),
                    break_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(11, 0)),
                    scheduled_time_end: Some(hm(12, 0)),
                    service_duration_minutes: None,
                    break_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![1, 2],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // A: arrive 08:10, depart 08:40
        let a = &result.stops[0];
        assert_eq!(a.estimated_arrival, hm(8, 10));
        assert_eq!(a.estimated_departure, hm(8, 40));

        // B: earliest = 08:50, but scheduled 11:00 → wait.
        let b = &result.stops[1];
        assert_eq!(b.estimated_arrival, hm(11, 0));
        assert_eq!(b.service_duration_minutes, 60); // from 11:00–12:00
        assert_eq!(b.estimated_departure, hm(12, 0));
    }

    // -----------------------------------------------------------------------
    // 6. Break stop — uses break_duration_minutes
    // -----------------------------------------------------------------------
    #[test]
    fn break_stop_uses_break_duration() {
        // [depot=0, customer=1, break=2, customer=3]
        let (dm, tm) = uniform_matrix(4, 3_000, 600);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None,
                    scheduled_time_end: None,
                    service_duration_minutes: Some(30),
                    break_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Break,
                    scheduled_time_start: None,
                    scheduled_time_end: None,
                    service_duration_minutes: None,
                    break_duration_minutes: Some(45),
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None,
                    scheduled_time_end: None,
                    service_duration_minutes: Some(30),
                    break_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![1, 2, 3],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.stops.len(), 3);

        // Customer1: arrive 08:10, depart 08:40
        assert_eq!(result.stops[0].estimated_arrival, hm(8, 10));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 40));

        // Break: arrive 08:50, 45 min, depart 09:35
        assert_eq!(result.stops[1].estimated_arrival, hm(8, 50));
        assert_eq!(result.stops[1].service_duration_minutes, 45);
        assert_eq!(result.stops[1].estimated_departure, hm(9, 35));

        // Customer2: arrive 09:45, 30 min, depart 10:15
        assert_eq!(result.stops[2].estimated_arrival, hm(9, 45));
        assert_eq!(result.stops[2].estimated_departure, hm(10, 15));
    }

    // -----------------------------------------------------------------------
    // 7. Explicit service_duration_minutes takes precedence
    // -----------------------------------------------------------------------
    #[test]
    fn explicit_service_duration_overrides_window() {
        // Scheduled 09:00–10:00 (60 min window) but explicit = 45 min.
        let (dm, tm) = uniform_matrix(2, 5_000, 600);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 0)),
                service_duration_minutes: Some(45),
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 0));
        assert_eq!(s.service_duration_minutes, 45); // explicit wins
        assert_eq!(s.estimated_departure, hm(9, 45));
    }

    // -----------------------------------------------------------------------
    // 8. Asymmetric matrix — different distances each direction
    // -----------------------------------------------------------------------
    #[test]
    fn asymmetric_matrix() {
        // depot→stop = 8 km / 12 min, stop→depot = 6 km / 10 min
        let dm = vec![
            vec![0u64, 8_000],
            vec![6_000, 0u64],
        ];
        let tm = vec![
            vec![0u64, 720],  // 12 min
            vec![600, 0u64],  // 10 min
        ];

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: Some(30),
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];

        assert_eq!(s.distance_from_previous_km, 8.0);
        assert_eq!(s.duration_from_previous_minutes, 12);
        assert_eq!(s.estimated_arrival, hm(8, 12));
        assert_eq!(s.estimated_departure, hm(8, 42));
        assert_eq!(result.return_to_depot_distance_km, 6.0);
        assert_eq!(result.return_to_depot_duration_minutes, 10);
        assert_eq!(result.total_distance_km, 14.0);
    }

    // -----------------------------------------------------------------------
    // 9. Metrics are correct for multi-stop route
    // -----------------------------------------------------------------------
    #[test]
    fn metrics_correct_for_multi_stop() {
        // 3 stops, each with 20 min service. Travel = 5 km / 10 min each leg.
        let (dm, tm) = uniform_matrix(4, 5_000, 600);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop { stop_type: StopType::Customer, scheduled_time_start: None, scheduled_time_end: None, service_duration_minutes: Some(20), break_duration_minutes: None },
                ScheduleStop { stop_type: StopType::Customer, scheduled_time_start: None, scheduled_time_end: None, service_duration_minutes: Some(20), break_duration_minutes: None },
                ScheduleStop { stop_type: StopType::Customer, scheduled_time_start: None, scheduled_time_end: None, service_duration_minutes: Some(20), break_duration_minutes: None },
            ],
            stop_matrix_indices: vec![1, 2, 3],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // 4 legs (depot→1, 1→2, 2→3, 3→depot) × 5 km = 20 km
        assert_eq!(result.total_distance_km, 20.0);
        // 4 legs × 10 min = 40 min travel
        assert_eq!(result.total_travel_minutes, 40);
        // 3 stops × 20 min = 60 min service
        assert_eq!(result.total_service_minutes, 60);
    }
}
