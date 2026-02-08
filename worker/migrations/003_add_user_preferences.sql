-- Add user preferences for default crew and depot

ALTER TABLE users
ADD COLUMN default_crew_id UUID REFERENCES crews(id) ON DELETE SET NULL,
ADD COLUMN default_depot_id UUID REFERENCES depots(id) ON DELETE SET NULL;

-- Add indexes for foreign keys
CREATE INDEX idx_users_default_crew_id ON users(default_crew_id);
CREATE INDEX idx_users_default_depot_id ON users(default_depot_id);

COMMENT ON COLUMN users.default_crew_id IS 'User''s preferred default crew (soft preference)';
COMMENT ON COLUMN users.default_depot_id IS 'User''s preferred default depot (soft preference)';
