#![allow(dead_code)]
//! Dispatcher inbox state database queries

use anyhow::Result;
use serde_json::Value as JsonValue;
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::scoring::{DispatcherInboxState, SaveInboxStateRequest};

const STATE_COLS: &str = r#"
    user_id, selected_rule_set_id, sort_mode,
    active_filters_json, page_number, page_size, updated_at
"#;

/// Get the saved inbox state for a dispatcher
pub async fn get_inbox_state(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<DispatcherInboxState>> {
    // If selected_rule_set_id points to an archived rule set, treat as NULL
    let state = sqlx::query_as::<_, DispatcherInboxState>(&format!(
        r#"
        SELECT
            dis.user_id,
            CASE
                WHEN srs.is_archived = TRUE OR srs.id IS NULL THEN NULL
                ELSE dis.selected_rule_set_id
            END AS selected_rule_set_id,
            dis.sort_mode,
            dis.active_filters_json,
            dis.page_number,
            dis.page_size,
            dis.updated_at
        FROM dispatcher_inbox_state dis
        LEFT JOIN scoring_rule_sets srs ON dis.selected_rule_set_id = srs.id
        WHERE dis.user_id = $1
        "#,
    ))
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(state)
}

/// Save (upsert) the inbox state for a dispatcher
pub async fn save_inbox_state(
    pool: &PgPool,
    user_id: Uuid,
    req: &SaveInboxStateRequest,
) -> Result<DispatcherInboxState> {
    let sort_mode = req.sort_mode.as_deref().unwrap_or("rank_first");
    let active_filters = req
        .active_filters_json
        .clone()
        .unwrap_or_else(|| JsonValue::Object(Default::default()));
    let page_number = req.page_number.unwrap_or(1);
    let page_size = req.page_size.unwrap_or(25);

    let state = sqlx::query_as::<_, DispatcherInboxState>(&format!(
        r#"
        INSERT INTO dispatcher_inbox_state (
            user_id, selected_rule_set_id, sort_mode,
            active_filters_json, page_number, page_size, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            selected_rule_set_id = EXCLUDED.selected_rule_set_id,
            sort_mode            = EXCLUDED.sort_mode,
            active_filters_json  = EXCLUDED.active_filters_json,
            page_number          = EXCLUDED.page_number,
            page_size            = EXCLUDED.page_size,
            updated_at           = NOW()
        RETURNING {}
        "#,
        STATE_COLS
    ))
    .bind(user_id)
    .bind(req.selected_rule_set_id)
    .bind(sort_mode)
    .bind(&active_filters)
    .bind(page_number)
    .bind(page_size)
    .fetch_one(pool)
    .await?;

    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_inbox_state_request_defaults() {
        let req = SaveInboxStateRequest {
            selected_rule_set_id: None,
            sort_mode: None,
            active_filters_json: None,
            page_number: None,
            page_size: None,
        };
        assert!(req.selected_rule_set_id.is_none());
        assert!(req.sort_mode.is_none());
    }
}
