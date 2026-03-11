-- Migration 027: Backfill initial revisions for devices without one
--
-- After this migration, every device that lacks an active revision
-- (status = 'upcoming' or 'scheduled') gets an initial 'upcoming' revision.
-- Due date is resolved from devices.next_due_date, falling back to
-- CURRENT_DATE + device_type_configs.default_revision_interval_months.

INSERT INTO revisions (id, device_id, customer_id, user_id, status, due_date)
SELECT
    uuid_generate_v4(),
    d.id,
    d.customer_id,
    d.user_id,
    'upcoming'::revision_status,
    COALESCE(
        d.next_due_date,
        (CURRENT_DATE + (COALESCE(dtc.default_revision_interval_months, 12) || ' months')::interval)
    )::date
FROM devices d
LEFT JOIN device_type_configs dtc
    ON d.device_type_config_id = dtc.id AND dtc.is_active = true
WHERE NOT EXISTS (
    SELECT 1 FROM revisions r
    WHERE r.device_id = d.id
      AND r.status IN ('upcoming', 'scheduled')
);
