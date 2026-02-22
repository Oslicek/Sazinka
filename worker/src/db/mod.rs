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

/// Run database migrations.
///
/// Before running, synchronizes `_sqlx_migrations` with the compiled
/// migration list:
/// 1. Removes orphaned records (applied versions whose files no longer exist).
/// 2. Fixes checksum mismatches (CRLF/LF differences across platforms).
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Running database migrations...");

    let migrator = sqlx::migrate!("./migrations");

    let compiled_versions: Vec<i64> = migrator
        .iter()
        .filter(|m| !m.migration_type.is_down_migration())
        .map(|m| m.version)
        .collect();
    info!("Compiled migration versions: {:?}", compiled_versions);

    let applied_versions = get_applied_versions(pool).await?;
    info!("DB applied migration versions: {:?}", applied_versions);

    remove_orphaned_migrations(pool, &compiled_versions, &applied_versions).await?;
    fix_migration_checksums(pool, &migrator).await?;
    migrator.run(pool).await?;

    info!("Database migrations complete");
    Ok(())
}

async fn get_applied_versions(pool: &PgPool) -> Result<Vec<i64>> {
    let table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_sqlx_migrations')"
    )
    .fetch_one(pool)
    .await?;

    if !table_exists {
        return Ok(vec![]);
    }

    let rows: Vec<(i64,)> = sqlx::query_as(
        "SELECT version FROM _sqlx_migrations ORDER BY version"
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(v,)| v).collect())
}

/// Remove rows from `_sqlx_migrations` whose version is not present in
/// the compiled migrator. This handles files that were deleted or merged
/// into the initial schema after being applied.
async fn remove_orphaned_migrations(
    pool: &PgPool,
    compiled_versions: &[i64],
    applied_versions: &[i64],
) -> Result<()> {
    for &version in applied_versions {
        if !compiled_versions.contains(&version) {
            warn!(
                "Removing orphaned migration record: version {} (file no longer exists)",
                version
            );
            sqlx::query("DELETE FROM _sqlx_migrations WHERE version = $1")
                .bind(version)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

/// Update stored checksums in `_sqlx_migrations` to match the checksums
/// embedded in the current binary. Handles CRLF/LF line-ending differences
/// across platforms.
async fn fix_migration_checksums(pool: &PgPool, migrator: &sqlx::migrate::Migrator) -> Result<()> {
    for migration in migrator.iter() {
        if migration.migration_type.is_down_migration() {
            continue;
        }

        let stored: Option<(Vec<u8>,)> = sqlx::query_as(
            "SELECT checksum FROM _sqlx_migrations WHERE version = $1"
        )
        .bind(migration.version)
        .fetch_optional(pool)
        .await?;

        if let Some((stored_checksum,)) = stored {
            let current_checksum: &[u8] = &migration.checksum;
            if stored_checksum != current_checksum {
                warn!(
                    "Migration {} ({}) checksum mismatch — updating stored checksum",
                    migration.version, migration.description
                );
                sqlx::query(
                    "UPDATE _sqlx_migrations SET checksum = $1 WHERE version = $2"
                )
                .bind(current_checksum)
                .bind(migration.version)
                .execute(pool)
                .await?;
            }
        }
    }

    Ok(())
}

/// Sync the embedded countries.json into the `countries` table.
/// Uses UPSERT — only canonical fields (names, alpha3) are written;
/// operational columns (has_map_coverage, is_supported, …) are preserved.
pub async fn ensure_countries_synced(pool: &PgPool) -> Result<()> {
    use crate::types::CountryJsonEntry;

    const COUNTRIES_JSON: &str = include_str!("../../../packages/countries/countries.json");

    let entries: Vec<CountryJsonEntry> = serde_json::from_str(COUNTRIES_JSON)?;

    let db_count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM countries")
        .fetch_one(pool)
        .await?;

    if (db_count.0 as usize) < entries.len() {
        info!(
            "Countries table has {} rows, JSON has {} — syncing...",
            db_count.0,
            entries.len()
        );
        let result = queries::country::sync_countries(pool, &entries).await?;
        info!(
            "Countries synced: {} total, {} added, {} updated",
            result.synced, result.added, result.updated
        );
    }

    Ok(())
}

/// Ensure the dev admin user has a valid Argon2 password hash.
///
/// Requires **both** `DEV_MODE=1` and `DEV_ADMIN_PASSWORD=<some-password>` to
/// be set. If the admin user's hash is invalid (e.g. "not-set" from a fresh
/// seed), it is replaced with the argon2 hash of `DEV_ADMIN_PASSWORD`.
///
/// This avoids hardcoding any password in the binary.
pub async fn ensure_dev_admin_password(pool: &PgPool) {
    if std::env::var("DEV_MODE").is_err() {
        return;
    }

    let dev_password = match std::env::var("DEV_ADMIN_PASSWORD") {
        Ok(p) if !p.is_empty() => p,
        _ => {
            warn!("DEV_MODE is active but DEV_ADMIN_PASSWORD is not set — skipping admin password fix");
            return;
        }
    };

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
            warn!("Dev admin user has invalid password hash — resetting from DEV_ADMIN_PASSWORD");
            match crate::auth::hash_password(&dev_password) {
                Ok(new_hash) => {
                    let result = sqlx::query(
                        "UPDATE users SET password_hash = $1, role = 'admin' WHERE id = $2"
                    )
                    .bind(&new_hash)
                    .bind(dev_id)
                    .execute(pool)
                    .await;

                    match result {
                        Ok(_) => info!("Dev admin password and role have been reset"),
                        Err(e) => warn!("Failed to update dev admin password: {}", e),
                    }
                }
                Err(e) => warn!("Failed to hash dev admin password: {}", e),
            }
        }
    }
}
