-- Add geocode_status to track geocoding state
-- Values: 'pending' (not attempted), 'success' (has coordinates), 'failed' (attempted, no result)

-- Add the column with default 'pending'
ALTER TABLE customers 
ADD COLUMN geocode_status VARCHAR(20) NOT NULL DEFAULT 'pending';

-- Update existing customers based on their current state:
-- If they have coordinates, mark as 'success'
-- If they don't have coordinates, leave as 'pending' (they haven't been attempted yet)
UPDATE customers 
SET geocode_status = 'success' 
WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- Add check constraint for valid values
ALTER TABLE customers 
ADD CONSTRAINT customers_geocode_status_check 
CHECK (geocode_status IN ('pending', 'success', 'failed'));

-- Add index for efficient filtering
CREATE INDEX idx_customers_geocode_status ON customers(geocode_status);

-- Comment for documentation
COMMENT ON COLUMN customers.geocode_status IS 'Geocoding status: pending (not attempted), success (has coordinates), failed (attempted but address not found)';
