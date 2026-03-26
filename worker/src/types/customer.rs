#![allow(dead_code)]
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
    pub name: Option<String>,
    pub contact_person: Option<String>,
    pub ico: Option<String>,
    pub dic: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub phone_raw: Option<String>,
    
    // Address
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    
    // Coordinates (from geocoding)
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    
    // Geocoding status: 'pending', 'success', 'failed'
    pub geocode_status: String,
    
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,

    // Lifecycle fields (Phase 1)
    #[sqlx(default)]
    pub is_abandoned: bool,
    #[sqlx(default)]
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Request to create a customer
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerRequest {
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
    pub name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
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

/// Single sort entry for server-side multi-column ordering.
/// `column` is the frontend catalog ID (e.g. "name", "email").
/// `direction` is "asc" or "desc"; validated in the order builder, not at serde layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortEntry {
    pub column: String,
    pub direction: String,
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
    /// Multi-level sort model sent from the frontend.
    /// When present and non-empty (after filtering invalid entries), takes
    /// precedence over the legacy sort_by/sort_order fields.
    pub sort_model: Option<Vec<SortEntry>>,
    /// Legacy: sort by field: "name", "nextRevision", "deviceCount", "city", "createdAt"
    pub sort_by: Option<String>,
    /// Legacy: sort order: "asc", "desc"
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

#[cfg(test)]
mod tests {
    use super::*;

    // ── SortEntry serde ──────────────────────────────────────────────────────

    #[test]
    fn sort_entry_deserializes_valid_json() {
        let json = r#"{"column":"name","direction":"asc"}"#;
        let entry: SortEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.column, "name");
        assert_eq!(entry.direction, "asc");
    }

    #[test]
    fn sort_entry_deserializes_desc_direction() {
        let json = r#"{"column":"city","direction":"desc"}"#;
        let entry: SortEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.column, "city");
        assert_eq!(entry.direction, "desc");
    }

    #[test]
    fn sort_entry_direction_is_string_arbitrary_values_accepted_by_serde() {
        // direction is String, not enum; serde accepts arbitrary values.
        // Validation happens in build_order_by, not here.
        let json = r#"{"column":"name","direction":"invalid"}"#;
        let entry: SortEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.direction, "invalid");
    }

    #[test]
    fn sort_entry_serializes_with_camel_case_keys() {
        let entry = SortEntry {
            column: "name".to_string(),
            direction: "asc".to_string(),
        };
        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("\"column\""));
        assert!(json.contains("\"direction\""));
    }

    // ── ListCustomersRequest sort_model field ────────────────────────────────

    #[test]
    fn list_customers_request_deserializes_sort_model_field() {
        let json = r#"{
            "sortModel": [
                {"column": "name", "direction": "asc"},
                {"column": "city", "direction": "desc"}
            ]
        }"#;
        let req: ListCustomersRequest = serde_json::from_str(json).unwrap();
        let model = req.sort_model.expect("sort_model should be present");
        assert_eq!(model.len(), 2);
        assert_eq!(model[0].column, "name");
        assert_eq!(model[0].direction, "asc");
        assert_eq!(model[1].column, "city");
        assert_eq!(model[1].direction, "desc");
    }

    #[test]
    fn list_customers_request_sort_model_none_when_absent() {
        let json = r#"{"limit": 50}"#;
        let req: ListCustomersRequest = serde_json::from_str(json).unwrap();
        assert!(req.sort_model.is_none());
    }

    #[test]
    fn list_customers_request_sort_model_empty_array_deserializes() {
        let json = r#"{"sortModel": []}"#;
        let req: ListCustomersRequest = serde_json::from_str(json).unwrap();
        let model = req.sort_model.expect("sort_model should be present");
        assert!(model.is_empty());
    }

    // ── Backward compat — legacy sort_by / sort_order ────────────────────────

    #[test]
    fn list_customers_request_deserializes_legacy_sort_by_only() {
        let json = r#"{"sortBy": "city", "sortOrder": "desc"}"#;
        let req: ListCustomersRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.sort_by.as_deref(), Some("city"));
        assert_eq!(req.sort_order.as_deref(), Some("desc"));
        assert!(req.sort_model.is_none());
    }

    #[test]
    fn list_customers_request_both_legacy_and_new_fields_deserialized() {
        let json = r#"{
            "sortBy": "city",
            "sortOrder": "desc",
            "sortModel": [{"column": "name", "direction": "asc"}]
        }"#;
        let req: ListCustomersRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.sort_by.as_deref(), Some("city"));
        assert!(req.sort_model.is_some());
        let model = req.sort_model.unwrap();
        assert_eq!(model[0].column, "name");
    }

    #[test]
    fn list_customers_request_deserializes_all_filter_fields_alongside_sort_model() {
        let json = r#"{
            "limit": 25,
            "offset": 50,
            "search": "test",
            "geocodeStatus": "success",
            "hasOverdue": true,
            "customerType": "company",
            "sortModel": [{"column": "createdAt", "direction": "desc"}]
        }"#;
        let req: ListCustomersRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.limit, Some(25));
        assert_eq!(req.offset, Some(50));
        assert_eq!(req.search.as_deref(), Some("test"));
        assert_eq!(req.geocode_status.as_deref(), Some("success"));
        assert_eq!(req.has_overdue, Some(true));
        assert_eq!(req.customer_type.as_deref(), Some("company"));
        let model = req.sort_model.unwrap();
        assert_eq!(model[0].column, "createdAt");
    }
}
