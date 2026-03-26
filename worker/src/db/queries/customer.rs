#![allow(dead_code)]
//! Customer database queries

use sqlx::PgPool;
use uuid::Uuid;
use anyhow::Result;
use chrono::Utc;

use crate::types::customer::{
    Customer, CreateCustomerRequest, UpdateCustomerRequest, CustomerType,
    CustomerListItem, ListCustomersRequest, CustomerSummaryResponse, SortEntry,
    ColumnFilter,
};

// ── Column filter builder ────────────────────────────────────────────────────

/// Info about a column's filterable SQL expression.
struct FilterColumnInfo {
    /// SQL expression for WHERE condition (non-aggregate), or None for aggregate-only columns.
    where_expr: Option<&'static str>,
    /// SQL expression for HAVING condition (aggregate), or None for WHERE-only columns.
    having_expr: Option<&'static str>,
}

/// Maps a frontend catalog column ID to its filter SQL expression info.
/// Returns None for unknown or date-range columns (date-range is handled separately).
/// SAFETY: only whitelisted static strings are returned — never user input.
fn column_to_filter_sql(id: &str) -> Option<FilterColumnInfo> {
    match id {
        "name"         => Some(FilterColumnInfo { where_expr: Some("c.name"),                having_expr: None }),
        "type"         => Some(FilterColumnInfo { where_expr: Some("c.customer_type::text"), having_expr: None }),
        "city"         => Some(FilterColumnInfo { where_expr: Some("c.city"),                having_expr: None }),
        "street"       => Some(FilterColumnInfo { where_expr: Some("c.street"),              having_expr: None }),
        "postalCode"   => Some(FilterColumnInfo { where_expr: Some("c.postal_code"),         having_expr: None }),
        "phone"        => Some(FilterColumnInfo { where_expr: Some("c.phone"),               having_expr: None }),
        "email"        => Some(FilterColumnInfo { where_expr: Some("c.email"),               having_expr: None }),
        "geocodeStatus"=> Some(FilterColumnInfo { where_expr: Some("c.geocode_status::text"), having_expr: None }),
        "deviceCount"  => Some(FilterColumnInfo {
            where_expr: None,
            having_expr: Some("COALESCE(COUNT(DISTINCT ds.device_id), 0)"),
        }),
        "createdAt"    => Some(FilterColumnInfo { where_expr: Some("c.created_at::date"),    having_expr: None }),
        "nextRevision" => Some(FilterColumnInfo {
            where_expr: None,
            having_expr: Some("MIN(r.due_date) FILTER (WHERE r.status NOT IN ('completed', 'cancelled') AND r.due_date >= CURRENT_DATE)"),
        }),
        _ => None,
    }
}

/// A single value to bind to a query, produced by `build_column_filter_clauses`.
#[derive(Debug, Clone, PartialEq)]
pub enum FilterBindValue {
    /// A scalar string (used for date-range bounds).
    Text(String),
    /// A text array (used for checklist = ANY($N) comparisons).
    TextArray(Vec<String>),
}

/// Output of `build_column_filter_clauses`.
#[derive(Debug, Default)]
pub struct ColumnFilterClauses {
    /// Conditions to append to the WHERE clause (non-aggregate).
    pub where_conds: Vec<String>,
    /// Conditions to append to the HAVING clause (aggregate).
    pub having_conds: Vec<String>,
    /// Bind values, in parameter order (each corresponds to a $N placeholder).
    pub bind_values: Vec<FilterBindValue>,
}

/// Build SQL condition fragments for `column_filters` in a `ListCustomersRequest`.
///
/// Rules:
/// - Unknown column IDs are skipped (injection-safe whitelist).
/// - Duplicate column IDs: first entry wins, later ones are ignored.
/// - Empty `values` array on a checklist filter: skipped (no condition produced).
/// - Date-range filter with neither `from` nor `to`: skipped.
/// - `param_idx` is incremented for every `$N` placeholder emitted.
pub fn build_column_filter_clauses(
    filters: &[ColumnFilter],
    param_idx: &mut usize,
) -> ColumnFilterClauses {
    let mut out = ColumnFilterClauses::default();
    let mut seen = std::collections::HashSet::new();

    for filter in filters {
        let col = filter.column();
        if seen.contains(col) {
            continue;
        }
        let Some(info) = column_to_filter_sql(col) else {
            continue;
        };
        seen.insert(col);

        match filter {
            ColumnFilter::Checklist { values, .. } => {
                if values.is_empty() {
                    continue;
                }
                *param_idx += 1;
                if let Some(expr) = info.where_expr {
                    out.where_conds.push(format!("{} = ANY(${})", expr, param_idx));
                    out.bind_values.push(FilterBindValue::TextArray(values.clone()));
                } else if let Some(expr) = info.having_expr {
                    // Cast aggregate to text for ANY comparison with string values
                    out.having_conds.push(format!("{}::text = ANY(${})", expr, param_idx));
                    out.bind_values.push(FilterBindValue::TextArray(values.clone()));
                }
            }
            ColumnFilter::DateRange { from, to, .. } => {
                if let Some(expr) = info.where_expr {
                    if let Some(from_str) = from {
                        *param_idx += 1;
                        out.where_conds.push(format!("{} >= ${}::date", expr, param_idx));
                        out.bind_values.push(FilterBindValue::Text(from_str.clone()));
                    }
                    if let Some(to_str) = to {
                        *param_idx += 1;
                        out.where_conds.push(format!("{} <= ${}::date", expr, param_idx));
                        out.bind_values.push(FilterBindValue::Text(to_str.clone()));
                    }
                } else if let Some(expr) = info.having_expr {
                    if let Some(from_str) = from {
                        *param_idx += 1;
                        out.having_conds.push(format!("{} >= ${}::date", expr, param_idx));
                        out.bind_values.push(FilterBindValue::Text(from_str.clone()));
                    }
                    if let Some(to_str) = to {
                        *param_idx += 1;
                        out.having_conds.push(format!("{} <= ${}::date", expr, param_idx));
                        out.bind_values.push(FilterBindValue::Text(to_str.clone()));
                    }
                }
            }
        }
    }

    out
}

