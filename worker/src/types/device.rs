//! Device types

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Device entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: Uuid,
    pub customer_id: Uuid,
    pub user_id: Uuid,
    pub device_type: String,
    pub device_name: Option<String>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub installation_date: Option<NaiveDate>,
    pub revision_interval_months: i32,
    pub next_due_date: Option<NaiveDate>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Device types enum
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "device_type", rename_all = "snake_case")]
pub enum DeviceType {
    GasBoiler,
    GasWaterHeater,
    Chimney,
    Fireplace,
    GasStove,
    Other,
}

impl DeviceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeviceType::GasBoiler => "gas_boiler",
            DeviceType::GasWaterHeater => "gas_water_heater",
            DeviceType::Chimney => "chimney",
            DeviceType::Fireplace => "fireplace",
            DeviceType::GasStove => "gas_stove",
            DeviceType::Other => "other",
        }
    }
}

/// Request to create a device
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDeviceRequest {
    pub customer_id: Uuid,
    pub device_type: String,
    pub device_name: Option<String>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub installation_date: Option<NaiveDate>,
    #[serde(default = "default_revision_interval")]
    pub revision_interval_months: i32,
    pub notes: Option<String>,
}

fn default_revision_interval() -> i32 {
    12
}

/// Request to update a device
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDeviceRequest {
    pub id: Uuid,
    pub device_type: Option<String>,
    pub device_name: Option<String>,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub installation_date: Option<NaiveDate>,
    pub revision_interval_months: Option<i32>,
    pub notes: Option<String>,
}

/// Request to list devices
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDevicesRequest {
    pub customer_id: Uuid,
}

/// Request to get or delete a device
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdRequest {
    pub id: Uuid,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_has_new_fields() {
        let device = Device {
            id: Uuid::nil(),
            customer_id: Uuid::nil(),
            user_id: Uuid::nil(),
            device_type: "gas_boiler".to_string(),
            device_name: Some("Kotel v kuchyni".to_string()),
            manufacturer: None,
            model: None,
            serial_number: None,
            installation_date: None,
            revision_interval_months: 12,
            next_due_date: Some(NaiveDate::from_ymd_opt(2027, 1, 1).unwrap()),
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&device).unwrap();
        assert!(json.contains("\"deviceName\":\"Kotel v kuchyni\""));
        assert!(json.contains("\"userId\""));
        assert!(json.contains("\"nextDueDate\""));
        assert!(json.contains("\"updatedAt\""));
    }

    #[test]
    fn test_device_serialize_camel_case() {
        let device = Device {
            id: Uuid::nil(),
            customer_id: Uuid::nil(),
            user_id: Uuid::nil(),
            device_type: "chimney".to_string(),
            device_name: None,
            manufacturer: None,
            model: None,
            serial_number: Some("CH-123".to_string()),
            installation_date: None,
            revision_interval_months: 24,
            next_due_date: None,
            notes: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&device).unwrap();
        assert!(json.contains("\"customerId\""));
        assert!(json.contains("\"deviceType\""));
        assert!(json.contains("\"serialNumber\""));
        assert!(json.contains("\"revisionIntervalMonths\""));
    }

    #[test]
    fn test_create_device_request_with_device_name() {
        let json = r#"{
            "customerId": "123e4567-e89b-12d3-a456-426614174000",
            "deviceType": "gas_boiler",
            "deviceName": "Kotel v kuchyni",
            "serialNumber": "SN-001"
        }"#;

        let req: CreateDeviceRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.device_name, Some("Kotel v kuchyni".to_string()));
        assert_eq!(req.revision_interval_months, 12); // default
    }

    #[test]
    fn test_create_device_request_without_device_name() {
        let json = r#"{
            "customerId": "123e4567-e89b-12d3-a456-426614174000",
            "deviceType": "chimney"
        }"#;

        let req: CreateDeviceRequest = serde_json::from_str(json).unwrap();
        assert!(req.device_name.is_none());
    }

    #[test]
    fn test_update_device_request_with_device_name() {
        let json = r#"{
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "deviceName": "Nový název"
        }"#;

        let req: UpdateDeviceRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.device_name, Some("Nový název".to_string()));
        assert!(req.device_type.is_none());
    }

    #[test]
    fn test_device_type_enum_serde() {
        let types = vec![
            (DeviceType::GasBoiler, "gas_boiler"),
            (DeviceType::GasWaterHeater, "gas_water_heater"),
            (DeviceType::Chimney, "chimney"),
            (DeviceType::Fireplace, "fireplace"),
            (DeviceType::GasStove, "gas_stove"),
            (DeviceType::Other, "other"),
        ];

        for (dt, expected_str) in types {
            assert_eq!(dt.as_str(), expected_str);
            let json = serde_json::to_string(&dt).unwrap();
            assert_eq!(json, format!("\"{}\"", expected_str));
            let deserialized: DeviceType = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized.as_str(), expected_str);
        }
    }
}
