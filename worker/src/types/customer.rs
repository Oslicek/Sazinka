//! Customer types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Customer entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Customer {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    
    // Address
    pub street: String,
    pub city: String,
    pub postal_code: String,
    pub country: String,
    
    // Coordinates (from geocoding)
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Request to create a customer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateCustomerRequest {
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub street: String,
    pub city: String,
    pub postal_code: String,
    pub country: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub notes: Option<String>,
}

/// Request to update a customer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCustomerRequest {
    pub id: Uuid,
    pub name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub notes: Option<String>,
}

/// Coordinates
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Coordinates {
    pub lat: f64,
    pub lng: f64,
}
