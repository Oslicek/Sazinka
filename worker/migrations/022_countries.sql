-- Migration 022: countries table
-- Source of truth for country codes, names, and operational coverage data.
-- Name/alpha3 columns are managed via Admin UI sync from packages/countries/countries.json.
-- Operational columns (has_map_coverage, is_supported, etc.) are NEVER overwritten by sync.

CREATE TABLE countries (
    code                    TEXT PRIMARY KEY,       -- ISO 3166-1 alpha-2, e.g. "CZ"
    alpha3                  TEXT NOT NULL,          -- ISO 3166-1 alpha-3, e.g. "CZE"
    name_en                 TEXT NOT NULL,
    name_cs                 TEXT NOT NULL,
    name_sk                 TEXT NOT NULL,
    -- Operational columns — managed separately, never overwritten by JSON sync:
    has_map_coverage        BOOLEAN NOT NULL DEFAULT false,
    valhalla_region         TEXT,
    nominatim_priority      INTEGER NOT NULL DEFAULT 999,
    is_supported            BOOLEAN NOT NULL DEFAULT false,
    sort_order              INTEGER NOT NULL DEFAULT 999,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_countries_is_supported ON countries (is_supported);
CREATE INDEX idx_countries_sort_order   ON countries (sort_order);

-- Seed the two initially supported countries.
-- All other countries will be synced via Admin UI (sazinka.admin.countries.sync).
INSERT INTO countries (code, alpha3, name_en, name_cs, name_sk,
                       has_map_coverage, is_supported, sort_order, nominatim_priority)
VALUES
    ('CZ', 'CZE', 'Czechia',  'Česko',     'Česko',     true, true, 10, 10),
    ('SK', 'SVK', 'Slovakia', 'Slovensko', 'Slovensko', true, true, 20, 20);
