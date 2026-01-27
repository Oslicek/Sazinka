//! Customer message handlers

use std::sync::Arc;
use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn, info};
use uuid::Uuid;

use crate::db::queries;
use crate::services::geocoding::{Geocoder, GeocodingResult};
use crate::types::{
    CreateCustomerRequest, UpdateCustomerRequest, Customer, ErrorResponse, ListRequest, 
    ListResponse, Request, SuccessResponse, Coordinates,
};

/// Handle customer.create messages
/// 
/// If lat/lng are not provided in the request, the handler will attempt
/// to geocode the address automatically.
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    geocoder: Arc<dyn Geocoder>,
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

        // Check user_id
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Prepare request with geocoding if needed
        let mut create_request = request.payload.clone();
        
        // If coordinates not provided, try to geocode
        if create_request.lat.is_none() || create_request.lng.is_none() {
            debug!("Coordinates not provided, attempting geocoding");
            
            match geocoder.geocode(
                &create_request.street,
                &create_request.city,
                &create_request.postal_code,
            ).await {
                Ok(Some(result)) => {
                    info!("Geocoded address: {} -> ({}, {})", 
                        result.display_name, result.coordinates.lat, result.coordinates.lng);
                    create_request.lat = Some(result.coordinates.lat);
                    create_request.lng = Some(result.coordinates.lng);
                }
                Ok(None) => {
                    debug!("Could not geocode address, proceeding without coordinates");
                }
                Err(e) => {
                    warn!("Geocoding failed: {}, proceeding without coordinates", e);
                }
            }
        }

        // Create customer
        match queries::customer::create_customer(&pool, user_id, &create_request).await {
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

/// Request payload for geocoding
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodeRequest {
    pub street: String,
    pub city: String,
    pub postal_code: String,
}

/// Response payload for geocoding
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeocodeResponse {
    pub coordinates: Option<Coordinates>,
    pub confidence: Option<f64>,
    pub display_name: Option<String>,
    pub geocoded: bool,
}

/// Handle customer.geocode messages
/// 
/// This endpoint allows the frontend to geocode an address without creating
/// a customer. Useful for showing the location on a map before saving.
pub async fn handle_geocode(
    client: Client,
    mut subscriber: Subscriber,
    geocoder: Arc<dyn Geocoder>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received customer.geocode message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: Request<GeocodeRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse geocode request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Geocode the address
        match geocoder.geocode(
            &request.payload.street,
            &request.payload.city,
            &request.payload.postal_code,
        ).await {
            Ok(Some(result)) => {
                let response = SuccessResponse::new(request.id, GeocodeResponse {
                    coordinates: Some(result.coordinates),
                    confidence: Some(result.confidence),
                    display_name: Some(result.display_name),
                    geocoded: true,
                });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Geocoded address successfully");
            }
            Ok(None) => {
                let response = SuccessResponse::new(request.id, GeocodeResponse {
                    coordinates: None,
                    confidence: None,
                    display_name: None,
                    geocoded: false,
                });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Address could not be geocoded");
            }
            Err(e) => {
                error!("Geocoding failed: {}", e);
                let error = ErrorResponse::new(request.id, "GEOCODING_ERROR", e.to_string());
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

        // Check user_id
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
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

        // Check user_id
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
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
    geocoder: Arc<dyn Geocoder>,
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

        // Check user_id
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Prepare update request - if address changed and no coordinates provided, geocode
        let mut update_request = request.payload.clone();
        
        let address_changed = update_request.street.is_some() 
            || update_request.city.is_some() 
            || update_request.postal_code.is_some();
        
        if address_changed && update_request.lat.is_none() && update_request.lng.is_none() {
            // Get current customer to merge address fields
            if let Ok(Some(current)) = queries::customer::get_customer(&pool, user_id, update_request.id).await {
                let street = update_request.street.as_ref().unwrap_or(&current.street);
                let city = update_request.city.as_ref().unwrap_or(&current.city);
                let postal_code = update_request.postal_code.as_ref().unwrap_or(&current.postal_code);
                
                debug!("Address changed, attempting geocoding");
                match geocoder.geocode(street, city, postal_code).await {
                    Ok(Some(result)) => {
                        info!("Geocoded updated address: {} -> ({}, {})", 
                            result.display_name, result.coordinates.lat, result.coordinates.lng);
                        update_request.lat = Some(result.coordinates.lat);
                        update_request.lng = Some(result.coordinates.lng);
                    }
                    Ok(None) => {
                        debug!("Could not geocode address, coordinates unchanged");
                    }
                    Err(e) => {
                        warn!("Geocoding failed: {}, coordinates unchanged", e);
                    }
                }
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

/// Handle customer.delete messages
pub async fn handle_delete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
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

        // Check user_id
        let user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
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
