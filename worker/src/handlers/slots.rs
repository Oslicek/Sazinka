//! Slot suggestion handlers

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use anyhow::Result;
use async_nats::{Client, Subscriber};
use chrono::NaiveTime;
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::defaults::DEFAULT_SERVICE_DURATION_MINUTES;
use crate::services::insertion::{calculate_insertion_positions, time_overlap_minutes, StopMeta};
use crate::services::routing::{MockRoutingService, RoutingService};
use crate::services::slot_suggester::{
    DepotInfo, ExistingStop, SlotSuggester, SuggestSlotsRequest, SuggestSlotsResponse,
};
use crate::types::{Coordinates, ErrorResponse, Request, SuccessResponse};

/// Helper macro for error responses
macro_rules! error_response {
    ($request_id:expr, $code:expr, $msg:expr) => {
        ErrorResponse::new($request_id, $code, $msg)
    };
}

/// Handle slot suggestions
pub async fn handle_suggest(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received slots.suggest message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<SuggestSlotsRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let response = error_response!(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&response).unwrap().into())
                    .await;
                continue;
            }
        };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let response = error_response!(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client
                    .publish(reply, serde_json::to_vec(&response).unwrap().into())
                    .await;
                continue;
            }
        };

        let req = request.payload;

        // Get user settings for depot location and work hours
        let settings = match queries::settings::get_user_settings(&pool, user_id).await {
            Ok(Some(s)) => s,
            Ok(None) => {
                let response = error_response!(request.id, "NOT_FOUND", "User settings not found");
                let _ = client
                    .publish(reply, serde_json::to_vec(&response).unwrap().into())
                    .await;
                continue;
            }
            Err(e) => {
                error!("Failed to get settings: {}", e);
                let response = error_response!(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&response).unwrap().into())
                    .await;
                continue;
            }
        };

        // Build depot info
        let depot = DepotInfo {
            coordinates: Coordinates {
                lat: settings.lat.unwrap_or(50.0),
                lng: settings.lng.unwrap_or(14.4),
            },
            work_start: settings.working_hours_start,
            work_end: settings.working_hours_end,
        };

        // Load existing scheduled revisions for the date
        let existing_revisions = match queries::revision::list_revisions(
            &pool,
            user_id,
            None,
            None,
            Some("scheduled"),
            Some(req.date),
            Some(req.date),
            Some("scheduled"),
            Some(50),
            Some(0),
        )
        .await
        {
            Ok(revs) => revs,
            Err(e) => {
                error!("Failed to load revisions: {}", e);
                let response = error_response!(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&response).unwrap().into())
                    .await;
                continue;
            }
        };

        // Convert to ExistingStop format
        let existing_stops: Vec<ExistingStop> = existing_revisions
            .iter()
            .filter_map(|rev| {
                // Need customer coordinates - get from customer
                // For now, use a simplified approach
                let coords = Coordinates {
                    lat: 50.0 + (rev.id.as_bytes()[0] as f64 / 255.0) * 0.5,
                    lng: 14.0 + (rev.id.as_bytes()[1] as f64 / 255.0) * 0.5,
                };
                
                let arrival = rev.scheduled_time_start?;
                let duration = rev
                    .duration_minutes
                    .unwrap_or(DEFAULT_SERVICE_DURATION_MINUTES as i32);
                let departure = add_minutes(arrival, duration);
                
                Some(ExistingStop {
                    coordinates: coords,
                    arrival_time: arrival,
                    departure_time: departure,
                    time_window_start: rev.scheduled_time_start,
                    time_window_end: rev.scheduled_time_end,
                })
            })
            .collect();

        // Create suggester with simple travel time estimation
        // In production, this would use Valhalla for real routing
        let suggester = SlotSuggester::new(depot.clone(), existing_stops.clone(), |from, to| {
            // Simple Euclidean distance -> time estimation
            // ~1 degree = 111 km, assume 50 km/h average speed
            let dlat = (from.lat - to.lat).abs();
            let dlng = (from.lng - to.lng).abs();
            let dist_km = ((dlat * dlat + dlng * dlng).sqrt()) * 111.0;
            (dist_km / 50.0 * 60.0) as i32 // minutes
        });

        // Generate suggestions
        let slots = suggester.suggest_slots(
            &req.customer_coordinates,
            req.service_duration_minutes,
            req.preferred_time_start,
            req.preferred_time_end,
            req.max_suggestions.unwrap_or(5),
        );

        // Calculate current route travel time
        let current_route_minutes = if existing_stops.is_empty() {
            0
        } else {
            // Simplified calculation
            existing_stops.len() as i32 * 15 // rough estimate
        };

        let response = SuggestSlotsResponse {
            slots,
            current_route_minutes,
            existing_stops: existing_stops.len() as i32,
        };

        let _ = client
            .publish(reply, serde_json::to_vec(&response).unwrap().into())
            .await;
    }

    Ok(())
}

