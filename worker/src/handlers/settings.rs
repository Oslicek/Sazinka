//! Settings message handlers

use std::sync::Arc;
use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::services::geocoding::Geocoder;
use crate::types::{
    EmptyPayload, ErrorResponse, Request, SuccessResponse,
    CreateDepotRequest, UpdateDepotRequest, DeleteDepotRequest,
    ListDepotsResponse, UserSettings,
    UpdateWorkConstraintsRequest, UpdateBusinessInfoRequest, UpdateEmailTemplatesRequest,
    UpdatePreferencesRequest, UpdateBreakSettingsRequest,
};

// ============================================================================
// Settings Get Handler
// ============================================================================

/// Handle settings.get messages - returns all user settings including depots
pub async fn handle_get_settings(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received settings.get message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request (empty payload)
        let request: Request<EmptyPayload> = match serde_json::from_slice(&msg.payload) {
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
        // Settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        // Get user settings
        match queries::settings::get_user_settings(&pool, user_id).await {
            Ok(Some(user)) => {
                // Get depots
                let depots = queries::settings::list_depots(&pool, user_id).await
                    .unwrap_or_default();

                let settings = UserSettings {
                    work_constraints: user.to_work_constraints(),
                    business_info: user.to_business_info(),
                    email_templates: user.to_email_templates(),
                    preferences: user.to_preferences(),
                    break_settings: user.to_break_settings(),
                    depots,
                };

                let response = SuccessResponse::new(request.id, settings);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to get settings: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// ============================================================================
// Work Constraints Handler
// ============================================================================

/// Handle settings.work.update messages
pub async fn handle_update_work_constraints(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received settings.work.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateWorkConstraintsRequest> = match serde_json::from_slice(&msg.payload) {
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
        // Settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        // Update work constraints
        match queries::settings::update_work_constraints(&pool, user_id, &request.payload).await {
            Ok(()) => {
                // Return updated settings
                if let Ok(Some(user)) = queries::settings::get_user_settings(&pool, user_id).await {
                    let response = SuccessResponse::new(request.id, user.to_work_constraints());
                    let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                } else {
                    let error = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User not found");
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                }
            }
            Err(e) => {
                error!("Failed to update work constraints: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// ============================================================================
// Business Info Handler
// ============================================================================

/// Handle settings.business.update messages
pub async fn handle_update_business_info(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received settings.business.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateBusinessInfoRequest> = match serde_json::from_slice(&msg.payload) {
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
        // Settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        // Update business info
        match queries::settings::update_business_info(&pool, user_id, &request.payload).await {
            Ok(()) => {
                // Return updated settings
                if let Ok(Some(user)) = queries::settings::get_user_settings(&pool, user_id).await {
                    let response = SuccessResponse::new(request.id, user.to_business_info());
                    let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                } else {
                    let error = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User not found");
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                }
            }
            Err(e) => {
                error!("Failed to update business info: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// ============================================================================
// Email Templates Handler
// ============================================================================

/// Handle settings.email.update messages
pub async fn handle_update_email_templates(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received settings.email.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateEmailTemplatesRequest> = match serde_json::from_slice(&msg.payload) {
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
        // Settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        // Update email templates
        match queries::settings::update_email_templates(&pool, user_id, &request.payload).await {
            Ok(()) => {
                // Return updated settings
                if let Ok(Some(user)) = queries::settings::get_user_settings(&pool, user_id).await {
                    let response = SuccessResponse::new(request.id, user.to_email_templates());
                    let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                } else {
                    let error = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User not found");
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                }
            }
            Err(e) => {
                error!("Failed to update email templates: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// ============================================================================
// Depot Handlers
// ============================================================================

/// Handle depot.list messages
pub async fn handle_list_depots(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received depot.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<EmptyPayload> = match serde_json::from_slice(&msg.payload) {
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
        // Settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        match queries::settings::list_depots(&pool, user_id).await {
            Ok(depots) => {
                let response = SuccessResponse::new(request.id, ListDepotsResponse { depots });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to list depots: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle depot.create messages
pub async fn handle_create_depot(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
    _geocoder: Arc<dyn Geocoder>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received depot.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CreateDepotRequest> = match serde_json::from_slice(&msg.payload) {
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
        // Settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        match queries::settings::create_depot(&pool, user_id, &request.payload).await {
            Ok(depot) => {
                let response = SuccessResponse::new(request.id, depot);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Created depot: {}", response.payload.id);
            }
            Err(e) => {
                error!("Failed to create depot: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle depot.update messages
pub async fn handle_update_depot(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received depot.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateDepotRequest> = match serde_json::from_slice(&msg.payload) {
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
        // Settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        match queries::settings::update_depot(&pool, user_id, &request.payload).await {
            Ok(Some(depot)) => {
                let response = SuccessResponse::new(request.id, depot);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "DEPOT_NOT_FOUND", "Depot not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to update depot: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle depot.delete messages
pub async fn handle_delete_depot(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received depot.delete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<DeleteDepotRequest> = match serde_json::from_slice(&msg.payload) {
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
        // Settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        match queries::settings::delete_depot(&pool, request.payload.id, user_id).await {
            Ok(true) => {
                let response = SuccessResponse::new(request.id, serde_json::json!({ "deleted": true }));
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "DEPOT_NOT_FOUND", "Depot not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to delete depot: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle depot.geocode messages - geocode address for depot
pub async fn handle_geocode_depot(
    client: Client,
    mut subscriber: Subscriber,
    geocoder: Arc<dyn Geocoder>,
    _jwt_secret: Arc<String>,
) -> Result<()> {
    use crate::types::Coordinates;

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GeocodeDepotRequest {
        street: String,
        city: String,
        postal_code: String,
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct GeocodeDepotResponse {
        coordinates: Option<Coordinates>,
        display_name: Option<String>,
        geocoded: bool,
    }

    while let Some(msg) = subscriber.next().await {
        debug!("Received depot.geocode message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<GeocodeDepotRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Geocode the address
        let result = geocoder.geocode(
            &request.payload.street,
            &request.payload.city,
            &request.payload.postal_code,
        ).await;

        match result {
            Ok(Some(geo_result)) => {
                let response = SuccessResponse::new(request.id, GeocodeDepotResponse {
                    coordinates: Some(Coordinates {
                        lat: geo_result.coordinates.lat,
                        lng: geo_result.coordinates.lng,
                    }),
                    display_name: Some(geo_result.display_name),
                    geocoded: true,
                });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let response = SuccessResponse::new(request.id, GeocodeDepotResponse {
                    coordinates: None,
                    display_name: None,
                    geocoded: false,
                });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to geocode depot address: {}", e);
                let error = ErrorResponse::new(request.id, "GEOCODING_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// ============================================================================
// Preferences Handler
// ============================================================================

/// Handle settings.preferences.update messages
pub async fn handle_update_preferences(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received settings.preferences.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdatePreferencesRequest> = match serde_json::from_slice(&msg.payload) {
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
        let user_id = auth_info.user_id;

        match queries::settings::update_preferences(&pool, user_id, &request.payload).await {
            Ok(_) => {
                let response = SuccessResponse::new(request.id, EmptyPayload {});
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to update preferences: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// ============================================================================
// Update Break Settings Handler
// ============================================================================

/// Handle settings.break.update messages
pub async fn handle_update_break_settings(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received settings.break.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<UpdateBreakSettingsRequest> = match serde_json::from_slice(&msg.payload) {
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
        // Break settings require customer or admin role
        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Break settings access requires customer or admin role");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
        let user_id = auth_info.data_user_id();

        match queries::settings::update_break_settings(&pool, user_id, &request.payload).await {
            Ok(_) => {
                if let Ok(Some(user)) = queries::settings::get_user_settings(&pool, user_id).await {
                    let response = SuccessResponse::new(request.id, user.to_break_settings());
                    let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                } else {
                    let error = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User not found");
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                }
            }
            Err(e) => {
                error!("Failed to update break settings: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}
