//! Sazinka Worker - Backend service for CRM and route planning
//!
//! This worker connects to NATS and handles messages from the frontend.

mod admin;
mod auth;
mod cli;
mod config;
mod defaults;
mod db;
mod handlers;
mod services;
mod types;

use anyhow::Result;
use clap::Parser;
use tracing::{info, error};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use tracing_appender::rolling::{RollingFileAppender, Rotation};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = cli::Cli::parse();

    dotenvy::dotenv().ok();

    let config = config::Config::from_env()?;
    let pool = db::create_pool(&config.database_url).await?;

    match cli.command {
        Some(cli::Command::Migrate) => {
            db::run_migrations(&pool).await?;
            info!("Migrations complete, exiting.");
            Ok(())
        }
        Some(cli::Command::CreateAdmin { email }) => {
            db::run_migrations(&pool).await?;
            admin::create_admin_interactive(&pool, &email).await
        }
        Some(cli::Command::Serve) | None => run_server(config, pool).await,
    }
}

async fn run_server(config: config::Config, pool: sqlx::PgPool) -> Result<()> {
    let logs_dir = std::env::var("LOGS_DIR")
        .unwrap_or_else(|_| "../logs".to_string());
    std::fs::create_dir_all(&logs_dir).ok();

    let file_appender = RollingFileAppender::new(
        Rotation::DAILY,
        &logs_dir,
        "worker.log",
    );
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info,sazinka_worker=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking).with_ansi(false))
        .init();

    info!("Starting Sazinka Worker...");
    info!("Configuration loaded");

    info!("Connected to PostgreSQL");

    db::run_migrations(&pool).await?;
    info!("Database migrations complete");

    db::ensure_countries_synced(&pool).await?;

    admin::ensure_admin_from_env(&pool).await;

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

    let handler_result = handlers::start_handlers(nats_client, pool, &config).await;

    if let Err(e) = handler_result {
        error!("Handler error: {}", e);
        return Err(e);
    }

    Ok(())
}
