//! Sazinka Worker - Backend service for CRM and route planning
//!
//! This worker connects to NATS and handles messages from the frontend.

mod auth;
mod config;
mod defaults;
mod db;
mod handlers;
mod services;
mod types;

use anyhow::Result;
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

#[tokio::main]
async fn main() -> Result<()> {
    // Logs directory - use LOGS_DIR env var or default to ../logs (relative to worker)
    let logs_dir = std::env::var("LOGS_DIR")
        .unwrap_or_else(|_| "../logs".to_string());
    std::fs::create_dir_all(&logs_dir).ok();
    
    // File appender for persistent logs (daily rotation)
    let file_appender = RollingFileAppender::new(
        Rotation::DAILY,
        &logs_dir,
        "worker.log",
    );
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    // Initialize logging - both stdout and file
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,sazinka_worker=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())  // stdout
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking).with_ansi(false))  // file
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

    // Ensure dev admin has a valid password hash
    db::ensure_dev_admin_password(&pool).await;

    // Connect to NATS (supports optional NATS_USER/NATS_PASSWORD auth).
    let nats_client = match (std::env::var("NATS_USER"), std::env::var("NATS_PASSWORD")) {
        (Ok(user), Ok(password)) if !user.is_empty() => {
            async_nats::ConnectOptions::new()
                .user_and_password(user, password)
                .connect(&config.nats_url)
                .await?
        }
        _ => async_nats::connect(&config.nats_url).await?,
    };
    info!("Connected to NATS at {}", config.nats_url);

    // Start message handlers
    let handler_result = handlers::start_handlers(nats_client, pool, &config).await;

    if let Err(e) = handler_result {
        error!("Handler error: {}", e);
        return Err(e);
    }

    Ok(())
}
