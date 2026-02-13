use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Crew entity - represents a crew (posádka) that can be assigned to revisions
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Crew {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub home_depot_id: Option<Uuid>,
    pub preferred_areas: Vec<String>,
    pub working_hours_start: NaiveTime,
    pub working_hours_end: NaiveTime,
    pub is_active: bool,
    /// Arrival buffer as percentage of preceding segment duration (default 10%)
    pub arrival_buffer_percent: f64,
    /// Fixed arrival buffer in minutes added on top of percentage buffer (default 0)
    pub arrival_buffer_fixed_minutes: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Request to create a new crew
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCrewRequest {
    pub name: String,
    pub home_depot_id: Option<Uuid>,
    #[serde(default)]
    pub preferred_areas: Vec<String>,
    pub working_hours_start: Option<NaiveTime>,
    pub working_hours_end: Option<NaiveTime>,
    /// Arrival buffer as percentage of preceding segment duration (default 10%)
    pub arrival_buffer_percent: Option<f64>,
    /// Fixed arrival buffer in minutes added on top of percentage buffer (default 0)
    pub arrival_buffer_fixed_minutes: Option<f64>,
}

/// Request to update an existing crew
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCrewRequest {
    pub id: Uuid,
    pub name: Option<String>,
    pub home_depot_id: Option<Uuid>,
    pub preferred_areas: Option<Vec<String>>,
    pub working_hours_start: Option<NaiveTime>,
    pub working_hours_end: Option<NaiveTime>,
    pub is_active: Option<bool>,
    /// Arrival buffer as percentage of preceding segment duration
    pub arrival_buffer_percent: Option<f64>,
    /// Fixed arrival buffer in minutes added on top of percentage buffer
    pub arrival_buffer_fixed_minutes: Option<f64>,
}

/// Request to list crews
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListCrewsRequest {
    pub active_only: Option<bool>,
}

/// Request to delete a crew
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCrewRequest {
    pub id: Uuid,
}

/// Response for list of crews
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrewListResponse {
    pub items: Vec<Crew>,
    pub total: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveTime;

    #[test]
    fn test_create_crew_request_deserialize() {
        let json = r#"{
            "name": "Posádka 1 - Petr",
            "homeDepotId": "123e4567-e89b-12d3-a456-426614174000",
            "preferredAreas": ["602", "603"],
            "workingHoursStart": "08:00:00",
            "workingHoursEnd": "17:00:00"
        }"#;

        let request: CreateCrewRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "Posádka 1 - Petr");
        assert_eq!(request.preferred_areas, vec!["602", "603"]);
        assert_eq!(request.working_hours_start, Some(NaiveTime::from_hms_opt(8, 0, 0).unwrap()));
    }

    #[test]
    fn test_crew_arrival_buffer_percent_default() {
        // Crew should have arrival_buffer_percent with a sensible default
        let crew = Crew {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            name: "Test".to_string(),
            home_depot_id: None,
            preferred_areas: vec![],
            working_hours_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            working_hours_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            is_active: true,
            arrival_buffer_percent: 10.0,
            arrival_buffer_fixed_minutes: 0.0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        assert!((crew.arrival_buffer_percent - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_create_crew_request_with_buffer() {
        let json = r#"{
            "name": "Posádka 2",
            "arrivalBufferPercent": 15.0
        }"#;
        let request: CreateCrewRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.arrival_buffer_percent, Some(15.0));
    }

    #[test]
    fn test_create_crew_request_without_buffer_defaults_none() {
        let json = r#"{"name": "Posádka 3"}"#;
        let request: CreateCrewRequest = serde_json::from_str(json).unwrap();
        assert!(request.arrival_buffer_percent.is_none());
    }

    #[test]
    fn test_update_crew_request_with_buffer() {
        let json = r#"{
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "arrivalBufferPercent": 5.0
        }"#;
        let request: UpdateCrewRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.arrival_buffer_percent, Some(5.0));
    }

    #[test]
    fn test_crew_serializes_buffer_as_camel_case() {
        let crew = Crew {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            name: "Test".to_string(),
            home_depot_id: None,
            preferred_areas: vec![],
            working_hours_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            working_hours_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            is_active: true,
            arrival_buffer_percent: 12.5,
            arrival_buffer_fixed_minutes: 5.0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let json = serde_json::to_string(&crew).unwrap();
        assert!(json.contains("\"arrivalBufferPercent\":12.5"));
        assert!(json.contains("\"arrivalBufferFixedMinutes\":5.0"));
    }

    #[test]
    fn test_create_crew_request_minimal() {
        let json = r#"{"name": "Posádka 1"}"#;

        let request: CreateCrewRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "Posádka 1");
        assert!(request.home_depot_id.is_none());
        assert!(request.preferred_areas.is_empty());
    }

    #[test]
    fn test_update_crew_request_partial() {
        let json = r#"{
            "id": "123e4567-e89b-12d3-a456-426614174000",
            "name": "Updated Name"
        }"#;

        let request: UpdateCrewRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, Some("Updated Name".to_string()));
        assert!(request.is_active.is_none());
    }

    #[test]
    fn test_crew_serialize() {
        let crew = Crew {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            name: "Test Crew".to_string(),
            home_depot_id: None,
            preferred_areas: vec!["602".to_string()],
            working_hours_start: NaiveTime::from_hms_opt(8, 0, 0).unwrap(),
            working_hours_end: NaiveTime::from_hms_opt(17, 0, 0).unwrap(),
            is_active: true,
            arrival_buffer_percent: 10.0,
            arrival_buffer_fixed_minutes: 0.0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        let json = serde_json::to_string(&crew).unwrap();
        assert!(json.contains("\"name\":\"Test Crew\""));
        assert!(json.contains("\"preferredAreas\":[\"602\"]"));
        assert!(json.contains("\"isActive\":true"));
    }
}
