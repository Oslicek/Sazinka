//! Device type config NATS handlers
//!
//! NATS subjects:
//!   sazinka.device_type_config.list
//!   sazinka.device_type_config.get
//!   sazinka.device_type_config.update
//!   sazinka.device_type_field.create
//!   sazinka.device_type_field.update
//!   sazinka.device_type_field.set_active
//!   sazinka.device_type_field.reorder

use std::sync::Arc;

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::types::{ErrorResponse, Request, SuccessResponse};
use crate::types::device_type_config::{
    CreateDeviceTypeConfigRequest, CreateDeviceTypeFieldRequest, GetDeviceTypeConfigRequest,
    ListDeviceTypeConfigsRequest, ReorderFieldsRequest, SetFieldActiveRequest,
    UpdateDeviceTypeConfigRequest, UpdateDeviceTypeFieldRequest, DeviceTypeConfigListResponse,
};

// ---------------------------------------------------------------------------
// Helper: get tenant_id or respond UNAUTHORIZED
// ---------------------------------------------------------------------------
macro_rules! require_tenant {
    ($pool:expr, $user_id:expr, $client:expr, $reply:expr, $request_id:expr) => {{
        match queries::device_type_config::get_tenant_id_for_user($pool, $user_id).await {
            Ok(Some(tid)) => tid,
            Ok(None) => {
                let err = ErrorResponse::new($request_id, "TENANT_NOT_FOUND", "No tenant for this user");
                let _ = $client.publish($reply, serde_json::to_vec(&err).unwrap().into()).await;
                continue;
            }
            Err(e) => {
                error!("tenant lookup failed: {}", e);
                let err = ErrorResponse::new($request_id, "DATABASE_ERROR", e.to_string());
                let _ = $client.publish($reply, serde_json::to_vec(&err).unwrap().into()).await;
                continue;
            }
        }
    }};
}

