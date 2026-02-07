//! Revision message handlers

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
    ErrorResponse, Request, SuccessResponse,
};
use crate::types::revision::{
    CreateRevisionRequest, UpdateRevisionRequest, CompleteRevisionRequest,
    ListRevisionsRequest, UpcomingRevisionsRequest, RevisionStats, Revision,
    SuggestRevisionsRequest, SuggestRevisionsResponse,
    CallQueueRequest, CallQueueResponse, SnoozeRevisionRequest, ScheduleRevisionRequest,
};

/// Response for list of revisions
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionListResponse {
    pub items: Vec<Revision>,
    pub total: i64,
}

/// Response for upcoming revisions (overdue + due soon)
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingRevisionsResponse {
    pub overdue: Vec<Revision>,
    pub due_soon: Vec<Revision>,
}

/// Response for delete operation
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResponse {
    pub deleted: bool,
}

/// Handle revision.create messages
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<CreateRevisionRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Create revision
        match queries::revision::create_revision(&pool, user_id, &request.payload).await {
            Ok(revision) => {
                let response = SuccessResponse::new(request.id, revision);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Created revision: {}", response.payload.id);
            }
            Err(e) => {
                error!("Failed to create revision: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.list messages
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<ListRevisionsRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // List revisions
        match queries::revision::list_revisions(
            &pool,
            user_id,
            request.payload.customer_id,
            request.payload.device_id,
            request.payload.status.as_deref(),
            request.payload.from_date,
            request.payload.to_date,
            request.payload.date_type.as_deref(),
            request.payload.limit,
            request.payload.offset,
        ).await {
            Ok(revisions) => {
                let response = SuccessResponse::new(
                    request.id,
                    RevisionListResponse {
                        total: revisions.len() as i64,
                        items: revisions,
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Listed {} revisions", response.payload.items.len());
            }
            Err(e) => {
                error!("Failed to list revisions: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.get messages
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GetRevisionRequest {
        id: Uuid,
    }

    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.get message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<GetRevisionRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Get revision
        match queries::revision::get_revision(&pool, request.payload.id, user_id).await {
            Ok(Some(revision)) => {
                let response = SuccessResponse::new(request.id, revision);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Got revision: {}", response.payload.id);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Revision not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to get revision: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.update messages
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<UpdateRevisionRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Update revision
        match queries::revision::update_revision(
            &pool,
            request.payload.id,
            user_id,
            &request.payload,
        ).await {
            Ok(Some(revision)) => {
                let response = SuccessResponse::new(request.id, revision);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Updated revision: {}", response.payload.id);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Revision not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to update revision: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.complete messages
pub async fn handle_complete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.complete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<CompleteRevisionRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Complete revision
        match queries::revision::complete_revision(
            &pool,
            request.payload.id,
            user_id,
            &request.payload.result,
            request.payload.findings.as_deref(),
            request.payload.duration_minutes,
        ).await {
            Ok(Some(revision)) => {
                let response = SuccessResponse::new(request.id, revision);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Completed revision: {}", response.payload.id);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Revision not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to complete revision: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.delete messages
pub async fn handle_delete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct DeleteRequest {
        id: Uuid,
    }

    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.delete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<DeleteRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Delete revision
        match queries::revision::delete_revision(&pool, request.payload.id, user_id).await {
            Ok(deleted) => {
                if deleted {
                    let response = SuccessResponse::new(request.id, DeleteResponse { deleted: true });
                    let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                    debug!("Deleted revision: {}", request.payload.id);
                } else {
                    let error = ErrorResponse::new(request.id, "NOT_FOUND", "Revision not found");
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                }
            }
            Err(e) => {
                error!("Failed to delete revision: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.upcoming messages - returns overdue and due soon revisions
pub async fn handle_upcoming(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.upcoming message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<UpcomingRevisionsRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let days_ahead = request.payload.days_ahead.unwrap_or(30);

        // Get overdue and due soon revisions
        let overdue = queries::revision::list_overdue_revisions(&pool, user_id).await;
        let due_soon = queries::revision::list_due_soon_revisions(&pool, user_id, days_ahead).await;

        match (overdue, due_soon) {
            (Ok(overdue), Ok(due_soon)) => {
                let response = SuccessResponse::new(
                    request.id,
                    UpcomingRevisionsResponse { overdue, due_soon },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Listed upcoming revisions");
            }
            (Err(e), _) | (_, Err(e)) => {
                error!("Failed to list upcoming revisions: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.stats messages - returns revision statistics for dashboard
pub async fn handle_stats(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    #[derive(serde::Deserialize)]
    struct StatsRequest {}

    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.stats message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<StatsRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Get stats
        match queries::revision::get_revision_stats(&pool, user_id).await {
            Ok(stats) => {
                let response = SuccessResponse::new(request.id, stats);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Got revision stats");
            }
            Err(e) => {
                error!("Failed to get revision stats: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.suggest messages - returns prioritized suggestions for route planning
pub async fn handle_suggest(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    use tracing::info;

    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.suggest message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<SuggestRevisionsRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check auth
        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let max_count = request.payload.max_count.unwrap_or(50);
        let exclude_ids = request.payload.exclude_ids.as_deref().unwrap_or(&[]);

        info!(
            "Getting revision suggestions for date {} (max: {}, excluding: {} ids)",
            request.payload.date,
            max_count,
            exclude_ids.len()
        );

        // Get suggestions
        match queries::revision::get_revision_suggestions(
            &pool,
            user_id,
            request.payload.date,
            max_count,
            exclude_ids,
        ).await {
            Ok((suggestions, total)) => {
                let response = SuccessResponse::new(
                    request.id,
                    SuggestRevisionsResponse {
                        suggestions,
                        total_candidates: total,
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                info!("Returned {} suggestions out of {} total candidates", response.payload.suggestions.len(), total);
            }
            Err(e) => {
                error!("Failed to get revision suggestions: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.queue messages - get call queue
pub async fn handle_queue(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.queue message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CallQueueRequest> = match serde_json::from_slice(&msg.payload) {
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

        match queries::revision::get_call_queue(&pool, user_id, request.payload).await {
            Ok(queue_response) => {
                let response = SuccessResponse::new(request.id, queue_response);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to get call queue: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.snooze messages - snooze a revision
pub async fn handle_snooze(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.snooze message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<SnoozeRevisionRequest> = match serde_json::from_slice(&msg.payload) {
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

        match queries::revision::snooze_revision(
            &pool,
            user_id,
            request.payload.id,
            request.payload.snooze_until,
            request.payload.reason.clone(),
        ).await {
            Ok(Some(revision)) => {
                let response = SuccessResponse::new(request.id, revision);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Revision not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to snooze revision: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle revision.schedule messages - schedule a revision
pub async fn handle_schedule(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received revision.schedule message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ScheduleRevisionRequest> = match serde_json::from_slice(&msg.payload) {
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

        info!("Scheduling revision {} for user {} on {}", 
            request.payload.id, user_id, request.payload.scheduled_date);

        match queries::revision::schedule_revision(
            &pool,
            user_id,
            request.payload.id,
            request.payload.scheduled_date,
            request.payload.time_window_start,
            request.payload.time_window_end,
            request.payload.assigned_crew_id,
            request.payload.duration_minutes,
        ).await {
            Ok(Some(revision)) => {
                info!("Successfully scheduled revision {} for {}", revision.id, revision.scheduled_date.unwrap());
                let response = SuccessResponse::new(request.id, revision);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                warn!("Revision {} not found for user {}", request.payload.id, user_id);
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Revision not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to schedule revision: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}
