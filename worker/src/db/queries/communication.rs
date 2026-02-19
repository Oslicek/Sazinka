#![allow(dead_code)]
//! Communication database queries

use anyhow::Result;
use chrono::NaiveDate;
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::Communication;

/// Create a new communication
pub async fn create_communication(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    revision_id: Option<Uuid>,
    comm_type: &str,
    direction: &str,
    subject: Option<&str>,
    content: &str,
    contact_name: Option<&str>,
    contact_phone: Option<&str>,
    duration_minutes: Option<i32>,
    follow_up_date: Option<NaiveDate>,
) -> Result<Communication> {
    let communication = sqlx::query_as::<_, Communication>(
        r#"
        INSERT INTO communications (
            id, user_id, customer_id, revision_id,
            comm_type, direction, subject, content,
            contact_name, contact_phone, duration_minutes,
            follow_up_date, follow_up_completed, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5::comm_type, $6::comm_direction, $7, $8, $9, $10, $11, $12, FALSE, NOW(), NOW())
        RETURNING
            id, user_id, customer_id, revision_id,
            comm_type::text, direction::text, subject, content,
            contact_name, contact_phone, email_status,
            duration_minutes, follow_up_date, follow_up_completed,
            created_at, updated_at
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(customer_id)
    .bind(revision_id)
    .bind(comm_type)
    .bind(direction)
    .bind(subject)
    .bind(content)
    .bind(contact_name)
    .bind(contact_phone)
    .bind(duration_minutes)
    .bind(follow_up_date)
    .fetch_one(pool)
    .await?;

    Ok(communication)
}

/// Get a communication by ID
pub async fn get_communication(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
) -> Result<Option<Communication>> {
    let communication = sqlx::query_as::<_, Communication>(
        r#"
        SELECT
            id, user_id, customer_id, revision_id,
            comm_type::text, direction::text, subject, content,
            contact_name, contact_phone, email_status,
            duration_minutes, follow_up_date, follow_up_completed,
            created_at, updated_at
        FROM communications
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(communication)
}

/// List communications with filters
pub async fn list_communications(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Option<Uuid>,
    revision_id: Option<Uuid>,
    comm_type: Option<&str>,
    follow_up_pending: Option<bool>,
    limit: i64,
    offset: i64,
) -> Result<(Vec<Communication>, i64)> {
    // Build dynamic query
    let mut conditions = vec!["user_id = $1".to_string()];
    let mut param_count = 1;

    if customer_id.is_some() {
        param_count += 1;
        conditions.push(format!("customer_id = ${}", param_count));
    }
    if revision_id.is_some() {
        param_count += 1;
        conditions.push(format!("revision_id = ${}", param_count));
    }
    if comm_type.is_some() {
        param_count += 1;
        conditions.push(format!("comm_type = ${}", param_count));
    }
    if follow_up_pending == Some(true) {
        conditions.push("follow_up_date IS NOT NULL AND follow_up_completed = FALSE".to_string());
    }

    let where_clause = conditions.join(" AND ");

    let query = format!(
        r#"
        SELECT
            id, user_id, customer_id, revision_id,
            comm_type::text, direction::text, subject, content,
            contact_name, contact_phone, email_status,
            duration_minutes, follow_up_date, follow_up_completed,
            created_at, updated_at
        FROM communications
        WHERE {}
        ORDER BY created_at DESC
        LIMIT ${} OFFSET ${}
        "#,
        where_clause,
        param_count + 1,
        param_count + 2
    );

    let count_query = format!(
        "SELECT COUNT(*) FROM communications WHERE {}",
        where_clause
    );

    // Build and execute queries
    let mut query_builder = sqlx::query_as::<_, Communication>(&query).bind(user_id);
    let mut count_builder = sqlx::query_scalar::<_, i64>(&count_query).bind(user_id);

    if let Some(cid) = customer_id {
        query_builder = query_builder.bind(cid);
        count_builder = count_builder.bind(cid);
    }
    if let Some(rid) = revision_id {
        query_builder = query_builder.bind(rid);
        count_builder = count_builder.bind(rid);
    }
    if let Some(ct) = comm_type {
        query_builder = query_builder.bind(ct);
        count_builder = count_builder.bind(ct);
    }

    query_builder = query_builder.bind(limit).bind(offset);

    let communications = query_builder.fetch_all(pool).await?;
    let total = count_builder.fetch_one(pool).await?;

    Ok((communications, total))
}

/// Update a communication
pub async fn update_communication(
    pool: &PgPool,
    id: Uuid,
    user_id: Uuid,
    subject: Option<&str>,
    content: Option<&str>,
    follow_up_date: Option<NaiveDate>,
    follow_up_completed: Option<bool>,
) -> Result<Option<Communication>> {
    let communication = sqlx::query_as::<_, Communication>(
        r#"
        UPDATE communications
        SET
            subject = COALESCE($3, subject),
            content = COALESCE($4, content),
            follow_up_date = COALESCE($5, follow_up_date),
            follow_up_completed = COALESCE($6, follow_up_completed)
        WHERE id = $1 AND user_id = $2
        RETURNING
            id, user_id, customer_id, revision_id,
            comm_type::text, direction::text, subject, content,
            contact_name, contact_phone, email_status,
            duration_minutes, follow_up_date, follow_up_completed,
            created_at, updated_at
        "#,
    )
    .bind(id)
    .bind(user_id)
    .bind(subject)
    .bind(content)
    .bind(follow_up_date)
    .bind(follow_up_completed)
    .fetch_optional(pool)
    .await?;

    Ok(communication)
}

/// Delete a communication
pub async fn delete_communication(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<bool> {
    let result = sqlx::query("DELETE FROM communications WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

/// Get communications for a customer (for timeline)
pub async fn get_customer_communications(
    pool: &PgPool,
    customer_id: Uuid,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<Communication>> {
    let communications = sqlx::query_as::<_, Communication>(
        r#"
        SELECT
            id, user_id, customer_id, revision_id,
            comm_type::text, direction::text, subject, content,
            contact_name, contact_phone, email_status,
            duration_minutes, follow_up_date, follow_up_completed,
            created_at, updated_at
        FROM communications
        WHERE customer_id = $1 AND user_id = $2
        ORDER BY created_at DESC
        LIMIT $3
        "#,
    )
    .bind(customer_id)
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(communications)
}
