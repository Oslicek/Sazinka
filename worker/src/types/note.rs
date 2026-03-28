//! Unified note types — journal-style notes for customer, device, and visit entities.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Maximum note content length in Unicode characters (not bytes).
pub const MAX_CONTENT_CHARS: usize = 10_000;

/// The three entity types that can have notes attached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteEntityType {
    Customer,
    Device,
    Visit,
}

impl NoteEntityType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Customer => "customer",
            Self::Device => "device",
            Self::Visit => "visit",
        }
    }
}

impl std::fmt::Display for NoteEntityType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for NoteEntityType {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "customer" => Ok(Self::Customer),
            "device" => Ok(Self::Device),
            "visit" => Ok(Self::Visit),
            other => anyhow::bail!("Unknown entity type: {}", other),
        }
    }
}

/// A single note entry (journal row).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: Uuid,
    pub user_id: Uuid,
    pub entity_type: String,
    pub entity_id: Uuid,
    pub visit_id: Option<Uuid>,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A single session-level audit snapshot for a note.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NoteHistoryEntry {
    pub id: Uuid,
    pub note_id: Uuid,
    pub session_id: Uuid,
    pub edited_by_user_id: Uuid,
    pub content: String,
    pub first_edited_at: DateTime<Utc>,
    pub last_edited_at: DateTime<Utc>,
    pub change_count: i32,
}

// ============================================================
// Request / response types (NATS payloads)
// ============================================================

/// NATS: sazinka.note.create
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CreateNoteRequest {
    pub entity_type: String,
    pub entity_id: Uuid,
    /// Optionally link this note to a specific visit (e.g. device note created during a visit)
    pub visit_id: Option<Uuid>,
    pub session_id: Uuid,
    pub content: String,
}

/// NATS: sazinka.note.update
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNoteRequest {
    pub note_id: Uuid,
    pub session_id: Uuid,
    pub content: String,
}

/// NATS: sazinka.note.list
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotesRequest {
    pub entity_type: String,
    pub entity_id: Uuid,
}

/// Response for sazinka.note.list
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotesResponse {
    pub notes: Vec<Note>,
}

/// NATS: sazinka.note.audit
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditNoteRequest {
    pub note_id: Uuid,
}

/// Response for sazinka.note.audit
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditNoteResponse {
    pub entries: Vec<NoteHistoryEntry>,
}

/// NATS: sazinka.note.delete
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteNoteRequest {
    pub note_id: Uuid,
}

// ============================================================
// Validation helpers
// ============================================================

/// Returns an error string if content exceeds the 10,000 Unicode character limit.
pub fn validate_content(content: &str) -> Result<(), &'static str> {
    if content.chars().count() > MAX_CONTENT_CHARS {
        Err("NOTE_CONTENT_TOO_LONG")
    } else {
        Ok(())
    }
}

/// Returns an error string if the entity_type string is not one of the known variants.
pub fn validate_entity_type(entity_type: &str) -> Result<NoteEntityType, &'static str> {
    entity_type.parse().map_err(|_| "INVALID_ENTITY_TYPE")
}

// ============================================================
// Tests (UM14 — serde round-trip)
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_entity_type_serde_roundtrip() {
        let types = [
            NoteEntityType::Customer,
            NoteEntityType::Device,
            NoteEntityType::Visit,
        ];
        for et in &types {
            let json = serde_json::to_string(et).unwrap();
            let deserialized: NoteEntityType = serde_json::from_str(&json).unwrap();
            assert_eq!(et, &deserialized);
        }
    }

    #[test]
    fn note_entity_type_as_str() {
        assert_eq!(NoteEntityType::Customer.as_str(), "customer");
        assert_eq!(NoteEntityType::Device.as_str(), "device");
        assert_eq!(NoteEntityType::Visit.as_str(), "visit");
    }

    #[test]
    fn note_entity_type_from_str_valid() {
        assert_eq!("customer".parse::<NoteEntityType>().unwrap(), NoteEntityType::Customer);
        assert_eq!("device".parse::<NoteEntityType>().unwrap(), NoteEntityType::Device);
        assert_eq!("visit".parse::<NoteEntityType>().unwrap(), NoteEntityType::Visit);
    }

    #[test]
    fn note_entity_type_from_str_invalid() {
        let result = "unknown".parse::<NoteEntityType>();
        assert!(result.is_err());
    }

    #[test]
    fn validate_content_accepts_empty_string() {
        assert!(validate_content("").is_ok());
    }

    #[test]
    fn validate_content_accepts_max_length() {
        let s = "a".repeat(10_000);
        assert!(validate_content(&s).is_ok());
    }

    #[test]
    fn validate_content_rejects_over_limit() {
        let s = "a".repeat(10_001);
        assert_eq!(validate_content(&s), Err("NOTE_CONTENT_TOO_LONG"));
    }

    #[test]
    fn validate_entity_type_valid() {
        assert!(validate_entity_type("customer").is_ok());
        assert!(validate_entity_type("device").is_ok());
        assert!(validate_entity_type("visit").is_ok());
    }

    #[test]
    fn validate_entity_type_invalid() {
        assert_eq!(validate_entity_type("invoice"), Err("INVALID_ENTITY_TYPE"));
    }

    #[test]
    fn create_note_request_deserializes() {
        let json = r#"{
            "entityType": "device",
            "entityId": "123e4567-e89b-12d3-a456-426614174000",
            "sessionId": "223e4567-e89b-12d3-a456-426614174000",
            "content": "Found corrosion on inlet valve."
        }"#;
        let req: CreateNoteRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.entity_type, "device");
        assert!(req.visit_id.is_none());
        assert_eq!(req.content, "Found corrosion on inlet valve.");
    }

    #[test]
    fn update_note_request_deserializes() {
        let json = r#"{
            "noteId": "123e4567-e89b-12d3-a456-426614174000",
            "sessionId": "223e4567-e89b-12d3-a456-426614174000",
            "content": "Updated observation."
        }"#;
        let req: UpdateNoteRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.content, "Updated observation.");
    }

    #[test]
    fn list_notes_request_deserializes() {
        let json = r#"{
            "entityType": "visit",
            "entityId": "123e4567-e89b-12d3-a456-426614174000"
        }"#;
        let req: ListNotesRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.entity_type, "visit");
    }

    #[test]
    fn delete_note_request_deserializes() {
        let json = r#"{"noteId": "123e4567-e89b-12d3-a456-426614174000"}"#;
        let req: DeleteNoteRequest = serde_json::from_str(json).unwrap();
        assert!(!req.note_id.is_nil());
    }
}
