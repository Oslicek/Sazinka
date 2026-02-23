# PRJ_DATA — Countries & Admin Page Redesign

## 1. Motivace a kontext

Aplikace Sazinka je mapová/plánovací aplikace. Informace o zemi je nutná:
- Pro optimalizaci tras (Valhalla region, Nominatim geocoding scope)
- Pro budoucí rollout pokrytí map (CZ → SK → PL → …)
- Pro nastavení tenantu (výchozí země firmy)
- Pro kontaktní formulář na webu (`apps/site`)

Státy se mění — mění se názvy, státy se rozdělují, vznikají nové. Je potřeba mít:
1. **Jednu definitivní datovou sadu** (source of truth) pod naší kontrolou
2. **Tabulku `countries` v PostgreSQL** pro optimalizační dotazy a JOINy
3. **Lazy-loaded dropdown se searchem** pro výběr země v Settings i na webu
4. **Admin UI pro sync** — aktualizace seznamu zemí spouštěná z Admin stránky

## 2. Architektura

### 2.1 Source of truth: `packages/countries/countries.json`

```json
[
  { "code": "CZ", "alpha3": "CZE", "name": { "en": "Czechia", "cs": "Česko", "sk": "Česko" } },
  { "code": "SK", "alpha3": "SVK", "name": { "en": "Slovakia", "cs": "Slovensko", "sk": "Slovensko" } }
]
```

Nový monorepo balíček `packages/countries` obsahuje:
- `countries.json` — kanonická data
- `src/types.ts` — TypeScript interface `Country`
- `src/index.ts` — export dat, `searchCountries()` utility
- `package.json` s názvem `@sazinka/countries`

### 2.2 PostgreSQL tabulka `countries`

