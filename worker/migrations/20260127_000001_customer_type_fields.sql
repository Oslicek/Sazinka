-- Add customer type and company-related fields

-- Customer type enum: person or company
CREATE TYPE customer_type AS ENUM ('person', 'company');

-- Add new columns to customers table
ALTER TABLE customers
    ADD COLUMN customer_type customer_type NOT NULL DEFAULT 'person',
    ADD COLUMN contact_person VARCHAR(255),
    ADD COLUMN ico VARCHAR(20),
    ADD COLUMN dic VARCHAR(20),
    ADD COLUMN phone_raw VARCHAR(100);

-- Index for duplicate detection by IČO
CREATE INDEX idx_customers_ico ON customers(user_id, ico) WHERE ico IS NOT NULL;

-- Comment on columns
COMMENT ON COLUMN customers.customer_type IS 'Type of customer: person or company';
COMMENT ON COLUMN customers.contact_person IS 'Contact person for company customers';
COMMENT ON COLUMN customers.ico IS 'Czech company registration number (IČO) - 8 digits';
COMMENT ON COLUMN customers.dic IS 'Czech VAT ID (DIČ) - format CZ + 8-10 digits';
COMMENT ON COLUMN customers.phone_raw IS 'Original phone value when E.164 normalization failed';