/// Helper: add minutes to time
fn add_minutes(time: NaiveTime, minutes: i32) -> NaiveTime {
    use chrono::Timelike;
    let total_secs = time.num_seconds_from_midnight() as i32 + minutes * 60;
    NaiveTime::from_num_seconds_from_midnight_opt(total_secs as u32, 0)
        .unwrap_or(NaiveTime::from_hms_opt(23, 59, 59).unwrap())
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestSlotsV2Request {
    pub date: chrono::NaiveDate,
    pub customer_id: Uuid,
    pub service_duration_minutes: i32,
    pub preferred_time_start: Option<NaiveTime>,
    pub preferred_time_end: Option<NaiveTime>,
    pub crew_ids: Option<Vec<Uuid>>,
    pub max_per_crew: Option<i32>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotWarning {
    pub severity: String,
    pub warning_type: String,
    pub message: String,
    pub conflicting_customer: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrewSlotSuggestion {
    pub crew_id: Uuid,
    pub crew_name: String,
    pub start_time: NaiveTime,
    pub end_time: NaiveTime,
    pub insert_position: i32,
    pub score: i32,
    pub delta_travel_minutes: i32,
    pub delta_distance_km: f64,
    pub estimated_arrival: NaiveTime,
    pub slack_before_minutes: i32,
    pub slack_after_minutes: i32,
    pub day_load_percent: i32,
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestSlotsV2Response {
    pub suggestions: Vec<CrewSlotSuggestion>,
    pub warnings: Vec<SlotWarning>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateSlotRequest {
    pub date: chrono::NaiveDate,
    pub customer_id: Uuid,
    pub crew_id: Uuid,
    pub time_start: NaiveTime,
    pub time_end: NaiveTime,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateSlotResponse {
    pub feasible: bool,
    pub warnings: Vec<SlotWarning>,
    pub estimated_arrival: Option<NaiveTime>,
    pub slack_before_minutes: Option<i32>,
    pub slack_after_minutes: Option<i32>,
}

#[derive(Debug, Clone)]
struct CrewDayStop {
    customer_name: String,
    coordinates: Coordinates,
    arrival_time: Option<NaiveTime>,
    departure_time: Option<NaiveTime>,
    time_window_start: Option<NaiveTime>,
    time_window_end: Option<NaiveTime>,
    service_duration_minutes: i32,
}

fn stop_start(stop: &CrewDayStop) -> Option<NaiveTime> {
    stop.arrival_time.or(stop.time_window_start)
}

fn stop_end(stop: &CrewDayStop) -> Option<NaiveTime> {
    stop.departure_time
        .or_else(|| stop_start(stop).map(|s| add_minutes(s, stop.service_duration_minutes)))
        .or(stop.time_window_end)
}

fn minutes_between(start: NaiveTime, end: NaiveTime) -> i32 {
    (end - start).num_minutes().max(0) as i32
}

fn day_load_percent(
    work_start: NaiveTime,
    work_end: NaiveTime,
    service_minutes: i32,
    travel_minutes: i32,
) -> i32 {
    let capacity = minutes_between(work_start, work_end).max(1);
    (((service_minutes + travel_minutes) as f64 / capacity as f64) * 100.0).round() as i32
}

fn preference_score(
    start: NaiveTime,
    end: NaiveTime,
    preferred_start: Option<NaiveTime>,
    preferred_end: Option<NaiveTime>,
) -> f64 {
    match (preferred_start, preferred_end) {
        (Some(ps), Some(pe)) if pe > ps => {
            let overlap = time_overlap_minutes(start, end, ps, pe).max(0) as f64;
            let preferred_len = minutes_between(ps, pe).max(1) as f64;
            (overlap / preferred_len * 100.0).clamp(0.0, 100.0)
        }
        _ => 70.0,
    }
}

fn slot_score(
    delta_minutes: i32,
    slack_before: i32,
    slack_after: i32,
    start: NaiveTime,
    end: NaiveTime,
    preferred_start: Option<NaiveTime>,
    preferred_end: Option<NaiveTime>,
    crew_load: i32,
    avg_load: i32,
) -> i32 {
    let travel = (100.0 - (delta_minutes as f64 * 3.0)).clamp(0.0, 100.0);
    let fit = ((slack_before + slack_after) as f64 / 2.0).clamp(0.0, 100.0);
    let pref = preference_score(start, end, preferred_start, preferred_end);
    let balance = (100.0 - ((crew_load - avg_load).abs() as f64 * 2.0)).clamp(0.0, 100.0);
    (0.40 * travel + 0.25 * fit + 0.20 * pref + 0.15 * balance).round() as i32
}

async fn resolve_depot_for_crew(
    pool: &PgPool,
    user_id: Uuid,
    crew: &crate::types::Crew,
    settings: &crate::types::settings::UserWithSettings,
) -> Coordinates {
    if let Some(home_id) = crew.home_depot_id {
        if let Ok(Some(depot)) = queries::settings::get_depot(pool, home_id, user_id).await {
            return Coordinates { lat: depot.lat, lng: depot.lng };
        }
    }
    if let Some(default_id) = settings.default_depot_id {
        if let Ok(Some(depot)) = queries::settings::get_depot(pool, default_id, user_id).await {
            return Coordinates { lat: depot.lat, lng: depot.lng };
        }
    }
    Coordinates {
        lat: settings.lat.unwrap_or(50.0755),
        lng: settings.lng.unwrap_or(14.4378),
    }
}

async fn build_crew_day_stops(
    pool: &PgPool,
    user_id: Uuid,
    date: chrono::NaiveDate,
    crew_id: Uuid,
) -> Result<Vec<CrewDayStop>> {
    let routes = queries::route::list_routes_for_date(pool, user_id, date).await?;
    let route_for_crew = routes.into_iter().find(|r| r.crew_id == Some(crew_id));
    let mut out: Vec<CrewDayStop> = vec![];
    let mut existing_customer_ids: HashSet<Uuid> = HashSet::new();
    if let Some(route) = route_for_crew {
        let route_stops = queries::route::get_route_stops_with_info(pool, route.id).await?;
        for s in route_stops {
            if s.stop_type == "break" {
                continue;
            }
            if let (Some(customer_id), Some(lat), Some(lng)) = (s.customer_id, s.customer_lat, s.customer_lng) {
                existing_customer_ids.insert(customer_id);
                let start = s.estimated_arrival.or(s.scheduled_time_start);
                let end = s.estimated_departure.or(s.scheduled_time_end);
                let duration = match (start, end) {
                    (Some(a), Some(b)) if b > a => minutes_between(a, b),
                    _ => DEFAULT_SERVICE_DURATION_MINUTES as i32,
                };
                out.push(CrewDayStop {
                    customer_name: s.customer_name.unwrap_or_else(|| "Zákazník".to_string()),
                    coordinates: Coordinates { lat, lng },
                    arrival_time: s.estimated_arrival,
                    departure_time: s.estimated_departure,
                    time_window_start: s.scheduled_time_start,
                    time_window_end: s.scheduled_time_end,
                    service_duration_minutes: duration,
                });
            }
        }
    }

    let revisions = queries::revision::list_revisions_for_date(pool, user_id, date).await?;
    let mut customer_cache: HashMap<Uuid, Option<crate::types::Customer>> = HashMap::new();
    for rev in revisions {
        if rev.assigned_crew_id != Some(crew_id) {
            continue;
        }
        if existing_customer_ids.contains(&rev.customer_id) {
            continue;
        }
        if rev.scheduled_time_start.is_none() {
            continue;
        }
        let customer = if let Some(cached) = customer_cache.get(&rev.customer_id) {
            cached.clone()
        } else {
            let fetched = queries::customer::get_customer(pool, user_id, rev.customer_id).await?;
            customer_cache.insert(rev.customer_id, fetched.clone());
            fetched
        };
        let Some(c) = customer else {
            continue;
        };
        let (Some(lat), Some(lng)) = (c.lat, c.lng) else {
            continue;
        };
        existing_customer_ids.insert(rev.customer_id);
        let start = rev.scheduled_time_start;
        let duration = rev
            .duration_minutes
            .unwrap_or(DEFAULT_SERVICE_DURATION_MINUTES as i32);
        let departure = start.map(|s| add_minutes(s, duration));
        out.push(CrewDayStop {
            customer_name: c.name.unwrap_or_else(|| "Zákazník".to_string()),
            coordinates: Coordinates { lat, lng },
            arrival_time: start,
            departure_time: departure,
            time_window_start: rev.scheduled_time_start,
            time_window_end: rev.scheduled_time_end,
            service_duration_minutes: duration,
        });
    }

    out.sort_by_key(|s| stop_start(s).unwrap_or(NaiveTime::from_hms_opt(23, 59, 59).expect("valid time")));
    Ok(out)
}

pub async fn handle_suggest_v2(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
    routing_service: Arc<dyn RoutingService>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received slots.suggest.v2 message");
        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => continue,
        };

        let request: Request<SuggestSlotsV2Request> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let response = error_response!(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let response = error_response!(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };

        let req = request.payload;
        let settings = match queries::settings::get_user_settings(&pool, user_id).await? {
            Some(s) => s,
            None => {
                let response = error_response!(request.id, "NOT_FOUND", "User settings not found");
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };
        let customer = match queries::customer::get_customer(&pool, user_id, req.customer_id).await? {
            Some(c) => c,
            None => {
                let response = error_response!(request.id, "NOT_FOUND", "Customer not found");
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };
        let (Some(customer_lat), Some(customer_lng)) = (customer.lat, customer.lng) else {
            let response = error_response!(request.id, "INVALID_REQUEST", "Customer has no coordinates");
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        };
        let candidate = Coordinates {
            lat: customer_lat,
            lng: customer_lng,
        };

        let all_crews = queries::crew::list_crews(&pool, user_id, true).await?;
        let target_crews: Vec<crate::types::Crew> = if let Some(ids) = req.crew_ids.clone() {
            all_crews.into_iter().filter(|c| ids.contains(&c.id)).collect()
        } else {
            all_crews
        };

        let mut warnings: Vec<SlotWarning> = vec![];
        if target_crews.is_empty() {
            warnings.push(SlotWarning {
                severity: "error".to_string(),
                warning_type: "no_crews".to_string(),
                message: "Nebyla nalezena žádná aktivní posádka.".to_string(),
                conflicting_customer: None,
            });
            let response = SuccessResponse::new(
                request.id,
                SuggestSlotsV2Response {
                    suggestions: vec![],
                    warnings,
                },
            );
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        }

        struct CrewComputed {
            crew_id: Uuid,
            crew_name: String,
            load: i32,
            suggestions: Vec<CrewSlotSuggestion>,
        }

        let mut crew_results: Vec<CrewComputed> = vec![];
        let max_per_crew = req.max_per_crew.unwrap_or(3).max(1) as usize;

        for crew in target_crews {
            let depot = resolve_depot_for_crew(&pool, user_id, &crew, &settings).await;
            let day_stops = build_crew_day_stops(&pool, user_id, req.date, crew.id).await?;

            let mut locations: Vec<Coordinates> = vec![candidate, depot];
            for s in &day_stops {
                locations.push(s.coordinates);
            }

            let matrices = match routing_service.get_matrices(&locations).await {
                Ok(m) => m,
                Err(e) => {
                    warn!("Routing service failed for crew {}: {}. Using fallback.", crew.name, e);
                    let mock = MockRoutingService::new();
                    match mock.get_matrices(&locations).await {
                        Ok(m) => m,
                        Err(_) => {
                            warnings.push(SlotWarning {
                                severity: "warning".to_string(),
                                warning_type: "routing_fallback".to_string(),
                                message: format!("Posádka {}: nepodařilo se spočítat trasu.", crew.name),
                                conflicting_customer: None,
                            });
                            continue;
                        }
                    }
                }
            };

            let stop_indices: Vec<usize> = (0..day_stops.len()).map(|i| i + 2).collect();
            let stops_meta: Vec<StopMeta> = day_stops
                .iter()
                .map(|s| StopMeta {
                    name: s.customer_name.clone(),
                    arrival_time: s.arrival_time,
                    departure_time: s.departure_time,
                    time_window_start: s.time_window_start,
                    time_window_end: s.time_window_end,
                })
                .collect();
            let insertion_positions = calculate_insertion_positions(
                &matrices,
                0,
                1,
                &stop_indices,
                &stops_meta,
                req.service_duration_minutes,
                crew.working_hours_start,
                crew.working_hours_end,
            );

            let total_service: i32 = day_stops.iter().map(|s| s.service_duration_minutes).sum();
            let mut travel_total = 0i32;
            if !day_stops.is_empty() {
                travel_total += (matrices.durations[1][2] / 60) as i32;
                for i in 0..day_stops.len().saturating_sub(1) {
                    let from_idx = i + 2;
                    let to_idx = i + 3;
                    travel_total += (matrices.durations[from_idx][to_idx] / 60) as i32;
                }
                let last_idx = day_stops.len() + 1;
                travel_total += (matrices.durations[last_idx][1] / 60) as i32;
            }
            let load = day_load_percent(crew.working_hours_start, crew.working_hours_end, total_service, travel_total);

            let mut suggestions: Vec<CrewSlotSuggestion> = insertion_positions
                .iter()
                .map(|p| CrewSlotSuggestion {
                    crew_id: crew.id,
                    crew_name: crew.name.clone(),
                    start_time: p.estimated_arrival,
                    end_time: p.estimated_departure,
                    insert_position: p.insert_after_index + 1,
                    score: 0,
                    delta_travel_minutes: p.delta_min.round() as i32,
                    delta_distance_km: p.delta_km,
                    estimated_arrival: p.estimated_arrival,
                    slack_before_minutes: p.slack_before_minutes.unwrap_or(0),
                    slack_after_minutes: p.slack_after_minutes.unwrap_or(0),
                    day_load_percent: load,
                    status: p.status.clone(),
                    reason: p
                        .conflict_reason
                        .clone()
                        .unwrap_or_else(|| "Vhodný slot".to_string()),
                })
                .collect();
            suggestions.sort_by_key(|s| s.delta_travel_minutes);
            suggestions.truncate(max_per_crew);
            crew_results.push(CrewComputed {
                crew_id: crew.id,
                crew_name: crew.name.clone(),
                load,
                suggestions,
            });
        }

        let avg_load = if crew_results.is_empty() {
            0
        } else {
            crew_results.iter().map(|c| c.load).sum::<i32>() / crew_results.len() as i32
        };

        let mut final_suggestions: Vec<CrewSlotSuggestion> = vec![];
        for crew in &mut crew_results {
            for suggestion in &mut crew.suggestions {
                suggestion.score = slot_score(
                    suggestion.delta_travel_minutes,
                    suggestion.slack_before_minutes,
                    suggestion.slack_after_minutes,
                    suggestion.start_time,
                    suggestion.end_time,
                    req.preferred_time_start,
                    req.preferred_time_end,
                    crew.load,
                    avg_load,
                );
                suggestion.reason = format!(
                    "{} (Δ{} min, rezerva {} min)",
                    crew.crew_name, suggestion.delta_travel_minutes, suggestion.slack_after_minutes
                );
            }
            crew.suggestions.sort_by(|a, b| b.score.cmp(&a.score));
            final_suggestions.extend(crew.suggestions.clone());
        }
        final_suggestions.sort_by(|a, b| b.score.cmp(&a.score));
        info!(
            "slots.suggest.v2: generated {} suggestions for {} crews",
            final_suggestions.len(),
            crew_results.len()
        );
        let response = SuccessResponse::new(
            request.id,
            SuggestSlotsV2Response {
                suggestions: final_suggestions,
                warnings,
            },
        );
        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_time(h: u32, m: u32) -> NaiveTime {
        NaiveTime::from_hms_opt(h, m, 0).expect("valid time")
    }

    // ── preference_score ──

    #[test]
    fn test_preference_score_full_overlap() {
        // Slot [09:00-10:00] matches preferred [09:00-10:00] → 100%
        let score = preference_score(
            make_time(9, 0), make_time(10, 0),
            Some(make_time(9, 0)), Some(make_time(10, 0)),
        );
        assert!((score - 100.0).abs() < 0.01);
    }

    #[test]
    fn test_preference_score_half_overlap() {
        // Slot [09:00-10:00], preferred [09:30-10:30] → 50%
        let score = preference_score(
            make_time(9, 0), make_time(10, 0),
            Some(make_time(9, 30)), Some(make_time(10, 30)),
        );
        assert!((score - 50.0).abs() < 1.0);
    }

    #[test]
    fn test_preference_score_no_overlap() {
        // Slot [09:00-10:00], preferred [14:00-15:00] → 0%
        let score = preference_score(
            make_time(9, 0), make_time(10, 0),
            Some(make_time(14, 0)), Some(make_time(15, 0)),
        );
        assert!((score - 0.0).abs() < 0.01);
    }

    #[test]
    fn test_preference_score_no_preference_gives_default() {
        let score = preference_score(make_time(9, 0), make_time(10, 0), None, None);
        assert!((score - 70.0).abs() < 0.01);
    }

    // ── day_load_percent ──

    #[test]
    fn test_day_load_percent_empty() {
        let load = day_load_percent(make_time(8, 0), make_time(16, 0), 0, 0);
        assert_eq!(load, 0);
    }

    #[test]
    fn test_day_load_percent_half_day() {
        // 8h = 480 min, service=200, travel=40 → 240/480 = 50%
        let load = day_load_percent(make_time(8, 0), make_time(16, 0), 200, 40);
        assert_eq!(load, 50);
    }

    #[test]
    fn test_day_load_percent_full() {
        let load = day_load_percent(make_time(8, 0), make_time(16, 0), 400, 80);
        assert_eq!(load, 100);
    }

    // ── slot_score ──

    #[test]
    fn test_slot_score_prefers_less_travel() {
        // Same everything except delta_travel: 5 min vs 25 min
        let score_low = slot_score(5, 30, 30, make_time(9, 0), make_time(10, 0), None, None, 50, 50);
        let score_high = slot_score(25, 30, 30, make_time(9, 0), make_time(10, 0), None, None, 50, 50);
        assert!(score_low > score_high, "Lower travel should score higher: {} vs {}", score_low, score_high);
    }

    #[test]
    fn test_slot_score_prefers_matching_preference() {
        // Both 10min delta. One matches preference, other doesn't.
        let score_match = slot_score(
            10, 30, 30,
            make_time(9, 0), make_time(10, 0),
            Some(make_time(9, 0)), Some(make_time(10, 0)),
            50, 50,
        );
        let score_no_match = slot_score(
            10, 30, 30,
            make_time(9, 0), make_time(10, 0),
            Some(make_time(14, 0)), Some(make_time(15, 0)),
            50, 50,
        );
        assert!(score_match > score_no_match, "Matching preference should score higher: {} vs {}", score_match, score_no_match);
    }

    #[test]
    fn test_slot_score_prefers_balanced_load() {
        // Same everything except crew load vs avg
        let score_balanced = slot_score(10, 30, 30, make_time(9, 0), make_time(10, 0), None, None, 50, 50);
        let score_unbalanced = slot_score(10, 30, 30, make_time(9, 0), make_time(10, 0), None, None, 90, 50);
        assert!(score_balanced > score_unbalanced, "Balanced load should score higher: {} vs {}", score_balanced, score_unbalanced);
    }

    // ── minutes_between ──

    #[test]
    fn test_minutes_between() {
        assert_eq!(minutes_between(make_time(9, 0), make_time(10, 0)), 60);
        assert_eq!(minutes_between(make_time(9, 0), make_time(9, 0)), 0);
        assert_eq!(minutes_between(make_time(9, 0), make_time(9, 30)), 30);
    }
}

pub async fn handle_validate(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
    routing_service: Arc<dyn RoutingService>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received slots.validate message");
        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => continue,
        };

        let request: Request<ValidateSlotRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let response = error_response!(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let response = error_response!(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };

        let req = request.payload;
        let settings = match queries::settings::get_user_settings(&pool, user_id).await? {
            Some(s) => s,
            None => {
                let response = error_response!(request.id, "NOT_FOUND", "User settings not found");
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };
        let crew = match queries::crew::get_crew(&pool, req.crew_id, user_id).await? {
            Some(c) => c,
            None => {
                let response = error_response!(request.id, "NOT_FOUND", "Crew not found");
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };
        let customer = match queries::customer::get_customer(&pool, user_id, req.customer_id).await? {
            Some(c) => c,
            None => {
                let response = error_response!(request.id, "NOT_FOUND", "Customer not found");
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                continue;
            }
        };
        let (Some(c_lat), Some(c_lng)) = (customer.lat, customer.lng) else {
            let response = error_response!(request.id, "INVALID_REQUEST", "Customer has no coordinates");
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        };
        let candidate = Coordinates { lat: c_lat, lng: c_lng };
        let depot = resolve_depot_for_crew(&pool, user_id, &crew, &settings).await;
        let day_stops = build_crew_day_stops(&pool, user_id, req.date, crew.id).await?;

        let mut warnings: Vec<SlotWarning> = vec![];
        let mut hard_error = false;

        if req.time_start < crew.working_hours_start || req.time_end > crew.working_hours_end {
            warnings.push(SlotWarning {
                severity: "error".to_string(),
                warning_type: "outside_working_hours".to_string(),
                message: "Slot je mimo pracovní dobu posádky.".to_string(),
                conflicting_customer: None,
            });
            hard_error = true;
        }

        for stop in &day_stops {
            if let (Some(s0), Some(s1)) = (stop_start(stop), stop_end(stop)) {
                let overlap = time_overlap_minutes(req.time_start, req.time_end, s0, s1);
                if overlap > 0 {
                    warnings.push(SlotWarning {
                        severity: "error".to_string(),
                        warning_type: "overlap".to_string(),
                        message: format!("Slot se překrývá s návštěvou {}.", stop.customer_name),
                        conflicting_customer: Some(stop.customer_name.clone()),
                    });
                    hard_error = true;
                }
            }
        }

        let prev_stop = day_stops
            .iter()
            .filter_map(|s| stop_end(s).map(|end| (s, end)))
            .filter(|(_, end)| *end <= req.time_start)
            .max_by_key(|(_, end)| *end)
            .map(|(s, _)| s);
        let next_stop = day_stops
            .iter()
            .filter_map(|s| stop_start(s).map(|start| (s, start)))
            .filter(|(_, start)| *start >= req.time_end)
            .min_by_key(|(_, start)| *start)
            .map(|(s, _)| s);

        let mut estimated_arrival: Option<NaiveTime> = None;
        let mut slack_before_minutes: Option<i32> = None;
        let mut slack_after_minutes: Option<i32> = None;

        if prev_stop.is_some() || next_stop.is_some() {
            let mut locations: Vec<Coordinates> = vec![candidate];
            if let Some(prev) = prev_stop {
                locations.push(prev.coordinates);
            } else {
                locations.push(depot);
            }
            if let Some(next) = next_stop {
                locations.push(next.coordinates);
            } else {
                locations.push(depot);
            }
            let matrices = match routing_service.get_matrices(&locations).await {
                Ok(m) => m,
                Err(_) => MockRoutingService::new().get_matrices(&locations).await?,
            };
            let prev_idx = 1usize;
            let next_idx = 2usize;
            let travel_prev_candidate = (matrices.durations[prev_idx][0] / 60) as i32;
            let travel_candidate_next = (matrices.durations[0][next_idx] / 60) as i32;

            if let Some(prev) = prev_stop {
                if let Some(prev_end) = stop_end(prev) {
                    let earliest_arrival = add_minutes(prev_end, travel_prev_candidate);
                    estimated_arrival = Some(earliest_arrival);
                    let slack_before = minutes_between(earliest_arrival, req.time_start);
                    slack_before_minutes = Some(slack_before);
                    if earliest_arrival > req.time_start {
                        warnings.push(SlotWarning {
                            severity: "error".to_string(),
                            warning_type: "unreachable".to_string(),
                            message: format!(
                                "Příjezd od předchozí zastávky je možný nejdříve v {}.",
                                earliest_arrival.format("%H:%M")
                            ),
                            conflicting_customer: Some(prev.customer_name.clone()),
                        });
                        hard_error = true;
                    } else if slack_before < 15 {
                        warnings.push(SlotWarning {
                            severity: "warning".to_string(),
                            warning_type: "no_slack".to_string(),
                            message: "Před slotem je minimální časová rezerva.".to_string(),
                            conflicting_customer: Some(prev.customer_name.clone()),
                        });
                    }
                }
            }
            if let Some(next) = next_stop {
                if let Some(next_start) = stop_start(next) {
                    let required_departure = add_minutes(req.time_end, travel_candidate_next);
                    let slack_after = minutes_between(required_departure, next_start);
                    slack_after_minutes = Some(slack_after);
                    if required_departure > next_start {
                        warnings.push(SlotWarning {
                            severity: "error".to_string(),
                            warning_type: "unreachable".to_string(),
                            message: format!(
                                "Po slotu nelze stihnout další zastávku {} v {}.",
                                next.customer_name,
                                next_start.format("%H:%M")
                            ),
                            conflicting_customer: Some(next.customer_name.clone()),
                        });
                        hard_error = true;
                    } else if slack_after < 15 {
                        warnings.push(SlotWarning {
                            severity: "warning".to_string(),
                            warning_type: "no_slack".to_string(),
                            message: "Po slotu je minimální časová rezerva.".to_string(),
                            conflicting_customer: Some(next.customer_name.clone()),
                        });
                    }
                }
            }
        }

        let existing_service: i32 = day_stops.iter().map(|s| s.service_duration_minutes).sum();
        let requested_service = minutes_between(req.time_start, req.time_end).max(1);
        let load = day_load_percent(
            crew.working_hours_start,
            crew.working_hours_end,
            existing_service + requested_service,
            0,
        );
        if load > 90 {
            warnings.push(SlotWarning {
                severity: "warning".to_string(),
                warning_type: "overloaded".to_string(),
                message: format!("Den posádky je silně vytížen ({}%).", load),
                conflicting_customer: None,
            });
        }

        if settings.break_enabled
            && time_overlap_minutes(
                req.time_start,
                req.time_end,
                settings.break_earliest_time,
                settings.break_latest_time,
            ) > 0
        {
            warnings.push(SlotWarning {
                severity: "warning".to_string(),
                warning_type: "break_conflict".to_string(),
                message: "Slot zasahuje do preferovaného okna pauzy.".to_string(),
                conflicting_customer: None,
            });
        }

        let response = SuccessResponse::new(
            request.id,
            ValidateSlotResponse {
                feasible: !hard_error,
                warnings,
                estimated_arrival,
                slack_before_minutes,
                slack_after_minutes,
            },
        );
        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }
    Ok(())
}
