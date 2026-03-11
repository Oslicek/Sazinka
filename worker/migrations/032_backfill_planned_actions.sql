-- Phase 1 / P1-07: Backfill planned_actions from existing revisions, visits, communications

-- 1. One planned_action per open revision (upcoming or scheduled)
INSERT INTO planned_actions (user_id, customer_id, status, due_date, revision_id, device_id, note)
SELECT
    r.user_id,
    r.customer_id,
    'open'::action_status,
    COALESCE(r.scheduled_date, r.due_date),
    r.id,
    r.device_id,
    NULL
FROM revisions r
WHERE r.status IN ('upcoming', 'scheduled')
  AND NOT EXISTS (
      SELECT 1 FROM planned_actions pa
      WHERE pa.revision_id = r.id
  );

-- 2. One planned_action per planned visit (not already covered by a revision action)
INSERT INTO planned_actions (user_id, customer_id, status, due_date, visit_id, note)
SELECT
    v.user_id,
    v.customer_id,
    'open'::action_status,
    v.scheduled_date,
    v.id,
    NULL
FROM visits v
WHERE v.status = 'planned'
  AND NOT EXISTS (
      SELECT 1 FROM planned_actions pa
      WHERE pa.visit_id = v.id
  );

-- 3. One planned_action per communication with an open follow-up
INSERT INTO planned_actions (user_id, customer_id, status, due_date, note)
SELECT
    c.user_id,
    c.customer_id,
    'open'::action_status,
    c.follow_up_date,
    'Follow-up from communication on ' || c.created_at::date::text
FROM communications c
WHERE c.follow_up_date IS NOT NULL
  AND c.follow_up_completed = FALSE
  AND NOT EXISTS (
      SELECT 1 FROM planned_actions pa
      WHERE pa.customer_id = c.customer_id
        AND pa.due_date = c.follow_up_date
        AND pa.status = 'open'
        AND pa.revision_id IS NULL
        AND pa.visit_id IS NULL
  );
