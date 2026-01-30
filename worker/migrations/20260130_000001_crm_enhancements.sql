-- CRM Enhancements Migration
-- Extends communications table and adds visits table

-- Add user_id and additional fields to communications
ALTER TABLE communications
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS follow_up_date DATE,
    ADD COLUMN IF NOT EXISTS follow_up_completed BOOLEAN DEFAULT FALSE;

-- Set default user_id for existing records (use temp user)
UPDATE communications 
SET user_id = '00000000-0000-0000-0000-000000000001'
WHERE user_id IS NULL;

-- Make user_id NOT NULL after setting defaults
ALTER TABLE communications
    ALTER COLUMN user_id SET NOT NULL;

-- Add index for user filtering
CREATE INDEX IF NOT EXISTS idx_communications_user_id ON communications(user_id);
CREATE INDEX IF NOT EXISTS idx_communications_follow_up ON communications(follow_up_date) WHERE follow_up_completed = FALSE;

-- Create visits table
CREATE TABLE IF NOT EXISTS visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL,
    
    -- Visit scheduling
    scheduled_date DATE NOT NULL,
    scheduled_time_start TIME,
    scheduled_time_end TIME,
    
    -- Visit status
    status VARCHAR(20) NOT NULL DEFAULT 'planned', -- 'planned', 'in_progress', 'completed', 'cancelled', 'rescheduled'
    
    -- Visit type
    visit_type VARCHAR(30) NOT NULL DEFAULT 'revision', -- 'revision', 'installation', 'repair', 'consultation', 'follow_up'
    
    -- Actual times (filled when visit happens)
    actual_arrival TIMESTAMPTZ,
    actual_departure TIMESTAMPTZ,
    
    -- Visit result
    result VARCHAR(30), -- 'successful', 'partial', 'failed', 'customer_absent', 'rescheduled'
    result_notes TEXT,
    
    -- Follow-up
    requires_follow_up BOOLEAN DEFAULT FALSE,
    follow_up_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for visits
CREATE INDEX IF NOT EXISTS idx_visits_user_id ON visits(user_id);
CREATE INDEX IF NOT EXISTS idx_visits_customer_id ON visits(customer_id);
CREATE INDEX IF NOT EXISTS idx_visits_scheduled_date ON visits(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);

-- Trigger for visits updated_at
CREATE TRIGGER update_visits_updated_at
    BEFORE UPDATE ON visits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