// ── Sort ORDER BY builder ────────────────────────────────────────────────────

/// Maps a frontend catalog column ID to its safe SQL expression.
/// Returns None for unknown IDs (injection-safe whitelist).
fn column_to_sql(id: &str) -> Option<&'static str> {
    match id {
        "name"         => Some("c.name"),
        "type"         => Some("c.customer_type"),
        "city"         => Some("c.city"),
        "street"       => Some("c.street"),
        "postalCode"   => Some("c.postal_code"),
        "phone"        => Some("c.phone"),
        "email"        => Some("c.email"),
        "deviceCount"  => Some("device_count"),
        "nextRevision" => Some("next_revision_date"),
        "geocodeStatus"=> Some("c.geocode_status"),
        "createdAt"    => Some("c.created_at"),
        _              => None,
    }
}

/// Build an ORDER BY clause string from a slice of SortEntry values.
///
/// Rules:
/// - Unknown column IDs are skipped (whitelist).
/// - Invalid directions (not exactly "asc"/"desc") are skipped.
/// - Duplicate column IDs: first-wins.
/// - Empty or all-invalid input: falls back to `c.name ASC NULLS LAST`.
/// - A deterministic tie-breaker `c.id ASC` is always appended.
pub fn build_order_by(sort_model: &[SortEntry]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut parts: Vec<String> = Vec::new();

    for entry in sort_model {
        let Some(sql_col) = column_to_sql(&entry.column) else { continue };
        if seen.contains(sql_col) { continue }
        let (dir_sql, nulls) = match entry.direction.as_str() {
            "asc"  => ("ASC",  "NULLS LAST"),
            "desc" => ("DESC", "NULLS FIRST"),
            _      => continue,
        };
        seen.insert(sql_col);
        parts.push(format!("{} {} {}", sql_col, dir_sql, nulls));
    }

    if parts.is_empty() {
        parts.push("c.name ASC NULLS LAST".to_string());
    }

    parts.push("c.id ASC".to_string());
    parts.join(", ")
}

