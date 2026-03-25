#![allow(dead_code)]
//! Scoring rule set and factor database queries

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::scoring::{
    CreateScoringRuleSetRequest, FactorInput, ScoringRuleFactor, ScoringRuleSet,
    UpdateScoringRuleSetRequest,
};

const RULE_SET_COLS: &str = r#"
    id, user_id, name, description,
    is_default, is_archived, is_system,
    created_by_user_id, updated_by_user_id,
    created_at, updated_at
"#;

/// Factory factor weights for the seeded "Standard" system profile.
/// Used both when seeding and when restoring defaults.
///
/// lifecycle_rank uses an inverted formula: value = (3 − rank), so:
///   rank 0 (untouched)    → 3 × 1000 = 3000  (highest)
///   rank 1 (overdue)      → 2 × 1000 = 2000
///   rank 2 (active)       → 1 × 1000 = 1000
///   rank 3 (needs_action) → 0 × 1000 = 0     (lowest)
pub const DEFAULT_FACTORS: &[(&str, f64)] = &[
    (
        crate::services::scoring::factor_keys::LIFECYCLE_RANK,
        1000.0,
    ),
    (crate::services::scoring::factor_keys::DAYS_UNTIL_DUE, -5.0),
    (
        crate::services::scoring::factor_keys::CUSTOMER_AGE_DAYS,
        0.01,
    ),
];

/// Returns the localized name for the system "Standard" profile.
pub fn default_profile_name(locale: &str) -> &'static str {
    match locale {
        "cs" => "Standardní",
        "sk" => "Štandardný",
        _ => "Standard",
    }
}

async fn hydrate_rule_set_factors(pool: &PgPool, rule_set: &mut ScoringRuleSet) -> Result<()> {
    rule_set.factors = get_factors(pool, rule_set.id).await?;
    Ok(())
}

// ============================================================================
// SCORING RULE SETS
// ============================================================================

