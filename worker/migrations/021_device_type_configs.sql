-- Migration 021: Device type configs, fields and field values
-- See PRJ_DEVICES.MD for full design rationale.

-- =============================================================================
-- TABLE: device_type_configs
-- =============================================================================

CREATE TABLE device_type_configs (
    id                               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id                        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    device_type_key                  VARCHAR(50) NOT NULL,
    label                            VARCHAR(255) NOT NULL,
    icon                             VARCHAR(100),
    is_active                        BOOLEAN NOT NULL DEFAULT TRUE,
    is_builtin                       BOOLEAN NOT NULL DEFAULT TRUE,
    default_revision_duration_minutes INTEGER NOT NULL DEFAULT 60,
    default_revision_interval_months  INTEGER NOT NULL DEFAULT 12,
    sort_order                        INTEGER NOT NULL DEFAULT 0,
    created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, device_type_key)
);

CREATE INDEX idx_device_type_configs_tenant ON device_type_configs(tenant_id);

CREATE TRIGGER trg_device_type_configs_updated_at
    BEFORE UPDATE ON device_type_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- TABLE: device_type_fields
-- =============================================================================

CREATE TABLE device_type_fields (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_type_config_id UUID NOT NULL REFERENCES device_type_configs(id) ON DELETE CASCADE,
    field_key             VARCHAR(50) NOT NULL,
    label                 VARCHAR(255) NOT NULL,
    field_type            VARCHAR(20) NOT NULL CHECK (field_type IN ('text','number','date','boolean','select')),
    is_required           BOOLEAN NOT NULL DEFAULT FALSE,
    select_options        JSONB,         -- [{ key, label, deprecated? }]; key = EN technical key
    default_value         TEXT,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    unit                  VARCHAR(20),
    placeholder           TEXT,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_type_config_id, field_key)
);

CREATE INDEX idx_device_type_fields_config ON device_type_fields(device_type_config_id);

CREATE TRIGGER trg_device_type_fields_updated_at
    BEFORE UPDATE ON device_type_fields
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- TABLE: device_field_values
-- =============================================================================

CREATE TABLE device_field_values (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    field_id   UUID NOT NULL REFERENCES device_type_fields(id) ON DELETE CASCADE,
    value_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_id, field_id)
);

CREATE INDEX idx_device_field_values_device ON device_field_values(device_id);
CREATE INDEX idx_device_field_values_field  ON device_field_values(field_id);

CREATE TRIGGER trg_device_field_values_updated_at
    BEFORE UPDATE ON device_field_values
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- ALTER: devices — add device_type_config_id
-- =============================================================================

ALTER TABLE devices
    ADD COLUMN device_type_config_id UUID REFERENCES device_type_configs(id) ON DELETE RESTRICT;

-- =============================================================================
-- FUNCTION: seed_device_types_for_tenant
-- Inserts 6 builtin device type configs + fields for a given tenant.
-- Called from migration for existing tenants and from a trigger for new tenants.
-- =============================================================================

CREATE OR REPLACE FUNCTION seed_device_types_for_tenant(p_tenant_id UUID)
RETURNS VOID AS $$
DECLARE
    cfg_id UUID;
