-- Migration 043: Rename result_notes to field_notes and add visit notes history
-- Covers M1–M8 from the TDD plan.

-- 1) Rename note column on visits table
ALTER TABLE visits RENAME COLUMN result_notes TO field_notes;

-- 2) Truncate pre-existing over-limit values (silent — no report generated)
UPDATE visits
SET field_notes = substring(field_notes FROM 1 FOR 10000)
WHERE field_notes IS NOT NULL
  AND length(field_notes) > 10000;

-- 3) Add hard length constraint for all future writes
ALTER TABLE visits
  ADD CONSTRAINT visits_field_notes_max_length
  CHECK (field_notes IS NULL OR length(field_notes) <= 10000);

-- 4) Session-level audit table (one row per visit+session, updatable in place)
CREATE TABLE visit_notes_history (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  visit_id          UUID        NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  session_id        UUID        NOT NULL,
  edited_by_user_id UUID        NOT NULL REFERENCES users(id),
  field_notes       TEXT        NOT NULL,
  first_edited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_count      INTEGER     NOT NULL DEFAULT 1,
  UNIQUE (visit_id, session_id)
);

CREATE INDEX idx_visit_notes_history_visit     ON visit_notes_history(visit_id);
CREATE INDEX idx_visit_notes_history_last_edit ON visit_notes_history(last_edited_at);
