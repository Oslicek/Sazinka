//! NATS message handlers

pub mod customer;
pub mod ping;
pub mod route;

use std::sync::Arc;
use anyhow::Result;
use async_nats::Client;
use sqlx::PgPool;
use tracing::{info, error};
use tokio::select;

use crate::services::geocoding::{create_geocoder, Geocoder};
use crate::services::routing::{RoutingService, MockRoutingService};

/// Start all message handlers
pub async fn start_handlers(client: Client, pool: PgPool) -> Result<()> {
    info!("Starting message handlers...");

    // Create shared geocoder
    let geocoder: Arc<dyn Geocoder> = Arc::from(create_geocoder());
    info!("Geocoder initialized: {}", geocoder.name());

    // Create routing service (mock for now, Valhalla when available)
    let routing_service: Arc<dyn RoutingService> = Arc::new(MockRoutingService::new());
    info!("Routing service initialized: {}", routing_service.name());

    // Subscribe to all subjects
    let ping_sub = client.subscribe("sazinka.ping").await?;
    let customer_create_sub = client.subscribe("sazinka.customer.create").await?;
    let customer_list_sub = client.subscribe("sazinka.customer.list").await?;
    let customer_get_sub = client.subscribe("sazinka.customer.get").await?;
    let customer_update_sub = client.subscribe("sazinka.customer.update").await?;
    let customer_delete_sub = client.subscribe("sazinka.customer.delete").await?;
    let customer_geocode_sub = client.subscribe("sazinka.customer.geocode").await?;
    let route_plan_sub = client.subscribe("sazinka.route.plan").await?;

    info!("Subscribed to NATS subjects");

    // Clone for each handler
    let client_ping = client.clone();
    let client_customer_create = client.clone();
    let client_customer_list = client.clone();
    let client_customer_get = client.clone();
    let client_customer_update = client.clone();
    let client_customer_delete = client.clone();
    let client_customer_geocode = client.clone();
    let client_route_plan = client.clone();
    
    let pool_customer_create = pool.clone();
    let pool_customer_list = pool.clone();
    let pool_customer_get = pool.clone();
    let pool_customer_update = pool.clone();
    let pool_customer_delete = pool.clone();
    let pool_route_plan = pool.clone();
    
    let geocoder_create = Arc::clone(&geocoder);
    let geocoder_update = Arc::clone(&geocoder);
    let geocoder_geocode = Arc::clone(&geocoder);
    
    let routing_plan = Arc::clone(&routing_service);

    // Spawn handlers
    let ping_handle = tokio::spawn(async move {
        ping::handle_ping(client_ping, ping_sub).await
    });

    let customer_create_handle = tokio::spawn(async move {
        customer::handle_create(client_customer_create, customer_create_sub, pool_customer_create, geocoder_create).await
    });

    let customer_list_handle = tokio::spawn(async move {
        customer::handle_list(client_customer_list, customer_list_sub, pool_customer_list).await
    });

    let customer_get_handle = tokio::spawn(async move {
        customer::handle_get(client_customer_get, customer_get_sub, pool_customer_get).await
    });

    let customer_update_handle = tokio::spawn(async move {
        customer::handle_update(client_customer_update, customer_update_sub, pool_customer_update, geocoder_update).await
    });

    let customer_delete_handle = tokio::spawn(async move {
        customer::handle_delete(client_customer_delete, customer_delete_sub, pool_customer_delete).await
    });

    let customer_geocode_handle = tokio::spawn(async move {
        customer::handle_geocode(client_customer_geocode, customer_geocode_sub, geocoder_geocode).await
    });

    let route_plan_handle = tokio::spawn(async move {
        route::handle_plan(client_route_plan, route_plan_sub, pool_route_plan, routing_plan).await
    });

    info!("All handlers started, waiting for messages...");

    // Wait for any handler to finish (which means an error occurred)
    select! {
        result = ping_handle => {
            error!("Ping handler finished: {:?}", result);
        }
        result = customer_create_handle => {
            error!("Customer create handler finished: {:?}", result);
        }
        result = customer_list_handle => {
            error!("Customer list handler finished: {:?}", result);
        }
        result = customer_get_handle => {
            error!("Customer get handler finished: {:?}", result);
        }
        result = customer_update_handle => {
            error!("Customer update handler finished: {:?}", result);
        }
        result = customer_delete_handle => {
            error!("Customer delete handler finished: {:?}", result);
        }
        result = customer_geocode_handle => {
            error!("Customer geocode handler finished: {:?}", result);
        }
        result = route_plan_handle => {
            error!("Route plan handler finished: {:?}", result);
        }
    }

    Ok(())
}