```sql
CREATE TABLE countries (
    code         TEXT PRIMARY KEY,       -- ISO 3166-1 alpha-2, e.g. "CZ"
    alpha3       TEXT NOT NULL,          -- ISO 3166-1 alpha-3, e.g. "CZE"
    name_en      TEXT NOT NULL,
    name_cs      TEXT NOT NULL,
    name_sk      TEXT NOT NULL,
    -- Provozní sloupce (nikdy nepřepisovány syncem):
    has_map_coverage    BOOLEAN NOT NULL DEFAULT false,
    valhalla_region     TEXT,
    nominatim_priority  INTEGER DEFAULT 999,
    is_supported        BOOLEAN NOT NULL DEFAULT false,
    sort_order          INTEGER NOT NULL DEFAULT 999,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.3 Sync mechanismus

NATS subject: `sazinka.admin.countries.sync`

1. Admin klikne "Synchronizovat země" v Admin UI
2. Frontend pošle request přes NATS
3. Rust handler čte `countries.json` (zakompilovaný do binary přes `include_str!`)
4. Pro každý záznam provede UPSERT — aktualizuje **pouze** name sloupce a `alpha3`, nikdy nepřepisuje provozní sloupce
5. Vrátí `{ synced: number, added: number, updated: number }`

### 2.4 Dva konzumenti

| Konzument | Zdroj dat | Kde se zobrazí |
|---|---|---|
| `apps/web` (Settings) | NATS endpoint `sazinka.countries.list` → PG `countries` tabulka | Dropdown výběru země tenantu |
| `apps/web` (Admin) | NATS endpoint `sazinka.admin.countries.sync` + `sazinka.admin.countries.list` | Countries management sekce |
| `apps/site` (ContactForm) | `await import('@sazinka/countries')` → lazy JS chunk | Dropdown v kontaktním formuláři |

### 2.5 Admin page redesign

Aktuální Admin stránka je jeden dlouhý scroll. Redesign na layout identický se Settings:
- Sidebar vlevo (220px, sticky) s vertikálními sekcemi
- Content area vpravo

Sekce Admin stránky (po redesignu):
1. **Služby** — health check (stávající services grid)
2. **Databáze** — DB status, tabulky, reset (stávající)
3. **Země** — NOVÉ: seznam zemí, sync tlačítko, editace provozních sloupců
4. **Export** — stávající export panel
5. **Import** — stávající import sekce
6. **Logy** — stávající log viewer

## 3. Detailní plán implementace

### Fáze 1 — Balíček `packages/countries` (TDD)

**Odhadovaný čas: 1 hod**

Soubory:
- `packages/countries/package.json`
- `packages/countries/tsconfig.json`
- `packages/countries/countries.json`
- `packages/countries/src/types.ts`
- `packages/countries/src/index.ts`
- `packages/countries/src/__tests__/search.test.ts`

Postup:
1. Vytvořit balíček s `package.json` (`@sazinka/countries`)
2. **TEST**: napsat testy pro `searchCountries()`:
   - Vrátí všechny země pro prázdný query
   - Filtruje podle lokalizovaného názvu (case-insensitive, substring match)
   - Filtruje podle kódu (`CZ`, `cz`)
   - Vrátí prázdné pole pro neexistující query
   - Respektuje locale fallback (neznámý locale → `en`)
3. **IMPL**: `types.ts` s `Country` interface, `index.ts` s `searchCountries()`
4. Naplnit `countries.json` kompletním seznamem (~250 států)
5. Přidat do `pnpm-workspace.yaml` a ověřit, že se buildí

### Fáze 2 — DB migrace a Rust typy (TDD)

**Odhadovaný čas: 1.5 hod**

Soubory:
- `worker/migrations/022_countries.sql`
- `worker/src/types/country.rs`
- `worker/src/types/mod.rs`

Postup:
1. Vytvořit SQL migraci `022_countries.sql` s CREATE TABLE (viz sekce 2.2)
2. Vložit do migrace seed data pro CZ a SK (s `has_map_coverage = true`, `is_supported = true`) — zbytek se dosync-uje z Admin UI
3. **TEST**: Rust unit test pro serializaci/deserializaci `Country` struct
4. **IMPL**: `country.rs` — structs:
   - `Country` (DB row, `sqlx::FromRow`)
   - `CountryListResponse { items: Vec<Country> }`
   - `CountrySyncResponse { synced: i32, added: i32, updated: i32 }`
   - `UpdateCountryRequest { code: String, has_map_coverage: Option<bool>, is_supported: Option<bool>, valhalla_region: Option<String>, nominatim_priority: Option<i32>, sort_order: Option<i32> }`

### Fáze 3 — Rust DB queries a handlery (TDD)

**Odhadovaný čas: 2 hod**

Soubory:
- `worker/src/db/queries/country.rs`
- `worker/src/db/queries/mod.rs`
- `worker/src/handlers/country.rs`
- `worker/src/handlers/mod.rs`

Postup:

**Queries:**
1. `list_countries(pool, include_unsupported: bool) -> Vec<Country>` — pro dropdown vrací jen `is_supported = true`, pro admin všechny
2. `sync_countries(pool, entries: Vec<CountryJsonEntry>) -> SyncResult` — UPSERT loop, aktualizuje pouze name/alpha3
3. `update_country(pool, req: UpdateCountryRequest) -> Option<Country>` — admin editace provozních sloupců

**Handlers (NATS subjects):**
1. `sazinka.countries.list` — veřejný (auth required), vrací `is_supported` země
2. `sazinka.admin.countries.list` — admin only, vrací všechny země
3. `sazinka.admin.countries.sync` — admin only, spustí sync z embedded JSON
4. `sazinka.admin.countries.update` — admin only, editace provozních sloupců jedné země

**Testy:**
- Unit test: `sync_countries` — ověřit, že UPSERT přidá nové a aktualizuje jména, ale nepřepíše `has_map_coverage`
- Unit test: `list_countries` s `include_unsupported = false` vrátí jen supported
- Unit test: `update_country` změní `has_map_coverage`, ale ne `name_en`

**Embedding JSON do Rust binary:**
- V `country.rs` handler: `const COUNTRIES_JSON: &str = include_str!("../../../packages/countries/countries.json");`
- Parse při sync requestu, ne při startu

### Fáze 4 — Admin page redesign: sidebar layout ✅ Dokončeno

**Odhadovaný čas: 2 hod**

Soubory:
- `apps/web/src/pages/Admin.tsx` — kompletní refactor layoutu
- `apps/web/src/pages/Admin.module.css` — nové styly (sidebar + content area)
- `apps/web/public/locales/{cs,en,sk}/pages.json` — nové překlady pro tab labels

Postup:
1. **TEST**: Admin page renderuje sidebar se sekcemi
2. **TEST**: Kliknutí na sidebar item změní aktivní sekci
3. **TEST**: URL hash sync (`/admin#countries`)
4. **IMPL**: Refactor `Admin.tsx`:
   - Definovat `AdminTab = 'services' | 'database' | 'countries' | 'export' | 'import' | 'logs'`
   - Sidebar navigace (kopie patternu z `Settings.tsx`)
   - Přesunout stávající sekce do podmíněného renderingu podle `activeTab`
   - Grid layout: `grid-template-columns: 220px 1fr`
