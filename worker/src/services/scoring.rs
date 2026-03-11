//! Urgency scoring service
//!
//! Computes a numeric urgency score for a customer based on configurable factor weights.
//! Higher score = more urgent. Score is 0 when no rule set is provided.

use crate::types::scoring::{CustomerScoringInput, ScoringRuleFactor};

/// Known factor keys for urgency scoring
pub mod factor_keys {
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
}

/// Compute urgency score for a customer given a set of weighted factors.
/// Returns 0.0 if factors is empty.
pub fn compute_urgency(input: &CustomerScoringInput, factors: &[ScoringRuleFactor]) -> f64 {
    if factors.is_empty() {
        return 0.0;
    }

    let mut score = 0.0;

    for factor in factors {
        let contribution = match factor.factor_key.as_str() {
            factor_keys::OVERDUE_DAYS => {
                input.days_overdue.unwrap_or(0) as f64 * factor.weight
            }
            factor_keys::GEOCODE_FAILED => {
                if input.geocode_failed { factor.weight } else { 0.0 }
            }
            factor_keys::TOTAL_COMMUNICATIONS => {
                input.total_communications as f64 * factor.weight
            }
            factor_keys::DAYS_SINCE_LAST_CONTACT => {
                input.days_since_last_contact.unwrap_or(0) as f64 * factor.weight
            }
            factor_keys::NO_OPEN_ACTION => {
                if !input.has_open_action { factor.weight } else { 0.0 }
            }
            _ => 0.0,
        };
        score += contribution;
    }

    score
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
}
