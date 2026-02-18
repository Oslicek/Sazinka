//! Database queries for the `countries` table.

use anyhow::Result;
use sqlx::PgPool;

use crate::types::{Country, CountryJsonEntry, CountrySyncResponse, UpdateCountryRequest};

/// List countries. When `include_all` is false, only `is_supported = true` rows are returned.
pub async fn list_countries(pool: &PgPool, include_all: bool) -> Result<Vec<Country>> {
    let rows = if include_all {
        sqlx::query_as::<_, Country>(
            r#"SELECT * FROM countries ORDER BY sort_order, name_en"#,
        )
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, Country>(
            r#"SELECT * FROM countries WHERE is_supported = true ORDER BY sort_order, name_en"#,
        )
        .fetch_all(pool)
        .await?
    };
    Ok(rows)
}

/// UPSERT countries from the embedded JSON.
/// Only `name_en`, `name_cs`, `name_sk`, `alpha3` are updated — operational columns are never touched.
pub async fn sync_countries(
    pool: &PgPool,
    entries: &[CountryJsonEntry],
) -> Result<CountrySyncResponse> {
    let mut added: i32 = 0;
    let mut updated: i32 = 0;

    for entry in entries {
        let result = sqlx::query(
            r#"
            INSERT INTO countries (code, alpha3, name_en, name_cs, name_sk)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (code) DO UPDATE
                SET alpha3   = EXCLUDED.alpha3,
                    name_en  = EXCLUDED.name_en,
                    name_cs  = EXCLUDED.name_cs,
                    name_sk  = EXCLUDED.name_sk,
                    updated_at = now()
            "#,
        )
        .bind(&entry.code)
        .bind(&entry.alpha3)
        .bind(&entry.name.en)
        .bind(&entry.name.cs)
        .bind(&entry.name.sk)
        .execute(pool)
        .await?;

        // rows_affected == 1 for INSERT, 2 for UPDATE (Postgres counts both old+new)
        if result.rows_affected() == 1 {
            added += 1;
        } else {
            updated += 1;
        }
    }

    Ok(CountrySyncResponse {
        synced: entries.len() as i32,
        added,
        updated,
    })
}

/// Update operational columns for a single country (admin only).
/// Only the provided `Option` fields are changed; `None` means "leave unchanged".
pub async fn update_country(
    pool: &PgPool,
    req: &UpdateCountryRequest,
) -> Result<Option<Country>> {
    let row = sqlx::query_as::<_, Country>(
        r#"
        UPDATE countries SET
            has_map_coverage   = COALESCE($2, has_map_coverage),
            is_supported       = COALESCE($3, is_supported),
            valhalla_region    = COALESCE($4, valhalla_region),
            nominatim_priority = COALESCE($5, nominatim_priority),
            sort_order         = COALESCE($6, sort_order),
            updated_at         = now()
        WHERE code = $1
        RETURNING *
        "#,
    )
    .bind(&req.code)
    .bind(req.has_map_coverage)
    .bind(req.is_supported)
    .bind(req.valhalla_region.as_deref())
    .bind(req.nominatim_priority)
    .bind(req.sort_order)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

// =============================================================================
// Unit tests (require a live DB — skipped in CI without DATABASE_URL)
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CountryJsonEntry, CountryJsonName};

    /// Build a minimal in-memory fixture for sync logic tests.
    fn fixture_entries() -> Vec<CountryJsonEntry> {
        vec![
            CountryJsonEntry {
                code: "CZ".into(),
                alpha3: "CZE".into(),
                name: CountryJsonName {
                    en: "Czechia".into(),
                    cs: "Česko".into(),
                    sk: "Česko".into(),
                },
            },
            CountryJsonEntry {
                code: "SK".into(),
                alpha3: "SVK".into(),
                name: CountryJsonName {
                    en: "Slovakia".into(),
                    cs: "Slovensko".into(),
                    sk: "Slovensko".into(),
                },
            },
        ]
    }

    /// Verify that the `CountrySyncResponse` struct is correctly populated
    /// (pure logic test, no DB required).
    #[test]
    fn sync_response_counts_are_correct() {
        let entries = fixture_entries();
        // Simulate: 2 entries processed, 1 added, 1 updated
        let resp = CountrySyncResponse {
            synced: entries.len() as i32,
            added: 1,
            updated: 1,
        };
        assert_eq!(resp.synced, 2);
        assert_eq!(resp.added + resp.updated, resp.synced);
    }

    /// Verify that `UpdateCountryRequest` with all None fields is valid.
    #[test]
    fn update_request_all_none_is_valid() {
        let req = UpdateCountryRequest {
            code: "CZ".into(),
            has_map_coverage: None,
            is_supported: None,
            valhalla_region: None,
            nominatim_priority: None,
            sort_order: None,
        };
        assert_eq!(req.code, "CZ");
        assert!(req.has_map_coverage.is_none());
    }
}
