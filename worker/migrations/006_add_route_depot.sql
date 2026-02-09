-- Add depot_id to routes table
-- Routes should remember which depot they start/end from
ALTER TABLE routes ADD COLUMN depot_id UUID REFERENCES depots(id) ON DELETE SET NULL;

-- Create index for depot-based queries
CREATE INDEX idx_routes_depot ON routes(depot_id);
