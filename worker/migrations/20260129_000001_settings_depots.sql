-- Settings and Depots migration

-- Depots table (starting/ending points for routes)
CREATE TABLE depots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    
    -- Address (optional - can be set via map click)
    street VARCHAR(255),
    city VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(10) DEFAULT 'CZ',
    
    -- Coordinates (required)
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    
    -- Is this the primary depot?
    is_primary BOOLEAN NOT NULL DEFAULT false,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_depots_user_id ON depots(user_id);

-- Trigger for updated_at
CREATE TRIGGER update_depots_updated_at
    BEFORE UPDATE ON depots
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Extend users table with additional settings
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS default_service_duration_minutes INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS reminder_days_before INTEGER[] NOT NULL DEFAULT '{30, 14, 7}',
    ADD COLUMN IF NOT EXISTS ico VARCHAR(20),
    ADD COLUMN IF NOT EXISTS dic VARCHAR(20),
    ADD COLUMN IF NOT EXISTS email_subject_template TEXT DEFAULT 'Připomínka revize - {{device_type}}',
    ADD COLUMN IF NOT EXISTS email_body_template TEXT DEFAULT 'Dobrý den,

dovolujeme si Vás upozornit, že se blíží termín pravidelné revize Vašeho zařízení {{device_type}}.

Plánovaný termín: {{due_date}}

V případě zájmu nás prosím kontaktujte pro domluvení termínu.

S pozdravem,
{{business_name}}
{{phone}}
{{email}}';

-- Ensure only one primary depot per user (partial unique index)
CREATE UNIQUE INDEX idx_depots_user_primary 
    ON depots(user_id) 
    WHERE is_primary = true;
