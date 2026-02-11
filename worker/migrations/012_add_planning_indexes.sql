-- Improve planner and history query performance.
CREATE INDEX IF NOT EXISTS idx_revisions_user_scheduled_date
    ON revisions(user_id, scheduled_date);

CREATE INDEX IF NOT EXISTS idx_revisions_completed_at
    ON revisions(completed_at)
    WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_route_stops_revision_id
    ON route_stops(revision_id)
    WHERE revision_id IS NOT NULL;
