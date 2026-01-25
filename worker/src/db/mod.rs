//! Database module

pub mod queries;

use anyhow::Result;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::info;

/// Create a database connection pool
pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;

    Ok(pool)
}

/// Run database migrations
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Running database migrations...");
    sqlx::migrate!("./migrations")
        .run(pool)
        .await?;
    Ok(())
}
