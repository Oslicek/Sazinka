# Internationalization (i18n) Analysis

> Status: **Complete**
> Created: 2026-02-10

## Overview

This document captures all findings related to making Sazinka a multi-language, multi-culture application. The app is currently 100% Czech — all UI text, backend messages, date/number formatting, validation messages, email templates, and even CSV import aliases are hardcoded in Czech.

**Estimated scope:** ~90 frontend files, ~15 backend files, ~500+ string keys to externalize.

---

## Current State

- **No i18n library** installed in `apps/web`
- **No locale setting** in user profile, stores, or settings
- **No translation files** for the web app (only `apps/site/` has `cs.json`, `en.json`, `sk.json`)
- **`index.html`** has `<html lang="cs">` hardcoded
- **`<title>`** is hardcoded as `"Ariadline - CRM pro řemeslníky"`
- **Czech-specific fields** in data model: `ico` (IČO), `dic` (DIČ) — these may need labels, not removal
- **Phone normalization** hardcodes `+420` prefix

---

## 1. Hardcoded UI Strings (Frontend)

### 1.1 Pages (~17 files, ~300 strings)

| File | Category | Est. Strings | Samples |
|------|----------|:---:|---------|
| `PlanningInbox.tsx` | Labels, tooltips, buttons, filters, errors | 50+ | "Nová revize", "Neřešit", "V trase", "Smazat trasu", "Načítám přehled dne..." |
| `Settings.tsx` | Tabs, placeholders, errors, CRUD messages | 60+ | "Moje nastavení", "Pracovní doba", "Opravdu chcete smazat?", "Ukládám..." |
| `Calendar.tsx` | Month names, status labels, aria-labels | 25+ | `MONTH_NAMES` (Leden–Prosinec), "Předchozí období", "Hledat zákazníka" |
| `Customers.tsx` | Filters, errors, empty states | 15+ | "Hledat zákazníky...", "Žádní zákazníci neodpovídají", "Načíst další" |
| `CustomerSummary.tsx` | Stats labels | 20 | "Zákazníků celkem", "Zařízení celkem", "Nelze lokalizovat" |
| `Dashboard.tsx` | Status labels, stats | 12 | "Naplánováno", "Po termínu", "zákazníků k obvolání" |
| `Login.tsx` | Labels, placeholders, errors | 5 | "Přihlášení do systému", "Heslo", "vas@email.cz" |
| `Register.tsx` | Placeholders | 8 | "Jan Novák", "Minimálně 8 znaků", "Revize s.r.o." |
| `Jobs.tsx` | Status, relative time | 10 | "právě teď", "před Xm", "Zrušit úlohu" |
| `CallQueue.tsx` | Labels, buttons | 15 | "Telefon není k dispozici", "📅 Naplánovat" |
| `Routes.tsx` | Errors, tooltips | 5 | "Zobrazit v plánu", "Smazat trasu" |
| `WorkLog.tsx` | Placeholders, errors | 12 | "Krátké shrnutí provedené práce" |
| `VisitDetail.tsx` | Placeholders, errors | 15 | "Poznámky k návštěvě...", "Dokončit" |
| `RevisionDetail.tsx` | Errors, buttons | 12 | "Volitelný důvod odložení...", "Potvrdit" |
| `Admin.tsx` | Titles, actions | 15 | "Spustit geokódování...", "Restartovat službu" |
| `About.tsx` | Entire page content | 12 | All Czech |
| `planningInboxFilters.ts` | Preset/filter labels | 20 | "Vše", "Akutní", "Do 7 dnů", "Chybí telefon" |

### 1.2 Components (~52 files, ~200 strings)

