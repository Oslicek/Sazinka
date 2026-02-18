# PRJ_DEVICES — Konfigurovatelné typy zařízení s custom fields

## Stav: NÁVRH (v1)

Tento dokument popisuje zavedení konfigurovatelných typů zařízení (device types) s custom fields a jejich dopad na Settings, Devices, Planner/Inbox a backend plánování.

---

## 0. Uzavřená rozhodnutí (potvrzeno)

1. Typy zařízení se **nemažou**, pouze **deaktivují**.
2. U předdefinovaných typů lze měnit pouze **label** (a parametry), nikoliv `deviceTypeKey`.
3. Nově přidané required pole se **nepropisuje zpětně** jako povinné pro historické záznamy.
4. Archivní záznamy (zařízení s neaktivním typem) jsou **editovatelné s warningem**.
5. Jeden tenant (firma) může mít **více účtů** — konfigurace typů je tenant-level, ne user-level.
6. Typická doba revize podle typu zařízení se použije i v planneru, i v logice tvorby/počítání revizí.
7. v1 nepovoluje vytváření nových typů zařízení; pouze úpravy předdefinovaných šablon.
8. **tenant_id nesmí být user_id** — tenant model musí být explicitní (tabulka `tenants` + vazby). Mapování `tenant_id = user_id` se nepoužívá ani přechodně.

---

## 1. Motivace

Dnešní stav:
- Typy zařízení jsou pevný enum (`device_type_enum`) v DB i FE.
- Všechna zařízení mají stejná pole bez ohledu na typ.
- Není možné tenantově omezit, které typy zařízení firma servisuje.
- Doba servisu je dnes převážně globální, ne podle typu zařízení.

Cílový stav:
- Tenant v Settings nastaví, které předdefinované typy jsou aktivní.
- Každý typ má upravitelnou šablonu polí (custom fields různých datových typů).
- Neaktivní typy se nenabízí pro nová zařízení.
- Existující záznamy neaktivních typů zůstávají (archivní), ale lze je editovat s warningem.
- Každý typ má vlastní `defaultRevisionDurationMinutes`.

---

## 2. Scope v1 a mimo scope

### 2.1 V1 scope
- Aktivace/deaktivace předdefinovaných typů zařízení.
- Úprava labelu typu zařízení.
- Úprava šablony polí typu (přidat/upravit/deaktivovat/řadit pole).
- Uložení hodnot custom fields na zařízení.
- Použití per-type servisní doby v planneru a v revizní logice.

### 2.2 Mimo scope (v1)
- Vytváření zcela nových typů zařízení.
- Marketplace/sdílení šablon mezi tenanty.
- Kompletní redesign importu CSV (plná podpora v navazující fázi).

### 2.3 CSV import ve v1 (minimální změny)
- Povoleny malé úpravy stávajícího importu.
- Pravidla: neznámá custom pole se ignorují (logovat warning), import nezastaví.
- Known custom fields se naparsují, pokud hlavička CSV odpovídá `fieldKey`.

---

## 3. Architektura a datový model

### 3.1 Tenant scoping (důležité)

Konfigurace typů zařízení je tenant-level.

- Vyžaduje se explicitní tenant model: tabulka `tenants` (minimálně `id`, `name`, `created_at`) + pivot `user_tenants(user_id, tenant_id, role)`.
- `tenant_id` **nesmí** být mapován na `user_id`; jeden tenant může mít více účtů.
- `device_type_configs` musí být vázané na `tenant_id`, ne na `user_id`.
- V API a queries používat jednotně `tenant_id` odvozené z přihlášeného uživatele.

### 3.2 DeviceTypeConfig

```text
DeviceTypeConfig {
  id: UUID
  tenantId: UUID
  deviceTypeKey: string       -- immutable klíč (gas_boiler, chimney...)
  label: string               -- editable
  icon?: string               -- TBD: formát (icon set name, URL?) — nepoužito ve v1
  isActive: boolean
  isBuiltin: boolean          -- v1 vždy true
  defaultRevisionDurationMinutes: int
  defaultRevisionIntervalMonths: int
  sortOrder: int
  createdAt, updatedAt
}
UNIQUE(tenant_id, device_type_key)  -- tenant nemůže mít duplicitní typ
```

