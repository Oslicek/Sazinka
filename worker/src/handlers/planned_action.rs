//! Planned action message handlers

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
    CreatePlannedActionRequest, ErrorResponse, ListPlannedActionsRequest, Request,
    SuccessResponse, UpdatePlannedActionRequest,
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

macro_rules! parse_request {
    ($msg:expr, $ty:ty, $client:expr, $reply:expr) => {
        match serde_json::from_slice::<Request<$ty>>(&$msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = $client.publish($reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        }
    };
}

/// Handle sazinka.planned_action.create
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received planned_action.create");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply subject"); continue; } };
        let request = parse_request!(msg, CreatePlannedActionRequest, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::planned_action::create_planned_action(&pool, user_id, &request.payload).await {
            Ok(action) => {
                let response = SuccessResponse::new(request.id, action);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("create_planned_action error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.planned_action.list
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received planned_action.list");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply subject"); continue; } };
        let request = parse_request!(msg, ListPlannedActionsRequest, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::planned_action::list_planned_actions(&pool, user_id, &request.payload).await {
            Ok(result) => {
                let response = SuccessResponse::new(request.id, result);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("list_planned_actions error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.planned_action.get
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received planned_action.get");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply subject"); continue; } };
        let request = parse_request!(msg, Uuid, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);
        let action_id = request.payload;

        match queries::planned_action::get_planned_action(&pool, user_id, action_id).await {
            Ok(Some(action)) => {
                let response = SuccessResponse::new(request.id, action);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Planned action not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("get_planned_action error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.planned_action.update
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received planned_action.update");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply subject"); continue; } };
        let request = parse_request!(msg, UpdatePlannedActionRequest, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::planned_action::update_planned_action(&pool, user_id, &request.payload).await {
            Ok(Some(action)) => {
                let response = SuccessResponse::new(request.id, action);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Planned action not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("update_planned_action error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.planned_action.cancel
pub async fn handle_cancel(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received planned_action.cancel");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply subject"); continue; } };
        let request = parse_request!(msg, Uuid, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);
        let action_id = request.payload;

        match queries::planned_action::cancel_planned_action(&pool, user_id, action_id).await {
            Ok(Some(action)) => {
                let response = SuccessResponse::new(request.id, action);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Planned action not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("cancel_planned_action error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.planned_action.complete
pub async fn handle_complete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received planned_action.complete");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply subject"); continue; } };
        let request = parse_request!(msg, Uuid, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);
        let action_id = request.payload;

        match queries::planned_action::complete_planned_action(&pool, user_id, action_id).await {
            Ok(Some(action)) => {
                let response = SuccessResponse::new(request.id, action);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Planned action not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("complete_planned_action error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}
