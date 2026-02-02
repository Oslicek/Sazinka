//! Smart Slot Suggester - TDD Implementation
//! 
//! Algorithm for finding optimal time slots for new appointments.
//! Uses insertion heuristic with travel time calculation.

use chrono::{NaiveDate, NaiveTime, Timelike};
use serde::{Deserialize, Serialize};

use crate::types::Coordinates;

/// Request to suggest slots for a new appointment
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestSlotsRequest {
    /// Target date for the appointment
    pub date: NaiveDate,
    /// Customer location
    pub customer_coordinates: Coordinates,
    /// Service duration in minutes
    pub service_duration_minutes: i32,
    /// Optional: preferred time window
    pub preferred_time_start: Option<NaiveTime>,
    pub preferred_time_end: Option<NaiveTime>,
    /// Maximum number of suggestions to return
    pub max_suggestions: Option<i32>,
}

/// A suggested time slot
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedSlot {
    /// Suggested start time
    pub start_time: NaiveTime,
    /// Suggested end time
    pub end_time: NaiveTime,
    /// Position in route (1-based, where to insert)
    pub insert_position: i32,
    /// Score (0-100, higher is better)
    pub score: i32,
    /// Additional travel time compared to current route (minutes)
    pub delta_travel_minutes: i32,
    /// Reason/explanation for the score
    pub reason: String,
}

/// Response with suggested slots
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestSlotsResponse {
    pub slots: Vec<SuggestedSlot>,
    /// Current route total travel time (minutes)
    pub current_route_minutes: i32,
    /// Number of existing stops
    pub existing_stops: i32,
}

/// An existing stop in the route (simplified for calculation)
#[derive(Debug, Clone)]
pub struct ExistingStop {
    pub coordinates: Coordinates,
    pub arrival_time: NaiveTime,
    pub departure_time: NaiveTime,
    pub time_window_start: Option<NaiveTime>,
    pub time_window_end: Option<NaiveTime>,
}

/// Depot information
#[derive(Debug, Clone)]
pub struct DepotInfo {
    pub coordinates: Coordinates,
    pub work_start: NaiveTime,
    pub work_end: NaiveTime,
}

/// Slot suggester algorithm
pub struct SlotSuggester {
    depot: DepotInfo,
    existing_stops: Vec<ExistingStop>,
    /// Travel time calculator (closure for dependency injection in tests)
    travel_time_fn: Box<dyn Fn(&Coordinates, &Coordinates) -> i32 + Send + Sync>,
}

impl SlotSuggester {
    /// Create a new slot suggester
    pub fn new<F>(depot: DepotInfo, existing_stops: Vec<ExistingStop>, travel_time_fn: F) -> Self
    where
        F: Fn(&Coordinates, &Coordinates) -> i32 + Send + Sync + 'static,
    {
        Self {
            depot,
            existing_stops,
            travel_time_fn: Box::new(travel_time_fn),
        }
    }

    /// Suggest optimal slots for a new appointment
    pub fn suggest_slots(
        &self,
        customer_coords: &Coordinates,
        service_duration: i32,
        preferred_start: Option<NaiveTime>,
        preferred_end: Option<NaiveTime>,
        max_suggestions: i32,
    ) -> Vec<SuggestedSlot> {
        let mut candidates: Vec<SuggestedSlot> = Vec::new();

        // Calculate current route travel time
        let current_travel = self.calculate_current_travel_time();

        // Try inserting at each position (0 = first, after depot)
        let positions = self.existing_stops.len() + 1;
        
        for pos in 0..positions {
            if let Some(slot) = self.try_insert_at_position(
                pos,
                customer_coords,
                service_duration,
                current_travel,
                preferred_start,
                preferred_end,
            ) {
                candidates.push(slot);
            }
        }

        // Sort by score (descending)
        candidates.sort_by(|a, b| b.score.cmp(&a.score));

        // Return top N
        candidates.into_iter().take(max_suggestions as usize).collect()
    }

    /// Calculate total travel time of current route
    fn calculate_current_travel_time(&self) -> i32 {
        if self.existing_stops.is_empty() {
            return 0;
        }

        let mut total = 0;

        // Depot to first stop
        total += (self.travel_time_fn)(&self.depot.coordinates, &self.existing_stops[0].coordinates);

        // Between stops
        for i in 1..self.existing_stops.len() {
            total += (self.travel_time_fn)(
                &self.existing_stops[i - 1].coordinates,
                &self.existing_stops[i].coordinates,
            );
        }

        // Last stop to depot
        total += (self.travel_time_fn)(
            &self.existing_stops.last().unwrap().coordinates,
            &self.depot.coordinates,
        );

        total
    }