### 3.3 DeviceTypeField

```text
DeviceTypeField {
  id: UUID
  deviceTypeConfigId: UUID
  fieldKey: string            -- immutable v rámci typu
  label: string
  fieldType: enum             -- text | number | date | boolean | select
  isRequired: boolean
  selectOptions?: json          -- [{ key: string, label: string, deprecated?: bool }]; key = technický klíč (en), label = lokalizovaný text
  defaultValue?: string         -- viz formát níže
  sortOrder: int
  unit?: string
  placeholder?: string
  isActive: boolean           -- soft delete pole
  createdAt, updatedAt
}
UNIQUE(device_type_config_id, field_key)  -- typ nemůže mít duplicitní pole
```

#### Formát defaultValue

| fieldType | formát defaultValue |
|---|---|
| text | libovolný string |
| number | stringová reprezentace čísla |
| date | ISO 8601 string |
| boolean | `"true"` nebo `"false"` |
| select | `key` z `selectOptions` |

#### Pravidlo lifecycle selectOptions

Existující volby v `selectOptions` se **nemažou**, pouze se označí `deprecated: true`.
Nové volby se přidávají na konec. Pořadí v UI odpovídá pořadí v poli.
Pokud má zařízení uloženou deprecated hodnotu, zobrazí se *(zastaralé)* u jejího labelu, ale údaj zůstane platný.

### 3.4 DeviceFieldValue

Kvůli typové robustnosti nebude hodnota jen raw string.
Navržené ukládání:

```text
DeviceFieldValue {
  id: UUID
  deviceId: UUID
  fieldId: UUID
  valueJson: JSONB            -- typed hodnota (string/number/boolean/date-string)
  createdAt, updatedAt
}
UNIQUE(device_id, field_id)   -- každé zařízení má max. jednu hodnotu na pole
```

Backend vždy validuje `valueJson` proti `fieldType`. Při upsert custom fields zajistit, aby nevznikal duplicitní záznam (validace + správné upsert chování).

#### Eager-load strategie (performance)

`device.list` a `device.get` **nepoužívají N+1 dotazy** na custom field values.

Postup:
1. Hlavní dotaz: `SELECT * FROM devices WHERE ...` -> vrátí `device_ids[]`.
2. Batch dotaz: `SELECT * FROM device_field_values WHERE device_id = ANY($1)`.
3. In-memory join a připojení k response DTO.

Pro zobrazení field labels/types se config a fields pro aktivní typy cachují na úrovni handleru s krátkým TTL (5–10 min), protože se mění zřídka. Write operace (`device_type_config.update`, `device_type_field.*`) invalidují cache okamžitě, aby uživatel viděl změny bez prodlevy.

### 3.5 Vztah k tabulce `devices`

Dvoufázový, bezpečný přechod:

1. Přidat nový sloupec `device_type_config_id` (FK).
2. Backfill z existujícího `device_type` enum.
3. Nastavit `NOT NULL`.
4. Starý `device_type` dočasně ponechat pro kompatibilitu (v2 odstranit).

Stávající sloupce (`manufacturer`, `model`, `serial_number`, `installation_date`) zůstávají.

Kritická úprava indexu:
- `idx_devices_name_type` musí být převeden z `(customer_id, device_type, device_name)` na `(customer_id, device_type_config_id, device_name)`.

---

## 4. Předdefinované šablony (v1)

Typy zůstávají pevné (6 builtin šablon). Tabulky níže jsou **seed reference pro migraci**.

U select polí: sloupec „options“ uvádí dvojice `key` (technický klíč EN) a `label` (lokalizovaný); při seedu vytvořit `selectOptions: [{ key, label }]`. Např. fuel_type pro kotel: `[{ key: "natural_gas", label: "zemní plyn" }, { key: "propane", label: "propan" }]`.

### 4.1 Plynový kotel (`gas_boiler`) -- duration 60 min, interval 12 měs.

