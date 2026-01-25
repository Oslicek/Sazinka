//! Customer database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;

use crate::types::customer::{Customer, CreateCustomerRequest};

/// Create a new customer
pub async fn create_customer(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreateCustomerRequest,
) -> Result<Customer> {
    let customer = sqlx::query_as::<_, Customer>(
        r#"
        INSERT INTO customers (
            id, user_id, name, email, phone,
            street, city, postal_code, country,
            lat, lng, notes, created_at, updated_at
        )
        VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9,
            $10, $11, $12, NOW(), NOW()
        )
        RETURNING
            id, user_id, name, email, phone,
            street, city, postal_code, country,
            lat, lng, notes, created_at, updated_at
        "#
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.email)
    .bind(&req.phone)
    .bind(&req.street)
    .bind(&req.city)
    .bind(&req.postal_code)
    .bind(req.country.as_deref().unwrap_or("CZ"))
    .bind(req.lat)
    .bind(req.lng)
    .bind(&req.notes)
    .fetch_one(pool)
    .await?;

    Ok(customer)
}

/// Get customer by ID
pub async fn get_customer(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
) -> Result<Option<Customer>> {
    let customer = sqlx::query_as::<_, Customer>(
        r#"
        SELECT
            id, user_id, name, email, phone,
            street, city, postal_code, country,
            lat, lng, notes, created_at, updated_at
        FROM customers
        WHERE id = $1 AND user_id = $2
        "#
    )
    .bind(customer_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(customer)
}

/// List customers for a user
pub async fn list_customers(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
    offset: i64,
) -> Result<Vec<Customer>> {
    let customers = sqlx::query_as::<_, Customer>(
        r#"
        SELECT
            id, user_id, name, email, phone,
            street, city, postal_code, country,
            lat, lng, notes, created_at, updated_at
        FROM customers
        WHERE user_id = $1
        ORDER BY name ASC
        LIMIT $2 OFFSET $3
        "#
    )
    .bind(user_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(customers)
}

/// Update customer coordinates (after geocoding)
pub async fn update_customer_coordinates(
    pool: &PgPool,
    customer_id: Uuid,
    lat: f64,
    lng: f64,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE customers
        SET lat = $1, lng = $2, updated_at = NOW()
        WHERE id = $3
        "#
    )
    .bind(lat)
    .bind(lng)
    .bind(customer_id)
    .execute(pool)
    .await?;

    Ok(())
}
