-- Add fixed time buffer (minutes) alongside existing percentage buffer
ALTER TABLE crews
ADD COLUMN arrival_buffer_fixed_minutes DOUBLE PRECISION NOT NULL DEFAULT 0.0;