| fieldKey | label | fieldType | options: key → label / unit | required |
|---|---|---|---|---|
| `rated_power` | Jmenovitý výkon | number | kW | no |
| `combustion_type` | Typ spalování | select | `atmospheric` → atmosférický, `turbo_condensing` → turbo (kondenzační), `turbo_non_condensing` → turbo (nekondenzační) | no |
| `fuel_type` | Palivo | select | `natural_gas` → zemní plyn, `propane` → propan | no |
| `flue_type` | Odvod spalin | select | `chimney` → komín, `turbo` → turbo, `las` → LAS | no |
| `commission_date` | Datum uvedení do provozu | date | | no |

### 4.2 Plynový ohřívač vody (`gas_water_heater`) -- duration 45 min, interval 12 měs.

| fieldKey | label | fieldType | options: key → label / unit | required |
|---|---|---|---|---|
| `rated_power` | Jmenovitý výkon | number | kW | no |
| `capacity_liters` | Objem nádrže | number | l | no |
| `fuel_type` | Palivo | select | `natural_gas` → zemní plyn, `propane` → propan | no |

### 4.3 Komín (`chimney`) -- duration 30 min, interval 12 měs.

| fieldKey | label | fieldType | options: key → label / unit | required |
|---|---|---|---|---|
| `fuel_type` | Palivo | select | `gas` → plyn, `wood` → dřevo, `coal` → uhlí, `lfo` → LTO, `combined` → kombinované, `other` → jiné | **yes** |
| `connected_appliance` | Připojený spotřebič (typ kotle) | text | | no |
| `flue_diameter` | Průměr průduchu | number | mm | no |
| `flue_material` | Materiál | select | `ceramic` → keramika, `stainless_steel` → nerez, `plastic` → plast, `masonry` → zdivo, `other` → jiné | no |
| `flue_count` | Počet průduchů | number | | no |
| `chimney_height` | Výška komínu | number | m | no |

### 4.4 Krb / krbová vložka (`fireplace`) -- duration 30 min, interval 12 měs.

| fieldKey | label | fieldType | options: key → label / unit | required |
|---|---|---|---|---|
| `fireplace_type` | Typ | select | `open_fireplace` → otevřený krb, `fireplace_insert` → krbová vložka, `stove` → krbová kamna | no |
| `fuel_type` | Palivo | select | `wood` → dřevo, `pellets` → peletky, `gas` → plyn, `other` → jiné | no |
| `rated_power` | Jmenovitý výkon | number | kW | no |

### 4.5 Plynový sporák (`gas_stove`) -- duration 20 min, interval 36 měs.

| fieldKey | label | fieldType | options: key → label / unit | required |
|---|---|---|---|---|
| `burner_count` | Počet hořáků | number | | no |
| `has_oven` | Trouba | boolean | | no |
| `fuel_type` | Palivo | select | `natural_gas` → zemní plyn, `propane` → propan | no |

### 4.6 Jiné (`other`) -- duration 60 min, interval 12 měs.

Žádná předdefinovaná pole. Tenant si může přidat vlastní.

---

## 5. API (NATS) -- v1

### 5.1 Device type configs (bez create nového typu)

| Subject | Popis |
|---|---|
| `sazinka.device_type_config.list` | seznam typů pro tenant |
| `sazinka.device_type_config.get` | detail typu + fields |
| `sazinka.device_type_config.update` | update label/isActive/default durations/sortOrder |

`deviceTypeKey` je immutable a není součást update payloadu.

### 5.2 Device type fields

| Subject | Popis |
|---|---|
| `sazinka.device_type_field.create` | přidání pole do šablony typu |
| `sazinka.device_type_field.update` | update label, isRequired, defaultValue, selectOptions, unit, placeholder |
| `sazinka.device_type_field.set_active` | nastavení `isActive` (deaktivace i reaktivace) |
| `sazinka.device_type_field.reorder` | přeřazení polí; payload: `{ deviceTypeConfigId, fieldIds: UUID[] }` — pole v požadovaném pořadí |

Pravidla:
- `fieldKey` a `fieldType` jsou immutable -- nejsou součástí update payloadu.
- Hard delete polí se v1 nepoužije.
- Reaktivace (`isActive: true`) obnoví pole; existující hodnoty zůstávají zachovány.

### 5.3 Device CRUD (rozšíření)