BEGIN
    -- ------------------------------------------------------------------
    -- 1. gas_boiler — 60 min, 12 months
    -- ------------------------------------------------------------------
    INSERT INTO device_type_configs (id, tenant_id, device_type_key, label,
        default_revision_duration_minutes, default_revision_interval_months, sort_order)
    VALUES (uuid_generate_v4(), p_tenant_id, 'gas_boiler', 'Plynový kotel', 60, 12, 0)
    RETURNING id INTO cfg_id;

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, unit, sort_order)
    VALUES
        (cfg_id, 'rated_power',    'Jmenovitý výkon',           'number', FALSE, 'kW', 0);

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, select_options, sort_order)
    VALUES
        (cfg_id, 'combustion_type', 'Typ spalování', 'select', FALSE,
         '[{"key":"atmospheric","label":"atmosférický"},{"key":"turbo_condensing","label":"turbo (kondenzační)"},{"key":"turbo_non_condensing","label":"turbo (nekondenzační)"}]'::jsonb,
         1),
        (cfg_id, 'fuel_type', 'Palivo', 'select', FALSE,
         '[{"key":"natural_gas","label":"zemní plyn"},{"key":"propane","label":"propan"}]'::jsonb,
         2),
        (cfg_id, 'flue_type', 'Odvod spalin', 'select', FALSE,
         '[{"key":"chimney","label":"komín"},{"key":"turbo","label":"turbo"},{"key":"las","label":"LAS"}]'::jsonb,
         3);

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, sort_order)
    VALUES
        (cfg_id, 'commission_date', 'Datum uvedení do provozu', 'date', FALSE, 4);

    -- ------------------------------------------------------------------
    -- 2. gas_water_heater — 45 min, 12 months
    -- ------------------------------------------------------------------
    INSERT INTO device_type_configs (id, tenant_id, device_type_key, label,
        default_revision_duration_minutes, default_revision_interval_months, sort_order)
    VALUES (uuid_generate_v4(), p_tenant_id, 'gas_water_heater', 'Plynový ohřívač vody', 45, 12, 1)
    RETURNING id INTO cfg_id;

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, unit, sort_order)
    VALUES
        (cfg_id, 'rated_power',     'Jmenovitý výkon', 'number', FALSE, 'kW', 0),
        (cfg_id, 'capacity_liters', 'Objem nádrže',    'number', FALSE, 'l',  1);

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, select_options, sort_order)
    VALUES
        (cfg_id, 'fuel_type', 'Palivo', 'select', FALSE,
         '[{"key":"natural_gas","label":"zemní plyn"},{"key":"propane","label":"propan"}]'::jsonb,
         2);

    -- ------------------------------------------------------------------
    -- 3. chimney — 30 min, 12 months
    -- ------------------------------------------------------------------
    INSERT INTO device_type_configs (id, tenant_id, device_type_key, label,
        default_revision_duration_minutes, default_revision_interval_months, sort_order)
    VALUES (uuid_generate_v4(), p_tenant_id, 'chimney', 'Komín', 30, 12, 2)
    RETURNING id INTO cfg_id;

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, select_options, sort_order)
    VALUES
        (cfg_id, 'fuel_type', 'Palivo', 'select', TRUE,
         '[{"key":"gas","label":"plyn"},{"key":"wood","label":"dřevo"},{"key":"coal","label":"uhlí"},{"key":"lfo","label":"LTO"},{"key":"combined","label":"kombinované"},{"key":"other","label":"jiné"}]'::jsonb,
         0);

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, sort_order)
    VALUES
        (cfg_id, 'connected_appliance', 'Připojený spotřebič (typ kotle)', 'text', FALSE, 1);

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, unit, sort_order)
    VALUES
        (cfg_id, 'flue_diameter',  'Průměr průduchu', 'number', FALSE, 'mm', 2),
        (cfg_id, 'flue_count',     'Počet průduchů',  'number', FALSE, NULL, 4),
        (cfg_id, 'chimney_height', 'Výška komínu',    'number', FALSE, 'm',  5);

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, select_options, sort_order)
    VALUES
        (cfg_id, 'flue_material', 'Materiál', 'select', FALSE,
         '[{"key":"ceramic","label":"keramika"},{"key":"stainless_steel","label":"nerez"},{"key":"plastic","label":"plast"},{"key":"masonry","label":"zdivo"},{"key":"other","label":"jiné"}]'::jsonb,
         3);

    -- ------------------------------------------------------------------
    -- 4. fireplace — 30 min, 12 months
    -- ------------------------------------------------------------------
    INSERT INTO device_type_configs (id, tenant_id, device_type_key, label,
        default_revision_duration_minutes, default_revision_interval_months, sort_order)
    VALUES (uuid_generate_v4(), p_tenant_id, 'fireplace', 'Krb / krbová vložka', 30, 12, 3)
    RETURNING id INTO cfg_id;

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, select_options, sort_order)
    VALUES
        (cfg_id, 'fireplace_type', 'Typ', 'select', FALSE,
         '[{"key":"open_fireplace","label":"otevřený krb"},{"key":"fireplace_insert","label":"krbová vložka"},{"key":"stove","label":"krbová kamna"}]'::jsonb,
         0),
        (cfg_id, 'fuel_type', 'Palivo', 'select', FALSE,
         '[{"key":"wood","label":"dřevo"},{"key":"pellets","label":"peletky"},{"key":"gas","label":"plyn"},{"key":"other","label":"jiné"}]'::jsonb,
         1);

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, unit, sort_order)
    VALUES
        (cfg_id, 'rated_power', 'Jmenovitý výkon', 'number', FALSE, 'kW', 2);

    -- ------------------------------------------------------------------
    -- 5. gas_stove — 20 min, 36 months
    -- ------------------------------------------------------------------
    INSERT INTO device_type_configs (id, tenant_id, device_type_key, label,
        default_revision_duration_minutes, default_revision_interval_months, sort_order)
    VALUES (uuid_generate_v4(), p_tenant_id, 'gas_stove', 'Plynový sporák', 20, 36, 4)
    RETURNING id INTO cfg_id;

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, sort_order)
    VALUES
        (cfg_id, 'burner_count', 'Počet hořáků', 'number',  FALSE, 0),
        (cfg_id, 'has_oven',     'Trouba',        'boolean', FALSE, 1);

    INSERT INTO device_type_fields
        (device_type_config_id, field_key, label, field_type, is_required, select_options, sort_order)
    VALUES
        (cfg_id, 'fuel_type', 'Palivo', 'select', FALSE,
         '[{"key":"natural_gas","label":"zemní plyn"},{"key":"propane","label":"propan"}]'::jsonb,
         2);

    -- ------------------------------------------------------------------
    -- 6. other — 60 min, 12 months (no predefined fields)
    -- ------------------------------------------------------------------
    INSERT INTO device_type_configs (id, tenant_id, device_type_key, label,
        default_revision_duration_minutes, default_revision_interval_months, sort_order)
    VALUES (uuid_generate_v4(), p_tenant_id, 'other', 'Jiné', 60, 12, 5);

