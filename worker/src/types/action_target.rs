#![allow(dead_code)]
//! Action target types (polymorphic target for planned_actions)

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use super::planned_action::ActionTargetKind;

/// An action_target resolves a planned_action to exactly one entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ActionTarget {
    pub id: Uuid,
    pub user_id: Uuid,
    pub target_kind: ActionTargetKind,
    pub task_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub project_id: Option<Uuid>,
    pub other_ref: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Request to create an action_target
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateActionTargetRequest {
    pub target_kind: ActionTargetKind,
    pub task_id: Option<Uuid>,
    pub visit_id: Option<Uuid>,
    pub project_id: Option<Uuid>,
    pub other_ref: Option<String>,
}

impl CreateActionTargetRequest {
    /// Validate that exactly one target reference matches the kind
    pub fn validate(&self) -> Result<(), String> {
        let set_count = [
            self.task_id.is_some(),
            self.visit_id.is_some(),
            self.project_id.is_some(),
            self.other_ref.is_some(),
        ]
        .iter()
        .filter(|&&b| b)
        .count();

        if set_count != 1 {
            return Err(format!(
                "Exactly one target reference must be set, got {}",
                set_count
            ));
        }

        match self.target_kind {
            ActionTargetKind::Task if self.task_id.is_none() => {
                Err("target_kind=task requires task_id".to_string())
            }
            ActionTargetKind::Visit if self.visit_id.is_none() => {
                Err("target_kind=visit requires visit_id".to_string())
            }
            ActionTargetKind::Project if self.project_id.is_none() => {
                Err("target_kind=project requires project_id".to_string())
            }
            ActionTargetKind::Other if self.other_ref.is_none() => {
                Err("target_kind=other requires other_ref".to_string())
            }
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_visit_target_ok() {
        let req = CreateActionTargetRequest {
            target_kind: ActionTargetKind::Visit,
            task_id: None,
            visit_id: Some(Uuid::new_v4()),
            project_id: None,
            other_ref: None,
        };
        assert!(req.validate().is_ok());
    }

    #[test]
    fn validate_visit_target_wrong_fk_fails() {
        let req = CreateActionTargetRequest {
            target_kind: ActionTargetKind::Visit,
            task_id: Some(Uuid::new_v4()),
            visit_id: None,
            project_id: None,
            other_ref: None,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_multiple_fks_fails() {
        let req = CreateActionTargetRequest {
            target_kind: ActionTargetKind::Visit,
            task_id: Some(Uuid::new_v4()),
            visit_id: Some(Uuid::new_v4()),
            project_id: None,
            other_ref: None,
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn validate_no_fk_fails() {
        let req = CreateActionTargetRequest {
            target_kind: ActionTargetKind::Task,
            task_id: None,
            visit_id: None,
            project_id: None,
            other_ref: None,
        };
        assert!(req.validate().is_err());
    }
}