| Subject | Změna |
|---|---|
| `sazinka.device.create` | přijímá `deviceTypeConfigId` + `customFields`; validace: `deviceTypeConfigId` musí patřit tenantovi uživatele a typ musí být `isActive` |
| `sazinka.device.update` | přijímá `customFields`; **nepřijímá** `deviceTypeConfigId` — typ zařízení nelze po vytvoření změnit |
| `sazinka.device.list` | vrací `customFields` + config info |
| `sazinka.device.get` | vrací `customFields` + config info |

---

## 6. UX pravidla

### 6.1 Deaktivovaný typ zařízení
- Nelze jej vybrat při zakládání nového zařízení.
- Existující zařízení se zobrazí s označením "Archivní typ".
- Editace je povolená, ale UI musí ukázat warning.

### 6.2 Required pole a historická data
- Create nového zařízení: required pole se validují vždy.
- Edit existujícího zařízení: required pole se nevynucují retroaktivně na stará data.
- Pokud uživatel upravuje konkrétní required pole, nesmí jej uložit prázdné.

### 6.3 Label vs key
- `deviceTypeKey` i `fieldKey` jsou technické identifikátory a zůstávají stabilní.
- U `selectOptions`: `key` = technický klíč (en), `label` = lokalizovaný text.
- Uživatel upravuje pouze popisky (`label`) a parametry.

### 6.4 Validace custom fields na frontendu

Pro každý `fieldType` platí:

| fieldType | HTML input | Validace |
|---|---|---|
| text | `<input type="text">` | max 500 znaků |
| number | `<input type="number">` | parsovat jako float; `unit` se zobrazí jako suffix |
| date | `<input type="date">` | ISO 8601 string |
| boolean | `<input type="checkbox">` | true/false |
| select | `<select>` | hodnota musí být jeden z `selectOptions[].key`; deprecated volby se zobrazují s "(zastaralé)" |

---

## 7. TDD implementační plán

### Fáze 0 -- Contract a rozhodnutí (0.5 dne)

**Cíl:** zamknout API kontrakt a behaviorální pravidla.

Testy:
- Type-level testy (`shared-types`) pro nové entity.
- Testy serializace payloadů pro NATS.

Výstup:
- finální payload schéma (bez `device_type_config.create`),
- explicitní pravidla required/archivace.

---

### Fáze 1 -- Migrace DB a seed (1-2 dny)

Rozděleno na dva kroky pro bezpečnější nasazení infrastruktury.

#### Fáze 1A -- Zavedení tenant modelu
Soubor: `worker/migrations/020_tenants.sql`
- Vytvoření tabulek `tenants` a `user_tenants`.
- Migrace existujících uživatelů -> vytvoření tenantů (1:1 nebo dle logiky).

#### Fáze 1B -- Device types a seed
Soubor: `worker/migrations/021_device_type_configs.sql`
- Vytvoření `device_type_configs`, `device_type_fields`, `device_field_values`.
- `device_type_config_id` do `devices`.
- Backfill z `device_type`.
- Nový unikátní index přes `device_type_config_id`.
- Seed 6 typů + polí pro každý tenant (využívá tabulku `tenants` z Fáze 1A).
- Trigger/constraints pro integritu.

Seed strategie:
- Migrace předpokládá existující tabulku `tenants` (zavedeno ve Fázi 1A).
- Pro každého existujícího tenanta vloží 6 builtin typů + jejich fields podle šablon z kapitoly 4.
- `isActive` se nastaví na `true` pro všechny typy (tenant si pak deaktivuje co nechce).
- **Noví tenanti po migraci:** trigger při vytvoření tenanta nebo lazy seed při prvním přístupu k device_type_config — vybrat před implementací.

Testy:
- migrace na čisté DB,
- migrace na snapshotu produkčních dat,
- ověření backfillu a indexů,
- rollback test.

---

### Fáze 2 -- Backend queries + handlery (1.5-2 dny)

Dotčené moduly:
- `worker/src/types/device_type_config.rs` (nový)
- `worker/src/db/queries/device_type_config.rs` (nový)
- `worker/src/handlers/device_type_config.rs` (nový)
- úpravy `worker/src/db/queries/device.rs` + `worker/src/handlers/device.rs`

Testy:
- query integrační testy (happy path + validation fail + permission fail),
- typová validace `valueJson` proti `fieldType`,
- required pravidla (create vs legacy edit),
- deactivate typu/pole,
- test selectOptions lifecycle (přidání, deprecation, hodnota s deprecated option).

