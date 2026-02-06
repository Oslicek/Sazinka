-- =============================================================================
-- Sazinka - Initial Schema (target data model)
-- =============================================================================
-- This is a clean schema reflecting the target data model from PROJECT_DATA.MD.
-- Previous migrations have been consolidated into this single file.
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE customer_type AS ENUM ('person', 'company');

CREATE TYPE geocode_status_enum AS ENUM ('pending', 'success', 'failed');

CREATE TYPE device_type_enum AS ENUM (
    'gas_boiler',
    'gas_water_heater',
    'chimney',
    'fireplace',
    'gas_stove',
    'other'
);

CREATE TYPE revision_status AS ENUM (
    'upcoming',      -- obligation exists, not yet scheduled
    'scheduled',     -- date agreed
    'confirmed',     -- confirmed by customer
    'completed',     -- fulfilled (work item performed)
    'cancelled'      -- cancelled
);

CREATE TYPE revision_result AS ENUM (
    'passed',        -- OK
    'conditional',   -- passed with reservations
    'failed'         -- did not pass
);

CREATE TYPE visit_status AS ENUM (
    'planned',       -- scheduled
    'in_progress',   -- underway
    'completed',     -- done
    'cancelled',     -- cancelled
    'rescheduled'    -- rescheduled to another date
);

CREATE TYPE work_type AS ENUM (
    'revision',      -- periodic inspection
    'repair',        -- repair
    'installation',  -- new device installation
    'consultation',  -- advisory visit
    'follow_up'      -- follow-up check
);

CREATE TYPE work_result AS ENUM (
    'successful',
    'partial',
    'failed',
    'customer_absent',
    'rescheduled'
);

CREATE TYPE comm_type AS ENUM (
    'email_sent',
    'email_received',
    'call',
    'note',
    'sms'
);

CREATE TYPE comm_direction AS ENUM (
    'outbound',
    'inbound'
);

CREATE TYPE route_status AS ENUM (
    'draft',
    'optimized',
    'confirmed',
    'in_progress',
    'completed'
);

-- =============================================================================
-- TABLE: users
-- =============================================================================