**Planner (18 components):**
| File | Samples |
|------|---------|
| `CandidateDetail.tsx` | "Termín: Ano/Ne", "V trase:", "Odložit o den/týden/měsíc", "Zobrazit detail zákazníka →" |
| `CandidateRow.tsx` | "Má termín", "V trase", "Chybí telefon", "Přidaná vzdálenost do trasy" |
| `RouteDetailTimeline.tsx` | "Potvrzeno", "Nepotvrzeno", "Odstranit pauzu", "Odebrat zastávku" |
| `PlanningTimeline.tsx` | "Příjezd X min pozdě — nutné domluvit nový čas", "Ukládám..." |
| `ProblemsSegment.tsx` | "Chybí telefon", "Nelze geolokalizovat", "Doplnit telefon" |
| `RouteListPanel.tsx` | "zast.", "min", "km", "Načítám cesty..." |
| `CapacityMetrics.tsx` | "Celková vzdálenost trasy", "km", "min" |
| `DraftModeBar.tsx` | "Nepodařilo se uložit", "Ukládám..." |
| `SortableStopItem.tsx` | "Navigovat", "Zavolat", "Hotovo", "Zamknout" |
| `SlotSuggestions.tsx` | "Nelze vložit - časový konflikt" |
| `VirtualizedInboxList.tsx` | "Žádní kandidáti", "Načíst další" |

**Customers (12 components):**
| File | Samples |
|------|---------|
| `CustomerForm.tsx` | 18+ labels and placeholders for all form fields |
| `AddCustomerForm.tsx` | 9+ labels, "Geokódování proběhne po uložení zákazníka" |
| `CustomerHeader.tsx` | "➕ Do plánu", "Smazat zákazníka (anonymizace)" |
| `ImportCustomersModal.tsx` | "CSV soubor musí obsahovat...", "X zákazníků" |
| `DeleteConfirmDialog.tsx` | "Smazat zákazníka?", "Mazání..." |

**Calendar (2 components):**
| File | Samples |
|------|---------|
| `CalendarGrid.tsx` | `WEEKDAY_NAMES = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']` |
| `DayCell.tsx` | "Naplánováno", "Po termínu", "Probíhá" |

**Import (2 components):**
| File | Samples |
|------|---------|
| `ImportModal.tsx` | Entity labels (zákazníků, zařízení, revizí, komunikací, návštěv) |
| `ImportReportDialog.tsx` | Issue code labels, duration format, "Dokončeno s chybami" |

**Revisions (5), Devices (2), Settings (1), Common (2), Shared (2), Timeline (2), Worklog (1)** — all contain Czech strings.

### 1.3 Services (~12 files)

| File | Strings |
|------|---------|
| `customerService.ts` | "Nepodařilo se uložit zákazníka" |
| `calendarService.ts` | "Zákazník", "Zařízení" (fallbacks) |
| `exportService.ts` | 16+ CSV column labels (Jméno, Ulice, Město, PSČ, etc.) |
| `visitService.ts` | Status/type/result labels (Naplánováno, Probíhá, Revize, etc.) |
| `communicationService.ts` | Type labels (Odeslaný e-mail, Telefonát, Poznámka) |
| `workItemService.ts` | Work type/result labels |
| `import/importService.ts` | 10+ validation messages |
| `import/entityParsers.ts` | 20+ parsing errors |
| `insertionService.ts` | "+Xmin / +Ykm" format |

### 1.4 Stores (3 files)

| File | Strings |
|------|---------|
| `authStore.ts` | "Příliš mnoho pokusů", "Nesprávný email nebo heslo", "Chyba při přihlášení" |
| `activeJobsStore.ts` | Job type names, progress text (Import zákazníků, Geokódování, Parsování CSV) |
| `natsStore.ts` | "Není připojení k serveru", "Požadavek vypršel" |

### 1.5 Hooks (1 file)

| File | Strings |
|------|---------|
| `useKeyboardShortcuts.ts` | 10+ shortcut descriptions: "Zavřít", "Hledat", "Domluvit termín", "Odložit" |

### 1.6 Utils (2 files)

| File | Strings |
|------|---------|
| `overdueUtils.ts` | Czech plurals: "1 rok", "2 roky", "5 let", "1 měsíc", "2 měsíce", "5 měsíců", "1 den" |
| `customerValidation.ts` | "Jméno je povinné", "PSČ musí mít 5 číslic", "Město je povinné" |

### 1.7 Types (1 file)

| File | Strings |
|------|---------|
| `jobStatus.ts` | Job type names: Geokódování, Plánování trasy, Import dat, Export dat, etc. |

---

## 2. Shared Types / Enums (`packages/shared-types/`)

All label records are Czech-only:

