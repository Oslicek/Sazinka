#![allow(dead_code)]
//! Country types — DB entity and API request/response types.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

// =============================================================================
// Database entity
// =============================================================================

/// One row in the `countries` table.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Country {
    pub code: String,
    pub alpha3: String,
    pub name_en: String,
    pub name_cs: String,
    pub name_sk: String,
    pub has_map_coverage: bool,
    pub valhalla_region: Option<String>,
    pub nominatim_priority: i32,
    pub is_supported: bool,
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

// =============================================================================
// JSON source entry (from packages/countries/countries.json)
// =============================================================================

/// One entry as it appears in `packages/countries/countries.json`.
#[derive(Debug, Clone, Deserialize)]
pub struct CountryJsonEntry {
    pub code: String,
    pub alpha3: String,
    pub name: CountryJsonName,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CountryJsonName {
    pub en: String,
    pub cs: String,
    pub sk: String,
}

// =============================================================================
// API response types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryListResponse {
    pub items: Vec<Country>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountrySyncResponse {
    /// Total entries processed from the JSON
    pub synced: i32,
    /// Newly inserted rows
    pub added: i32,
    /// Rows where name/alpha3 was updated
    pub updated: i32,
}

// =============================================================================
// API request types
// =============================================================================

/// Admin-only: update operational columns for a single country.
/// Only the provided fields are changed; omitted fields remain unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCountryRequest {
    pub code: String,
    pub has_map_coverage: Option<bool>,
    pub is_supported: Option<bool>,
    pub valhalla_region: Option<String>,
    pub nominatim_priority: Option<i32>,
    pub sort_order: Option<i32>,
}

// =============================================================================
// Unit tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn country_serializes_to_camel_case() {
        let c = Country {
            code: "CZ".into(),
            alpha3: "CZE".into(),
            name_en: "Czechia".into(),
            name_cs: "Česko".into(),
            name_sk: "Česko".into(),
            has_map_coverage: true,
            valhalla_region: Some("europe".into()),
            nominatim_priority: 10,
            is_supported: true,
            sort_order: 10,
            created_at: DateTime::from_timestamp(0, 0).unwrap(),
            updated_at: DateTime::from_timestamp(0, 0).unwrap(),
        };

        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["code"], "CZ");
        assert_eq!(json["alpha3"], "CZE");
        assert_eq!(json["nameEn"], "Czechia");
        assert_eq!(json["nameCs"], "Česko");
        assert_eq!(json["nameSk"], "Česko");
        assert_eq!(json["hasMapCoverage"], true);
        assert_eq!(json["valhallaRegion"], "europe");
        assert_eq!(json["isSupported"], true);
        assert_eq!(json["sortOrder"], 10);
    }

    #[test]
    fn country_json_entry_deserializes() {
        let raw = r#"{
            "code": "SK",
            "alpha3": "SVK",
            "name": { "en": "Slovakia", "cs": "Slovensko", "sk": "Slovensko" }
        }"#;
        let entry: CountryJsonEntry = serde_json::from_str(raw).unwrap();
        assert_eq!(entry.code, "SK");
        assert_eq!(entry.alpha3, "SVK");
        assert_eq!(entry.name.en, "Slovakia");
        assert_eq!(entry.name.cs, "Slovensko");
    }

    #[test]
    fn update_country_request_deserializes_partial() {
        let raw = r#"{"code":"CZ","isSupported":true}"#;
        let req: UpdateCountryRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.code, "CZ");
        assert_eq!(req.is_supported, Some(true));
        assert!(req.has_map_coverage.is_none());
        assert!(req.valhalla_region.is_none());
    }

    #[test]
    fn country_sync_response_serializes() {
        let r = CountrySyncResponse { synced: 212, added: 210, updated: 2 };
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["synced"], 212);
        assert_eq!(json["added"], 210);
        assert_eq!(json["updated"], 2);
    }
}
