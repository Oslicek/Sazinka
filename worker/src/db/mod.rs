//! Database module

pub mod queries;

use anyhow::Result;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::{info, warn};

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
    // Migrations already applied manually via docker exec
    // sqlx::migrate!("./migrations")
    //     .run(pool)
    //     .await?;
    info!("Skipping automatic migrations (already applied)");
    Ok(())
}

/// Ensure the dev admin user has a valid Argon2 password hash.
/// Only runs when DEV_MODE environment variable is set.
/// If the hash is invalid (e.g. "not_a_real_hash" or "not-set" from seed),
/// resets it to the dev default password.
pub async fn ensure_dev_admin_password(pool: &PgPool) {
    if std::env::var("DEV_MODE").is_err() {
        return; // Only run in development
    }

    warn!("DEV_MODE is active — checking dev admin password");
    use uuid::Uuid;

    let dev_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT password_hash FROM users WHERE id = $1"
    )
    .bind(dev_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some((hash,)) = row {
        if !hash.starts_with("$argon2") {
            warn!("Dev admin user has invalid password hash — resetting to dev default");
            match crate::auth::hash_password("password123") {
                Ok(new_hash) => {
                    let result = sqlx::query(
                        "UPDATE users SET password_hash = $1 WHERE id = $2"
                    )
                    .bind(&new_hash)
                    .bind(dev_id)
                    .execute(pool)
                    .await;

                    match result {
                        Ok(_) => info!("Dev admin password has been reset"),
                        Err(e) => warn!("Failed to update dev admin password: {}", e),
                    }
                }
                Err(e) => warn!("Failed to hash dev admin password: {}", e),
            }
        }
    }
}
