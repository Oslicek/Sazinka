-- Add arrival buffer percent to crews table
-- Buffer = percentage of preceding segment duration to arrive early before time window start
ALTER TABLE crews ADD COLUMN arrival_buffer_percent REAL NOT NULL DEFAULT 10.0;
