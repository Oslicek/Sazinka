#![allow(dead_code)]
//! Inbox types — customer-centric planning inbox

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::types::scoring::ScoreBreakdownItem;

/// Request to query the customer inbox
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InboxRequest {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    /// Ignored — sorting is fully driven by the scoring profile (Phase 4B).
    /// Kept for backward compatibility; clients should stop sending this field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_mode: Option<String>,
    pub selected_rule_set_id: Option<Uuid>,
    pub geocoded_only: Option<bool>,
    pub area_filter: Option<String>,
}

/// A single customer row in the planning inbox (Phase 2 shape).
/// `score_breakdown` is NOT in the DB — it is populated in Rust after scoring.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: Uuid,
    pub name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub geocode_status: String,
    pub customer_created_at: DateTime<Utc>,

    // Lifecycle
    pub lifecycle_state: String,
    pub lifecycle_rank: i32,

    // Next action (null for untouched/needs_action)
    pub next_action_kind: Option<String>,
    pub next_action_label_key: Option<String>,
    pub next_action_label_fallback: Option<String>,
    pub next_action_due: Option<NaiveDate>,
    pub next_action_note: Option<String>,

    // Contact history
    pub total_communications: i64,
    pub last_contact_at: Option<DateTime<Utc>>,

    // Revision scheduling status ('scheduled' or 'confirmed' if agreed, else null)
    pub revision_status: Option<String>,

    // Urgency score (Phase 4+; 0 when scoring disabled)
    pub urgency_score: f64,

    // Legacy device info (Phase 2-4)
    #[sqlx(default)]
    pub device_id: Option<Uuid>,
    #[sqlx(default)]
    pub device_name: Option<String>,
    #[sqlx(default)]
    pub device_type: Option<String>,

    /// Per-factor breakdown for the client-side explanation UI.
    /// NOT stored in the DB — always populated in Rust after scoring.
    /// Serialised as camelCase JSON in the NATS response.
    #[sqlx(skip)]
    pub score_breakdown: Vec<ScoreBreakdownItem>,
}

/// Response from the inbox query
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxResponse {
    pub items: Vec<InboxItem>,
    pub total: i64,
    pub overdue_count: i64,
    pub due_soon_count: i64,
}