---

### Fáze 3 -- Shared types + frontend services (0.5-1 den)

Soubory:
- `packages/shared-types/src/deviceTypeConfig.ts` (nový)
- `packages/shared-types/src/device.ts` (rozšíření)
- `packages/shared-types/src/settings.ts` (tenant device config v settings)
- `apps/web/src/services/deviceTypeConfigService.ts` (nový)
- `apps/web/src/services/deviceService.ts` (rozšíření)

Testy:
- unit testy services se zamockovaným NATS,
- kompilace TS bez regresí.

---

### Fáze 4 -- Settings UI: tab "Zařízení" (2 dny)

Funkce:
- přehled předdefinovaných typů,
- toggle aktivní/neaktivní,
- editace labelu,
- editace default duration/interval,
- správa polí (create/update/deactivate/reactivate/reorder),
- správa selectOptions (přidání volby, deprecation volby, přeřazení).

Testy:
- komponentové testy editoru typu/pole,
- validace fieldType + select options,
- zákaz editace klíčů,
- vizuální warningy.

---

### Fáze 5 -- DeviceForm + DeviceList (1.5-2 dny)

Funkce:
- dynamic renderer custom polí (komponenta `DynamicFieldRenderer`),
- validace required (s neretroaktivní výjimkou),
- zobrazení archivního typu,
- warning při editaci archivního typu.

Testy:
- render testy pro všechny datové typy,
- create/update scénáře,
- archivní editace,
- regresní testy stávajících polí (`manufacturer`, `model`, ...).

---

### Fáze 6 -- Planner/Inbox + revizní logika (1 den)

Funkce:
- používat `defaultRevisionDurationMinutes` dle typu zařízení:
  - při plánování/inserci,
  - při výpočtu sekvenčního harmonogramu,
  - při tvorbě revizních návrhů/obligací (kde se duration stanovuje defaultem).

Testy:
- unit testy priority chain:
  `override stop` -> `device type duration` -> `global default`.
- integrační test planner flow.

---

### Fáze 7 -- E2E a rollout (1 den)

Scénáře:
- tenant se 2 účty vidí stejnou konfiguraci typů,
- deaktivace typu + editace archivního zařízení s warningem,
- přidání/úprava select polí (včetně legacy hodnot a deprecated options),
- nová required pole neblokují historické záznamy.

Rollout:
- monitorovat query latency `device.list/get`,
- migrace nejdřív staging + dry-run.

---

## 8. Dotčené soubory (aktualizovaný inventář)

### Backend
- `worker/migrations/020_tenants.sql` (nový — infrastruktura tenantů)
- `worker/migrations/021_device_type_configs.sql` (nový — device types a seed)
- `worker/src/types/device_type_config.rs` (nový)
- `worker/src/db/queries/device_type_config.rs` (nový)
- `worker/src/handlers/device_type_config.rs` (nový)
- `worker/src/db/queries/device.rs` (úpravy)
- `worker/src/handlers/device.rs` (úpravy)
- `worker/src/handlers/settings.rs` (vracet configy)
- `worker/src/services/sequential_schedule.rs` (duration chain)
- `worker/src/handlers/jobs.rs` (duration defaulty)
- `worker/src/main.rs` (subject registrace)

### Shared
- `packages/shared-types/src/deviceTypeConfig.ts` (nový)
- `packages/shared-types/src/device.ts` (úpravy)
- `packages/shared-types/src/settings.ts` (úpravy)
- `packages/shared-types/src/index.ts` (re-export)

### Frontend
- `apps/web/src/services/deviceTypeConfigService.ts` (nový)
- `apps/web/src/services/deviceService.ts` (úpravy)
- `apps/web/src/services/settingsService.ts` (úpravy)
- `apps/web/src/pages/Settings.tsx` (nový tab)
- `apps/web/src/components/settings/DeviceTypeEditor.tsx` (nový)
- `apps/web/src/components/settings/DeviceFieldEditor.tsx` (nový)
- `apps/web/src/components/devices/DeviceForm.tsx` (dynamická pole)
- `apps/web/src/components/devices/DeviceList.tsx` (custom fields + archivní warning)
- `apps/web/src/components/devices/DynamicFieldRenderer.tsx` (nový)
- `apps/web/src/pages/PlanningInbox.tsx` (duration integrace)
- `apps/web/src/components/planner/CandidateDetail.tsx` (zobrazení custom fields)
- `apps/web/src/components/customers/CustomerPreviewPanel.tsx` (custom fields v přehledu zákazníka)