5. **IMPL**: Styly — převzít z `Settings.module.css` pattern (`.sidebar`, `.sidebarItem`, `.sidebarItemActive`, `.contentArea`)
6. **IMPL**: Překlady — `admin_tab_services`, `admin_tab_database`, `admin_tab_countries`, `admin_tab_export`, `admin_tab_import`, `admin_tab_logs`

### Fáze 5 — Admin Countries sekce (UI) ✅ Dokončeno

**Odhadovaný čas: 2.5 hod**

Soubory:
- `apps/web/src/components/admin/CountriesManager.tsx`
- `apps/web/src/components/admin/CountriesManager.module.css`
- `apps/web/src/components/admin/CountriesManager.test.tsx`
- `apps/web/src/services/countryService.ts`
- `apps/web/src/services/countryService.test.ts`
- `apps/web/public/locales/{cs,en,sk}/pages.json` — překlady

Postup:

**Frontend service (`countryService.ts`):**
1. **TEST**: `listCountries()` zavolá správný NATS subject
2. **TEST**: `syncCountries()` zavolá admin subject
3. **TEST**: `updateCountry()` pošle správný payload
4. **IMPL**: Service funkce

**CountriesManager komponenta:**
1. **TEST**: Renderuje tabulku zemí
2. **TEST**: Tlačítko "Synchronizovat" zavolá `syncCountries()`
3. **TEST**: Po úspěšném syncu zobrazí výsledek (`added: X, updated: Y`)
4. **TEST**: Checkbox `has_map_coverage` zavolá `updateCountry()`
5. **TEST**: Checkbox `is_supported` zavolá `updateCountry()`
6. **IMPL**: Tabulka s columns: vlajka (emoji z kódu), kód, název, alpha3, has_map_coverage (toggle), is_supported (toggle), valhalla_region (text input), sort_order
7. **IMPL**: Tlačítko "Synchronizovat země z JSON" v hlavičce
8. **IMPL**: Výsledek syncu (success banner s počty)
9. **IMPL**: Search input nad tabulkou (filtruje client-side)

### Fáze 6 — Settings dropdown: výběr země tenantu ✅ Dokončeno

**Odhadovaný čas: 1.5 hod**

Soubory:
- `apps/web/src/components/common/CountrySelect.tsx`
- `apps/web/src/components/common/CountrySelect.module.css`
- `apps/web/src/components/common/CountrySelect.test.tsx`
- `packages/shared-types/src/settings.ts` — přidat `countryCode` do tenant settings

Postup:
1. **TEST**: `CountrySelect` renderuje placeholder, po kliknutí načte země
2. **TEST**: Typing do search filtru zúží seznam
3. **TEST**: Výběr země zavolá `onChange` s kódem
4. **IMPL**: Dropdown komponenta:
   - Na otevření: `await import('@sazinka/countries')` pro initial render, poté fetch z NATS pro aktuální `is_supported` filtr
   - Search input v dropdownu
   - Zobrazuje vlajku (emoji), lokalizovaný název, kód
   - `onChange(code: string)` callback
