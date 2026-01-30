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
    pub device_type: String,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub installation_date: Option<NaiveDate>,
    pub revision_interval_months: i32,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Device types enum
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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
