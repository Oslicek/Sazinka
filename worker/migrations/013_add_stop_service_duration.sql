-- Add per-stop service duration so the quick recalc can use it
-- instead of always falling back to the global default.
ALTER TABLE route_stops
  ADD COLUMN service_duration_minutes INTEGER;
