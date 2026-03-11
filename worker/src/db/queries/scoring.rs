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
    is_default, is_archived,
    created_by_user_id, updated_by_user_id,
    created_at, updated_at
"#;

// ============================================================================
// SCORING RULE SETS
// ============================================================================

/// Create a new scoring rule set
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

    // Clear existing default if we're setting a new one
    if effective_default {
        sqlx::query(
            "UPDATE scoring_rule_sets SET is_default = FALSE WHERE user_id = $1 AND is_default = TRUE",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    }

    let rule_set = sqlx::query_as::<_, ScoringRuleSet>(&format!(
        r#"
        INSERT INTO scoring_rule_sets (
            id, user_id, name, description, is_default, is_archived,
            created_by_user_id, updated_by_user_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, FALSE, $2, $2, NOW(), NOW())
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

    // Insert factors if provided
    if let Some(ref factors) = req.factors {
        upsert_factors_in_tx(&mut tx, rule_set.id, factors).await?;
    }

    tx.commit().await?;
    Ok(rule_set)
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

    let sets = sqlx::query_as::<_, ScoringRuleSet>(&query)
        .bind(user_id)
        .fetch_all(pool)
        .await?;

    Ok(sets)
}

/// Get a single rule set by ID
pub async fn get_rule_set(
    pool: &PgPool,
    user_id: Uuid,
    rule_set_id: Uuid,
) -> Result<Option<ScoringRuleSet>> {
    let set = sqlx::query_as::<_, ScoringRuleSet>(&format!(
        "SELECT {} FROM scoring_rule_sets WHERE id = $1 AND user_id = $2",
        RULE_SET_COLS
    ))
    .bind(rule_set_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

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

    let result = qb.fetch_optional(&mut *tx).await?;

    if let Some(ref rule_set) = result {
        if let Some(ref factors) = req.factors {
            upsert_factors_in_tx(&mut tx, rule_set.id, factors).await?;
        }
    }

    tx.commit().await?;
    Ok(result)
}

/// Set a rule set as the default (clears other defaults for the user)
pub async fn set_default_rule_set(
    pool: &PgPool,
    user_id: Uuid,
    rule_set_id: Uuid,
) -> Result<bool> {
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

/// Archive a rule set (soft-delete)
pub async fn archive_rule_set(
    pool: &PgPool,
    user_id: Uuid,
    rule_set_id: Uuid,
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE scoring_rule_sets SET is_archived = TRUE, is_default = FALSE, updated_at = NOW() WHERE id = $1 AND user_id = $2",
    )
    .bind(rule_set_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

// ============================================================================
// SCORING RULE FACTORS
// ============================================================================

/// Get all factors for a rule set
pub async fn get_factors(
    pool: &PgPool,
    rule_set_id: Uuid,
) -> Result<Vec<ScoringRuleFactor>> {
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
}
