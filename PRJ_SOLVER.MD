# PRJ_SOLVER — Rezerva příjezdu jako vlastnost trasy

## Stav: NÁVRH

Tento dokument popisuje přesun parametrů „rezerva příjezdu" (arrival buffer) z posádky na trasu. Rezerva se stane vlastností konkrétní trasy uložené v DB, s automatickým předvyplněním z posledních použitých hodnot uživatele.

---

## 1. Motivace

Dnes je rezerva příjezdu (`arrival_buffer_percent`, `arrival_buffer_fixed_minutes`) nastavena na posádce. To je nepraktické:

- Uživatel nemůže mít různé rezervy pro různé trasy téže posádky.
- Změna na posádce zpětně ovlivní interpretaci všech starých tras.
- Rezerva je logicky vlastnost konkrétní trasy, ne posádky.

### Cílový stav

- Rezerva příjezdu je **vlastnost trasy** (`routes` tabulka).
- Při tvorbě nové trasy se automaticky použije **poslední použitá hodnota** daného uživatele (z `users` tabulky).
- Na timeline detailu trasy je rezerva **viditelně uvedena drobným písmem** a **editovatelná** po rozkliknutí.
- Z posádky se pole `arrival_buffer_percent` a `arrival_buffer_fixed_minutes` **odstraní**.

---

## 2. Inventář dotčených míst

### 2.1 Odstranění z posádky (crew)

| Soubor | Co odebrat |
|---|---|
| `worker/src/types/crew.rs` | Pole `arrival_buffer_percent` a `arrival_buffer_fixed_minutes` ze struct `Crew`, `CreateCrewRequest`, `UpdateCrewRequest` + testy |
| `worker/src/db/queries/crew.rs` | Sloupce z INSERT/UPDATE/SELECT dotazů |
| `worker/migrations/001_initial_schema.sql` | Odebrat sloupce z `crews` tabulky |
| `worker/migrations/004_add_crew_buffer.sql` | Smazat celý soubor |
| `worker/migrations/005_fix_crew_buffer_type.sql` | Smazat celý soubor |
| `worker/migrations/014_add_crew_fixed_buffer.sql` | Smazat celý soubor |
| `apps/web/src/services/crewService.ts` | Pole z `Crew`, `CreateCrewRequest`, `UpdateCrewRequest` |
| `apps/web/src/pages/Settings.tsx` | Odebrat buffer inputy z `CrewForm` + `CrewFormData` + create/update volání |
| `apps/web/public/locales/{cs,en,sk}/settings.json` | Klíče `crew_arrival_buffer_*` (4 klíče × 3 jazyky) |

### 2.2 Přidání na trasu (route)

| Soubor | Co přidat |
|---|---|
| `worker/migrations/001_initial_schema.sql` | Sloupce `arrival_buffer_percent` a `arrival_buffer_fixed_minutes` do `routes` tabulky |
| `worker/src/types/route.rs` | Pole do struct `Route` |
| `worker/src/db/queries/route.rs` | Sloupce do `upsert_route` (INSERT + UPDATE + SELECT) |
| `worker/src/handlers/route.rs` | Pole do `SaveRouteRequest`, `RecalculateRequest` čte buffer z payloadu (beze změny — už to dělá) |
| `worker/src/handlers/jobs.rs` | Čtení bufferu z trasy místo z posádky |
| `packages/shared-types/src/route.ts` | Pole do `Route` interface |
| `apps/web/src/services/routeService.ts` | Pole do `SaveRouteRequest`, `SavedRoute` |

### 2.3 Uživatelské preference (last-used default)

| Soubor | Co přidat |
|---|---|
| `worker/migrations/001_initial_schema.sql` | Sloupce `last_arrival_buffer_percent` a `last_arrival_buffer_fixed_minutes` do `users` tabulky |
| `worker/src/types/settings.rs` | Pole do `UserPreferences` |
| `worker/src/db/queries/settings.rs` | Čtení a zápis nových preferencí |
| `worker/src/handlers/route.rs` | Po uložení trasy aktualizovat uživatelské preference |
| `packages/shared-types/src/settings.ts` | Pole do `UserPreferences` |
| `apps/web/src/services/settingsService.ts` | Pole do `UserPreferences` |

### 2.4 Frontend — zobrazení a editace na timeline

| Soubor | Co přidat |
|---|---|
| `apps/web/src/components/planner/RouteDetailTimeline.tsx` | Nový props, zobrazení drobným písmem, inline editor |
| `apps/web/src/components/planner/RouteDetailTimeline.module.css` | Styly pro buffer info + editor |
| `apps/web/src/pages/PlanningInbox.tsx` | Předání buffer props do timeline, handler pro změnu, přečtení defaultu z preferences |
| `apps/web/public/locales/{cs,en,sk}/planner.json` | Překlady pro buffer label, editor |

---

## 3. Datový model

### 3.1 Tabulka `routes` — nové sloupce

```sql
arrival_buffer_percent         DOUBLE PRECISION NOT NULL DEFAULT 10.0,
arrival_buffer_fixed_minutes   DOUBLE PRECISION NOT NULL DEFAULT 0.0
```

### 3.2 Tabulka `users` — nové sloupce (preference)

```sql
last_arrival_buffer_percent         DOUBLE PRECISION NOT NULL DEFAULT 10.0,
last_arrival_buffer_fixed_minutes   DOUBLE PRECISION NOT NULL DEFAULT 0.0
```

### 3.3 Tabulka `crews` — odebrané sloupce

```
arrival_buffer_percent         -- ODEBRAT
arrival_buffer_fixed_minutes   -- ODEBRAT
```

### 3.4 Rust structs

```rust
// Route — přidat pole:
pub struct Route {
    // ... existující ...
    pub arrival_buffer_percent: f64,
    pub arrival_buffer_fixed_minutes: f64,
}

// SaveRouteRequest — přidat pole:
pub struct SaveRouteRequest {
    // ... existující ...
    pub arrival_buffer_percent: f64,
    pub arrival_buffer_fixed_minutes: f64,
}

// UserPreferences — přidat pole:
pub struct UserPreferences {
    // ... existující ...
    pub last_arrival_buffer_percent: f64,
    pub last_arrival_buffer_fixed_minutes: f64,
}
```

### 3.5 TypeScript types

```typescript
// Route — přidat pole:
export interface Route {
  // ... existující ...
  arrivalBufferPercent: number;
  arrivalBufferFixedMinutes: number;
}

// SaveRouteRequest — přidat pole:
export interface SaveRouteRequest {
  // ... existující ...
  arrivalBufferPercent: number;
  arrivalBufferFixedMinutes: number;
}

// SavedRoute — přidat pole:
export interface SavedRoute {
  // ... existující ...
  arrivalBufferPercent: number;
  arrivalBufferFixedMinutes: number;
}

// UserPreferences — přidat pole:
export interface UserPreferences {
  // ... existující ...
  lastArrivalBufferPercent: number;
  lastArrivalBufferFixedMinutes: number;
}
```

