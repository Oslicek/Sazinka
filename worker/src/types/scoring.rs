#![allow(dead_code)]
//! Scoring rule set types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sqlx::FromRow;
use uuid::Uuid;

/// A named scoring rule set (profile) for urgency computation
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScoringRuleSet {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub is_archived: bool,
    /// System profiles are seeded automatically and cannot be deleted.
    /// They are fully editable (name, weights) and have a "Restore defaults" action.
    #[sqlx(default)]
    pub is_system: bool,
    pub created_by_user_id: Uuid,
    pub updated_by_user_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A single factor/weight within a scoring rule set
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ScoringRuleFactor {
    pub rule_set_id: Uuid,
    pub factor_key: String,
    pub weight: f64,
}

/// Request to create a scoring rule set
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScoringRuleSetRequest {
    pub name: String,
    pub description: Option<String>,
    pub is_default: Option<bool>,
    pub factors: Option<Vec<FactorInput>>,
}

/// Request to update a scoring rule set
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateScoringRuleSetRequest {
    pub id: Uuid,
    pub name: Option<String>,
    pub description: Option<String>,
    pub is_default: Option<bool>,
    pub factors: Option<Vec<FactorInput>>,
}

/// A factor key + weight pair for upsert
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactorInput {
    pub factor_key: String,
    pub weight: f64,
}

/// Per-dispatcher persisted inbox state
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DispatcherInboxState {
    pub user_id: Uuid,
    pub selected_rule_set_id: Option<Uuid>,
    pub sort_mode: String,
    pub active_filters_json: JsonValue,
    pub page_number: i32,
    pub page_size: i32,
    pub updated_at: DateTime<Utc>,
}

/// Request to save dispatcher inbox state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveInboxStateRequest {
    pub selected_rule_set_id: Option<Uuid>,
    pub sort_mode: Option<String>,
    pub active_filters_json: Option<JsonValue>,
    pub page_number: Option<i32>,
    pub page_size: Option<i32>,
}

/// One factor's contribution to the final urgency score.
/// Serialised into `InboxItem.score_breakdown` for client-side explanation UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBreakdownItem {
    pub factor_key: String,
    /// The raw input value used (e.g. days_overdue=5, geocode_failed=1/0).
    pub raw_value: f64,
    pub weight: f64,
    pub contribution: f64,
}

/// Input data for urgency computation
#[derive(Debug, Clone)]
pub struct CustomerScoringInput {
    pub customer_id: Uuid,
    // existing factors
    pub days_overdue: Option<i64>,
    pub geocode_failed: bool,
    pub total_communications: i64,
    pub days_since_last_contact: Option<i64>,
    pub has_open_action: bool,
    // P4B-01: new sorting factors
    pub lifecycle_rank: Option<i32>,
    pub days_until_due: Option<i64>,
    pub customer_age_days: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoring_rule_set_serializes_camel_case() {
        let rss = ScoringRuleSet {
            id: Uuid::nil(),
            user_id: Uuid::nil(),
            name: "Test".to_string(),
            description: None,
            is_default: false,
            is_archived: false,
            is_system: false,
            created_by_user_id: Uuid::nil(),
            updated_by_user_id: Uuid::nil(),
            created_at: chrono::DateTime::from_timestamp(0, 0).unwrap(),
            updated_at: chrono::DateTime::from_timestamp(0, 0).unwrap(),
        };
        let json = serde_json::to_string(&rss).unwrap();
        assert!(json.contains("\"isDefault\""));
        assert!(json.contains("\"isArchived\""));
        assert!(json.contains("\"isSystem\""));
        assert!(json.contains("\"createdByUserId\""));
        assert!(!json.contains("\"is_default\""));
    }

    #[test]
    fn dispatcher_inbox_state_deserializes_active_filters_json() {
        let json = r#"{
            "userId": "00000000-0000-0000-0000-000000000000",
            "selectedRuleSetId": null,
            "sortMode": "rank_first",
            "activeFiltersJson": {"geocodedOnly": true},
            "pageNumber": 1,
            "pageSize": 25,
            "updatedAt": "1970-01-01T00:00:00Z"
        }"#;
        let state: DispatcherInboxState = serde_json::from_str(json).unwrap();
        assert_eq!(state.sort_mode, "rank_first");
        assert_eq!(state.active_filters_json["geocodedOnly"], true);
    }
}
