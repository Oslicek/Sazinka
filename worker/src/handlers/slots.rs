//! Slot suggestion handlers

use std::sync::Arc;
use anyhow::Result;
use async_nats::{Client, Subscriber};
use chrono::NaiveTime;
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::services::slot_suggester::{
    DepotInfo, ExistingStop, SlotSuggester, SuggestSlotsRequest, SuggestSlotsResponse,
};
use crate::types::{Coordinates, ErrorResponse, Request};

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
                let duration = rev.duration_minutes.unwrap_or(30);
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
