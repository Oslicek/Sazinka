//! Customer types

use chrono::{DateTime, NaiveDate, Utc};
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

// ============================================================================
// Extended Customer Types for List Views
// ============================================================================

/// Customer list item with aggregated data (device count, next revision, etc.)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomerListItem {
    pub id: Uuid,
    pub user_id: Uuid,
    #[sqlx(rename = "customer_type")]
    #[serde(rename = "type")]
    pub customer_type: CustomerType,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub street: String,
    pub city: String,
    pub postal_code: String,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub geocode_status: String,
    pub created_at: DateTime<Utc>,
    
    // Aggregated fields
    pub device_count: i64,
    pub next_revision_date: Option<NaiveDate>,
    pub overdue_count: i64,
    pub never_serviced_count: i64,
}

/// Request for listing customers with filters and sorting
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListCustomersRequest {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
    pub search: Option<String>,
    /// Filter by geocode status: "success", "pending", "failed"
    pub geocode_status: Option<String>,
    /// Filter to customers with overdue revisions
    pub has_overdue: Option<bool>,
    /// Filter to customers with next revision within N days
    pub next_revision_within_days: Option<i32>,
    /// Filter by customer type: "person", "company"
    pub customer_type: Option<String>,
    /// Sort by field: "name", "nextRevision", "deviceCount", "city", "createdAt"
    pub sort_by: Option<String>,
    /// Sort order: "asc", "desc"
    pub sort_order: Option<String>,
}

/// Response for customer list with pagination
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerListResponse {
    pub items: Vec<CustomerListItem>,
    pub total: i64,
}

/// Customer summary statistics
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomerSummaryResponse {
    pub total_customers: i64,
    pub total_devices: i64,
    pub revisions_overdue: i64,
    pub revisions_due_this_week: i64,
    pub revisions_scheduled: i64,
    pub geocode_success: i64,
    pub geocode_pending: i64,
    pub geocode_failed: i64,
    pub customers_without_phone: i64,
    pub customers_without_email: i64,
    /// Number of customers with at least one overdue device
    pub customers_with_overdue: i64,
    /// Number of customers with at least one never-serviced device
    pub customers_never_serviced: i64,
}
