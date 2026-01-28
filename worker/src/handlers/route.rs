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
    RoutePlanRequest, RoutePlanResponse, PlannedRouteStop, RouteWarning,
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
            });
            let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            continue;
        }

        // Build VRP problem
        let working_hours = WorkingHours {
            start: chrono::NaiveTime::from_hms_opt(0, 0, 0).unwrap(),
            end: chrono::NaiveTime::from_hms_opt(23, 59, 59).unwrap(),
        };
        let vrp_problem = build_vrp_problem(
            &plan_request.start_location,
            &valid_customers,
            working_hours.start,
            working_hours.end,
        );

        // Build location list for matrix (depot + customers)
        let mut locations = vec![plan_request.start_location];
        for customer in &valid_customers {
            locations.push(Coordinates {
                lat: customer.lat.unwrap(),
                lng: customer.lng.unwrap(),
            });
        }

        // Get distance/time matrices
        let matrices = match routing_service.get_matrices(&locations).await {
            Ok(m) => m,
            Err(e) => {
                error!("Failed to get routing matrices: {}", e);
                let error = ErrorResponse::new(request.id, "ROUTING_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
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
                    service_duration_minutes: 30, // TODO: from customer/device data
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

        // Collect unassigned customer IDs
        let mut unassigned: Vec<Uuid> = invalid_ids.iter().map(|c| c.id).collect();
        for stop_id in &solution.unassigned {
            if let Ok(id) = Uuid::parse_str(stop_id) {
                unassigned.push(id);
            }
        }

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
            service_duration_minutes: 30, // Default service time
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
        );

        assert_eq!(problem.stops.len(), 2);
        assert_eq!(problem.stops[0].customer_name, "Customer A");
        assert_eq!(problem.stops[1].customer_name, "Customer B");
    }

    #[test]
    fn test_working_hours_default() {
        let hours = WorkingHours::default();
        assert_eq!(hours.start.hour(), 8);
        assert_eq!(hours.end.hour(), 17);
    }
}
