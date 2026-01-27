//! Customer database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;

use crate::types::customer::{Customer, CreateCustomerRequest, UpdateCustomerRequest, CustomerType};

/// Create a new customer
pub async fn create_customer(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreateCustomerRequest,
) -> Result<Customer> {
    let customer_type = req.customer_type.unwrap_or(CustomerType::Person);
    
    let customer = sqlx::query_as::<_, Customer>(
        r#"
        INSERT INTO customers (
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, notes, created_at, updated_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17, NOW(), NOW()
        )
        RETURNING
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, notes, created_at, updated_at
        "#
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(customer_type)
    .bind(&req.name)
    .bind(&req.contact_person)
    .bind(&req.ico)
    .bind(&req.dic)
    .bind(&req.email)
    .bind(&req.phone)
    .bind(&req.phone_raw)
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
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
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
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
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

/// Update a customer
pub async fn update_customer(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateCustomerRequest,
) -> Result<Option<Customer>> {
    let customer = sqlx::query_as::<_, Customer>(
        r#"
        UPDATE customers
        SET
            customer_type = COALESCE($3, customer_type),
            name = COALESCE($4, name),
            contact_person = COALESCE($5, contact_person),
            ico = COALESCE($6, ico),
            dic = COALESCE($7, dic),
            email = COALESCE($8, email),
            phone = COALESCE($9, phone),
            phone_raw = COALESCE($10, phone_raw),
            street = COALESCE($11, street),
            city = COALESCE($12, city),
            postal_code = COALESCE($13, postal_code),
            country = COALESCE($14, country),
            lat = COALESCE($15, lat),
            lng = COALESCE($16, lng),
            notes = COALESCE($17, notes),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, notes, created_at, updated_at
        "#
    )
    .bind(req.id)
    .bind(user_id)
    .bind(req.customer_type)
    .bind(&req.name)
    .bind(&req.contact_person)
    .bind(&req.ico)
    .bind(&req.dic)
    .bind(&req.email)
    .bind(&req.phone)
    .bind(&req.phone_raw)
    .bind(&req.street)
    .bind(&req.city)
    .bind(&req.postal_code)
    .bind(&req.country)
    .bind(req.lat)
    .bind(req.lng)
    .bind(&req.notes)
    .fetch_optional(pool)
    .await?;

    Ok(customer)
}

/// Delete a customer
pub async fn delete_customer(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        DELETE FROM customers
        WHERE id = $1 AND user_id = $2
        "#
    )
    .bind(customer_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Get random customers with coordinates (for route planning)
pub async fn get_random_customers_with_coords(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<Customer>> {
    let customers = sqlx::query_as::<_, Customer>(
        r#"
        SELECT
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, notes, created_at, updated_at
        FROM customers
        WHERE user_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL
        ORDER BY RANDOM()
        LIMIT $2
        "#
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(customers)
}