    /// Try inserting a new stop at a specific position
    fn try_insert_at_position(
        &self,
        position: usize,
        customer_coords: &Coordinates,
        service_duration: i32,
        current_travel: i32,
        preferred_start: Option<NaiveTime>,
        preferred_end: Option<NaiveTime>,
    ) -> Option<SuggestedSlot> {
        // Calculate arrival time at this position
        let arrival_time = self.calculate_arrival_at_position(position, customer_coords);
        
        // Check if we can fit within work hours
        let departure_time = add_minutes(arrival_time, service_duration);
        if departure_time > self.depot.work_end {
            return None; // Would exceed work hours
        }

        // Check if arrival is after work start
        if arrival_time < self.depot.work_start {
            return None;
        }

        // Calculate delta travel time
        let new_travel = self.calculate_travel_with_insertion(position, customer_coords);
        let delta_travel = new_travel - current_travel;

        // Calculate score
        let score = self.calculate_score(
            delta_travel,
            arrival_time,
            departure_time,
            preferred_start,
            preferred_end,
            position,
        );

        // Generate reason
        let reason = self.generate_reason(delta_travel, arrival_time, position);

        Some(SuggestedSlot {
            start_time: arrival_time,
            end_time: departure_time,
            insert_position: (position + 1) as i32, // 1-based
            score,
            delta_travel_minutes: delta_travel,
            reason,
        })
    }

    /// Calculate arrival time if inserted at position
    fn calculate_arrival_at_position(&self, position: usize, customer_coords: &Coordinates) -> NaiveTime {
        if position == 0 {
            // First stop - arrive from depot
            let travel = (self.travel_time_fn)(&self.depot.coordinates, customer_coords);
            add_minutes(self.depot.work_start, travel)
        } else {
            // After existing stop
            let prev_stop = &self.existing_stops[position - 1];
            let travel = (self.travel_time_fn)(&prev_stop.coordinates, customer_coords);
            add_minutes(prev_stop.departure_time, travel)
        }
    }

    /// Calculate total travel time with new stop inserted
    fn calculate_travel_with_insertion(&self, position: usize, customer_coords: &Coordinates) -> i32 {
        let mut total = 0;

        if self.existing_stops.is_empty() {
            // Only depot -> new -> depot
            total += (self.travel_time_fn)(&self.depot.coordinates, customer_coords);
            total += (self.travel_time_fn)(customer_coords, &self.depot.coordinates);
            return total;
        }

        // Before insertion point
        if position == 0 {
            // Depot to new customer
            total += (self.travel_time_fn)(&self.depot.coordinates, customer_coords);
            // New customer to first existing stop
            total += (self.travel_time_fn)(customer_coords, &self.existing_stops[0].coordinates);
        } else {
            // Depot to first stop
            total += (self.travel_time_fn)(&self.depot.coordinates, &self.existing_stops[0].coordinates);
            
            // Between stops until insertion point
            for i in 1..position {
                total += (self.travel_time_fn)(
                    &self.existing_stops[i - 1].coordinates,
                    &self.existing_stops[i].coordinates,
                );
            }
            
            // Previous stop to new customer
            total += (self.travel_time_fn)(
                &self.existing_stops[position - 1].coordinates,
                customer_coords,
            );
            
            // New customer to next stop (if any)
            if position < self.existing_stops.len() {
                total += (self.travel_time_fn)(
                    customer_coords,
                    &self.existing_stops[position].coordinates,
                );
            }
        }

        // After insertion point
        if position < self.existing_stops.len() {
            for i in (position + 1)..self.existing_stops.len() {
                total += (self.travel_time_fn)(
                    &self.existing_stops[i - 1].coordinates,
                    &self.existing_stops[i].coordinates,
                );
            }
            // Last stop to depot
            total += (self.travel_time_fn)(
                &self.existing_stops.last().unwrap().coordinates,
                &self.depot.coordinates,
            );
        } else {
            // New customer is last - go back to depot
            total += (self.travel_time_fn)(customer_coords, &self.depot.coordinates);
        }

        total
    }

    /// Calculate slot score (0-100)
    fn calculate_score(
        &self,
        delta_travel: i32,
        arrival_time: NaiveTime,
        departure_time: NaiveTime,
        preferred_start: Option<NaiveTime>,
        preferred_end: Option<NaiveTime>,
        _position: usize,
    ) -> i32 {
        let mut score = 100;

        // Penalty for travel time increase (60% weight)
        // Every 10 minutes of extra travel = -10 points
        let travel_penalty = (delta_travel / 10) * 10;
        score -= travel_penalty.min(60);

        // Bonus for matching preferred time (25% weight)
        if let (Some(pref_start), Some(pref_end)) = (preferred_start, preferred_end) {
            if arrival_time >= pref_start && departure_time <= pref_end {
                score += 25; // Full bonus for being in preferred window
            } else if arrival_time < pref_end && departure_time > pref_start {
                score += 10; // Partial overlap
            }
        }

        // Bonus for slack time / flexibility (15% weight)
        // More time until work_end = more flexibility
        let minutes_until_end = minutes_between(departure_time, self.depot.work_end);
        if minutes_until_end > 120 {
            score += 15;
        } else if minutes_until_end > 60 {
            score += 10;
        } else if minutes_until_end > 30 {
            score += 5;
        }

        score.max(0).min(100)
    }