CREATE TABLE users (
    id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email                           VARCHAR(255) NOT NULL UNIQUE,
    password_hash                   VARCHAR(255) NOT NULL,
    name                            VARCHAR(255) NOT NULL,
    phone                           VARCHAR(20),
    business_name                   VARCHAR(255),
    street                          VARCHAR(255),
    city                            VARCHAR(100),
    postal_code                     VARCHAR(20),
    country                         CHAR(2) DEFAULT 'CZ',
    lat                             DOUBLE PRECISION,
    lng                             DOUBLE PRECISION,
    ico                             VARCHAR(20),
    dic                             VARCHAR(20),
    default_revision_interval_months INTEGER DEFAULT 12,
    default_service_duration_minutes INTEGER DEFAULT 30,
    working_hours_start             TIME DEFAULT '08:00',
    working_hours_end               TIME DEFAULT '17:00',
    max_revisions_per_day           INTEGER DEFAULT 12,
    reminder_days_before            INTEGER[] DEFAULT '{30, 14, 7}',
    email_subject_template          TEXT,
    email_body_template             TEXT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE: customers
-- =============================================================================
-- Changes from old schema:
--   name, street, city, postal_code -> nullable
--   geocode_status -> ENUM
--   phone -> VARCHAR(20)

CREATE TABLE customers (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_type     customer_type NOT NULL DEFAULT 'person',
    name              VARCHAR(255),
    contact_person    VARCHAR(255),
    ico               VARCHAR(20),
    dic               VARCHAR(20),
    email             VARCHAR(255),
    phone             VARCHAR(20),
    phone_raw         VARCHAR(100),
    street            VARCHAR(255),
    city              VARCHAR(100),
    postal_code       VARCHAR(20),
    country           CHAR(2) DEFAULT 'CZ',
    lat               DOUBLE PRECISION,
    lng               DOUBLE PRECISION,
    geocode_status    geocode_status_enum DEFAULT 'pending',
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_user ON customers(user_id);
CREATE INDEX idx_customers_geocode ON customers(user_id, geocode_status);

-- =============================================================================
-- TABLE: depots
-- =============================================================================

CREATE TABLE depots (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    street      VARCHAR(255),
    city        VARCHAR(100),
    postal_code VARCHAR(20),
    country     CHAR(2) DEFAULT 'CZ',
    lat         DOUBLE PRECISION NOT NULL,
    lng         DOUBLE PRECISION NOT NULL,
    is_primary  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one primary depot per user
CREATE UNIQUE INDEX idx_depots_primary
    ON depots(user_id)
    WHERE is_primary = TRUE;

-- =============================================================================
-- TABLE: crews
-- =============================================================================

CREATE TABLE crews (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                VARCHAR(100) NOT NULL,
    home_depot_id       UUID REFERENCES depots(id) ON DELETE SET NULL,
    preferred_areas     TEXT[] DEFAULT '{}',
    working_hours_start TIME DEFAULT '08:00',
    working_hours_end   TIME DEFAULT '17:00',
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crews_user ON crews(user_id);

-- =============================================================================
-- TABLE: devices
-- =============================================================================
-- Changes from old schema:
--   Added device_name, user_id, updated_at, next_due_date
--   device_type -> ENUM
--   Unique indexes for deduplication

CREATE TABLE devices (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id               UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_type               device_type_enum NOT NULL DEFAULT 'other',
    device_name               VARCHAR(100),
    manufacturer              VARCHAR(100),
    model                     VARCHAR(100),
    serial_number             VARCHAR(100),
    installation_date         DATE,
    revision_interval_months  INTEGER DEFAULT 12,
    next_due_date             DATE,
    notes                     TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_customer ON devices(customer_id);
CREATE INDEX idx_devices_user ON devices(user_id);

-- Unique serial number per customer (when serial_number is present)
CREATE UNIQUE INDEX idx_devices_serial
    ON devices(customer_id, serial_number)
    WHERE serial_number IS NOT NULL;

-- Unique device_name + device_type per customer (when device_name is present)
CREATE UNIQUE INDEX idx_devices_name_type
    ON devices(customer_id, device_type, device_name)
    WHERE device_name IS NOT NULL;

-- =============================================================================
-- TABLE: revisions (revision obligations / work orders)
-- =============================================================================
-- Conceptual change: describes an OBLIGATION (legal requirement to inspect),
-- not the physical visit. Status/result are denormalized from work_items.

CREATE TABLE revisions (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id                 UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    customer_id               UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    user_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status                    revision_status NOT NULL DEFAULT 'upcoming',
    due_date                  DATE NOT NULL,
    scheduled_date            DATE,
    scheduled_time_start      TIME,
    scheduled_time_end        TIME,
    completed_at              TIMESTAMPTZ,
    duration_minutes          INTEGER,
    result                    revision_result,
    findings                  TEXT,
    fulfilled_by_work_item_id UUID,   -- FK added after visit_work_items table
    snooze_until              DATE,
    snooze_reason             VARCHAR(255),
    assigned_crew_id          UUID REFERENCES crews(id) ON DELETE SET NULL,
    route_order               INTEGER,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_revisions_device ON revisions(device_id);
CREATE INDEX idx_revisions_customer ON revisions(customer_id);
CREATE INDEX idx_revisions_user ON revisions(user_id);
CREATE INDEX idx_revisions_status ON revisions(user_id, status);
CREATE INDEX idx_revisions_due ON revisions(user_id, due_date);

-- One revision per device per due_date
CREATE UNIQUE INDEX idx_revisions_device_due
    ON revisions(device_id, due_date);

-- =============================================================================
-- TABLE: visits (physical trips to customers)
-- =============================================================================
-- Conceptual change: a visit = physical trip. Work done is in visit_work_items.
-- revision_id removed; crew_id and device_id added.
-- visit_type kept as legacy for UI/API compatibility.

CREATE TABLE visits (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id           UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    crew_id               UUID REFERENCES crews(id) ON DELETE SET NULL,
    device_id             UUID REFERENCES devices(id) ON DELETE SET NULL,
    scheduled_date        DATE NOT NULL,
    scheduled_time_start  TIME,
    scheduled_time_end    TIME,
    status                visit_status NOT NULL DEFAULT 'planned',
    visit_type            VARCHAR(30) DEFAULT 'revision',   -- legacy, authority is work_items
    actual_arrival        TIMESTAMPTZ,
    actual_departure      TIMESTAMPTZ,
    result                VARCHAR(30),                      -- legacy, derived from work_items
    result_notes          TEXT,
    requires_follow_up    BOOLEAN DEFAULT FALSE,
    follow_up_reason      TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_visits_user ON visits(user_id);
CREATE INDEX idx_visits_customer ON visits(customer_id);
CREATE INDEX idx_visits_date ON visits(user_id, scheduled_date);
CREATE INDEX idx_visits_crew ON visits(crew_id) WHERE crew_id IS NOT NULL;

-- =============================================================================
-- TABLE: visit_work_items (work performed during a visit)
-- =============================================================================
-- NEW TABLE. Each row = one task performed at a customer site.
-- Source of truth for work results. Denormalized onto revisions.

CREATE TABLE visit_work_items (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visit_id            UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    device_id           UUID REFERENCES devices(id) ON DELETE SET NULL,
    revision_id         UUID REFERENCES revisions(id) ON DELETE SET NULL,
    crew_id             UUID REFERENCES crews(id) ON DELETE SET NULL,
    work_type           work_type NOT NULL,
    duration_minutes    INTEGER,
    result              work_result,
    result_notes        TEXT,
    findings            TEXT,
    requires_follow_up  BOOLEAN DEFAULT FALSE,
    follow_up_reason    TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_work_items_visit ON visit_work_items(visit_id);
CREATE INDEX idx_work_items_device ON visit_work_items(device_id) WHERE device_id IS NOT NULL;
CREATE INDEX idx_work_items_revision ON visit_work_items(revision_id) WHERE revision_id IS NOT NULL;

-- Now add the FK from revisions to visit_work_items
ALTER TABLE revisions
    ADD CONSTRAINT fk_revisions_fulfilled_work_item
    FOREIGN KEY (fulfilled_by_work_item_id)
    REFERENCES visit_work_items(id)
    ON DELETE SET NULL;

-- =============================================================================
-- TABLE: communications
-- =============================================================================
-- Changes: added updated_at, comm_type and direction as ENUM

CREATE TABLE communications (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    revision_id         UUID REFERENCES revisions(id) ON DELETE SET NULL,
    comm_type           comm_type NOT NULL,
    direction           comm_direction NOT NULL,
    subject             VARCHAR(255),
    content             TEXT NOT NULL,
    contact_name        VARCHAR(255),
    contact_phone       VARCHAR(50),
    email_status        VARCHAR(20),
    duration_minutes    INTEGER,
    follow_up_date      DATE,
    follow_up_completed BOOLEAN DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_communications_customer ON communications(customer_id);
CREATE INDEX idx_communications_user ON communications(user_id);

-- =============================================================================
-- TABLE: routes (daily route plans)
-- =============================================================================
-- Changes: added crew_id, UNIQUE changed to (user_id, date, crew_id)

CREATE TABLE routes (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    crew_id                 UUID REFERENCES crews(id) ON DELETE SET NULL,
    date                    DATE NOT NULL,
    status                  route_status NOT NULL DEFAULT 'draft',
    total_distance_km       DOUBLE PRECISION,
    total_duration_minutes  INTEGER,
    optimization_score      INTEGER,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One route per user per crew per day
CREATE UNIQUE INDEX idx_routes_user_date_crew
    ON routes(user_id, date, crew_id);

-- =============================================================================
-- TABLE: route_stops
-- =============================================================================
-- Changes: customer_id (primary), visit_id added, revision_id nullable

CREATE TABLE route_stops (
    id                             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    route_id                       UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    customer_id                    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    visit_id                       UUID REFERENCES visits(id) ON DELETE SET NULL,
    revision_id                    UUID REFERENCES revisions(id) ON DELETE SET NULL,
    stop_order                     INTEGER NOT NULL,
    estimated_arrival              TIME,
    estimated_departure            TIME,
    distance_from_previous_km      DOUBLE PRECISION,
    duration_from_previous_minutes INTEGER,
    status                         VARCHAR(20) DEFAULT 'pending',
    actual_arrival                 TIMESTAMPTZ,
    actual_departure               TIMESTAMPTZ,
    UNIQUE(route_id, stop_order)
);

CREATE INDEX idx_route_stops_route ON route_stops(route_id);

-- =============================================================================
-- TRIGGER: auto-update updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_depots_updated_at
    BEFORE UPDATE ON depots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_crews_updated_at
    BEFORE UPDATE ON crews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_revisions_updated_at
    BEFORE UPDATE ON revisions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_visits_updated_at
    BEFORE UPDATE ON visits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_communications_updated_at
    BEFORE UPDATE ON communications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_routes_updated_at
    BEFORE UPDATE ON routes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
