//! Route planning message handlers

use std::sync::Arc;
use std::collections::HashMap;
use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn, info};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::services::routing::{RoutingService, MockRoutingService};
use crate::services::vrp::{VrpSolver, VrpProblem, VrpStop, Depot, SolverConfig, StopTimeWindow, BreakConfig};
use crate::types::{
    Coordinates, ErrorResponse, Request, SuccessResponse,
    RoutePlanRequest, RoutePlanResponse, PlannedRouteStop, RouteWarning, WorkingHours,
};

/// Handle route.plan messages
/// 
/// Optimizes route for a set of customer visits using VRP solver.
pub async fn handle_plan(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
    routing_service: Arc<dyn RoutingService>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.plan message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<RoutePlanRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let plan_request = &request.payload;

        // Validate request
        if plan_request.customer_ids.is_empty() {
            let response = SuccessResponse::new(request.id, RoutePlanResponse {
                stops: vec![],
                total_distance_km: 0.0,
                total_duration_minutes: 0,
                algorithm: "none".to_string(),
                solve_time_ms: 0,
                solver_log: vec![],
                optimization_score: 100,
                warnings: vec![],
                unassigned: vec![],
                geometry: vec![],
                return_to_depot_distance_km: None,
                return_to_depot_duration_minutes: None,
            });
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        }

        // Load customers from database
        let customers = match load_customers(&pool, user_id, &plan_request.customer_ids, plan_request.date).await {
            Ok(c) => c,
            Err(e) => {
                error!("Failed to load customers: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Filter customers with valid coordinates
        let (valid_customers, invalid_ids): (Vec<_>, Vec<_>) = customers
            .into_iter()
            .partition(|c| c.lat.is_some() && c.lng.is_some());

        let mut warnings = Vec::new();
        for customer in &invalid_ids {
            warnings.push(RouteWarning {
                stop_index: None,
                warning_type: "MISSING_COORDINATES".to_string(),
                message: format!("Customer {} has no coordinates and was excluded", customer.name.as_deref().unwrap_or("(unnamed)")),
            });
        }

        if valid_customers.is_empty() {
            let response = SuccessResponse::new(request.id, RoutePlanResponse {
                stops: vec![],
                total_distance_km: 0.0,
                total_duration_minutes: 0,
                algorithm: "none".to_string(),
                solve_time_ms: 0,
                solver_log: vec![],
                optimization_score: 0,
                warnings,
                unassigned: plan_request.customer_ids.clone(),
                geometry: vec![],
                return_to_depot_distance_km: None,
                return_to_depot_duration_minutes: None,
            });
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        }

        // Load user settings for working hours and service duration
        let (shift_start, shift_end, service_duration, break_config) = match queries::settings::get_user_settings(&pool, user_id).await {
            Ok(Some(settings)) => {
                let start = settings.working_hours_start;
                let end = settings.working_hours_end;
                let duration = settings.default_service_duration_minutes as u32;
                let break_cfg = if settings.break_enabled {
                    Some(BreakConfig {
                        earliest_time: settings.break_earliest_time,
                        latest_time: settings.break_latest_time,
                        duration_minutes: settings.break_duration_minutes as u32,
                    })
                } else {
                    None
                };
                info!(
                    "Route planning using user settings: working hours {:?}-{:?}, service duration {} min",
                    start, end, duration
                );
                (start, end, duration, break_cfg)
            }
            Ok(None) => {
                // User not found in database
                warn!("User {} not found in database, using default settings", user_id);
                (
                    chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                    chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
                    30u32,
                    None,
                )
            }
            Err(e) => {
                // Database error
                warn!("Failed to load user settings: {}, using defaults", e);
                (
                    chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                    chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
                    30u32,
                    None,
                )
            }
        };

        // Build VRP problem with user settings
        let vrp_problem = build_vrp_problem(
            &plan_request.start_location,
            &valid_customers,
            shift_start,
            shift_end,
            service_duration,
            break_config,
        );

        // Build location list for matrix (depot + customers)
        let mut locations = vec![plan_request.start_location];
        for customer in &valid_customers {
            locations.push(Coordinates {
                lat: customer.lat.unwrap(),
                lng: customer.lng.unwrap(),
            });
        }

        // Get distance/time matrices (with fallback to mock if Valhalla fails)
        let (matrices, routing_fallback_used) = match routing_service.get_matrices(&locations).await {
            Ok(m) => (m, false),
            Err(e) => {
                warn!("Primary routing service failed: {}. Falling back to mock routing.", e);
                // Fallback to mock routing
                let mock_service = crate::services::routing::MockRoutingService::new();
                match mock_service.get_matrices(&locations).await {
                    Ok(m) => (m, true),
                    Err(e2) => {
                        error!("Mock routing also failed: {}", e2);
                        let error = ErrorResponse::new(request.id, "ROUTING_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                        continue;
                    }
                }
            }
        };

        // Load crew-specific settings for arrival buffer
        let arrival_buffer_percent = if let Some(crew_id) = plan_request.crew_id {
            match queries::crew::get_crew(&pool, crew_id, user_id).await {
                Ok(Some(crew)) => {
                    info!("Using crew '{}' arrival buffer: {}%", crew.name, crew.arrival_buffer_percent);
                    crew.arrival_buffer_percent
                }
                _ => {
                    warn!("Crew {} not found, using default buffer", crew_id);
                    10.0
                }
            }
        } else {
            10.0
        };

        // Solve VRP - solver handles timeout and spawn_blocking internally
        let solver_config = SolverConfig::with_buffer(5, 500, arrival_buffer_percent);
        let solver = VrpSolver::new(solver_config);
        let solution = match solver.solve(&vrp_problem, &matrices, plan_request.date).await {
            Ok(s) => {
                // If solver used heuristic fallback and we had time windows,
                // check if the solution respects them (heuristic ignores time windows)
                if s.algorithm.contains("heuristic") && vrp_problem.stops.iter().any(|stop| stop.time_window.is_some()) {
                    info!("Heuristic fallback used with time windows present - windows may not be respected");
                }
                s
            }
            Err(e) => {
                error!("VRP solver failed completely: {}", e);
                let error = ErrorResponse::new(request.id, "SOLVER_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Build response
        let customer_matrix_index: HashMap<Uuid, usize> = valid_customers
            .iter()
            .enumerate()
            .map(|(idx, c)| (c.id, idx + 1)) // 0 is depot
            .collect();
        let mut planned_stops: Vec<PlannedRouteStop> = Vec::new();
        let mut previous_matrix_index: usize = 0;
        for stop in &solution.stops {
            // Find original customer
            if let Some(customer) = valid_customers.iter().find(|c| c.id.to_string() == stop.stop_id) {
                let matrix_index = customer_matrix_index.get(&customer.id).copied().unwrap_or(0);
                let leg_distance_km = if matrix_index > 0 {
                    Some(matrices.distance(previous_matrix_index, matrix_index) as f64 / 1000.0)
                } else {
                    None
                };
                let leg_duration_min = if matrix_index > 0 {
                    Some((matrices.duration(previous_matrix_index, matrix_index) as i32 + 30) / 60)
                } else {
                    None
                };
                planned_stops.push(PlannedRouteStop {
                    customer_id: customer.id,
                    customer_name: customer.name.clone().unwrap_or_default(),
                    address: format!(
                        "{}, {} {}",
                        customer.street.as_deref().unwrap_or(""),
                        customer.city.as_deref().unwrap_or(""),
                        customer.postal_code.as_deref().unwrap_or("")
                    ),
                    coordinates: Coordinates {
                        lat: customer.lat.unwrap(),
                        lng: customer.lng.unwrap(),
                    },
                    order: stop.order as i32,
                    eta: stop.arrival_time,
                    etd: stop.departure_time,
                    service_duration_minutes: service_duration as i32,
                    time_window: match (customer.scheduled_time_start, customer.scheduled_time_end) {
                        (Some(start), Some(end)) => Some(crate::types::TimeWindow {
                            start,
                            end,
                            is_hard: true,
                        }),
                        _ => None,
                    },
                    stop_type: Some("customer".to_string()),
                    break_duration_minutes: None,
                    break_time_start: None,
                    distance_from_previous_km: leg_distance_km,
                    duration_from_previous_minutes: leg_duration_min,
                });
                if matrix_index > 0 {
                    previous_matrix_index = matrix_index;
                }
            } else if stop.customer_id.is_nil() {
                planned_stops.push(PlannedRouteStop {
                    customer_id: Uuid::nil(),
                    customer_name: "Pauza".to_string(),
                    address: "Pauza".to_string(),
                    coordinates: plan_request.start_location,
                    order: stop.order as i32,
                    eta: stop.arrival_time,
                    etd: stop.departure_time,
                    service_duration_minutes: ((stop.departure_time - stop.arrival_time).num_minutes().max(0)) as i32,
                    time_window: None,
                    stop_type: Some("break".to_string()),
                    break_duration_minutes: Some(((stop.departure_time - stop.arrival_time).num_minutes().max(0)) as i32),
                    break_time_start: Some(stop.arrival_time),
                    distance_from_previous_km: None,
                    duration_from_previous_minutes: None,
                });
            }
        }

        // Add solver warnings
        for w in &solution.warnings {
            warnings.push(RouteWarning {
                stop_index: None,
                warning_type: w.warning_type.clone(),
                message: w.message.clone(),
            });
        }

        // Add routing fallback warning if applicable
        if routing_fallback_used {
            warnings.push(RouteWarning {
                stop_index: None,
                warning_type: "ROUTING_FALLBACK".to_string(),
                message: "Valhalla unavailable - using estimated distances (40 km/h average)".to_string(),
            });
        }

        // Collect unassigned customer IDs
        let mut unassigned: Vec<Uuid> = invalid_ids.iter().map(|c| c.id).collect();
        for stop_id in &solution.unassigned {
            if let Ok(id) = Uuid::parse_str(stop_id) {
                unassigned.push(id);
            }
        }

        // Build route geometry
        // Order: depot -> stops in order -> depot
        let geometry = if !planned_stops.is_empty() {
            let mut route_coords: Vec<Coordinates> = vec![plan_request.start_location];
            for stop in &planned_stops {
                route_coords.push(stop.coordinates);
            }
            route_coords.push(plan_request.start_location); // Return to depot
            
            // Try to get real route geometry from Valhalla
            if !routing_fallback_used {
                if let Some(valhalla) = routing_service.as_any().downcast_ref::<crate::services::routing::ValhallaClient>() {
                    match valhalla.get_route_geometry(&route_coords).await {
                        Ok(geom) => geom.coordinates,
                        Err(e) => {
                            warn!("Failed to get route geometry: {}. Using straight lines.", e);
                            route_coords.iter().map(|c| [c.lng, c.lat]).collect()
                        }
                    }
                } else {
                    // Not a Valhalla client, use straight lines
                    route_coords.iter().map(|c| [c.lng, c.lat]).collect()
                }
            } else {
                // Routing fallback was used, use straight lines
                route_coords.iter().map(|c| [c.lng, c.lat]).collect()
            }
        } else {
            vec![]
        };

        let return_to_depot_distance_km = if previous_matrix_index > 0 {
            Some(matrices.distance(previous_matrix_index, 0) as f64 / 1000.0)
        } else {
            None
        };
        let return_to_depot_duration_minutes = if previous_matrix_index > 0 {
            Some((matrices.duration(previous_matrix_index, 0) as i32 + 30) / 60)
        } else {
            None
        };

        let response = SuccessResponse::new(request.id, RoutePlanResponse {
            stops: planned_stops,
            total_distance_km: solution.total_distance_meters as f64 / 1000.0,
            total_duration_minutes: (solution.total_duration_seconds / 60) as i32,
            algorithm: solution.algorithm.clone(),
            solve_time_ms: solution.solve_time_ms,
            solver_log: solution.solver_log.clone(),
            optimization_score: solution.optimization_score as i32,
            warnings,
            unassigned,
            geometry,
            return_to_depot_distance_km,
            return_to_depot_duration_minutes,
        });

        info!(
            "Route planned for {} customers: {:.1} km, {} min, score={}",
            valid_customers.len(),
            solution.total_distance_meters as f64 / 1000.0,
            solution.total_duration_seconds / 60,
            solution.optimization_score
        );

        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

/// Simple customer data for route planning
struct CustomerForRoute {
    id: Uuid,
    name: Option<String>,
    street: Option<String>,
    city: Option<String>,
    postal_code: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    /// Scheduled time window from revision (if any)
    scheduled_time_start: Option<chrono::NaiveTime>,
    scheduled_time_end: Option<chrono::NaiveTime>,
}

/// Load customers from database, including scheduled time windows from revisions
async fn load_customers(
    pool: &PgPool,
    user_id: Uuid,
    customer_ids: &[Uuid],
    date: NaiveDate,
) -> Result<Vec<CustomerForRoute>> {
    let mut customers = Vec::new();

    for customer_id in customer_ids {
        if let Some(customer) = queries::customer::get_customer(pool, user_id, *customer_id).await? {
            // Try to find a scheduled revision for this customer on the given date
            let (tw_start, tw_end) = match queries::revision::get_scheduled_time_window(
                pool, user_id, *customer_id, date,
            ).await {
                Ok(Some((start, end))) => {
                    debug!(
                        "Customer {} has time window {:?}-{:?} on {}",
                        customer.name.as_deref().unwrap_or("?"), start, end, date
                    );
                    (Some(start), Some(end))
                }
                Ok(None) => (None, None),
                Err(e) => {
                    warn!("Failed to load time window for customer {}: {}", customer_id, e);
                    (None, None)
                }
            };

            customers.push(CustomerForRoute {
                id: customer.id,
                name: customer.name.clone(),
                street: customer.street.clone(),
                city: customer.city.clone(),
                postal_code: customer.postal_code.clone(),
                lat: customer.lat,
                lng: customer.lng,
                scheduled_time_start: tw_start,
                scheduled_time_end: tw_end,
            });
        }
    }

    Ok(customers)
}

/// Build VRP problem from customers, including time windows from revisions
fn build_vrp_problem(
    start: &Coordinates,
    customers: &[CustomerForRoute],
    shift_start: chrono::NaiveTime,
    shift_end: chrono::NaiveTime,
    service_duration_minutes: u32,
    break_config: Option<BreakConfig>,
) -> VrpProblem {
    let stops: Vec<VrpStop> = customers
        .iter()
        .map(|c| {
            let time_window = match (c.scheduled_time_start, c.scheduled_time_end) {
                (Some(start), Some(end)) => Some(StopTimeWindow {
                    start,
                    end,
                    is_hard: true, // Hard constraint - route must respect scheduled time windows
                }),
                _ => None,
            };

            if time_window.is_some() {
                info!(
                    "VRP stop {} ({}) has time window {:?}-{:?}",
                    c.id,
                    c.name.as_deref().unwrap_or("?"),
                    c.scheduled_time_start,
                    c.scheduled_time_end,
                );
            }

            VrpStop {
                id: c.id.to_string(),
                customer_id: c.id,
                customer_name: c.name.clone().unwrap_or_default(),
                coordinates: Coordinates {
                    lat: c.lat.unwrap(),
                    lng: c.lng.unwrap(),
                },
                service_duration_minutes,
                time_window,
                priority: 1,
            }
        })
        .collect();

    VrpProblem {
        depot: Depot {
            coordinates: *start,
        },
        stops,
        shift_start,
        shift_end,
        break_config,
    }
}

/// Create mock routing service (for tests and when Valhalla unavailable)
pub fn create_mock_routing_service() -> Arc<dyn RoutingService> {
    Arc::new(MockRoutingService::new())
}

// ============================================================================
// Route Persistence Handlers
// ============================================================================

use chrono::NaiveDate;
use crate::types::route::Route;

/// Deserialize an Option<Uuid> that tolerates empty or short strings (returns None instead of error)
fn deserialize_optional_uuid<'de, D>(deserializer: D) -> Result<Option<Uuid>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let opt: Option<String> = Option::deserialize(deserializer)?;
    match opt {
        None => Ok(None),
        Some(s) if s.len() < 8 => Ok(None), // Too short to be a valid UUID
        Some(s) => {
            Uuid::parse_str(&s).map(Some).map_err(serde::de::Error::custom)
        }
    }
}

/// Deserialize a Uuid that tolerates empty or short strings by returning Uuid::nil()
fn deserialize_uuid_tolerant<'de, D>(deserializer: D) -> Result<Uuid, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let s = String::deserialize(deserializer)?;
    if s.len() < 8 {
        warn!("Received invalid UUID string '{}', substituting nil UUID", s);
        return Ok(Uuid::nil());
    }
    Uuid::parse_str(&s).map_err(serde::de::Error::custom)
}

/// Request to save a route
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRouteRequest {
    pub date: NaiveDate,
    #[serde(default, deserialize_with = "deserialize_optional_uuid")]
    pub crew_id: Option<Uuid>,
    #[serde(default, deserialize_with = "deserialize_optional_uuid")]
    pub depot_id: Option<Uuid>,
    pub stops: Vec<SaveRouteStop>,
    pub total_distance_km: f64,
    pub total_duration_minutes: i32,
    pub optimization_score: i32,
    #[serde(default)]
    pub return_to_depot_distance_km: Option<f64>,
    #[serde(default)]
    pub return_to_depot_duration_minutes: Option<i32>,
}

/// A stop to save
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRouteStop {
    #[serde(default, deserialize_with = "deserialize_optional_uuid")]
    pub customer_id: Option<Uuid>,
    #[serde(default, deserialize_with = "deserialize_optional_uuid")]
    pub revision_id: Option<Uuid>,
    pub order: i32,
    pub eta: Option<chrono::NaiveTime>,
    pub etd: Option<chrono::NaiveTime>,
    pub distance_from_previous_km: Option<f64>,
    pub duration_from_previous_minutes: Option<i32>,
    #[serde(default)]
    pub stop_type: Option<String>,
    pub break_duration_minutes: Option<i32>,
    pub break_time_start: Option<chrono::NaiveTime>,
}

/// Response after saving a route
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRouteResponse {
    pub route_id: Uuid,
    pub saved: bool,
    pub stops_count: usize,
}

/// Request to get a saved route
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRouteRequest {
    pub date: Option<NaiveDate>,
    pub route_id: Option<Uuid>,
}

/// Response with saved route data
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRouteResponse {
    pub route: Option<Route>,
    pub stops: Vec<queries::route::RouteStopWithInfo>,
}

/// Response with list of routes for a date
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRoutesForDateResponse {
    pub routes: Vec<queries::route::RouteWithCrewInfo>,
}

/// Request to list routes with filters
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRoutesRequest {
    pub date_from: chrono::NaiveDate,
    pub date_to: chrono::NaiveDate,
    pub crew_id: Option<Uuid>,
    pub depot_id: Option<Uuid>,
}

/// Response with filtered list of routes
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRoutesResponse {
    pub routes: Vec<queries::route::RouteWithCrewInfo>,
}

/// Handle route.save messages
pub async fn handle_save(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.save message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<SaveRouteRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let raw = String::from_utf8_lossy(&msg.payload);
                error!("Failed to parse route.save request: {} | raw payload: {}", e, &raw[..raw.len().min(600)]);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let payload = request.payload;
        info!("Saving route for date {} with {} stops", payload.date, payload.stops.len());
        for (i, stop) in payload.stops.iter().enumerate() {
            debug!(
                "  Stop {}: type={:?}, customer_id={:?}, revision_id={:?}",
                i,
                stop.stop_type,
                stop.customer_id,
                stop.revision_id
            );
        }

        // Upsert route
        match queries::route::upsert_route(
            &pool,
            user_id,
            payload.crew_id,
            payload.depot_id, // depot_id from request
            payload.date,
            "draft",
            Some(payload.total_distance_km),
            Some(payload.total_duration_minutes),
            Some(payload.optimization_score),
            payload.return_to_depot_distance_km,
            payload.return_to_depot_duration_minutes,
        ).await {
            Ok(route) => {
                // Delete existing stops
                if let Err(e) = queries::route::delete_route_stops(&pool, route.id).await {
                    error!("Failed to delete existing stops: {}", e);
                    let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                    continue;
                }

                // Insert new stops
                let mut saved_count = 0;
                for stop in &payload.stops {
                    let stop_type = stop.stop_type.clone().unwrap_or_else(|| "customer".to_string());
                    if let Err(e) = queries::route::insert_route_stop(
                        &pool,
                        route.id,
                        stop.customer_id,
                        None, // visit_id
                        stop.revision_id,
                        stop.order,
                        stop.eta,
                        stop.etd,
                        stop.distance_from_previous_km,
                        stop.duration_from_previous_minutes,
                        stop_type,
                        stop.break_duration_minutes,
                        stop.break_time_start,
                    ).await {
                        warn!("Failed to insert stop: {}", e);
                    } else {
                        saved_count += 1;
                    }
                }

                let response = SuccessResponse::new(
                    request.id,
                    SaveRouteResponse {
                        route_id: route.id,
                        saved: true,
                        stops_count: saved_count,
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                info!("Saved route {} with {} stops", route.id, saved_count);
            }
            Err(e) => {
                error!("Failed to save route: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Request to update a route
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRouteRequest {
    pub route_id: Uuid,
    pub crew_id: Option<Option<Uuid>>,
    pub depot_id: Option<Option<Uuid>>,
    pub status: Option<String>,
}

/// Response after updating a route
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRouteResponse {
    pub updated: bool,
}

/// Handle route.update messages
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateRouteRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let payload = request.payload;
        info!("Updating route {} (crew={:?}, depot={:?}, status={:?})",
            payload.route_id, payload.crew_id, payload.depot_id, payload.status);

        match queries::route::update_route(
            &pool,
            payload.route_id,
            user_id,
            payload.crew_id,
            payload.depot_id,
            payload.status.as_deref(),
        ).await {
            Ok(updated) => {
                let response = SuccessResponse::new(
                    request.id,
                    UpdateRouteResponse { updated },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                if updated {
                    info!("Route {} updated", payload.route_id);
                } else {
                    warn!("Route {} not found or not owned by user", payload.route_id);
                }
            }
            Err(e) => {
                error!("Failed to update route: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Request to delete a route
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRouteRequest {
    pub route_id: Uuid,
}

/// Response after deleting a route
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRouteResponse {
    pub deleted: bool,
}

/// Handle route.delete messages
pub async fn handle_delete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.delete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<DeleteRouteRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        info!("Deleting route {}", request.payload.route_id);

        match queries::route::delete_route_by_id(&pool, request.payload.route_id, user_id).await {
            Ok(deleted) => {
                let response = SuccessResponse::new(
                    request.id,
                    DeleteRouteResponse { deleted },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                if deleted {
                    info!("Route {} deleted", request.payload.route_id);
                } else {
                    warn!("Route {} not found or not owned by user", request.payload.route_id);
                }
            }
            Err(e) => {
                error!("Failed to delete route: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle route.get messages
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.get message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<GetRouteRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Lookup route by ID or by date
        let route_result = if let Some(route_id) = request.payload.route_id {
            info!("Getting route by id {}", route_id);
            queries::route::get_route_by_id(&pool, user_id, route_id).await
        } else if let Some(date) = request.payload.date {
            info!("Getting route for date {}", date);
            queries::route::get_route_for_date(&pool, user_id, date).await
        } else {
            error!("Neither routeId nor date provided");
            let error = ErrorResponse::new(request.id, "INVALID_REQUEST", "Either routeId or date is required");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        };

        match route_result {
            Ok(Some(route)) => {
                // Get stops with info
                match queries::route::get_route_stops_with_info(&pool, route.id).await {
                    Ok(stops) => {
                        let stop_count = stops.len();
                        for (i, s) in stops.iter().enumerate() {
                            debug!(
                                "  Stop {} ({}): revision_id={:?}, rev_status={:?}, sched_start={:?}, sched_end={:?}, dist={:?}, dur={:?}",
                                i, s.customer_name.as_deref().unwrap_or("?"),
                                s.revision_id, s.revision_status,
                                s.scheduled_time_start, s.scheduled_time_end,
                                s.distance_from_previous_km, s.duration_from_previous_minutes
                            );
                        }
                        let response = SuccessResponse::new(
                            request.id,
                            GetRouteResponse {
                                route: Some(route),
                                stops,
                            },
                        );
                        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                        debug!("Returned saved route with {} stops", stop_count);
                    }
                    Err(e) => {
                        error!("Failed to get route stops: {}", e);
                        let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                    }
                }
            }
            Ok(None) => {
                let response = SuccessResponse::new(
                    request.id,
                    GetRouteResponse {
                        route: None,
                        stops: vec![],
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("No route found");
            }
            Err(e) => {
                error!("Failed to get route: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle route.list_for_date messages
pub async fn handle_list_for_date(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.list_for_date message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<GetRouteRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Load routes for date
        let date = match request.payload.date {
            Some(d) => d,
            None => {
                let error = ErrorResponse::new(request.id, "INVALID_REQUEST", "date is required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        match queries::route::list_routes_for_date(&pool, user_id, date).await {
            Ok(routes) => {
                let response = SuccessResponse::new(
                    request.id,
                    ListRoutesForDateResponse { routes },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Returned {} routes for date {}", response.payload.routes.len(), date);
            }
            Err(e) => {
                error!("Failed to list routes: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle route.list messages — list routes with optional filters
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ListRoutesRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let payload = &request.payload;
        match queries::route::list_routes(
            &pool,
            user_id,
            payload.date_from,
            payload.date_to,
            payload.crew_id,
            payload.depot_id,
        ).await {
            Ok(routes) => {
                let response = SuccessResponse::new(
                    request.id,
                    ListRoutesResponse { routes },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Returned {} routes for range {} to {}", response.payload.routes.len(), payload.date_from, payload.date_to);
            }
            Err(e) => {
                error!("Failed to list routes: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// ============================================================================
// Insertion Calculation Handlers (1×K + K×1 Matrix Strategy)
// ============================================================================

/// Request to calculate insertion cost for a candidate
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculateInsertionRequest {
    pub route_stops: Vec<RouteStopInput>,
    pub depot: Coordinates,
    pub candidate: InsertionCandidateInput,
    pub date: String,
    pub workday_start: Option<String>,
    pub workday_end: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteStopInput {
    pub id: String,
    pub name: String,
    pub coordinates: Coordinates,
    pub arrival_time: Option<String>,
    pub departure_time: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertionCandidateInput {
    pub id: String,
    pub customer_id: String,
    pub coordinates: Coordinates,
    pub service_duration_minutes: u32,
}

/// Response for insertion calculation
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculateInsertionResponse {
    pub candidate_id: String,
    pub best_position: Option<InsertionPosition>,
    pub all_positions: Vec<InsertionPosition>,
    pub is_feasible: bool,
    pub infeasible_reason: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InsertionPosition {
    pub insert_after_index: i32,
    pub insert_after_name: String,
    pub insert_before_name: String,
    pub delta_km: f64,
    pub delta_min: f64,
    pub estimated_arrival: String,
    pub estimated_departure: String,
    pub status: String,
    pub conflict_reason: Option<String>,
}

/// Handle route.insertion.calculate messages
/// Calculates best insertion position for a single candidate using 1×K + K×1 matrix strategy
pub async fn handle_insertion_calculate(
    client: Client,
    mut subscriber: Subscriber,
    _pool: PgPool,
    _jwt_secret: Arc<String>,
    routing_service: Arc<dyn RoutingService>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.insertion.calculate message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<CalculateInsertionRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let calc_req = &request.payload;

        // If no route stops, insertion is trivially at position 0
        if calc_req.route_stops.is_empty() {
            let response = SuccessResponse::new(request.id, CalculateInsertionResponse {
                candidate_id: calc_req.candidate.id.clone(),
                best_position: Some(InsertionPosition {
                    insert_after_index: -1,
                    insert_after_name: "Depo".to_string(),
                    insert_before_name: "Depo".to_string(),
                    delta_km: 0.0,
                    delta_min: 0.0,
                    estimated_arrival: "08:00".to_string(),
                    estimated_departure: "08:30".to_string(),
                    status: "ok".to_string(),
                    conflict_reason: None,
                }),
                all_positions: vec![],
                is_feasible: true,
                infeasible_reason: None,
            });
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        }

        // Build location list: candidate (index 0), then route stops, then depot
        // We'll compute the full matrix and extract relevant values
        let candidate_coord = calc_req.candidate.coordinates;
        let mut all_locations: Vec<Coordinates> = vec![candidate_coord]; // Index 0 = candidate
        all_locations.push(calc_req.depot); // Index 1 = depot
        for stop in &calc_req.route_stops {
            all_locations.push(stop.coordinates); // Index 2+ = route stops
        }

        // Get full matrix (will optimize to 1×K + K×1 later)
        let matrices = match routing_service.get_matrices(&all_locations).await {
            Ok(m) => m,
            Err(e) => {
                warn!("Routing service failed: {}. Using estimates.", e);
                // Fallback to mock routing
                let mock = MockRoutingService::new();
                match mock.get_matrices(&all_locations).await {
                    Ok(m) => m,
                    Err(e2) => {
                        error!("Mock routing also failed: {}", e2);
                        let error = ErrorResponse::new(request.id, "ROUTING_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                        continue;
                    }
                }
            }
        };

        // Matrix indices:
        // 0 = candidate
        // 1 = depot
        // 2+ = route stops (index i in route_stops = matrix index i+2)
        let candidate_idx = 0;
        let depot_idx = 1;

        // Calculate insertion cost at each position
        // Position i means: insert between stop[i] and stop[i+1]
        // Position -1 means: insert after depot (first position)
        let mut positions: Vec<InsertionPosition> = Vec::new();
        let num_stops = calc_req.route_stops.len();

        for insert_idx in 0..=num_stops {
            // Current route order: depot -> stop[0] -> stop[1] -> ... -> stop[n-1] -> depot
            // Insert position insert_idx means:
            //   - insert_idx = 0: insert after depot, before stop[0]
            //   - insert_idx = k: insert after stop[k-1], before stop[k]
            //   - insert_idx = num_stops: insert after stop[n-1], before return to depot
            
            // Matrix indices for "from" and "to" nodes
            let from_matrix_idx = if insert_idx == 0 { depot_idx } else { insert_idx + 1 }; // +1 because depot is at index 1
            let to_matrix_idx = if insert_idx >= num_stops { depot_idx } else { insert_idx + 2 }; // +2 because first stop is at index 2

            // Current edge cost (from -> to without candidate)
            let current_distance_m = matrices.distances[from_matrix_idx][to_matrix_idx] as f64;
            let current_time_s = matrices.durations[from_matrix_idx][to_matrix_idx] as f64;
            let current_distance_km = current_distance_m / 1000.0;
            let current_time_min = current_time_s / 60.0;

            // New costs with candidate insertion:
            // from -> candidate: matrices[from_matrix_idx][candidate_idx]
            // candidate -> to: matrices[candidate_idx][to_matrix_idx]
            let dist_from_to_candidate = matrices.distances[from_matrix_idx][candidate_idx] as f64;
            let dist_candidate_to_next = matrices.distances[candidate_idx][to_matrix_idx] as f64;
            let time_from_to_candidate = matrices.durations[from_matrix_idx][candidate_idx] as f64;
            let time_candidate_to_next = matrices.durations[candidate_idx][to_matrix_idx] as f64;

            let new_distance_km = (dist_from_to_candidate + dist_candidate_to_next) / 1000.0;
            let new_time_min = (time_from_to_candidate + time_candidate_to_next) / 60.0;

            let delta_km = new_distance_km - current_distance_km;
            let delta_min = new_time_min - current_time_min + calc_req.candidate.service_duration_minutes as f64;

            // Determine names
            let insert_after_name = if insert_idx == 0 {
                "Depo".to_string()
            } else {
                calc_req.route_stops[insert_idx - 1].name.clone()
            };

            let insert_before_name = if insert_idx >= num_stops {
                "Depo".to_string()
            } else {
                calc_req.route_stops[insert_idx].name.clone()
            };

            // Estimate arrival/departure times (simplified)
            let base_time = chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap();
            let accumulated_min = (insert_idx as f64) * 45.0 + delta_min / 2.0; // Rough estimate
            let arrival = base_time + chrono::Duration::minutes(accumulated_min as i64);
            let departure = arrival + chrono::Duration::minutes(calc_req.candidate.service_duration_minutes as i64);

            // Determine status based on delta
            let status = if delta_min < 15.0 {
                "ok"
            } else if delta_min < 30.0 {
                "tight"
            } else {
                "conflict"
            };

            positions.push(InsertionPosition {
                insert_after_index: (insert_idx as i32) - 1,
                insert_after_name,
                insert_before_name,
                delta_km,
                delta_min,
                estimated_arrival: arrival.format("%H:%M").to_string(),
                estimated_departure: departure.format("%H:%M").to_string(),
                status: status.to_string(),
                conflict_reason: if status == "conflict" { Some("Vysoký časový dopad".to_string()) } else { None },
            });
        }

        // Sort by delta_min to find best
        positions.sort_by(|a, b| a.delta_min.partial_cmp(&b.delta_min).unwrap_or(std::cmp::Ordering::Equal));

        let best_position = positions.first().cloned();
        let is_feasible = best_position.as_ref().map(|p| p.status != "conflict").unwrap_or(false);

        let response = SuccessResponse::new(request.id, CalculateInsertionResponse {
            candidate_id: calc_req.candidate.id.clone(),
            best_position,
            all_positions: positions,
            is_feasible,
            infeasible_reason: if !is_feasible { Some("Všechny pozice mají konflikt".to_string()) } else { None },
        });

        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

// ============================================================================
// Batch Insertion Calculation Handler
// ============================================================================

/// Request for batch insertion calculation
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculateBatchInsertionRequest {
    pub route_stops: Vec<RouteStopInput>,
    pub depot: Coordinates,
    pub candidates: Vec<InsertionCandidateInput>,
    pub date: String,
    pub workday_start: Option<String>,
    pub workday_end: Option<String>,
    pub best_only: Option<bool>,
}

/// Single result in batch insertion response
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchInsertionResult {
    pub candidate_id: String,
    pub best_delta_km: f64,
    pub best_delta_min: f64,
    pub best_insert_after_index: i32,
    pub status: String,
    pub is_feasible: bool,
}

/// Response for batch insertion calculation
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculateBatchInsertionResponse {
    pub results: Vec<BatchInsertionResult>,
    pub processing_time_ms: u64,
}

/// Handle route.insertion.batch messages
/// Calculates best insertion position for multiple candidates efficiently
pub async fn handle_insertion_batch(
    client: Client,
    mut subscriber: Subscriber,
    _pool: PgPool,
    _jwt_secret: Arc<String>,
    routing_service: Arc<dyn RoutingService>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.insertion.batch message");
        let start_time = std::time::Instant::now();

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<CalculateBatchInsertionRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse batch request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let calc_req = &request.payload;
        let mut results: Vec<BatchInsertionResult> = Vec::new();

        // If no candidates, return empty results
        if calc_req.candidates.is_empty() {
            let response = SuccessResponse::new(request.id, CalculateBatchInsertionResponse {
                results: vec![],
                processing_time_ms: start_time.elapsed().as_millis() as u64,
            });
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        }

        // Build location list: all candidates, then depot, then route stops
        // This allows us to compute one matrix for all candidates
        let mut all_locations: Vec<Coordinates> = Vec::new();
        
        // Add all candidates first (indices 0 to num_candidates-1)
        for candidate in &calc_req.candidates {
            all_locations.push(candidate.coordinates);
        }
        let num_candidates = calc_req.candidates.len();
        
        // Add depot (index num_candidates)
        all_locations.push(calc_req.depot);
        let depot_idx = num_candidates;
        
        // Add route stops (indices num_candidates+1 onwards)
        for stop in &calc_req.route_stops {
            all_locations.push(stop.coordinates);
        }

        // Get the matrix for all locations
        let matrices = match routing_service.get_matrices(&all_locations).await {
            Ok(m) => m,
            Err(e) => {
                warn!("Routing service failed: {}. Using estimates.", e);
                let mock = MockRoutingService::new();
                match mock.get_matrices(&all_locations).await {
                    Ok(m) => m,
                    Err(e2) => {
                        error!("Mock routing also failed: {}", e2);
                        let error = ErrorResponse::new(request.id, "ROUTING_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                        continue;
                    }
                }
            }
        };

        let num_stops = calc_req.route_stops.len();

        // Calculate insertion for each candidate
        for (candidate_idx, candidate) in calc_req.candidates.iter().enumerate() {
            // If no route stops, insertion is trivially at position 0
            if calc_req.route_stops.is_empty() {
                results.push(BatchInsertionResult {
                    candidate_id: candidate.id.clone(),
                    best_delta_km: 0.0,
                    best_delta_min: candidate.service_duration_minutes as f64,
                    best_insert_after_index: -1,
                    status: "ok".to_string(),
                    is_feasible: true,
                });
                continue;
            }

            // Find best insertion position for this candidate
            let mut best_delta_min = f64::MAX;
            let mut best_delta_km = 0.0;
            let mut best_insert_idx: i32 = -1;

            for insert_idx in 0..=num_stops {
                // Matrix indices for "from" and "to" nodes
                // Route stops start at index num_candidates+1
                let from_matrix_idx = if insert_idx == 0 { 
                    depot_idx 
                } else { 
                    num_candidates + insert_idx  // route stop at insert_idx-1
                };
                let to_matrix_idx = if insert_idx >= num_stops { 
                    depot_idx 
                } else { 
                    num_candidates + 1 + insert_idx  // route stop at insert_idx
                };

                // Current edge cost (from -> to without candidate)
                let current_distance_m = matrices.distances[from_matrix_idx][to_matrix_idx] as f64;
                let current_time_s = matrices.durations[from_matrix_idx][to_matrix_idx] as f64;

                // New costs with candidate insertion
                let dist_from_to_candidate = matrices.distances[from_matrix_idx][candidate_idx] as f64;
                let dist_candidate_to_next = matrices.distances[candidate_idx][to_matrix_idx] as f64;
                let time_from_to_candidate = matrices.durations[from_matrix_idx][candidate_idx] as f64;
                let time_candidate_to_next = matrices.durations[candidate_idx][to_matrix_idx] as f64;

                let delta_km = (dist_from_to_candidate + dist_candidate_to_next - current_distance_m) / 1000.0;
                let delta_min = (time_from_to_candidate + time_candidate_to_next - current_time_s) / 60.0 
                    + candidate.service_duration_minutes as f64;

                if delta_min < best_delta_min {
                    best_delta_min = delta_min;
                    best_delta_km = delta_km;
                    best_insert_idx = (insert_idx as i32) - 1;
                }
            }

            // Determine status based on best delta
            let status = if best_delta_min < 15.0 {
                "ok"
            } else if best_delta_min < 30.0 {
                "tight"
            } else {
                "conflict"
            };

            results.push(BatchInsertionResult {
                candidate_id: candidate.id.clone(),
                best_delta_km,
                best_delta_min,
                best_insert_after_index: best_insert_idx,
                status: status.to_string(),
                is_feasible: status != "conflict",
            });
        }

        let processing_time_ms = start_time.elapsed().as_millis() as u64;
        info!("Batch insertion calculated for {} candidates in {}ms", results.len(), processing_time_ms);

        let response = SuccessResponse::new(request.id, CalculateBatchInsertionResponse {
            results,
            processing_time_ms,
        });

        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

/// Haversine distance in km
fn haversine_km(a: Coordinates, b: Coordinates) -> f64 {
    const R: f64 = 6371.0; // Earth radius in km
    let d_lat = (b.lat - a.lat).to_radians();
    let d_lng = (b.lng - a.lng).to_radians();
    let lat1 = a.lat.to_radians();
    let lat2 = b.lat.to_radians();

    let h = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lng / 2.0).sin().powi(2);
    2.0 * R * h.sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::WorkingHours;
    use chrono::Timelike;

    fn prague() -> Coordinates {
        Coordinates { lat: 50.0755, lng: 14.4378 }
    }

    #[test]
    fn test_build_vrp_problem_empty() {
        let problem = build_vrp_problem(
            &prague(),
            &[],
            chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            30,
            None,
        );

        assert!(problem.stops.is_empty());
        assert!((problem.depot.coordinates.lat - 50.0755).abs() < 0.001);
    }

    #[test]
    fn test_build_vrp_problem_with_customers() {
        let customers = vec![
            CustomerForRoute {
                id: Uuid::new_v4(),
                name: Some("Customer A".to_string()),
                street: Some("Street 1".to_string()),
                city: Some("Prague".to_string()),
                postal_code: Some("11000".to_string()),
                lat: Some(50.1),
                lng: Some(14.5),
                scheduled_time_start: None,
                scheduled_time_end: None,
            },
            CustomerForRoute {
                id: Uuid::new_v4(),
                name: Some("Customer B".to_string()),
                street: Some("Street 2".to_string()),
                city: Some("Brno".to_string()),
                postal_code: Some("60200".to_string()),
                lat: Some(49.2),
                lng: Some(16.6),
                scheduled_time_start: None,
                scheduled_time_end: None,
            },
        ];

        let problem = build_vrp_problem(
            &prague(),
            &customers,
            chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            30,
            None,
        );

        assert_eq!(problem.stops.len(), 2);
        assert_eq!(problem.stops[0].customer_name, "Customer A");
        assert_eq!(problem.stops[1].customer_name, "Customer B");
    }

    #[test]
    fn test_build_vrp_problem_uses_custom_service_duration() {
        let customers = vec![
            CustomerForRoute {
                id: Uuid::new_v4(),
                name: Some("Customer A".to_string()),
                street: Some("Street 1".to_string()),
                city: Some("Prague".to_string()),
                postal_code: Some("11000".to_string()),
                lat: Some(50.1),
                lng: Some(14.5),
                scheduled_time_start: None,
                scheduled_time_end: None,
            },
        ];

        // Test with 45 minute service duration
        let problem = build_vrp_problem(
            &prague(),
            &customers,
            chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            45, // Custom service duration
            None,
        );

        assert_eq!(problem.stops.len(), 1);
        assert_eq!(problem.stops[0].service_duration_minutes, 45);
    }

    #[test]
    fn test_build_vrp_problem_uses_working_hours() {
        let customers = vec![
            CustomerForRoute {
                id: Uuid::new_v4(),
                name: Some("Customer A".to_string()),
                street: Some("Street 1".to_string()),
                city: Some("Prague".to_string()),
                postal_code: Some("11000".to_string()),
                lat: Some(50.1),
                lng: Some(14.5),
                scheduled_time_start: None,
                scheduled_time_end: None,
            },
        ];

        // Test with custom working hours 9:00-16:00
        let problem = build_vrp_problem(
            &prague(),
            &customers,
            chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            chrono::NaiveTime::from_hms_opt(16, 0, 0).unwrap(),
            30,
            None,
        );

        assert_eq!(problem.shift_start.hour(), 9);
        assert_eq!(problem.shift_end.hour(), 16);
    }

    #[test]
    fn test_working_hours_default() {
        // Default WorkingHours uses full day (0:00-23:59) to not constrain planning
        // Actual working hours come from user settings
        let hours = WorkingHours::default();
        assert_eq!(hours.start.hour(), 0);
        assert_eq!(hours.end.hour(), 23);
    }
}
