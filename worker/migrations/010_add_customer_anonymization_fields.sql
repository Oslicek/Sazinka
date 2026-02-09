ALTER TABLE customers
  ADD COLUMN is_anonymized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN anonymized_at TIMESTAMPTZ;

CREATE INDEX idx_customers_user_anonymized ON customers(user_id, is_anonymized);
