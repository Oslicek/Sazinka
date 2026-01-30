//! Route planning message handlers

use std::sync::Arc;
use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn, info};
use uuid::Uuid;

use crate::db::queries;
use crate::services::routing::{RoutingService, MockRoutingService};
use crate::services::vrp::{VrpSolver, VrpProblem, VrpStop, Depot, SolverConfig, StopTimeWindow};
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
    routing_service: Arc<dyn RoutingService>,
) -> Result<()> {
    // Create VRP solver with fast config for interactive use
    let solver = VrpSolver::new(SolverConfig::fast());

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

        // Check user_id
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
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
            });
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        }

        // Load customers from database
        let customers = match load_customers(&pool, user_id, &plan_request.customer_ids).await {
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
                message: format!("Customer {} has no coordinates and was excluded", customer.name),
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
            });
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        }

        // Load user settings for working hours and service duration
        let (shift_start, shift_end, service_duration) = match queries::settings::get_user_settings(&pool, user_id).await {
            Ok(Some(settings)) => {
                let start = settings.working_hours_start;
                let end = settings.working_hours_end;
                let duration = settings.default_service_duration_minutes as u32;
                info!(
                    "Route planning using user settings: working hours {:?}-{:?}, service duration {} min",
                    start, end, duration
                );
                (start, end, duration)
            }
            Ok(None) => {
                // User not found in database
                warn!("User {} not found in database, using default settings", user_id);
                (
                    chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                    chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
                    30u32,
                )
            }
            Err(e) => {
                // Database error
                warn!("Failed to load user settings: {}, using defaults", e);
                (
                    chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
                    chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
                    30u32,
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

        // Solve VRP
        let solution = match solver.solve(&vrp_problem, &matrices, plan_request.date) {
            Ok(s) => s,
            Err(e) => {
                error!("VRP solver failed: {}", e);
                let error = ErrorResponse::new(request.id, "SOLVER_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Build response
        let mut planned_stops: Vec<PlannedRouteStop> = Vec::new();
        for stop in &solution.stops {
            // Find original customer
            if let Some(customer) = valid_customers.iter().find(|c| c.id.to_string() == stop.stop_id) {
                planned_stops.push(PlannedRouteStop {
                    customer_id: customer.id,
                    customer_name: customer.name.clone(),
                    address: format!(
                        "{}, {} {}",
                        customer.street, customer.city, customer.postal_code
                    ),
                    coordinates: Coordinates {
                        lat: customer.lat.unwrap(),
                        lng: customer.lng.unwrap(),
                    },
                    order: stop.order as i32,
                    eta: stop.arrival_time,
                    etd: stop.departure_time,
                    service_duration_minutes: service_duration as i32,
                    time_window: None, // TODO: from customer preferences
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
    name: String,
    street: String,
    city: String,
    postal_code: String,
    lat: Option<f64>,
    lng: Option<f64>,
}

/// Load customers from database
async fn load_customers(
    pool: &PgPool,
    user_id: Uuid,
    customer_ids: &[Uuid],
) -> Result<Vec<CustomerForRoute>> {
    let mut customers = Vec::new();

    for customer_id in customer_ids {
        if let Some(customer) = queries::customer::get_customer(pool, user_id, *customer_id).await? {
            customers.push(CustomerForRoute {
                id: customer.id,
                name: customer.name,
                street: customer.street,
                city: customer.city,
                postal_code: customer.postal_code,
                lat: customer.lat,
                lng: customer.lng,
            });
        }
    }

    Ok(customers)
}

/// Build VRP problem from customers
fn build_vrp_problem(
    start: &Coordinates,
    customers: &[CustomerForRoute],
    shift_start: chrono::NaiveTime,
    shift_end: chrono::NaiveTime,
    service_duration_minutes: u32,
) -> VrpProblem {
    let stops: Vec<VrpStop> = customers
        .iter()
        .map(|c| VrpStop {
            id: c.id.to_string(),
            customer_id: c.id,
            customer_name: c.name.clone(),
            coordinates: Coordinates {
                lat: c.lat.unwrap(),
                lng: c.lng.unwrap(),
            },
            service_duration_minutes,
            time_window: None, // TODO: from customer preferences
            priority: 1,
        })
        .collect();

    VrpProblem {
        depot: Depot {
            coordinates: *start,
        },
        stops,
        shift_start,
        shift_end,
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

/// Request to save a route
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRouteRequest {
    pub date: NaiveDate,
    pub stops: Vec<SaveRouteStop>,
    pub total_distance_km: f64,
    pub total_duration_minutes: i32,
    pub optimization_score: i32,
}

/// A stop to save
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRouteStop {
    pub customer_id: Uuid,
    pub revision_id: Option<Uuid>,
    pub order: i32,
    pub eta: Option<chrono::NaiveTime>,
    pub etd: Option<chrono::NaiveTime>,
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
    pub date: NaiveDate,
}

/// Response with saved route data
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRouteResponse {
    pub route: Option<Route>,
    pub stops: Vec<queries::route::RouteStopWithInfo>,
}

/// Handle route.save messages
pub async fn handle_save(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
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
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check user_id
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let payload = request.payload;
        info!("Saving route for date {} with {} stops", payload.date, payload.stops.len());

        // Upsert route
        match queries::route::upsert_route(
            &pool,
            user_id,
            payload.date,
            "saved",
            Some(payload.total_distance_km),
            Some(payload.total_duration_minutes),
            Some(payload.optimization_score),
        ).await {
            Ok(route) => {
                // Delete existing stops
                if let Err(e) = queries::route::delete_route_stops(&pool, route.id).await {
                    error!("Failed to delete existing stops: {}", e);
                    let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                    continue;
                }

                // Insert new stops (only those with revision_id)
                let mut saved_count = 0;
                for stop in &payload.stops {
                    if let Some(revision_id) = stop.revision_id {
                        if let Err(e) = queries::route::insert_route_stop(
                            &pool,
                            route.id,
                            revision_id,
                            stop.order,
                            stop.eta,
                            stop.etd,
                            None, // distance
                            None, // duration
                        ).await {
                            warn!("Failed to insert stop: {}", e);
                        } else {
                            saved_count += 1;
                        }
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

/// Handle route.get messages
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
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

        // Check user_id
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        info!("Getting route for date {}", request.payload.date);

        // Get route
        match queries::route::get_route_for_date(&pool, user_id, request.payload.date).await {
            Ok(Some(route)) => {
                // Get stops with info
                match queries::route::get_route_stops_with_info(&pool, route.id).await {
                    Ok(stops) => {
                        let response = SuccessResponse::new(
                            request.id,
                            GetRouteResponse {
                                route: Some(route),
                                stops,
                            },
                        );
                        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                        debug!("Returned saved route");
                    }
                    Err(e) => {
                        error!("Failed to get route stops: {}", e);
                        let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                    }
                }
            }
            Ok(None) => {
                // No saved route for this date
                let response = SuccessResponse::new(
                    request.id,
                    GetRouteResponse {
                        route: None,
                        stops: vec![],
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("No saved route for date {}", request.payload.date);
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
        );

        assert!(problem.stops.is_empty());
        assert!((problem.depot.coordinates.lat - 50.0755).abs() < 0.001);
    }

    #[test]
    fn test_build_vrp_problem_with_customers() {
        let customers = vec![
            CustomerForRoute {
                id: Uuid::new_v4(),
                name: "Customer A".to_string(),
                street: "Street 1".to_string(),
                city: "Prague".to_string(),
                postal_code: "11000".to_string(),
                lat: Some(50.1),
                lng: Some(14.5),
            },
            CustomerForRoute {
                id: Uuid::new_v4(),
                name: "Customer B".to_string(),
                street: "Street 2".to_string(),
                city: "Brno".to_string(),
                postal_code: "60200".to_string(),
                lat: Some(49.2),
                lng: Some(16.6),
            },
        ];

        let problem = build_vrp_problem(
            &prague(),
            &customers,
            chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            30,
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
                name: "Customer A".to_string(),
                street: "Street 1".to_string(),
                city: "Prague".to_string(),
                postal_code: "11000".to_string(),
                lat: Some(50.1),
                lng: Some(14.5),
            },
        ];

        // Test with 45 minute service duration
        let problem = build_vrp_problem(
            &prague(),
            &customers,
            chrono::NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            chrono::NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            45, // Custom service duration
        );

        assert_eq!(problem.stops.len(), 1);
        assert_eq!(problem.stops[0].service_duration_minutes, 45);
    }

    #[test]
    fn test_build_vrp_problem_uses_working_hours() {
        let customers = vec![
            CustomerForRoute {
                id: Uuid::new_v4(),
                name: "Customer A".to_string(),
                street: "Street 1".to_string(),
                city: "Prague".to_string(),
                postal_code: "11000".to_string(),
                lat: Some(50.1),
                lng: Some(14.5),
            },
        ];

        // Test with custom working hours 9:00-16:00
        let problem = build_vrp_problem(
            &prague(),
            &customers,
            chrono::NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            chrono::NaiveTime::from_hms_opt(16, 0, 0).unwrap(),
            30,
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
