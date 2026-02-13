//! Role handlers for NATS messages

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
    CreateRoleRequest, UpdateRoleRequest, AssignRoleRequest, UnassignRoleRequest,
    SetUserRolesRequest, ListRolesResponse, GetRoleResponse, UserRolesResponse,
};

/// Start all role-related NATS handlers
pub async fn start_handlers(client: Client, pool: PgPool, jwt_secret: Arc<String>) -> Result<()> {
    info!("Starting role handlers...");

    // Subscribe to all role subjects
    let role_create_sub = client.subscribe("sazinka.role.create").await?;
    let role_list_sub = client.subscribe("sazinka.role.list").await?;
    let role_get_sub = client.subscribe("sazinka.role.get").await?;
    let role_update_sub = client.subscribe("sazinka.role.update").await?;
    let role_delete_sub = client.subscribe("sazinka.role.delete").await?;
    let role_assign_sub = client.subscribe("sazinka.role.assign").await?;
    let role_unassign_sub = client.subscribe("sazinka.role.unassign").await?;
    let user_roles_get_sub = client.subscribe("sazinka.user.roles.get").await?;
    let user_roles_set_sub = client.subscribe("sazinka.user.roles.set").await?;

    // Spawn handlers
    tokio::spawn(handle_create(client.clone(), role_create_sub, pool.clone(), jwt_secret.clone()));
    tokio::spawn(handle_list(client.clone(), role_list_sub, pool.clone(), jwt_secret.clone()));
    tokio::spawn(handle_get(client.clone(), role_get_sub, pool.clone(), jwt_secret.clone()));
    tokio::spawn(handle_update(client.clone(), role_update_sub, pool.clone(), jwt_secret.clone()));
    tokio::spawn(handle_delete(client.clone(), role_delete_sub, pool.clone(), jwt_secret.clone()));
    tokio::spawn(handle_assign(client.clone(), role_assign_sub, pool.clone(), jwt_secret.clone()));
    tokio::spawn(handle_unassign(client.clone(), role_unassign_sub, pool.clone(), jwt_secret.clone()));
    tokio::spawn(handle_get_user_roles(client.clone(), user_roles_get_sub, pool.clone(), jwt_secret.clone()));
    tokio::spawn(handle_set_user_roles(client.clone(), user_roles_set_sub, pool.clone(), jwt_secret.clone()));

    info!("Role handlers started");
    Ok(())
}

/// Handle role.create messages
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received role.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CreateRoleRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Only customer or admin can create roles
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can create roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        let owner_id = auth_info.data_user_id();

        match queries::role::create_role(&pool, owner_id, &request.payload.name).await {
            Ok(role) => {
                // Set permissions
                if let Err(e) = queries::role::set_role_permissions(&pool, role.id, &request.payload.permissions).await {
                    error!("Failed to set role permissions: {}", e);
                    let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                    continue;
                }

                // Fetch role with permissions
                match queries::role::get_role(&pool, role.id, owner_id).await {
                    Ok(Some(role_with_perms)) => {
                        let response = SuccessResponse::new(request.id, role_with_perms);
                        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                    }
                    Ok(None) => {
                        let error = ErrorResponse::new(request.id, "NOT_FOUND", "Role not found after creation");
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                    }
                    Err(e) => {
                        error!("Failed to fetch created role: {}", e);
                        let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                    }
                }
            }
            Err(e) => {
                error!("Failed to create role: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle role.list messages
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received role.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<serde_json::Value> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can list roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        let owner_id = auth_info.data_user_id();

        match queries::role::list_roles(&pool, owner_id).await {
            Ok(roles) => {
                let response = SuccessResponse::new(request.id, ListRolesResponse { roles });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to list roles: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle role.get messages
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received role.get message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<Uuid> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can get roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        let owner_id = auth_info.data_user_id();
        let role_id = request.payload;

        match queries::role::get_role(&pool, role_id, owner_id).await {
            Ok(Some(role)) => {
                let response = SuccessResponse::new(request.id, GetRoleResponse { role });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Role not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to get role: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle role.update messages
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received role.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateRoleRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can update roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        let owner_id = auth_info.data_user_id();
        let role_id = request.payload.id;

        // Update name if provided
        if let Some(name) = &request.payload.name {
            if let Err(e) = queries::role::update_role(&pool, role_id, owner_id, name).await {
                error!("Failed to update role name: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        }

        // Update permissions if provided
        if let Some(permissions) = &request.payload.permissions {
            if let Err(e) = queries::role::set_role_permissions(&pool, role_id, permissions).await {
                error!("Failed to update role permissions: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        }

        // Fetch updated role
        match queries::role::get_role(&pool, role_id, owner_id).await {
            Ok(Some(role)) => {
                let response = SuccessResponse::new(request.id, role);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Role not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to fetch updated role: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle role.delete messages
pub async fn handle_delete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received role.delete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<Uuid> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can delete roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        let owner_id = auth_info.data_user_id();
        let role_id = request.payload;

        match queries::role::delete_role(&pool, role_id, owner_id).await {
            Ok(true) => {
                let response = SuccessResponse::new(request.id, ());
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Role not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to delete role: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle role.assign messages
pub async fn handle_assign(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received role.assign message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<AssignRoleRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can assign roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        match queries::role::assign_role_to_user(&pool, request.payload.user_id, request.payload.role_id).await {
            Ok(_) => {
                let response = SuccessResponse::new(request.id, ());
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to assign role: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle role.unassign messages
pub async fn handle_unassign(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received role.unassign message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UnassignRoleRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can unassign roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        match queries::role::unassign_role_from_user(&pool, request.payload.user_id, request.payload.role_id).await {
            Ok(true) => {
                let response = SuccessResponse::new(request.id, ());
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Role assignment not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to unassign role: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle user.roles.get messages
pub async fn handle_get_user_roles(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received user.roles.get message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<Uuid> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can get user roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        let user_id = request.payload;

        match queries::role::get_user_roles(&pool, user_id).await {
            Ok(roles) => {
                let response = SuccessResponse::new(request.id, UserRolesResponse { user_id, roles });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to get user roles: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle user.roles.set messages
pub async fn handle_set_user_roles(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received user.roles.set message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<SetUserRolesRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only company owners can set user roles");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        match queries::role::set_user_roles(&pool, request.payload.user_id, &request.payload.role_ids).await {
            Ok(_) => {
                let response = SuccessResponse::new(request.id, ());
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to set user roles: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}