5. **IMPL**: Integrace do Settings → sekce "Firemné údaje" (business tab)

### Fáze 7 — Site contact form: country dropdown ✅ Dokončeno

**Odhadovaný čas: 1 hod**

Soubory:
- `apps/site/src/components/react/ContactForm.tsx`
- `apps/site/src/components/react/ContactForm.module.css`
- `apps/site/src/components/react/__tests__/ContactForm.test.tsx`
- `apps/site/functions/api/contact.ts`
- `apps/site/src/lib/validation.ts`

Postup:
1. **TEST**: ContactForm renderuje country dropdown
2. **TEST**: Dropdown se lazy-loadne při otevření
3. **TEST**: Search filtruje země
4. **TEST**: Submit odesílá `countryCode`
5. **IMPL**: Přidat `CountrySelect` do ContactForm (inline nebo import z `@sazinka/countries`)
6. **IMPL**: Přidat `country_code TEXT` do D1 contacts tabulky
7. **IMPL**: Aktualizovat validaci (`validation.ts`) — `countryCode` optional
8. **IMPL**: Aktualizovat `contact.ts` edge function — ukládat `country_code`

### Fáze 8 — Dokumentace a commit ✅ Dokončeno

**Odhadovaný čas: 0.5 hod**

- Aktualizovat tento dokument s výsledky implementace
- Commit a push po každé fázi

## 4. Rozhodnutí

| # | Otázka | Rozhodnutí |
|---|---|---|
| 1 | Kde žijí kanonická data? | `packages/countries/countries.json` — vlastní soubor v monorepu |
| 2 | Jak se data dostanou do PG? | Admin UI → NATS → Rust handler čte embedded JSON → UPSERT |
| 3 | Přepisuje sync provozní sloupce? | **NE** — sync mění pouze name/alpha3, nikdy has_map_coverage aj. |
| 4 | Kdo může spouštět sync? | Pouze admin (role check v handleru) |
| 5 | Jak site konzumuje data? | `await import('@sazinka/countries')` — lazy JS chunk, žádná DB |
| 6 | Jak app konzumuje data v dropdown? | NATS `sazinka.countries.list` → PG, filtrováno na `is_supported` |
| 7 | Kde se embed JSON do Rustu? | `include_str!()` v handler modulu |
| 8 | Admin page layout | Sidebar + content area, identický pattern jako Settings |
| 9 | Zobrazení vlajek | Emojis (nejjednodušší; na Windows se zobrazí jako kód, což je akceptovatelné) |

## 5. Pořadí implementace

1. **Fáze 1** — `packages/countries` (1 hod) — základ, na kterém staví vše
2. **Fáze 2** — DB migrace + Rust typy (1.5 hod)
3. **Fáze 3** — Rust queries + handlers (2 hod)
4. **Fáze 4** — Admin page redesign: sidebar (2 hod) — předpoklad pro fázi 5
5. **Fáze 5** — Admin Countries sekce (2.5 hod)
6. **Fáze 6** — Settings country dropdown (1.5 hod)
7. **Fáze 7** — Site contact form dropdown (1 hod)
8. **Fáze 8** — Dokumentace (0.5 hod)

**Celkový odhad: ~12 hodin**

## 6. Stav implementace

| Fáze | Stav |
|---|---|
| 1 — packages/countries | ✅ Dokončeno |
| 2 — DB migrace + Rust typy | ✅ Dokončeno |
| 3 — Rust queries + handlers | ✅ Dokončeno |
| 4 — Admin page redesign | ⬜ Nezapočato |
| 5 — Admin Countries sekce | ⬜ Nezapočato |
| 6 — Settings country dropdown | ⬜ Nezapočato |
| 7 — Site contact form | ⬜ Nezapočato |
| 8 — Dokumentace | ⬜ Nezapočato |

---

# Admin Account Security — Backdoor Removal Plan (TDD)

## Problem Statement

The Rust worker contains `ensure_dev_admin_password()` in `worker/src/db/mod.rs`.
This function:

