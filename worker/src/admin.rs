//! Interactive admin account management.

use anyhow::{bail, Context, Result};
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

const MIN_PASSWORD_LENGTH: usize = 12;

/// Prompt for a password interactively (hidden input), confirm, hash, and
/// upsert the admin user in the database.
pub async fn create_admin_interactive(pool: &PgPool, email: &str) -> Result<()> {
    validate_email(email)?;

    let password = prompt_password()?;
    validate_password(&password)?;

    let hash = crate::auth::hash_password(&password)?;

    upsert_admin(pool, email, &hash).await?;

    println!("Admin account ready: {email}");
    Ok(())
}

/// Startup fallback: if ADMIN_PASSWORD_HASH is set and the admin row is
/// missing or has an invalid hash, apply the pre-computed hash.
/// This is the automated-deployment path — no plaintext password involved.
pub async fn ensure_admin_from_env(pool: &PgPool) {
    let hash = match std::env::var("ADMIN_PASSWORD_HASH") {
        Ok(h) if h.starts_with("$argon2") => h,
        _ => return,
    };

    let email = std::env::var("ADMIN_EMAIL")
        .unwrap_or_else(|_| "admin@sazinka.app".to_string());

    let row: Option<(String,)> = sqlx::query_as(
        "SELECT password_hash FROM users WHERE email = $1 AND role = 'admin'"
    )
    .bind(&email)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let needs_update = match &row {
        None => true,
        Some((existing,)) => !existing.starts_with("$argon2"),
    };

    if !needs_update {
        return;
    }

    info!("Applying ADMIN_PASSWORD_HASH for {email}");

    let result = sqlx::query(
        "INSERT INTO users (id, email, password_hash, name, role)
         VALUES ($1, $2, $3, 'Admin', 'admin')
         ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = 'admin'"
    )
    .bind(Uuid::new_v4())
    .bind(&email)
    .bind(&hash)
    .execute(pool)
    .await;

    match result {
        Ok(_) => info!("Admin account set via ADMIN_PASSWORD_HASH"),
        Err(e) => tracing::warn!("Failed to apply ADMIN_PASSWORD_HASH: {e}"),
    }
}

fn prompt_password() -> Result<String> {
    let pass = rpassword::prompt_password("Enter admin password: ")
        .context("Failed to read password")?;
    let confirm = rpassword::prompt_password("Confirm admin password: ")
        .context("Failed to read password confirmation")?;

    if pass != confirm {
        bail!("Passwords do not match");
    }
    Ok(pass)
}

fn validate_email(email: &str) -> Result<()> {
    if !email.contains('@') || !email.contains('.') {
        bail!("Invalid email address: {email}");
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<()> {
    if password.len() < MIN_PASSWORD_LENGTH {
        bail!(
            "Password must be at least {MIN_PASSWORD_LENGTH} characters (got {})",
            password.len()
        );
    }
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    if !(has_upper && has_lower && has_digit) {
        bail!("Password must contain uppercase, lowercase, and a digit");
    }
    Ok(())
}

async fn upsert_admin(pool: &PgPool, email: &str, hash: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, name, role)
         VALUES ($1, $2, $3, 'Admin', 'admin')
         ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = 'admin'"
    )
    .bind(Uuid::new_v4())
    .bind(email)
    .bind(hash)
    .execute(pool)
    .await
    .context("Failed to upsert admin user")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_email_passes() {
        assert!(validate_email("admin@example.com").is_ok());
    }

    #[test]
    fn invalid_email_fails() {
        assert!(validate_email("not-an-email").is_err());
    }

    #[test]
    fn short_password_rejected() {
        assert!(validate_password("Short1").is_err());
    }

    #[test]
    fn weak_password_rejected() {
        assert!(validate_password("alllowercase123").is_err());
    }

    #[test]
    fn strong_password_accepted() {
        assert!(validate_password("StrongPass123!").is_ok());
    }
}