/// Resolve the ORDER BY clause from a `ListCustomersRequest`.
///
/// Precedence:
/// 1. `sort_model` when present and produces at least one valid entry.
/// 2. Legacy `sort_by` / `sort_order` fields.
/// 3. Default: `c.name ASC NULLS LAST, c.id ASC`.
pub fn resolve_sort(req: &ListCustomersRequest) -> String {
    // Prefer sort_model when it exists and contains at least one valid entry
    if let Some(ref model) = req.sort_model {
        let candidate = build_order_by(model);
        // build_order_by always returns at least the default; detect if user entries
        // contributed anything by checking whether the model produced any valid parts
        // (we can tell because the default-only result is exactly the fallback string).
        let has_user_entries = model.iter().any(|e| {
            column_to_sql(&e.column).is_some()
                && (e.direction == "asc" || e.direction == "desc")
        });
        if has_user_entries {
            return candidate;
        }
    }

    // Fall back to legacy sort_by / sort_order
    if let Some(ref sort_by) = req.sort_by {
        let sql_col = match sort_by.as_str() {
            "nextRevision" => "next_revision_date",
            "deviceCount"  => "device_count",
            "city"         => "c.city",
            "createdAt"    => "c.created_at",
            "name"         => "c.name",
            _              => "c.name",
        };
        let dir = match req.sort_order.as_deref() {
            Some("desc") => "DESC",
            _            => "ASC",
        };
        let nulls = if dir == "ASC" { "NULLS LAST" } else { "NULLS FIRST" };
        return format!("{} {} {}, c.id ASC", sql_col, dir, nulls);
    }

    // Default
    "c.name ASC NULLS LAST, c.id ASC".to_string()
}

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
            lat, lng, geocode_status::text, notes, created_at, updated_at,
            is_abandoned, deleted_at
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
            lat, lng, geocode_status::text, notes, created_at, updated_at,
            is_abandoned, deleted_at
        FROM customers
        WHERE id = $1 AND user_id = $2 AND is_anonymized = FALSE
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
            lat, lng, geocode_status::text, notes, created_at, updated_at,
            is_abandoned, deleted_at
        FROM customers
        WHERE user_id = $1 AND is_anonymized = FALSE
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
        WHERE id = $1 AND user_id = $2 AND is_anonymized = FALSE
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
          AND is_anonymized = FALSE
        RETURNING
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, geocode_status::text, notes, created_at, updated_at,
            is_abandoned, deleted_at
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
    let anonymized_name = format!("Anonymní zákazník {}", &customer_id.to_string()[..8]);
    let mut tx = pool.begin().await?;

    // 1) Anonymize the customer record itself (keep row/FKs intact)
    let result = sqlx::query(
        r#"
        UPDATE customers
        SET
            name = $3,
            contact_person = NULL,
            ico = NULL,
            dic = NULL,
            email = NULL,
            phone = NULL,
            phone_raw = NULL,
            street = NULL,
            city = NULL,
            postal_code = NULL,
            country = NULL,
            lat = NULL,
            lng = NULL,
            geocode_status = 'pending',
            notes = NULL,
            is_anonymized = TRUE,
            anonymized_at = NOW(),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND is_anonymized = FALSE
        "#
    )
    .bind(customer_id)
    .bind(user_id)
    .bind(anonymized_name)
    .execute(&mut *tx)
    .await?;

    if result.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(false);
    }

    // 2) Anonymize direct customer contact PII in communications
    sqlx::query(
        r#"
        UPDATE communications
        SET
            contact_name = NULL,
            contact_phone = NULL,
            subject = 'Anonymizováno',
            content = 'Anonymizováno',
            updated_at = NOW()
        WHERE user_id = $1 AND customer_id = $2
        "#
    )
    .bind(user_id)
    .bind(customer_id)
    .execute(&mut *tx)
    .await?;

    // 3) Anonymize worklog-like free text tied to the customer
    sqlx::query(
        r#"
        UPDATE visits
        SET result_notes = 'Anonymizováno'
        WHERE user_id = $1 AND customer_id = $2
          AND result_notes IS NOT NULL
        "#
    )
    .bind(user_id)
    .bind(customer_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        UPDATE visit_work_items w
        SET result_notes = 'Anonymizováno'
        FROM visits v
        WHERE w.visit_id = v.id
          AND v.user_id = $1
          AND v.customer_id = $2
          AND w.result_notes IS NOT NULL
        "#
    )
    .bind(user_id)
    .bind(customer_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(true)
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
            lat, lng, geocode_status::text, notes, created_at, updated_at,
            is_abandoned, deleted_at
        FROM customers
        WHERE user_id = $1 AND is_anonymized = FALSE AND lat IS NOT NULL AND lng IS NOT NULL
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
    let limit = req.limit.unwrap_or(50) as i64;
    let offset = req.offset.unwrap_or(0) as i64;

    // Build WHERE conditions
    let mut conditions = vec![
        "c.user_id = $1".to_string(),
        "c.is_anonymized = FALSE".to_string(),
    ];
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

    // Apply column filters (WHERE conditions first, before joining)
    let col_filter_clauses = if let Some(ref filters) = req.column_filters {
        build_column_filter_clauses(filters, &mut param_idx)
    } else {
        ColumnFilterClauses::default()
    };
    for cond in &col_filter_clauses.where_conds {
        conditions.push(cond.clone());
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

    if req.next_revision_within_days.is_some() {
        param_idx += 1;
        having_conditions.push(format!(
            "MIN(r.due_date) FILTER (WHERE r.status NOT IN ('completed', 'cancelled')) <= CURRENT_DATE + ${} * INTERVAL '1 day'",
            param_idx
        ));
    }

    // Append column filter HAVING conditions
    for cond in &col_filter_clauses.having_conds {
        having_conditions.push(cond.clone());
    }

    let having_clause = if having_conditions.is_empty() {
        String::new()
    } else {
        format!("HAVING {}", having_conditions.join(" AND "))
    };

    // Build ORDER BY clause — uses sort_model if present and valid,
    // falls back to legacy sort_by/sort_order, then to default.
    let order_clause = resolve_sort(req);

    // Subquery to calculate device overdue status based on last completed revision or visit
    // A device is overdue if: (last_completed_date + interval_months) < today
    // A device is never_serviced if: no completed revisions or completed revision visits exist
    let query = format!(
        r#"
        WITH device_status AS (
            SELECT 
                d.id as device_id,
                d.customer_id,
                d.revision_interval_months,
                d.installation_date,
                GREATEST(
                    MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                    MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                ) as last_completed,
                CASE 
                    -- Has completed revision or visit: check if last_completed + interval < today
                    WHEN GREATEST(
                        MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                        MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                    ) IS NOT NULL THEN
                        GREATEST(
                            MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                            MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                        )::date + 
                        (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                    -- No completed revision/visit but has installation date: check installation + interval < today
                    WHEN d.installation_date IS NOT NULL THEN
                        d.installation_date + (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                    ELSE FALSE
                END as is_overdue,
                -- Never serviced = no completed revisions AND no completed revision visits
                GREATEST(
                    MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                    MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                ) IS NULL as is_never_serviced
            FROM devices d
            LEFT JOIN revisions r ON d.id = r.device_id
            LEFT JOIN visits v ON (v.device_id = d.id OR (v.device_id IS NULL AND v.customer_id = d.customer_id))
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
        ORDER BY {}
        LIMIT ${} OFFSET ${}
        "#,
        where_clause,
        having_clause,
        order_clause,
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

    if let Some(days) = req.next_revision_within_days {
        query_builder = query_builder.bind(days as f64);
    }

    // Bind column filter values (same order as placeholders in where/having clauses)
    for bind_val in col_filter_clauses.bind_values.iter().cloned() {
        query_builder = match bind_val {
            FilterBindValue::Text(s) => query_builder.bind(s),
            FilterBindValue::TextArray(arr) => query_builder.bind(arr),
        };
    }

    query_builder = query_builder.bind(limit).bind(offset);

    let items = query_builder.fetch_all(pool).await?;

    // Count total (without LIMIT/OFFSET but with same filters).
    // Use the CTE version when has_overdue is active OR when column filters produce HAVING
    // conditions that reference ds.device_id (requires device_status CTE).
    let needs_cte_count = req.has_overdue == Some(true) || !col_filter_clauses.having_conds.is_empty();
    let count_query = if needs_cte_count {
        format!(
            r#"
            SELECT COUNT(*) FROM (
                WITH device_status AS (
                    SELECT 
                        d.id as device_id,
                        d.customer_id,
                        d.revision_interval_months,
                        d.installation_date,
                        GREATEST(
                            MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                            MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                        ) as last_completed,
                        CASE 
                            WHEN GREATEST(
                                MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                                MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                            ) IS NOT NULL THEN
                                GREATEST(
                                    MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                                    MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                                )::date + 
                                (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                            WHEN d.installation_date IS NOT NULL THEN
                                d.installation_date + (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                            ELSE FALSE
                        END as is_overdue,
                        GREATEST(
                            MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                            MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                        ) IS NULL as is_never_serviced
                    FROM devices d
                    LEFT JOIN revisions r ON d.id = r.device_id
                    LEFT JOIN visits v ON (v.device_id = d.id OR (v.device_id IS NULL AND v.customer_id = d.customer_id))
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

    if let Some(days) = req.next_revision_within_days {
        count_builder = count_builder.bind(days as f64);
    }

    // Bind column filter values (same order as main query)
    for bind_val in col_filter_clauses.bind_values.iter().cloned() {
        count_builder = match bind_val {
            FilterBindValue::Text(s) => count_builder.bind(s),
            FilterBindValue::TextArray(arr) => count_builder.bind(arr),
        };
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
        WHERE user_id = $1 AND is_anonymized = FALSE
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
        WHERE c.user_id = $1 AND c.is_anonymized = FALSE
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
        WHERE c.user_id = $1 AND c.is_anonymized = FALSE
        "#
    )
    .bind(user_id)
    .bind(today)
    .bind(week_from_now)
    .fetch_one(pool)
    .await?;

    // Customer-level overdue / never-serviced counts
    // Uses the same device_status logic as the list query (considers both revisions and completed revision visits)
    let overdue_stats: (i64, i64) = sqlx::query_as(
        r#"
        WITH device_status AS (
            SELECT 
                d.customer_id,
                CASE 
                    WHEN GREATEST(
                        MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                        MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                    ) IS NOT NULL THEN
                        GREATEST(
                            MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                            MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                        )::date + 
                        (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                    WHEN d.installation_date IS NOT NULL THEN
                        d.installation_date + (d.revision_interval_months || ' months')::interval < CURRENT_DATE
                    ELSE FALSE
                END as is_overdue,
                GREATEST(
                    MAX(r.completed_at) FILTER (WHERE r.status = 'completed'),
                    MAX(COALESCE(v.actual_arrival, v.scheduled_date::timestamptz)) FILTER (WHERE v.status = 'completed' AND v.visit_type = 'revision')
                ) IS NULL as is_never_serviced
            FROM devices d
            INNER JOIN customers c ON d.customer_id = c.id
            LEFT JOIN revisions r ON d.id = r.device_id
            LEFT JOIN visits v ON (v.device_id = d.id OR (v.device_id IS NULL AND v.customer_id = d.customer_id))
            WHERE c.user_id = $1 AND c.is_anonymized = FALSE
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
        WHERE user_id = $1 AND is_anonymized = FALSE AND geocode_status = 'pending'
        ORDER BY created_at DESC
        "#
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(customers)
}

// ============================================================================
// LIFECYCLE — ABANDON / UNABANDON / ANONYMIZE
// ============================================================================

/// Mark a customer as abandoned (dispatcher explicitly gives up on them)
pub async fn abandon_customer(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
) -> Result<Option<Customer>> {
    let customer = sqlx::query_as::<_, Customer>(
        r#"
        UPDATE customers
        SET is_abandoned = TRUE, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND is_anonymized = FALSE
        RETURNING
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, geocode_status::text, notes, created_at, updated_at,
            is_abandoned, deleted_at
        "#,
    )
    .bind(customer_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(customer)
}

/// Unmark a customer as abandoned (bring them back into the inbox)
pub async fn unabandon_customer(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
) -> Result<Option<Customer>> {
    let customer = sqlx::query_as::<_, Customer>(
        r#"
        UPDATE customers
        SET is_abandoned = FALSE, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND is_anonymized = FALSE
        RETURNING
            id, user_id, customer_type, name, contact_person, ico, dic,
            email, phone, phone_raw,
            street, city, postal_code, country,
            lat, lng, geocode_status::text, notes, created_at, updated_at,
            is_abandoned, deleted_at
        "#,
    )
    .bind(customer_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(customer)
}

/// GDPR anonymize a customer: scrub PII, soft-delete, cancel open planned actions.
/// This is irreversible.
pub async fn anonymize_customer(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
) -> Result<bool> {
    let mut tx = pool.begin().await?;

    // Cancel all open planned actions for this customer
    sqlx::query(
        r#"
        UPDATE planned_actions
        SET status = 'cancelled'::action_status, updated_at = NOW()
        WHERE customer_id = $1 AND user_id = $2 AND status IN ('open', 'snoozed')
        "#,
    )
    .bind(customer_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // Scrub PII and set deleted_at
    let result = sqlx::query(
        r#"
        UPDATE customers
        SET
            name           = '[anonymized]',
            contact_person = NULL,
            email          = NULL,
            phone          = NULL,
            phone_raw      = NULL,
            street         = NULL,
            city           = NULL,
            postal_code    = NULL,
            lat            = NULL,
            lng            = NULL,
            notes          = NULL,
            ico            = NULL,
            dic            = NULL,
            is_anonymized  = TRUE,
            deleted_at     = NOW(),
            updated_at     = NOW()
        WHERE id = $1 AND user_id = $2 AND is_anonymized = FALSE
        "#,
    )
    .bind(customer_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::customer::SortEntry;

    fn se(column: &str, direction: &str) -> SortEntry {
        SortEntry { column: column.to_string(), direction: direction.to_string() }
    }

    // ── Default / empty ──────────────────────────────────────────────────────

    #[test]
    fn build_order_by_empty_slice_returns_default() {
        let result = build_order_by(&[]);
        assert_eq!(result, "c.name ASC NULLS LAST, c.id ASC");
    }

    #[test]
    fn build_order_by_all_invalid_columns_returns_default() {
        let result = build_order_by(&[se("unknown_col", "asc"), se("another_bad", "desc")]);
        assert_eq!(result, "c.name ASC NULLS LAST, c.id ASC");
    }

    #[test]
    fn build_order_by_all_invalid_directions_returns_default() {
        let result = build_order_by(&[se("name", "sideways"), se("city", "DESCENDING")]);
        assert_eq!(result, "c.name ASC NULLS LAST, c.id ASC");
    }

    // ── Single column mappings ───────────────────────────────────────────────

    #[test]
    fn build_order_by_name_asc() {
        let result = build_order_by(&[se("name", "asc")]);
        assert!(result.starts_with("c.name ASC NULLS LAST"));
        assert!(result.ends_with("c.id ASC"));
    }

    #[test]
    fn build_order_by_name_desc() {
        let result = build_order_by(&[se("name", "desc")]);
        assert!(result.starts_with("c.name DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_type_asc() {
        let result = build_order_by(&[se("type", "asc")]);
        assert!(result.starts_with("c.customer_type ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_type_desc() {
        let result = build_order_by(&[se("type", "desc")]);
        assert!(result.starts_with("c.customer_type DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_city_asc() {
        let result = build_order_by(&[se("city", "asc")]);
        assert!(result.starts_with("c.city ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_city_desc() {
        let result = build_order_by(&[se("city", "desc")]);
        assert!(result.starts_with("c.city DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_street_asc() {
        let result = build_order_by(&[se("street", "asc")]);
        assert!(result.starts_with("c.street ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_street_desc() {
        let result = build_order_by(&[se("street", "desc")]);
        assert!(result.starts_with("c.street DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_postal_code_asc() {
        let result = build_order_by(&[se("postalCode", "asc")]);
        assert!(result.starts_with("c.postal_code ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_postal_code_desc() {
        let result = build_order_by(&[se("postalCode", "desc")]);
        assert!(result.starts_with("c.postal_code DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_phone_asc() {
        let result = build_order_by(&[se("phone", "asc")]);
        assert!(result.starts_with("c.phone ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_phone_desc() {
        let result = build_order_by(&[se("phone", "desc")]);
        assert!(result.starts_with("c.phone DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_email_asc() {
        let result = build_order_by(&[se("email", "asc")]);
        assert!(result.starts_with("c.email ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_email_desc() {
        let result = build_order_by(&[se("email", "desc")]);
        assert!(result.starts_with("c.email DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_device_count_asc() {
        let result = build_order_by(&[se("deviceCount", "asc")]);
        assert!(result.starts_with("device_count ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_device_count_desc() {
        let result = build_order_by(&[se("deviceCount", "desc")]);
        assert!(result.starts_with("device_count DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_next_revision_asc() {
        let result = build_order_by(&[se("nextRevision", "asc")]);
        assert!(result.starts_with("next_revision_date ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_next_revision_desc() {
        let result = build_order_by(&[se("nextRevision", "desc")]);
        assert!(result.starts_with("next_revision_date DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_geocode_status_asc() {
        let result = build_order_by(&[se("geocodeStatus", "asc")]);
        assert!(result.starts_with("c.geocode_status ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_geocode_status_desc() {
        let result = build_order_by(&[se("geocodeStatus", "desc")]);
        assert!(result.starts_with("c.geocode_status DESC NULLS FIRST"));
    }

    #[test]
    fn build_order_by_created_at_asc() {
        let result = build_order_by(&[se("createdAt", "asc")]);
        assert!(result.starts_with("c.created_at ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_created_at_desc() {
        let result = build_order_by(&[se("createdAt", "desc")]);
        assert!(result.starts_with("c.created_at DESC NULLS FIRST"));
    }

    // ── Multi-column ordering ────────────────────────────────────────────────

    #[test]
    fn build_order_by_preserves_priority_order() {
        let result = build_order_by(&[se("name", "asc"), se("city", "desc")]);
        let name_pos = result.find("c.name").unwrap();
        let city_pos = result.find("c.city").unwrap();
        assert!(name_pos < city_pos, "name must come before city");
    }

    #[test]
    fn build_order_by_three_columns_full_output() {
        let result = build_order_by(&[
            se("name", "asc"),
            se("city", "desc"),
            se("createdAt", "asc"),
        ]);
        assert!(result.contains("c.name ASC NULLS LAST"));
        assert!(result.contains("c.city DESC NULLS FIRST"));
        assert!(result.contains("c.created_at ASC NULLS LAST"));
        assert!(result.ends_with("c.id ASC"));
    }

    // ── Invalid / mixed entries ──────────────────────────────────────────────

    #[test]
    fn build_order_by_unknown_column_skipped() {
        let result = build_order_by(&[se("unknown_xyz", "asc"), se("city", "asc")]);
        assert!(!result.contains("unknown_xyz"));
        assert!(result.contains("c.city ASC NULLS LAST"));
    }

    #[test]
    fn build_order_by_invalid_direction_skipped() {
        let result = build_order_by(&[se("name", "sideways"), se("city", "asc")]);
        assert!(!result.contains("sideways"));
        assert!(result.contains("c.city"));
    }

    #[test]
    fn build_order_by_uppercase_asc_rejected() {
        let result = build_order_by(&[se("name", "ASC")]);
        assert_eq!(result, "c.name ASC NULLS LAST, c.id ASC", "uppercase ASC should be rejected, falling back to default");
    }

    #[test]
    fn build_order_by_uppercase_desc_rejected() {
        let result = build_order_by(&[se("name", "DESC")]);
        assert_eq!(result, "c.name ASC NULLS LAST, c.id ASC", "uppercase DESC should be rejected, falling back to default");
    }

    #[test]
    fn build_order_by_mixed_case_direction_rejected() {
        let result = build_order_by(&[se("name", "Asc"), se("city", "Desc")]);
        assert_eq!(result, "c.name ASC NULLS LAST, c.id ASC", "mixed case directions should be rejected");
    }

    #[test]
    fn build_order_by_mixed_valid_and_invalid_keeps_valid() {
        let result = build_order_by(&[
            se("name", "asc"),
            se("bad_col", "asc"),
            se("city", "desc"),
        ]);
        assert!(result.contains("c.name"));
        assert!(!result.contains("bad_col"));
        assert!(result.contains("c.city"));
    }

    #[test]
    fn build_order_by_duplicate_columns_first_wins() {
        let result = build_order_by(&[se("name", "asc"), se("name", "desc")]);
        // Only one entry for name, direction from first occurrence
        let count = result.matches("c.name").count();
        // c.name appears once in the user sort, once potentially in tie-breaker (c.id) — check c.name ASC appears
        assert!(result.contains("c.name ASC NULLS LAST"));
        // The desc variant must not appear
        assert!(!result.contains("c.name DESC"));
        // Only one name sort entry means exactly one "c.name" before the tie-breaker
        assert!(count >= 1);
    }

    // ── Tie-breaker ─────────────────────────────────────────────────────────

    #[test]
    fn build_order_by_always_appends_id_tie_breaker() {
        let result = build_order_by(&[se("name", "asc")]);
        assert!(result.ends_with("c.id ASC"));
    }

    #[test]
    fn build_order_by_tie_breaker_not_duplicated_when_name_is_id() {
        // Even if user somehow sorts by id (not a valid column in whitelist),
        // the tie-breaker c.id ASC appears exactly once
        let result = build_order_by(&[se("name", "asc")]);
        let count = result.matches("c.id ASC").count();
        assert_eq!(count, 1);
    }

    // ── Injection safety ────────────────────────────────────────────────────

    #[test]
    fn build_order_by_malicious_column_string_not_in_output() {
        let malicious = "name; DROP TABLE customers; --";
        let result = build_order_by(&[se(malicious, "asc")]);
        assert!(!result.contains("DROP"));
        assert!(!result.contains(malicious));
        // Falls back to default
        assert_eq!(result, "c.name ASC NULLS LAST, c.id ASC");
    }

    #[test]
    fn build_order_by_malicious_direction_string_not_in_output() {
        let result = build_order_by(&[se("name", "asc; DROP TABLE customers; --")]);
        assert!(!result.contains("DROP"));
        // Falls back to default because direction is invalid
        assert_eq!(result, "c.name ASC NULLS LAST, c.id ASC");
    }

    // ── Precedence (sort_model vs legacy sort_by/sort_order) ─────────────────

    #[test]
    fn resolve_sort_precedence_sort_model_wins_over_legacy() {
        let req = ListCustomersRequest {
            sort_model: Some(vec![se("city", "desc")]),
            sort_by: Some("name".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("c.city DESC"), "sort_model should win over sort_by/sort_order");
    }

    #[test]
    fn resolve_sort_falls_back_to_legacy_when_sort_model_absent() {
        let req = ListCustomersRequest {
            sort_model: None,
            sort_by: Some("city".to_string()),
            sort_order: Some("desc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.contains("c.city"), "should use legacy sort_by when sort_model is None");
    }

    #[test]
    fn resolve_sort_falls_back_to_legacy_when_sort_model_empty() {
        let req = ListCustomersRequest {
            sort_model: Some(vec![]),
            sort_by: Some("city".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.contains("c.city"), "empty sort_model should fall back to sort_by");
    }

    #[test]
    fn resolve_sort_falls_back_to_legacy_when_sort_model_all_invalid() {
        let req = ListCustomersRequest {
            sort_model: Some(vec![se("bad_col", "asc")]),
            sort_by: Some("city".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.contains("c.city"), "all-invalid sort_model should fall back to sort_by");
    }

    #[test]
    fn resolve_sort_default_when_both_absent() {
        let req = ListCustomersRequest::default();
        let result = resolve_sort(&req);
        assert!(result.starts_with("c.name ASC NULLS LAST"));
    }

    #[test]
    fn resolve_sort_legacy_name_asc() {
        let req = ListCustomersRequest {
            sort_by: Some("name".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("c.name ASC NULLS LAST"));
        assert!(result.ends_with("c.id ASC"));
    }

    #[test]
    fn resolve_sort_legacy_name_desc() {
        let req = ListCustomersRequest {
            sort_by: Some("name".to_string()),
            sort_order: Some("desc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("c.name DESC NULLS FIRST"));
    }

    #[test]
    fn resolve_sort_legacy_city_desc() {
        let req = ListCustomersRequest {
            sort_by: Some("city".to_string()),
            sort_order: Some("desc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("c.city DESC NULLS FIRST"));
    }

    #[test]
    fn resolve_sort_legacy_next_revision() {
        let req = ListCustomersRequest {
            sort_by: Some("nextRevision".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("next_revision_date ASC NULLS LAST"));
    }

    #[test]
    fn resolve_sort_legacy_device_count() {
        let req = ListCustomersRequest {
            sort_by: Some("deviceCount".to_string()),
            sort_order: Some("desc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("device_count DESC NULLS FIRST"));
    }

    #[test]
    fn resolve_sort_legacy_created_at() {
        let req = ListCustomersRequest {
            sort_by: Some("createdAt".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("c.created_at ASC NULLS LAST"));
    }

    #[test]
    fn resolve_sort_legacy_unmapped_column_defaults_to_name() {
        let req = ListCustomersRequest {
            sort_by: Some("email".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("c.name ASC"), "unmapped legacy column should fall back to c.name");
    }

    #[test]
    fn resolve_sort_legacy_missing_sort_order_defaults_to_asc() {
        let req = ListCustomersRequest {
            sort_by: Some("city".to_string()),
            sort_order: None,
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.starts_with("c.city ASC NULLS LAST"));
    }

    // ── Integration-level path: ORDER BY clause construction ─────────────────
    // These tests verify the full resolve_sort + build_order_by path as it would
    // be used by list_customers_extended (no live DB required).

    #[test]
    fn integration_sort_model_yields_correct_order_clause_for_all_11_columns() {
        let all_columns = vec![
            se("name", "asc"),
            se("type", "desc"),
            se("city", "asc"),
            se("street", "desc"),
            se("postalCode", "asc"),
            se("phone", "desc"),
            se("email", "asc"),
            se("deviceCount", "desc"),
            se("nextRevision", "asc"),
            se("geocodeStatus", "desc"),
            se("createdAt", "asc"),
        ];
        let req = ListCustomersRequest {
            sort_model: Some(all_columns),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.contains("c.name ASC"));
        assert!(result.contains("c.customer_type DESC"));
        assert!(result.contains("c.city ASC"));
        assert!(result.contains("c.street DESC"));
        assert!(result.contains("c.postal_code ASC"));
        assert!(result.contains("c.phone DESC"));
        assert!(result.contains("c.email ASC"));
        assert!(result.contains("device_count DESC"));
        assert!(result.contains("next_revision_date ASC"));
        assert!(result.contains("c.geocode_status DESC"));
        assert!(result.contains("c.created_at ASC"));
        assert!(result.ends_with("c.id ASC"), "tie-breaker must be present");
    }

    #[test]
    fn integration_priority_order_preserved_in_final_clause() {
        let req = ListCustomersRequest {
            sort_model: Some(vec![
                se("email", "asc"),
                se("city", "desc"),
                se("name", "asc"),
            ]),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        let email_pos = result.find("c.email").unwrap();
        let city_pos = result.find("c.city").unwrap();
        let name_pos = result.find("c.name").unwrap();
        assert!(email_pos < city_pos, "email must precede city");
        assert!(city_pos < name_pos, "city must precede name");
    }

    #[test]
    fn integration_sort_model_wins_over_legacy_full_path() {
        let req = ListCustomersRequest {
            sort_model: Some(vec![se("geocodeStatus", "desc")]),
            sort_by: Some("name".to_string()),
            sort_order: Some("asc".to_string()),
            ..Default::default()
        };
        let result = resolve_sort(&req);
        assert!(result.contains("c.geocode_status DESC"), "geocodeStatus should win");
        assert!(!result.contains("c.name ASC NULLS LAST, c.id"), "legacy name should not appear as primary");
    }

    #[test]
    fn integration_tie_breaker_ensures_deterministic_pagination() {
        for col in &[
            "name", "type", "city", "street", "postalCode",
            "phone", "email", "deviceCount", "nextRevision",
            "geocodeStatus", "createdAt",
        ] {
            let result = build_order_by(&[se(col, "asc")]);
            assert!(
                result.ends_with("c.id ASC"),
                "column {col} ORDER BY must end with c.id ASC for stable pagination, got: {result}"
            );
        }
    }

    #[test]
    fn integration_no_user_input_in_sql_for_any_column() {
        // Verify that no column ID or direction value is interpolated directly into SQL;
        // only whitelisted SQL expressions appear.
        let malicious_inputs = vec![
            se("'; DROP TABLE customers; --", "asc"),
            se("name", "'; DROP TABLE customers; --"),
            se("name UNION SELECT * FROM users", "asc"),
            se("name", "asc UNION SELECT 1"),
        ];
        for input in malicious_inputs {
            let result = build_order_by(&[input.clone()]);
            assert!(!result.contains("DROP"), "SQL injection via column: {}", input.column);
            assert!(!result.contains("UNION"), "SQL injection via direction: {}", input.direction);
            assert!(!result.contains("SELECT"), "SQL injection in result: {result}");
        }
    }

    // ── build_column_filter_clauses ──────────────────────────────────────────

    use crate::types::customer::ColumnFilter;

    fn cf_checklist(col: &str, values: Vec<&str>) -> ColumnFilter {
        ColumnFilter::Checklist {
            column: col.to_string(),
            values: values.into_iter().map(|s| s.to_string()).collect(),
        }
    }

    fn cf_daterange(col: &str, from: Option<&str>, to: Option<&str>) -> ColumnFilter {
        ColumnFilter::DateRange {
            column: col.to_string(),
            from: from.map(|s| s.to_string()),
            to: to.map(|s| s.to_string()),
        }
    }

    #[test]
    fn filter_empty_produces_no_conditions() {
        let mut idx = 2usize;
        let out = build_column_filter_clauses(&[], &mut idx);
        assert!(out.where_conds.is_empty());
        assert!(out.having_conds.is_empty());
        assert!(out.bind_values.is_empty());
        assert_eq!(idx, 2, "param_idx must not change for empty filters");
    }

    #[test]
    fn filter_checklist_city_produces_where_condition() {
        let mut idx = 2usize;
        let out = build_column_filter_clauses(&[cf_checklist("city", vec!["Prague", "Brno"])], &mut idx);
        assert_eq!(out.where_conds.len(), 1);
        assert!(out.where_conds[0].contains("c.city = ANY($3)"), "got: {}", out.where_conds[0]);
        assert!(out.having_conds.is_empty());
        assert_eq!(out.bind_values.len(), 1);
        assert_eq!(out.bind_values[0], FilterBindValue::TextArray(vec!["Prague".into(), "Brno".into()]));
        assert_eq!(idx, 3);
    }

    #[test]
    fn filter_checklist_type_casts_to_text() {
        let mut idx = 1usize;
        let out = build_column_filter_clauses(&[cf_checklist("type", vec!["company"])], &mut idx);
        assert!(out.where_conds[0].contains("c.customer_type::text = ANY($2)"), "got: {}", out.where_conds[0]);
    }

    #[test]
    fn filter_checklist_geocode_status_casts_to_text() {
        let mut idx = 1usize;
        let out = build_column_filter_clauses(&[cf_checklist("geocodeStatus", vec!["success"])], &mut idx);
        assert!(out.where_conds[0].contains("c.geocode_status::text = ANY($2)"), "got: {}", out.where_conds[0]);
    }

    #[test]
    fn filter_checklist_device_count_produces_having_condition() {
        let mut idx = 2usize;
        let out = build_column_filter_clauses(&[cf_checklist("deviceCount", vec!["0", "1"])], &mut idx);
        assert!(out.where_conds.is_empty());
        assert_eq!(out.having_conds.len(), 1);
        assert!(out.having_conds[0].contains("COALESCE(COUNT(DISTINCT ds.device_id), 0)::text = ANY($3)"),
            "got: {}", out.having_conds[0]);
        assert_eq!(out.bind_values[0], FilterBindValue::TextArray(vec!["0".into(), "1".into()]));
    }

    #[test]
    fn filter_daterange_created_at_from_only() {
        let mut idx = 3usize;
        let out = build_column_filter_clauses(&[cf_daterange("createdAt", Some("2024-01-01"), None)], &mut idx);
        assert_eq!(out.where_conds.len(), 1);
        assert!(out.where_conds[0].contains("c.created_at::date >= $4::date"), "got: {}", out.where_conds[0]);
        assert!(out.having_conds.is_empty());
        assert_eq!(out.bind_values[0], FilterBindValue::Text("2024-01-01".into()));
        assert_eq!(idx, 4);
    }

    #[test]
    fn filter_daterange_created_at_to_only() {
        let mut idx = 1usize;
        let out = build_column_filter_clauses(&[cf_daterange("createdAt", None, Some("2024-12-31"))], &mut idx);
        assert!(out.where_conds[0].contains("c.created_at::date <= $2::date"), "got: {}", out.where_conds[0]);
    }

    #[test]
    fn filter_daterange_created_at_both_bounds() {
        let mut idx = 1usize;
        let out = build_column_filter_clauses(&[cf_daterange("createdAt", Some("2024-01-01"), Some("2024-12-31"))], &mut idx);
        assert_eq!(out.where_conds.len(), 2);
        assert!(out.where_conds[0].contains(">= $2::date"), "got: {}", out.where_conds[0]);
        assert!(out.where_conds[1].contains("<= $3::date"), "got: {}", out.where_conds[1]);
        assert_eq!(idx, 3);
    }

    #[test]
    fn filter_daterange_next_revision_produces_having_condition() {
        let mut idx = 2usize;
        let out = build_column_filter_clauses(&[cf_daterange("nextRevision", Some("2024-06-01"), Some("2024-12-31"))], &mut idx);
        assert!(out.where_conds.is_empty());
        assert_eq!(out.having_conds.len(), 2);
        assert!(out.having_conds[0].contains("MIN(r.due_date) FILTER"), "got: {}", out.having_conds[0]);
        assert!(out.having_conds[0].contains(">= $3::date"), "got: {}", out.having_conds[0]);
        assert!(out.having_conds[1].contains("<= $4::date"), "got: {}", out.having_conds[1]);
    }

    #[test]
    fn filter_param_idx_increments_correctly_for_multiple_filters() {
        // Start at 3 (simulating search + geocode_status already bound)
        let mut idx = 3usize;
        let filters = vec![
            cf_checklist("city", vec!["Prague"]),  // $4
            cf_daterange("createdAt", Some("2024-01-01"), Some("2024-12-31")),  // $5, $6
            cf_checklist("type", vec!["company"]),  // $7
        ];
        let out = build_column_filter_clauses(&filters, &mut idx);
        assert_eq!(idx, 7, "should have consumed $4, $5, $6, $7");
        assert_eq!(out.bind_values.len(), 4);
    }

    #[test]
    fn filter_duplicate_column_first_wins() {
        let mut idx = 1usize;
        let filters = vec![
            cf_checklist("city", vec!["Prague"]),
            cf_checklist("city", vec!["Brno"]),  // duplicate — must be skipped
        ];
        let out = build_column_filter_clauses(&filters, &mut idx);
        assert_eq!(out.where_conds.len(), 1, "only one condition for city");
        assert_eq!(out.bind_values.len(), 1);
        assert_eq!(out.bind_values[0], FilterBindValue::TextArray(vec!["Prague".into()]));
        assert_eq!(idx, 2);
    }

    #[test]
    fn filter_unknown_column_skipped() {
        let mut idx = 1usize;
        let filters = vec![cf_checklist("nonexistent_col", vec!["x"])];
        let out = build_column_filter_clauses(&filters, &mut idx);
        assert!(out.where_conds.is_empty());
        assert!(out.having_conds.is_empty());
        assert!(out.bind_values.is_empty());
        assert_eq!(idx, 1, "param_idx must not change for unknown column");
    }

    #[test]
    fn filter_empty_values_checklist_skipped() {
        let mut idx = 1usize;
        let filters = vec![cf_checklist("city", vec![])];
        let out = build_column_filter_clauses(&filters, &mut idx);
        assert!(out.where_conds.is_empty());
        assert_eq!(idx, 1, "empty values must not consume a param slot");
    }

    #[test]
    fn filter_injection_safety_column_name_not_interpolated() {
        let mut idx = 1usize;
        let malicious = ColumnFilter::Checklist {
            column: "'; DROP TABLE customers; --".to_string(),
            values: vec!["x".to_string()],
        };
        let out = build_column_filter_clauses(&[malicious], &mut idx);
        // Unknown column → no SQL emitted, no param consumed
        assert!(out.where_conds.is_empty());
        assert!(out.having_conds.is_empty());
        assert_eq!(idx, 1);
    }

    #[test]
    fn filter_injection_safety_values_not_interpolated() {
        let mut idx = 1usize;
        // Values go into bind positions, never into the SQL string
        let filter = cf_checklist("city", vec!["'; DROP TABLE customers; --"]);
        let out = build_column_filter_clauses(&[filter], &mut idx);
        assert_eq!(out.where_conds.len(), 1);
        // The SQL string itself must not contain the injected value
        assert!(!out.where_conds[0].contains("DROP"), "value must not appear in SQL string");
        // Value is in bind_values only
        if let FilterBindValue::TextArray(arr) = &out.bind_values[0] {
            assert_eq!(arr[0], "'; DROP TABLE customers; --");
        } else {
            panic!("expected TextArray");
        }
    }

    #[test]
    fn filter_all_where_columns_produce_where_not_having() {
        for col in &["name", "type", "city", "street", "postalCode", "phone", "email", "geocodeStatus", "createdAt"] {
            let filter = if *col == "createdAt" {
                cf_daterange(col, Some("2024-01-01"), None)
            } else {
                cf_checklist(col, vec!["x"])
            };
            let mut idx = 1usize;
            let out = build_column_filter_clauses(&[filter], &mut idx);
            assert!(!out.where_conds.is_empty(), "column {col} should produce WHERE condition");
            assert!(out.having_conds.is_empty(), "column {col} should NOT produce HAVING condition");
        }
    }

    #[test]
    fn filter_aggregate_columns_produce_having_not_where() {
        for col in &["deviceCount", "nextRevision"] {
            let filter = if *col == "nextRevision" {
                cf_daterange(col, Some("2024-01-01"), None)
            } else {
                cf_checklist(col, vec!["1"])
            };
            let mut idx = 1usize;
            let out = build_column_filter_clauses(&[filter], &mut idx);
            assert!(out.where_conds.is_empty(), "column {col} should NOT produce WHERE condition");
            assert!(!out.having_conds.is_empty(), "column {col} should produce HAVING condition");
        }
    }
}

