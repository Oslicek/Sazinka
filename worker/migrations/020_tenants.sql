-- Migration 020: Introduce explicit tenant model
-- Each root user (owner_id IS NULL) gets one tenant.
-- Workers (owner_id IS NOT NULL) are added to their owner's tenant.
-- tenant_id MUST NOT be mapped to user_id — one tenant can have multiple users.

CREATE TABLE tenants (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_tenants (
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role      VARCHAR(20) NOT NULL DEFAULT 'owner', -- 'owner' | 'worker'
    PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX idx_user_tenants_user   ON user_tenants(user_id);
CREATE INDEX idx_user_tenants_tenant ON user_tenants(tenant_id);

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed: create one tenant per existing root user and wire up their workers.
DO $$
DECLARE
    u    RECORD;
    t_id UUID;
BEGIN
    -- Root users (owners): create a tenant for each
    FOR u IN
        SELECT id, COALESCE(business_name, name, email) AS tenant_name
        FROM users
        WHERE owner_id IS NULL
    LOOP
        INSERT INTO tenants (id, name)
        VALUES (uuid_generate_v4(), u.tenant_name)
        RETURNING id INTO t_id;

        INSERT INTO user_tenants (user_id, tenant_id, role)
        VALUES (u.id, t_id, 'owner');
    END LOOP;

    -- Workers: add to their owner's tenant
    FOR u IN
        SELECT id, owner_id
        FROM users
        WHERE owner_id IS NOT NULL
    LOOP
        SELECT ut.tenant_id INTO t_id
        FROM user_tenants ut
        WHERE ut.user_id = u.owner_id;

        IF t_id IS NOT NULL THEN
            INSERT INTO user_tenants (user_id, tenant_id, role)
            VALUES (u.id, t_id, 'worker')
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;