1. Checks if `DEV_MODE` env var is set
2. Looks up the hardcoded admin UUID `00000000-0000-0000-0000-000000000001`
3. If the password hash is not a valid argon2 hash, replaces it with a hash of a
   password read from `DEV_ADMIN_PASSWORD` env var

**Current risk:** The function runs on every worker startup. If someone deploys
with `DEV_MODE=true` and `DEV_ADMIN_PASSWORD` set, the admin password is
silently overwritten. The hardcoded UUID is a well-known constant.

**Goal:** Remove all dev-only backdoor code paths. Admin account creation and
password management must go through the standard auth flow only.

## Current State (after initial fix)

- `ensure_dev_admin_password` reads password from `DEV_ADMIN_PASSWORD` env var
  instead of hardcoding `"password123"` in the binary (fixed 2026-02-22)
- `reset_database()` preserves the calling admin's row (including their real
  password hash) so the session survives a DB reset (fixed 2026-02-22)
- The hardcoded UUID `00000000-0000-0000-0000-000000000001` is still referenced
  in `ensure_dev_admin_password` and migration fallback paths

## Architecture After Removal

```
┌─────────────────────────────────────────────────────┐
│ First-run setup (no users in DB)                    │
│                                                     │
│  Worker detects empty users table on startup        │
│  → Reads ADMIN_EMAIL + ADMIN_PASSWORD from env      │
│  → Creates admin user with hashed password           │
│  → Creates tenant + links user                      │
│  → Logs "Initial admin created" and continues       │
│                                                     │
│  Subsequent startups: users table is not empty       │
│  → No action taken, no env vars checked             │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Password reset (forgot password)                    │
│                                                     │
│  Option A: CLI tool                                 │
│    cargo run --bin reset-password -- --email X      │
│    Prompts for new password, hashes, updates DB     │
│                                                     │
│  Option B: NATS admin endpoint                      │
│    sazinka.admin.user.reset-password                │
│    Requires existing admin JWT                      │
│    Hashes new password, updates target user          │
└─────────────────────────────────────────────────────┘
```

## TDD Implementation Plan

### Phase 1 — First-run admin seeding (replaces ensure_dev_admin_password)

**Files:**
- `worker/src/db/mod.rs` — new `seed_initial_admin()`
- `worker/src/db/mod.rs` — remove `ensure_dev_admin_password()`
- `worker/src/main.rs` — call `seed_initial_admin()` instead

**Tests (RED):**
1. `test_seed_creates_admin_when_no_users` — empty users table + env vars set
   → admin user created with correct email, valid argon2 hash, role = 'admin'
2. `test_seed_creates_tenant_and_links` — after seeding, `user_tenants` has one
   row linking the new admin to a tenant
3. `test_seed_skips_when_users_exist` — users table has ≥1 row → no action,
   env vars not even read
