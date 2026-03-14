//! Scoring rule set and inbox state message handlers

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
    CreateScoringRuleSetRequest, ErrorResponse, Request, SaveInboxStateRequest, SuccessResponse,
    UpdateScoringRuleSetRequest,
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

/// Handle sazinka.scoring.rule_set.create
pub async fn handle_create_rule_set(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received scoring.rule_set.create");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, CreateScoringRuleSetRequest, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::scoring::create_rule_set(&pool, user_id, &request.payload).await {
            Ok(rule_set) => {
                let response = SuccessResponse::new(request.id, rule_set);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("create_rule_set error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.scoring.rule_set.list
pub async fn handle_list_rule_sets(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received scoring.rule_set.list");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, bool, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);
        let include_archived = request.payload;

        match queries::scoring::list_rule_sets(&pool, user_id, include_archived).await {
            Ok(sets) => {
                let response = SuccessResponse::new(request.id, sets);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("list_rule_sets error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.scoring.rule_set.update
pub async fn handle_update_rule_set(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received scoring.rule_set.update");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, UpdateScoringRuleSetRequest, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::scoring::update_rule_set(&pool, user_id, &request.payload).await {
            Ok(Some(rule_set)) => {
                let response = SuccessResponse::new(request.id, rule_set);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Rule set not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("update_rule_set error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.scoring.rule_set.archive
pub async fn handle_archive_rule_set(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received scoring.rule_set.archive");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, Uuid, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::scoring::archive_rule_set(&pool, user_id, request.payload).await {
            Ok(true) => {
                let response = SuccessResponse::new(request.id, serde_json::json!({"archived": true}));
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Rule set not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("archive_rule_set error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.scoring.rule_set.set_default
pub async fn handle_set_default_rule_set(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received scoring.rule_set.set_default");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, Uuid, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::scoring::set_default_rule_set(&pool, user_id, request.payload).await {
            Ok(true) => {
                let response = SuccessResponse::new(request.id, serde_json::json!({"default": true}));
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Rule set not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("set_default_rule_set error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.scoring.rule_set.delete
pub async fn handle_delete_rule_set(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received scoring.rule_set.delete");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, Uuid, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::scoring::delete_rule_set(&pool, user_id, request.payload).await {
            Ok(true) => {
                let response = SuccessResponse::new(request.id, serde_json::json!({"deleted": true}));
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Rule set not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                let code = if e.to_string().contains("SYSTEM_PROFILE") {
                    "SYSTEM_PROFILE"
                } else {
                    "DATABASE_ERROR"
                };
                error!("delete_rule_set error: {}", e);
                let error = ErrorResponse::new(request.id, code, e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.scoring.rule_set.restore_defaults
/// Payload: UUID of the rule set to restore. Locale is looked up from the user record.
pub async fn handle_restore_rule_set_defaults(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received scoring.rule_set.restore_defaults");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, Uuid, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        // Look up user locale for localized name reset
        let locale: String = sqlx::query_as::<_, (String,)>(
            "SELECT COALESCE(locale, 'en') FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .map(|(l,)| l)
        .unwrap_or_else(|| "en".to_string());

        match queries::scoring::restore_rule_set_defaults(&pool, user_id, request.payload, &locale).await {
            Ok(Some(rule_set)) => {
                let response = SuccessResponse::new(request.id, rule_set);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Rule set not found or not a system profile");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("restore_rule_set_defaults error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.inbox_state.get
pub async fn handle_get_inbox_state(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received inbox_state.get");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, (), client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::inbox_state::get_inbox_state(&pool, user_id).await {
            Ok(state) => {
                let response = SuccessResponse::new(request.id, state);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("get_inbox_state error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}

/// Handle sazinka.inbox_state.save
pub async fn handle_save_inbox_state(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received inbox_state.save");
        let reply = match msg.reply { Some(r) => r, None => { warn!("No reply"); continue; } };
        let request = parse_request!(msg, SaveInboxStateRequest, client, reply);
        let user_id = require_auth!(request, jwt_secret, client, reply);

        match queries::inbox_state::save_inbox_state(&pool, user_id, &request.payload).await {
            Ok(state) => {
                let response = SuccessResponse::new(request.id, state);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("save_inbox_state error: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    Ok(())
}