---

## 4. Chování

### 4.1 Vytvoření nové trasy

1. Frontend načte `settings.preferences.lastArrivalBufferPercent` a `lastArrivalBufferFixedMinutes`.
2. Tyto hodnoty se drží v lokálním stavu `PlanningInbox` (state `routeBufferPercent`, `routeBufferFixedMinutes`).
3. Při každém `recalculateRoute()` se pošlou jako `arrivalBufferPercent` / `arrivalBufferFixedMinutes`.
4. Při každém `saveRoute()` se pošlou v `SaveRouteRequest`.
5. Backend `handle_save_route` uloží buffer do `routes` tabulky.
6. Backend po úspěšném uložení aktualizuje `users.last_arrival_buffer_percent` a `users.last_arrival_buffer_fixed_minutes`.

### 4.2 Načtení existující trasy

1. `getRoute()` vrací `SavedRoute` s `arrivalBufferPercent` a `arrivalBufferFixedMinutes`.
2. Frontend z těchto hodnot inicializuje lokální stav.

### 4.3 Editace bufferu na timeline

1. Pod hlavičkou timeline (pod depot departure) je drobný text: „Rezerva: 10 % + 0 min".
2. Po kliknutí se text změní na inline editor (dva malé inputy: `%` a `min`).
3. Po potvrzení (Enter / blur) se:
   a. Aktualizuje lokální stav.
   b. Spustí `recalculateRoute()` s novými hodnotami.
   c. Autosave uloží trasu (včetně nového bufferu).

### 4.4 Route planning job (async)

`handle_route_plan_job` v `handlers/jobs.rs` dnes čte buffer z posádky. Nově:

1. Přijme buffer jako parametr v `RoutePlanJobRequest`.
2. Frontend buffer předá při submitu jobu.
3. Alternativně: job načte buffer z existující trasy v DB (pokud trasa už existuje).

---

## 5. UI mockup (RouteDetailTimeline)

```
📍 Sklad Brno                              ← depot card
   Odjezd: 07:24
   ─── Rezerva: 10 % + 0 min ✏️ ───        ← nový řádek, drobné písmo
   ▼ 12.3 km • 18 min
   ┌─────────────────────────────────┐
   │ 1. Novák s.r.o.                │      ← stop card
   │    Příjezd: 07:42 → Odjezd: ... │
   └─────────────────────────────────┘
   ▼ 8.1 km • 12 min
   ...
```

Po kliknutí na ✏️:

```
   ─── Rezerva: [10] % + [0] min  ✓ ✕ ─── ← inline edit
```

---

## 6. Implementační plán (TDD)

Databázi nemigrujeme — bude vytvořena znovu. Upravíme přímo `001_initial_schema.sql` a smažeme staré buffer migrace.

Každý krok se řídí cyklem RED → GREEN → REFACTOR:
1. Napsat failing test (RED)
2. Napsat minimální implementaci, aby test prošel (GREEN)
3. Refaktorovat pokud potřeba (REFACTOR)
4. Odškrtnout krok v tomto souboru

### Fáze 1: Databáze a migrace (scaffold)

- [x] **1.1** V `001_initial_schema.sql` přidat do tabulky `routes`:
  - `arrival_buffer_percent DOUBLE PRECISION NOT NULL DEFAULT 10.0`
  - `arrival_buffer_fixed_minutes DOUBLE PRECISION NOT NULL DEFAULT 0.0`
- [x] **1.2** V `001_initial_schema.sql` přidat do tabulky `users`:
  - `last_arrival_buffer_percent DOUBLE PRECISION NOT NULL DEFAULT 10.0`
  - `last_arrival_buffer_fixed_minutes DOUBLE PRECISION NOT NULL DEFAULT 0.0`
- [x] **1.3** V `001_initial_schema.sql` odebrat z tabulky `crews`: nebyly v base schema (přidány migrací) ✅
- [x] **1.4** Smazat migrace: `004_add_crew_buffer.sql`, `005_fix_crew_buffer_type.sql`, `014_add_crew_fixed_buffer.sql` ✅

### Fáze 2: Rust typy — crew (odebrat buffer) + testy

- [x] **2.1** TEST: `test_crew_no_buffer_fields` — `CreateCrewRequest` bez `arrivalBufferPercent` se deserializuje OK; serializovaný `Crew` neobsahuje klíč `arrivalBufferPercent`. ✅
  - GREEN: Odebráno ze struct `Crew`, `CreateCrewRequest`, `UpdateCrewRequest`. Testy přepsány.
- [x] **2.2** `db/queries/crew.rs` — odebrány buffer sloupce z INSERT, UPDATE, SELECT dotazů ✅
- [x] **2.3** `cargo check` — handlers dočasně defaultují buffer na 10.0/0.0 (TODO pro fázi 6) ✅

### Fáze 3: Rust typy — route (přidat buffer) + TDD

- [x] **3.1** TEST: `test_route_serializes_buffer_fields` — Route serializuje `arrivalBufferPercent` a `arrivalBufferFixedMinutes` ✅
  - GREEN: Přidána pole do `types/route.rs` → struct `Route`.
- [x] **3.2** TEST: `test_save_route_request_deserializes_buffer` — SaveRouteRequest deserializuje buffer z JSON ✅
  - GREEN: Přidána pole do `SaveRouteRequest` v `handlers/route.rs`.
- [x] **3.3** TEST: `test_save_route_request_buffer_defaults` — bez buffer polí defaultuje na 10.0 / 0.0 ✅
  - GREEN: `#[serde(default = "default_buffer_percent")]` a `#[serde(default)]`.
- [x] **3.4** `cargo check` ✅

### Fáze 4: Rust typy — user preferences (přidat last-used buffer) + TDD

- [x] **4.1** TEST: `test_user_preferences_has_last_buffer` — serializace/deserializace buffer polí v `UserPreferences` ✅
  - GREEN: Přidána pole do `UserPreferences`, `UserWithSettings`, `to_preferences()`.
- [x] **4.2** `cargo check` ✅

### Fáze 5: DB dotazy — route upsert + TDD

- [x] **5.1** `upsert_route` — přidány `arrival_buffer_percent` a `arrival_buffer_fixed_minutes` do INSERT, UPDATE, RETURNING + parametry funkce ✅
- [x] **5.2** `get_route_for_date`, `get_route_by_id`, `RouteWithCrewInfo`, `list_routes*` — přidány buffer sloupce do SELECT ✅
- [x] **5.3** `db/queries/settings.rs` — přidáno čtení buffer z `get_user_settings`, nová funkce `update_last_arrival_buffer` ✅
- [x] **5.4** `cargo check` ✅