4. `test_seed_fails_gracefully_without_env` — empty users table but no
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` → logs warning, does not panic
5. `test_seed_rejects_weak_password` — password shorter than 8 chars → error

**Implementation (GREEN):**
```rust
pub async fn seed_initial_admin(pool: &PgPool) -> Result<()> {
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(pool).await?;
    if count.0 > 0 {
        return Ok(()); // Not first run
    }

    let email = std::env::var("ADMIN_EMAIL")
        .context("ADMIN_EMAIL required for first-run setup")?;
    let password = std::env::var("ADMIN_PASSWORD")
        .context("ADMIN_PASSWORD required for first-run setup")?;

    anyhow::ensure!(password.len() >= 8, "ADMIN_PASSWORD must be >= 8 characters");

    let hash = crate::auth::hash_password(&password)?;
    // INSERT user, INSERT tenant, INSERT user_tenants ...
}
```

**Refactor:**
- Remove `DEV_MODE` and `DEV_ADMIN_PASSWORD` from `.env.example`
- Add `ADMIN_EMAIL` and `ADMIN_PASSWORD` to `.env.example` with comment:
  "Only used on first run when users table is empty"

### Phase 2 — Remove hardcoded UUID

**Files:**
- `worker/src/db/mod.rs` — `seed_initial_admin` uses `Uuid::new_v4()`
- `worker/src/handlers/admin.rs` — `reset_database` no longer references any
  hardcoded UUID (it receives `caller_id` from JWT)
- `worker/migrations/002_add_auth_fields.sql` — audit; the migration references
  the UUID but migrations are immutable, so this is acceptable

**Tests (RED):**
1. `test_seed_generates_random_uuid` — two calls to seed (on separate DBs)
   produce different UUIDs
2. `test_reset_preserves_any_admin_uuid` — reset with a non-well-known UUID
   still preserves the admin row correctly

**Implementation (GREEN):**
- Replace `Uuid::parse_str("00000000-...")` with `Uuid::new_v4()` in seeding
- `reset_database` already uses `caller_id` from JWT (done 2026-02-22)

### Phase 3 — Admin password reset endpoint

**Files:**
- `worker/src/handlers/admin.rs` — new handler
- `worker/src/handlers/mod.rs` — register subscription
- `packages/shared-types/src/auth.ts` — request/response types
- `apps/web/src/pages/Admin.tsx` — UI for resetting another user's password

**NATS subject:** `sazinka.admin.user.reset-password`

**Tests (RED):**
1. `test_reset_password_requires_admin_role` — non-admin caller → FORBIDDEN
2. `test_reset_password_updates_hash` — admin calls with target user_id +
   new_password → target user's hash is updated to valid argon2
3. `test_reset_password_rejects_weak` — password < 8 chars → error
4. `test_reset_password_unknown_user` — target user_id not found → error

**Implementation (GREEN):**
```rust
async fn handle_admin_reset_password(...) {
    // auth check (admin only)
    // validate new_password length
    // hash_password(new_password)
    // UPDATE users SET password_hash = $1 WHERE id = $2
}
```

### Phase 4 — CLI password reset tool (optional)

**Files:**
- `worker/src/bin/reset_password.rs` — standalone binary

**Tests (RED):**
1. `test_cli_updates_password_by_email` — given valid email → hash updated
2. `test_cli_fails_for_unknown_email` — unknown email → error message

**Implementation (GREEN):**
```rust
// cargo run --bin reset-password -- --email admin@example.com
fn main() {
    // parse args, connect to DB, prompt for password, hash, update
}
```

### Phase 5 — Cleanup and documentation

**Tasks:**
1. Remove `DEV_MODE` env var handling from all code paths
2. Remove `DEV_ADMIN_PASSWORD` env var
3. Audit `rg "00000000-0000-0000-0000-000000000001"` — remove all references
   except immutable migration files
4. Update `README.md` first-run instructions:
   ```
   # First run:
   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=your-secure-password cargo run
   ```
5. Update `PRJ_CONTEXT.MD` and `PRJ_SECURITY.MD`

## Implementation Order

| Phase | Scope | Estimated Time |
|-------|-------|----------------|
| 1 — First-run seeding | Replace backdoor with clean first-run flow | 2 hrs |
| 2 — Remove hardcoded UUID | Use random UUIDs everywhere | 1 hr |
| 3 — Admin password reset | NATS endpoint for admin to reset passwords | 2 hrs |
| 4 — CLI tool (optional) | Standalone binary for emergency resets | 1 hr |
| 5 — Cleanup | Remove DEV_MODE, audit, docs | 1 hr |

**Total: ~7 hours**

## Security Checklist

- [ ] No passwords hardcoded in source code
- [ ] No well-known UUIDs used for authentication decisions
- [ ] `DEV_MODE` env var removed entirely
- [ ] First-run env vars (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) only read when
      users table is empty
- [ ] Password reset requires valid admin JWT or direct DB access
- [ ] All password hashing uses argon2id with current best-practice parameters
- [ ] Audit: `rg "password123|DEV_MODE|DEV_ADMIN" worker/src/` returns zero
      matches

---

## Secrets Management — SOPS + age

### Overview

All secrets (database passwords, JWT keys, NATS credentials) are encrypted with
[SOPS](https://github.com/getsops/sops) + [age](https://github.com/FiloSottile/age)
and stored in git. No plaintext secrets ever enter the repository. The same
toolchain works identically in local development, staging, and production.

### Architecture

```
  Git Repository
  ├── .sops.yaml                       ← which keys can decrypt which files
  └── infra/secrets/
      ├── .gitignore                   ← *.dec never enters git
      ├── .env.dev.enc                 ← encrypted dev secrets
      ├── .env.staging.enc             ← encrypted staging secrets
      └── .env.production.enc          ← encrypted production secrets

  Developer machine / Server
  └── ~/.config/sops/age/keys.txt      ← private key (NEVER in git)

  Workflow
  ┌───────────────────┐     sops decrypt     ┌──────────────────────┐
  │ .env.staging.enc  │ ──────────────────► │ .env.staging.dec     │
  │ (in git, safe)    │                      │ (gitignored, tmpfs)  │
  └───────────────────┘                      └──────────┬───────────┘
                                                        │
                                        docker compose --env-file
                                                        │
                                                        ▼
                                              ┌──────────────────┐
                                              │ Running services │
                                              └──────────────────┘
