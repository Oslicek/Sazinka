-- Migration: Rename Vehicle to Crew (Posádka)
-- Renames the vehicles table and related columns to crews

-- Rename vehicles table to crews
ALTER TABLE vehicles RENAME TO crews;

-- Rename assigned_vehicle_id to assigned_crew_id in revisions
ALTER TABLE revisions RENAME COLUMN assigned_vehicle_id TO assigned_crew_id;

-- Rename foreign key constraint
ALTER TABLE revisions DROP CONSTRAINT IF EXISTS fk_revisions_vehicle;
ALTER TABLE revisions 
    ADD CONSTRAINT fk_revisions_crew 
    FOREIGN KEY (assigned_crew_id) 
    REFERENCES crews(id) 
    ON DELETE SET NULL;

-- Rename indexes
DROP INDEX IF EXISTS idx_vehicles_user;
CREATE INDEX IF NOT EXISTS idx_crews_user ON crews (user_id, is_active);

DROP INDEX IF EXISTS idx_revisions_vehicle;
CREATE INDEX IF NOT EXISTS idx_revisions_crew ON revisions (assigned_crew_id) 
    WHERE assigned_crew_id IS NOT NULL;

-- Update comments
COMMENT ON COLUMN revisions.assigned_crew_id IS 'Crew (posádka) assigned to perform this revision';
COMMENT ON TABLE crews IS 'Crews (posádky) that can be assigned to revisions';
