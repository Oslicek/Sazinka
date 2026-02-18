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
/// Before running, fixes two common issues:
/// 1. Checksum mismatches caused by CRLF/LF line-ending differences
///    (Windows git autocrlf).
/// 2. Orphaned migration records — rows in `_sqlx_migrations` for files
///    that were deleted/merged and no longer exist on disk. Without
///    cleanup, `sqlx::migrate!` refuses to run with "migration N was
///    previously applied but is missing in the resolved migrations".
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Running database migrations...");

    let migrator = sqlx::migrate!("./migrations");
    remove_orphaned_migrations(pool, &migrator).await?;
    fix_migration_checksums(pool, &migrator).await?;
    migrator.run(pool).await?;

    info!("Database migrations complete");
    Ok(())
}

/// Remove rows from `_sqlx_migrations` that reference migration versions
/// no longer present in the compiled migrator. This happens when migration
/// files are deleted or merged into the initial schema.
async fn remove_orphaned_migrations(pool: &PgPool, migrator: &sqlx::migrate::Migrator) -> Result<()> {
    let table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_sqlx_migrations')"
    )
    .fetch_one(pool)
    .await?;

    if !table_exists {
        return Ok(());
    }

    let known_versions: Vec<i64> = migrator
        .iter()
        .filter(|m| !m.migration_type.is_down_migration())
        .map(|m| m.version)
        .collect();

    let applied: Vec<(i64,)> = sqlx::query_as(
        "SELECT version FROM _sqlx_migrations"
    )
    .fetch_all(pool)
    .await?;

    for (version,) in applied {
        if !known_versions.contains(&version) {
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
/// embedded in the current binary. This handles the case where a migration
/// was applied on one platform (LF) and the binary was compiled on another
/// (CRLF), producing a different SHA-384 for the same logical content.
async fn fix_migration_checksums(pool: &PgPool, migrator: &sqlx::migrate::Migrator) -> Result<()> {
    let table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '_sqlx_migrations')"
    )
    .fetch_one(pool)
    .await?;

    if !table_exists {
        return Ok(());
    }

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
                    "Migration {} ({}) checksum mismatch — updating stored checksum (likely CRLF/LF difference)",
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
