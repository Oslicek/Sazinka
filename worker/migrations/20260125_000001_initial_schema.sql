-- Initial database schema for Sazinka

-- Users (tradespeople)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    business_name VARCHAR(255),
    
    -- Business address (start point for routes)
    street VARCHAR(255),
    city VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(10) DEFAULT 'CZ',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    
    -- Settings
    default_revision_interval_months INTEGER NOT NULL DEFAULT 12,
    working_hours_start TIME NOT NULL DEFAULT '08:00:00',
    working_hours_end TIME NOT NULL DEFAULT '17:00:00',
    max_revisions_per_day INTEGER NOT NULL DEFAULT 12,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Customers
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    
    -- Address
    street VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(10) NOT NULL DEFAULT 'CZ',
    
    -- Coordinates (from geocoding)
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_user_id ON customers(user_id);
CREATE INDEX idx_customers_name ON customers(user_id, name);

-- Devices (equipment to be inspected)
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    device_type VARCHAR(50) NOT NULL,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    serial_number VARCHAR(100),
    installation_date DATE,
    revision_interval_months INTEGER NOT NULL DEFAULT 12,
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_customer_id ON devices(customer_id);

-- Revisions (scheduled and completed inspections)
CREATE TABLE revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    due_date DATE NOT NULL,
    scheduled_date DATE,
    scheduled_time_start TIME,
    scheduled_time_end TIME,
    
    completed_at TIMESTAMPTZ,
    duration_minutes INTEGER,
    result VARCHAR(20),
    findings TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_revisions_user_id ON revisions(user_id);
CREATE INDEX idx_revisions_due_date ON revisions(user_id, due_date);
CREATE INDEX idx_revisions_scheduled_date ON revisions(user_id, scheduled_date);
CREATE INDEX idx_revisions_status ON revisions(user_id, status);

-- Routes (daily planned routes)
CREATE TABLE routes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    
    total_distance_km DOUBLE PRECISION,
    total_duration_minutes INTEGER,
    optimization_score INTEGER,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, date)
);

CREATE INDEX idx_routes_user_date ON routes(user_id, date);

-- Route stops (ordered list of stops for a route)
CREATE TABLE route_stops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    revision_id UUID NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    
    stop_order INTEGER NOT NULL,
    estimated_arrival TIME,
    estimated_departure TIME,
    
    distance_from_previous_km DOUBLE PRECISION,
    duration_from_previous_minutes INTEGER,
    
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    actual_arrival TIMESTAMPTZ,
    actual_departure TIMESTAMPTZ,
    
    UNIQUE(route_id, stop_order)
);

CREATE INDEX idx_route_stops_route_id ON route_stops(route_id);

-- Communications (email history, notes)
CREATE TABLE communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL,
    
    comm_type VARCHAR(20) NOT NULL, -- 'email_sent', 'email_received', 'call', 'note'
    direction VARCHAR(10) NOT NULL, -- 'outbound', 'inbound'
    
    subject VARCHAR(255),
    content TEXT NOT NULL,
    
    email_status VARCHAR(20), -- 'sent', 'delivered', 'opened', 'bounced'
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_communications_customer_id ON communications(customer_id);
CREATE INDEX idx_communications_revision_id ON communications(revision_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_revisions_updated_at
    BEFORE UPDATE ON revisions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_routes_updated_at
    BEFORE UPDATE ON routes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
