//! Crew handlers for NATS messages

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::db::queries;
use crate::types::{
    ErrorResponse, Request, SuccessResponse,
    CreateCrewRequest, UpdateCrewRequest, ListCrewsRequest, 
    DeleteCrewRequest, Crew, CrewListResponse,
};

/// Handle crew.create messages
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received crew.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CreateCrewRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "User ID required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        match queries::crew::create_crew(&pool, user_id, request.payload).await {
            Ok(crew) => {
                let response = SuccessResponse::new(request.id, crew);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to create crew: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle crew.list messages
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received crew.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ListCrewsRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "User ID required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let active_only = request.payload.active_only.unwrap_or(true);

        match queries::crew::list_crews(&pool, user_id, active_only).await {
            Ok(crews) => {
                let total = crews.len() as i64;
                let response = SuccessResponse::new(request.id, CrewListResponse {
                    items: crews,
                    total,
                });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to list crews: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle crew.update messages
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received crew.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateCrewRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "User ID required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        match queries::crew::update_crew(&pool, user_id, request.payload).await {
            Ok(Some(crew)) => {
                let response = SuccessResponse::new(request.id, crew);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Crew not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to update crew: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle crew.delete messages
pub async fn handle_delete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received crew.delete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<DeleteCrewRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "User ID required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        match queries::crew::delete_crew(&pool, request.payload.id, user_id).await {
            Ok(true) => {
                let response = SuccessResponse::new(request.id, serde_json::json!({ "deleted": true }));
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Crew not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to delete crew: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}
