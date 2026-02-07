//! Customer message handlers

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
    CreateCustomerRequest, UpdateCustomerRequest, Customer, ErrorResponse, ListRequest, 
    ListResponse, Request, SuccessResponse,
    ListCustomersRequest, CustomerListResponse, CustomerSummaryResponse,
};

/// Handle customer.create messages
/// 
/// If lat/lng are not provided in the request, the handler will attempt
/// to geocode the address automatically.
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<CreateCustomerRequest> = match serde_json::from_slice(&msg.payload) {
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

        // Create customer
        match queries::customer::create_customer(&pool, user_id, &request.payload).await {
            Ok(customer) => {
                let response = SuccessResponse::new(request.id, customer);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Created customer: {}", response.payload.id);
            }
            Err(e) => {
                error!("Failed to create customer: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}


/// Handle customer.list messages
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<ListRequest> = match serde_json::from_slice(&msg.payload) {
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

        // List customers
        match queries::customer::list_customers(
            &pool,
            user_id,
            request.payload.limit,
            request.payload.offset,
        ).await {
            Ok(customers) => {
                let response = SuccessResponse::new(
                    request.id,
                    ListResponse {
                        total: customers.len() as i64, // TODO: proper count query
                        items: customers,
                        limit: request.payload.limit,
                        offset: request.payload.offset,
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Listed {} customers", response.payload.items.len());
            }
            Err(e) => {
                error!("Failed to list customers: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle customer.get messages
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    #[derive(serde::Deserialize)]
    struct GetRequest {
        id: Uuid,
    }

    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.get message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<GetRequest> = match serde_json::from_slice(&msg.payload) {
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

        // Get customer
        match queries::customer::get_customer(&pool, user_id, request.payload.id).await {
            Ok(Some(customer)) => {
                let response = SuccessResponse::new(request.id, customer);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Got customer: {}", response.payload.id);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Customer not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to get customer: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle customer.update messages
pub async fn handle_update(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.update message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<UpdateCustomerRequest> = match serde_json::from_slice(&msg.payload) {
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

        // Prepare update request - if address changed and no coordinates provided, reset coords
        let mut update_request = request.payload.clone();
        
        let address_changed = update_request.street.is_some() 
            || update_request.city.is_some() 
            || update_request.postal_code.is_some();
        
        if address_changed && update_request.lat.is_none() && update_request.lng.is_none() {
            debug!("Address changed without coordinates, clearing coords and marking pending");
            if let Err(e) = queries::customer::reset_customer_coordinates(&pool, user_id, update_request.id).await {
                warn!("Failed to reset coordinates for customer {}: {}", update_request.id, e);
            }
        }

        // Update customer
        match queries::customer::update_customer(&pool, user_id, &update_request).await {
            Ok(Some(customer)) => {
                let response = SuccessResponse::new(request.id, customer);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Updated customer: {}", response.payload.id);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Customer not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to update customer: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Delete response payload
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResponse {
    pub deleted: bool,
}

/// Request for random customers
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomCustomersRequest {
    pub limit: i64,
}

/// Handle customer.random messages - get random customers with coordinates
pub async fn handle_random(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.random message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<RandomCustomersRequest> = match serde_json::from_slice(&msg.payload) {
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

        // Get random customers
        match queries::customer::get_random_customers_with_coords(&pool, user_id, request.payload.limit).await {
            Ok(customers) => {
                let response = SuccessResponse::new(request.id, customers);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Got {} random customers with coordinates", response.payload.len());
            }
            Err(e) => {
                error!("Failed to get random customers: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle customer.delete messages
pub async fn handle_delete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    #[derive(serde::Deserialize)]
    struct DeleteRequest {
        id: Uuid,
    }

    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.delete message");

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

        // Delete customer
        match queries::customer::delete_customer(&pool, user_id, request.payload.id).await {
            Ok(deleted) => {
                if deleted {
                    let response = SuccessResponse::new(request.id, DeleteResponse { deleted: true });
                    let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                    debug!("Deleted customer: {}", request.payload.id);
                } else {
                    let error = ErrorResponse::new(request.id, "NOT_FOUND", "Customer not found");
                    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                }
            }
            Err(e) => {
                error!("Failed to delete customer: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// ============================================================================
// Extended Customer Handlers
// ============================================================================

/// Handle customer.list.extended messages - list customers with aggregated data
pub async fn handle_list_extended(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.list.extended message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<ListCustomersRequest> = match serde_json::from_slice(&msg.payload) {
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

        // List customers with extended data
        match queries::customer::list_customers_extended(&pool, user_id, &request.payload).await {
            Ok((items, total)) => {
                let response = SuccessResponse::new(
                    request.id,
                    CustomerListResponse { items, total },
                );
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Listed {} customers (total: {})", response.payload.items.len(), total);
            }
            Err(e) => {
                error!("Failed to list customers extended: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle customer.summary messages - get customer summary statistics
pub async fn handle_summary(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    // Empty request payload
    #[derive(serde::Deserialize, Default)]
    struct SummaryRequest {}

    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.summary message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<SummaryRequest> = match serde_json::from_slice(&msg.payload) {
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

        // Get customer summary
        match queries::customer::get_customer_summary(&pool, user_id).await {
            Ok(summary) => {
                let response = SuccessResponse::new(request.id, summary);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Got customer summary: {} customers, {} devices", 
                    response.payload.total_customers, response.payload.total_devices);
            }
            Err(e) => {
                error!("Failed to get customer summary: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}
