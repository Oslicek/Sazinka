//! Visit message handlers

use std::sync::Arc;

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::types::{
    CompleteVisitRequest, CreateVisitRequest, ErrorResponse, ListVisitsRequest,
    ListVisitsResponse, Request, SuccessResponse, UpdateVisitRequest,
};

/// Handle visit.create messages
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
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

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
    jwt_secret: Arc<String>,
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

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
    jwt_secret: Arc<String>,
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

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
    jwt_secret: Arc<String>,
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

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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
    jwt_secret: Arc<String>,
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

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
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

/// Handle visit.get messages
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received visit.get message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<crate::types::visit::VisitIdRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let visit_id = request.payload.id;

        // Get visit
        match queries::visit::get_visit(&pool, visit_id, user_id).await {
            Ok(Some(visit)) => {
                // Get customer data
                let customer = match queries::customer::get_customer(&pool, user_id, visit.customer_id).await {
                    Ok(Some(c)) => c,
                    Ok(None) => {
                        let error = ErrorResponse::new(request.id, "NOT_FOUND", "Customer not found");
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                        continue;
                    }
                    Err(e) => {
                        error!("Failed to get customer: {}", e);
                        let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                        continue;
                    }
                };

                // Get work items for this visit
                let work_items = match queries::work_item::list_work_items_for_visit(&pool, user_id, visit_id).await {
                    Ok(items) => items,
                    Err(e) => {
                        warn!("Failed to get work items for visit {}: {}", visit_id, e);
                        vec![]
                    }
                };

                let work_items_count = work_items.len();
                let response = SuccessResponse::new(
                    request.id,
                    crate::types::visit::GetVisitResponse {
                        visit,
                        customer_name: customer.name,
                        customer_street: customer.street,
                        customer_city: customer.city,
                        customer_postal_code: customer.postal_code,
                        customer_phone: customer.phone,
                        customer_lat: customer.lat,
                        customer_lng: customer.lng,
                        work_items,
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Returned visit {} with {} work items", visit_id, work_items_count);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Visit not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to get visit: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}
