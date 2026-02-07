-- Add authentication fields to users table
-- Role: 'admin' (system), 'customer' (business owner), 'worker' (employee)
-- Owner: for workers, references the customer who created them

ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_owner ON users(owner_id);

-- Set existing dev user as admin
UPDATE users SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000001';