```

### Key Management

| Entity | Has private key | Can decrypt |
|--------|----------------|-------------|
| Lead developer | Yes | dev, staging, production |
| Developer | Yes | dev, staging |
| CI server | Yes | staging (for deploy) |
| Staging server | Yes | staging |
| Production server | Yes | production |

Adding a team member:
1. They run `age-keygen` and share their **public** key
2. Team lead adds the public key to `.sops.yaml`
3. Run `sops updatekeys` on affected files
4. Commit

Removing a team member:
1. Remove their public key from `.sops.yaml`
2. Run `sops updatekeys` on affected files
3. **Rotate all secrets** they had access to
4. Commit + deploy

### Environments

| Environment | Docker Compose file | Secrets file | Notes |
|-------------|-------------------|--------------|-------|
| dev | `docker-compose.yml` | `.env.dev.enc` | Hardcoded defaults still work without decryption for quick start |
| staging | `docker-compose.yml` + `docker-compose.staging.yml` | `.env.staging.enc` | Real passwords, no TLS (Caddy handles TLS) |
| production | `docker-compose.yml` + `docker-compose.production.yml` | `.env.production.enc` | Real passwords, hardened config |

### Daily Commands

```bash
# Decrypt secrets for an environment
make secrets ENV=dev

# Start stack with decrypted secrets
make up ENV=staging

# Edit secrets (opens in $EDITOR, re-encrypts on save)
make secrets-edit ENV=production

# Rotate a secret
make secrets-edit ENV=production    # change the value
git add infra/secrets/.env.production.enc
git commit -m "security: rotate production JWT_SECRET"

# Tear down
make down

# Clean up decrypted files
make secrets-clean
```

### Kubernetes Migration Path

When migrating to K8s, the same encrypted files work via:
- **kustomize + SOPS plugin**: generates K8s Secret resources at deploy time
- **SOPS Secrets Operator**: CRD-based, auto-decrypts in-cluster

No changes to the encrypted files or key management required.

### Implementation Checklist

- [x] Install sops + age on dev machine
- [x] Generate age key pair for dev machine
- [x] Create `.sops.yaml` at repo root
- [x] Create `infra/secrets/` with `.gitignore`
- [x] Create and encrypt `.env.dev.enc`, `.env.staging.enc`, `.env.production.enc`
- [x] Create `Makefile` with secrets/up/down/edit targets
- [x] Update `docker-compose.yml` to use `${VAR}` everywhere (no hardcoded sensitive defaults)
- [x] Update `.gitignore` for `*.dec`, `*.enc.bak`
- [x] Update `PRJ_DEVOPS.MD` with secrets workflow
- [ ] Provision age key on staging server (manual)
- [ ] Provision age key on production server (manual)
- [ ] Set `SOPS_AGE_KEY_FILE` in deploy scripts (manual)
- [ ] Set frontend env vars in Cloudflare Pages dashboard (manual)