// ---------------------------------------------------------------------------
// sazinka.device_type_config.list
// ---------------------------------------------------------------------------
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received device_type_config.list");
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => { warn!("no reply subject"); continue; }
        };

        let request: Request<ListDeviceTypeConfigsRequest> =
            match serde_json::from_slice(&msg.payload) {
                Ok(r) => r,
                Err(e) => {
                    let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }
            };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let err = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let tenant_id = require_tenant!(&pool, user_id, client, reply, request.id);

        match queries::device_type_config::list_device_type_configs(
            &pool, tenant_id, request.payload.include_inactive,
        ).await {
            Ok(items) => {
                let resp = SuccessResponse::new(request.id, DeviceTypeConfigListResponse { items });
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
            Err(e) => {
                error!("list_device_type_configs: {}", e);
                let err = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// sazinka.device_type_config.get
// ---------------------------------------------------------------------------
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received device_type_config.get");
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => { warn!("no reply subject"); continue; }
        };

        let request: Request<GetDeviceTypeConfigRequest> =
            match serde_json::from_slice(&msg.payload) {
                Ok(r) => r,
                Err(e) => {
                    let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }
            };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let err = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let tenant_id = require_tenant!(&pool, user_id, client, reply, request.id);

        match queries::device_type_config::get_device_type_config(&pool, tenant_id, request.payload.id).await {
            Ok(Some(cfg)) => {
                let resp = SuccessResponse::new(request.id, cfg);
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
            Ok(None) => {
                let err = ErrorResponse::new(request.id, "NOT_FOUND", "Device type config not found");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Err(e) => {
                error!("get_device_type_config: {}", e);
                let err = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// sazinka.device_type_config.update
// ---------------------------------------------------------------------------
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received device_type_config.update");
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => { warn!("no reply subject"); continue; }
        };

        let request: Request<UpdateDeviceTypeConfigRequest> =
            match serde_json::from_slice(&msg.payload) {
                Ok(r) => r,
                Err(e) => {
                    let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }
            };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let err = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let tenant_id = require_tenant!(&pool, user_id, client, reply, request.id);

        match queries::device_type_config::update_device_type_config(&pool, tenant_id, &request.payload).await {
            Ok(Some(cfg_with_fields)) => {
                let resp = SuccessResponse::new(request.id, cfg_with_fields);
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
            Ok(None) => {
                let err = ErrorResponse::new(request.id, "NOT_FOUND", "Device type config not found");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Err(e) => {
                error!("update_device_type_config: {}", e);
                let err = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// sazinka.device_type_config.create
// ---------------------------------------------------------------------------
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received device_type_config.create");
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => { warn!("no reply subject"); continue; }
        };

        let request: Request<CreateDeviceTypeConfigRequest> =
            match serde_json::from_slice(&msg.payload) {
                Ok(r) => r,
                Err(e) => {
                    let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }
            };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let err = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        if request.payload.label.trim().is_empty() {
            let err = ErrorResponse::new(request.id, "INVALID_REQUEST", "label is required");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        let tenant_id = require_tenant!(&pool, user_id, client, reply, request.id);

        match queries::device_type_config::create_device_type_config(&pool, tenant_id, &request.payload).await {
            Ok(Some(cfg)) => {
                let resp = SuccessResponse::new(request.id, cfg);
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
            Ok(None) => {
                let err = ErrorResponse::new(request.id, "CONFLICT", "A device type with this key already exists for your tenant");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Err(e) => {
                error!("create_device_type_config: {}", e);
                let err = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// sazinka.device_type_field.create
// ---------------------------------------------------------------------------
pub async fn handle_field_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received device_type_field.create");
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => { warn!("no reply subject"); continue; }
        };

        let request: Request<CreateDeviceTypeFieldRequest> =
            match serde_json::from_slice(&msg.payload) {
                Ok(r) => r,
                Err(e) => {
                    let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }
            };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let err = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let tenant_id = require_tenant!(&pool, user_id, client, reply, request.id);

        match queries::device_type_config::create_device_type_field(&pool, tenant_id, &request.payload).await {
            Ok(Some(field)) => {
                let resp = SuccessResponse::new(request.id, field);
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
            Ok(None) => {
                let err = ErrorResponse::new(request.id, "NOT_FOUND", "Device type config not found or not owned by tenant");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Err(e) => {
                error!("create_device_type_field: {}", e);
                let err = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// sazinka.device_type_field.update
// ---------------------------------------------------------------------------
pub async fn handle_field_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received device_type_field.update");
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => { warn!("no reply subject"); continue; }
        };

        let request: Request<UpdateDeviceTypeFieldRequest> =
            match serde_json::from_slice(&msg.payload) {
                Ok(r) => r,
                Err(e) => {
                    let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }
            };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let err = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let tenant_id = require_tenant!(&pool, user_id, client, reply, request.id);

        match queries::device_type_config::update_device_type_field(&pool, tenant_id, &request.payload).await {
            Ok(Some(field)) => {
                let resp = SuccessResponse::new(request.id, field);
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
            Ok(None) => {
                let err = ErrorResponse::new(request.id, "NOT_FOUND", "Field not found");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Err(e) => {
                error!("update_device_type_field: {}", e);
                let err = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// sazinka.device_type_field.set_active
// ---------------------------------------------------------------------------
pub async fn handle_field_set_active(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received device_type_field.set_active");
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => { warn!("no reply subject"); continue; }
        };

        let request: Request<SetFieldActiveRequest> =
            match serde_json::from_slice(&msg.payload) {
                Ok(r) => r,
                Err(e) => {
                    let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }
            };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let err = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let tenant_id = require_tenant!(&pool, user_id, client, reply, request.id);

        match queries::device_type_config::set_field_active(
            &pool, tenant_id, request.payload.id, request.payload.is_active,
        ).await {
            Ok(true) => {
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct SetActiveResponse { updated: bool }
                let resp = SuccessResponse::new(request.id, SetActiveResponse { updated: true });
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
            Ok(false) => {
                let err = ErrorResponse::new(request.id, "NOT_FOUND", "Field not found");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Err(e) => {
                error!("set_field_active: {}", e);
                let err = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// sazinka.device_type_field.reorder
// ---------------------------------------------------------------------------
pub async fn handle_field_reorder(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received device_type_field.reorder");
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => { warn!("no reply subject"); continue; }
        };

        let request: Request<ReorderFieldsRequest> =
            match serde_json::from_slice(&msg.payload) {
                Ok(r) => r,
                Err(e) => {
                    let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }
            };

        let user_id = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let err = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let tenant_id = require_tenant!(&pool, user_id, client, reply, request.id);

        match queries::device_type_config::reorder_fields(
            &pool,
            tenant_id,
            request.payload.device_type_config_id,
            &request.payload.field_ids,
        ).await {
            Ok(true) => {
                #[derive(serde::Serialize)]
                struct ReorderResponse { reordered: bool }
                let resp = SuccessResponse::new(request.id, ReorderResponse { reordered: true });
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
            Ok(false) => {
                let err = ErrorResponse::new(request.id, "NOT_FOUND", "Config not found or not owned by tenant");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Err(e) => {
                error!("reorder_fields: {}", e);
                let err = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
        }
    }
    Ok(())
}
