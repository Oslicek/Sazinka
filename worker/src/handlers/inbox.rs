//! Inbox message handlers

use std::sync::Arc;

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::types::{ErrorResponse, InboxRequest, Request, SuccessResponse};

/// Handle sazinka.inbox.query — returns the customer-centric planning inbox
pub async fn handle_query(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received inbox.query");

        let reply = match msg.reply {
            Some(r) => r,
            None => {
                warn!("inbox.query: no reply subject");
                continue;
            }
        };

        let request: Request<InboxRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse inbox.query request: {}", e);
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

        match queries::planned_action::get_customer_inbox(&pool, user_id, request.payload).await {
            Ok(inbox) => {
                let response = SuccessResponse::new(request.id, inbox);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("get_customer_inbox error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}