| File | Record | Sample values |
|------|--------|---------------|
| `device.ts` | `DEVICE_TYPE_LABELS` | Plynový kotel, Komín, Krb, Plynový sporák |
| `workItem.ts` | `WORK_TYPE_LABELS` | Revize, Oprava, Instalace, Konzultace |
| `workItem.ts` | `WORK_RESULT_LABELS` | Úspěšná, Částečná, Neúspěšná, Nepřítomen |
| `route.ts` | `ROUTE_STATUS_LABELS` | Koncept, Optimalizováno, Potvrzeno |
| `revision.ts` | `REVISION_STATUS_LABELS` | Plánovaná, Brzy, Po termínu, Naplánováno |
| `revision.ts` | `REVISION_RESULT_LABELS` | V pořádku, Nevyhovělo, S výhradami |
| `auth.ts` | `PAGE_PERMISSIONS` | Kalendar, Inbox, Plan, Zaznam, Zakaznici |
| `auth.ts` | `SETTINGS_PERMISSIONS` | Moje nastaveni, Pracovni doba, etc. |

**Import aliases (Czech input forms for CSV parsing):**
- `DEVICE_TYPE_ALIASES` — plynový kotel, ohřívač, komín, krb, sporák
- `REVISION_STATUS_ALIASES` — nadcházející, plánovaná, dokončeno
- `COMMUNICATION_TYPE_ALIASES` — hovor, email, poznámka
- `VISIT_STATUS_ALIASES`, `WORK_TYPE_ALIASES`, `WORK_RESULT_ALIASES`, etc.

These aliases should remain as Czech inputs but additional locale aliases should be supported.

---

## 3. Date/Time Formatting

### 3.1 Frontend — `toLocaleDateString('cs-CZ')` (30+ occurrences)

Used across ~25 files:

| Files (sample) | Usage |
|----------------|-------|
| `CandidateDetail.tsx`, `PlanningInbox.tsx` | `toLocaleDateString('cs-CZ', { day, month, year })` |
| `CustomerSummary.tsx`, `ImportCustomersModal.tsx` | `toLocaleString('cs-CZ')` for numbers |
| `Customers.tsx`, `Jobs.tsx`, `CustomerTable.tsx` | `toLocaleDateString('cs-CZ')` |
| `DraftModeBar.tsx` | `toLocaleTimeString('cs-CZ')` |
| `Calendar.tsx` | `toLocaleDateString('cs-CZ', { month: 'long' })` |
| `importService.ts` | Date/time formatting in reports |

### 3.2 Frontend — Hardcoded Czech date patterns

| File | Pattern |
|------|---------|
| `CalendarGrid.tsx` | `WEEKDAY_NAMES = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']` |
| `Calendar.tsx` | `MONTH_NAMES` (Leden–Prosinec) |
| `RouteListPanel.tsx` | `formatDate()` — `['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So']` |

### 3.3 Backend — Date parsing/formatting

| File | Format | Notes |
|------|--------|-------|
| `import_processors.rs` | `%d.%m.%Y` | Czech DD.MM.YYYY for CSV parsing |
| `route.rs`, `jobs.rs`, `slots.rs` | `%H:%M` | Time display in warnings |
| `export_processor.rs` | `%Y-%m-%d`, `%H:%M` | Export formatting |
| `types/settings.rs` | `%H:%M` | Time serialization |

---

## 4. Number Formatting

### 4.1 Units in UI (km, min, %, h, s)

| File | Pattern |
|------|---------|
| `CapacityMetrics.tsx` | "X km", "Xmin", "Xh", "XhXX" |
| `RouteListPanel.tsx` | "X min", "Xh", "XhXX" |
| `RouteDetailTimeline.tsx` | "Xh XXmin", "X km", "X min" |
| `CandidateRow.tsx` | `formatDelta` with "km", "min" suffixes |
| `CandidateDetail.tsx` | "X min" |
| `ImportReportDialog.tsx` | "X s", "X min X s" |
| `Jobs.tsx` | "Xs", "Xm Xs", "před Xm", "před Xh" |
| `breakUtils.ts` | "X km", "min", "minut" |
| `insertionService.ts` | "+Xmin / +Ykm" |
| `Dashboard.tsx` | "X%" |
| `Settings.tsx` | "Rezerva X %" |

### 4.2 Number locale

