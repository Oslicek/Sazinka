-- Migration: Call Queue Support
-- Adds snooze functionality and vehicle assignment for revision scheduling

-- Add snooze fields to revisions
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS snooze_until DATE;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS snooze_reason VARCHAR(255);

-- Add vehicle assignment field
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS assigned_vehicle_id UUID;

-- Add route order for manual sorting within a day's route
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS route_order INTEGER;

-- Create vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    home_depot_id UUID REFERENCES depots(id) ON DELETE SET NULL,
    preferred_areas TEXT[] DEFAULT '{}',
    working_hours_start TIME DEFAULT '08:00',
    working_hours_end TIME DEFAULT '17:00',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add foreign key for assigned_vehicle_id
ALTER TABLE revisions 
    ADD CONSTRAINT fk_revisions_vehicle 
    FOREIGN KEY (assigned_vehicle_id) 
    REFERENCES vehicles(id) 
    ON DELETE SET NULL;

-- Create index for queue queries (revisions by due date and status)
CREATE INDEX IF NOT EXISTS idx_revisions_queue 
    ON revisions (user_id, status, due_date, snooze_until)
    WHERE status IN ('upcoming', 'scheduled');

-- Create index for vehicle lookups
CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles (user_id, is_active);

-- Create index for assigned vehicle on revisions
CREATE INDEX IF NOT EXISTS idx_revisions_vehicle ON revisions (assigned_vehicle_id) 
    WHERE assigned_vehicle_id IS NOT NULL;

COMMENT ON COLUMN revisions.snooze_until IS 'Date until which this revision should be hidden from the call queue';
COMMENT ON COLUMN revisions.snooze_reason IS 'Reason for snoozing (e.g., "customer unavailable", "reschedule later")';
COMMENT ON COLUMN revisions.assigned_vehicle_id IS 'Vehicle/technician assigned to perform this revision';
COMMENT ON COLUMN revisions.route_order IS 'Order within the daily route (NULL = not yet ordered)';
COMMENT ON TABLE vehicles IS 'Vehicles/technicians that can be assigned to revisions';
