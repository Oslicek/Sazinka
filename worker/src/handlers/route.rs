//! Route planning message handlers

use std::sync::Arc;
use std::collections::HashMap;
use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use serde_json::json;
use tracing::{debug, error, warn, info};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::defaults::{default_work_end, default_work_start, DEFAULT_SERVICE_DURATION_MINUTES};
use crate::services::insertion::{calculate_insertion_positions, StopMeta};
use crate::services::routing::{RoutingService, MockRoutingService};
use crate::services::sequential_schedule::{
    self, ScheduleInput, ScheduleStop as SeqScheduleStop,
    StopType as SeqStopType,
};
use crate::services::vrp::{VrpSolver, VrpProblem, VrpStop, Depot, SolverConfig, StopTimeWindow, BreakConfig};
use crate::types::{
    Coordinates, ErrorResponse, Request, SuccessResponse,
    PlannedRouteStop, RoutePlanRequest, RoutePlanResponse, RouteStatus, RouteWarning, StopType,
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
                message: json!({"key": "jobs:customer_no_coordinates_excluded", "params": {"name": customer.name.as_deref().unwrap_or("(unnamed)")}}).to_string(),
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

        // Load crew (if specified) for working hours and arrival buffer
        let crew = if let Some(crew_id) = plan_request.crew_id {
            match queries::crew::get_crew(&pool, crew_id, user_id).await {
                Ok(Some(c)) => {
                    info!("Using crew '{}': working hours {:?}-{:?}",
                        c.name, c.working_hours_start, c.working_hours_end);
                    Some(c)
                }
                _ => {
                    warn!("Crew {} not found, using user settings", crew_id);
                    None
                }
            }
        } else {
            None
        };

        // TODO(PRJ_SOLVER phase 6): read buffer from route/request instead of hardcoded defaults
        let arrival_buffer_percent = 10.0_f64;
        let arrival_buffer_fixed_minutes = 0.0_f64;

        // Load user settings for service duration, break config, and fallback working hours
        let (user_shift_start, user_shift_end, service_duration, break_config) = match queries::settings::get_user_settings(&pool, user_id).await {
            Ok(Some(settings)) => {
                let break_cfg = if settings.break_enabled {
                    Some(BreakConfig {
                        earliest_time: settings.break_earliest_time,
                        latest_time: settings.break_latest_time,
                        duration_minutes: settings.break_duration_minutes as u32,
                    })
                } else {
                    None
                };
                (settings.working_hours_start, settings.working_hours_end, settings.default_service_duration_minutes as u32, break_cfg)
            }
            Ok(None) => {
                warn!("User {} not found in database, using default settings", user_id);
                (
                    default_work_start(),
                    default_work_end(),
                    DEFAULT_SERVICE_DURATION_MINUTES,
                    None,
                )
            }
            Err(e) => {
                warn!("Failed to load user settings: {}, using defaults", e);
                (
                    default_work_start(),
                    default_work_end(),
                    DEFAULT_SERVICE_DURATION_MINUTES,
                    None,
                )
            }
        };

        // Crew working hours take priority over user settings
        let shift_start = crew.as_ref().map(|c| c.working_hours_start).unwrap_or(user_shift_start);
        let shift_end = crew.as_ref().map(|c| c.working_hours_end).unwrap_or(user_shift_end);
        info!("Route planning shift: {:?}-{:?} (crew override: {})", shift_start, shift_end, crew.is_some());

        // Build VRP problem
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
            if let Some(coords) = customer_coordinates(customer) {
                locations.push(coords);
            }
        }

        // Get distance/time matrices (with fallback to mock if Valhalla fails)
        let (matrices, routing_fallback_used) = match routing_service.get_matrices(&locations).await {
            Ok(m) => (m, false),
            Err(e) => {
                warn!("Primary routing service failed: {}. Falling back to mock routing.", e);
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

        // Solve VRP - solver handles timeout and spawn_blocking internally
        let solver_config = SolverConfig::with_buffer(5, 500, arrival_buffer_percent, arrival_buffer_fixed_minutes);
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
                    coordinates: customer_coordinates(customer).unwrap_or(plan_request.start_location),
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
                    stop_type: Some(StopType::Customer),
                    break_duration_minutes: None,
                    break_time_start: None,
                    distance_from_previous_km: leg_distance_km,
                    duration_from_previous_minutes: leg_duration_min,
                });
                if matrix_index > 0 {
                    previous_matrix_index = matrix_index;
                }
            } else if stop.customer_id.is_nil() {
                // Break stop — crew stays at the previous location,
                // so the travel leg is 0 km / 0 min.
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
                    stop_type: Some(StopType::Break),
                    break_duration_minutes: Some(((stop.departure_time - stop.arrival_time).num_minutes().max(0)) as i32),
                    break_time_start: Some(stop.arrival_time),
                    distance_from_previous_km: Some(0.0),
                    duration_from_previous_minutes: Some(0),
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
                message: json!({"key": "jobs:routing_fallback"}).to_string(),
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
            let (tw_start, tw_end) = match queries::revision::get_scheduled_time_window_with_fallback(
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
        .filter_map(|c| {
            let coordinates = customer_coordinates(c)?;
            // Scheduled customers support two modes:
            // - Flexible: service < full window, window [start, end-service].
            // - Pinned: service >= full window, point arrival [start, start].
            let (time_window, stop_service_duration) = match (c.scheduled_time_start, c.scheduled_time_end) {
                (Some(start), Some(end)) => {
                    let slot_minutes = (end - start).num_minutes();
                    if slot_minutes > 0 && service_duration_minutes < slot_minutes as u32 {
                        let latest_start = end - chrono::Duration::minutes(service_duration_minutes as i64);
                        info!(
                            "VRP stop {} ({}) scheduled {:?}-{:?} → flexible window={:?}-{:?}, service={}min",
                            c.id,
                            c.name.as_deref().unwrap_or("?"),
                            start, end, start, latest_start, service_duration_minutes,
                        );
                        (
                            Some(StopTimeWindow {
                                start,
                                end: latest_start,
                                is_hard: true,
                            }),
                            service_duration_minutes,
                        )
                    } else {
                        let pinned_service = slot_minutes.max(1) as u32;
                        info!(
                            "VRP stop {} ({}) scheduled {:?}-{:?} → pinned window={:?}, service={}min",
                            c.id,
                            c.name.as_deref().unwrap_or("?"),
                            start, end, start, pinned_service,
                        );
                        (
                            Some(StopTimeWindow {
                                start,
                                end: start, // Point arrival at slot start
                                is_hard: true,
                            }),
                            pinned_service,
                        )
                    }
                }
                _ => (None, service_duration_minutes),
            };

            Some(VrpStop {
                id: c.id.to_string(),
                customer_id: c.id,
                customer_name: c.name.clone().unwrap_or_default(),
                coordinates,
                service_duration_minutes: stop_service_duration,
                time_window,
                priority: 1,
            })
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

fn customer_coordinates(customer: &CustomerForRoute) -> Option<Coordinates> {
    Some(Coordinates {
        lat: customer.lat?,
        lng: customer.lng?,
    })
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

fn default_buffer_percent() -> f64 { 10.0 }

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
    #[serde(default = "default_buffer_percent")]
    pub arrival_buffer_percent: f64,
    #[serde(default)]
    pub arrival_buffer_fixed_minutes: f64,
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
    pub stop_type: Option<StopType>,
    pub break_duration_minutes: Option<i32>,
    pub break_time_start: Option<chrono::NaiveTime>,
    /// Optional status override (e.g. "unassigned"). Defaults to "pending".
    #[serde(default)]
    pub status: Option<String>,
    /// Per-stop service duration (minutes). If None, the global default is used.
    pub service_duration_minutes: Option<i32>,
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
            Err(e) => {
                warn!("Route save auth failed: {}", e);
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
            RouteStatus::Draft.as_str(),
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
                    let stop_type = stop.stop_type.unwrap_or(StopType::Customer).as_str().to_string();
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
                        stop.status.as_deref(),
                        stop.service_duration_minutes,
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
    /// Scheduled/agreed time window start (HH:MM)
    pub time_window_start: Option<String>,
    /// Scheduled/agreed time window end (HH:MM)
    pub time_window_end: Option<String>,
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
        let workday_start = calc_req
            .workday_start
            .as_deref()
            .and_then(|t| chrono::NaiveTime::parse_from_str(t, "%H:%M").ok())
            .unwrap_or_else(default_work_start);
        let workday_end = calc_req
            .workday_end
            .as_deref()
            .and_then(|t| chrono::NaiveTime::parse_from_str(t, "%H:%M").ok())
            .unwrap_or_else(default_work_end);

        // If no route stops, insertion is trivially at position 0
        if calc_req.route_stops.is_empty() {
            let arrival = workday_start;
            let departure = arrival + chrono::Duration::minutes(calc_req.candidate.service_duration_minutes as i64);
            let response = SuccessResponse::new(request.id, CalculateInsertionResponse {
                candidate_id: calc_req.candidate.id.clone(),
                best_position: Some(InsertionPosition {
                    insert_after_index: -1,
                    insert_after_name: "Depo".to_string(),
                    insert_before_name: "Depo".to_string(),
                    delta_km: 0.0,
                    delta_min: 0.0,
                    estimated_arrival: arrival.format("%H:%M").to_string(),
                    estimated_departure: departure.format("%H:%M").to_string(),
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
        // 2+ = route stops
        let stop_indices: Vec<usize> = (0..calc_req.route_stops.len()).map(|i| i + 2).collect();
        let candidate_service = calc_req.candidate.service_duration_minutes as i32;
        let stops_meta: Vec<StopMeta> = calc_req
            .route_stops
            .iter()
            .map(|s| StopMeta {
                name: s.name.clone(),
                arrival_time: s
                    .arrival_time
                    .as_deref()
                    .and_then(|t| chrono::NaiveTime::parse_from_str(t, "%H:%M").ok()),
                departure_time: s
                    .departure_time
                    .as_deref()
                    .and_then(|t| chrono::NaiveTime::parse_from_str(t, "%H:%M").ok()),
                time_window_start: s
                    .time_window_start
                    .as_deref()
                    .and_then(|t| chrono::NaiveTime::parse_from_str(t, "%H:%M").ok()),
                time_window_end: s
                    .time_window_end
                    .as_deref()
                    .and_then(|t| chrono::NaiveTime::parse_from_str(t, "%H:%M").ok()),
                // Use candidate's service duration as default for existing stops too
                // (all stops share the org-level default)
                service_duration_minutes: candidate_service,
            })
            .collect();
        let computed = calculate_insertion_positions(
            &matrices,
            0,
            1,
            &stop_indices,
            &stops_meta,
            candidate_service,
            workday_start,
            workday_end,
        );
        let positions: Vec<InsertionPosition> = computed
            .iter()
            .map(|p| InsertionPosition {
                insert_after_index: p.insert_after_index,
                insert_after_name: p.insert_after_name.clone(),
                insert_before_name: p.insert_before_name.clone(),
                delta_km: p.delta_km,
                delta_min: p.delta_min,
                estimated_arrival: p.estimated_arrival.format("%H:%M").to_string(),
                estimated_departure: p.estimated_departure.format("%H:%M").to_string(),
                status: p.status.clone(),
                conflict_reason: p.conflict_reason.clone(),
            })
            .collect();
        let best_position = positions.first().cloned();
        let is_feasible = best_position.as_ref().map(|p| p.status != "conflict").unwrap_or(false);

        let response = SuccessResponse::new(request.id, CalculateInsertionResponse {
            candidate_id: calc_req.candidate.id.clone(),
            best_position,
            all_positions: positions,
            is_feasible,
            infeasible_reason: if !is_feasible { Some("planner:all_positions_conflict".to_string()) } else { None },
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

// ============================================================================
// Route Recalculate Handler (quick ETA recalc after insert / reorder)
// ============================================================================

/// A stop in the recalculation request (sent from frontend)
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcStopInput {
    pub coordinates: Coordinates,
    pub stop_type: String,
    pub scheduled_time_start: Option<String>,
    pub scheduled_time_end: Option<String>,
    pub service_duration_minutes: Option<i32>,
    pub break_duration_minutes: Option<i32>,
    /// Passthrough fields returned unchanged so frontend can match results
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub customer_id: Option<String>,
    #[serde(default)]
    pub customer_name: Option<String>,
}

/// Request payload for route.recalculate
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalculateRequest {
    pub depot: Coordinates,
    pub stops: Vec<RecalcStopInput>,
    pub workday_start: Option<String>,
    pub workday_end: Option<String>,
    pub default_service_duration_minutes: Option<i32>,
    /// Percentage buffer added to travel time (0 = none).
    #[serde(default)]
    pub arrival_buffer_percent: f64,
    /// Fixed buffer in minutes added to every travel segment (0 = none).
    #[serde(default)]
    pub arrival_buffer_fixed_minutes: f64,
}

/// A single recalculated stop in the response
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcStopResult {
    pub order: i32,
    pub estimated_arrival: String,
    pub estimated_departure: String,
    pub distance_from_previous_km: f64,
    pub duration_from_previous_minutes: i32,
    pub service_duration_minutes: i32,
    /// Passthrough
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_name: Option<String>,
}

/// Response for route.recalculate
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalculateResponse {
    pub stops: Vec<RecalcStopResult>,
    /// Computed depot departure time (may be earlier than workday_start
    /// when the first stop is scheduled — backward-calculated).
    pub depot_departure: String,
    pub return_to_depot_distance_km: f64,
    pub return_to_depot_duration_minutes: i32,
    pub total_distance_km: f64,
    pub total_travel_minutes: i32,
    pub total_service_minutes: i32,
}

/// Handle sazinka.route.recalculate
///
/// Parse time from various formats: "HH:MM", "HH:MM:SS", "HH:MM:SS.xxx"
fn parse_time_flexible(s: &str) -> Option<chrono::NaiveTime> {
    let trimmed = s.trim();
    // Try HH:MM first, then HH:MM:SS
    chrono::NaiveTime::parse_from_str(trimmed, "%H:%M")
        .or_else(|_| chrono::NaiveTime::parse_from_str(trimmed, "%H:%M:%S"))
        .or_else(|_| chrono::NaiveTime::parse_from_str(&trimmed[..8.min(trimmed.len())], "%H:%M:%S"))
        .ok()
}

/// Quick ETA recalculation: receives ordered stops + depot, fetches the Valhalla
/// distance/time matrix, runs `compute_sequential_schedule`, returns updated
/// arrival/departure times per stop.
pub async fn handle_recalculate(
    client: Client,
    mut subscriber: Subscriber,
    _pool: PgPool,
    _jwt_secret: Arc<String>,
    routing_service: Arc<dyn RoutingService>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received route.recalculate message");

        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => {
                warn!("route.recalculate: message without reply subject");
                continue;
            }
        };

        let request: Request<RecalculateRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("route.recalculate: failed to parse: {}", e);
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let payload = &request.payload;
        info!("route.recalculate: buffer_percent={}, buffer_fixed_min={}, stops={}",
            payload.arrival_buffer_percent, payload.arrival_buffer_fixed_minutes, payload.stops.len());
        let default_service = payload
            .default_service_duration_minutes
            .unwrap_or(DEFAULT_SERVICE_DURATION_MINUTES as i32);
        let workday_start = payload
            .workday_start
            .as_deref()
            .and_then(parse_time_flexible)
            .unwrap_or_else(default_work_start);

        // Empty route → trivial response
        if payload.stops.is_empty() {
            let resp = SuccessResponse::new(
                request.id,
                RecalculateResponse {
                    stops: vec![],
                    depot_departure: workday_start.format("%H:%M").to_string(),
                    return_to_depot_distance_km: 0.0,
                    return_to_depot_duration_minutes: 0,
                    total_distance_km: 0.0,
                    total_travel_minutes: 0,
                    total_service_minutes: 0,
                },
            );
            let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            continue;
        }

        // Build locations for Valhalla: depot (0), then only non-break stops.
        // Break stops have no physical location (lat/lng = 0,0) and would cause
        // Valhalla to fail, falling back to the inaccurate mock router.
        // sequential_schedule already treats breaks as zero-travel, so their
        // matrix entries are never read – we assign them a dummy index (0 = depot).
        let mut locations: Vec<Coordinates> = Vec::with_capacity(1 + payload.stops.len());
        locations.push(payload.depot);

        let mut stop_matrix_indices: Vec<usize> = Vec::with_capacity(payload.stops.len());
        for s in &payload.stops {
            if s.stop_type == "break" {
                // Breaks don't participate in routing; dummy index (never read)
                stop_matrix_indices.push(0);
            } else {
                let idx = locations.len();
                locations.push(s.coordinates);
                stop_matrix_indices.push(idx);
            }
        }

        // Fetch routing matrix
        let matrices = match routing_service.get_matrices(&locations).await {
            Ok(m) => m,
            Err(e) => {
                warn!("route.recalculate: routing failed: {}. Using mock.", e);
                match MockRoutingService::new().get_matrices(&locations).await {
                    Ok(m) => m,
                    Err(e2) => {
                        error!("route.recalculate: mock also failed: {}", e2);
                        let err = ErrorResponse::new(request.id, "ROUTING_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                        continue;
                    }
                }
            }
        };

        // Build ScheduleInput
        let schedule_stops: Vec<SeqScheduleStop> = payload
            .stops
            .iter()
            .map(|s| {
                let st = if s.stop_type == "break" {
                    SeqStopType::Break
                } else {
                    SeqStopType::Customer
                };
                SeqScheduleStop {
                    stop_type: st,
                    scheduled_time_start: s
                        .scheduled_time_start
                        .as_deref()
                        .and_then(parse_time_flexible),
                    scheduled_time_end: s
                        .scheduled_time_end
                        .as_deref()
                        .and_then(parse_time_flexible),
                    service_duration_minutes: s.service_duration_minutes,
                    break_duration_minutes: s.break_duration_minutes,
                }
            })
            .collect();

        let input = ScheduleInput {
            depot_matrix_idx: 0,
            stops: schedule_stops,
            stop_matrix_indices,
            workday_start,
            default_service_minutes: default_service,
            arrival_buffer_percent: payload.arrival_buffer_percent,
            arrival_buffer_fixed_minutes: payload.arrival_buffer_fixed_minutes,
        };

        let result = sequential_schedule::compute_sequential_schedule(
            &input,
            &matrices.distances,
            &matrices.durations,
        );

        // Build response
        let stops: Vec<RecalcStopResult> = result
            .stops
            .iter()
            .enumerate()
            .map(|(i, cs)| RecalcStopResult {
                order: i as i32,
                estimated_arrival: cs.estimated_arrival.format("%H:%M").to_string(),
                estimated_departure: cs.estimated_departure.format("%H:%M").to_string(),
                distance_from_previous_km: cs.distance_from_previous_km,
                duration_from_previous_minutes: cs.duration_from_previous_minutes,
                service_duration_minutes: cs.service_duration_minutes,
                id: payload.stops[i].id.clone(),
                customer_id: payload.stops[i].customer_id.clone(),
                customer_name: payload.stops[i].customer_name.clone(),
            })
            .collect();

        let resp = SuccessResponse::new(
            request.id,
            RecalculateResponse {
                stops,
                depot_departure: result.depot_departure.format("%H:%M").to_string(),
                return_to_depot_distance_km: result.return_to_depot_distance_km,
                return_to_depot_duration_minutes: result.return_to_depot_duration_minutes,
                total_distance_km: result.total_distance_km,
                total_travel_minutes: result.total_travel_minutes,
                total_service_minutes: result.total_service_minutes,
            },
        );

        let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
        info!("route.recalculate: computed schedule for {} stops", payload.stops.len());
    }

    Ok(())
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
            default_work_start(),
            default_work_end(),
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
            default_work_start(),
            default_work_end(),
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
            default_work_start(),
            default_work_end(),
            45, // Custom service duration
            None,
        );

        assert_eq!(problem.stops.len(), 1);
        assert_eq!(problem.stops[0].service_duration_minutes, 45);
    }

    #[test]
    fn test_build_vrp_problem_uses_flexible_window_for_scheduled_stop() {
        let customers = vec![CustomerForRoute {
            id: Uuid::new_v4(),
            name: Some("Customer A".to_string()),
            street: Some("Street 1".to_string()),
            city: Some("Prague".to_string()),
            postal_code: Some("11000".to_string()),
            lat: Some(50.1),
            lng: Some(14.5),
            scheduled_time_start: Some(chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap()),
            scheduled_time_end: Some(chrono::NaiveTime::from_hms_opt(12, 0, 0).unwrap()),
        }];

        // Service 60 min is shorter than 4h window => flexible.
        let problem = build_vrp_problem(
            &prague(),
            &customers,
            default_work_start(),
            default_work_end(),
            60,
            None,
        );

        let stop = &problem.stops[0];
        let tw = stop.time_window.as_ref().expect("scheduled window expected");
        assert_eq!(stop.service_duration_minutes, 60);
        assert_eq!(tw.start, chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap());
        assert_eq!(tw.end, chrono::NaiveTime::from_hms_opt(11, 0, 0).unwrap());
    }

    #[test]
    fn test_build_vrp_problem_keeps_point_window_when_service_fills_slot() {
        let customers = vec![CustomerForRoute {
            id: Uuid::new_v4(),
            name: Some("Customer A".to_string()),
            street: Some("Street 1".to_string()),
            city: Some("Prague".to_string()),
            postal_code: Some("11000".to_string()),
            lat: Some(50.1),
            lng: Some(14.5),
            scheduled_time_start: Some(chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap()),
            scheduled_time_end: Some(chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap()),
        }];

        // Service 90 min is >= window length 60 => pinned behavior.
        let problem = build_vrp_problem(
            &prague(),
            &customers,
            default_work_start(),
            default_work_end(),
            90,
            None,
        );

        let stop = &problem.stops[0];
        let tw = stop.time_window.as_ref().expect("scheduled window expected");
        assert_eq!(stop.service_duration_minutes, 60);
        assert_eq!(tw.start, chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap());
        assert_eq!(tw.end, chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap());
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

    #[test]
    fn test_save_route_request_deserializes_buffer() {
        let json = r#"{
            "date": "2026-01-15",
            "stops": [],
            "totalDistanceKm": 0.0,
            "totalDurationMinutes": 0,
            "optimizationScore": 0,
            "arrivalBufferPercent": 12.0,
            "arrivalBufferFixedMinutes": 2.0
        }"#;
        let req: SaveRouteRequest = serde_json::from_str(json).unwrap();
        assert!((req.arrival_buffer_percent - 12.0).abs() < f64::EPSILON);
        assert!((req.arrival_buffer_fixed_minutes - 2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_save_route_request_buffer_defaults() {
        let json = r#"{
            "date": "2026-01-15",
            "stops": [],
            "totalDistanceKm": 0.0,
            "totalDurationMinutes": 0,
            "optimizationScore": 0
        }"#;
        let req: SaveRouteRequest = serde_json::from_str(json).unwrap();
        assert!((req.arrival_buffer_percent - 10.0).abs() < f64::EPSILON);
        assert!(req.arrival_buffer_fixed_minutes.abs() < f64::EPSILON);
    }
}