- `toLocaleString('cs-CZ')` used for thousand separators in ~5 places
- Decimal separator: Czech uses comma (1 234,5 km) vs English dot (1,234.5 km)

---

## 5. Backend Messages (Rust)

### 5.1 User-facing NATS responses (~80+ strings)

| Area | Files | Samples |
|------|-------|---------|
| **Import** | `import_processors.rs`, `import.rs` | "Chyba při parsování CSV", "CSV soubor neobsahuje žádné záznamy", "X/Y úspěšně importováno" |
| **Route planning** | `jobs.rs` | "Načítání zákazníků...", "Optimalizace trasy...", "X zastávek, Y km" |
| **Route warnings** | `vrp/pragmatic.rs`, `vrp/mod.rs` | "příjezd v X je po konci okna Y", "Optimalizátor selhal" |
| **Slots** | `slots.rs`, `slot_suggester.rs` | "Slot je mimo pracovní dobu", "Slot se překrývá s návštěvou X" |
| **Insertion** | `insertion.rs` | "Časový konflikt s okolními zastávkami", "Mimo pracovní dobu" |
| **Export** | `export_processor.rs` | "Načítání dat...", "Generování CSV...", "Balení ZIP..." |

### 5.2 Email templates (Czech)

| File | Content |
|------|---------|
| `types/settings.rs` | `DEFAULT_REMINDER_EMAIL_TEMPLATE` — full Czech email body |
| `types/settings.rs` | `DEFAULT_CONFIRMATION_EMAIL_TEMPLATE` — full Czech email body |
| `types/settings.rs` | Default subjects: "Připomínka termínu - {{customerName}}", "Potvrzení termínu - {{customerName}}" |

### 5.3 Mixed Czech/English

Some backend messages are in English: "Database reset successfully", "Authentication required", "Job cancellation requested". These should be unified.

### 5.4 Czech-specific conventions

- Phone normalization: `+420` prefix in `import_processors.rs`
- Geocoding: `"Czech Republic"` appended to addresses
- Default user address: `Václavské náměstí 1, Praha, 11000`

---

## 6. Pluralization

Czech has complex plural forms (1 / 2-4 / 5+):

| Location | Pattern |
|----------|---------|
| `overdueUtils.ts` | "1 rok" / "2 roky" / "5 let", "1 měsíc" / "2 měsíce" / "5 měsíců" |
| `PlanningInbox.tsx` | "1 návštěva" / "2 návštěvy" / "5 návštěv" |
| `Jobs.tsx` | "před 1m" / "před Xm" |
| Various | "X dní/dny/den", "výsledků" |

An i18n library with ICU MessageFormat or similar pluralization support is required.

---

## 7. Scope Summary

### Files requiring i18n changes

| Layer | Files | Strings |
|-------|:-----:|:-------:|
| Pages | 17 | ~300 |
| Components | 52 | ~200 |
| Services | 12 | ~60 |
| Stores | 3 | ~15 |
| Hooks | 1 | ~10 |
| Utils | 2 | ~20 |
| Types/shared | 8 | ~50 |
| **Frontend subtotal** | **~95** | **~655** |
| Backend handlers | 6 | ~80 |
| Backend services | 5 | ~30 |
| Backend types | 2 | ~10 |
| **Backend subtotal** | **~13** | **~120** |
| **TOTAL** | **~108** | **~775** |

### What needs to happen

1. **Choose i18n library** — e.g. `react-i18next` + `i18next` for frontend
2. **Add locale setting** to user profile / settings (stored in DB)
3. **Create translation file structure** — namespaced JSON (`common`, `planner`, `customers`, `settings`, `validation`, `errors`)
4. **Extract all ~655 frontend strings** into translation keys
5. **Create backend i18n layer** or pass locale to worker so responses use correct language
6. **Replace `'cs-CZ'` hardcoded locale** with dynamic locale from user settings
7. **Replace hardcoded date/weekday/month names** with `Intl.DateTimeFormat` or i18n library
8. **Handle pluralization** — Czech needs 3 plural forms
9. **Make email templates locale-aware** — store per-locale templates or use placeholders
10. **Support locale-specific import aliases** — extend alias maps for new languages
11. **Update `index.html`** — dynamic `lang` attribute
12. **Consider RTL** if Arabic/Hebrew support is ever needed (low priority)

