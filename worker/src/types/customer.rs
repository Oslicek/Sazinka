//! Customer types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use uuid::Uuid;

/// Customer type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[sqlx(type_name = "customer_type", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum CustomerType {
    Person,
    Company,
}

impl Default for CustomerType {
    fn default() -> Self {
        CustomerType::Person
    }
}

/// Customer entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: Uuid,
    pub user_id: Uuid,
    #[sqlx(rename = "customer_type")]
    #[serde(rename = "type")]
    pub customer_type: CustomerType,
    pub name: String,
    pub contact_person: Option<String>,
    pub ico: Option<String>,
    pub dic: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub phone_raw: Option<String>,
    
    // Address
    pub street: String,
    pub city: String,
    pub postal_code: String,
    pub country: String,
    
    // Coordinates (from geocoding)
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    
    // Geocoding status: 'pending', 'success', 'failed'
    pub geocode_status: String,
    
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Request to create a customer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerRequest {
    #[serde(rename = "type")]
    pub customer_type: Option<CustomerType>,
    pub name: String,
    pub contact_person: Option<String>,
    pub ico: Option<String>,
    pub dic: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub phone_raw: Option<String>,
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
#[serde(rename_all = "camelCase")]
pub struct UpdateCustomerRequest {
    pub id: Uuid,
    #[serde(rename = "type")]
    pub customer_type: Option<CustomerType>,
    pub name: Option<String>,
    pub contact_person: Option<String>,
    pub ico: Option<String>,
    pub dic: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub phone_raw: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub notes: Option<String>,
}

/// Coordinates
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coordinates {
    pub lat: f64,
    pub lng: f64,
}
