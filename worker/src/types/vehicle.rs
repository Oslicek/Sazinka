use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Vehicle entity - represents a vehicle/technician that can be assigned to revisions
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Vehicle {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub home_depot_id: Option<Uuid>,
    pub preferred_areas: Vec<String>,
    pub working_hours_start: NaiveTime,
    pub working_hours_end: NaiveTime,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Request to create a new vehicle
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVehicleRequest {
    pub name: String,
    pub home_depot_id: Option<Uuid>,
    #[serde(default)]
    pub preferred_areas: Vec<String>,
    pub working_hours_start: Option<NaiveTime>,
    pub working_hours_end: Option<NaiveTime>,
}

/// Request to update an existing vehicle
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVehicleRequest {
    pub id: Uuid,
    pub name: Option<String>,
    pub home_depot_id: Option<Uuid>,
    pub preferred_areas: Option<Vec<String>>,
    pub working_hours_start: Option<NaiveTime>,
    pub working_hours_end: Option<NaiveTime>,
    pub is_active: Option<bool>,
}

/// Request to list vehicles
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListVehiclesRequest {
    pub active_only: Option<bool>,
}

/// Request to delete a vehicle
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteVehicleRequest {
    pub id: Uuid,
}

/// Response for list of vehicles
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VehicleListResponse {
    pub items: Vec<Vehicle>,
    pub total: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveTime;

    #[test]
    fn test_create_vehicle_request_deserialize() {
        let json = r#"{
            "name": "Technik 1 - Petr",
            "homeDepotId": "123e4567-e89b-12d3-a456-426614174000",
            "preferredAreas": ["602", "603"],
            "workingHoursStart": "08:00:00",
            "workingHoursEnd": "17:00:00"
        }"#;

        let request: CreateVehicleRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "Technik 1 - Petr");
        assert_eq!(request.preferred_areas, vec!["602", "603"]);
        assert_eq!(request.working_hours_start, Some(NaiveTime::from_hms_opt(8, 0, 0).unwrap()));
    }

    #[test]
    fn test_create_vehicle_request_minimal() {
        let json = r#"{"name": "Auto 1"}"#;

        let request: CreateVehicleRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "Auto 1");
        assert!(request.home_depot_id.is_none());
        assert!(request.preferred_areas.is_empty());
    }

    #[test]
    fn test_update_vehicle_request_partial() {
        let json = r#"{
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "name": "Updated Name"
        }"#;

        let request: UpdateVehicleRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, Some("Updated Name".to_string()));
        assert!(request.is_active.is_none());
    }

    #[test]
    fn test_vehicle_serialize() {
        let vehicle = Vehicle {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            name: "Test Vehicle".to_string(),
            home_depot_id: None,
            preferred_areas: vec!["602".to_string()],
            working_hours_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            working_hours_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            is_active: true,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&vehicle).unwrap();
        assert!(json.contains("\"name\":\"Test Vehicle\""));
        assert!(json.contains("\"preferredAreas\":[\"602\"]"));
        assert!(json.contains("\"isActive\":true"));
    }
}
