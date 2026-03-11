//! Task and TaskType message handlers

use std::sync::Arc;

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::types::{
    CreateTaskRequest, CreateTaskTypeRequest, ErrorResponse, ListTasksRequest, Request,
    SuccessResponse, UpdateTaskRequest, UpdateTaskTypeRequest,
};

macro_rules! require_auth {
    ($request:expr, $jwt_secret:expr, $client:expr, $reply:expr) => {
        match auth::extract_auth(&$request, &$jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new($request.id, "UNAUTHORIZED", "Authentication required");
                let _ = $client.publish($reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        }
    };
}

macro_rules! parse_reply {
    ($msg:expr, $client:expr) => {
        match $msg.reply {
            Some(ref r) => r.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        }
    };
}

// ============================================================================
// TASK TYPE HANDLERS
// ============================================================================

pub async fn handle_task_type_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received task_type.create message");
        let reply = parse_reply!(msg, client);
        let request: Request<CreateTaskTypeRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::task::create_task_type(&pool, user_id, &request.payload).await {
            Ok(tt) => {
                let _ = client.publish(reply, serde_json::to_vec(&SuccessResponse::new(request.id, tt))?.into()).await;
            }
            Err(e) => {
                error!("Failed to create task_type: {}", e);
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string()))?.into()).await;
            }
        }
    }
    Ok(())
}

pub async fn handle_task_type_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received task_type.list message");
        let reply = parse_reply!(msg, client);
        let request: Request<serde_json::Value> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        let user_id = require_auth!(request, jwt_secret, client, reply);

        let active_only = request.payload.get("activeOnly")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        match queries::task::list_task_types(&pool, user_id, active_only).await {
            Ok(types) => {
                let _ = client.publish(reply, serde_json::to_vec(&SuccessResponse::new(request.id, types))?.into()).await;
            }
            Err(e) => {
                error!("Failed to list task_types: {}", e);
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string()))?.into()).await;
            }
        }
    }
    Ok(())
}

pub async fn handle_task_type_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received task_type.update message");
        let reply = parse_reply!(msg, client);
        let request: Request<UpdateTaskTypeRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::task::update_task_type(&pool, user_id, &request.payload).await {
            Ok(Some(tt)) => {
                let _ = client.publish(reply, serde_json::to_vec(&SuccessResponse::new(request.id, tt))?.into()).await;
            }
            Ok(None) => {
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "NOT_FOUND", "Task type not found"))?.into()).await;
            }
            Err(e) => {
                error!("Failed to update task_type: {}", e);
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string()))?.into()).await;
            }
        }
    }
    Ok(())
}

// ============================================================================
// TASK HANDLERS
// ============================================================================

pub async fn handle_task_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received task.create message");
        let reply = parse_reply!(msg, client);
        let request: Request<CreateTaskRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::task::create_task(&pool, user_id, &request.payload).await {
            Ok(task) => {
                let _ = client.publish(reply, serde_json::to_vec(&SuccessResponse::new(request.id, task))?.into()).await;
            }
            Err(e) => {
                error!("Failed to create task: {}", e);
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string()))?.into()).await;
            }
        }
    }
    Ok(())
}

pub async fn handle_task_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received task.list message");
        let reply = parse_reply!(msg, client);
        let request: Request<ListTasksRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::task::list_tasks(&pool, user_id, &request.payload).await {
            Ok(resp) => {
                let _ = client.publish(reply, serde_json::to_vec(&SuccessResponse::new(request.id, resp))?.into()).await;
            }
            Err(e) => {
                error!("Failed to list tasks: {}", e);
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string()))?.into()).await;
            }
        }
    }
    Ok(())
}

pub async fn handle_task_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received task.get message");
        let reply = parse_reply!(msg, client);

        #[derive(serde::Deserialize)]
        struct GetTaskPayload { id: Uuid }

        let request: Request<GetTaskPayload> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::task::get_task(&pool, user_id, request.payload.id).await {
            Ok(Some(task)) => {
                let _ = client.publish(reply, serde_json::to_vec(&SuccessResponse::new(request.id, task))?.into()).await;
            }
            Ok(None) => {
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "NOT_FOUND", "Task not found"))?.into()).await;
            }
            Err(e) => {
                error!("Failed to get task: {}", e);
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string()))?.into()).await;
            }
        }
    }
    Ok(())
}

pub async fn handle_task_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received task.update message");
        let reply = parse_reply!(msg, client);
        let request: Request<UpdateTaskRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::task::update_task(&pool, user_id, &request.payload).await {
            Ok(Some(task)) => {
                let _ = client.publish(reply, serde_json::to_vec(&SuccessResponse::new(request.id, task))?.into()).await;
            }
            Ok(None) => {
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "NOT_FOUND", "Task not found"))?.into()).await;
            }
            Err(e) => {
                error!("Failed to update task: {}", e);
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string()))?.into()).await;
            }
        }
    }
    Ok(())
}

pub async fn handle_task_complete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received task.complete message");
        let reply = parse_reply!(msg, client);

        #[derive(serde::Deserialize)]
        struct CompleteTaskPayload { id: Uuid }

        let request: Request<CompleteTaskPayload> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::task::complete_task(&pool, user_id, request.payload.id).await {
            Ok(Some(task)) => {
                // Also complete any open planned_action linked to this task via action_targets
                if let Err(e) = queries::planned_action::complete_planned_actions_for_task(
                    &pool, user_id, task.id,
                ).await {
                    warn!("Failed to complete planned_actions for task {}: {}", task.id, e);
                }
                let _ = client.publish(reply, serde_json::to_vec(&SuccessResponse::new(request.id, task))?.into()).await;
            }
            Ok(None) => {
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "NOT_FOUND", "Task not found or already completed"))?.into()).await;
            }
            Err(e) => {
                error!("Failed to complete task: {}", e);
                let _ = client.publish(reply, serde_json::to_vec(&ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string()))?.into()).await;
            }
        }
    }
    Ok(())
}