### Rollout priority

1. **P0 — Infrastructure:** i18n library, locale setting, translation file structure
2. **P1 — Auth:** Login, Register (first thing users see)
3. **P2 — Shell:** Layout (navigation), ErrorBoundary, common components
4. **P3 — Core pages:** Dashboard, Calendar, Customers, CustomerDetail
5. **P4 — Planning:** PlanningInbox, Planner, CandidateDetail, RouteDetailTimeline
6. **P5 — Secondary:** Settings, Jobs, Routes, WorkLog, Import/Export
7. **P6 — Backend:** NATS response messages, email templates
8. **P7 — Shared types:** Label records, import aliases

---
---

# Part 2: Architecture Design

## Design Principles

1. **Zero-overhead default.** Czech remains the default. No performance penalty for Czech-only users.
2. **Progressive extraction.** Files can be migrated one at a time. Hardcoded Czech and `t()` calls coexist during migration.
3. **Type-safe keys.** Every translation key is checked at build time. A typo or missing key is a TypeScript error.
4. **One source of truth per string.** Each string lives in exactly one namespace file. Components import keys, never raw text.
5. **Backend stays English-keyed.** The Rust backend sends machine-readable codes/keys. The frontend resolves them to the user's locale. This avoids i18n complexity in Rust entirely.
6. **Locale follows the user.** Stored in user profile (DB), falls back to browser `navigator.language`, then to `cs`.

---

## Technology Choice: `react-i18next`

| Criterion | react-i18next | react-intl (FormatJS) | DIY |
|-----------|:---:|:---:|:---:|
| Bundle size (gzip) | ~10 kB | ~14 kB | 0 |
| Pluralization (ICU) | ✅ via plugin | ✅ native | manual |
| Namespace splitting | ✅ native | ❌ flat only | manual |
| Lazy loading per ns | ✅ native | ❌ | manual |
| TypeScript key safety | ✅ with `i18next-resources-to-backend` | partial | full |
| Zustand integration | trivial (detector) | context only | trivial |
| React 19 support | ✅ | ✅ | n/a |
| Ecosystem (tools, extractors) | largest | large | none |
| Vite plugin | `vite-plugin-i18next-loader` | ❌ | n/a |

**Decision: `i18next` + `react-i18next`** — best namespace/lazy-loading support, largest ecosystem, simplest Zustand integration.

---

## Locale Resolution Chain

```
User DB setting (locale field on users table)
  → Zustand authStore.user.locale
    → navigator.language
      → 'cs'  (hardcoded fallback)
```

When a user logs in, `locale` from the JWT/user object is written to the i18n instance. Changing locale in Settings triggers both a DB update and an `i18n.changeLanguage()`.

**Supported locales (initial):** `cs`, `en`
**Later:** `sk`, `de`, `pl` (based on market expansion)

---

## File Structure

```
apps/web/src/
├── i18n/
│   ├── index.ts              ← i18n instance setup
│   ├── types.ts              ← generated type from keys (strict mode)
│   └── locales/
│       ├── cs/
│       │   ├── common.json   ← shared: buttons, states, units, errors
│       │   ├── auth.json     ← login, register
│       │   ├── nav.json      ← layout, navigation
│       │   ├── planner.json  ← PlanningInbox, CandidateDetail, Route*
│       │   ├── customers.json
│       │   ├── calendar.json
│       │   ├── settings.json
│       │   ├── import.json
│       │   ├── jobs.json
│       │   └── validation.json  ← form validation messages
│       └── en/
│           ├── common.json
│           ├── auth.json
│           └── ...  (same structure)
```

### Namespace design rationale

| Namespace | Approx. keys | Loaded when |
|-----------|:---:|-------------|
| `common` | ~100 | Always (buttons, units, status labels, generic errors) |
| `auth` | ~20 | Login/Register pages |
| `nav` | ~15 | Layout (always after auth) |
| `planner` | ~150 | PlanningInbox, Planner routes |
| `customers` | ~80 | Customers, CustomerDetail routes |
| `calendar` | ~40 | Calendar route |
| `settings` | ~80 | Settings route |
| `import` | ~60 | Import modal/report |
| `jobs` | ~30 | Jobs route |
| `validation` | ~30 | Any form |

