//! Device type configuration types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

// =============================================================================
// Database entities
// =============================================================================

/// A tenant-specific device type configuration (one row per type per tenant).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTypeConfig {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub device_type_key: String,
    pub label: String,
    pub icon: Option<String>,
    pub is_active: bool,
    pub is_builtin: bool,
    pub default_revision_duration_minutes: i32,
    pub default_revision_interval_months: i32,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A DeviceTypeConfig enriched with its fields (used in get/list detail responses).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTypeConfigWithFields {
    #[serde(flatten)]
    pub config: DeviceTypeConfig,
    pub fields: Vec<DeviceTypeField>,
}

/// A single configurable field belonging to a device type.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTypeField {
    pub id: Uuid,
    pub device_type_config_id: Uuid,
    pub field_key: String,
    pub label: String,
    pub field_type: String,
    pub is_required: bool,
    pub select_options: Option<serde_json::Value>,
    pub default_value: Option<String>,
    pub sort_order: i32,
    pub unit: Option<String>,
    pub placeholder: Option<String>,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Stored value of one custom field for one device.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFieldValue {
    pub id: Uuid,
    pub device_id: Uuid,
    pub field_id: Uuid,
    pub value_json: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Lightweight value used in device responses (no id/timestamps needed on FE).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFieldValueDto {
    pub field_id: Uuid,
    pub field_key: String,
    pub value: serde_json::Value,
}

// =============================================================================
// Request types
// =============================================================================

/// Request to create a new custom (non-builtin) device type config for the tenant.
/// `device_type_key` is optional — if omitted the backend generates a slug from `label`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDeviceTypeConfigRequest {
    pub label: String,
    pub device_type_key: Option<String>,
    #[serde(default = "default_duration")]
    pub default_revision_duration_minutes: i32,
    #[serde(default = "default_interval")]
    pub default_revision_interval_months: i32,
}

fn default_duration() -> i32 { 60 }
fn default_interval() -> i32 { 12 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDeviceTypeConfigsRequest {
    #[serde(default)]
    pub include_inactive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDeviceTypeConfigRequest {
    pub id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDeviceTypeConfigRequest {
    pub id: Uuid,
    pub label: Option<String>,
    pub is_active: Option<bool>,
    pub default_revision_duration_minutes: Option<i32>,
    pub default_revision_interval_months: Option<i32>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDeviceTypeFieldRequest {
    pub device_type_config_id: Uuid,
    pub field_key: String,
    pub label: String,
    pub field_type: String,
    #[serde(default)]
    pub is_required: bool,
    pub select_options: Option<serde_json::Value>,
    pub default_value: Option<String>,
    pub unit: Option<String>,
    pub placeholder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDeviceTypeFieldRequest {
    pub id: Uuid,
    pub label: Option<String>,
    pub is_required: Option<bool>,
    pub default_value: Option<String>,
    pub select_options: Option<serde_json::Value>,
    pub unit: Option<String>,
    pub placeholder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetFieldActiveRequest {
    pub id: Uuid,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderFieldsRequest {
    pub device_type_config_id: Uuid,
    /// Field IDs in the desired new order.
    pub field_ids: Vec<Uuid>,
}

// =============================================================================
// Response types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTypeConfigListResponse {
    pub items: Vec<DeviceTypeConfigWithFields>,
}

// =============================================================================
// Unit tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_type_config_serializes_camel_case() {
        let cfg = DeviceTypeConfig {
            id: Uuid::nil(),
            tenant_id: Uuid::nil(),
            device_type_key: "gas_boiler".to_string(),
            label: "Plynový kotel".to_string(),
            icon: None,
            is_active: true,
            is_builtin: true,
            default_revision_duration_minutes: 60,
            default_revision_interval_months: 12,
            sort_order: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"deviceTypeKey\""));
        assert!(json.contains("\"tenantId\""));
        assert!(json.contains("\"isActive\""));
        assert!(json.contains("\"defaultRevisionDurationMinutes\""));
        assert!(json.contains("\"gas_boiler\""));
    }

    #[test]
    fn test_device_type_field_serializes_camel_case() {
        let field = DeviceTypeField {
            id: Uuid::nil(),
            device_type_config_id: Uuid::nil(),
            field_key: "rated_power".to_string(),
            label: "Jmenovitý výkon".to_string(),
            field_type: "number".to_string(),
            is_required: false,
            select_options: None,
            default_value: None,
            sort_order: 0,
            unit: Some("kW".to_string()),
            placeholder: None,
            is_active: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&field).unwrap();
        assert!(json.contains("\"fieldKey\""));
        assert!(json.contains("\"fieldType\""));
        assert!(json.contains("\"isRequired\""));
        assert!(json.contains("\"deviceTypeConfigId\""));
    }

    #[test]
    fn test_update_request_allows_partial_fields() {
        let json = r#"{"id":"00000000-0000-0000-0000-000000000000","label":"New Label"}"#;
        let req: UpdateDeviceTypeConfigRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.label, Some("New Label".to_string()));
        assert!(req.is_active.is_none());
        assert!(req.default_revision_duration_minutes.is_none());
    }

    #[test]
    fn test_reorder_request_parses_field_ids() {
        let id1 = Uuid::new_v4();
        let id2 = Uuid::new_v4();
        let json = format!(
            r#"{{"deviceTypeConfigId":"00000000-0000-0000-0000-000000000000","fieldIds":["{id1}","{id2}"]}}"#
        );
        let req: ReorderFieldsRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(req.field_ids.len(), 2);
        assert_eq!(req.field_ids[0], id1);
    }

    #[test]
    fn test_set_field_active_request() {
        let json = r#"{"id":"00000000-0000-0000-0000-000000000000","isActive":false}"#;
        let req: SetFieldActiveRequest = serde_json::from_str(json).unwrap();
        assert!(!req.is_active);
    }
}
