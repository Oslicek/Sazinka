#![allow(dead_code)]
//! Task and TaskType database queries

use anyhow::Result;
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::task::{
    CreateTaskRequest, CreateTaskTypeRequest, ListTasksRequest, Task, TaskListResponse, TaskType,
    UpdateTaskRequest, UpdateTaskTypeRequest,
};

const TASK_TYPE_COLS: &str = "id, user_id, name, label_key, is_system, is_active, payload_schema, created_at";

const TASK_COLS: &str = r#"
    t.id, t.user_id, t.task_type_id, t.customer_id,
    t.visit_id, t.device_id, t.status, t.payload,
    t.due_date, t.completed_at, t.created_at, t.updated_at,
    tt.name AS task_type_name, tt.label_key AS task_type_label_key
"#;

// ============================================================================
// TASK TYPE CRUD
// ============================================================================

pub async fn create_task_type(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreateTaskTypeRequest,
) -> Result<TaskType> {
    let tt = sqlx::query_as::<_, TaskType>(&format!(
        "INSERT INTO task_types (id, user_id, name, label_key, is_system, is_active, payload_schema, created_at)
         VALUES ($1, $2, $3, $4, FALSE, TRUE, $5, NOW())
         RETURNING {}",
        TASK_TYPE_COLS
    ))
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.label_key)
    .bind(&req.payload_schema)
    .fetch_one(pool)
    .await?;

    Ok(tt)
}

pub async fn list_task_types(pool: &PgPool, user_id: Uuid, active_only: bool) -> Result<Vec<TaskType>> {
    let query = if active_only {
        format!("SELECT {} FROM task_types WHERE user_id = $1 AND is_active = TRUE ORDER BY name ASC", TASK_TYPE_COLS)
    } else {
        format!("SELECT {} FROM task_types WHERE user_id = $1 ORDER BY name ASC", TASK_TYPE_COLS)
    };

    let types = sqlx::query_as::<_, TaskType>(&query)
        .bind(user_id)
        .fetch_all(pool)
        .await?;

    Ok(types)
}