### CSV import
- `worker/src/handlers/import*.rs` nebo ekvivalent — minimální úpravy (ignorovat neznámá custom pole, parsovat known fields dle fieldKey)

### Lokalizace
- `apps/web/public/locales/{cs,en,sk}/settings.json`
- `apps/web/public/locales/{cs,en,sk}/common.json`

---

## 9. Rizika a mitigace

| Riziko | Dopad | Mitigace |
|---|---|---|
| JOINy na custom fields zpomalí list/get | pomalejší UI | eager-load ve 2 dotazech, ne N+1; indexy na `device_id`, `field_id` |
| Nekonzistence při migraci | data chyby | transakční migrace + dry-run na dumpu |
| Rozbití kompatibility přes `device_type` enum | regresní bugy | dvoufázová migrace; dočasně držet oba sloupce |
| Nejasná validace required polí | UX frustrace | explicitní pravidlo create vs legacy edit, pokryto testy |
| Multi-account tenant scénář | špatné sdílení nastavení | tenant-level scoping ve všech queries/handlers |
| Deprecated selectOptions hodnoty | uživatel neví proč volba zmizela | deprecated volby zůstávají viditelné s "(zastaralé)"; nikdy se nemažou |

---

## 10. Otevřené body

1. ~~**Tenant reprezentace v DB**~~ **Vyřešeno** — `tenant_id` nesmí být `user_id`. Zavést `tenants` + `user_tenants` v rámci Fáze 1.

2. ~~Má mít device_type_field.deactivate možnost reactivate?~~ **Vyřešeno** — API `set_active` pokrývá obojí (viz 5.2).

3. ~~**CSV import ve v1**~~ **Vyřešeno** — minimální změny povoleny (sekce 2.3): ignorovat neznámá custom pole, parsovat known fields dle fieldKey.

---

## 11. Stav implementace

Poslední aktualizace: 2026-02-17

### Fáze 0 ✅

- `packages/shared-types/src/deviceTypeConfig.ts` — entity, request, response typy
- `packages/shared-types/src/device.ts` — přidáno `deviceTypeConfigId?`, `customFields?`
- `packages/shared-types/src/index.ts` — re-export `deviceTypeConfig`

---

### Fáze 1A ✅

- `worker/migrations/020_tenants.sql` — tabulky `tenants` + `user_tenants`, seed z existujících users (DO $$ blok)

### Fáze 1B ✅

- `worker/migrations/021_device_type_configs.sql`:
  - tabulky `device_type_configs`, `device_type_fields`, `device_field_values`
  - `device_type_config_id` přidán do `devices`, backfill z `device_type`, NOT NULL
  - funkce `seed_device_types_for_tenant(UUID)` + trigger pro nové tenanty
  - seed 6 builtin typů pro každého existujícího tenanta
  - přepsán unikátní index `idx_devices_name_type` na `device_type_config_id`

---

### Fáze 2 ✅

- `worker/src/types/device_type_config.rs` — Rust typy + 4 unit testy (serialization, partial update, reorder)
- `worker/src/db/queries/device_type_config.rs` — queries: tenant lookup, list/get/update config, create/update/set_active/reorder field, upsert/load field values
- `worker/src/handlers/device_type_config.rs` — 7 NATS handlers (list, get, update, field_create, field_update, field_set_active, field_reorder)
- `worker/src/handlers/mod.rs`, `types/mod.rs`, `db/queries/mod.rs` — registrace nových modulů a NATS subjects
- Rust unit testy prošly (kompilační chyby jsou pre-existing v `import.rs` — nesouvisí s touto změnou)

---

### Fáze 3 ✅

- `apps/web/src/services/deviceTypeConfigService.ts` — service pro všechny device type config / field API calls
- `apps/web/src/services/deviceTypeConfigService.test.ts` — **19/19 testů prošlo**

---

### Fáze 4 ✅

