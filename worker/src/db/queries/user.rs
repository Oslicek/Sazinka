//! User database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;

use crate::types::user::User;

/// Get user by ID
pub async fn get_user(pool: &PgPool, user_id: Uuid) -> Result<Option<User>> {
    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT
            id, email, password_hash, name, phone,
            business_name, street, city, postal_code, country,
            lat, lng,
            default_revision_interval_months,
            working_hours_start, working_hours_end,
            max_revisions_per_day,
            created_at, updated_at
        FROM users
        WHERE id = $1
        "#
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}

/// Get user by email (for login)
pub async fn get_user_by_email(pool: &PgPool, email: &str) -> Result<Option<User>> {
    let user = sqlx::query_as::<_, User>(
        r#"
        SELECT
            id, email, password_hash, name, phone,
            business_name, street, city, postal_code, country,
            lat, lng,
            default_revision_interval_months,
            working_hours_start, working_hours_end,
            max_revisions_per_day,
            created_at, updated_at
        FROM users
        WHERE email = $1
        "#
    )
    .bind(email)
    .fetch_optional(pool)
    .await?;

    Ok(user)
}
