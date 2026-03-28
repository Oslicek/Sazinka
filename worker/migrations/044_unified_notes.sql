-- Migration 044: Unified Notes System
-- Covers UM1–UM21 from the TDD plan.
--
-- Creates a universal, journal-style `notes` table and `notes_history` audit
-- table, then migrates existing free-form text from all legacy columns:
--   1. customers.notes          → entity_type='customer'
--   2. devices.notes            → entity_type='device'
--   3. visits.field_notes       → entity_type='visit'
--   4. visit_work_items (result_notes + findings) → entity_type='device'
--   5. revisions.findings       → entity_type='device' (skipped if already covered by work item)
--   6. visit_notes_history      → notes_history (mapped via visit note row)
--
-- Old columns are NOT dropped here; they will be dropped in migration 045
-- after one full release cycle (time gate). During that window, new writes go
-- to the notes table only; old columns are read-only for compatibility.

-- ============================================================
-- SCHEMA: universal notes table
-- ============================================================

CREATE TABLE notes (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type       VARCHAR(20) NOT NULL,  -- 'customer', 'device', 'visit'
    entity_id         UUID        NOT NULL,  -- polymorphic FK (enforced in handlers)
    visit_id          UUID        REFERENCES visits(id) ON DELETE SET NULL,
                                             -- which visit this note was created during (NULL for standalone notes)
    content           TEXT        NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ NULL,

    CONSTRAINT notes_content_max_length CHECK (length(content) <= 10000),
    CONSTRAINT notes_entity_type_valid  CHECK (entity_type IN ('customer', 'device', 'visit'))
);

-- Partial index for the most common query (list active notes for an entity)
CREATE INDEX idx_notes_entity       ON notes(entity_type, entity_id) WHERE deleted_at IS NULL;
-- Full index for admin / GDPR queries that include soft-deleted rows
CREATE INDEX idx_notes_entity_all   ON notes(entity_type, entity_id);
CREATE INDEX idx_notes_user         ON notes(user_id);
CREATE INDEX idx_notes_visit        ON notes(visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX idx_notes_created      ON notes(created_at);

-- ============================================================
-- SCHEMA: universal audit trail (replaces visit_notes_history)
-- ============================================================

CREATE TABLE notes_history (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    note_id           UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    session_id        UUID        NOT NULL,
    edited_by_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content           TEXT        NOT NULL,
    first_edited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    change_count      INTEGER     NOT NULL DEFAULT 1,
    UNIQUE (note_id, session_id)
);

CREATE INDEX idx_notes_history_note      ON notes_history(note_id);
CREATE INDEX idx_notes_history_last_edit ON notes_history(last_edited_at);

-- ============================================================
-- DATA MIGRATION
-- ============================================================

-- 1. Migrate customers.notes → notes entries
INSERT INTO notes (user_id, entity_type, entity_id, content, created_at, updated_at)
SELECT user_id, 'customer', id, notes, created_at, updated_at
FROM customers
WHERE notes IS NOT NULL AND trim(notes) <> '';

-- 2. Migrate devices.notes → notes entries
INSERT INTO notes (user_id, entity_type, entity_id, content, created_at, updated_at)
SELECT d.user_id, 'device', d.id, d.notes, d.created_at, d.updated_at
FROM devices d
WHERE d.notes IS NOT NULL AND trim(d.notes) <> '';

-- 3. Migrate visits.field_notes → notes entries (visit_id = entity_id for visit notes)
INSERT INTO notes (user_id, entity_type, entity_id, visit_id, content, created_at, updated_at)
SELECT user_id, 'visit', id, id, field_notes, created_at, updated_at
FROM visits
WHERE field_notes IS NOT NULL AND trim(field_notes) <> '';

-- 4. Migrate visit_work_items.result_notes + findings → device note entries
--    Each work item becomes its own note entry on the linked device.
--    If both result_notes and findings are present they are concatenated.
--    Content is truncated to 10,000 chars if concatenation exceeds the limit.
INSERT INTO notes (user_id, entity_type, entity_id, visit_id, content, created_at, updated_at)
SELECT
    v.user_id,
    'device',
    wi.device_id,
    wi.visit_id,
    substring(
        CASE
            WHEN wi.result_notes IS NOT NULL AND wi.findings IS NOT NULL
                THEN wi.result_notes || E'\n\n---\n\n' || wi.findings
            WHEN wi.result_notes IS NOT NULL THEN wi.result_notes
            ELSE wi.findings
        END
    FROM 1 FOR 10000),
    wi.created_at,
    wi.created_at
FROM visit_work_items wi
JOIN visits v ON v.id = wi.visit_id
WHERE wi.device_id IS NOT NULL
  AND (
      (wi.result_notes IS NOT NULL AND trim(wi.result_notes) <> '')
      OR
      (wi.findings IS NOT NULL AND trim(wi.findings) <> '')
  );

-- 5. Migrate revisions.findings → device note entries
--    Skip if the revision already has a work item that carried notes (step 4 covers those).
INSERT INTO notes (user_id, entity_type, entity_id, content, created_at, updated_at)
SELECT
    r.user_id,
    'device',
    r.device_id,
    r.findings,
    r.created_at,
    r.updated_at
FROM revisions r
WHERE r.findings IS NOT NULL AND trim(r.findings) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM visit_work_items wi
      WHERE wi.revision_id = r.id
        AND (
            (wi.result_notes IS NOT NULL AND trim(wi.result_notes) <> '')
            OR
            (wi.findings IS NOT NULL AND trim(wi.findings) <> '')
        )
  );

-- 6. Migrate visit_notes_history → notes_history
--    Only rows that have a matching visit note (orphan audit rows are skipped).
INSERT INTO notes_history (note_id, session_id, edited_by_user_id, content, first_edited_at, last_edited_at, change_count)
SELECT
    n.id,
    vnh.session_id,
    vnh.edited_by_user_id,
    vnh.field_notes,
    vnh.first_edited_at,
    vnh.last_edited_at,
    vnh.change_count
FROM visit_notes_history vnh
JOIN notes n ON n.entity_type = 'visit' AND n.entity_id = vnh.visit_id;
