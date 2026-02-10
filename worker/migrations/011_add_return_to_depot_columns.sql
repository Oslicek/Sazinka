-- Add return-to-depot leg metrics on the routes table
ALTER TABLE routes ADD COLUMN IF NOT EXISTS return_to_depot_distance_km DOUBLE PRECISION;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS return_to_depot_duration_minutes INTEGER;
