# Datový model – Analýza a cílový stav

> **Verze:** 1.0.0  
> **Datum:** 2026-01-25

## Obsah

1. [Přehled](#1-přehled)
2. [Aktuální stav – schéma databáze](#2-aktuální-stav--schéma-databáze)
3. [Problémy aktuálního stavu](#3-problémy-aktuálního-stavu)
4. [Cílový stav – schéma databáze](#4-cílový-stav--schéma-databáze)
5. [Vazba na import (CSV)](#5-vazba-na-import-csv)
6. [Migrační plán](#6-migrační-plán)

---

## 1. Přehled

Sazinka je systém pro správu revizí plynových zařízení, komínů a dalších technických zařízení. Datový model musí podporovat:

- **Zákazníky** (osoby i firmy) s adresami a geokódováním
- **Zařízení** (kotle, komíny, krby...) s revizním intervalem
- **Revizní povinnosti** (periodická nutnost kontroly zařízení dle zákona)
- **Návštěvy** (fyzické cesty k zákazníkovi, při kterých se provádí práce)
- **Pracovní úkony** (co se při návštěvě konkrétně dělalo na jakém zařízení)
- **Komunikaci** (hovory, e-maily, SMS, poznámky)
- **Posádky** (technici/skupiny přiřazené k práci)
- **Trasy** (denní plány cest s optimalizací)

---

## 2. Aktuální stav – schéma databáze

### 2.1 Tabulka `users`

```
users
├── id                              UUID PK
├── email                           VARCHAR(255) NOT NULL UNIQUE
├── password_hash                   VARCHAR(255) NOT NULL
├── name                            VARCHAR(255) NOT NULL
├── phone                           VARCHAR(50)
├── business_name                   VARCHAR(255)
├── street                          VARCHAR(255)
├── city                            VARCHAR(100)
├── postal_code                     VARCHAR(20)
├── country                         VARCHAR(10) DEFAULT 'CZ'
├── lat                             DOUBLE PRECISION
├── lng                             DOUBLE PRECISION
├── ico                             VARCHAR(20)
├── dic                             VARCHAR(20)
├── default_revision_interval_months INTEGER DEFAULT 12
├── default_service_duration_minutes INTEGER DEFAULT 30
├── working_hours_start             TIME DEFAULT '08:00'
├── working_hours_end               TIME DEFAULT '17:00'
├── max_revisions_per_day           INTEGER DEFAULT 12
├── reminder_days_before            INTEGER[] DEFAULT '{30, 14, 7}'
├── email_subject_template          TEXT
├── email_body_template             TEXT
├── created_at                      TIMESTAMPTZ
└── updated_at                      TIMESTAMPTZ
```

**Poznámky:**

| Sloupec | Problém |
|---------|---------|
| `phone` | `VARCHAR(50)` – zbytečně velký, E.164 max 15 číslic + prefix `+` = max 16 znaků. `VARCHAR(20)` stačí. |
| `country` | `VARCHAR(10)` – ISO 3166-1 alpha-2 má vždy 2 znaky. `CHAR(2)` by byl přesnější. Není kritické. |
| `default_revision_interval_months` | Patří spíše do nastavení/konfigurace, ne do user tabulky. |
| `max_revisions_per_day` | Název neodpovídá skutečnosti – jde o maximum **návštěv** (nejen revizí) za den. |
| `reminder_days_before` | PostgreSQL `INTEGER[]` – je to v pořádku, ale sdílení s frontendem je komplikovanější. |

### 2.2 Tabulka `customers`

```
customers
├── id                UUID PK
├── user_id           UUID FK → users NOT NULL
├── customer_type     customer_type ENUM('person','company') DEFAULT 'person'
├── name              VARCHAR(255) NOT NULL                ← problém
├── contact_person    VARCHAR(255)
├── ico               VARCHAR(20)
├── dic               VARCHAR(20)
├── email             VARCHAR(255)
├── phone             VARCHAR(50)
├── phone_raw         VARCHAR(100)
├── street            VARCHAR(255) NOT NULL                ← problém
├── city              VARCHAR(100) NOT NULL                ← problém
├── postal_code       VARCHAR(20) NOT NULL                 ← problém
├── country           VARCHAR(10) DEFAULT 'CZ'
├── lat               DOUBLE PRECISION
├── lng               DOUBLE PRECISION
├── geocode_status    VARCHAR(20)                          ← problém
├── notes             TEXT
├── created_at        TIMESTAMPTZ
└── updated_at        TIMESTAMPTZ
```

**Problémy:**

| Sloupec | Aktuální typ | Problém | Doporučení |
|---------|-------------|---------|------------|
| `name` | `VARCHAR(255) NOT NULL` | Zákazník může mít zcela prázdnou adresu i jméno (stačí email/phone). `NOT NULL` brání importu. | Změnit na `VARCHAR(255) NULL` |
| `street` | `VARCHAR(255) NOT NULL` | Zákazník může mít zcela prázdnou adresu. | Změnit na `VARCHAR(255) NULL` |
| `city` | `VARCHAR(100) NOT NULL` | Zákazník může mít zcela prázdnou adresu. | Změnit na `VARCHAR(100) NULL` |
| `postal_code` | `VARCHAR(20) NOT NULL` | Zákazník může mít zcela prázdnou adresu. | Změnit na `VARCHAR(20) NULL` |
| `geocode_status` | `VARCHAR(20)` | Tříhodnotový stav (`pending`, `success`, `failed`) uložený jako volný string. Přestože to není boolean (má 3 stavy, ne 2), měl by to být ENUM pro typovou bezpečnost. Geocode status se neimportuje, je výsledek následného geocodingu. | `geocode_status_enum ENUM('pending','success','failed') DEFAULT 'pending'` |
| `phone` | `VARCHAR(50)` | Zbytečně velký. E.164 = max 16 znaků. | `VARCHAR(20)` |
| `country` | `VARCHAR(10)` | ISO alpha-2 = 2 znaky. | `CHAR(2) DEFAULT 'CZ'` – není kritické |

**Proč `geocode_status` nemůže být boolean:**

Hodnota `geocode_status` má 3 stavy:
- `pending` – adresa uložena, geokódování ještě neproběhlo
- `success` – geokódování úspěšné, lat/lng jsou vyplněny
- `failed` – geokódování selhalo (adresa nenalezena, API chyba)

Boolean by nedokázal rozlišit stav "ještě nezpracováno" od "zpracováno neúspěšně". Správný typ je **ENUM** (ne volný VARCHAR). Hodnota se neimportuje, vzniká z geocoding procesu po importu.

### 2.3 Tabulka `devices`

```
devices
├── id                        UUID PK
├── customer_id               UUID FK → customers NOT NULL
├── device_type               VARCHAR(50) NOT NULL
├── manufacturer              VARCHAR(100)
├── model                     VARCHAR(100)
├── serial_number             VARCHAR(100)
├── installation_date         DATE
├── revision_interval_months  INTEGER DEFAULT 12
├── notes                     TEXT
└── created_at                TIMESTAMPTZ
```

**Problémy:**

| Sloupec | Problém | Doporučení |
|---------|---------|------------|
| ~~`device_name`~~ | **Chybí!** `device_name` je klíčový identifikátor pro rozlišení zařízení jednoho zákazníka. Musí být povinný, pokud má zákazník více zařízení, bez ohledu na `serial_number`. Chybějící hodnoty při importu se mají nahradit generovaným názvem (např. „Zařízení 1“) a vyvolat varování. | Přidat `device_name VARCHAR(100)` + pravidlo generování |
| `device_type` | `VARCHAR(50)` – volný string místo ENUM. Riziko nekonzistentních hodnot. | `device_type_enum ENUM(...)` |
| `user_id` | **Chybí!** Zařízení nemá přímý FK na uživatele, vazba je pouze přes `customer_id`. Při dotazech to vyžaduje vždy JOIN přes customers. | Zvážit přidání `user_id UUID FK → users` pro přímé dotazy |
| `updated_at` | **Chybí!** Ostatní tabulky mají `updated_at` s triggerem, devices ne. | Přidat `updated_at TIMESTAMPTZ` s triggerem |
| Unikátní index | **Chybí!** Žádný unikátní index na `(customer_id, serial_number)` ani `(customer_id, device_type, device_name)`. Import duplikátní detekce spoléhá na aplikační logiku. | Přidat UNIQUE indexy |

**Kritický problém – `device_name`:** Import specifikace (IMPORT_FORMAT.MD, sekce 11.6 a 15.3) definuje hierarchii identifikace zařízení: `serial_number` → `device_name` → `device_type` (pokud jen 1 zařízení typu). Navíc `device_name` je povinný, pokud má zákazník více zařízení, i když je vyplněn `serial_number`. Ale:
- Sloupec `device_name` v databázi **neexistuje**
- `resolve_device_ref()` hledá **pouze** podle `serial_number`
- Pokud zařízení nemá sériové číslo (komíny, krby), `device_ref` v CSV (např. `"Komín na chalupě"`) se nikdy nenajde

### 2.4 Tabulka `revisions`

```
revisions
├── id                      UUID PK
├── device_id               UUID FK → devices NOT NULL
├── customer_id             UUID FK → customers NOT NULL
├── user_id                 UUID FK → users NOT NULL
├── status                  VARCHAR(20) DEFAULT 'upcoming'
├── due_date                DATE NOT NULL
├── scheduled_date          DATE
├── scheduled_time_start    TIME
├── scheduled_time_end      TIME
├── completed_at            TIMESTAMPTZ
├── duration_minutes        INTEGER
├── result                  VARCHAR(20)
├── findings                TEXT
├── snooze_until            DATE
├── snooze_reason           VARCHAR(255)
├── assigned_crew_id        UUID FK → crews
├── route_order             INTEGER
├── created_at              TIMESTAMPTZ
└── updated_at              TIMESTAMPTZ
```

**Problémy:**

| Sloupec | Problém | Doporučení |
|---------|---------|------------|
| `status` | `VARCHAR(20)` – volný string. V Rust kódu existuje `RevisionStatus` enum, ale v DB je to string. Hodnoty `upcoming`, `due_soon`, `overdue`, `scheduled`, `confirmed`, `completed`, `cancelled` – kde `due_soon` a `overdue` jsou **vypočítané** stavy, neměly by se ukládat. | ENUM se stavy: `upcoming`, `scheduled`, `confirmed`, `completed`, `cancelled` |
| `result` | `VARCHAR(20)` – měl by být ENUM: `passed`, `conditional`, `failed`. | ENUM |
| Duplicitní index | **Chybí!** Spec říká: revize je duplicitní pokud `device_id + due_date` je stejné. Žádný UNIQUE index. | `UNIQUE(device_id, due_date)` |
| Příští termín | Po provedení revize se má **okamžitě** vypočítat a persistovat datum příští revize. V aktuálním modelu není explicitní pole. | Přidat `next_due_date` na zařízení nebo revizi (viz cílový stav) |

**Kritický problém – import ignoruje stav a výsledek:**

Funkce `create_revision()` v `revision.rs` **hardcoduje** `status = 'upcoming'` a nepřijímá parametry `status`, `completed_at`, `duration_minutes`, `result`. To znamená:

- CSV řádek: `status=completed, result=passed, completed_at=2024-01-11T18:23:00, duration_minutes=60`
- V databázi: `status='upcoming', completed_at=NULL, duration_minutes=NULL, result=NULL`

**Celá historie dokončených revizí se při importu ztrácí.**

### 2.5 Tabulka `visits`

```
visits
├── id                    UUID PK
├── user_id               UUID FK → users NOT NULL
├── customer_id           UUID FK → customers NOT NULL
├── revision_id           UUID FK → revisions (nullable)
├── scheduled_date        DATE NOT NULL
├── scheduled_time_start  TIME
├── scheduled_time_end    TIME
├── status                VARCHAR(20) DEFAULT 'planned'
├── visit_type            VARCHAR(30) DEFAULT 'revision'
├── actual_arrival        TIMESTAMPTZ
├── actual_departure      TIMESTAMPTZ
├── result                VARCHAR(30)
├── result_notes          TEXT
├── requires_follow_up    BOOLEAN DEFAULT FALSE
├── follow_up_reason      TEXT
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
```

**Problémy:**

| Sloupec | Problém | Doporučení |
|---------|---------|------------|
| `status` | `VARCHAR(20)` – měl by být ENUM | ENUM |
| `visit_type` | `VARCHAR(30)` – měl by být ENUM | ENUM |
| `result` | `VARCHAR(30)` – měl by být ENUM | ENUM |
| `revision_id` | Návštěva odkazuje na jednu revizi. Ale při jedné návštěvě se může udělat více úkonů (revize kotle + oprava komínu). | Viz cílový model – vazba přes `visit_work_items` |
| `device_id` | **Chybí!** Návštěva nemá přímou vazbu na zařízení. Jen nepřímo přes `revision_id`. Co návštěvy typu `repair`, `installation`? | Přidat `device_id` nebo vazební tabulku |

**Kritický problém – import ignoruje většinu polí:**

Import procesor (`import_processors.rs`) volá `queries::visit::create_visit()`, která hardcoduje `status='planned'` a `requires_follow_up=FALSE`. Ignorované sloupce z CSV:
- `status` (např. `completed`, `rescheduled`)
- `result` (např. `successful`, `partial`, `failed`)
- `result_notes`
- `requires_follow_up`
- `follow_up_reason`

Přitom existuje funkce `queries::import::create_visit_import()`, která všechna tato pole správně přijímá – ale import procesor ji **nepoužívá**.

### 2.6 Tabulka `communications`

```
communications
├── id                UUID PK
├── user_id           UUID FK → users NOT NULL
├── customer_id       UUID FK → customers NOT NULL
├── revision_id       UUID FK → revisions (nullable)
├── comm_type         VARCHAR(20) NOT NULL
├── direction         VARCHAR(10) NOT NULL
├── subject           VARCHAR(255)
├── content           TEXT NOT NULL
├── contact_name      VARCHAR(255)
├── contact_phone     VARCHAR(50)
├── email_status      VARCHAR(20)
├── duration_minutes  INTEGER
├── follow_up_date    DATE
├── follow_up_completed BOOLEAN DEFAULT FALSE
└── created_at        TIMESTAMPTZ
```

**Problémy:**

| Sloupec | Problém |
|---------|---------|
| `comm_type` | `VARCHAR(20)` – měl by být ENUM |
| `direction` | `VARCHAR(10)` – měl by být ENUM |
| `email_status` | `VARCHAR(20)` – měl by být ENUM |
| `updated_at` | **Chybí!** |

### 2.7 Tabulka `crews`

```
crews
├── id                  UUID PK
├── user_id             UUID FK → users NOT NULL
├── name                VARCHAR(100) NOT NULL
├── home_depot_id       UUID FK → depots (nullable)
├── preferred_areas     TEXT[] DEFAULT '{}'
├── working_hours_start TIME DEFAULT '08:00'
├── working_hours_end   TIME DEFAULT '17:00'
├── is_active           BOOLEAN DEFAULT TRUE
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
```

**Bez zásadních problémů.** Drobnosti:

| Sloupec | Poznámka |
|---------|----------|
| `preferred_areas` | `TEXT[]` – v pořádku pro PostgreSQL, ale ztěžuje portabilitu na jiné DB. |

### 2.8 Tabulka `depots`

```
depots
├── id          UUID PK
├── user_id     UUID FK → users NOT NULL
├── name        VARCHAR(100) NOT NULL
├── street      VARCHAR(255)
├── city        VARCHAR(100)
├── postal_code VARCHAR(20)
├── country     VARCHAR(10) DEFAULT 'CZ'
├── lat         DOUBLE PRECISION NOT NULL
├── lng         DOUBLE PRECISION NOT NULL
├── is_primary  BOOLEAN DEFAULT FALSE
├── created_at  TIMESTAMPTZ
└── updated_at  TIMESTAMPTZ
```

**Bez zásadních problémů.** Unikátní index na `(user_id) WHERE is_primary = true` je správně.

### 2.9 Tabulka `routes`

```
routes
├── id                      UUID PK
├── user_id                 UUID FK → users NOT NULL
├── date                    DATE NOT NULL
├── status                  VARCHAR(20) DEFAULT 'draft'
├── total_distance_km       DOUBLE PRECISION
├── total_duration_minutes  INTEGER
├── optimization_score      INTEGER
├── created_at              TIMESTAMPTZ
├── updated_at              TIMESTAMPTZ
└── UNIQUE(user_id, date)
```

**Problémy:**

| Sloupec | Problém |
|---------|---------|
| `status` | `VARCHAR(20)` – měl by být ENUM |
| `crew_id` | **Chybí!** Trasa není přiřazena posádce. `UNIQUE(user_id, date)` brání mít dvě trasy pro různé posádky ve stejný den. | 

### 2.10 Tabulka `route_stops`

```
route_stops
├── id                             UUID PK
├── route_id                       UUID FK → routes NOT NULL
├── revision_id                    UUID FK → revisions NOT NULL    ← problém
├── stop_order                     INTEGER NOT NULL
├── estimated_arrival              TIME
├── estimated_departure            TIME
├── distance_from_previous_km      DOUBLE PRECISION
├── duration_from_previous_minutes INTEGER
├── status                         VARCHAR(20) DEFAULT 'pending'
├── actual_arrival                 TIMESTAMPTZ
├── actual_departure               TIMESTAMPTZ
└── UNIQUE(route_id, stop_order)
```

**Problémy:**

| Sloupec | Problém |
|---------|---------|
| `revision_id` | Zastávka je vázána na **revizi**, ne na **zákazníka** nebo **návštěvu**. To brání plánování tras pro opravy, instalace atd. |
| `status` | `VARCHAR(20)` – měl by být ENUM |

---

## 3. Problémy aktuálního stavu

### 3.1 Sémantická redundance: `revisions` vs `visits`

Aktuální model má dvě oddělené tabulky, které popisují téměř totéž:

| Aspekt | `revisions` | `visits` |
|--------|-------------|----------|
| Co popisuje | Revize zařízení (povinnost + provedení) | Návštěva u zákazníka |
| Vazba na zařízení | `device_id` (povinná) | Žádná (nepřímo přes `revision_id`) |
| Plánování | `scheduled_date`, `time_start`, `time_end` | `scheduled_date`, `time_start`, `time_end` |
| Výsledek | `result` (passed/conditional/failed) | `result` (successful/partial/failed/...) |
| Stav | `status` (upcoming/.../completed) | `status` (planned/.../completed) |
| Import | `revisions.csv` | `visits.csv` |

**Důsledek:** Pokud posádka reviduje kotel zákazníka, musí to být zapsáno **dvakrát** – jako revize v `revisions` a jako návštěva typu `revision` v `visits`. Neexistuje propojení mezi nimi (kromě volitelného `revision_id` ve `visits`).

### 3.2 Chybějící koncept "návštěva jako fyzická cesta"

Aktuální model nerozlišuje:
- **Co se musí udělat** (revize kotle do 15.3.2026) = povinnost/zakázka
- **Kdy a kam se jede** (15.3.2026 v 9:00 k zákazníkovi Novák) = návštěva
- **Co se tam udělalo** (revidoval kotel + opravil komín) = pracovní úkon

Příklad ze života: Posádka jede k zákazníkovi, který má kotel a komín. Při jedné návštěvě:
1. Reviduje kotel (revize) → výsledek: `passed`
2. Opravuje komín (oprava) → výsledek: `partial`

V aktuálním modelu:
- V `revisions` → 1 záznam pro kotel
- V `visits` → 2 záznamy? 1 záznam? Jak propojit s opravou komínu?

### 3.3 Chybějící `device_name` v databázi

Import specifikace (IMPORT_FORMAT.MD) definuje `device_name` jako lidsky čitelný identifikátor zařízení. Databáze tento sloupec nemá. `resolve_device_ref()` hledá pouze podle `serial_number`, takže reference typu `"Komín na chalupě"` nebo `"Ohřívač koupelna"` v CSV se nikdy nenajdou.

### 3.4 Volné stringy místo ENUM

Většina "typových" sloupců je `VARCHAR(20/30)` místo PostgreSQL ENUM. To umožňuje nekonzistentní data (překlepy, neznámé hodnoty). Dotčené sloupce:

- `customers.geocode_status`
- `devices.device_type`
- `revisions.status`, `revisions.result`
- `visits.status`, `visits.visit_type`, `visits.result`
- `communications.comm_type`, `communications.direction`, `communications.email_status`
- `routes.status`
- `route_stops.status`

### 3.5 Nekonzistentní NOT NULL omezenÍ

Tabulka `customers` má `name`, `street`, `city`, `postal_code` jako `NOT NULL`, ale import specifikace explicitně povoluje zákazníky s minimálními daty (jen email, jen telefon). To znamená, že import procesor musí buď:
- Vkládat placeholder hodnoty (to se děje – `name` je prázdný string pokud chybí)
- Nebo selhávat při vložení (porušení NOT NULL)

### 3.6 Trasy nemají vazbu na posádku

Tabulka `routes` má `UNIQUE(user_id, date)`, ale nemá `crew_id`. To znamená, že uživatel může mít **maximálně jednu trasu** za den. Pokud má dvě posádky, nemůže pro ně naplánovat dvě trasy na stejný den.

### 3.7 Route stops vázané na revisions, ne na zákazníky

`route_stops.revision_id` je `NOT NULL FK → revisions`. To brání plánování tras pro návštěvy, které nejsou revize (opravy, instalace, konzultace).

---

## 4. Cílový stav – schéma databáze

### 4.1 Principy návrhu

1. **Jasné oddělení:** povinnost (co se musí) ≠ návštěva (kam se jede) ≠ úkon (co se tam dělalo)
2. **ENUM místo VARCHAR:** pro typové sloupce
3. **Nullable kde dává smysl:** žádné falešné NOT NULL
4. **`device_name`** jako identifikátor zařízení
5. **Posádka na trase:** podpora více tras/posádek za den

### 4.2 Beze změny

Tabulky `users`, `depots`, `crews` zůstávají **beze změny** (pouze drobné vylepšení typů).

### 4.3 Tabulka `customers` (cílový stav)

```sql
-- Změny oproti aktuálnímu stavu:
-- 1. name, street, city, postal_code → nullable
-- 2. geocode_status → ENUM
-- 3. phone → VARCHAR(20)

CREATE TYPE geocode_status AS ENUM ('pending', 'success', 'failed');

ALTER TABLE customers
    ALTER COLUMN name DROP NOT NULL,
    ALTER COLUMN street DROP NOT NULL,
    ALTER COLUMN city DROP NOT NULL,
    ALTER COLUMN postal_code DROP NOT NULL;

-- geocode_status: migrace z VARCHAR na ENUM
ALTER TABLE customers
    ALTER COLUMN geocode_status TYPE geocode_status
    USING geocode_status::geocode_status;
```

### 4.4 Tabulka `devices` (cílový stav)

```sql
-- Změny:
-- 1. Přidat device_name
-- 2. Přidat user_id pro přímé dotazy
-- 3. Přidat updated_at
-- 4. Přidat next_due_date (persistovaný výpočet po revizi)
-- 5. device_type → ENUM
-- 6. Unikátní indexy

CREATE TYPE device_type_enum AS ENUM (
    'gas_boiler', 'gas_water_heater', 'chimney',
    'fireplace', 'gas_stove', 'other'
);

ALTER TABLE devices
    ADD COLUMN device_name VARCHAR(100),
    ADD COLUMN user_id UUID REFERENCES users(id),
    ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN next_due_date DATE;

-- Unikátní index pro sériové číslo (v rámci zákazníka)
CREATE UNIQUE INDEX idx_devices_serial
    ON devices(customer_id, serial_number)
    WHERE serial_number IS NOT NULL;

-- Unikátní index pro device_name + device_type (v rámci zákazníka)
CREATE UNIQUE INDEX idx_devices_name_type
    ON devices(customer_id, device_type, device_name)
    WHERE device_name IS NOT NULL;
```

### 4.5 Tabulka `revisions` (revizní povinnosti)

**Koncepční změna:** Tabulka `revisions` popisuje **povinnost** (právní nutnost provést kontrolu), nikoliv fyzickou návštěvu. Je to "zakázka" – co se musí udělat.

```sql
-- Cílová struktura (po migraci):

CREATE TYPE revision_status AS ENUM (
    'upcoming',     -- povinnost existuje, ještě nenaplánována
    'scheduled',    -- termín domluven
    'confirmed',    -- zákazníkem potvrzeno
    'completed',    -- splněno (proveden pracovní úkon)
    'cancelled'     -- zrušeno
);

CREATE TYPE revision_result AS ENUM (
    'passed',       -- v pořádku
    'conditional',  -- s výhradami
    'failed'        -- nevyhovělo
);

-- Hlavní změny oproti aktuálnímu stavu:
-- 1. status, result → ENUM
-- 2. Přidán fulfilled_by_work_item_id → odkaz na konkrétní úkon, který revizi splnil
-- 3. UNIQUE(device_id, due_date) pro detekci duplicit

ALTER TABLE revisions
    ADD COLUMN fulfilled_by_work_item_id UUID;
    -- FK bude přidána po vytvoření tabulky visit_work_items

CREATE UNIQUE INDEX idx_revisions_device_due
    ON revisions(device_id, due_date);
```

**Důležité:** `completed_at`, `duration_minutes` a `result` zůstávají na revizi jako denormalizovaný výsledek (kopírováno z work_item pro rychlé dotazy). Ale autoritativní zdroj je `visit_work_items`. Po dokončení revize se má **okamžitě** přepočítat a persistovat `next_due_date` (na zařízení nebo na revizi podle zvoleného místa).

### 4.6 Tabulka `visits` (fyzické návštěvy)

**Koncepční změna:** Návštěva = fyzická cesta k zákazníkovi. Při jedné návštěvě se může provést více úkonů.

```sql
-- Cílová struktura:

CREATE TYPE visit_status AS ENUM (
    'planned',       -- naplánováno
    'in_progress',   -- probíhá
    'completed',     -- dokončeno
    'cancelled',     -- zrušeno
    'rescheduled'    -- přeplánováno
);

-- Hlavní změna: typ práce se přesouvá na work_item, návštěva je pouze "cesta k zákazníkovi"

-- visits tabulka zůstává podobná, ale:
-- 1. visit_type je považován za legacy (typ práce je na work_items)
-- 2. Odstraněn revision_id (nahrazen vazbou přes work_items)
-- 3. result se vyhodnocuje z work_items
-- 4. Přidán crew_id (volitelný, v importu nepovinný)
-- 5. Přidán device_id (volitelný, pro zpětnou kompatibilitu s jednoduchými případy)

ALTER TABLE visits
    ADD COLUMN crew_id UUID REFERENCES crews(id),
    ADD COLUMN device_id UUID REFERENCES devices(id),
    DROP COLUMN revision_id;
    -- visit_type může dočasně zůstat kvůli UI/API, ale cílově je autoritivní work_item
```

### 4.7 Nová tabulka `visit_work_items` (pracovní úkony)

```sql
CREATE TYPE work_type AS ENUM (
    'revision',       -- revize
    'repair',         -- oprava
    'installation',   -- instalace
    'consultation',   -- konzultace
    'follow_up'       -- následná kontrola
);

CREATE TYPE work_result AS ENUM (
    'successful',
    'partial',
    'failed',
    'customer_absent',
    'rescheduled'
);

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
CREATE INDEX idx_work_items_device ON visit_work_items(device_id);
CREATE INDEX idx_work_items_revision ON visit_work_items(revision_id);
```

**Příklad použití:**

Posádka jede k zákazníkovi `51647785` a provede dvě věci (s možností, že část práce udělá jiná posádka):

```
visits (1 řádek):
  id=V1, customer_id=C1, scheduled_date=2025-11-18, crew_id=CR1

visit_work_items (2 řádky):
  id=WI1, visit_id=V1, device_id=D1(komín), revision_id=R3, work_type=revision,
      result=passed, findings="Bez závad"
  id=WI2, visit_id=V1, device_id=D2(CH-112373), work_type=repair, crew_id=CR2,
      result=partial, findings="Opraveno, čeká se na díl", requires_follow_up=true
```

### 4.8 Tabulka `routes` (cílový stav)

```sql
-- Hlavní změna: přidán crew_id, UNIQUE změní se na (user_id, date, crew_id)

ALTER TABLE routes
    ADD COLUMN crew_id UUID REFERENCES crews(id);

-- Zrušit starý UNIQUE index
ALTER TABLE routes DROP CONSTRAINT routes_user_id_date_key;

-- Nový UNIQUE index – jedna trasa na posádku za den
CREATE UNIQUE INDEX idx_routes_user_date_crew
    ON routes(user_id, date, crew_id);

-- Poznámka: Trasa je plánovaná pro jednu posádku, ale work_items mohou být provedeny
-- i jinou posádkou (např. výpomoc). To se eviduje na work_item úrovni.
```

### 4.9 Tabulka `route_stops` (cílový stav)

```sql
-- Hlavní změna: revision_id → customer_id (zastávka = zákazník, ne revize)
-- Přidán visit_id pro propojení s návštěvou

ALTER TABLE route_stops
    ADD COLUMN customer_id UUID REFERENCES customers(id),
    ADD COLUMN visit_id UUID REFERENCES visits(id),
    ALTER COLUMN revision_id DROP NOT NULL;
    -- revision_id zůstává jako nullable pro zpětnou kompatibilitu
```

---

## 5. Vazba na import (CSV)

### 5.1 Aktuální import – co nefunguje

| CSV soubor | Problém |
|------------|---------|
| `revisions.csv` | Import hardcoduje `status='upcoming'`, ignoruje `status`, `completed_at`, `duration_minutes`, `result`. **Celá historie se ztrácí.** |
| `revisions.csv` | `resolve_device_ref()` hledá jen podle `serial_number`. Reference typu `"Komín na chalupě"` (device_name) nebo `"gas_boiler"` (device_type) se nenajdou. |
| `visits.csv` | Import volá `create_visit()` místo `create_visit_import()`. Hardcoduje `status='planned'`, ignoruje `status`, `result`, `result_notes`, `requires_follow_up`, `follow_up_reason`. |
| `visits.csv` | Neřeší propojení `device_ref` → `device_id`, protože tabulka `visits` sloupec `device_id` nemá. |

### 5.2 Aktuální import soubory vs cílový model

#### Problém redundance revisions.csv a visits.csv

Aktuální specifikace definuje **dva** soubory, které popisují překrývající se věci:

| `revisions.csv` | `visits.csv` |
|------------------|-------------|
| Revize kotle (povinnost + provedení) | Návštěva u zákazníka (typ: revision) |
| Vázána na zařízení (device_ref) | Může ale nemusí být vázána na zařízení |
| Stav: upcoming/scheduled/.../completed | Stav: planned/.../completed |
| Výsledek: passed/conditional/failed | Výsledek: successful/partial/failed/... |

**Problém:** Pokud zákazník má dvě zařízení a posádka je navštívila jednou, revizi jednoho zařízení zapíše do `revisions.csv`, ale opravu druhého do `visits.csv` (jako `visit_type=repair`). Neexistuje propojení, že to byla jedna návštěva.

#### Cílový stav importu

V cílovém modelu bude import **breaking change** a nebudeme migrovat stará data. Před implementací změn bude databáze smazána. Import soubory musí reflektovat nový datový model:

```
1. customers.csv       → tabulka customers
2. devices.csv         → tabulka devices (s device_name!)
3. revisions.csv       → tabulka revisions (pouze povinnosti/zakázky)
4. work_log.csv         → tabulky visits + visit_work_items
5. communications.csv  → tabulka communications
```

**`revisions.csv` (revidovaný)** – popisuje pouze **povinnosti** (zakázky):

```csv
device_ref;customer_ref;due_date;status;result;completed_at;duration_minutes;findings
```

Stav `completed` s `result` a `completed_at` = povinnost byla splněna.

**`work_log.csv` (nový, nahrazuje visits.csv)** – popisuje **co se kdy kde dělalo**:

```csv
customer_ref;scheduled_date;scheduled_time_start;scheduled_time_end;device_ref;work_type;status;result;duration_minutes;result_notes;findings;requires_follow_up;follow_up_reason
```

Řádky se **stejným `customer_ref` + `scheduled_date`** se automaticky seskupí do jedné návštěvy:

```csv
51647785;2025-11-18;10:00;11:30;Komín na chalupě;revision;completed;successful;45;Bez závad;;false;
51647785;2025-11-18;10:00;11:30;CH-112373;repair;completed;partial;45;Opraveno;Čeká se na díl;true;Kontrola po opravě
```

→ Vytvořit 1 visit + 2 work_items.

### 5.3 Propojení `revisions.csv` a `work_log.csv`

Pokud `work_type=revision` a `device_ref` je vyplněn, import se pokusí najít odpovídající revizní povinnost (v `revisions`) a:
1. Označit ji jako `completed`
2. Propojit přes `fulfilled_by_work_item_id`

Toto propojení je **volitelné** – work_log může existovat i bez odpovídající povinnosti v revisions.csv (ad-hoc práce).

### 5.4 `resolve_device_ref()` – cílový stav

```
1. Zkusit jako serial_number → SELECT WHERE serial_number = $1
2. Zkusit jako device_name   → SELECT WHERE device_name ILIKE $1    ← NOVÉ
3. Zkusit jako device_type   → SELECT WHERE device_type = $1
                                AND count(same type for customer) = 1  ← NOVÉ
4. Nenalezeno → chyba
```

---

## 6. Migrační plán

### Fáze 1: Opravy bez změny modelu (urgentní)

Tyto změny opravují **aktuální bugy** bez změny datového modelu:

1. **Přidat `device_name`** do tabulky `devices` + pravidlo generování názvu s varováním při importu
2. **Rozšířit `CreateRevisionRequest`** o `status`, `completed_at`, `duration_minutes`, `result`
3. **Opravit `create_revision()`** – neardcodovat `status='upcoming'`
4. **Opravit import procesor pro visits** – volat `create_visit_import()` místo `create_visit()`
5. **Rozšířit `resolve_device_ref()`** – hledat i podle `device_name` a `device_type`
6. **Změnit NOT NULL** na customers – `name`, `street`, `city`, `postal_code`

### Fáze 2: Vylepšení typů

1. **Přidat PostgreSQL ENUM** pro typové sloupce
2. **Migrace dat** z VARCHAR na ENUM (s fallback pro neznámé hodnoty)
3. **Přidat chybějící `updated_at`** na `devices` a `communications`
4. **Přidat unikátní indexy** na `devices` a `revisions`

### Fáze 3: Nový datový model (breaking change)

1. **Přidat `crew_id` na `routes`**, změnit UNIQUE index
2. **Vytvořit tabulku `visit_work_items`**
3. **Refaktorovat `route_stops`** – `customer_id` místo `revision_id`
4. **Vytvořit nový import formát** (`work_log.csv`)
5. **Bez migrace dat** (DB se před změnou smaže)
6. **Aktualizovat IMPORT_FORMAT.MD**

### Priorita

| Fáze | Priorita | Důvod |
|------|----------|-------|
| 1 | **Kritická** | Aktuální import **ztrácí data** (status, result). |
| 2 | Střední | Zlepšuje integritu, ale nerozbíjí funkčnost. |
| 3 | Nízká (design-first) | Vyžaduje značný refaktoring frontendu i backendu. Nejprve navrhnout, pak implementovat. |