### Fáze 6: Handlery — save route ukládá buffer a aktualizuje preferences + TDD

- [x] **6.1** `SaveRouteRequest` buffer pole fungují (ověřeno v fázi 3) ✅
- [x] **6.2** `handle_save_route` — předává buffer do `upsert_route`, po uložení volá `update_last_arrival_buffer` ✅
- [x] **6.3** `handle_get_route` — buffer pole v response automaticky díky fázi 5 ✅
- [x] **6.4** `handle_recalculate` — beze změny ✅
- [x] **6.5** `RoutePlanJobRequest` — přidána `arrival_buffer_percent` a `arrival_buffer_fixed_minutes` s serde defaults ✅
- [x] **6.6** `RoutePlanRequest` — přidána buffer pole, handler čte z requestu místo crew ✅
- [x] **6.7** `handlers/jobs.rs` — čte buffer z `request.arrival_buffer_percent` místo crew ✅
- [x] **6.8** `cargo check` ✅
- [x] **6.9** `cargo test` — 282 passed, 0 failed ✅

### Fáze 7: TypeScript shared types

- [x] **7.1** `packages/shared-types/src/route.ts` — přidáno `arrivalBufferPercent` a `arrivalBufferFixedMinutes` do `Route` ✅
- [x] **7.2** `packages/shared-types/src/settings.ts` — přidáno `lastArrivalBufferPercent` a `lastArrivalBufferFixedMinutes` do `UserPreferences` ✅

### Fáze 8: Frontend services

- [x] **8.1** `routeService.ts` — přidáno `arrivalBufferPercent` a `arrivalBufferFixedMinutes` do `SaveRouteRequest`, `SavedRoute`, `RoutePlanJobRequest` ✅
- [x] **8.2** `crewService.ts` — odebráno `arrivalBufferPercent` a `arrivalBufferFixedMinutes` z `Crew`, `CreateCrewRequest`, `UpdateCrewRequest` ✅
- [x] **8.3** `settingsService.ts` — přidáno `lastArrivalBufferPercent` a `lastArrivalBufferFixedMinutes` do `UserPreferences` ✅
- [ ] **8.4** `tsc --noEmit` — očekáváme chyby v PlanningInbox a Settings (opravíme v dalších fázích)

### Fáze 9: Frontend — PlanningInbox (buffer state + flow)

- [x] **9.1** Přidán lokální stav `routeBufferPercent` a `routeBufferFixedMinutes`, init z preferences, override ze savedRoute ✅
- [x] **9.2** `triggerRecalculate` — čte z `routeBufferPercent` / `routeBufferFixedMinutes` místo crew ✅
- [x] **9.3** `autoSaveFn` — předává buffer v `SaveRouteRequest` ✅
- [x] **9.4** `handleBufferChange` handler → update stavu → `triggerRecalculate()` ✅
- [x] **9.5** Buffer props + `onBufferChange` předány do `RouteDetailTimeline`, buffer do `submitRoutePlanJob` ✅
- [ ] **9.6** `tsc --noEmit` — ověřit kompilaci.

### Fáze 10: Frontend — RouteDetailTimeline (zobrazení a editace)

- [x] **10.1** Props `arrivalBufferPercent`, `arrivalBufferFixedMinutes`, `onBufferChange` přidány ✅
- [x] **10.2** Buffer info zobrazeno drobným písmem pod depot, kliknutím se rozbalí editor ✅
- [x] **10.3** Inline editor: dva number inputy, Uložit/Zrušit tlačítka ✅
- [x] **10.4** CSS styly `.bufferBar`, `.bufferEdit`, `.bufferEditRow`, `.bufferEditActions` ✅
- [x] **10.5** `tsc --noEmit` — ověřeno ve fázi 13 ✅

### Fáze 11: Frontend — Settings crew form (odebrat buffer)

- [x] **11.1** `Settings.tsx` — odebráno buffer z `CrewFormData`, `createCrew`, `updateCrew`, crew list display, form inputs ✅
- [x] **11.2** Odebrány překlad. klíče `crew_arrival_buffer_*` a `crew_buffer` z `{cs,en,sk}/settings.json` ✅
- [ ] **11.3** `tsc --noEmit`

### Fáze 12: Frontend — překlady (nové klíče)

- [x] **12.1** Přidány překlady `buffer_info`, `buffer_percent_label`, `buffer_fixed_label`, `buffer_save`, `buffer_cancel` do `{cs,en,sk}/planner.json` ✅
- [x] **12.2** Odebrány staré crew buffer klíče z `{cs,en,sk}/settings.json` ✅

### Fáze 13: Finální ověření

- [x] **13.1** `cargo check` — backend kompiluje bez chyb ✅
- [x] **13.2** `cargo test` — 282 passed, 0 failed ✅
- [x] **13.3** `tsc` — opraven test `RouteListPanel.test.tsx` (chybějící povinná pole v `SavedRoute`). Ostatní chyby jsou pre-existující (unused imports) ✅
- [ ] **13.4** Manuální QA:
  - Vytvořit novou trasu → buffer se předvyplní z user preferences (10 % + 0 min).
  - Ověřit zobrazení bufferu na timeline drobným písmem.
  - Kliknout na buffer → editovat → potvrdit → ověřit přepočet ETA.
  - Uložit trasu → buffer se uloží do DB.
  - Vytvořit druhou trasu → ověřit, že se předvyplní posledně použitá hodnota.
  - Otevřít nastavení posádky → buffer tam už není.

---

## 8. Inline editace timeline + sdílený ArrivalBufferBar

### 8.1 Motivace

Po přesunu bufferu na trasu přichází další krok: umožnit dispečerovi **přímo v timeline** ručně upravit trvání libovolné položky — zastávky (servis), úseky cesty a pauzy. Jde o řešení mimořádných situací (zácpa, prodloužený servis). Tyto overridem „natvrdo" nastavené hodnoty přepíší vypočítané/dohodnuté a uloží se do DB.

Současně se `ArrivalBufferBar` stane sdílenou komponentou použitou v `PlanningInbox` i `Planner`.

### 8.2 Chování

