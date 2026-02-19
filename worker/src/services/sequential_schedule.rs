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
    /// Explicit per-stop service duration chosen by the dispatcher.
    /// Falls back to `device_type_default_duration_minutes`, then `default_service_minutes`.
    pub service_duration_minutes: Option<i32>,
    /// Default service duration from the device type configuration.
    /// Acts as a secondary fallback between explicit per-stop value and global default.
    pub device_type_default_duration_minutes: Option<i32>,
    /// For break stops only.
    pub break_duration_minutes: Option<i32>,
    /// Explicit break start time. If set AND falls after travel arrival to the next
    /// customer, the break is pinned to this time within the gap. If None, the break
    /// starts immediately after travel ends (start of gap).
    pub break_time_start: Option<NaiveTime>,
    /// Manual override for service duration (replaces calculated/agreed value).
    pub override_service_duration_minutes: Option<i32>,
    /// Manual override for travel duration from previous stop (replaces matrix value).
    pub override_travel_duration_minutes: Option<i32>,
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
/// 2. Depot departure is calculated **backward** from the first customer stop:
///    `depot_departure = first_customer_arrival - travel_time_to_first_customer`.
///    If the first customer stop is not scheduled, depot departure = `workday_start`.
///    A leading break does not affect depot departure calculation.
/// 3. Unscheduled stops are placed immediately after the previous stop's
///    departure + travel time.
/// 4. **Break placement (pending-break model):** when a break is encountered in
///    the stop list, it is deferred until the travel to the *next* customer stop
///    has been computed. The break is then placed *after* that travel, within the
///    resulting gap. This matches the real-world model where the crew drives to
///    the next customer's area first, then takes a break while waiting.
///    - If `break_time_start` is set and falls after travel ends, the break is
///      pinned to that time.
///    - If `break_time_start` is before travel ends, it is clamped to travel end.
///    - If there is no next customer (break is last in the list), it starts at
///      the current cursor (immediately after the last customer's departure).
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

    // Pre-allocate result slots in input order (breaks and customers interleaved).
    // We fill them out-of-order because breaks are deferred until after travel.
    let mut result_stops: Vec<Option<ComputedStopSchedule>> = vec![None; n];

    let mut total_distance_m: u64 = 0;
    let mut total_travel_seconds: u64 = 0;
    let mut total_service_min: i32 = 0;

    // -- Determine depot departure time --
    // Find the first *customer* stop (skip leading breaks for this calculation).
    let first_customer_idx = input.stops.iter().position(|s| s.stop_type == StopType::Customer);

    let depot_departure = if let Some(fc_idx) = first_customer_idx {
        let first_customer = &input.stops[fc_idx];
        let fc_mx = input.stop_matrix_indices[fc_idx];
        let raw_dur_s = duration_matrix[input.depot_matrix_idx][fc_mx];
        let travel_dur_s = apply_travel_buffer(raw_dur_s, input.arrival_buffer_percent, input.arrival_buffer_fixed_minutes);
        let travel_min = (travel_dur_s as f64 / 60.0).ceil() as i32;

        match first_customer.scheduled_time_start {
            Some(sched_start) => {
                let backward = add_minutes(sched_start, -travel_min);
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

    #[allow(unused_assignments)]
    let mut cursor = depot_departure;
    let mut prev_matrix_idx = input.depot_matrix_idx;

    // Pending break: index into input.stops and the break stop itself.
    // When we encounter a break, we defer it here until the next customer is processed.
    let mut pending_break_idx: Option<usize> = None;

    for i in 0..n {
        let stop = &input.stops[i];
        let stop_mx = input.stop_matrix_indices[i];

        if stop.stop_type == StopType::Break {
            // Defer this break — it will be placed after travel to the next customer.
            // If there is already a pending break (two consecutive breaks), flush the
            // first one at the current cursor before deferring the new one.
            if let Some(pb_idx) = pending_break_idx {
                let pb = &input.stops[pb_idx];
                let break_dur = pb.break_duration_minutes.unwrap_or(30);
                let break_start = cursor;
                let break_end = add_minutes(break_start, break_dur);
                result_stops[pb_idx] = Some(ComputedStopSchedule {
                    estimated_arrival: break_start,
                    estimated_departure: break_end,
                    distance_from_previous_km: 0.0,
                    duration_from_previous_minutes: 0,
                    service_duration_minutes: break_dur,
                });
                total_service_min += break_dur;
                cursor = break_end; // advance so the next consecutive break starts after this one
            }
            pending_break_idx = Some(i);
            continue;
        }

        // --- Customer stop ---

        // Compute travel from previous customer (or depot) to this stop.
        let (travel_dist_m, travel_dur_s, travel_min) =
            if let Some(override_min) = stop.override_travel_duration_minutes {
                let d = distance_matrix[prev_matrix_idx][stop_mx];
                let t_s = override_min as u64 * 60;
                (d, t_s, override_min)
            } else {
                let d = distance_matrix[prev_matrix_idx][stop_mx];
                let raw_t = duration_matrix[prev_matrix_idx][stop_mx];
                let t = apply_travel_buffer(raw_t, input.arrival_buffer_percent, input.arrival_buffer_fixed_minutes);
                (d, t, (t as f64 / 60.0).ceil() as i32)
            };

        // Advance cursor past travel.
        let arrival_after_travel = add_minutes(cursor, travel_min);

        // --- Place pending break (if any) within the gap after travel ---
        if let Some(pb_idx) = pending_break_idx.take() {
            let pb = &input.stops[pb_idx];
            let break_dur = pb.break_duration_minutes.unwrap_or(30);

            // Break starts at the later of: travel end OR the explicit break_time_start.
            let break_start = if let Some(bts) = pb.break_time_start {
                // Clamp: cannot start before travel ends.
                if bts < arrival_after_travel { arrival_after_travel } else { bts }
            } else {
                arrival_after_travel
            };
            let break_end = add_minutes(break_start, break_dur);

            result_stops[pb_idx] = Some(ComputedStopSchedule {
                estimated_arrival: break_start,
                estimated_departure: break_end,
                // The break has no travel of its own — travel was to the next customer.
                distance_from_previous_km: 0.0,
                duration_from_previous_minutes: 0,
                service_duration_minutes: break_dur,
            });
            total_service_min += break_dur;
            cursor = break_end;
        } else {
            cursor = arrival_after_travel;
        }

        // --- Service duration for this customer stop ---
        let service_min = if let Some(override_svc) = stop.override_service_duration_minutes {
            override_svc
        } else if let Some(explicit) = stop.service_duration_minutes {
            explicit
        } else if let (Some(s), Some(e)) = (stop.scheduled_time_start, stop.scheduled_time_end) {
            let diff = time_to_minutes(e) - time_to_minutes(s);
            if diff > 0 {
                diff
            } else {
                stop.device_type_default_duration_minutes
                    .filter(|&v| v > 0)
                    .unwrap_or(input.default_service_minutes)
            }
        } else {
            stop.device_type_default_duration_minutes
                .filter(|&v| v > 0)
                .unwrap_or(input.default_service_minutes)
        };

        // --- Flexible customer windows ---
        let window_info = match (stop.scheduled_time_start, stop.scheduled_time_end) {
            (Some(start), Some(end)) => {
                let window_len = time_to_minutes(end) - time_to_minutes(start);
                Some((start, end, window_len))
            }
            _ => None,
        };

        let is_flexible_customer_window = stop.service_duration_minutes.is_some()
            && window_info
                .map(|(_, _, len)| len > 0 && service_min > 0 && service_min < len)
                .unwrap_or(false);

        let (arrival, departure) = if is_flexible_customer_window {
            let (window_start, window_end, _) = window_info.expect("validated above");
            let latest_start = add_minutes(window_end, -service_min);
            let arrival = if cursor <= window_start {
                window_start
            } else if cursor <= latest_start {
                cursor
            } else {
                cursor
            };
            let departure = add_minutes(arrival, service_min);
            (arrival, departure)
        } else {
            let arrival = match stop.scheduled_time_start {
                Some(sched) => sched,
                None => cursor,
            };
            let departure = match stop.scheduled_time_end {
                Some(sched_end) => sched_end,
                None => add_minutes(arrival, service_min),
            };
            (arrival, departure)
        };

        result_stops[i] = Some(ComputedStopSchedule {
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

    // Flush any trailing break (break after all customers).
    if let Some(pb_idx) = pending_break_idx {
        let pb = &input.stops[pb_idx];
        let break_dur = pb.break_duration_minutes.unwrap_or(30);
        let break_start = if let Some(bts) = pb.break_time_start {
            if bts < cursor { cursor } else { bts }
        } else {
            cursor
        };
        let break_end = add_minutes(break_start, break_dur);
        result_stops[pb_idx] = Some(ComputedStopSchedule {
            estimated_arrival: break_start,
            estimated_departure: break_end,
            distance_from_previous_km: 0.0,
            duration_from_previous_minutes: 0,
            service_duration_minutes: break_dur,
        });
        total_service_min += break_dur;
        cursor = break_end;
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

    // Unwrap all results (every slot must have been filled).
    let stops = result_stops
        .into_iter()
        .enumerate()
        .map(|(idx, opt)| opt.unwrap_or_else(|| panic!("stop {} was never scheduled", idx)))
        .collect();

    ScheduleResult {
        stops,
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

    fn make_break(dur: i32) -> ScheduleStop {
        ScheduleStop {
            stop_type: StopType::Break,
            scheduled_time_start: None,
            scheduled_time_end: None,
            service_duration_minutes: None,
            device_type_default_duration_minutes: None,
            break_duration_minutes: Some(dur),
            break_time_start: None,
            override_service_duration_minutes: None,
            override_travel_duration_minutes: None,
        }
    }

    fn make_break_pinned(dur: i32, start: NaiveTime) -> ScheduleStop {
        ScheduleStop {
            stop_type: StopType::Break,
            scheduled_time_start: None,
            scheduled_time_end: None,
            service_duration_minutes: None,
            device_type_default_duration_minutes: None,
            break_duration_minutes: Some(dur),
            break_time_start: Some(start),
            override_service_duration_minutes: None,
            override_travel_duration_minutes: None,
        }
    }

    fn make_customer(service: i32) -> ScheduleStop {
        ScheduleStop {
            stop_type: StopType::Customer,
            scheduled_time_start: None,
            scheduled_time_end: None,
            service_duration_minutes: Some(service),
            device_type_default_duration_minutes: None,
            break_duration_minutes: None,
            break_time_start: None,
            override_service_duration_minutes: None,
            override_travel_duration_minutes: None,
        }
    }

    fn make_customer_scheduled(service: i32, start: NaiveTime, end: NaiveTime) -> ScheduleStop {
        ScheduleStop {
            stop_type: StopType::Customer,
            scheduled_time_start: Some(start),
            scheduled_time_end: Some(end),
            service_duration_minutes: Some(service),
            device_type_default_duration_minutes: None,
            break_duration_minutes: None,
            break_time_start: None,
            override_service_duration_minutes: None,
            override_travel_duration_minutes: None,
        }
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

    fn no_buffer_input(stops: Vec<ScheduleStop>, indices: Vec<usize>, workday_start: NaiveTime, default_service: i32) -> ScheduleInput {
        ScheduleInput {
            depot_matrix_idx: 0,
            stops,
            stop_matrix_indices: indices,
            workday_start,
            default_service_minutes: default_service,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        }
    }

    // -----------------------------------------------------------------------
    // 1. Empty route
    // -----------------------------------------------------------------------
    #[test]
    fn empty_route_returns_zeros() {
        let input = no_buffer_input(vec![], vec![], hm(8, 0), 60);
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

        let input = no_buffer_input(
            vec![make_customer(60)],
            vec![1],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.depot_departure, hm(8, 0));
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(8, 15));
        assert_eq!(s.estimated_departure, hm(9, 15));
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
        let (dm, tm) = uniform_matrix(2, 5_000, 600); // 600s = 10 min

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 30)),
                service_duration_minutes: None,
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            vec![1],
            hm(7, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.depot_departure, hm(8, 50));
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 0));
        assert_eq!(s.service_duration_minutes, 90);
        assert_eq!(s.estimated_departure, hm(10, 30));
    }

    // -----------------------------------------------------------------------
    // 4. Two unscheduled stops — sequential, no gaps
    // -----------------------------------------------------------------------
    #[test]
    fn two_stops_sequential_no_gaps() {
        let (dm, tm) = uniform_matrix(3, 5_000, 600); // 10 min travel

        let input = no_buffer_input(
            vec![make_customer(30), make_customer(45)],
            vec![1, 2],
            hm(8, 0),
            60,
        );

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
        let (dm, tm) = uniform_matrix(3, 5_000, 600);

        let input = no_buffer_input(
            vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(8, 0)),
                    scheduled_time_end: Some(hm(9, 0)),
                    service_duration_minutes: None,
                    device_type_default_duration_minutes: None,
                    break_duration_minutes: None,
                    break_time_start: None,
                    override_service_duration_minutes: None,
                    override_travel_duration_minutes: None,
                },
                make_customer(30),
            ],
            vec![1, 2],
            hm(7, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.depot_departure, hm(7, 50));
        let a = &result.stops[0];
        assert_eq!(a.estimated_arrival, hm(8, 0));
        assert_eq!(a.estimated_departure, hm(9, 0));
        let b = &result.stops[1];
        assert_eq!(b.estimated_arrival, hm(9, 10));
        assert_eq!(b.estimated_departure, hm(9, 40));
    }

    // -----------------------------------------------------------------------
    // 6. Two scheduled stops — second respects agreed window
    // -----------------------------------------------------------------------
    #[test]
    fn two_scheduled_stops_respect_windows() {
        let (dm, tm) = uniform_matrix(3, 5_000, 600);

        let input = no_buffer_input(
            vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(8, 0)),
                    scheduled_time_end: Some(hm(9, 0)),
                    service_duration_minutes: None,
                    device_type_default_duration_minutes: None,
                    break_duration_minutes: None,
                    break_time_start: None,
                    override_service_duration_minutes: None,
                    override_travel_duration_minutes: None,
                },
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(11, 0)),
                    scheduled_time_end: Some(hm(12, 0)),
                    service_duration_minutes: None,
                    device_type_default_duration_minutes: None,
                    break_duration_minutes: None,
                    break_time_start: None,
                    override_service_duration_minutes: None,
                    override_travel_duration_minutes: None,
                },
            ],
            vec![1, 2],
            hm(7, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let a = &result.stops[0];
        assert_eq!(a.estimated_arrival, hm(8, 0));
        assert_eq!(a.estimated_departure, hm(9, 0));
        let b = &result.stops[1];
        assert_eq!(b.estimated_arrival, hm(11, 0));
        assert_eq!(b.estimated_departure, hm(12, 0));
    }

    // -----------------------------------------------------------------------
    // 7. Break placed AFTER travel to next customer (new pending-break model)
    // -----------------------------------------------------------------------
    #[test]
    fn break_placed_after_travel_to_next_stop() {
        // stops = [customer1(30min), break(45min), customer2(30min)]
        // matrix: 10 min travel everywhere, workday_start=08:00
        //
        // Expected (new model):
        //   customer1: 08:10–08:40  (10 min travel from depot)
        //   break:     08:50–09:35  (starts AFTER 10 min travel to customer2)
        //   customer2: 09:35–10:05  (starts right after break)
        let (dm, tm) = uniform_matrix(4, 3_000, 600); // 10 min / 3 km

        let input = no_buffer_input(
            vec![make_customer(30), make_break(45), make_customer(30)],
            vec![1, 2, 3],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // customer1
        assert_eq!(result.stops[0].estimated_arrival, hm(8, 10));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 40));
        assert_eq!(result.stops[0].duration_from_previous_minutes, 10);

        // break: zero travel recorded, starts after 10 min travel to customer2
        assert_eq!(result.stops[1].duration_from_previous_minutes, 0);
        assert_eq!(result.stops[1].distance_from_previous_km, 0.0);
        assert_eq!(result.stops[1].estimated_arrival, hm(8, 50));
        assert_eq!(result.stops[1].estimated_departure, hm(9, 35));
        assert_eq!(result.stops[1].service_duration_minutes, 45);

        // customer2: arrives right after break (no additional travel — already counted)
        assert_eq!(result.stops[2].estimated_arrival, hm(9, 35));
        assert_eq!(result.stops[2].estimated_departure, hm(10, 5));
        // travel is recorded on customer2 (10 min from customer1)
        assert_eq!(result.stops[2].duration_from_previous_minutes, 10);
    }

    // -----------------------------------------------------------------------
    // 8. Break before first customer
    // -----------------------------------------------------------------------
    #[test]
    fn break_before_first_customer() {
        // stops = [break(45min), customer1(scheduled 10:00–10:45)]
        // matrix: depot→customer1 = 41 min, workday_start=07:00
        //
        // Expected:
        //   depot departs 09:19 (backward from 10:00 - 41min)
        //   travel to customer1: 41 min (09:19–10:00)
        //   break: 10:00–10:45 (after travel, but customer1 is scheduled at 10:00)
        //   Wait — break is placed BEFORE customer1 in the array, so it is deferred
        //   until after travel to customer1. Travel ends at 10:00. Break starts at 10:00.
        //   But customer1 is also scheduled at 10:00. The break would push customer1 to 10:45.
        //
        // Actually the break is placed WITHIN the gap. If there is no gap (travel fills
        // the whole slot), the break overflows and customer1 is late.
        // Here: travel=41min, break=45min, customer1 scheduled at 10:00.
        // Gap after travel: 10:00–10:00 = 0 min. Break overflows by 45 min.
        // customer1 arrives at 10:45 (late by 45 min).
        //
        // Let's use a longer gap: workday_start=07:00, customer1 scheduled at 11:00.
        // Travel=41min → arrives 07:41. Gap: 07:41–11:00 = 199 min. Break fits.
        let (dm, tm) = uniform_matrix(2, 30_000, 2460); // 41 min

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![
                make_break(45),
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(11, 0)),
                    scheduled_time_end: Some(hm(11, 45)),
                    service_duration_minutes: Some(45),
                    device_type_default_duration_minutes: None,
                    break_duration_minutes: None,
                    break_time_start: None,
                    override_service_duration_minutes: None,
                    override_travel_duration_minutes: None,
                },
            ],
            stop_matrix_indices: vec![0, 1], // break uses dummy depot index
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 0.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // Depot departure: backward from 11:00 - 41 min = 10:19
        assert_eq!(result.depot_departure, hm(10, 19));

        // break: placed after 41 min travel (10:19+41=11:00), but customer is at 11:00
        // → break starts at 11:00, ends 11:45. Customer is late.
        // (This is expected — the break overflows into the customer's slot.)
        assert_eq!(result.stops[0].estimated_arrival, hm(11, 0));
        assert_eq!(result.stops[0].estimated_departure, hm(11, 45));
        assert_eq!(result.stops[0].duration_from_previous_minutes, 0);

        // customer1: cursor is 11:45, but scheduled at 11:00 → late
        assert_eq!(result.stops[1].estimated_arrival, hm(11, 0)); // pinned to scheduled
        assert_eq!(result.stops[1].estimated_departure, hm(11, 45));
    }

    // -----------------------------------------------------------------------
    // 9. Break after last customer
    // -----------------------------------------------------------------------
    #[test]
    fn break_after_last_customer() {
        // stops = [customer1(30min), break(45min)]
        // Break is last — no next customer, starts at cursor.
        let (dm, tm) = uniform_matrix(2, 5_000, 600); // 10 min

        let input = no_buffer_input(
            vec![make_customer(30), make_break(45)],
            vec![1, 0], // break uses dummy depot index
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // customer1: 08:10–08:40
        assert_eq!(result.stops[0].estimated_arrival, hm(8, 10));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 40));

        // break: starts at cursor (08:40), no next customer
        assert_eq!(result.stops[1].estimated_arrival, hm(8, 40));
        assert_eq!(result.stops[1].estimated_departure, hm(9, 25));
        assert_eq!(result.stops[1].duration_from_previous_minutes, 0);

        // return travel uses customer1 location
        assert_eq!(result.return_to_depot_distance_km, 5.0);
        assert_eq!(result.return_to_depot_duration_minutes, 10);
    }

    // -----------------------------------------------------------------------
    // 10. Break pinned to explicit break_time_start
    // -----------------------------------------------------------------------
    #[test]
    fn break_pinned_to_break_time_start() {
        // stops = [customer1(30min), break(45min, break_time_start=09:15), customer2(scheduled 10:00)]
        // matrix: 10 min travel, workday_start=08:00
        //
        // Expected:
        //   customer1: 08:10–08:40
        //   travel to customer2: 10 min (08:40–08:50)
        //   break: 09:15–10:00 (pinned, within gap 08:50–10:00)
        //   customer2: 10:00–10:45
        let (dm, tm) = uniform_matrix(3, 5_000, 600); // 10 min

        let input = no_buffer_input(
            vec![
                make_customer(30),
                make_break_pinned(45, hm(9, 15)),
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(10, 0)),
                    scheduled_time_end: Some(hm(10, 45)),
                    service_duration_minutes: Some(45),
                    device_type_default_duration_minutes: None,
                    break_duration_minutes: None,
                    break_time_start: None,
                    override_service_duration_minutes: None,
                    override_travel_duration_minutes: None,
                },
            ],
            vec![1, 0, 2], // break uses dummy depot index
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);

        assert_eq!(result.stops[0].estimated_arrival, hm(8, 10));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 40));

        // break pinned at 09:15 (within gap 08:50–10:00)
        assert_eq!(result.stops[1].estimated_arrival, hm(9, 15));
        assert_eq!(result.stops[1].estimated_departure, hm(10, 0));

        // customer2 pinned at 10:00
        assert_eq!(result.stops[2].estimated_arrival, hm(10, 0));
        assert_eq!(result.stops[2].estimated_departure, hm(10, 45));
        assert_eq!(result.stops[2].duration_from_previous_minutes, 10);
    }

    // -----------------------------------------------------------------------
    // 11. break_time_start before travel end → clamped to travel end
    // -----------------------------------------------------------------------
    #[test]
    fn break_time_start_before_travel_end_clamps_to_travel_end() {
        // break_time_start=08:45, but travel ends at 08:50 → clamped to 08:50
        let (dm, tm) = uniform_matrix(3, 5_000, 600); // 10 min

        let input = no_buffer_input(
            vec![
                make_customer(30),
                make_break_pinned(45, hm(8, 45)),
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(11, 0)),
                    scheduled_time_end: Some(hm(11, 45)),
                    service_duration_minutes: Some(45),
                    device_type_default_duration_minutes: None,
                    break_duration_minutes: None,
                    break_time_start: None,
                    override_service_duration_minutes: None,
                    override_travel_duration_minutes: None,
                },
            ],
            vec![1, 0, 2],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);

        // break_time_start 08:45 < travel_end 08:50 → clamped to 08:50
        assert_eq!(result.stops[1].estimated_arrival, hm(8, 50));
        assert_eq!(result.stops[1].estimated_departure, hm(9, 35));
    }

    // -----------------------------------------------------------------------
    // 12. Break causes late arrival when no gap
    // -----------------------------------------------------------------------
    #[test]
    fn break_causes_late_arrival_when_no_gap() {
        // customer1(30min), break(45min), customer2(scheduled 09:00)
        // matrix: 10 min travel, workday_start=08:00
        // travel ends 08:50, break 08:50–09:35, customer2 scheduled at 09:00 → late
        let (dm, tm) = uniform_matrix(3, 5_000, 600);

        let input = no_buffer_input(
            vec![
                make_customer(30),
                make_break(45),
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: Some(hm(9, 0)),
                    scheduled_time_end: Some(hm(9, 45)),
                    service_duration_minutes: Some(45),
                    device_type_default_duration_minutes: None,
                    break_duration_minutes: None,
                    break_time_start: None,
                    override_service_duration_minutes: None,
                    override_travel_duration_minutes: None,
                },
            ],
            vec![1, 0, 2],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);

        assert_eq!(result.stops[0].estimated_arrival, hm(8, 10));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 40));

        // break: travel ends 08:50, break 08:50–09:35
        assert_eq!(result.stops[1].estimated_arrival, hm(8, 50));
        assert_eq!(result.stops[1].estimated_departure, hm(9, 35));

        // customer2: scheduled at 09:00 but cursor is 09:35 → pinned to 09:00 (late)
        assert_eq!(result.stops[2].estimated_arrival, hm(9, 0));
        assert_eq!(result.stops[2].estimated_departure, hm(9, 45));
        assert_eq!(result.stops[2].duration_from_previous_minutes, 10);
    }

    // -----------------------------------------------------------------------
    // 13. Metrics unchanged: total time is same regardless of break position
    // -----------------------------------------------------------------------
    #[test]
    fn break_after_travel_metrics_unchanged() {
        // [customer1(30), break(45), customer2(30)] with 10 min travel everywhere.
        // Total travel: depot→c1(10) + c1→c2(10) + c2→depot(10) = 30 min
        // Total service: 30 + 45 + 30 = 105 min
        let (dm, tm) = uniform_matrix(3, 5_000, 600);

        let input = no_buffer_input(
            vec![make_customer(30), make_break(45), make_customer(30)],
            vec![1, 0, 2],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.total_travel_minutes, 30);
        assert_eq!(result.total_service_minutes, 105);
        assert_eq!(result.total_distance_km, 15.0); // 3 legs × 5 km
    }

    // -----------------------------------------------------------------------
    // 14. Explicit shorter service inside agreed window => flexible placement
    // -----------------------------------------------------------------------
    #[test]
    fn explicit_shorter_service_uses_flexible_window() {
        let (dm, tm) = uniform_matrix(2, 5_000, 600);

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 0)),
                service_duration_minutes: Some(45),
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            vec![1],
            hm(9, 5),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 15));
        assert_eq!(s.service_duration_minutes, 45);
        assert_eq!(s.estimated_departure, hm(10, 0));
    }

    // -----------------------------------------------------------------------
    // 15. Explicit full-window service keeps pinned behavior
    // -----------------------------------------------------------------------
    #[test]
    fn explicit_full_window_service_stays_pinned() {
        let (dm, tm) = uniform_matrix(2, 5_000, 600);

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 0)),
                service_duration_minutes: Some(60),
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            vec![1],
            hm(7, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 0));
        assert_eq!(s.estimated_departure, hm(10, 0));
    }

    // -----------------------------------------------------------------------
    // 16. Flexible window becomes infeasible when travel is too late
    // -----------------------------------------------------------------------
    #[test]
    fn flexible_window_infeasible_when_arrival_after_latest_start() {
        let (dm, tm) = uniform_matrix(2, 5_000, 3000);

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 0)),
                service_duration_minutes: Some(30),
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            vec![1],
            hm(9, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(9, 50));
        assert_eq!(s.estimated_departure, hm(10, 20));
    }

    // -----------------------------------------------------------------------
    // 17. Asymmetric matrix
    // -----------------------------------------------------------------------
    #[test]
    fn asymmetric_matrix() {
        let dm = vec![vec![0u64, 8_000], vec![6_000, 0u64]];
        let tm = vec![vec![0u64, 720], vec![600, 0u64]]; // 12 min / 10 min

        let input = no_buffer_input(
            vec![make_customer(30)],
            vec![1],
            hm(8, 0),
            60,
        );

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
    // 18. Metrics correct for multi-stop route
    // -----------------------------------------------------------------------
    #[test]
    fn metrics_correct_for_multi_stop() {
        let (dm, tm) = uniform_matrix(4, 5_000, 600);

        let input = no_buffer_input(
            vec![make_customer(20), make_customer(20), make_customer(20)],
            vec![1, 2, 3],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.total_distance_km, 20.0);
        assert_eq!(result.total_travel_minutes, 40);
        assert_eq!(result.total_service_minutes, 60);
    }

    // -----------------------------------------------------------------------
    // 19. Backward depot departure clamped; arrival still pinned to agreed
    // -----------------------------------------------------------------------
    #[test]
    fn backward_depot_departure_clamped_arrival_still_pinned() {
        let (dm, tm) = uniform_matrix(2, 50_000, 3600); // 60 min travel

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(7, 30)),
                scheduled_time_end: Some(hm(8, 30)),
                service_duration_minutes: None,
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            vec![1],
            hm(7, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.depot_departure, hm(7, 0));
        assert_eq!(result.stops[0].estimated_arrival, hm(7, 30));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 30));
    }

    // -----------------------------------------------------------------------
    // 20. Buffer increases travel time
    // -----------------------------------------------------------------------
    #[test]
    fn buffer_increases_travel_time() {
        let dm = vec![vec![0, 60_000], vec![60_000, 0]];
        let tm = vec![vec![0, 2400], vec![2400, 0]];

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: Some(60),
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 10.0,
            arrival_buffer_fixed_minutes: 5.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.stops[0].duration_from_previous_minutes, 49);
        assert_eq!(result.stops[0].estimated_arrival, hm(7, 49));
        assert_eq!(result.stops[0].estimated_departure, hm(8, 49));
        assert_eq!(result.return_to_depot_duration_minutes, 49);
    }

    // -----------------------------------------------------------------------
    // 21. Buffer affects backward depot departure
    // -----------------------------------------------------------------------
    #[test]
    fn buffer_affects_backward_depot_departure() {
        let dm = vec![vec![0, 40_000], vec![40_000, 0]];
        let tm = vec![vec![0, 1800], vec![1800, 0]];

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: Some(hm(9, 0)),
                scheduled_time_end: Some(hm(10, 0)),
                service_duration_minutes: None,
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            stop_matrix_indices: vec![1],
            workday_start: hm(7, 0),
            default_service_minutes: 60,
            arrival_buffer_percent: 20.0,
            arrival_buffer_fixed_minutes: 0.0,
        };

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.depot_departure, hm(8, 24));
        assert_eq!(result.stops[0].duration_from_previous_minutes, 36);
    }

    // -----------------------------------------------------------------------
    // 22. Zero buffer matches raw travel
    // -----------------------------------------------------------------------
    #[test]
    fn zero_buffer_matches_raw_travel() {
        let dm = vec![vec![0, 50_000], vec![50_000, 0]];
        let tm = vec![vec![0, 2340], vec![2340, 0]]; // 39 min raw

        let input = no_buffer_input(
            vec![make_customer(60)],
            vec![1],
            hm(7, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        assert_eq!(result.stops[0].duration_from_previous_minutes, 39);
    }

    // -----------------------------------------------------------------------
    // 23. Override: travel duration override replaces matrix value
    // -----------------------------------------------------------------------
    #[test]
    fn override_travel_duration_replaces_matrix() {
        let (dm, tm) = uniform_matrix(2, 10_000, 900); // 15 min

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: Some(30),
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: Some(60),
            }],
            vec![1],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.duration_from_previous_minutes, 60);
        assert_eq!(s.estimated_arrival, hm(9, 0));
        assert_eq!(s.estimated_departure, hm(9, 30));
    }

    // -----------------------------------------------------------------------
    // 24. Override: service duration override replaces calculated value
    // -----------------------------------------------------------------------
    #[test]
    fn override_service_duration_replaces_calculated() {
        let (dm, tm) = uniform_matrix(2, 10_000, 900); // 15 min travel

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: Some(30),
                device_type_default_duration_minutes: None,
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: Some(45),
                override_travel_duration_minutes: None,
            }],
            vec![1],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(8, 15));
        assert_eq!(s.service_duration_minutes, 45);
        assert_eq!(s.estimated_departure, hm(9, 0));
    }

    // -----------------------------------------------------------------------
    // 25. Override: both travel and service overrides together
    // -----------------------------------------------------------------------
    #[test]
    fn both_overrides_together() {
        let (dm, tm) = uniform_matrix(3, 10_000, 900); // 15 min travel

        let input = no_buffer_input(
            vec![
                ScheduleStop {
                    stop_type: StopType::Customer,
                    scheduled_time_start: None,
                    scheduled_time_end: None,
                    service_duration_minutes: Some(30),
                    device_type_default_duration_minutes: None,
                    break_duration_minutes: None,
                    break_time_start: None,
                    override_service_duration_minutes: Some(45),
                    override_travel_duration_minutes: Some(20),
                },
                make_customer(30),
            ],
            vec![1, 2],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let a = &result.stops[0];
        assert_eq!(a.duration_from_previous_minutes, 20);
        assert_eq!(a.estimated_arrival, hm(8, 20));
        assert_eq!(a.service_duration_minutes, 45);
        assert_eq!(a.estimated_departure, hm(9, 5));

        let b = &result.stops[1];
        assert_eq!(b.duration_from_previous_minutes, 15);
        assert_eq!(b.estimated_arrival, hm(9, 20));
        assert_eq!(b.service_duration_minutes, 30);
        assert_eq!(b.estimated_departure, hm(9, 50));
    }

    // -----------------------------------------------------------------------
    // 26. Device-type default beats global default when no explicit stop duration
    // -----------------------------------------------------------------------
    #[test]
    fn device_type_default_beats_global_default_when_no_explicit_stop_duration() {
        let (dm, tm) = uniform_matrix(2, 5_000, 600);

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: None,
                device_type_default_duration_minutes: Some(45),
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            vec![1],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.estimated_arrival, hm(8, 10));
        assert_eq!(s.service_duration_minutes, 45);
        assert_eq!(s.estimated_departure, hm(8, 55));
    }

    // -----------------------------------------------------------------------
    // 27. Explicit stop duration beats device-type default
    // -----------------------------------------------------------------------
    #[test]
    fn explicit_stop_duration_beats_device_type_default() {
        let (dm, tm) = uniform_matrix(2, 5_000, 600);

        let input = no_buffer_input(
            vec![ScheduleStop {
                stop_type: StopType::Customer,
                scheduled_time_start: None,
                scheduled_time_end: None,
                service_duration_minutes: Some(30),
                device_type_default_duration_minutes: Some(45),
                break_duration_minutes: None,
                break_time_start: None,
                override_service_duration_minutes: None,
                override_travel_duration_minutes: None,
            }],
            vec![1],
            hm(8, 0),
            60,
        );

        let result = compute_sequential_schedule(&input, &dm, &tm);
        let s = &result.stops[0];
        assert_eq!(s.service_duration_minutes, 30);
        assert_eq!(s.estimated_departure, hm(8, 40));
    }
}
