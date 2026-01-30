//! Communication message handlers

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::db::queries;
use crate::types::{
    Communication, CreateCommunicationRequest, ErrorResponse, ListCommunicationsRequest,
    ListCommunicationsResponse, Request, SuccessResponse, UpdateCommunicationRequest,
};

/// Handle communication.create messages
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received communication.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CreateCommunicationRequest> = match serde_json::from_slice(&msg.payload)
        {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
                continue;
            }
        };

        let payload = request.payload;
        info!("Creating communication for customer {}", payload.customer_id);

        match queries::communication::create_communication(
            &pool,
            user_id,
            payload.customer_id,
            payload.revision_id,
            &payload.comm_type,
            &payload.direction,
            payload.subject.as_deref(),
            &payload.content,
            payload.contact_name.as_deref(),
            payload.contact_phone.as_deref(),
            payload.duration_minutes,
            payload.follow_up_date,
        )
        .await
        {
            Ok(communication) => {
                let comm_id = communication.id;
                let response = SuccessResponse::new(request.id, communication);
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                debug!("Created communication {}", comm_id);
            }
            Err(e) => {
                error!("Failed to create communication: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}

/// Handle communication.list messages
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received communication.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ListCommunicationsRequest> = match serde_json::from_slice(&msg.payload)
        {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
                continue;
            }
        };

        let payload = request.payload;
        let limit = payload.limit.unwrap_or(50);
        let offset = payload.offset.unwrap_or(0);

        match queries::communication::list_communications(
            &pool,
            user_id,
            payload.customer_id,
            payload.revision_id,
            payload.comm_type.as_deref(),
            payload.follow_up_pending,
            limit,
            offset,
        )
        .await
        {
            Ok((communications, total)) => {
                let response = SuccessResponse::new(
                    request.id,
                    ListCommunicationsResponse {
                        communications,
                        total,
                    },
                );
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                debug!("Listed {} communications", total);
            }
            Err(e) => {
                error!("Failed to list communications: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}

/// Handle communication.update messages
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received communication.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateCommunicationRequest> = match serde_json::from_slice(&msg.payload)
        {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
                continue;
            }
        };

        let payload = request.payload;

        match queries::communication::update_communication(
            &pool,
            payload.id,
            user_id,
            payload.subject.as_deref(),
            payload.content.as_deref(),
            payload.follow_up_date,
            payload.follow_up_completed,
        )
        .await
        {
            Ok(Some(communication)) => {
                let response = SuccessResponse::new(request.id, communication);
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                debug!("Updated communication {}", payload.id);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Communication not found");
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
            Err(e) => {
                error!("Failed to update communication: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}

/// Handle communication.delete messages
pub async fn handle_delete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received communication.delete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        #[derive(serde::Deserialize)]
        struct DeleteRequest {
            id: Uuid,
        }

        let request: Request<DeleteRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
                continue;
            }
        };

        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
                continue;
            }
        };

        match queries::communication::delete_communication(&pool, request.payload.id, user_id).await
        {
            Ok(deleted) => {
                #[derive(serde::Serialize)]
                struct DeleteResponse {
                    deleted: bool,
                }
                let response = SuccessResponse::new(request.id, DeleteResponse { deleted });
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                debug!("Deleted communication: {}", deleted);
            }
            Err(e) => {
                error!("Failed to delete communication: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}