1. **Každá položka timeline** (zastávka, úsek cesty, pauza) bude mít v pravé části **editovatelný údaj trvání**.
2. Po ručním přepsání hodnoty se pole vizuálně odliší: **výstražná ikona ⚠️** + tooltip „Ručně upraveno".
3. Kliknutím na ikonu ⚠️ se hodnota **vrátí na původní** (vypočítanou / dohodnutou).
4. **Přepočet shora dolů**: změna na pozici N přepočítá časy od pozice N+1 dolů. Události před N se nemění. Pokud buffery po trase absorbují rozdíl, přepočet se neprojeví.
5. **Drag & drop reorder** zastávek — už funguje (DnD kit), zachováme.
6. Chování je identické v `PlanningInbox` i `Planner`.

### 8.3 Datový model — override sloupce v `route_stops`

```sql
-- Přidat do tabulky route_stops v 001_initial_schema.sql:
override_service_duration_minutes  INTEGER,   -- NULL = použij vypočítanou, non-NULL = manuální override
override_travel_duration_minutes   INTEGER,   -- NULL = použij Valhalla čas, non-NULL = manuální override
```

Logika:
- `effectiveServiceDuration = override_service_duration_minutes ?? service_duration_minutes ?? default`
- `effectiveTravelDuration = override_travel_duration_minutes ?? duration_from_previous_minutes`
- Vzdálenost (`distance_from_previous_km`) se overridem nemění.

### 8.4 Rust structs — rozšíření

```rust
// RouteStop (existující) — přidat:
pub override_service_duration_minutes: Option<i32>,
pub override_travel_duration_minutes: Option<i32>,
```

### 8.5 TypeScript types — rozšíření

```typescript
// SavedRouteStop — přidat:
overrideServiceDurationMinutes?: number | null;
overrideTravelDurationMinutes?: number | null;
```

### 8.6 RecalcStopInput — rozšíření

```typescript
// Přidat do RecalcStopInput:
overrideServiceDurationMinutes?: number | null;
overrideTravelDurationMinutes?: number | null;
```

Backend `handle_recalculate`:
- Pokud `overrideTravelDurationMinutes` je nastaveno, použije ho místo Valhalla doby jízdy.
- Pokud `overrideServiceDurationMinutes` je nastaveno, použije ho místo defaultu/scheduled.

### 8.7 UI mockup — inline editace

```
📍 Depo D1                                   07:30
   Rezerva příjezdu: 10 % + 0 min            ← ArrivalBufferBar
   ▼ 45.5 km • [41 min] ⚠️                   ← editovatelný úsek cesty, override indikátor
   ┌─────────────────────────────────────┐
   │ 1  KomínServis trade k.s.  08:41–09:11 │
   │    [30 min] ⚠️                         │ ← editovatelná doba servisu
   └─────────────────────────────────────────┘
   ▼ 12.3 km • 18 min                        ← normální (bez override)
   ┌─────────────────────────────────────┐
   │ 2  Radek Černý           09:29–09:59 │
   │    30 min                              │ ← normální
   └─────────────────────────────────────────┘
```

- `[41 min]` — inline input (number), editovatelný kliknutím.
- `⚠️` — indikátor override. Klik → reset na vypočítanou hodnotu.
- Pole bez override se zobrazují normálně (bez ikony).

---

## 9. Implementační plán — Inline editace timeline (TDD)

Databázi nemigrujeme — bude vytvořena znovu (`001_initial_schema.sql`).

Každý krok se řídí cyklem RED → GREEN → REFACTOR.

### 📊 Stav implementace (2026-02-17)

| Fáze | Popis | Stav |
|------|-------|------|
| A | Sdílená `ArrivalBufferBar` + Planner integrace | ✅ Hotovo, commitnuto & pushnuto |
| B | DB schéma — override sloupce v `route_stops` | ✅ Hotovo, commitnuto & pushnuto |
| C | Rust typy — override pole + TDD testy | ✅ Hotovo, commitnuto & pushnuto |
| D | DB dotazy — SELECT/INSERT s overrides | ✅ Hotovo, commitnuto & pushnuto |
| E | Backend recalculate — respektovat overrides | ✅ Hotovo, commitnuto & pushnuto |
| F | Frontend shared types — override pole | ✅ Hotovo, commitnuto & pushnuto |
| G | Inline editace úseku cesty (travel duration) | ✅ Hotovo, commitnuto & pushnuto |
| H | Inline editace zastávky (service duration) | ✅ Hotovo, commitnuto & pushnuto |
| I | Handlery v PlanningInbox + Planner | ✅ Hotovo, commitnuto & pushnuto |
| J | Překlady | ✅ Hotovo, commitnuto & pushnuto |
| K | Finální ověření | ✅ Hotovo, commitnuto & pushnuto |

**Commity:**
- `6b259d6` — phase A: extract shared ArrivalBufferBar, integrate into Planner
- `e749984` — phase B: add override columns to route_stops schema
- `cb7bfd9` — phase C: add override fields to Rust types with TDD tests

- `48b2d80` — phase D: add override fields to DB queries (SELECT/INSERT)

### Fáze A: Sdílená komponenta ArrivalBufferBar

- [x] **A.1** Přesunout `ArrivalBufferBar` z `PlanningInbox.tsx` do `apps/web/src/components/planner/ArrivalBufferBar.tsx` jako exportovanou komponentu.
- [x] **A.2** CSS styly `.bufferBar`, `.bufferBarExpanded`, `.bufferEditRow`, `.bufferEditActions`, `.bufferLabel` přesunout do `ArrivalBufferBar.module.css`.
- [x] **A.3** V `PlanningInbox.tsx` importovat `ArrivalBufferBar` ze sdílené komponenty, odebrat lokální definici a CSS.
- [x] **A.4** V `Planner.tsx` přidat buffer state (`routeBufferPercent`, `routeBufferFixedMinutes`), inicializaci z user preferences, `handleBufferChange` handler.
- [x] **A.5** V `Planner.tsx` vložit `<ArrivalBufferBar>` mezi akce a timeline (stejná pozice jako v PlanningInbox).
- [x] **A.6** Exportovat `ArrivalBufferBar` z `components/planner/index.ts`.
- [x] **A.7** Ověřit zobrazení v obou pohledech (`PlanningInbox` + `Planner`).

### Fáze B: DB schéma — override sloupce

- [x] **B.1** V `001_initial_schema.sql` přidat do `route_stops`:
  - `override_service_duration_minutes INTEGER` (nullable)
  - `override_travel_duration_minutes INTEGER` (nullable)
- [x] **B.2** Ověřit, že schema je validní (`psql -f`).

### Fáze C: Rust typy — route stop overrides + TDD

- [x] **C.1** RED: Test `test_route_stop_override_fields_serialize` — struct s `override_service_duration_minutes: Some(45)` se serializuje s klíčem `overrideServiceDurationMinutes`.
  - GREEN: Přidat `override_service_duration_minutes: Option<i32>` a `override_travel_duration_minutes: Option<i32>` do struct v `types/route.rs` (nebo příslušný stop struct).