pub async fn get_task_type(
    pool: &PgPool,
    user_id: Uuid,
    task_type_id: Uuid,
) -> Result<Option<TaskType>> {
    let tt = sqlx::query_as::<_, TaskType>(&format!(
        "SELECT {} FROM task_types WHERE id = $1 AND user_id = $2",
        TASK_TYPE_COLS
    ))
    .bind(task_type_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(tt)
}

pub async fn update_task_type(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateTaskTypeRequest,
) -> Result<Option<TaskType>> {
    let tt = sqlx::query_as::<_, TaskType>(&format!(
        r#"
        UPDATE task_types
        SET name         = COALESCE($1, name),
            label_key    = COALESCE($2, label_key),
            is_active    = COALESCE($3, is_active),
            payload_schema = COALESCE($4, payload_schema)
        WHERE id = $5 AND user_id = $6
        RETURNING {}
        "#,
        TASK_TYPE_COLS
    ))
    .bind(&req.name)
    .bind(&req.label_key)
    .bind(req.is_active)
    .bind(&req.payload_schema)
    .bind(req.id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(tt)
}

// ============================================================================
// TASK CRUD
// ============================================================================

pub async fn create_task(pool: &PgPool, user_id: Uuid, req: &CreateTaskRequest) -> Result<Task> {
    let task = sqlx::query_as::<_, Task>(&format!(
        r#"
        WITH inserted AS (
            INSERT INTO tasks (
                id, user_id, task_type_id, customer_id,
                visit_id, device_id, status, payload,
                due_date, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, NOW(), NOW())
            RETURNING *
        )
        SELECT {} FROM inserted t
        LEFT JOIN task_types tt ON tt.id = t.task_type_id
        "#,
        TASK_COLS
    ))
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(req.task_type_id)
    .bind(req.customer_id)
    .bind(req.visit_id)
    .bind(req.device_id)
    .bind(&req.payload)
    .bind(req.due_date)
    .fetch_one(pool)
    .await?;

    Ok(task)
}

pub async fn get_task(pool: &PgPool, user_id: Uuid, task_id: Uuid) -> Result<Option<Task>> {
    let task = sqlx::query_as::<_, Task>(&format!(
        "SELECT {} FROM tasks t LEFT JOIN task_types tt ON tt.id = t.task_type_id WHERE t.id = $1 AND t.user_id = $2",
        TASK_COLS
    ))
    .bind(task_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(task)
}

pub async fn list_tasks(
    pool: &PgPool,
    user_id: Uuid,
    req: &ListTasksRequest,
) -> Result<TaskListResponse> {
    let limit = req.limit.unwrap_or(50) as i64;
    let offset = req.offset.unwrap_or(0) as i64;

    let mut conditions = vec!["t.user_id = $1".to_string()];
    let mut param_idx: usize = 1;

    if req.customer_id.is_some() {
        param_idx += 1;
        conditions.push(format!("t.customer_id = ${}", param_idx));
    }
    if req.task_type_id.is_some() {
        param_idx += 1;
        conditions.push(format!("t.task_type_id = ${}", param_idx));
    }
    if req.status.is_some() {
        param_idx += 1;
        conditions.push(format!("t.status = ${}", param_idx));
    }

    let where_clause = conditions.join(" AND ");
    let query = format!(
        "SELECT {} FROM tasks t LEFT JOIN task_types tt ON tt.id = t.task_type_id WHERE {} ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC LIMIT ${}  OFFSET ${}",
        TASK_COLS,
        where_clause,
        param_idx + 1,
        param_idx + 2
    );

    let mut qb = sqlx::query_as::<_, Task>(&query).bind(user_id);
    if let Some(cid) = req.customer_id {
        qb = qb.bind(cid);
    }
    if let Some(ttid) = req.task_type_id {
        qb = qb.bind(ttid);
    }
    if let Some(ref s) = req.status {
        qb = qb.bind(s);
    }
    let items = qb.bind(limit).bind(offset).fetch_all(pool).await?;

    let count_query = format!(
        "SELECT COUNT(*) FROM tasks t WHERE {}",
        where_clause
    );
    let mut count_qb = sqlx::query_as::<_, (i64,)>(&count_query).bind(user_id);
    if let Some(cid) = req.customer_id {
        count_qb = count_qb.bind(cid);
    }
    if let Some(ttid) = req.task_type_id {
        count_qb = count_qb.bind(ttid);
    }
    if let Some(ref s) = req.status {
        count_qb = count_qb.bind(s);
    }
    let (total,) = count_qb.fetch_one(pool).await?;

    Ok(TaskListResponse { items, total })
}

pub async fn update_task(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateTaskRequest,
) -> Result<Option<Task>> {
    let task = sqlx::query_as::<_, Task>(&format!(
        r#"
        WITH updated AS (
            UPDATE tasks
            SET status   = COALESCE($1, status),
                payload  = COALESCE($2, payload),
                due_date = COALESCE($3, due_date),
                updated_at = NOW()
            WHERE id = $4 AND user_id = $5
            RETURNING *
        )
        SELECT {} FROM updated t
        LEFT JOIN task_types tt ON tt.id = t.task_type_id
        "#,
        TASK_COLS
    ))
    .bind(&req.status)
    .bind(&req.payload)
    .bind(req.due_date)
    .bind(req.id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(task)
}

pub async fn complete_task(
    pool: &PgPool,
    user_id: Uuid,
    task_id: Uuid,
) -> Result<Option<Task>> {
    let now = Utc::now();
    let task = sqlx::query_as::<_, Task>(&format!(
        r#"
        WITH updated AS (
            UPDATE tasks
            SET status = 'completed', completed_at = $1, updated_at = NOW()
            WHERE id = $2 AND user_id = $3 AND status != 'completed'
            RETURNING *
        )
        SELECT {} FROM updated t
        LEFT JOIN task_types tt ON tt.id = t.task_type_id
        "#,
        TASK_COLS
    ))
    .bind(now)
    .bind(task_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_cols_includes_joined_type_fields() {
        assert!(TASK_COLS.contains("task_type_name"));
        assert!(TASK_COLS.contains("task_type_label_key"));
    }

    #[test]
    fn list_tasks_default_limit_is_50() {
        let req = ListTasksRequest::default();
        assert_eq!(req.limit.unwrap_or(50), 50);
    }
}
