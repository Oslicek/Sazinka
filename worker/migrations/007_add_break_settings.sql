-- Add break/pause settings to users table
-- Allows configuring automatic break insertion in routes

ALTER TABLE users
  ADD COLUMN break_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN break_duration_minutes INTEGER NOT NULL DEFAULT 45,
  ADD COLUMN break_earliest_time TIME NOT NULL DEFAULT '11:30',
  ADD COLUMN break_latest_time TIME NOT NULL DEFAULT '13:00',
  ADD COLUMN break_min_km DOUBLE PRECISION NOT NULL DEFAULT 40,
  ADD COLUMN break_max_km DOUBLE PRECISION NOT NULL DEFAULT 120;

-- Add break stop support to route_stops table
-- Allow customer_id to be nullable (break stops have no customer)
ALTER TABLE route_stops
  ALTER COLUMN customer_id DROP NOT NULL;

-- Add break stop type and fields
ALTER TABLE route_stops
  ADD COLUMN stop_type VARCHAR(20) NOT NULL DEFAULT 'customer',
  ADD COLUMN break_duration_minutes INTEGER,
  ADD COLUMN break_time_start TIME;

-- Add check constraint for stop_type
ALTER TABLE route_stops
  ADD CONSTRAINT chk_stop_type CHECK (stop_type IN ('customer', 'break'));

-- Add check constraint: customer stops must have customer_id, break stops must not
ALTER TABLE route_stops
  ADD CONSTRAINT chk_customer_id_for_type CHECK (
    (stop_type = 'customer' AND customer_id IS NOT NULL) OR
    (stop_type = 'break' AND customer_id IS NULL)
  );

-- Add check constraint: break stops must have break fields
ALTER TABLE route_stops
  ADD CONSTRAINT chk_break_fields CHECK (
    (stop_type = 'customer') OR
    (stop_type = 'break' AND break_duration_minutes IS NOT NULL AND break_time_start IS NOT NULL)
  );

-- Create index for querying break stops
CREATE INDEX idx_route_stops_type ON route_stops(stop_type);