/// Create a new scoring rule set (user-created; is_system = FALSE)
pub async fn create_rule_set(
    pool: &PgPool,
    user_id: Uuid,
    req: &CreateScoringRuleSetRequest,
) -> Result<ScoringRuleSet> {
    let is_default = req.is_default.unwrap_or(false);

    // If this is the first rule set for the user, make it default
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM scoring_rule_sets WHERE user_id = $1 AND is_archived = FALSE",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;
    let effective_default = is_default || count == 0;

    let mut tx = pool.begin().await?;

    if effective_default {
        sqlx::query(
            "UPDATE scoring_rule_sets SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }

    let mut rule_set = sqlx::query_as::<_, ScoringRuleSet>(&format!(
        r#"
        INSERT INTO scoring_rule_sets (
            id, user_id, name, description, is_default, is_archived, is_system,
            created_by_user_id, updated_by_user_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $2, $2, NOW(), NOW())
        RETURNING {}
        "#,
        RULE_SET_COLS
    ))
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(&req.name)
    .bind(&req.description)
    .bind(effective_default)
    .fetch_one(&mut *tx)
    .await?;

    if let Some(ref factors) = req.factors {
        upsert_factors_in_tx(&mut tx, rule_set.id, factors).await?;
    }

    tx.commit().await?;
    hydrate_rule_set_factors(pool, &mut rule_set).await?;
    Ok(rule_set)
}

/// Seed the "Standard" system profile for a new company at onboarding.
/// Idempotent — does nothing if a system profile already exists for the user.
pub async fn create_default_scoring_profile(
    pool: &PgPool,
    user_id: Uuid,
    locale: &str,
) -> Result<ScoringRuleSet> {
    let mut tx = pool.begin().await?;

    // Clear any existing default before setting the new one
    sqlx::query(
        "UPDATE scoring_rule_sets SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    let name = default_profile_name(locale);
    let mut rule_set = sqlx::query_as::<_, ScoringRuleSet>(&format!(
        r#"
        INSERT INTO scoring_rule_sets (
            id, user_id, name, description, is_default, is_archived, is_system,
            created_by_user_id, updated_by_user_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, NULL, TRUE, FALSE, TRUE, $2, $2, NOW(), NOW())
        RETURNING {}
        "#,
        RULE_SET_COLS
    ))
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(name)
    .fetch_one(&mut *tx)
    .await?;

    let factors: Vec<FactorInput> = DEFAULT_FACTORS
        .iter()
        .map(|(k, w)| FactorInput {
            factor_key: k.to_string(),
            weight: *w,
        })
        .collect();
    upsert_factors_in_tx(&mut tx, rule_set.id, &factors).await?;

    tx.commit().await?;
    hydrate_rule_set_factors(pool, &mut rule_set).await?;
    Ok(rule_set)
}

/// Reset a system profile's name and factors to factory defaults.
/// Returns error if the profile is not a system profile.
pub async fn restore_rule_set_defaults(
    pool: &PgPool,
    user_id: Uuid,
    rule_set_id: Uuid,
    locale: &str,
) -> Result<Option<ScoringRuleSet>> {
    let mut tx = pool.begin().await?;

    let name = default_profile_name(locale);
    let mut rule_set = sqlx::query_as::<_, ScoringRuleSet>(&format!(
        r#"
        UPDATE scoring_rule_sets
        SET name = $3, description = NULL, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND is_system = TRUE
        RETURNING {}
        "#,
        RULE_SET_COLS
    ))
    .bind(rule_set_id)
    .bind(user_id)
    .bind(name)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(ref rs) = rule_set {
        let factors: Vec<FactorInput> = DEFAULT_FACTORS
            .iter()
            .map(|(k, w)| FactorInput {
                factor_key: k.to_string(),
                weight: *w,
            })
            .collect();
        upsert_factors_in_tx(&mut tx, rs.id, &factors).await?;
    }

    tx.commit().await?;
    if let Some(ref mut rs) = rule_set {
        hydrate_rule_set_factors(pool, rs).await?;
    }
    Ok(rule_set)
}

/// Hard-delete a rule set. Returns error if is_system = TRUE.
pub async fn delete_rule_set(pool: &PgPool, user_id: Uuid, rule_set_id: Uuid) -> Result<bool> {
    // Guard: refuse to delete system profiles
    let row = sqlx::query_as::<_, (bool,)>(
        "SELECT is_system FROM scoring_rule_sets WHERE id = $1 AND user_id = $2",
    )
    .bind(rule_set_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    match row {
        None => return Ok(false),
        Some((true,)) => {
            anyhow::bail!("SYSTEM_PROFILE: Cannot delete a system scoring profile");
        }
        Some((false,)) => {}
    }

    let result = sqlx::query("DELETE FROM scoring_rule_sets WHERE id = $1 AND user_id = $2")
        .bind(rule_set_id)
        .bind(user_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

/// List scoring rule sets for a user (excludes archived by default)
pub async fn list_rule_sets(
    pool: &PgPool,
    user_id: Uuid,
    include_archived: bool,
) -> Result<Vec<ScoringRuleSet>> {
    let query = if include_archived {
        format!(
            "SELECT {} FROM scoring_rule_sets WHERE user_id = $1 ORDER BY is_default DESC, name ASC",
            RULE_SET_COLS
        )
    } else {
        format!(
            "SELECT {} FROM scoring_rule_sets WHERE user_id = $1 AND is_archived = FALSE ORDER BY is_default DESC, name ASC",
            RULE_SET_COLS
        )
    };

    let mut sets = sqlx::query_as::<_, ScoringRuleSet>(&query)
        .bind(user_id)
        .fetch_all(pool)
        .await?;

    for set in &mut sets {
        hydrate_rule_set_factors(pool, set).await?;
    }

    Ok(sets)
}

/// Get a single rule set by ID
pub async fn get_rule_set(
    pool: &PgPool,
    user_id: Uuid,
    rule_set_id: Uuid,
) -> Result<Option<ScoringRuleSet>> {
    let mut set = sqlx::query_as::<_, ScoringRuleSet>(&format!(
        "SELECT {} FROM scoring_rule_sets WHERE id = $1 AND user_id = $2",
        RULE_SET_COLS
    ))
    .bind(rule_set_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    if let Some(ref mut rule_set) = set {
        hydrate_rule_set_factors(pool, rule_set).await?;
    }

    Ok(set)
}

/// Update a rule set (name, description, factors)
pub async fn update_rule_set(
    pool: &PgPool,
    user_id: Uuid,
    req: &UpdateScoringRuleSetRequest,
) -> Result<Option<ScoringRuleSet>> {
    let mut tx = pool.begin().await?;

    if req.is_default == Some(true) {
        sqlx::query(
            "UPDATE scoring_rule_sets SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }

    let mut sets = vec!["updated_at = NOW()".to_string()];
    let mut param_idx: usize = 2;

    if req.name.is_some() {
        param_idx += 1;
        sets.push(format!("name = ${}", param_idx));
    }
    if req.description.is_some() {
        param_idx += 1;
        sets.push(format!("description = ${}", param_idx));
    }
    if req.is_default.is_some() {
        param_idx += 1;
        sets.push(format!("is_default = ${}", param_idx));
    }

    let query = format!(
        "UPDATE scoring_rule_sets SET {} WHERE id = $1 AND user_id = $2 RETURNING {}",
        sets.join(", "),
        RULE_SET_COLS
    );

    let mut qb = sqlx::query_as::<_, ScoringRuleSet>(&query)
        .bind(req.id)
        .bind(user_id);

    if let Some(ref name) = req.name {
        qb = qb.bind(name);
    }
    if let Some(ref desc) = req.description {
        qb = qb.bind(desc);
    }
    if let Some(is_default) = req.is_default {
        qb = qb.bind(is_default);
    }

    let mut result = qb.fetch_optional(&mut *tx).await?;

    if let Some(ref rule_set) = result {
        if let Some(ref factors) = req.factors {
            upsert_factors_in_tx(&mut tx, rule_set.id, factors).await?;
        }
    }

    tx.commit().await?;
    if let Some(ref mut rule_set) = result {
        hydrate_rule_set_factors(pool, rule_set).await?;
    }
    Ok(result)
}

/// Set a rule set as the default (clears other defaults for the user)
pub async fn set_default_rule_set(pool: &PgPool, user_id: Uuid, rule_set_id: Uuid) -> Result<bool> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        "UPDATE scoring_rule_sets SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE",
    )
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    let result = sqlx::query(
        "UPDATE scoring_rule_sets SET is_default = TRUE WHERE id = $1 AND user_id = $2",
    )
    .bind(rule_set_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

/// Archive a rule set (soft-delete). Auto-promotes next active profile to default
/// if the archived profile was the current default.
pub async fn archive_rule_set(pool: &PgPool, user_id: Uuid, rule_set_id: Uuid) -> Result<bool> {
    let mut tx = pool.begin().await?;

    let was_default = sqlx::query_as::<_, (bool,)>(
        "SELECT is_default FROM scoring_rule_sets WHERE id = $1 AND user_id = $2",
    )
    .bind(rule_set_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .map(|(v,)| v)
    .unwrap_or(false);

    let result = sqlx::query(
        "UPDATE scoring_rule_sets SET is_archived = TRUE, is_default = FALSE, updated_at = NOW() WHERE id = $1 AND user_id = $2",
    )
    .bind(rule_set_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await?;

    // If we just archived the default, promote the next active profile alphabetically
    if was_default && result.rows_affected() > 0 {
        sqlx::query(
            r#"
            UPDATE scoring_rule_sets SET is_default = TRUE
            WHERE id = (
                SELECT id FROM scoring_rule_sets
                WHERE user_id = $1 AND is_archived = FALSE AND id != $2
                ORDER BY name ASC
                LIMIT 1
            )
            "#,
        )
        .bind(user_id)
        .bind(rule_set_id)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

// ============================================================================
// SCORING RULE FACTORS
// ============================================================================

/// Get all factors for a rule set
pub async fn get_factors(pool: &PgPool, rule_set_id: Uuid) -> Result<Vec<ScoringRuleFactor>> {
    let factors = sqlx::query_as::<_, ScoringRuleFactor>(
        "SELECT rule_set_id, factor_key, weight::float8 FROM scoring_rule_factors WHERE rule_set_id = $1 ORDER BY factor_key",
    )
    .bind(rule_set_id)
    .fetch_all(pool)
    .await?;

    Ok(factors)
}

/// Upsert factors for a rule set (replaces all existing factors)
pub async fn upsert_factors(
    pool: &PgPool,
    rule_set_id: Uuid,
    factors: &[FactorInput],
) -> Result<()> {
    let mut tx = pool.begin().await?;
    upsert_factors_in_tx(&mut tx, rule_set_id, factors).await?;
    tx.commit().await?;
    Ok(())
}

async fn upsert_factors_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    rule_set_id: Uuid,
    factors: &[FactorInput],
) -> Result<()> {
    // Delete existing factors and re-insert (simpler than individual upserts)
    sqlx::query("DELETE FROM scoring_rule_factors WHERE rule_set_id = $1")
        .bind(rule_set_id)
        .execute(&mut **tx)
        .await?;

    for factor in factors {
        sqlx::query(
            "INSERT INTO scoring_rule_factors (rule_set_id, factor_key, weight) VALUES ($1, $2, $3)",
        )
        .bind(rule_set_id)
        .bind(&factor.factor_key)
        .bind(factor.weight)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── helpers ──────────────────────────────────────────────────────────────

    fn weight_map<'a>(factors: &'a [(&'a str, f64)]) -> std::collections::HashMap<&'a str, f64> {
        factors.iter().map(|(k, w)| (*k, *w)).collect()
    }

    // ── existing tests ────────────────────────────────────────────────────────

    #[test]
    fn factor_input_serializes() {
        let f = FactorInput {
            factor_key: "overdue_days".to_string(),
            weight: 5.0,
        };
        let json = serde_json::to_string(&f).unwrap();
        assert!(json.contains("\"factorKey\""));
        assert!(json.contains("\"weight\""));
    }

    #[test]
    fn default_profile_name_localization() {
        assert_eq!(default_profile_name("cs"), "Standardní");
        assert_eq!(default_profile_name("sk"), "Štandardný");
        assert_eq!(default_profile_name("en"), "Standard");
        assert_eq!(default_profile_name("de"), "Standard");
        assert_eq!(default_profile_name(""), "Standard");
    }

    #[test]
    fn default_factors_contains_3_entries() {
        assert_eq!(DEFAULT_FACTORS.len(), 3);
        let keys: Vec<&str> = DEFAULT_FACTORS.iter().map(|(k, _)| *k).collect();
        assert!(keys.contains(&"lifecycle_rank"));
        assert!(keys.contains(&"days_until_due"));
        assert!(keys.contains(&"customer_age_days"));
    }

    #[test]
    fn default_factors_weights_are_correct() {
        let map: std::collections::HashMap<&str, f64> = DEFAULT_FACTORS.iter().cloned().collect();
        assert!((map["lifecycle_rank"] - 1000.0).abs() < f64::EPSILON);
        assert!((map["days_until_due"] - (-5.0)).abs() < f64::EPSILON);
        assert!((map["customer_age_days"] - 0.01).abs() < f64::EPSILON);
    }

    // ── A.1: PRESET_CATALOG — five presets ───────────────────────────────────

    #[test]
    fn preset_catalog_has_five_entries() {
        assert_eq!(PRESET_CATALOG.len(), 5);
    }

    #[test]
    fn preset_catalog_contains_all_five_keys() {
        let keys: Vec<&str> = PRESET_CATALOG.iter().map(|p| p.key).collect();
        assert!(keys.contains(&"standard"), "missing: standard");
        assert!(keys.contains(&"new_customers_first"), "missing: new_customers_first");
        assert!(keys.contains(&"due_date_radar"), "missing: due_date_radar");
        assert!(keys.contains(&"overdue_firefighter"), "missing: overdue_firefighter");
        assert!(keys.contains(&"data_quality_first"), "missing: data_quality_first");
    }

    #[test]
    fn preset_standard_weights_match_plan() {
        let p = PRESET_CATALOG.iter().find(|p| p.key == "standard").expect("standard preset missing");
        let m = weight_map(p.factors);
        assert!((m["lifecycle_rank"] - 1000.0).abs() < f64::EPSILON);
        assert!((m["days_until_due"] - (-5.0)).abs() < f64::EPSILON);
        assert!((m["customer_age_days"] - 0.01).abs() < f64::EPSILON);
    }

    #[test]
    fn preset_new_customers_first_weights_match_plan() {
        let p = PRESET_CATALOG.iter().find(|p| p.key == "new_customers_first").expect("new_customers_first preset missing");
        let m = weight_map(p.factors);
        assert!((m["lifecycle_rank"] - 1700.0).abs() < f64::EPSILON);
        assert!((m["days_until_due"] - (-2.0)).abs() < f64::EPSILON);
        assert!((m["customer_age_days"] - 0.005).abs() < f64::EPSILON);
        assert!((m["no_open_action"] - 350.0).abs() < f64::EPSILON);
    }

    #[test]
    fn preset_due_date_radar_weights_match_plan() {
        let p = PRESET_CATALOG.iter().find(|p| p.key == "due_date_radar").expect("due_date_radar preset missing");
        let m = weight_map(p.factors);
        assert!((m["lifecycle_rank"] - 700.0).abs() < f64::EPSILON);
        assert!((m["days_until_due"] - (-12.0)).abs() < f64::EPSILON);
        assert!((m["customer_age_days"] - 0.005).abs() < f64::EPSILON);
        assert!((m["overdue_days"] - 3.0).abs() < f64::EPSILON);
    }

    #[test]
    fn preset_overdue_firefighter_weights_match_plan() {
        let p = PRESET_CATALOG.iter().find(|p| p.key == "overdue_firefighter").expect("overdue_firefighter preset missing");
        let m = weight_map(p.factors);
        assert!((m["lifecycle_rank"] - 500.0).abs() < f64::EPSILON);
        assert!((m["days_until_due"] - (-18.0)).abs() < f64::EPSILON);
        assert!((m["overdue_days"] - 8.0).abs() < f64::EPSILON);
        assert!((m["no_open_action"] - 100.0).abs() < f64::EPSILON);
        assert!(*m.get("customer_age_days").unwrap_or(&0.0) == 0.0);
    }

    #[test]
    fn preset_data_quality_first_weights_match_plan() {
        let p = PRESET_CATALOG.iter().find(|p| p.key == "data_quality_first").expect("data_quality_first preset missing");
        let m = weight_map(p.factors);
        assert!((m["lifecycle_rank"] - 500.0).abs() < f64::EPSILON);
        assert!((m["days_until_due"] - (-4.0)).abs() < f64::EPSILON);
        assert!((m["geocode_failed"] - 900.0).abs() < f64::EPSILON);
        assert!((m["no_open_action"] - 150.0).abs() < f64::EPSILON);
        assert!(*m.get("customer_age_days").unwrap_or(&0.0) == 0.0);
    }

    #[test]
    fn preset_catalog_exactly_one_default() {
        let default_count = PRESET_CATALOG.iter().filter(|p| p.is_default).count();
        assert_eq!(default_count, 1);
    }

    #[test]
    fn preset_catalog_default_is_standard() {
        let default_preset = PRESET_CATALOG.iter().find(|p| p.is_default).expect("no default preset");
        assert_eq!(default_preset.key, "standard");
    }

    // ── A.1: profile_name_for_key — all locales ───────────────────────────────

    #[test]
    fn profile_name_for_key_standard_all_locales() {
        assert_eq!(profile_name_for_key("standard", "cs"), Some("Standardní"));
        assert_eq!(profile_name_for_key("standard", "sk"), Some("Štandardný"));
        assert_eq!(profile_name_for_key("standard", "en"), Some("Standard"));
    }

    #[test]
    fn profile_name_for_key_new_customers_first_all_locales() {
        assert_eq!(profile_name_for_key("new_customers_first", "cs"), Some("Noví zákazníci první"));
        assert_eq!(profile_name_for_key("new_customers_first", "sk"), Some("Noví zákazníci prví"));
        assert_eq!(profile_name_for_key("new_customers_first", "en"), Some("New Customers First"));
    }

    #[test]
    fn profile_name_for_key_due_date_radar_all_locales() {
        assert_eq!(profile_name_for_key("due_date_radar", "cs"), Some("Radar termínů"));
        assert_eq!(profile_name_for_key("due_date_radar", "sk"), Some("Radar termínov"));
        assert_eq!(profile_name_for_key("due_date_radar", "en"), Some("Due-Date Radar"));
    }

    #[test]
    fn profile_name_for_key_overdue_firefighter_all_locales() {
        assert_eq!(profile_name_for_key("overdue_firefighter", "cs"), Some("Krizový režim po termínu"));
        assert_eq!(profile_name_for_key("overdue_firefighter", "sk"), Some("Krízový režim po termíne"));
        assert_eq!(profile_name_for_key("overdue_firefighter", "en"), Some("Overdue Firefighter"));
    }

    #[test]
    fn profile_name_for_key_data_quality_first_all_locales() {
        assert_eq!(profile_name_for_key("data_quality_first", "cs"), Some("Kvalita dat a geokódingu"));
        assert_eq!(profile_name_for_key("data_quality_first", "sk"), Some("Kvalita dát a geokódovania"));
        assert_eq!(profile_name_for_key("data_quality_first", "en"), Some("Data Quality First"));
    }

    #[test]
    fn profile_name_for_key_unknown_returns_none() {
        assert_eq!(profile_name_for_key("bogus_key", "en"), None);
    }

    #[test]
    fn profile_name_for_key_falls_back_to_en_for_unknown_locale() {
        assert_eq!(profile_name_for_key("standard", "fr"), Some("Standard"));
        assert_eq!(profile_name_for_key("due_date_radar", "de"), Some("Due-Date Radar"));
    }
}