END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TRIGGER: auto-seed device types when a new tenant is created
-- =============================================================================

CREATE OR REPLACE FUNCTION trg_seed_device_types_on_tenant_insert()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM seed_device_types_for_tenant(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenant_seed_device_types
    AFTER INSERT ON tenants
    FOR EACH ROW EXECUTE FUNCTION trg_seed_device_types_on_tenant_insert();

-- =============================================================================
-- SEED existing tenants
-- =============================================================================

DO $$
DECLARE
    t RECORD;
BEGIN
    FOR t IN SELECT id FROM tenants LOOP
        PERFORM seed_device_types_for_tenant(t.id);
    END LOOP;
END $$;

-- =============================================================================
-- BACKFILL: set device_type_config_id on existing devices from device_type enum
-- =============================================================================

UPDATE devices d
SET device_type_config_id = dtc.id
FROM device_type_configs dtc
JOIN user_tenants ut ON ut.tenant_id = dtc.tenant_id
WHERE ut.user_id = d.user_id
  AND dtc.device_type_key = d.device_type::text;

-- Make device_type_config_id NOT NULL now that backfill is done
ALTER TABLE devices
    ALTER COLUMN device_type_config_id SET NOT NULL;

-- Replace old unique index with new one using device_type_config_id
DROP INDEX IF EXISTS idx_devices_name_type;

CREATE UNIQUE INDEX idx_devices_name_type
    ON devices(customer_id, device_type_config_id, device_name)
    WHERE device_name IS NOT NULL;
