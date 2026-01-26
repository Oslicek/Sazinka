-- Development seed data for Sazinka
-- Run after migrations: docker exec -i sazinka-postgres psql -U sazinka -d sazinka < infra/seed-dev.sql

-- Test user for development
INSERT INTO users (
    id, 
    email, 
    password_hash, 
    name, 
    phone, 
    business_name, 
    street, 
    city, 
    postal_code,
    country
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'test@example.com',
    'not_a_real_hash',
    'Testovací uživatel',
    '+420 123 456 789',
    'Revize s.r.o.',
    'Revizní 123',
    'Praha',
    '11000',
    'CZ'
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    business_name = EXCLUDED.business_name;

-- Verify
SELECT id, email, name, business_name FROM users WHERE id = '00000000-0000-0000-0000-000000000001';
