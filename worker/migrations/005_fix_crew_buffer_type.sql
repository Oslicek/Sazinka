-- Fix arrival_buffer_percent column type from REAL (FLOAT4) to DOUBLE PRECISION (FLOAT8)
-- This is needed because Rust f64 maps to FLOAT8, not FLOAT4
ALTER TABLE crews ALTER COLUMN arrival_buffer_percent TYPE DOUBLE PRECISION;