Namespaces map roughly 1:1 to route-based code-split chunks. Loading a namespace is ~1-5 kB JSON per locale.

---

## i18n Instance Setup

```typescript
// apps/web/src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import Backend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Default and fallback
    fallbackLng: 'cs',
    supportedLngs: ['cs', 'en'],

    // Namespace config
    defaultNS: 'common',
    ns: ['common'],           // preload only common; rest loaded on demand
    fallbackNS: 'common',

    // Backend: load JSON from /locales/{lng}/{ns}.json
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    // Language detector: check zustand store first, then browser
    detection: {
      order: ['custom', 'navigator'],
      caches: [],  // we persist in DB, not localStorage
    },

    // TypeScript strict mode
    returnNull: false,
    interpolation: {
      escapeValue: false,   // React handles XSS
    },
  });

export default i18n;
```

---

## Integration with Zustand

No new store needed. Add `locale` field to the existing `UserPublic` type and read it from `authStore`:

```typescript
// Custom language detector plugin for i18next
const zustandDetector = {
  name: 'custom',
  lookup(): string | undefined {
    return useAuthStore.getState().user?.locale;
  },
};
```

When user changes locale in Settings:
1. `PATCH sazinka.settings.update-preferences` with `{ locale: 'en' }`
2. `i18n.changeLanguage('en')` — triggers re-render of all translated components
3. `document.documentElement.lang = 'en'`

---

## Integration with React Components

### Hook pattern (most common)

```typescript
// Before:
<button>Uložit změny</button>

// After:
const { t } = useTranslation('settings');
<button>{t('save_changes')}</button>
```

### Component pattern (for rich text with JSX)

```typescript
<Trans i18nKey="planner:late_warning" values={{ time: '10:35', delay: 15 }}>
  Příjezd v {{ time }} ({{ delay }} min pozdě) — nutné domluvit nový čas
</Trans>
```

### Outside React (stores, utils, services)

```typescript
import i18n from '@/i18n';

// In Zustand store actions, service functions, etc.
const msg = i18n.t('errors.connection_lost', { ns: 'common' });
```

---

## Translation Key Convention

```
namespace:section.action_or_noun
```

Examples:

| Current Czech string | Key | Namespace |
|---------------------|-----|-----------|
| "Uložit změny" | `save_changes` | `common` |
| "Načítám..." | `loading` | `common` |
| "Nepodařilo se načíst zákazníky" | `load_failed` | `customers` |
| "Chybí telefon" | `missing_phone` | `common` |
| "Odložit o den" | `snooze.one_day` | `planner` |
| "{{count}} zákazníků" | `customer_count` | `customers` |
| "1 rok" / "2 roky" / "5 let" | `duration.years` | `common` |
| "Po termínu" | `status.overdue` | `common` |

### Pluralization (ICU)

```json
{
  "customer_count": "{{count}} zákazník",
  "customer_count_few": "{{count}} zákazníci",
  "customer_count_many": "{{count}} zákazníků",
  
  "duration_years_one": "{{count}} rok",
  "duration_years_few": "{{count}} roky",
  "duration_years_other": "{{count}} let"
}
```

i18next uses CLDR plural rules. Czech has: `one`, `few` (2-4), `other` (5+).

---

## Shared Types Label Strategy

Current `DEVICE_TYPE_LABELS`, `REVISION_STATUS_LABELS`, etc. in `packages/shared-types/` are `Record<EnumValue, string>` with Czech values. These become translation keys:

```typescript
// Before (shared-types/device.ts):
export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  gas_boiler: 'Plynový kotel',
};

// After:
export const DEVICE_TYPE_KEYS: Record<DeviceType, string> = {
  gas_boiler: 'device_type.gas_boiler',
};

// In common.json (cs):
{ "device_type": { "gas_boiler": "Plynový kotel" } }

// In common.json (en):
{ "device_type": { "gas_boiler": "Gas boiler" } }

// Usage in component:
t(DEVICE_TYPE_KEYS[device.type])
```

This preserves type safety (key is always a valid DeviceType) while making labels translatable.

---

## Backend Strategy: Codes, Not Strings

The Rust backend currently sends Czech strings in NATS responses. The new approach:

### Job status messages