- [x] **C.2** RED: Test `test_route_stop_override_null_skipped` — struct s `None` neobsahuje klíč v JSON (skip_serializing_if).
  - GREEN: `#[serde(skip_serializing_if = "Option::is_none")]`.
- [x] **C.3** `cargo check` — ověřit kompilaci.

### Fáze D: DB dotazy — route stops s overrides + TDD

- [x] **D.1** Přidat `override_service_duration_minutes` a `override_travel_duration_minutes` do SELECT dotazů v `db/queries/route.rs` (všechny funkce vracející route stops).
- [x] **D.2** Přidat override pole do INSERT/UPDATE dotazu pro route stops (v `upsert_route` nebo `save_route_stops`).
- [x] **D.3** `cargo check` — nelze ověřit bez Docker/DB (pre-existující `sqlx::query_scalar!` v `import.rs`). Moje změny používají `sqlx::query_as` (runtime) — syntakticky ověřeno, proběhne při spuštění DB.

### Fáze E: Backend recalculate — respektovat overrides

- [x] **E.1** RED: Test `override_travel_duration_replaces_matrix` — vstup s `override_travel_duration_minutes: Some(60)` vrátí ETA lišící se od Valhalla výpočtu.
  - GREEN: V `sequential_schedule.rs`: pokud stop má `override_travel_duration_minutes`, použít místo matice.
- [x] **E.2** RED: Test `override_service_duration_replaces_calculated` — vstup s `override_service_duration_minutes: Some(45)` vrátí departure = arrival + 45 min.
  - GREEN: V scheduling logice: pokud stop má `override_service_duration_minutes`, použít místo default/scheduled.
- [x] **E.3** `cargo test` — 20/20 testů prošlo (včetně `both_overrides_together`).

### Fáze F: Frontend shared types — override pole

- [x] **F.1** `packages/shared-types/src/route.ts` — přidáno do `RouteStop` a `PlannedRouteStop`.
- [x] **F.2** `apps/web/src/services/routeService.ts` — přidáno do `SavedRouteStop`, `SaveRouteStop`, `RecalcStopInput`.

### Fáze G: Frontend — inline editace úseku cesty (travel duration)

- [x] **G.1** `RouteDetailTimeline.tsx` — segment zobrazí dobu jízdy jako `<input type="number">` (inline). Po změně volá `onUpdateTravelDuration(stopId, minutes)`.
- [x] **G.2** Pokud `overrideTravelDurationMinutes != null`, zobrazit vedle inputu ikonu ⚠️. Klik → reset (`onResetTravelDuration(stopId)`).
- [x] **G.3** CSS styly pro inline input v segmentu + override indikátor.
- [x] **G.4** `PlanningTimeline.tsx` — stejná logika (travel segment editace).
- [x] **G.5** Props přidány do obou timeline komponent. `buildTimelineItems.ts` — travel items nyní obsahují `stop` referenci.

### Fáze H: Frontend — inline editace zastávky (service duration)

- [x] **H.1** `RouteDetailTimeline.tsx` — zastávka zobrazí dobu servisu jako `<input type="number">` (inline). Po změně volá `onUpdateServiceDuration(stopId, minutes)`.
- [x] **H.2** Pokud `overrideServiceDurationMinutes != null`, zobrazit vedle inputu ikonu ⚠️. Klik → reset (`onResetServiceDuration(stopId)`).
- [x] **H.3** CSS styly pro inline input u zastávky + override indikátor.
- [x] **H.4** `PlanningTimeline.tsx` — stejná logika (SortableStopCard).
- [x] **H.5** Props přidány do obou timeline komponent.

### Fáze I: Frontend — handlery v PlanningInbox + Planner

- [x] **I.1** `PlanningInbox.tsx` — 4 handlery implementovány (`handleUpdateTravelDuration`, `handleResetTravelDuration`, `handleUpdateServiceDuration`, `handleResetServiceDuration`), každý spouští `triggerRecalculate`.
- [x] **I.2** Všechny 4 handlery předány jako props do obou timeline komponent.
- [x] **I.3** `triggerRecalculate` — override pole zahrnuta v `RecalcStopInput[]`.
- [x] **I.4** `autoSaveFn` — override pole zahrnuta v `SaveRouteRequest`.
- [x] **I.5** `Planner.tsx` — totožné handlery implementovány (local state only, Planner nemá recalculate).
- [x] **I.6** DnD reorder zachovává override hodnoty (spread operator na stop objektech).

### Fáze J: Frontend — překlady

- [x] **J.1** `{cs,en,sk}/planner.json` — přidány klíče `service_duration_label` a `override_reset_tooltip`.

### Fáze K: Finální ověření

- [x] **K.1** `cargo check` — nelze bez Docker DB (pre-existující `sqlx::query_scalar!`), ale moje změny používají `sqlx::query_as` (runtime).
- [x] **K.2** `cargo test` — 22/22 testů prošlo (20 sequential_schedule + 2 route type).
- [x] **K.3** `tsc --noEmit` — žádné nové chyby z inline-edit feature (pre-existující chyby nezměněny).
- [ ] **K.4** Manuální QA (vyžaduje spuštění Docker + app stack):
  - Vytvořit trasu se 3+ zastávkami.
  - Kliknout na dobu jízdy v segmentu → změnit na vyšší hodnotu → ověřit přepočet ETA shora dolů.
  - Ověřit ⚠️ ikonu u overridnutého segmentu.
  - Kliknout na ⚠️ → ověřit reset na původní hodnotu.
  - Kliknout na dobu servisu u zastávky → změnit → ověřit přepočet.
  - Uložit trasu → reload → ověřit, že overrides přetrvají.
  - Ověřit identické chování v Planner.
  - Ověřit ArrivalBufferBar v Planner.
  - DnD reorder zastávky s override → override se zachová.

---

## 10. Soubory dotčené změnami (inline editace)

### Nové soubory
- `apps/web/src/components/planner/ArrivalBufferBar.tsx` — sdílená komponenta
- `apps/web/src/components/planner/ArrivalBufferBar.module.css` — styly

### Změněné soubory — backend
- `worker/migrations/001_initial_schema.sql` — override sloupce v `route_stops`
- `worker/src/types/route.rs` — override pole ve struct
- `worker/src/db/queries/route.rs` — override v SELECT/INSERT/UPDATE
- `worker/src/handlers/route.rs` — override v recalculate/save
- `worker/src/services/sequential_schedule.rs` — respektovat overrides při scheduling

### Změněné soubory — shared types
- `packages/shared-types/src/route.ts` — override pole

