//! NATS message handlers

pub mod customer;
pub mod ping;

use anyhow::Result;
use async_nats::Client;
use sqlx::PgPool;
use tracing::{info, error};
use tokio::select;

/// Start all message handlers
pub async fn start_handlers(client: Client, pool: PgPool) -> Result<()> {
    info!("Starting message handlers...");

    // Subscribe to all subjects
    let ping_sub = client.subscribe("sazinka.ping").await?;
    let customer_create_sub = client.subscribe("sazinka.customer.create").await?;
    let customer_list_sub = client.subscribe("sazinka.customer.list").await?;
    let customer_get_sub = client.subscribe("sazinka.customer.get").await?;

    info!("Subscribed to NATS subjects");

    // Clone for each handler
    let client_ping = client.clone();
    let client_customer_create = client.clone();
    let client_customer_list = client.clone();
    let client_customer_get = client.clone();
    
    let pool_customer_create = pool.clone();
    let pool_customer_list = pool.clone();
    let pool_customer_get = pool.clone();

    // Spawn handlers
    let ping_handle = tokio::spawn(async move {
        ping::handle_ping(client_ping, ping_sub).await
    });

    let customer_create_handle = tokio::spawn(async move {
        customer::handle_create(client_customer_create, customer_create_sub, pool_customer_create).await
    });

    let customer_list_handle = tokio::spawn(async move {
        customer::handle_list(client_customer_list, customer_list_sub, pool_customer_list).await
    });

    let customer_get_handle = tokio::spawn(async move {
        customer::handle_get(client_customer_get, customer_get_sub, pool_customer_get).await
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
    }

    Ok(())
}