```rust
// Before:
status_message: "Načítání zákazníků...".to_string()

// After:
status_message: "job.loading_customers".to_string()
```

The frontend resolves: `t(statusMessage, { ns: 'jobs' })`.

### Validation / error messages

```rust
// Before:
anyhow!("Zákazník '{}' nenalezen", name)

// After:  
json!({ "code": "customer_not_found", "params": { "name": name } })
```

The frontend resolves: `t('errors.customer_not_found', { name, ns: 'import' })`.

### Route warnings

```rust
// Before:
format!("{}: příjezd v {} je po konci okna {}", name, arrival, window_end)

// After:
json!({ "key": "warning.arrival_after_window", "params": { "name": name, "arrival": arrival, "windowEnd": window_end } })
```

### Email templates

Email templates are already user-editable in Settings. Add per-locale default templates:

```rust
// types/settings.rs — default templates become a map:
fn default_email_templates(locale: &str) -> EmailTemplateSettings {
    match locale {
        "en" => EmailTemplateSettings { ... English defaults ... },
        _    => EmailTemplateSettings { ... Czech defaults ... },
    }
}
```

Users who have customized templates keep their version. Locale only affects the initial defaults for new accounts.

---

## Date/Time/Number Formatting

### Centralized formatters

```typescript
// apps/web/src/i18n/formatters.ts
import i18n from './index';

export function formatDate(date: Date | string, style: 'short' | 'long' = 'short'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = i18n.language;
  return d.toLocaleDateString(locale, 
    style === 'short' 
      ? { day: 'numeric', month: 'numeric', year: 'numeric' }
      : { day: 'numeric', month: 'long', year: 'numeric' }
  );
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
}

export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString(i18n.language, { 
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals 
  });
}

export function formatDistance(km: number): string {
  return `${formatNumber(km, 1)} km`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return i18n.t('common:units.minutes', { count: m });
  if (m === 0) return i18n.t('common:units.hours', { count: h });
  return `${h}h ${m.toString().padStart(2, '0')}min`;
}

export function formatRelativeTime(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour');
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(diffDay, 'day');
}

// Weekday/month names — no more hardcoded arrays
export function getWeekdayNames(style: 'short' | 'long' = 'short'): string[] {
  const locale = i18n.language;
  // Monday-first week
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, i + 1); // 2024-01-01 is Monday
    return d.toLocaleDateString(locale, { weekday: style });
  });
}

export function getMonthNames(style: 'short' | 'long' = 'long'): string[] {
  const locale = i18n.language;
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2024, i, 1);
    return d.toLocaleDateString(locale, { month: style });
  });
}
```

This replaces all 30+ `toLocaleDateString('cs-CZ')` calls and the hardcoded `MONTH_NAMES` / `WEEKDAY_NAMES` arrays with a single locale-aware source.

---

## DB Schema Change

```sql
-- Add locale column to users table
ALTER TABLE users ADD COLUMN locale VARCHAR(5) NOT NULL DEFAULT 'cs';
```

The `locale` field is included in the JWT payload and `UserPublic` type so it's available immediately on login without an extra query.

---

## Testing Strategy

1. **Unit tests** keep using Czech strings directly (no i18n in test files). Tests assert on translation keys or use a test i18n instance with Czech loaded.
2. **Snapshot/visual tests** run in both `cs` and `en` to catch layout issues from longer English strings.
3. **Missing key detection:** i18next `saveMissing` option in dev mode logs any key that resolves to fallback, making it easy to find untranslated strings during migration.
4. **CI check:** A script compares `cs/*.json` and `en/*.json` key sets. Missing keys in `en` fail the build.

---

## Migration Path (file-by-file, no big bang)

### Phase 0: Infrastructure (this task)
- Install `i18next`, `react-i18next`, `i18next-http-backend`, `i18next-browser-languagedetector`
- Create `apps/web/src/i18n/` with instance setup
- Create `apps/web/public/locales/cs/common.json` with an initial small set (buttons, units, statuses)
- Create `apps/web/public/locales/en/common.json` (same keys, English values)
- Wrap `<App>` in i18n provider
- Add `locale` to `UserPublic` and DB
- Create `formatters.ts` utility