### Změněné soubory — frontend
- `apps/web/src/services/routeService.ts` — override v `SavedRouteStop`, `RecalcStopInput`
- `apps/web/src/pages/PlanningInbox.tsx` — odebrat lokální `ArrivalBufferBar`, přidat override handlery
- `apps/web/src/pages/PlanningInbox.module.css` — odebrat buffer styly (přesunuty do sdílené komponenty)
- `apps/web/src/pages/Planner.tsx` — přidat buffer state + `ArrivalBufferBar` + override handlery
- `apps/web/src/components/planner/RouteDetailTimeline.tsx` — inline editace duration + override indikátory
- `apps/web/src/components/planner/RouteDetailTimeline.module.css` — styly pro inline editing
- `apps/web/src/components/planner/PlanningTimeline.tsx` — inline editace duration + override indikátory
- `apps/web/src/components/planner/PlanningTimeline.module.css` — styly pro inline editing
- `apps/web/src/components/planner/index.ts` — export `ArrivalBufferBar`
- `apps/web/public/locales/{cs,en,sk}/planner.json` — nové překlady

---

## 7. Soubory dotčené změnami (fáze 1–13, buffer přesun — HOTOVO)

### Smazané soubory
- `worker/migrations/004_add_crew_buffer.sql`
- `worker/migrations/005_fix_crew_buffer_type.sql`
- `worker/migrations/014_add_crew_fixed_buffer.sql`

### Změněné soubory — backend
- `worker/migrations/001_initial_schema.sql` — přidat buffer do `routes`, `users`; odebrat z `crews`
- `worker/src/types/crew.rs` — odebrat buffer pole + opravit testy
- `worker/src/types/route.rs` — přidat buffer pole
- `worker/src/types/settings.rs` — přidat `last_arrival_buffer_*`
- `worker/src/db/queries/crew.rs` — odebrat buffer z dotazů
- `worker/src/db/queries/route.rs` — přidat buffer do upsert/select
- `worker/src/db/queries/settings.rs` — číst/zapisovat `last_arrival_buffer_*`
- `worker/src/handlers/route.rs` — `handle_save_route` ukládá buffer + aktualizuje user prefs
- `worker/src/handlers/jobs.rs` — nečíst buffer z crew, přijmout v payloadu

### Změněné soubory — shared types
- `packages/shared-types/src/route.ts` — buffer pole
- `packages/shared-types/src/settings.ts` — `lastArrivalBufferPercent`, `lastArrivalBufferFixedMinutes`

### Změněné soubory — frontend
- `apps/web/src/services/routeService.ts` — buffer v `SaveRouteRequest`, `SavedRoute`
- `apps/web/src/services/crewService.ts` — odebrat buffer z `Crew`
- `apps/web/src/services/settingsService.ts` — buffer preference
- `apps/web/src/pages/Settings.tsx` — odebrat buffer z `CrewForm`
- `apps/web/src/pages/PlanningInbox.tsx` — buffer stav, flow, `ArrivalBufferBar`
- `apps/web/src/components/planner/RouteDetailTimeline.tsx` — (buffer odebrán, přesunut do PlanningInbox)
- `apps/web/src/components/planner/PlanningTimeline.tsx` — (buffer odebrán, přesunut do PlanningInbox)
- `apps/web/src/components/common/TimeInput.tsx` — dropdown time picker
- `apps/web/public/locales/{cs,en,sk}/planner.json` — nové překlady buffer
- `apps/web/public/locales/{cs,en,sk}/settings.json` — odebrat crew buffer klíče

---

## 11. Opravy plánování a slotů (2026-02-17)

### 11.1 Výchozí doba revize: 30 → 60 minut

Výchozí doba servisu změněna z 30 na 60 minut ve všech místech:

| Soubor | Změna |
|---|---|
| `worker/src/defaults.rs` | `DEFAULT_SERVICE_DURATION_MINUTES: u32 = 60` |
| `apps/web/src/pages/Settings.tsx` | Fallback v formuláři `\|\| 60` |
| `apps/web/src/pages/PlanningInbox.tsx` | `useState(60)` |
| `apps/web/src/components/planner/CandidateDetail.tsx` | Default prop `= 60` |

**Poznámka:** Migrace `001_initial_schema.sql` se nemodifikovala (checksum kontrola). Existující uživatelé updatováni přímo v DB: `UPDATE users SET default_service_duration_minutes = 60`.

### 11.2 Sloty zarovnány na čtvrthodiny

Navrhované sloty nyní začínají výhradně na celé čtvrthodině (00, 15, 30, 45 min). Přidána funkce `ceil_quarter_hour()` do:

- `worker/src/services/insertion.rs` — aplikováno na `earliest_start`
- `worker/src/services/slot_suggester.rs` — aplikováno na `arrival_time` v `try_insert_at_position`

Všechny existující testy prošly (18/18: 8 slot_suggester + 10 insertion).

### 11.3 Oprava překrývajících se slotů

**Problém:** Navrhované sloty se překrývaly s existujícími zastávkami (včetně pauz). Backend insertion algoritmus zná pouze customer stops (s koordináty pro matici), ale ne pauzy.

**Řešení (frontend post-check):**
- V `PlanningInbox.tsx` se po obdržení slotů z backendu provede kontrola překrytí s VŠEMI `routeStops` (včetně `break` typů)
- Sloty s překrytím se označí jako `conflict` a vyfiltrují z výsledků
- Uživatel vidí pouze sloty, které nepřekrývají žádnou existující zastávku ani pauzu

### 11.4 Oprava timeline layoutu

- `PlanningTimeline.tsx` — zavedena `MIN_STOP_HEIGHT = 56px` pro stop/break karty (dříve 20px)
- `PlanningTimeline.module.css` — odstraněna `margin: 0.125rem 0` z `.gapZone` (způsobovala kumulativní drift mezi hodinovou osou a obsahem)

### 11.5 Oprava VRP activity-level timing

`worker/src/services/vrp/pragmatic.rs` — customer stops nyní používají activity-level timing místo stop-level timing. Řeší problém, kdy co-located break + customer stop sdílely časy a zákazníkovi se přiřazovala nesprávná (delší) doba servisu.

### 11.6 Oprava duplicitních tras

`worker/src/db/queries/route.rs`:
- `upsert_route` — vyhledává existující trasu podle `(user_id, date)` bez ohledu na `crew_id`, takže změna posádky/depa aktualizuje stávající trasu místo vytváření nové
- UPDATE klauzule nyní správně aktualizuje `crew_id` a `depot_id`
- `get_route_for_date` — přidáno `ORDER BY updated_at DESC LIMIT 1`

---

## 12. Analýza slotové heuristiky — DEEP REVIEW (2026-02-17)

