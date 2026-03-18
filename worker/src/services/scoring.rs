//! Urgency scoring service
//!
//! Computes a numeric urgency score for a customer based on configurable factor weights.
//! Higher score = more urgent. Score is 0 when no rule set is provided.

use crate::types::scoring::{CustomerScoringInput, ScoreBreakdownItem, ScoringRuleFactor};

/// Known factor keys for urgency scoring
pub mod factor_keys {
    // ── Existing urgency factors ──────────────────────────────────────────
    /// Days the next action is overdue (positive = overdue, negative = upcoming)
    pub const OVERDUE_DAYS: &str = "overdue_days";
    /// Customer has no valid geocoded coordinates
    pub const GEOCODE_FAILED: &str = "geocode_failed";
    /// Number of total communications (more = higher engagement signal)
    pub const TOTAL_COMMUNICATIONS: &str = "total_communications";
    /// Days since last contact (more = more urgent)
    pub const DAYS_SINCE_LAST_CONTACT: &str = "days_since_last_contact";
    /// Customer has no open planned action (needs attention)
    pub const NO_OPEN_ACTION: &str = "no_open_action";

    // ── P4B-01: sorting factors (replace hardcoded lifecycle sort) ─────────
    /// Lifecycle rank (0=untouched, 1=overdue, 2=active, 3=needs_action).
    /// Formula inverts the rank: value = (3 − rank), so untouched → 3, needs_action → 0.
    /// Use a large positive weight (e.g. +1000) so untouched scores 3000, overdue 2000, etc.
    pub const LIFECYCLE_RANK: &str = "lifecycle_rank";
    /// Signed days until next action due date (negative = overdue).
    /// Use negative weight (e.g. -5) so more overdue = higher score.
    pub const DAYS_UNTIL_DUE: &str = "days_until_due";
    /// Days since customer was created. Use small positive weight (e.g. 0.01)
    /// as a tiebreaker so older customers appear first.
    pub const CUSTOMER_AGE_DAYS: &str = "customer_age_days";
}

/// Compute urgency score for a customer given a set of weighted factors.
/// Returns 0.0 if factors is empty.
#[cfg_attr(not(test), allow(dead_code))]
pub fn compute_urgency(input: &CustomerScoringInput, factors: &[ScoringRuleFactor]) -> f64 {
    compute_urgency_with_breakdown(input, factors).0
}