### Phase 1-7: Incremental extraction
- One page/component at a time
- Replace hardcoded strings with `t()` calls
- Move strings to the appropriate namespace JSON
- Add English translations alongside
- Each phase is independently deployable

### Phase 8: Backend key migration
- Replace Czech NATS status strings with keys
- Frontend resolves keys through i18n
- Backward compatible: if a value is not a known key, display it as-is (graceful fallback for old backend versions)

---

## What This Architecture Does NOT Include (consciously)

| Concern | Decision | Rationale |
|---------|----------|-----------|
| RTL support | Excluded | No Arabic/Hebrew market planned |
| Currency formatting | Excluded | App doesn't handle payments |
| Timezone handling | Excluded | All times are local CZ; revisit when multi-country |
| Translation management (Crowdin, Lokalise) | Deferred | With 2 languages and 1 developer, JSON files in git are sufficient. Add a TMS when >3 languages or external translators are involved. |
| Server-side rendering i18n | N/A | App is SPA |
| Per-tenant locale | Excluded | Locale is per-user, not per-organization |

---

## Key Design Decisions (Confirmed by User)

1.  **Routing Strategy:** **State-based routing** (e.g., `/planning`) over URL-based routing (`/cs/planning`).
    *   *Rationale:* Simpler implementation, better UX for logged-in CRM users, cleaner URLs. SEO is irrelevant for this private app.
2.  **Date Libraries:** **None**. Use native `Intl` APIs.
    *   *Rationale:* Modern browsers support `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` natively. No extra bundle size needed.
3.  **Locale Storage:** **Database (User Profile)**.
    *   *Rationale:* Critical for offline background workers (sending emails in the correct language) and cross-device synchronization.

---

## Architecture Clarifications (Final Decisions)

This section supersedes earlier assumptions where they conflict.

### Locale strategy

1. **Supported locales from day one include regional variants** (e.g. `en`, `en-GB`, `en-US`).
2. **Default locale is English** (`en`).
3. **Fallback locale is English** (`en`) for unsupported/missing locales.
4. **Performance bias should favor English** (smallest startup penalty for `en`).
5. **Routing remains state-based** (no locale in URL).

### Backend-to-frontend i18n message contract

Use a **unified message shape** across all backend user-facing responses (jobs, warnings, errors, import/export progress):

```json
{
  "key": "jobs.loading_customers",
  "params": {
    "count": 42
  }
}
```

- `key`: translation key
- `params`: optional interpolation parameters

Decision: **frontend-only fallback logic** during migration (backend does not provide localized fallback text payloads).

### Frontend fallback behavior (migration period)

If a backend message cannot be translated:
1. Try to resolve by `key`.
2. If key is missing/unknown, render a safe fallback in frontend (never break UI).
3. Avoid leaking raw technical data to users; keep dev diagnostics in logs only.

### Import strategy for existing Czech CSV files

Context: DB will be re-created; import files stay unchanged and contain Czech names/strings with no locale metadata.

Decisions:
1. **Import parser accepts aliases from all supported locales** (tolerant mode).
2. **When source locale is missing, assume Czech CSV semantics by default** for alias matching priority.
3. Parse all localized aliases into **canonical internal enum/code values**.
4. Do not translate free-text payload fields from CSV (names, addresses, notes remain source text).

### Email template policy

1. Existing user email templates are **never auto-modified** on locale changes.
2. Locale affects only defaults for newly created accounts (or explicitly reset templates).

### Shared-types localization strategy

Use **Option A**:
- keep translation key maps in `packages/shared-types` (e.g. `DEVICE_TYPE_KEYS`, `REVISION_STATUS_KEYS`, etc.)
- frontend resolves those keys via i18n.

Rationale: pragmatic and simple in monorepo context; minimizes adapter duplication.

### CI/testing approach

Use the **simpler approach**:
1. Keep migration checks lightweight in early phases.
2. Add strict parity checks (`cs` vs `en` key sets) once namespace extraction is active for a module.

---

## Notes on Changes vs Earlier Sections

These decisions update prior text in this document where needed:
- Locale default/fallback changed from Czech to **English**.
- Regional locale support is explicitly in scope from phase start.
- Backend contract is standardized to one message shape.
- Import behavior is explicitly tolerant and compatible with Czech legacy CSV inputs.

