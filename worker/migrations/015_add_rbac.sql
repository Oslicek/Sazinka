-- Add RBAC tables for custom roles and permissions
-- Migration 015: Role-Based Access Control

-- Roles table: custom roles created by company owners
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(owner_id, name)
);

-- Role permissions: individual permission keys granted by each role
CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_key VARCHAR(100) NOT NULL,
    UNIQUE(role_id, permission_key)
);

-- User-role assignments: many-to-many relationship
CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- Indexes for performance
CREATE INDEX idx_roles_owner ON roles(owner_id);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

-- Comments for documentation
COMMENT ON TABLE roles IS 'Custom roles created by company owners for their workers';
COMMENT ON TABLE role_permissions IS 'Individual permissions (page:*, settings:*) granted by each role';
COMMENT ON TABLE user_roles IS 'Many-to-many: users can have multiple roles, permissions are additive';
