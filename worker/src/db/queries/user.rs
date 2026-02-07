//! User database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;

use crate::types::user::User;

const USER_COLUMNS: &str = r#"
    id, email, password_hash, name, phone,
    business_name, street, city, postal_code, country,
    lat, lng, ico, dic,
    default_revision_interval_months,
    default_service_duration_minutes,
    working_hours_start, working_hours_end,
    max_revisions_per_day,
    role, owner_id,
    created_at, updated_at
"#;

/// Get user by ID
pub async fn get_user(pool: &PgPool, user_id: Uuid) -> Result<Option<User>> {
    let query = format!(
        "SELECT {} FROM users WHERE id = $1",
        USER_COLUMNS
    );
    let user = sqlx::query_as::<_, User>(&query)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;

    Ok(user)
}

/// Get user by email (for login)
pub async fn get_user_by_email(pool: &PgPool, email: &str) -> Result<Option<User>> {
    let query = format!(
        "SELECT {} FROM users WHERE email = $1",
        USER_COLUMNS
    );
    let user = sqlx::query_as::<_, User>(&query)
        .bind(email)
        .fetch_optional(pool)
        .await?;

    Ok(user)
}

/// Create a new user (for registration)
pub async fn create_user(
    pool: &PgPool,
    email: &str,
    password_hash: &str,
    name: &str,
    business_name: Option<&str>,
    role: &str,
    owner_id: Option<Uuid>,
) -> Result<User> {
    let query = format!(
        r#"
        INSERT INTO users (email, password_hash, name, business_name, role, owner_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING {}
        "#,
        USER_COLUMNS
    );
    let user = sqlx::query_as::<_, User>(&query)
        .bind(email)
        .bind(password_hash)
        .bind(name)
        .bind(business_name)
        .bind(role)
        .bind(owner_id)
        .fetch_one(pool)
        .await?;

    Ok(user)
}

/// List workers belonging to a customer
pub async fn list_workers(pool: &PgPool, owner_id: Uuid) -> Result<Vec<User>> {
    let query = format!(
        "SELECT {} FROM users WHERE owner_id = $1 AND role = 'worker' ORDER BY name",
        USER_COLUMNS
    );
    let users = sqlx::query_as::<_, User>(&query)
        .bind(owner_id)
        .fetch_all(pool)
        .await?;

    Ok(users)
}

/// Delete a worker (only if owned by the given customer)
pub async fn delete_worker(pool: &PgPool, worker_id: Uuid, owner_id: Uuid) -> Result<bool> {
    let result = sqlx::query(
        "DELETE FROM users WHERE id = $1 AND owner_id = $2 AND role = 'worker'"
    )
    .bind(worker_id)
    .bind(owner_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}
