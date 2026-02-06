//! Customer database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;
use chrono::Utc;

use crate::types::customer::{
    Customer, CreateCustomerRequest, UpdateCustomerRequest, CustomerType,
    CustomerListItem, ListCustomersRequest, CustomerSummaryResponse,
};

/// Create a new customer
pub async fn create_customer(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreateCustomerRequest,
) -> Result<Customer> {
    let customer_type = req.customer_type.unwrap_or(CustomerType::Person);
    
    // Determine geocode_status based on whether coordinates are provided
    let geocode_status = if req.lat.is_some() && req.lng.is_some() {
        "success"
    } else {
        "pending"
    };
    
    let customer = sqlx::query_as::<_, Customer>(
        r#"
        INSERT INTO customers (
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, geocode_status, notes, created_at, updated_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10,
            $11, $12, $13, $14,
            $15, $16, $17::geocode_status_enum, $18, NOW(), NOW()
        )
        RETURNING
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, geocode_status::text, notes, created_at, updated_at
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
    .bind(geocode_status)
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
            lat, lng, geocode_status::text, notes, created_at, updated_at
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
            lat, lng, geocode_status::text, notes, created_at, updated_at
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
        SET lat = $1, lng = $2, geocode_status = 'success', updated_at = NOW()
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

/// Reset customer coordinates and mark geocode as pending
pub async fn reset_customer_coordinates(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE customers
        SET lat = NULL, lng = NULL, geocode_status = 'pending', updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        "#
    )
    .bind(customer_id)
    .bind(user_id)
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
    // If new coordinates are provided, update geocode_status to success
    // If address is changed (street, city, postal_code), reset to pending
    let geocode_status_update = if req.lat.is_some() && req.lng.is_some() {
        Some("success")
    } else if req.street.is_some() || req.city.is_some() || req.postal_code.is_some() {
        // Address changed, reset geocoding status
        Some("pending")
    } else {
        None
    };
    
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
            geocode_status = COALESCE($17::geocode_status_enum, geocode_status),
            notes = COALESCE($18, notes),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, geocode_status::text, notes, created_at, updated_at
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
    .bind(geocode_status_update)
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
            lat, lng, geocode_status::text, notes, created_at, updated_at
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

// ============================================================================
// Extended Customer Queries with Aggregations
// ============================================================================

/// List customers with aggregated data (device count, next revision, overdue count)
/// Supports filtering and sorting
pub async fn list_customers_extended(
    pool: &PgPool,
    user_id: Uuid,
    req: &ListCustomersRequest,
) -> Result<(Vec<CustomerListItem>, i64)> {
    let today = Utc::now().date_naive();
    let limit = req.limit.unwrap_or(50) as i64;
    let offset = req.offset.unwrap_or(0) as i64;

    // Build WHERE conditions
    let mut conditions = vec!["c.user_id = $1".to_string()];
    let mut param_idx = 2;

    // Search filter
    let search_pattern = req.search.as_ref().map(|s| format!("%{}%", s.to_lowercase()));
    if search_pattern.is_some() {
        conditions.push(format!(
            "(LOWER(c.name) LIKE ${0} OR LOWER(c.city) LIKE ${0} OR LOWER(c.street) LIKE ${0} OR LOWER(c.email) LIKE ${0} OR c.phone LIKE ${0})",
            param_idx
        ));
        param_idx += 1;
    }

    // Geocode status filter
    if let Some(ref status) = req.geocode_status {
        conditions.push(format!("c.geocode_status::text = ${}", param_idx));
        param_idx += 1;
        let _ = status; // Used in binding
    }

    // Customer type filter
    if let Some(ref ctype) = req.customer_type {
        conditions.push(format!("c.customer_type = ${}", param_idx));
        param_idx += 1;
        let _ = ctype;
    }

    let where_clause = conditions.join(" AND ");

    // Build HAVING clause for aggregated filters
    let mut having_conditions: Vec<String> = vec![];
    
    if req.has_overdue == Some(true) {
        // Filter customers that have at least one overdue or never-serviced device
        having_conditions.push(
            "COUNT(DISTINCT ds.device_id) FILTER (WHERE ds.is_overdue OR ds.is_never_serviced) > 0".to_string()
        );
    }

    if let Some(days) = req.next_revision_within_days {
        having_conditions.push(format!(
            "MIN(r.due_date) FILTER (WHERE r.status NOT IN ('completed', 'cancelled')) <= CURRENT_DATE + {}",
            days
        ));
    }

    let having_clause = if having_conditions.is_empty() {
        String::new()
    } else {
        format!("HAVING {}", having_conditions.join(" AND "))
    };

    // Build ORDER BY clause
    let order_by = match req.sort_by.as_deref() {
        Some("nextRevision") => "next_revision_date",
        Some("deviceCount") => "device_count",
        Some("city") => "c.city",
        Some("createdAt") => "c.created_at",
        _ => "c.name", // default
    };

    let order_dir = match req.sort_order.as_deref() {
        Some("desc") => "DESC",
        _ => "ASC",
    };

    // Handle NULL values in sorting (NULLs last for ASC, first for DESC)
    let nulls_order = if order_dir == "ASC" { "NULLS LAST" } else { "NULLS FIRST" };

    // Subquery to calculate device overdue status based on last completed revision
    // A device is overdue if: (last_completed_date + interval_months) < today
    // A device is never_serviced if: no completed revisions exist
    let query = format!(
        r#"
        WITH device_status AS (
            SELECT 
                d.id as device_id,
                d.customer_id,
                d.revision_interval_months,
                d.installation_date,
                MAX(r.completed_at) FILTER (WHERE r.status = 'completed') as last_completed,
                CASE 
                    -- Has completed revision: check if last_completed + interval < today
                    WHEN MAX(r.completed_at) FILTER (WHERE r.status = 'completed') IS NOT NULL THEN
                        (MAX(r.completed_at) FILTER (WHERE r.status = 'completed'))::date + 
                        (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                    -- No completed revision but has installation date: check installation + interval < today
                    WHEN d.installation_date IS NOT NULL THEN
                        d.installation_date + (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                    ELSE FALSE
                END as is_overdue,
                -- Never serviced = no completed revisions
                MAX(r.completed_at) FILTER (WHERE r.status = 'completed') IS NULL as is_never_serviced
            FROM devices d
            LEFT JOIN revisions r ON d.id = r.device_id
            GROUP BY d.id, d.customer_id, d.revision_interval_months, d.installation_date
        )
        SELECT
            c.id,
            c.user_id,
            c.customer_type,
            c.name,
            c.email,
            c.phone,
            c.street,
            c.city,
            c.postal_code,
            c.lat,
            c.lng,
            c.geocode_status::text,
            c.created_at,
            COALESCE(COUNT(DISTINCT ds.device_id), 0) as device_count,
            MIN(r.due_date) FILTER (WHERE r.status NOT IN ('completed', 'cancelled') AND r.due_date >= CURRENT_DATE) as next_revision_date,
            COALESCE(COUNT(DISTINCT ds.device_id) FILTER (WHERE ds.is_overdue), 0) as overdue_count,
            COALESCE(COUNT(DISTINCT ds.device_id) FILTER (WHERE ds.is_never_serviced), 0) as never_serviced_count
        FROM customers c
        LEFT JOIN device_status ds ON c.id = ds.customer_id
        LEFT JOIN revisions r ON c.id = r.customer_id
        WHERE {}
        GROUP BY c.id, c.user_id, c.customer_type, c.name, c.email, c.phone,
                 c.street, c.city, c.postal_code, c.lat, c.lng, c.geocode_status, c.created_at
        {}
        ORDER BY {} {} {}
        LIMIT ${} OFFSET ${}
        "#,
        where_clause,
        having_clause,
        order_by,
        order_dir,
        nulls_order,
        param_idx,
        param_idx + 1
    );

    // Build the query with dynamic bindings
    let mut query_builder = sqlx::query_as::<_, CustomerListItem>(&query)
        .bind(user_id);

    if let Some(ref pattern) = search_pattern {
        query_builder = query_builder.bind(pattern);
    }

    if let Some(ref status) = req.geocode_status {
        query_builder = query_builder.bind(status);
    }

    if let Some(ref ctype) = req.customer_type {
        query_builder = query_builder.bind(ctype);
    }

    query_builder = query_builder.bind(limit).bind(offset);

    let items = query_builder.fetch_all(pool).await?;

    // Count total (without LIMIT/OFFSET but with same filters)
    // When has_overdue filter is active, we need the device_status CTE for the HAVING clause
    let count_query = if req.has_overdue == Some(true) {
        format!(
            r#"
            SELECT COUNT(*) FROM (
                WITH device_status AS (
                    SELECT 
                        d.id as device_id,
                        d.customer_id,
                        d.revision_interval_months,
                        d.installation_date,
                        MAX(r.completed_at) FILTER (WHERE r.status = 'completed') as last_completed,
                        CASE 
                            WHEN MAX(r.completed_at) FILTER (WHERE r.status = 'completed') IS NOT NULL THEN
                                (MAX(r.completed_at) FILTER (WHERE r.status = 'completed'))::date + 
                                (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                            WHEN d.installation_date IS NOT NULL THEN
                                d.installation_date + (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                            ELSE FALSE
                        END as is_overdue,
                        MAX(r.completed_at) FILTER (WHERE r.status = 'completed') IS NULL as is_never_serviced
                    FROM devices d
                    LEFT JOIN revisions r ON d.id = r.device_id
                    GROUP BY d.id, d.customer_id, d.revision_interval_months, d.installation_date
                )
                SELECT c.id
                FROM customers c
                LEFT JOIN device_status ds ON c.id = ds.customer_id
                LEFT JOIN revisions r ON c.id = r.customer_id
                WHERE {}
                GROUP BY c.id
                {}
            ) AS filtered
            "#,
            where_clause,
            having_clause
        )
    } else {
        format!(
            r#"
            SELECT COUNT(*) FROM (
                SELECT c.id
                FROM customers c
                LEFT JOIN devices d ON c.id = d.customer_id
                LEFT JOIN revisions r ON c.id = r.customer_id
                WHERE {}
                GROUP BY c.id
                {}
            ) AS filtered
            "#,
            where_clause,
            having_clause
        )
    };

    let mut count_builder = sqlx::query_as::<_, (i64,)>(&count_query)
        .bind(user_id);

    if let Some(ref pattern) = search_pattern {
        count_builder = count_builder.bind(pattern);
    }

    if let Some(ref status) = req.geocode_status {
        count_builder = count_builder.bind(status);
    }

    if let Some(ref ctype) = req.customer_type {
        count_builder = count_builder.bind(ctype);
    }

    let (total,) = count_builder.fetch_one(pool).await?;

    Ok((items, total))
}

/// Get customer summary statistics
pub async fn get_customer_summary(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<CustomerSummaryResponse> {
    let today = Utc::now().date_naive();
    let week_from_now = today + chrono::Duration::days(7);

    // We need multiple queries because PostgreSQL doesn't allow mixing
    // row-level and aggregated FILTER in the same way easily
    
    // Customer counts
    let customer_stats: (i64, i64, i64, i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) as total_customers,
            COUNT(*) FILTER (WHERE geocode_status = 'success') as geocode_success,
            COUNT(*) FILTER (WHERE geocode_status = 'pending') as geocode_pending,
            COUNT(*) FILTER (WHERE geocode_status = 'failed') as geocode_failed,
            COUNT(*) FILTER (WHERE phone IS NULL OR phone = '') as customers_without_phone,
            COUNT(*) FILTER (WHERE email IS NULL OR email = '') as customers_without_email
        FROM customers
        WHERE user_id = $1
        "#
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    // Device count
    let (total_devices,): (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*)
        FROM devices d
        INNER JOIN customers c ON d.customer_id = c.id
        WHERE c.user_id = $1
        "#
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    // Revision counts
    let revision_stats: (i64, i64, i64) = sqlx::query_as(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE r.due_date < $2 AND r.status NOT IN ('completed', 'cancelled')) as overdue,
            COUNT(*) FILTER (WHERE r.due_date BETWEEN $2 AND $3 AND r.status NOT IN ('completed', 'cancelled')) as due_this_week,
            COUNT(*) FILTER (WHERE r.status = 'scheduled') as scheduled
        FROM revisions r
        INNER JOIN customers c ON r.customer_id = c.id
        WHERE c.user_id = $1
        "#
    )
    .bind(user_id)
    .bind(today)
    .bind(week_from_now)
    .fetch_one(pool)
    .await?;

    // Customer-level overdue / never-serviced counts
    // Uses the same device_status logic as the list query
    let overdue_stats: (i64, i64) = sqlx::query_as(
        r#"
        WITH device_status AS (
            SELECT 
                d.customer_id,
                CASE 
                    WHEN MAX(r.completed_at) FILTER (WHERE r.status = 'completed') IS NOT NULL THEN
                        (MAX(r.completed_at) FILTER (WHERE r.status = 'completed'))::date + 
                        (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                    WHEN d.installation_date IS NOT NULL THEN
                        d.installation_date + (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                    ELSE FALSE
                END as is_overdue,
                MAX(r.completed_at) FILTER (WHERE r.status = 'completed') IS NULL as is_never_serviced
            FROM devices d
            INNER JOIN customers c ON d.customer_id = c.id
            LEFT JOIN revisions r ON d.id = r.device_id
            WHERE c.user_id = $1
            GROUP BY d.id, d.customer_id, d.revision_interval_months, d.installation_date
        )
        SELECT
            COUNT(DISTINCT customer_id) FILTER (WHERE is_overdue) as customers_with_overdue,
            COUNT(DISTINCT customer_id) FILTER (WHERE is_never_serviced) as customers_never_serviced
        FROM device_status
        "#
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(CustomerSummaryResponse {
        total_customers: customer_stats.0,
        total_devices,
        revisions_overdue: revision_stats.0,
        revisions_due_this_week: revision_stats.1,
        revisions_scheduled: revision_stats.2,
        geocode_success: customer_stats.1,
        geocode_pending: customer_stats.2,
        geocode_failed: customer_stats.3,
        customers_without_phone: customer_stats.4,
        customers_without_email: customer_stats.5,
        customers_with_overdue: overdue_stats.0,
        customers_never_serviced: overdue_stats.1,
    })
}

// ============================================================================
// GEOCODING HELPERS
// ============================================================================

/// Simple struct for customers pending geocoding
#[derive(Debug, sqlx::FromRow)]
pub struct CustomerIdOnly {
    pub id: Uuid,
}

/// List customers pending geocoding for a user
pub async fn list_pending_geocode(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<CustomerIdOnly>> {
    let customers = sqlx::query_as::<_, CustomerIdOnly>(
        r#"
        SELECT id
        FROM customers
        WHERE user_id = $1 AND geocode_status = 'pending'
        ORDER BY created_at DESC
        "#
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(customers)
}