/// Compute urgency score AND a per-factor breakdown for the explanation UI.
/// Returns `(total_score, breakdown)` where breakdown contains only factors
/// with a non-zero weight (zero-weight factors are skipped).
pub fn compute_urgency_with_breakdown(
    input: &CustomerScoringInput,
    factors: &[ScoringRuleFactor],
) -> (f64, Vec<ScoreBreakdownItem>) {
    let mut score = 0.0;
    let mut breakdown = Vec::with_capacity(factors.len());

    for factor in factors {
        let (raw_value, contribution) = match factor.factor_key.as_str() {
            factor_keys::OVERDUE_DAYS => {
                let v = input.days_overdue.unwrap_or(0) as f64;
                (v, v * factor.weight)
            }
            factor_keys::GEOCODE_FAILED => {
                let v = if input.geocode_failed { 1.0 } else { 0.0 };
                (v, v * factor.weight)
            }
            factor_keys::TOTAL_COMMUNICATIONS => {
                let v = input.total_communications as f64;
                (v, v * factor.weight)
            }
            factor_keys::DAYS_SINCE_LAST_CONTACT => {
                let v = input.days_since_last_contact.unwrap_or(0) as f64;
                (v, v * factor.weight)
            }
            factor_keys::NO_OPEN_ACTION => {
                let v = if !input.has_open_action { 1.0 } else { 0.0 };
                (v, v * factor.weight)
            }
            factor_keys::LIFECYCLE_RANK => {
                let rank = input.lifecycle_rank.unwrap_or(0) as f64;
                // Inverted: rank 0 (untouched) → value 3 (highest); rank 3 (needs_action) → 0.
                // Use a positive weight (e.g. +1000) so untouched scores 3000, overdue 2000, etc.
                let v = (3.0 - rank).max(0.0);
                (v, v * factor.weight)
            }
            factor_keys::DAYS_UNTIL_DUE => {
                let v = input.days_until_due.unwrap_or(0) as f64;
                (v, v * factor.weight)
            }
            factor_keys::CUSTOMER_AGE_DAYS => {
                let v = input.customer_age_days.unwrap_or(0) as f64;
                (v, v * factor.weight)
            }
            _ => continue,
        };

        score += contribution;
        if factor.weight != 0.0 {
            breakdown.push(ScoreBreakdownItem {
                factor_key: factor.factor_key.clone(),
                raw_value,
                weight: factor.weight,
                contribution,
            });
        }
    }

    (score, breakdown)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_input(days_overdue: Option<i64>, geocode_failed: bool) -> CustomerScoringInput {
        CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue,
            geocode_failed,
            total_communications: 0,
            days_since_last_contact: None,
            has_open_action: true,
            lifecycle_rank: None,
            days_until_due: None,
            customer_age_days: None,
        }
    }

    fn factor(key: &str, weight: f64) -> ScoringRuleFactor {
        ScoringRuleFactor {
            rule_set_id: Uuid::nil(),
            factor_key: key.to_string(),
            weight,
        }
    }

    #[test]
    fn overdue_days_factor_weight_5_10_days_late() {
        let input = make_input(Some(10), false);
        let factors = vec![factor(factor_keys::OVERDUE_DAYS, 5.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 50.0).abs() < f64::EPSILON, "Expected 50.0, got {}", score);
    }

    #[test]
    fn geocode_failed_factor_weight_20() {
        let input = make_input(None, true);
        let factors = vec![factor(factor_keys::GEOCODE_FAILED, 20.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 20.0).abs() < f64::EPSILON, "Expected 20.0, got {}", score);
    }

    #[test]
    fn geocode_ok_contributes_zero() {
        let input = make_input(None, false);
        let factors = vec![factor(factor_keys::GEOCODE_FAILED, 20.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn all_weights_zero_score_is_zero() {
        let input = make_input(Some(5), true);
        let factors = vec![
            factor(factor_keys::OVERDUE_DAYS, 0.0),
            factor(factor_keys::GEOCODE_FAILED, 0.0),
        ];
        let score = compute_urgency(&input, &factors);
        assert!((score - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn negative_weight_decreases_score() {
        let input = make_input(Some(5), false);
        let factors = vec![factor(factor_keys::OVERDUE_DAYS, -2.0)];
        let score = compute_urgency(&input, &factors);
        assert!(score < 0.0, "Expected negative score, got {}", score);
    }

    #[test]
    fn empty_factors_returns_zero() {
        let input = make_input(Some(100), true);
        let score = compute_urgency(&input, &[]);
        assert!((score - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn multiple_factors_sum_correctly() {
        let input = CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue: Some(5),
            geocode_failed: true,
            total_communications: 0,
            days_since_last_contact: None,
            has_open_action: true,
            lifecycle_rank: None,
            days_until_due: None,
            customer_age_days: None,
        };
        let factors = vec![
            factor(factor_keys::OVERDUE_DAYS, 3.0),   // 5 * 3 = 15
            factor(factor_keys::GEOCODE_FAILED, 10.0), // 1 * 10 = 10
        ];
        let score = compute_urgency(&input, &factors);
        assert!((score - 25.0).abs() < f64::EPSILON, "Expected 25.0, got {}", score);
    }

    #[test]
    fn no_open_action_factor() {
        let mut input = make_input(None, false);
        input.has_open_action = false;
        let factors = vec![factor(factor_keys::NO_OPEN_ACTION, 15.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 15.0).abs() < f64::EPSILON);
    }

    // ── P4B-01: new factors ────────────────────────────────────────────────

    // lifecycle_rank uses inverted formula: value = (3 − rank) × weight
    // With positive weight +1000: untouched(0) → 3000, overdue(1) → 2000, active(2) → 1000, needs_action(3) → 0
    #[test]
    fn lifecycle_rank_weight_pos1000_rank0_gives_3000() {
        let input = CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue: None,
            geocode_failed: false,
            total_communications: 0,
            days_since_last_contact: None,
            has_open_action: true,
            lifecycle_rank: Some(0), // untouched
            days_until_due: None,
            customer_age_days: None,
        };
        let factors = vec![factor(factor_keys::LIFECYCLE_RANK, 1000.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 3000.0).abs() < f64::EPSILON, "Expected 3000.0, got {}", score);
    }

    #[test]
    fn lifecycle_rank_weight_pos1000_rank2_gives_1000() {
        let input = CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue: None,
            geocode_failed: false,
            total_communications: 0,
            days_since_last_contact: None,
            has_open_action: true,
            lifecycle_rank: Some(2), // active
            days_until_due: None,
            customer_age_days: None,
        };
        let factors = vec![factor(factor_keys::LIFECYCLE_RANK, 1000.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 1000.0).abs() < f64::EPSILON, "Expected 1000.0, got {}", score);
    }

    #[test]
    fn lifecycle_rank_weight_pos1000_rank3_gives_zero() {
        let input = CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue: None,
            geocode_failed: false,
            total_communications: 0,
            days_since_last_contact: None,
            has_open_action: true,
            lifecycle_rank: Some(3), // needs_action
            days_until_due: None,
            customer_age_days: None,
        };
        let factors = vec![factor(factor_keys::LIFECYCLE_RANK, 1000.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 0.0).abs() < f64::EPSILON, "Expected 0.0, got {}", score);
    }

    #[test]
    fn days_until_due_neg5_overdue10_gives_pos50() {
        // overdue 10 days → days_until_due = -10 → contribution = -10 * -5 = +50
        let input = CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue: None,
            geocode_failed: false,
            total_communications: 0,
            days_since_last_contact: None,
            has_open_action: true,
            lifecycle_rank: None,
            days_until_due: Some(-10),
            customer_age_days: None,
        };
        let factors = vec![factor(factor_keys::DAYS_UNTIL_DUE, -5.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 50.0).abs() < f64::EPSILON, "Expected 50.0, got {}", score);
    }

    #[test]
    fn customer_age_days_001_365days_gives_365() {
        let input = CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue: None,
            geocode_failed: false,
            total_communications: 0,
            days_since_last_contact: None,
            has_open_action: true,
            lifecycle_rank: None,
            days_until_due: None,
            customer_age_days: Some(365),
        };
        let factors = vec![factor(factor_keys::CUSTOMER_AGE_DAYS, 0.01)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 3.65).abs() < 1e-9, "Expected 3.65, got {}", score);
    }

    #[test]
    fn lifecycle_rank_none_defaults_to_rank0_gives_3000() {
        // None → defaults to rank 0 (untouched) → (3-0) × 1000 = 3000
        let input = CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue: None,
            geocode_failed: false,
            total_communications: 0,
            days_since_last_contact: None,
            has_open_action: true,
            lifecycle_rank: None,
            days_until_due: None,
            customer_age_days: None,
        };
        let factors = vec![factor(factor_keys::LIFECYCLE_RANK, 1000.0)];
        let score = compute_urgency(&input, &factors);
        assert!((score - 3000.0).abs() < f64::EPSILON, "Expected 3000.0, got {}", score);
    }

    #[test]
    fn all_8_factors_combine_correctly() {
        // lifecycle_rank=1 (overdue) → inverted=(3-1)=2, 2 * 1000 = +2000
        // days_until_due=-3 * -5 = +15
        // customer_age_days=100 * 0.01 = +1
        // overdue_days=3 * 2 = +6
        // geocode_failed=true * 10 = +10
        // total_communications=5 * 1 = +5
        // days_since_last_contact=20 * 0.5 = +10
        // no_open_action=false → 0
        // total = 2000 + 15 + 1 + 6 + 10 + 5 + 10 = 2047
        let input = CustomerScoringInput {
            customer_id: Uuid::nil(),
            days_overdue: Some(3),
            geocode_failed: true,
            total_communications: 5,
            days_since_last_contact: Some(20),
            has_open_action: true,
            lifecycle_rank: Some(1),
            days_until_due: Some(-3),
            customer_age_days: Some(100),
        };
        let factors = vec![
            factor(factor_keys::LIFECYCLE_RANK, 1000.0),
            factor(factor_keys::DAYS_UNTIL_DUE, -5.0),
            factor(factor_keys::CUSTOMER_AGE_DAYS, 0.01),
            factor(factor_keys::OVERDUE_DAYS, 2.0),
            factor(factor_keys::GEOCODE_FAILED, 10.0),
            factor(factor_keys::TOTAL_COMMUNICATIONS, 1.0),
            factor(factor_keys::DAYS_SINCE_LAST_CONTACT, 0.5),
            factor(factor_keys::NO_OPEN_ACTION, 99.0), // has_open_action=true → 0
        ];
        let score = compute_urgency(&input, &factors);
        assert!((score - 2047.0).abs() < 1e-9, "Expected 2047.0, got {}", score);
    }
}