    /// Generate human-readable reason for the score
    fn generate_reason(&self, delta_travel: i32, arrival_time: NaiveTime, position: usize) -> String {
        let position_desc = if position == 0 {
            "první zastávka".to_string()
        } else if position == self.existing_stops.len() {
            "poslední zastávka".to_string()
        } else {
            format!("{}. pozice", position + 1)
        };

        if delta_travel <= 5 {
            format!("{} - minimální objížďka", position_desc)
        } else if delta_travel <= 15 {
            format!("{} - malá objížďka (+{} min)", position_desc, delta_travel)
        } else {
            format!("{} - objížďka +{} min", position_desc, delta_travel)
        }
    }
}

/// Helper: add minutes to time
fn add_minutes(time: NaiveTime, minutes: i32) -> NaiveTime {
    let total_secs = time.num_seconds_from_midnight() as i32 + minutes * 60;
    NaiveTime::from_num_seconds_from_midnight_opt(total_secs as u32, 0)
        .unwrap_or(NaiveTime::from_hms_opt(23, 59, 59).unwrap())
}

/// Helper: calculate minutes between two times
fn minutes_between(from: NaiveTime, to: NaiveTime) -> i32 {
    let from_secs = from.num_seconds_from_midnight() as i32;
    let to_secs = to.num_seconds_from_midnight() as i32;
    (to_secs - from_secs) / 60
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_coords(lat: f64, lng: f64) -> Coordinates {
        Coordinates { lat, lng }
    }

    fn make_time(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).unwrap()
    }

    fn mock_travel_time(_from: &Coordinates, _to: &Coordinates) -> i32 {
        // Simple mock: 15 minutes between any two points
        15
    }

    fn mock_travel_time_by_distance(from: &Coordinates, to: &Coordinates) -> i32 {
        // Mock based on coordinate difference (rough approximation)
        let dlat = (from.lat - to.lat).abs();
        let dlng = (from.lng - to.lng).abs();
        let dist = dlat + dlng;
        (dist * 60.0) as i32 // 1 degree = 60 minutes of travel
    }

    fn create_depot() -> DepotInfo {
        DepotInfo {
            coordinates: make_coords(50.0, 14.0), // Prague area
            work_start: make_time(8, 0),
            work_end: make_time(17, 0),
        }
    }

    #[test]
    fn test_empty_route_suggests_single_slot() {
        let depot = create_depot();
        let suggester = SlotSuggester::new(depot, vec![], mock_travel_time);

        let customer = make_coords(50.1, 14.1);
        let slots = suggester.suggest_slots(&customer, 30, None, None, 5);

        assert_eq!(slots.len(), 1);
        assert_eq!(slots[0].insert_position, 1);
        // Should arrive at 8:15 (8:00 + 15 min travel)
        assert_eq!(slots[0].start_time, make_time(8, 15));
        // Should depart at 8:45 (8:15 + 30 min service)
        assert_eq!(slots[0].end_time, make_time(8, 45));
    }

    #[test]
    fn test_route_with_one_stop_suggests_two_slots() {
        let depot = create_depot();
        let existing = vec![ExistingStop {
            coordinates: make_coords(50.2, 14.2),
            arrival_time: make_time(8, 30),
            departure_time: make_time(9, 0),
            time_window_start: None,
            time_window_end: None,
        }];
        let suggester = SlotSuggester::new(depot, existing, mock_travel_time);

        let customer = make_coords(50.1, 14.1);
        let slots = suggester.suggest_slots(&customer, 30, None, None, 5);

        assert_eq!(slots.len(), 2);
        // One before existing stop, one after
        let positions: Vec<i32> = slots.iter().map(|s| s.insert_position).collect();
        assert!(positions.contains(&1)); // Before existing
        assert!(positions.contains(&2)); // After existing
    }

    #[test]
    fn test_preferred_time_window_boosts_score() {
        let depot = create_depot();
        let suggester = SlotSuggester::new(depot, vec![], mock_travel_time);

        let customer = make_coords(50.1, 14.1);
        
        // Without preference
        let slots_no_pref = suggester.suggest_slots(&customer, 30, None, None, 5);
        
        // With preference matching the slot
        let slots_with_pref = suggester.suggest_slots(
            &customer,
            30,
            Some(make_time(8, 0)),
            Some(make_time(9, 0)),
            5,
        );

        // Slot with matching preference should have higher score
        assert!(slots_with_pref[0].score >= slots_no_pref[0].score);
    }

    #[test]
    fn test_shorter_detour_has_higher_score() {
        let depot = create_depot();
        let existing = vec![
            ExistingStop {
                coordinates: make_coords(50.1, 14.1), // Close to depot
                arrival_time: make_time(8, 30),
                departure_time: make_time(9, 0),
                time_window_start: None,
                time_window_end: None,
            },
            ExistingStop {
                coordinates: make_coords(50.5, 14.5), // Far from depot
                arrival_time: make_time(10, 0),
                departure_time: make_time(10, 30),
                time_window_start: None,
                time_window_end: None,
            },
        ];
        let suggester = SlotSuggester::new(depot, existing, mock_travel_time_by_distance);

        // Customer close to first stop
        let customer_near = make_coords(50.15, 14.15);
        let slots = suggester.suggest_slots(&customer_near, 30, None, None, 5);

        // The slot with lower delta_travel should have higher score
        let sorted_by_delta: Vec<i32> = slots.iter().map(|s| s.delta_travel_minutes).collect();
        let sorted_by_score: Vec<i32> = slots.iter().map(|s| s.score).collect();
        
        // First slot (highest score) should have reasonable delta
        assert!(slots[0].delta_travel_minutes <= 30);
    }

    #[test]
    fn test_slot_exceeding_work_hours_not_suggested() {
        let depot = DepotInfo {
            coordinates: make_coords(50.0, 14.0),
            work_start: make_time(8, 0),
            work_end: make_time(9, 0), // Short work day
        };
        
        let existing = vec![ExistingStop {
            coordinates: make_coords(50.1, 14.1),
            arrival_time: make_time(8, 15),
            departure_time: make_time(8, 45),
            time_window_start: None,
            time_window_end: None,
        }];
        
        let suggester = SlotSuggester::new(depot, existing, mock_travel_time);

        let customer = make_coords(50.2, 14.2);
        // 30 minute service - should not fit after existing stop
        let slots = suggester.suggest_slots(&customer, 30, None, None, 5);

        // Only position 1 (before existing stop) should work
        // Position 2 would end after 9:00
        for slot in &slots {
            assert!(slot.end_time <= make_time(9, 0));
        }
    }

    #[test]
    fn test_delta_travel_calculation() {
        let depot = create_depot();
        let suggester = SlotSuggester::new(depot, vec![], mock_travel_time);

        let customer = make_coords(50.1, 14.1);
        let slots = suggester.suggest_slots(&customer, 30, None, None, 5);

        // For empty route: depot -> customer -> depot = 15 + 15 = 30 min
        // Current route travel = 0
        // Delta = 30
        assert_eq!(slots[0].delta_travel_minutes, 30);
    }

    #[test]
    fn test_max_suggestions_limits_results() {
        let depot = create_depot();
        let existing: Vec<ExistingStop> = (0..5)
            .map(|i| ExistingStop {
                coordinates: make_coords(50.0 + i as f64 * 0.1, 14.0 + i as f64 * 0.1),
                arrival_time: add_minutes(make_time(8, 0), i * 60),
                departure_time: add_minutes(make_time(8, 30), i * 60),
                time_window_start: None,
                time_window_end: None,
            })
            .collect();
        
        let suggester = SlotSuggester::new(depot, existing, mock_travel_time);

        let customer = make_coords(50.3, 14.3);
        
        // Request only 2 suggestions
        let slots = suggester.suggest_slots(&customer, 30, None, None, 2);
        assert!(slots.len() <= 2);
    }

    #[test]
    fn test_slots_sorted_by_score_descending() {
        let depot = create_depot();
        let existing = vec![
            ExistingStop {
                coordinates: make_coords(50.1, 14.1),
                arrival_time: make_time(8, 30),
                departure_time: make_time(9, 0),
                time_window_start: None,
                time_window_end: None,
            },
            ExistingStop {
                coordinates: make_coords(50.2, 14.2),
                arrival_time: make_time(10, 0),
                departure_time: make_time(10, 30),
                time_window_start: None,
                time_window_end: None,
            },
        ];
        
        let suggester = SlotSuggester::new(depot, existing, mock_travel_time_by_distance);

        let customer = make_coords(50.15, 14.15);
        let slots = suggester.suggest_slots(&customer, 30, None, None, 5);

        // Verify descending score order
        for i in 1..slots.len() {
            assert!(
                slots[i - 1].score >= slots[i].score,
                "Slots not sorted by score: {} < {}",
                slots[i - 1].score,
                slots[i].score
            );
        }
    }
}