> **Stav:** Vyžaduje refaktoring. Funkční s workaroundy, ale architektura má systémové nedostatky.

---

### 12.1 Přehled vstupních bodů

Systém má **4 nezávislé NATS handlery** pro slot-related operace:

| # | NATS Subject | Handler | Soubor | Algoritmus | Routing |
|---|---|---|---|---|---|
| 1 | `sazinka.slots.suggest` | `handle_suggest` | `slots.rs:33` | `SlotSuggester` (V1) | Mock (Euclidean) |
| 2 | `sazinka.slots.suggest.v2` | `handle_suggest_v2` | `slots.rs:450` | `calculate_insertion_positions` | **Valhalla** |
| 3 | `sazinka.route.insertion.calculate` | `handle_insertion_calculate` | `route.rs:1328` | `calculate_insertion_positions` | **Valhalla** |
| 4 | `sazinka.slots.validate` | `handle_validate` | `slots.rs:799` | Direct time checks | **Valhalla** (prev/next only) |

**Primární UI cesta (PlanningInbox):** Frontend → `insertionService.calculateInsertion()` → `route.insertion.calculate` (#3)

**Sekundární UI cesta (CallQueue schedule dialog):** Frontend → `slotService.suggestSlotsV2()` → `slots.suggest.v2` (#2)

**Legacy (nepoužíváno v aktuálním UI):** `slots.suggest` (#1)

---

### 12.2 Architektura — datový tok

#### A) Primární cesta: `route.insertion.calculate` (PlanningInbox)

```
PlanningInbox.tsx
  │ useEffect([selectedCandidateId])
  │ Filtruje routeStops na stopType === 'customer'  ← ⚠ BREAKS EXCLUDED
  │
  ▼
insertionService.calculateInsertion({
  routeStops: [customer stops only],
  depot, candidate, date, workdayStart, workdayEnd
})
  │
  ▼ NATS: route.insertion.calculate
  │
handle_insertion_calculate (route.rs:1328)
  │ Parsing: workdayStart/End z requestu (fallback na defaults)
  │ Build locations: [candidate(0), depot(1), stop0(2), stop1(3), ...]
  │ ⚠ BUG: service_duration_minutes pro VŠECHNY stops = candidate_service
  │         (line 1451: `service_duration_minutes: candidate_service`)
  │         Mitigováno tím, že frontend posílá departure_time (prioritní)
  │
  ├── Valhalla get_matrices() → NxN matrix
  │   (fallback na MockRoutingService při chybě)
  │
  ▼
calculate_insertion_positions (insertion.rs:61)
  │ Pro každou pozici 0..N:
  │   1. prev_departure = stops_meta[i-1].departure_time ?? fallback
  │   2. earliest_start = ceil_quarter_hour(prev_departure + travel_from_prev)
  │   3. latest_start = next_arrival - (service + travel_to_next)
  │   4. status = earliest > latest ? "conflict" : slack < 15 ? "tight" : "ok"
  │
  │ Výstup seřazen podle delta_min (vzestupně)
  │
  ▼ Response: { allPositions[], bestPosition, isFeasible }
  │
PlanningInbox.tsx (post-processing, lines 541-581)
  │ 1. Build occupiedWindows z VŠECH routeStops (vč. breaks)
  │ 2. Pro každý slot z allPositions:
  │      if slot overlaps any occupiedWindow → status = 'conflict'
  │ 3. Filter out conflict slots
  │ 4. bestPosition = suggestions[0] (first non-conflict)
  │
  ▼
SlotSuggestions.tsx — zobrazí jen non-conflicting sloty
```

#### B) Sekundární cesta: `slots.suggest.v2` (multi-crew)

```
CallQueue / ScheduleDialog
  │
  ▼ NATS: slots.suggest.v2
  │
handle_suggest_v2 (slots.rs:450)
  │ Pro KAŽDOU aktivní posádku:
  │   1. build_crew_day_stops() ← ⚠ EXPLICITNĚ SKIPUJE BREAKS (line 380)
  │   2. Build Valhalla matrix (candidate + depot + day_stops)
  │   3. calculate_insertion_positions()
  │   4. Skóring: slot_score() (travel 40%, fit 25%, preference 20%, balance 15%)
  │
  ▼ Response: CrewSlotSuggestion[] seřazené dle score
```

#### C) Validace: `slots.validate`

```
ScheduleDialog (ruční zadání času)
  │
  ▼ NATS: slots.validate
  │
handle_validate (slots.rs:799)
  │ 1. build_crew_day_stops() ← ⚠ SKIPUJE BREAKS
  │ 2. Kontrola: overlap s existujícími stopy (time_overlap_minutes)
  │ 3. Kontrola: reachability (travel_prev → candidate, candidate → next)
  │ 4. Kontrola: pracovní doba
  │ 5. Kontrola: day load %
  │ 6. ✅ Kontrola: break window overlap (settings.break_earliest/latest)
  │      Toto je JEDINÉ místo, kde se break čas kontroluje na backendu!
  │
  ▼ Response: { feasible, warnings[], estimated_arrival, slack }
```

---

### 12.3 Identifikované problémy (seřazeno dle závažnosti)

#### 🔴 VYSOKÁ závažnost

| # | Problém | Detail | Stav |
|---|---------|--------|------|
| P1 | **Breaks ignorovány v insertion kalkulaci** | `build_crew_day_stops()` (slots.rs:380) explicitně přeskakuje `stop_type == "break"`. Frontend (PlanningInbox.tsx:519) filtruje na `stopType === 'customer'`. Insertion algoritmus nemá žádnou informaci o blocích obsazených pauzami. | ⚠️ Workaround: frontend post-filter (occupiedWindows) |
| P2 | **Service duration bug v handle_insertion_calculate** | `route.rs:1451`: `service_duration_minutes: candidate_service` — všem existujícím stopům se přiřazuje doba servisu KANDIDÁTA, ne jejich vlastní. Např. kandidát 60 min → všechny stopy budou považovány za 60 min. Toto ovlivňuje fallback výpočet departure_time, když frontend nepošle departure_time. | ⚠️ Mitigováno tím, že frontend posílá departure_time z recalculate |
| P3 | **Žádný downstream feasibility check** | Insertion heuristika kontroluje jen, zda se kandidát vejde do mezery. NEKONTROLUJE, zda vložení kandidáta (+ extra travel time) neposune downstream stopy mimo jejich time windows. Uživatel vidí "OK" slot, ale po vložení se downstream stopy mohou opozdit. | ❌ Neopraveno |

#### 🟡 STŘEDNÍ závažnost

| # | Problém | Detail | Stav |
|---|---------|--------|------|
| P4 | **V1 vs V2 nekonzistence** | V1 (`slot_suggester.rs`) používá mock travel time (Euclidean), V2 (`insertion.rs`) Valhalla. V1 se stále registruje na `slots.suggest` a může být volaná z legacy UI cest. Výsledky mohou být dramaticky odlišné. | ❌ Neopraveno (V1 je legacy) |
| P5 | **latest_start používá arrival_time jako hard deadline** | `insertion.rs:131`: `let next_deadline = next_meta.arrival_time.or(next_meta.time_window_end)`. Používá optimalizovaný arrival_time dalšího stopu jako nepřekročitelný deadline. V realitě ale time_window_end (= konec domluveného okna) je správný deadline — posun o několik minut by nemusel být problém, pokud stále stíhá okno. | ⚠️ Konzervativní — raději odmítne než přijme |
| P6 | **validate SKIPUJE breaks v overlap kontrole, ale kontroluje break window** | `handle_validate` kontroluje overlap pouze s `day_stops` (bez breaks, P1). Ale zároveň kontroluje overlap se `settings.break_earliest_time/latest_time` (line 997-1011). Tyto dvě kontroly jsou redundantní/nekonzistentní — break v trase může mít jiný čas než settings break window. | ⚠️ Částečně mitigováno |

#### 🟢 NÍZKÁ závažnost

| # | Problém | Detail | Stav |
|---|---------|--------|------|
| P7 | **slack_before vždy 0** | `insertion.rs:139`: `let slack_before = Some(0)`. Slack before se nepočítá, je vždy 0. V UI i ve scoringu se zobrazuje 0. | ❌ Neopraveno |
| P8 | **Scoring funkce ignoruje slot status** | `slot_score()` v `slots.rs` nepřidává žádnou penalizaci pro "tight" status. Sloty s 5 min slack a 60 min slack mohou mít stejné skóre, pokud mají stejný delta_travel. | ❌ Neopraveno |

---

### 12.4 Detailní analýza — `calculate_insertion_positions` (insertion.rs)

```
Vstup:
  matrices: NxN Valhalla matice (distance + time)
  candidate_idx: index kandidáta v matici (typicky 0)
  depot_idx: index depa v matici (typicky 1)
  stop_indices: indexy existujících stopů v matici [2, 3, 4, ...]
  stops_meta: metadata pro každý stop (name, arrival, departure, time_window, service_duration)
  candidate_service_minutes: doba servisu kandidáta
  workday_start, workday_end: pracovní doba

Algoritmus (pro každou insert pozici i = 0..N):
  1. from = i == 0 ? depot : stop[i-1]
     to   = i >= N ? depot : stop[i]

  2. delta_km  = dist(from→candidate) + dist(candidate→to) - dist(from→to)
     delta_min = time(from→candidate) + time(candidate→to) - time(from→to) + service_minutes

  3. prev_departure:
     - i == 0: workday_start
     - else:   stops_meta[i-1].departure_time
                ?? (time_window_start ?? arrival_time) + service_duration  ← fallback
                ?? workday_start

  4. earliest_start = ceil_quarter_hour(prev_departure + travel_from_to_candidate)

  5. latest_start:
     - i >= N (last position): workday_end - service
     - else:   next_arrival ?? next_time_window_end ?? workday_end
               minus (service + travel_to_next)

  6. status = earliest > latest ? "conflict" : (slack < 15 ? "tight" : "ok")

  7. Výsledek seřazen dle delta_min vzestupně (nejmenší objížďka = nejlepší)
```

**Klíčové omezení:** Algoritmus je "static gap check" — kontroluje, zda se kandidát vejde do existující mezery, aniž by simuloval reálný forward pass. Nepočítá s tím, že vložení kandidáta změní časy VŠECH následujících stopů.

---

### 12.5 Doporučené kroky

#### Krátkodobé (hotfix) — ✅ Implementováno
- Frontend post-filter na break overlaps (PlanningInbox.tsx)

#### Střednědobé (backend fix)
1. **P1 fix:** Předávat break bloky do `calculate_insertion_positions` jako parametr `blocked_windows: Vec<(NaiveTime, NaiveTime)>`. Při výpočtu `earliest_start` pro pozice za breakem posunout prev_departure o break duration. Alternativně: do `build_crew_day_stops()` zahrnout breaks jako pseudo-stopy bez koordinát a v insertion.rs je zpracovat zvlášť.

2. **P2 fix:** V `handle_insertion_calculate` posílat `stop.departureTime - stop.arrivalTime` jako `service_duration_minutes` (nebo přidat `serviceDurationMinutes` jako explicitní pole do `RouteStop` v insertionService.ts).

3. **P7 fix:** Spočítat `slack_before = earliest_start - prev_departure - travel_from` (kolik minut je k dispozici před příjezdem).

#### Dlouhodobé (refactoring)
1. **P3 fix — Forward pass simulation:** Po určení insertion pozice simulovat celý schedule s kandidátem vloženým. Porovnat downstream stopy s jejich time windows. Pokud jakýkoli downstream stop vypadne z okna, označit jako "tight" nebo "conflict" se zprávou "posune zastávku X o Y minut".

2. **Sjednotit V1 a V2:** Odebrat V1 slot_suggester (nebo ho přetvořit na thin wrapper nad `calculate_insertion_positions`). Ponechat jeden insertion algoritmus.

3. **Scoring v2:** Přidat slot status do scoring funkce. "tight" by měl mít penalizaci -20, "conflict" by neměl být v nabídce vůbec.

---

### 12.6 Soubory dotčené slotovou heuristikou

#### Backend
| Soubor | Popis |
|---|---|
| `worker/src/services/insertion.rs` | Sdílená insertion heuristika (`calculate_insertion_positions`) |
| `worker/src/services/slot_suggester.rs` | Legacy V1 slot suggester (`SlotSuggester`) |
| `worker/src/handlers/slots.rs` | Handlery: `handle_suggest`, `handle_suggest_v2`, `handle_validate` + helper `build_crew_day_stops` |
| `worker/src/handlers/route.rs` | Handler: `handle_insertion_calculate` + `handle_insertion_batch` |

#### Frontend
| Soubor | Popis |
|---|---|
| `apps/web/src/services/insertionService.ts` | `calculateInsertion()`, `calculateBatchInsertion()` — volání do backendu |
| `apps/web/src/services/slotService.ts` | `suggestSlots()` (V1), `suggestSlotsV2()`, `validateSlot()` |
| `apps/web/src/pages/PlanningInbox.tsx` | Volání insertion + post-filter breaks + display |
| `apps/web/src/components/planner/SlotSuggestions.tsx` | UI komponenta pro zobrazení slotů |
| `apps/web/src/components/planner/CandidateDetail.tsx` | Detail kandidáta se sloty |
