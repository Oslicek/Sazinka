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
    /// Percentage buffer added to travel time (e.g. 10.0 = +10%).
    /// Travel time is multiplied by `(1 + arrival_buffer_percent / 100)`.
    pub arrival_buffer_percent: f64,
    /// Fixed buffer in minutes added to every travel segment on top of percentage.
    pub arrival_buffer_fixed_minutes: f64,
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
    /// Computed depot departure time (may differ from workday_start when
    /// the first stop is scheduled — departure is calculated backward).
    pub depot_departure: NaiveTime,
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

/// Apply arrival buffer to a raw travel duration in seconds.
/// Returns the buffered duration: `raw * (1 + percent/100) + fixed_minutes * 60`.
fn apply_travel_buffer(raw_seconds: u64, buffer_percent: f64, buffer_fixed_minutes: f64) -> u64 {
    let after_percent = raw_seconds as f64 * (1.0 + buffer_percent / 100.0);
    let after_fixed = after_percent + buffer_fixed_minutes * 60.0;
    after_fixed.ceil() as u64
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/// Compute a sequential schedule for the given route.
///
/// **Scheduling rules:**
/// 1. Scheduled stops support two modes:
///    - **Pinned mode** (default/backward-compatible): arrival is
///      `scheduled_time_start`, departure is `scheduled_time_end`.
///    - **Flexible mode**: when `service_duration_minutes` is explicitly set and
///      shorter than `(scheduled_time_end - scheduled_time_start)`, arrival is
///      placed as early as possible within the agreed window after travel.
/// 2. Depot departure is calculated **backward** from the first stop:
///    `depot_departure = first_arrival - travel_time_to_first_stop`.
///    If the first stop is not scheduled, depot departure = `workday_start`.
/// 3. Unscheduled stops are placed immediately after the previous stop's
///    departure + travel time.
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

    let mut total_distance_m: u64 = 0;
    let mut total_travel_seconds: u64 = 0;
    let mut total_service_min: i32 = 0;

    // -- Determine depot departure time --
    // If the first stop has a scheduled start, work backward from it.
    let depot_departure = if n > 0 {
        let first_stop = &input.stops[0];
        let first_mx = input.stop_matrix_indices[0];
        let raw_dur_s = duration_matrix[input.depot_matrix_idx][first_mx];
        let travel_dur_s = apply_travel_buffer(raw_dur_s, input.arrival_buffer_percent, input.arrival_buffer_fixed_minutes);
        let travel_min = (travel_dur_s as f64 / 60.0).ceil() as i32;

        match first_stop.scheduled_time_start {
            Some(sched_start) => {
                // Depart depot so we arrive exactly at the agreed time.
                let backward = add_minutes(sched_start, -travel_min);
                // But never earlier than workday_start.
                if backward < input.workday_start {
                    input.workday_start
                } else {
                    backward
                }
            }
            None => input.workday_start,
        }
    } else {
        input.workday_start
    };

    let mut cursor = depot_departure;
    let mut prev_matrix_idx = input.depot_matrix_idx;

    for i in 0..n {
        let stop = &input.stops[i];
        let stop_mx = input.stop_matrix_indices[i];

        // Break stops happen at the same location — no travel.
        let (travel_dist_m, travel_dur_s, travel_min) = if stop.stop_type == StopType::Break {
            (0u64, 0u64, 0i32)
        } else {
            let d = distance_matrix[prev_matrix_idx][stop_mx];
            let raw_t = duration_matrix[prev_matrix_idx][stop_mx];
            // Apply arrival buffer: multiply by (1 + percent/100), then add fixed minutes.
            let t = apply_travel_buffer(raw_t, input.arrival_buffer_percent, input.arrival_buffer_fixed_minutes);
            (d, t, (t as f64 / 60.0).ceil() as i32)
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

        let earliest_arrival = add_minutes(cursor, travel_min);

        // Flexible customer windows:
        // - explicit service duration is set
        // - both agreed start/end exist
        // - service is shorter than the full window
        let window_info = match (stop.scheduled_time_start, stop.scheduled_time_end) {
            (Some(start), Some(end)) => {
                let window_len = time_to_minutes(end) - time_to_minutes(start);
                Some((start, end, window_len))
            }
            _ => None,
        };

        let is_flexible_customer_window = stop.stop_type == StopType::Customer
            && stop.service_duration_minutes.is_some()
            && window_info
                .map(|(_, _, len)| len > 0 && service_min > 0 && service_min < len)
                .unwrap_or(false);

        // Arrival/departure computation:
        // - Flexible scheduled customer: place as early as possible after travel
        //   but not before window start; keep departure within window when possible.
        // - Otherwise keep legacy pinned behavior for scheduled end/start.
        let (arrival, departure) = if is_flexible_customer_window {
            let (window_start, window_end, _) = window_info.expect("validated above");
            let latest_start = add_minutes(window_end, -service_min);
            let arrival = if earliest_arrival <= window_start {
                window_start
            } else if earliest_arrival <= latest_start {
                earliest_arrival
            } else {
                // Infeasible due to late travel; keep physical arrival so caller can
                // detect/visualize this conflict.
                earliest_arrival
            };
            let departure = add_minutes(arrival, service_min);
            (arrival, departure)
        } else {
            let arrival = match stop.scheduled_time_start {
                Some(sched) => sched,
                None => earliest_arrival,
            };
            let departure = match stop.scheduled_time_end {
                Some(sched_end) => sched_end,
                None => add_minutes(arrival, service_min),
            };
            (arrival, departure)
        };

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
        // Breaks don't change the "previous location" for routing purposes.
        if stop.stop_type != StopType::Break {
            prev_matrix_idx = stop_mx;
        }
    }

    // Return leg to depot.
    let return_dist_m = if n > 0 {
        distance_matrix[prev_matrix_idx][input.depot_matrix_idx]
    } else {
        0
    };
    let raw_return_dur_s = if n > 0 {
        duration_matrix[prev_matrix_idx][input.depot_matrix_idx]
    } else {
        0
    };
    let return_dur_s = apply_travel_buffer(raw_return_dur_s, input.arrival_buffer_percent, input.arrival_buffer_fixed_minutes);
    let return_dur_min = (return_dur_s as f64 / 60.0).ceil() as i32;

    total_distance_m += return_dist_m;
    total_travel_seconds += return_dur_s;

    ScheduleResult {
        stops: result_stops,
        depot_departure,
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
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };
        let (dm, tm) = uniform_matrix(1, 10_000, 600);
        let result = compute_sequential_schedule(&input, &dm, &tm);

        assert!(result.stops.is_empty());
        assert_eq!(result.depot_departure, hm(8, 0));
        assert_eq!(result.return_to_depot_distance_km, 0.0);
        assert_eq!(result.return_to_depot_duration_minutes, 0);
        assert_eq!(result.total_distance_km, 0.0);
        assert_eq!(result.total_travel_minutes, 0);
        assert_eq!(result.total_service_minutes, 0);
    }

    // -----------------------------------------------------------------------
    // 2. Single stop, no time window — departs at workday_start
    // -----------------------------------------------------------------------
    #[test]
    fn single_stop_no_window_departs_at_workday_start() {
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
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.depot_departure, hm(8, 0));
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(8, 15));
        assert_eq!(s.estimated_departure, hm(9, 15)); // +60 min default
        assert_eq!(s.distance_from_previous_km, 10.0);
        assert_eq!(s.duration_from_previous_minutes, 15);
        assert_eq!(s.service_duration_minutes, 60);
        assert_eq!(result.return_to_depot_distance_km, 10.0);
        assert_eq!(result.return_to_depot_duration_minutes, 15);
        assert_eq!(result.total_distance_km, 20.0);
        assert_eq!(result.total_travel_minutes, 30);
        assert_eq!(result.total_service_minutes, 60);
    }

    // -----------------------------------------------------------------------
    // 3. Single scheduled stop — depot departure calculated backward
    // -----------------------------------------------------------------------
    #[test]
    fn single_scheduled_stop_backward_depot_departure() {
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
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // Depot departure = 09:00 - 10 min travel = 08:50
        assert_eq!(result.depot_departure, hm(8, 50));
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 0));   // pinned to agreed start
        assert_eq!(s.service_duration_minutes, 90);   // from 09:00–10:30 window
        assert_eq!(s.estimated_departure, hm(10, 30)); // pinned to agreed end
    }

    // -----------------------------------------------------------------------
    // 4. Two unscheduled stops — sequential, no gaps
    // -----------------------------------------------------------------------
    #[test]
    fn two_stops_sequential_no_gaps() {
        let (dm, tm) = uniform_matrix(3, 5_000, 600); // 10 min travel

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: Some(30), break_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: Some(45), break_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![1, 2],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.depot_departure, hm(8, 0));
        let a = &result.stops[0];
        assert_eq!(a.estimated_arrival, hm(8, 10));
        assert_eq!(a.estimated_departure, hm(8, 40));
        let b = &result.stops[1];
        assert_eq!(b.estimated_arrival, hm(8, 50));
        assert_eq!(b.estimated_departure, hm(9, 35));
    }

    // -----------------------------------------------------------------------
    // 5. Scheduled stop then unscheduled — departs at agreed end
    // -----------------------------------------------------------------------
    #[test]
    fn scheduled_stop_then_unscheduled_departs_at_agreed_end() {
        // A is scheduled 08:00–09:00. B is unscheduled.
        // Travel = 10 min everywhere.
        let (dm, tm) = uniform_matrix(3, 5_000, 600);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(8, 0)),
                    scheduled_time_end: Some(hm(9, 0)),
                    service_duration_minutes: None, break_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: Some(30), break_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![1, 2],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // Depot departure = 08:00 - 10 min = 07:50
        assert_eq!(result.depot_departure, hm(7, 50));

        let a = &result.stops[0];
        assert_eq!(a.estimated_arrival, hm(8, 0));    // pinned to agreed start
        assert_eq!(a.estimated_departure, hm(9, 0));  // pinned to agreed end

        // B: depart A at 09:00, travel 10 min → arrive 09:10, serve 30 min → depart 09:40
        let b = &result.stops[1];
        assert_eq!(b.estimated_arrival, hm(9, 10));
        assert_eq!(b.estimated_departure, hm(9, 40));
    }

    // -----------------------------------------------------------------------
    // 6. Two scheduled stops — second respects agreed window
    // -----------------------------------------------------------------------
    #[test]
    fn two_scheduled_stops_respect_windows() {
        // A: 08:00–09:00, B: 11:00–12:00. Travel = 10 min.
        let (dm, tm) = uniform_matrix(3, 5_000, 600);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(8, 0)),
                    scheduled_time_end: Some(hm(9, 0)),
                    service_duration_minutes: None, break_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(11, 0)),
                    scheduled_time_end: Some(hm(12, 0)),
                    service_duration_minutes: None, break_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![1, 2],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);

        let a = &result.stops[0];
        assert_eq!(a.estimated_arrival, hm(8, 0));
        assert_eq!(a.estimated_departure, hm(9, 0));

        let b = &result.stops[1];
        assert_eq!(b.estimated_arrival, hm(11, 0));   // waits until agreed start
        assert_eq!(b.estimated_departure, hm(12, 0)); // pinned to agreed end
    }

    // -----------------------------------------------------------------------
    // 7. Break stop — uses break_duration_minutes, zero travel
    // -----------------------------------------------------------------------
    #[test]
    fn break_stop_uses_break_duration() {
        let (dm, tm) = uniform_matrix(4, 3_000, 600); // 10 min / 3 km

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: Some(30), break_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Break,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: None, break_duration_minutes: Some(45),
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: Some(30), break_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![1, 2, 3],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // Customer1: 08:00 + 10 min travel = 08:10, serve 30 min → 08:40
        assert_eq!(result.stops[0].estimated_arrival, hm(8, 10));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 40));

        // Break: zero travel (same location), 45 min → 08:40–09:25
        assert_eq!(result.stops[1].duration_from_previous_minutes, 0);
        assert_eq!(result.stops[1].estimated_arrival, hm(8, 40));
        assert_eq!(result.stops[1].service_duration_minutes, 45);
        assert_eq!(result.stops[1].estimated_departure, hm(9, 25));

        // Customer2: travel from customer1 (not from break location) = 10 min
        // 09:25 + 10 min = 09:35
        assert_eq!(result.stops[2].estimated_arrival, hm(9, 35));
        assert_eq!(result.stops[2].estimated_departure, hm(10, 5));
    }

    // -----------------------------------------------------------------------
    // 8. Explicit shorter service inside agreed window => flexible placement
    // -----------------------------------------------------------------------
    #[test]
    fn explicit_shorter_service_uses_flexible_window() {
        // Workday starts at 09:05, travel is 10 min, so physical earliest arrival
        // is 09:15. Agreed window is 09:00-10:00, service is 45.
        // Flexible mode => arrival 09:15, departure 10:00.
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
            workday_start: hm(9, 5),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 15));
        assert_eq!(s.service_duration_minutes, 45);
        assert_eq!(s.estimated_departure, hm(10, 0));
    }

    // -----------------------------------------------------------------------
    // 8b. Explicit full-window service keeps pinned behavior
    // -----------------------------------------------------------------------
    #[test]
    fn explicit_full_window_service_stays_pinned() {
        let (dm, tm) = uniform_matrix(2, 5_000, 600);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 0)),
                service_duration_minutes: Some(60),
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 0));
        assert_eq!(s.estimated_departure, hm(10, 0));
    }

    // -----------------------------------------------------------------------
    // 8c. Flexible window becomes infeasible when travel is too late
    // -----------------------------------------------------------------------
    #[test]
    fn flexible_window_infeasible_when_arrival_after_latest_start() {
        // Travel 50 minutes from depot, window 09:00-10:00, service 30.
        // Latest feasible start is 09:30, physical earliest arrival is 09:50.
        // We keep actual arrival/departure to expose conflict.
        let (dm, tm) = uniform_matrix(2, 5_000, 3000);

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 0)),
                service_duration_minutes: Some(30),
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(9, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 50));
        assert_eq!(s.estimated_departure, hm(10, 20));
    }

    // -----------------------------------------------------------------------
    // 9. Asymmetric matrix
    // -----------------------------------------------------------------------
    #[test]
    fn asymmetric_matrix() {
        let dm = vec![vec![0u64, 8_000], vec![6_000, 0u64]];
        let tm = vec![vec![0u64, 720], vec![600, 0u64]]; // 12 min / 10 min

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None, scheduled_time_end: None,
                service_duration_minutes: Some(30), break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
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
    // 10. Metrics correct for multi-stop route
    // -----------------------------------------------------------------------
    #[test]
    fn metrics_correct_for_multi_stop() {
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
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.total_distance_km, 20.0);
        assert_eq!(result.total_travel_minutes, 40);
        assert_eq!(result.total_service_minutes, 60);
    }

    // -----------------------------------------------------------------------
    // 11. Backward depot departure clamped; arrival still pinned to agreed
    // -----------------------------------------------------------------------
    #[test]
    fn backward_depot_departure_clamped_arrival_still_pinned() {
        // Travel 60 min, scheduled at 07:30–08:30. Workday starts 07:00.
        // Backward: 07:30 - 60 = 06:30 → clamped to 07:00.
        // Physical arrival = 08:00, but agreed = 07:30 → still pinned to 07:30.
        let (dm, tm) = uniform_matrix(2, 50_000, 3600); // 60 min travel

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(7, 30)),
                scheduled_time_end: Some(hm(8, 30)),
                service_duration_minutes: None, break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        // Clamped to workday_start, not 06:30
        assert_eq!(result.depot_departure, hm(7, 0));
        // Arrival is always pinned to agreed start, even if physically late
        assert_eq!(result.stops[0].estimated_arrival, hm(7, 30));
        // Departure is always pinned to agreed end
        assert_eq!(result.stops[0].estimated_departure, hm(8, 30));
    }

    // -----------------------------------------------------------------------
    // 12. Break stop has zero travel and correct duration
    // -----------------------------------------------------------------------
    #[test]
    fn break_stop_zero_travel() {
        // [depot=0, customer=1, break=2, customer=3]
        // Break happens at the same location — travel = 0.
        let (dm, tm) = uniform_matrix(4, 5_000, 600); // 10 min / 5 km

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: Some(60), break_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Break,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: None, break_duration_minutes: Some(45),
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None, scheduled_time_end: None,
                    service_duration_minutes: Some(60), break_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![1, 2, 3],
            workday_start: hm(8, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        // Customer1: 08:00 + 10 min travel = 08:10, serve 60 min → depart 09:10
        assert_eq!(result.stops[0].estimated_arrival, hm(8, 10));
        assert_eq!(result.stops[0].estimated_departure, hm(9, 10));

        // Break: zero travel (same location), starts at 09:10, 45 min → 09:55
        assert_eq!(result.stops[1].distance_from_previous_km, 0.0);
        assert_eq!(result.stops[1].duration_from_previous_minutes, 0);
        assert_eq!(result.stops[1].estimated_arrival, hm(9, 10));
        assert_eq!(result.stops[1].estimated_departure, hm(9, 55));
        assert_eq!(result.stops[1].service_duration_minutes, 45);

        // Customer2: break didn't change location, so travel = customer1→customer2
        // From customer1 (matrix idx 1) to customer2 (matrix idx 3) = 10 min
        assert_eq!(result.stops[2].duration_from_previous_minutes, 10);
        assert_eq!(result.stops[2].estimated_arrival, hm(10, 5));
    }

    #[test]
    fn buffer_increases_travel_time() {
        // depot → customer: raw 2400s (40 min), 60 km
        let dm = vec![vec![0, 60_000], vec![60_000, 0]];
        let tm = vec![vec![0, 2400], vec![2400, 0]];

        // 10% buffer + 5 min fixed:
        // 2400 * 1.10 = 2640s, + 300s = 2940s → ceil(2940/60) = 49 min
        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: Some(60),
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 10.0,
            arrival_buffer_fixed_minutes: 5.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        // Buffered travel = 49 min → arrive at 07:49
        assert_eq!(result.stops[0].duration_from_previous_minutes, 49);
        assert_eq!(result.stops[0].estimated_arrival, hm(7, 49));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 49));
        // Return leg is also buffered
        assert_eq!(result.return_to_depot_duration_minutes, 49);
    }

    #[test]
    fn buffer_affects_backward_depot_departure() {
        // depot → customer: raw 1800s (30 min), 40 km
        let dm = vec![vec![0, 40_000], vec![40_000, 0]];
        let tm = vec![vec![0, 1800], vec![1800, 0]];

        // 20% buffer + 0 fixed:
        // 1800 * 1.20 = 2160s → ceil(2160/60) = 36 min
        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 0)),
                service_duration_minutes: None,
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 20.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        // Backward: 09:00 - 36 min = 08:24 depot departure
        assert_eq!(result.depot_departure, hm(8, 24));
        assert_eq!(result.stops[0].duration_from_previous_minutes, 36);
    }

    #[test]
    fn zero_buffer_matches_raw_travel() {
        // Ensure zero buffer doesn't alter anything.
        let dm = vec![vec![0, 50_000], vec![50_000, 0]];
        let tm = vec![vec![0, 2340], vec![2340, 0]]; // 39 min raw

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: Some(60),
                break_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.stops[0].duration_from_previous_minutes, 39);
    }
}