- `apps/web/src/components/settings/DeviceTypeConfigManager.tsx` — kompletní UI manager:
  - seznam typů s expand/collapse, toggle active/inactive, editace labelu + duration + interval
  - správa polí: přidání, editace, deaktivace/reaktivace, přeřazení (↑↓)
  - správa selectOptions: přidání volby, toggle deprecated
  - `AddFieldForm` + `FieldRow` + `DeviceTypeCard` jako sub-komponenty
- `apps/web/src/components/settings/DeviceTypeConfigManager.module.css` — styly
- `apps/web/src/components/settings/DeviceTypeConfigManager.test.tsx` — **18/18 testů prošlo**
- `apps/web/src/pages/Settings.tsx` — nový tab `devices` s podmíněným renderem
- `packages/shared-types/src/auth.ts` — nové oprávnění `settings:devices`
- `apps/web/public/locales/{cs,en,sk}/settings.json` — překlady tab + všechny `dt_*` klíče

### Fáze 5 ✅

- `apps/web/src/components/devices/DynamicFieldRenderer.tsx` — renderer custom polí dle `fieldType`:
  - text, number (s unit suffix), date, boolean (checkbox), select (deprecated options s označením)
  - `decodeValueJson` / `encodeValueJson` helper functions
- `apps/web/src/components/devices/DynamicFieldRenderer.test.tsx` — **36/36 testů prošlo**
- `apps/web/src/components/devices/DeviceForm.tsx`:
  - Přepnutí z hardcoded `DeviceType` enum na `deviceTypeConfigId` picker (z NATS)
  - Validace required custom polí před odesláním
  - Výchozí `revisionIntervalMonths` z vybraného config
  - Warning pro archivní typ (edit mode)
  - `customFields` odesílány v create i update
- `apps/web/src/services/deviceService.ts` — `UpdateDeviceRequest` rozšíren o `customFields`
- `apps/web/src/components/devices/DeviceList.tsx` — zobrazení custom field values v expanded view
- Překlady cs/en/sk: `device_form_custom_fields`, `device_archived_type_warning`, `device_field_*`, `device_custom_fields`

### Fáze 6 ✅

Planner/Inbox + revizní logika:

- `apps/web/src/utils/resolveRevisionDuration.ts` — utility funkce pro priority chain:
  `override stop` → `device type default` → `global default`
- `apps/web/src/utils/resolveRevisionDuration.test.ts` — **14/14 testů prošlo**
- `apps/web/src/components/planner/CandidateDetail.tsx`:
  - `CandidateDetailData` rozšířen o `deviceTypeDefaultDurationMinutes?: number`
  - Inicializace `serviceDurationMinutes` přes `resolveRevisionDuration`
  - `useEffect` pro reset při změně kandidáta
- `apps/web/src/pages/PlanningInbox.tsx`:
  - `handleAddToRoute` používá `resolveRevisionDuration` místo přímého `defaultServiceDurationMinutes`
  - `selectedCandidateDetail` mapuje `deviceTypeDefaultDurationMinutes` z `CallQueueItem`
  - Import `resolveRevisionDuration`
- `apps/web/src/services/revisionService.ts` — `CallQueueItem` rozšířen o `deviceTypeDefaultDurationMinutes: number | null`
- `apps/web/src/services/routeService.ts` — `RecalcStopInput` rozšířen o `deviceTypeDefaultDurationMinutes?: number | null`
- `worker/src/types/revision.rs` — `CallQueueItem` rozšířen o `device_type_default_duration_minutes: Option<i32>`
- `worker/src/db/queries/revision.rs` — SQL dotaz na call queue LEFT JOINuje `device_type_configs`
  pro výplnění `device_type_default_duration_minutes`
- `worker/src/services/sequential_schedule.rs`:
  - `ScheduleStop` rozšířen o `device_type_default_duration_minutes: Option<i32>`
  - Priority chain v duration resolution: override → explicit stop → device type default → global default
  - Nové testy: `device_type_default_beats_global_default_when_no_explicit_stop_duration`,
    `explicit_stop_duration_beats_device_type_default`
- `worker/src/handlers/route.rs` — `RecalcStopInput` a mapování na `SeqScheduleStop` rozšířeny
