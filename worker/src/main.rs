//! Sazinka Worker - Backend service for CRM and route planning
//!
//! This worker connects to NATS and handles messages from the frontend.

mod config;
mod db;
mod handlers;
mod services;
mod types;

use anyhow::Result;
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,sazinka_worker=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting Sazinka Worker...");

    // Load configuration
    let config = config::Config::from_env()?;
    info!("Configuration loaded");

    // Connect to database
    let pool = db::create_pool(&config.database_url).await?;
    info!("Connected to PostgreSQL");

    // Run migrations
    db::run_migrations(&pool).await?;
    info!("Database migrations complete");

    // Connect to NATS
    let nats_client = async_nats::connect(&config.nats_url).await?;
    info!("Connected to NATS at {}", config.nats_url);

    // Start message handlers
    let handler_result = handlers::start_handlers(nats_client, pool).await;

    if let Err(e) = handler_result {
        error!("Handler error: {}", e);
        return Err(e);
    }

    Ok(())
}
