//! Visit message handlers

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::db::queries;
use crate::types::{
    CompleteVisitRequest, CreateVisitRequest, ErrorResponse, ListVisitsRequest,
    ListVisitsResponse, Request, SuccessResponse, UpdateVisitRequest, Visit,
};

/// Handle visit.create messages
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received visit.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CreateVisitRequest> = match serde_json::from_slice(&msg.payload) {
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
        info!(
            "Creating visit for customer {} on {}",
            payload.customer_id, payload.scheduled_date
        );

        match queries::visit::create_visit(
            &pool,
            user_id,
            payload.customer_id,
            payload.crew_id,
            payload.device_id,
            payload.scheduled_date,
            payload.scheduled_time_start,
            payload.scheduled_time_end,
            payload.visit_type.as_deref().unwrap_or("revision"),
            payload.status.as_deref(),
        )
        .await
        {
            Ok(visit) => {
                let visit_id = visit.id;
                let response = SuccessResponse::new(request.id, visit);
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                debug!("Created visit {}", visit_id);
            }
            Err(e) => {
                error!("Failed to create visit: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}

/// Handle visit.list messages
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received visit.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ListVisitsRequest> = match serde_json::from_slice(&msg.payload) {
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

        match queries::visit::list_visits(
            &pool,
            user_id,
            payload.customer_id,
            payload.date_from,
            payload.date_to,
            payload.status.as_deref(),
            payload.visit_type.as_deref(),
            limit,
            offset,
        )
        .await
        {
            Ok((visits, total)) => {
                let response =
                    SuccessResponse::new(request.id, ListVisitsResponse { visits, total });
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                debug!("Listed {} visits", total);
            }
            Err(e) => {
                error!("Failed to list visits: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}

/// Handle visit.update messages
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received visit.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateVisitRequest> = match serde_json::from_slice(&msg.payload) {
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

        match queries::visit::update_visit(
            &pool,
            payload.id,
            user_id,
            payload.scheduled_date,
            payload.scheduled_time_start,
            payload.scheduled_time_end,
            payload.status.as_deref(),
            payload.visit_type.as_deref(),
        )
        .await
        {
            Ok(Some(visit)) => {
                let response = SuccessResponse::new(request.id, visit);
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                debug!("Updated visit {}", payload.id);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Visit not found");
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
            Err(e) => {
                error!("Failed to update visit: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}

/// Handle visit.complete messages
pub async fn handle_complete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received visit.complete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CompleteVisitRequest> = match serde_json::from_slice(&msg.payload) {
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

        match queries::visit::complete_visit(
            &pool,
            payload.id,
            user_id,
            &payload.result,
            payload.result_notes.as_deref(),
            payload.actual_arrival,
            payload.actual_departure,
            payload.requires_follow_up.unwrap_or(false),
            payload.follow_up_reason.as_deref(),
        )
        .await
        {
            Ok(Some(visit)) => {
                let response = SuccessResponse::new(request.id, visit);
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                info!("Completed visit {} with result: {}", payload.id, payload.result);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Visit not found");
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
            Err(e) => {
                error!("Failed to complete visit: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}

/// Handle visit.delete messages
pub async fn handle_delete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received visit.delete message");

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

        match queries::visit::delete_visit(&pool, request.payload.id, user_id).await {
            Ok(deleted) => {
                #[derive(serde::Serialize)]
                struct DeleteResponse {
                    deleted: bool,
                }
                let response = SuccessResponse::new(request.id, DeleteResponse { deleted });
                let _ = client
                    .publish(reply, serde_json::to_vec(&response)?.into())
                    .await;
                debug!("Deleted visit: {}", deleted);
            }
            Err(e) => {
                error!("Failed to delete visit: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client
                    .publish(reply, serde_json::to_vec(&error)?.into())
                    .await;
            }
        }
    }

    Ok(())
}
