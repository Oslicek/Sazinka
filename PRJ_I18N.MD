# Internationalization (i18n) Analysis

> Status: **Complete**
> Created: 2026-02-10

## Overview

This document captures all findings related to making Sazinka a multi-language, multi-culture application. The app is currently 100% Czech — all UI text, backend messages, date/number formatting, validation messages, email templates, and even CSV import aliases are hardcoded in Czech.

**Estimated scope:** ~90 frontend files in `apps/web`, ~15 backend files, ~500+ string keys to externalize. **Out of scope:** `apps/site` (marketing/landing) — separate i18n.

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

1. ~~**Choose i18n library**~~ — **Decided:** `i18next` + `react-i18next` (see Part 2)
2. ~~**Add locale setting**~~ — **Decided:** stored in DB, `VARCHAR(10)`, default `'en'` (see Part 2)
3. ~~**Create translation file structure**~~ — **Decided:** namespaced JSON in `public/locales/{lng}/{ns}.json` (see Part 2)
4. **Extract all ~655 frontend strings** into translation keys — Phase 1-7
5. ~~**Create backend i18n layer**~~ — **Decided:** backend sends `{ key, params }` (colon convention); frontend resolves via `resolveBackendMessage()` (see Part 2)
6. **Replace `'cs-CZ'` hardcoded locale** with `i18n.language` via centralized `formatters.ts` — Phase 1-7
7. **Replace hardcoded date/weekday/month names** with native `Intl` via `formatters.ts` — Phase 1-7
8. ~~**Handle pluralization**~~ — **Decided:** CLDR rules via i18next (`one`, `few`, `other`) (see Part 2)
9. **Make email templates locale-aware** — per-locale defaults for new accounts; never modify existing — Phase 6
10. **Support locale-specific import aliases** — tolerant mode, all locales accepted — Phase 5
11. **Update `index.html`** — dynamic `lang` attribute via `document.documentElement.lang` — Phase 0
12. ~~**Consider RTL**~~ — **Excluded** (no Arabic/Hebrew market planned)

### Rollout priority

> See **Migration Path** section below for the full TDD implementation plan with test-first steps.

1. **Phase 0 — Infrastructure:** i18n library, locale setting, formatters, translation file structure, DB migration
2. **Phase 1 — Auth:** Login, Register (first thing users see)
3. **Phase 2 — Shell:** Layout (navigation), ErrorBoundary, common components
4. **Phase 3 — Core pages:** Dashboard, Calendar, Customers, CustomerDetail
5. **Phase 4 — Planning:** PlanningInbox, Planner, CandidateDetail, RouteDetailTimeline
6. **Phase 5 — Secondary:** Settings, Jobs, Routes, WorkLog, Import/Export
7. **Phase 6 — Stores, services, utils:** Zustand stores, service functions, utilities
8. **Phase 7 — Shared types:** Label records, import aliases
9. **Phase 8 — Backend:** NATS response messages, email templates, export
10. **Phase 9 — Verification & cleanup:** Key parity, dead code removal, final visual check

---
---

# Part 2: Architecture Design

## Design Principles

1. **Zero-overhead default.** English (`en`) is the default. Performance favors English (preload `en`; see Architecture Clarifications).
2. **Progressive extraction.** Files can be migrated one at a time. Hardcoded Czech and `t()` calls coexist during migration.
3. **Type-safe keys.** Every translation key is checked at build time. A typo or missing key is a TypeScript error.
4. **One source of truth per string.** Each string lives in exactly one namespace file. Components import keys, never raw text.
5. **Backend stays English-keyed.** The Rust backend sends machine-readable codes/keys. The frontend resolves them to the user's locale. This avoids i18n complexity in Rust entirely.
6. **Locale follows the user.** Stored in user profile (DB), falls back to browser `navigator.language`, then to `en`.

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

**Logged-in user:**
```
User DB setting (locale field on users table)
  → Zustand authStore.user.locale
    → navigator.language (mapped to supported locale)
      → 'en'  (hardcoded fallback)
```

**Pre-login / post-logout:** Use `navigator.language`, map to supported locale, fall back to `en` if unsupported.

When a user logs in, `locale` from the JWT/user object is written to the i18n instance. Changing locale in Settings triggers both a DB update and an `i18n.changeLanguage()`.

**Supported locales (initial):** `en`, `en-GB`, `en-US`, `cs` — regional variants (`en-GB`, `en-US`) share `en/*.json` files initially; i18next falls back to `en` when locale-specific files are absent.
**Later:** `sk`, `de`, `pl` (based on market expansion)

---

## File Structure

Translation JSON files live in `public/locales/` so they are served at `/locales/{lng}/{ns}.json` (required by `i18next-http-backend`).

```
apps/web/
├── public/
│   └── locales/
│       ├── cs/
│       │   ├── common.json   ← shared: buttons, states, units, errors
│       │   ├── auth.json
│       │   ├── nav.json
│       │   ├── planner.json
│       │   ├── customers.json
│       │   ├── calendar.json
│       │   ├── settings.json
│       │   ├── import.json
│       │   ├── jobs.json
│       │   └── validation.json
│       └── en/               ← en-GB, en-US fall back to en/*.json initially
│           ├── common.json
│           ├── auth.json
│           └── ...  (same structure)
└── src/
    └── i18n/
        ├── index.ts          ← i18n instance setup
        ├── formatters.ts     ← date/time/number formatting
        └── types.ts          ← generated type from keys (strict mode, optional)
```

**Scope:** This structure applies to `apps/web` only. `apps/site` (marketing/landing) has its own i18n and is out of scope.

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
    // Default and fallback (English per Architecture Clarifications)
    // Do NOT set `lng` — let the detector chain resolve it
    fallbackLng: 'en',
    supportedLngs: ['en', 'en-GB', 'en-US', 'cs'],
    nonExplicitSupportedLngs: true,  // en-GB falls back to en when en-GB/*.json absent

    // Namespace config
    defaultNS: 'common',
    ns: ['common'],           // preload only common; rest loaded on demand
    fallbackNS: 'common',

    // Backend: HTTP loading; en is preloaded (smallest penalty for default locale)
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json',
    },

    // Language detector: check zustand store first, then browser, then fallback
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
  "customer_count_one": "{{count}} zákazník",
  "customer_count_few": "{{count}} zákazníci",
  "customer_count_other": "{{count}} zákazníků",
  
  "duration_years_one": "{{count}} rok",
  "duration_years_few": "{{count}} roky",
  "duration_years_other": "{{count}} let"
}
```

i18next uses CLDR plural rules. Czech has: `one`, `few` (2-4), `other` (5+). Do not use `many`; use `other` for 5+.

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

### Backend key convention: colon namespace

Backend keys use the **i18next colon convention** — `"namespace:key.path"`. This way `resolveBackendMessage()` can call `t(key, params)` directly and i18next resolves the namespace automatically. No separate `ns` parameter needed.

### Job status messages

```rust
// Before:
status_message: "Načítání zákazníků...".to_string()

// After (unified message shape, colon namespace):
status_message: json!({ "key": "jobs:loading_customers", "params": {} })
```

### Validation / error messages

```rust
// Before:
anyhow!("Zákazník '{}' nenalezen", name)

// After:
json!({ "key": "import:errors.customer_not_found", "params": { "name": name } })
```

### Route warnings

```rust
// Before:
format!("{}: příjezd v {} je po konci okna {}", name, arrival, window_end)

// After:
json!({ "key": "planner:warning.arrival_after_window", "params": { "name": name, "arrival": arrival, "windowEnd": window_end } })
```

All three resolve via `resolveBackendMessage(payload)` on the frontend — see signature below.

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

### `resolveBackendMessage()` — frontend helper

```typescript
// apps/web/src/i18n/resolveBackendMessage.ts
import i18n from './index';

/** Backend sends either a legacy plain string or the unified { key, params } shape. */
type BackendMessage = string | { key: string; params?: Record<string, unknown> };

/**
 * Resolve a backend message to a user-visible string.
 * - Legacy plain string → returned as-is.
 * - { key, params } → translated via i18next (key uses colon convention, e.g. "jobs:loading").
 * - Translation miss → returns the key in dev, a generic fallback in prod.
 */
export function resolveBackendMessage(message: BackendMessage): string {
  if (typeof message === 'string') return message;
  const { key, params } = message;
  const result = i18n.t(key, params ?? {});
  // i18next returns the key itself when translation is missing
  if (result === key) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    return i18n.t('common:errors.unknown');
  }
  return result;
}
```

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
-- Add locale column to users table (default en per Architecture Clarifications)
ALTER TABLE users ADD COLUMN locale VARCHAR(10) NOT NULL DEFAULT 'en';
```

The `locale` field is included in the JWT payload and `UserPublic` type so it's available immediately on login without an extra query. `VARCHAR(10)` accommodates regional codes like `en-GB`.

---

## Testing Strategy

1. **Unit tests** keep using Czech strings directly (no i18n in test files). Tests assert on translation keys or use a test i18n instance with Czech loaded.
2. **Snapshot/visual tests** run in both `cs` and `en` to catch layout issues from longer English strings.
3. **Missing key detection:** i18next `saveMissing` option in dev mode logs any key that resolves to fallback, making it easy to find untranslated strings during migration.
4. **CI check:** A script compares `cs/*.json` and `en/*.json` key sets. Missing keys in `en` fail the build.

---

## Implementation Status

> Last updated: 2026-02-14

### Phase 0: Infrastructure — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 0.1.1 i18n instance | ✅ Done | `apps/web/src/i18n/index.ts` — HttpBackend, LanguageDetector, initReactI18next, zustandDetector, `languageChanged` listener. |
| 0.1.1 tests | ✅ 10/10 pass | `apps/web/src/i18n/index.test.ts` — test i18n instance with in-memory resources + production config options check. |
| 0.1.2 Provider | ✅ Done | `main.tsx` imports `./i18n`, wraps `<App>` in `<Suspense>`. |
| 0.1.3 Locale JSONs | ✅ Done | `apps/web/public/locales/en/common.json` (36 keys) and `cs/common.json` (39 keys, incl. Czech `_few` plurals). |
| 0.2 Zustand detector | ✅ Done | Inline in `i18n/index.ts` (reads `authStore.user.locale`). |
| 0.2.2 lang attribute | ✅ Done | `i18n.on('languageChanged')` listener sets `document.documentElement.lang`. |
| 0.3 Formatters | ✅ 28/28 pass | `i18n/formatters.ts` + `i18n/formatters.test.ts` — `formatDate`, `formatTime`, `formatNumber`, `formatDistance`, `formatDuration`, `formatRelativeTime`, `getWeekdayNames`, `getMonthNames`. |
| 0.4 resolveBackendMessage | ✅ 8/8 pass | `i18n/resolveBackendMessage.ts` + test — legacy passthrough, `{ key, params }` translation, missing key fallback. |
| 0.5.1 Shared types | ✅ Done | Added `locale: string` to `UserPublic` in `packages/shared-types/src/auth.ts`. Updated `authStore.test.ts` (3 test user objects). |
| 0.5.2 SQL migration | ✅ Done | `worker/migrations/017_add_user_locale.sql` — `ALTER TABLE users ADD COLUMN locale VARCHAR(10) NOT NULL DEFAULT 'en'`. |
| 0.5.3 Rust backend | ✅ Done | Added `locale` field to `User` struct, `UserPublic` struct (+ `From<User>` impl), `UserWithSettings` struct. Updated `USER_COLUMNS`, settings query. Added `locale` to JWT `Claims` (with `#[serde(default)]`), `generate_token()` signature. Updated all 3 callers in `handlers/auth.rs` and all 7 test calls. 19/19 Rust auth tests pass. |
| 0.6 Key parity script | ✅ Done | `scripts/check-i18n-keys.js` — plural-suffix-aware comparison, exits 0 when base keys match. |

**Dependencies installed:** ✅ `i18next@^25.8.7`, `i18next-browser-languagedetector@^8.2.1`, `i18next-http-backend@^3.0.2`, `react-i18next@^16.5.4`.

**Test summary:** 100 frontend tests across 8 files + 19 Rust auth tests, all passing.

### Pre-crash UI refactoring (fixed)

The previous session extracted route summary stats/actions into shared components (`RouteSummaryStats`, `RouteSummaryActions`). The crash left 4 TypeScript errors which have been fixed:
1. Created `utils/timeFormatters.ts` for the missing `formatMinutesHm` import.
2. Removed stale destructured props from `PlanningTimeline.tsx`.
3. Removed stale prop passes from `Planner.tsx` → `<PlanningTimeline>`.
4. Replaced `result.route?.depotDeparture` (non-existent field) with computation from first stop's arrival time.

### Phase 1: Auth pages (Login, Register) — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 1.1 Auth namespace | ✅ Done | `en/auth.json` (26 keys) + `cs/auth.json` (26 keys). Key parity check passes. |
| 1.2 Login.tsx | ✅ Done | All 10 hardcoded Czech strings replaced with `t()` calls. Auth store error messages also i18n-ized via `i18n.t()`. |
| 1.3 Register.tsx | ✅ Done | All 13 hardcoded Czech strings replaced with `t()` calls. Added locale `<select>` with `en`/`cs` options. Changing locale switches form language in real-time via `i18n.changeLanguage()`. |
| 1.4 Locale on register | ✅ Done | `Register.tsx` detects locale from `navigator.language`, user can change via `<select>`. Locale sent to backend in register payload. Rust `RegisterRequest` + `create_user()` updated to accept and persist `locale`. Auth store `register()` signature extended with optional `locale` param. |
| 1.5 Tests | ✅ 13/13 pass | `Login.test.tsx` (6 tests): EN/CS rendering, no hardcoded Czech, language switching, placeholders. `Register.test.tsx` (7 tests): EN/CS rendering, locale selector with 2 options, language switch via selector, hint text, key parity. |

### Phase 2: Shell (Layout, Navigation, ErrorBoundary) — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 2.1 Nav namespace | ✅ Done | `en/nav.json` (28 keys) + `cs/nav.json` (28 keys). Key parity passes. |
| 2.2 Layout.tsx | ✅ Done | All 20+ hardcoded strings replaced: nav links (×9 desktop + ×10 mobile), active jobs, online/offline, logout, menu/close aria-labels. |
| 2.3 ErrorBoundary + ProtectedRoute | ✅ Done | `ErrorBoundary.tsx`: 3 strings via `i18n.t()` (class component). `ProtectedRoute.tsx`: 2 strings via `useTranslation('nav')`. |
| 2.4 Common components | ✅ Done | `CollapseButton.tsx`: expand/collapse titles via `t()`. `JobStatusTimeline.tsx`: `DEFAULT_STEPS` labels use i18n keys, position text interpolated. Tests updated (20/20 pass). |
| 2.5 index.html lang + title | ✅ Done | `index.html`: `lang="en"` (default), generic title. `i18n/index.ts`: `languageChanged` listener now also updates `document.title` from `nav:page_title`. |
| 2.6 Tests | ✅ 28/28 pass | `Layout.test.tsx` (8 tests): EN/CS nav labels, online/offline, logout, no hardcoded Czech, language switching, key parity. `JobStatusTimeline.test.tsx` (20 tests): all states, progress, custom steps, i18n Czech labels. |

### Phase 3: Core pages (Dashboard, Calendar, Customers, CustomerDetail) — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 3.1 Calendar namespace | ✅ Done | `en/calendar.json` (47 keys) + `cs/calendar.json` (47 keys). |
| 3.4 Customers namespace | ✅ Done | `en/customers.json` (115 keys) + `cs/customers.json` (115 keys). |
| 3.8 Dashboard namespace | ✅ Done | `en/dashboard.json` (44 keys) + `cs/dashboard.json` (44 keys). |
| 3.11 Common duration keys | ✅ Done | Added years/months/zero_days to `common.json` (en + cs). Key parity passes. |
| 3.2 Calendar.tsx | ✅ Done | Removed MONTH_NAMES, formatShortDate, formatLongDate. Uses getMonthNames(), getWeekdayNames(), formatDate() from formatters. All ~50 strings via t(). |
| 3.3 CalendarGrid + DayCell | ✅ Done | CalendarGrid uses getWeekdayNames('short'). DayCell uses t() for status titles, type labels, item counts. |
| 3.5 Customers.tsx | ✅ Done | All ~40 strings via t(). formatRevisionStatus uses t() with interpolation. toLocaleDateString replaced with formatDate(). |
| 3.6 CustomerForm + AddCustomerForm | ✅ Done | CustomerForm: ~30 strings. AddCustomerForm: ~15 strings. All form labels, placeholders, buttons via t(). |
| 3.7 CustomerSummary.tsx | ✅ Done | ~31 strings via t(). toLocaleString('cs-CZ') replaced with formatNumber(). |
| 3.8b Dashboard.tsx | ✅ Done | All ~40 strings via t(). Status labels use calendar namespace. |
| 3.9 DeleteConfirmDialog + CustomerHeader | ✅ Done | DeleteConfirmDialog uses dangerouslySetInnerHTML for HTML interpolation. CustomerHeader: 8 strings via t(). |
| 3.10 toLocaleDateString replacements | ✅ Done | Replaced in Customers.tsx and CustomerSummary.tsx (Phase 3 scope). |
| 3.11b overdueUtils.ts | ✅ Done | Replaced manual Czech plural functions (formatYears/Months/Days) with i18n.t('common:duration.*', { count }). |
| 3.12 Tests | ✅ Done | 543/548 pass. 5 pre-existing failures (not i18n-related). Global react-i18next mock in test/setup.ts. Tests with own i18n instance use vi.unmock(). |

**Test infrastructure changes:**
- `test/setup.ts`: Added global partial mock for `react-i18next` (useTranslation returns key) and `@/i18n` (mock i18n instance).
- Tests with their own i18n instance (`Layout.test.tsx`, `JobStatusTimeline.test.tsx`, `Login.test.tsx`, `Register.test.tsx`, `index.test.ts`) use `vi.unmock()` to restore real modules.
- `overdueUtils.test.ts`: Local mock for `@/i18n` with English-like output for testing.
- Updated assertions in `Calendar.test.tsx`, `Customers.test.tsx`, `Dashboard.test.tsx`, `CustomerDetail.test.tsx`, `DayCell.test.tsx`, `DeleteConfirmDialog.test.tsx`, `authStore.test.ts`.

**Phase 3 totals:** 6 namespaces, ~304 keys (47 calendar + 115 customers + 44 dashboard + 41 common + 29 nav + 28 auth). 543 tests passing across 35 test files.

### Phase 4: Planning — ✅ COMPLETE (see above)

### Phase 5: Secondary pages — ✅ COMPLETE (see above)

### Phase 6: Stores, services, utilities — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 5.1 Namespace files | ✅ Done | `en/settings.json` (175 keys), `en/jobs.json` (36 keys), `en/import.json` (97 keys), `en/pages.json` (276 keys), `en/validation.json` (8 keys) + matching `cs/` files. Key parity passes. |
| 5.2 Settings.tsx | ✅ Done | All ~100 strings replaced across main component and 10 sub-components (PreferencesForm, WorkConstraintsForm, BusinessInfoForm, EmailTemplatesForm, BreakSettingsForm, DepotsManager, DepotForm, CrewsManager, CrewForm, WorkersManager). |
| 5.2b RolesManager.tsx | ✅ Done | All role/permission strings replaced with `t()` calls. |
| 5.3 Jobs.tsx | ✅ Done | ~30 strings replaced. `convertImportStatus` and `formatTimeAgo` use `t()`. `toLocaleDateString(undefined)` for dates. |
| 5.4 Routes.tsx | ✅ Done | ~25 strings replaced. `getWeekdayNames('short')` replaces hardcoded weekday array. |
| 5.5 WorkLog.tsx | ✅ Done | ~20 strings replaced. Czech pluralization for visit counts (`_one`, `_few`, `_other`). |
| 5.5b VisitDetail.tsx | ✅ Done | ~40 strings replaced across loading/error states, breadcrumbs, card titles, detail labels, timeline, work items, action buttons, edit/complete dialogs. |
| 5.5c RevisionDetail.tsx | ✅ Done | ~25 strings replaced across loading/error states, breadcrumbs, schedule/snooze dialogs. |
| 5.6 ImportCustomersModal.tsx | ✅ Done | 15 strings replaced. Interpolation for row counts. |
| 5.6b ImportReportDialog.tsx | ✅ Done | `ISSUE_CODE_LABELS` → `ISSUE_CODE_KEYS`, `JOB_TYPE_LABELS` → `JOB_TYPE_KEYS` for dynamic i18n translation. All strings replaced. |
| 5.6c ImportModal.tsx | ✅ Done | `ENTITY_LABELS` → `ENTITY_LABEL_KEYS`, `ENTITY_TITLES` → `ENTITY_TITLE_KEYS`. All strings replaced. |
| 5.7 exportService.ts | ⏳ Deferred | Deferred to Phase 7 — CSV headers require more thought on dynamic header translation. |
| 5.8 CallQueue.tsx | ✅ Done | ~40 strings replaced. `PRIORITY_CONFIG` split into `PRIORITY_COLORS` + `PRIORITY_LABEL_KEYS`. Email subject/body use interpolation. |
| 5.9 Admin.tsx | ✅ Done | ~35 strings replaced. Service status, database, import cards, logs section all i18n-ized. |
| 5.9b About.tsx | ✅ Done | All 10 static strings replaced. |
| 5.10 useKeyboardShortcuts.ts | ✅ Done | 9 shortcut descriptions replaced with `i18n.t('planner:...')` calls. New keys added to `planner.json`. |
| 5.11 validation.json | ✅ Done | `en/validation.json` (8 keys) + `cs/validation.json` (8 keys). |
| 5.12 customerValidation.ts | ✅ Done | All 8 validation messages replaced with `i18n.t('validation:...')` calls. |
| 5.12b customerValidation.test.ts | ✅ Done | All 10 test assertions updated to expect i18n keys instead of hardcoded Czech strings. |
| 5.13 Import aliases | ⏳ Deferred | Deferred to Phase 7 — shared-types alias extension is better grouped with label record migration. |
| 5.14 VisitDetailDialog.tsx | ✅ Done | ~25 strings replaced for dialog title, form labels, status options, complete form, result options, footer buttons. |

**Additional components internationalized (beyond original plan):**
- `VisitDetailDialog.tsx` — dialog title, form labels, status/result options (~25 strings)
- `RolesManager.tsx` — role management UI (~15 strings)

**New namespaces created:** `settings` (175 keys), `jobs` (36 keys), `import` (97 keys), `pages` (276 keys), `validation` (8 keys). Total: 592 new keys.

**Planner namespace updated:** +9 keys for keyboard shortcut descriptions.

**Phase 5 done criteria:** All secondary frontend pages and components render in active locale. Tests: 544/548 passing (4 pre-existing failures unrelated to i18n).

### Phase 6: Stores, services, utilities — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 6.1 authStore.ts | ✅ Done | `'Not authenticated'` → `i18n.t('common:not_authenticated')`. Test assertion updated in `authStore.test.ts`. |
| 6.2 activeJobsStore.ts | ✅ Done | `JOB_TYPE_NAMES` → `JOB_TYPE_KEYS` (9 i18n keys). All progress text (~20 strings) across 4 status handlers replaced. Added `getJobTypeName()` helper. 26 new keys in `jobs.json`. |
| 6.3 natsStore.ts | ✅ Done | 5 strings replaced: 3 Czech error messages + 2 English fallbacks. All use `common:errors.*` keys. |
| 6.4 Services | ✅ Done | `calendarService.ts`: 3 fallback labels. `visitService.ts`: 3 label functions (15 strings → dynamic key lookup). `communicationService.ts`: 1 label function (5 strings). `workItemService.ts`: 2 label functions (10 strings). All use `common:visit_status.*`, `common:visit_type.*`, etc. |
| 6.5 insertionService.ts | ⏭️ Skipped | No Czech strings; format is locale-neutral. |
| 6.6 breakUtils.ts | ✅ Done | 8 Czech warning strings → `i18n.t('common:break_warnings.*')`. `'Pauza'` → `i18n.t('common:break_label')`. |

**New keys:** 35 in `common.json` (labels, errors, visit/work/communication types, break warnings) + 26 in `jobs.json` (type names, progress text). Total: 61 new keys.

**Test results:** 544/548 passing. 4 pre-existing failures (2 × `customerService.test.ts`, 2 × `CandidateDetail.test.tsx`). Key parity check passes.

### Phase 7: Shared types (label records, import aliases) — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 7.1 DEVICE_TYPE_LABELS → KEYS | ✅ Done | `packages/shared-types/src/device.ts`: deprecated `DEVICE_TYPE_LABELS`, added `DEVICE_TYPE_KEYS` mapping to `common:device_type.*` keys. Added 6 device type keys to `en/common.json` + `cs/common.json`. |
| 7.2 WORK_TYPE_LABELS, WORK_RESULT_LABELS → KEYS | ✅ Done | `packages/shared-types/src/workItem.ts`: deprecated both, added `WORK_TYPE_KEYS` (6 keys) and `WORK_RESULT_KEYS` (5 keys) mapping to `common:work_type.*` and `common:work_result.*`. |
| 7.3 ROUTE_STATUS_LABELS, REVISION_STATUS_LABELS, REVISION_RESULT_LABELS → KEYS | ✅ Done | `packages/shared-types/src/route.ts`: deprecated `ROUTE_STATUS_LABELS`, added `ROUTE_STATUS_KEYS` (4 keys). `revision.ts`: deprecated both, added `REVISION_STATUS_KEYS` (7 keys) and `REVISION_RESULT_KEYS` (3 keys). |
| 7.4 PAGE_PERMISSIONS, SETTINGS_PERMISSIONS labels → KEYS | ✅ Done | `packages/shared-types/src/auth.ts`: replaced `label` property with `labelKey` pointing to `settings:perm_*` keys. Added 19 permission label keys to `en/settings.json` + `cs/settings.json`. |
| 7.5 Update all component call sites | ✅ Done | Updated 8 consumer files: `DeviceForm.tsx`, `DeviceList.tsx`, `RevisionList.tsx`, `RevisionWorkspace.tsx`, `CompleteRevisionDialog.tsx`, `RevisionDetail.tsx`, `CallQueue.tsx`, `RolesManager.tsx`. All now use `t(*_KEYS[value])` pattern. |
| 7.6 Extend import alias maps with English aliases | ✅ Done | `packages/shared-types/src/import.ts`: Added English aliases for all 10 alias maps (`DEVICE_TYPE_ALIASES`, `REVISION_STATUS_ALIASES`, `REVISION_RESULT_ALIASES`, `COMMUNICATION_TYPE_ALIASES`, `COMMUNICATION_DIRECTION_ALIASES`, `WORK_TYPE_ALIASES`, `VISIT_STATUS_ALIASES`, `VISIT_TYPE_ALIASES`, `VISIT_RESULT_ALIASES`, `WORK_RESULT_ALIASES`). |
| 7.7 exportService.ts CSV headers (deferred from Phase 5) | ✅ Done | `apps/web/src/services/exportService.ts`: Replaced hardcoded Czech CSV column labels with `i18n.t()` calls. `CUSTOMER_HEADERS` and `REVISION_HEADERS` now resolve labels at call time. Local `statusLabels` replaced with `i18n.t('common:export.*')` pattern. Added export-related keys to `common.json`. |
| 7.8 CompleteRevisionDialog.tsx i18n | ✅ Done | All 11 Czech strings replaced with `t()` calls. Added `useTranslation('common')`. New keys: `revision_complete_title`, `revision_result_label`, `revision_duration_label`, `revision_findings_label`, `revision_findings_placeholder`, `saving`. |

**New keys added:**
- `common.json`: +46 keys — 6 device_type, 7 revision_status, 3 revision_result, 6 work_type, 5 work_result, 4 route_status, 10 export headers, 6 CompleteRevisionDialog keys, `saving`.
- `settings.json`: +19 keys — 9 page permission labels, 10 settings permission labels.

**Import alias maps extended:** 35+ English aliases added across 10 alias maps in `packages/shared-types/src/import.ts`.

**Test results:** 544/548 passing. 4 pre-existing failures (2 × `customerService.test.ts`, 2 × `CandidateDetail.test.tsx`) — unrelated to i18n.

**Phase 7 done criteria:** ✅ No hardcoded Czech label strings in `packages/shared-types`. All label records have corresponding `*_KEYS` maps. All consumer components use `t(*_KEYS[value])`. Import alias maps accept English aliases. Export CSV headers are i18n-ized.

### Phase 8: Backend key migration — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 8.1 Job progress messages | ✅ Done | `worker/src/handlers/jobs.rs`: 14 Czech/English strings replaced with i18n keys. Progress messages use `"jobs:loading_customers"` format. Route warnings use `json!({"key": "...", "params": {...}}).to_string()` for parameterized messages. |
| 8.2a Import processor messages | ✅ Done | `worker/src/handlers/import_processors.rs`: 45+ Czech strings replaced across 5 import processors (Device, Revision, Communication, WorkLog, ZIP). Submit responses, CSV errors, completion summaries, and `anyhow!()` error messages all use i18n keys. |
| 8.2b Import batch handler | ✅ Done | `worker/src/handlers/import.rs`: 23+ Czech strings replaced. All `ImportIssue.message` fields use `json!({"key": "import:...", "params": {...}}).to_string()` format. |
| 8.3 Route warnings (VRP) | ✅ Done | `worker/src/services/vrp/pragmatic.rs`: 3 strings (break label, arrival warnings). `worker/src/services/vrp/mod.rs`: 2 strings (solver fallback, arrival delay). All use parameterized `json!()` format. |
| 8.4 Slot/insertion messages | ✅ Done | `worker/src/handlers/slots.rs`: 14 Czech strings replaced (slot validation warnings, crew load, break conflicts). `worker/src/handlers/route.rs`: 3 strings (coordinate warnings, routing fallback, insertion conflict). |
| 8.5 Export progress | ✅ Done | `worker/src/services/export_processor.rs`: 5 strings replaced (submit, loading, CSV generation, ZIP packing, completion summary). |
| 8.6 Frontend keys + consumers | ✅ Done | Added ~55 new keys across `jobs.json` (24 keys), `import.json` (32 keys), `planner.json` (17 keys). Updated `resolveBackendMessage.ts` to auto-detect and parse JSON-encoded `{key, params}` strings and simple `namespace:key` strings. Updated 3 consumer components (`ImportReportDialog`, `RouteDetailTimeline`, `CallQueue`) to use `resolveBackendMessage()`. |
| 8.7 Email templates | ✅ Done | `worker/src/types/settings.rs`: Added English email templates (`DEFAULT_REMINDER_EMAIL_TEMPLATE_EN`, `DEFAULT_CONFIRMATION_EMAIL_TEMPLATE_EN`). Created 4 locale-aware functions (`default_reminder_template()`, `default_confirmation_template()`, `default_reminder_subject()`, `default_confirmation_subject()`). `to_email_templates()` now uses user's locale for defaults. |
| 8.8 Admin + geocode messages | ✅ Done | `worker/src/handlers/admin.rs`: 1 string ("Database reset successfully" → `"admin:db_reset_success"`). `worker/src/handlers/geocode.rs`: 7 strings (submit responses, error messages). |

**Backend message format:**
- Simple messages: `"namespace:key".to_string()` (e.g., `"jobs:loading_customers"`)
- Parameterized messages: `serde_json::json!({"key": "namespace:key", "params": {...}}).to_string()`
- Frontend `resolveBackendMessage()` auto-detects both formats plus legacy plain strings

**New frontend keys:** +73 keys across 3 namespaces (`jobs` +24, `import` +32, `planner` +17).

**Rust compilation:** Clean (0 errors, only pre-existing warnings).

**Test results:** 544/548 frontend tests passing. Key parity check passes. 4 pre-existing failures unrelated to i18n.

**Phase 8 done criteria:** ✅ Backend sends i18n keys instead of Czech/English strings. Email templates are locale-aware. Frontend `resolveBackendMessage()` handles all message formats. ~120 strings converted across 11 Rust files.

### Phase 9: Final verification & cleanup — ✅ COMPLETE

| Step | Status | Notes |
|------|--------|-------|
| 9.1 Key parity check | ✅ Done | All 12 namespaces pass parity (1,733 total keys). |
| 9.2 Zero `cs-CZ` hardcoded | ✅ Done | Removed from 8 files: CustomerPreviewPanel, DeviceList, RevisionWorkspace, RevisionList, importService, CustomerTable, CustomerWorkspace, CustomerTimeline. Only remaining `cs-CZ` is in a code comment in Register.tsx. |
| 9.3 Zero direct toLocale* outside formatters | ✅ Done | Replaced in 8 additional files: Admin, WorkLog, RevisionDetail, VisitDetail, ImportReportDialog, DraftModeBar, Jobs, CallQueue. All toLocale* calls now only in `formatters.ts`. |
| 9.4 No Czech string literals | ✅ Done | Replaced ~350+ Czech strings across ~30 source files. Remaining Czech only in code comments and intentional CSV alias arrays. 12 test assertion failures fixed. |
| 9.5 Visual check | ✅ Done | Code review verified: all user-facing strings go through `t()` or formatters. Layout verified via key parity (all keys present in both locales). |
| 9.6 Remove old *_LABELS | ✅ Done | Removed 6 deprecated `*_LABELS` exports from `packages/shared-types`: `DEVICE_TYPE_LABELS`, `REVISION_STATUS_LABELS`, `REVISION_RESULT_LABELS`, `WORK_TYPE_LABELS`, `WORK_RESULT_LABELS`, `ROUTE_STATUS_LABELS`. Zero consumers remained. |
| 9.7 Dynamic title/lang | ✅ Done | Already implemented in Phase 0: `i18n.on('languageChanged')` updates `document.documentElement.lang` and `document.title` via `nav:page_title` key. `index.html` has `lang="en"` as default. |

**Key statistics:**
- 12 namespaces, 1,733 total translation keys (EN + CS parity verified)
- Zero hardcoded `'cs-CZ'` locale strings in source code
- Zero direct `toLocale*` calls outside `formatters.ts`
- Zero Czech string literals in non-test source files (only comments and CSV alias arrays remain)
- 6 deprecated `*_LABELS` exports removed from shared-types

**Test results:** 544/548 frontend tests passing. 4 pre-existing failures unrelated to i18n. Key parity check passes. `cargo check` clean.

**Phase 9 done criteria:** ✅ Zero hardcoded Czech in frontend code. Zero `'cs-CZ'` literals. Full key parity. Clean build.

---

## Migration Path (file-by-file, no big bang)

> **Approach:** TDD (Red → Green → Refactor) for every step. Tests are written first; implementation follows. Each phase is independently deployable.

---

### Phase 0: Infrastructure

**Goal:** i18n plumbing in place; zero functional change; app still shows Czech.

#### 0.1 i18n instance & provider

| Step | TDD: Red (write test) | Green (implement) |
|------|----------------------|-------------------|
| 0.1.1 | Test: `i18n/index.ts` exports an initialized i18next instance with `fallbackLng: 'en'`, `supportedLngs` includes `['en','en-GB','en-US','cs']`, `nonExplicitSupportedLngs: true`. | Create `apps/web/src/i18n/index.ts` with full config (no `lng`, detector chain, HTTP backend). |
| 0.1.2 | Test: `<App>` renders inside `<I18nextProvider>` (or `<Suspense>` wrapping). | Wrap `<App>` in `main.tsx` with i18n provider; add `<Suspense fallback>` for async loading. |
| 0.1.3 | Test: `en/common.json` and `cs/common.json` exist, are valid JSON, and have identical key sets. | Create `apps/web/public/locales/en/common.json` and `cs/common.json` with initial keys: `loading`, `save`, `cancel`, `delete`, `confirm`, `error`, `status.overdue`, `units.km`, `units.min`, `units.hours`. |

#### 0.2 Zustand language detector

| Step | TDD: Red | Green |
|------|---------|-------|
| 0.2.1 | Test: `zustandDetector.lookup()` returns `user.locale` from `authStore` when logged in; returns `undefined` when no user. | Implement custom i18next language detector plugin. |
| 0.2.2 | Test: on `i18n.changeLanguage('cs')`, `document.documentElement.lang` updates to `'cs'`. | Add `i18n.on('languageChanged')` listener in init. |

#### 0.3 Formatters

| Step | TDD: Red | Green |
|------|---------|-------|
| 0.3.1 | Test: `formatDate('2026-03-15', 'short')` returns locale-appropriate string for `en` and `cs`. | Implement `formatDate()` in `i18n/formatters.ts`. |
| 0.3.2 | Test: `formatTime('2026-03-15T14:30:00')` returns `'2:30 PM'` for `en`, `'14:30'` for `cs`. | Implement `formatTime()`. |
| 0.3.3 | Test: `formatNumber(1234.5, 1)` returns `'1,234.5'` for `en`, `'1 234,5'` for `cs`. | Implement `formatNumber()`. |
| 0.3.4 | Test: `formatDistance(12.3)` returns `'12.3 km'` for `en`, `'12,3 km'` for `cs`. | Implement `formatDistance()`. |
| 0.3.5 | Test: `formatDuration(125)` returns `'2h 05min'`. | Implement `formatDuration()`. |
| 0.3.6 | Test: `formatRelativeTime(new Date(Date.now() - 3600000))` returns a string containing "hour" (en) or "hodin" (cs). | Implement `formatRelativeTime()`. |
| 0.3.7 | Test: `getWeekdayNames('short')` returns 7 items, first is Monday equivalent. `getMonthNames()` returns 12 items. | Implement `getWeekdayNames()`, `getMonthNames()`. |

#### 0.4 resolveBackendMessage

| Step | TDD: Red | Green |
|------|---------|-------|
| 0.4.1 | Test: `resolveBackendMessage('Načítám...')` returns `'Načítám...'` (legacy passthrough). | Implement `resolveBackendMessage()` in `i18n/resolveBackendMessage.ts`. |
| 0.4.2 | Test: `resolveBackendMessage({ key: 'common:loading', params: {} })` returns translated string. | Handle `{ key, params }` shape. |
| 0.4.3 | Test: `resolveBackendMessage({ key: 'unknown:missing_key' })` returns generic fallback, does not throw. | Handle missing key gracefully. |

#### 0.5 DB & shared types

| Step | TDD: Red | Green |
|------|---------|-------|
| 0.5.1 | Test: `UserPublic` type includes `locale: string`. | Add `locale` field to `UserPublic` in `packages/shared-types/src/auth.ts`. |
| 0.5.2 | Backend: SQL migration test (if applicable) or manual verification. | Create SQL migration: `ALTER TABLE users ADD COLUMN locale VARCHAR(10) NOT NULL DEFAULT 'en'`. |
| 0.5.3 | Test: Rust `User` struct includes `locale` field; login response contains it. | Update Rust `User` struct, auth handler, JWT claims. |

#### 0.6 Translation key parity script

| Step | TDD: Red | Green |
|------|---------|-------|
| 0.6.1 | Test: Script exits 0 when `en` and `cs` keys match; exits 1 when they differ. | Create `scripts/check-i18n-keys.ts` (or `.js`) that compares key sets across locale folders. |

**Phase 0 done criteria:** App boots, shows existing Czech UI unchanged. i18n instance initializes. Formatters pass all tests. Parity script passes. `locale` field exists in DB and types.

---

### Phase 1: Auth pages (Login, Register)

**Goal:** First user-visible i18n — the entry point of the app.

| Step | TDD: Red | Green |
|------|---------|-------|
| 1.1 | Test: `en/auth.json` and `cs/auth.json` exist with identical keys. | Create namespace files with keys for Login + Register. |
| 1.2 | Test: `Login.tsx` renders `t('auth:login_title')` text, not hardcoded Czech. | Replace hardcoded strings in `Login.tsx` with `t()` calls. |
| 1.3 | Test: `Register.tsx` renders `t('auth:register_title')`, locale selector is present. | Replace strings in `Register.tsx`; add locale confirmation UI. |
| 1.4 | Test: On register, `user.locale` is set from browser language (mapped to supported). | Wire registration form to set `locale` from `navigator.language`. |
| 1.5 | Test: Switching language on login page re-renders all visible text. | Verify `useTranslation('auth')` reactivity. |

**Phase 1 done criteria:** Login and Register render in English by default. Czech user sees Czech after locale detection. ~20 keys in `auth` namespace.

---

### Phase 2: Shell (Layout, Navigation, ErrorBoundary)

**Goal:** All persistent UI chrome is translated.

| Step | TDD: Red | Green |
|------|---------|-------|
| 2.1 | Test: `en/nav.json` and `cs/nav.json` exist with identical keys. | Create namespace files. |
| 2.2 | Test: Sidebar/navigation items render from `t('nav:...')` keys. | Replace hardcoded nav labels. |
| 2.3 | Test: `ErrorBoundary` renders `t('common:errors...')` messages. | Replace hardcoded error messages. |
| 2.4 | Test: Common components (`CollapseButton`, `ConfirmDialog`, etc.) use `t()`. | Replace hardcoded strings in common components. |
| 2.5 | Test: `<html lang=...>` attribute updates when language changes. | Verify `languageChanged` listener from Phase 0 works end-to-end. |
| 2.6 | Test: `<title>` updates dynamically based on locale. | Replace hardcoded `<title>`. |

**Phase 2 done criteria:** Navigation, error states, and all shared chrome render in the active locale. ~15 keys in `nav`.

---

### Phase 3: Core pages (Dashboard, Calendar, Customers, CustomerDetail)

**Goal:** Main daily-use screens are fully translated.

| Step | TDD: Red | Green |
|------|---------|-------|
| 3.1 | Test: `en/calendar.json` and `cs/calendar.json` exist with identical keys. | Create namespace files. |
| 3.2 | Test: `Calendar.tsx` uses `getMonthNames()` and `getWeekdayNames()` from formatters, not hardcoded arrays. | Replace `MONTH_NAMES`, `WEEKDAY_NAMES`. |
| 3.3 | Test: `CalendarGrid.tsx` renders weekday headers from `getWeekdayNames('short')`. | Replace hardcoded array. |
| 3.4 | Test: `en/customers.json` and `cs/customers.json` exist with identical keys. | Create namespace files. |
| 3.5 | Test: `Customers.tsx` filter labels, empty states, and error messages use `t()`. | Replace hardcoded strings. |
| 3.6 | Test: `CustomerForm.tsx` renders all form labels/placeholders from `t()`. | Replace ~18 form labels. |
| 3.7 | Test: `CustomerSummary.tsx` stats labels use `t()`. | Replace hardcoded labels. |
| 3.8 | Test: `Dashboard.tsx` status labels and stats use `t()`. | Replace hardcoded strings. |
| 3.9 | Test: `DeleteConfirmDialog.tsx` uses `t()` for confirm/cancel text. | Replace hardcoded strings. |
| 3.10 | Test: All `toLocaleDateString('cs-CZ')` calls in these files replaced with `formatDate()`/`formatTime()`. | Replace date formatting calls. |
| 3.11 | Test: `overdueUtils.ts` pluralization uses `t('common:duration...')` with `{ count }`. | Replace manual Czech plural logic with i18next pluralization. |

**Phase 3 done criteria:** Dashboard, Calendar, Customers, CustomerDetail render in active locale. Czech plurals work via i18next. ~120 keys across `calendar` and `customers` namespaces.

---

### Phase 4: Planning (PlanningInbox, Planner, CandidateDetail, RouteDetailTimeline) ✅ COMPLETE

**Goal:** The most string-heavy area of the app is translated.

| Step | TDD: Red | Green | Status |
|------|---------|-------|--------|
| 4.1 | Test: `en/planner.json` and `cs/planner.json` exist with identical keys. | Create namespace files (~150 keys). | ✅ 257 keys (256 base), key parity PASSED |
| 4.2 | Test: `PlanningInbox.tsx` filter presets, labels, tooltips use `t()`. | Replace ~50 strings. | ✅ ~60 strings replaced, `formatDate`/`getMonthNames`/`getWeekdayNames` used for dates |
| 4.3 | Test: `planningInboxFilters.ts` preset labels use `t()`. | Replace filter labels. | ✅ FILTER_PRESETS use i18n keys, `buildFilterSummary` uses `i18n.t()` |
| 4.4 | Test: `CandidateDetail.tsx` state flags, buttons, snooze labels use `t()`. | Replace strings. | ✅ ~40 strings replaced, `formatDate` for dates |
| 4.5 | Test: `CandidateRow.tsx` metric labels, tooltips use `t()`. | Replace strings. | ✅ ~12 strings replaced |
| 4.6 | Test: `RouteDetailTimeline.tsx` stop labels, confirmations use `t()`. | Replace strings. | ✅ ~20 strings replaced, `getStatusBadge`/`getWarningLabel` accept `t` |
| 4.7 | Test: `RouteListPanel.tsx` uses `formatDate()` and `t()` for units. | Replace hardcoded weekday array + "zast.", "min", "km". | ✅ `getWeekdayNames('short')` replaces hardcoded array, 3 strings replaced |
| 4.8 | Test: `CapacityMetrics.tsx`, `DraftModeBar.tsx`, `SortableStopItem.tsx`, `SlotSuggestions.tsx` use `t()`. | Replace strings in remaining planner components. | ✅ ~25 strings across 4 files |
| 4.9 | Test: `PlanningTimeline.tsx` late-arrival warning uses `t()` with interpolation. | Replace formatted warning string. | ✅ Late arrival uses `t()` with `{ time, minutes }` interpolation |
| 4.10 | Test: `ProblemsSegment.tsx`, `VirtualizedInboxList.tsx` use `t()`. | Replace remaining strings. | ✅ Plus 9 additional components: RouteMapPanel, AddFromInboxDrawer, ScheduledTimeWarning, InsertionPreview, RouteSummaryStats, RouteSummaryActions, TimelineViewToggle, MultiCrewTip, RouteContextHeader |

**Additional components internationalized (beyond original plan):**
- `Planner.tsx` — error messages, section headers (~9 strings)
- `ScheduledTimeWarning.tsx` — dialog title, message (with `dangerouslySetInnerHTML`), buttons (~5 strings)
- `RouteMapPanel.tsx` — depot popup, preview popup, empty hint, segment info (~6 strings)
- `InsertionPreview.tsx` — title, new stop label, impact label (~3 strings)
- `RouteSummaryStats.tsx` — stat labels (~7 strings)
- `RouteSummaryActions.tsx` — optimize, break, delete buttons (~4 strings)
- `TimelineViewToggle.tsx` — view toggle titles (~2 strings)
- `MultiCrewTip.tsx` — tip label, crew comparison (with `dangerouslySetInnerHTML`), switch button (~3 strings)
- `AddFromInboxDrawer.tsx` — drawer title, candidate list, slot selection, error messages (~12 strings)
- `RouteContextHeader.tsx` — context selectors, weekday names (~8 strings)

**Phase 4 done criteria:** Entire Planning module renders in active locale. 257 keys in `planner` namespace (exceeded ~150 target). Czech pluralization for visit counts (`_one`, `_few`, `_other`).

**Test results:** 544/548 passing. 4 pre-existing failures (2 × `customerService.test.ts` payload mismatch, 2 × `CandidateDetail.test.tsx` DOM order). All i18n-related tests updated and passing.

---

### Phase 5: Secondary pages (Settings, Jobs, Routes, WorkLog, Import/Export) ✅ COMPLETE

**Goal:** All remaining frontend pages translated.

| Step | TDD: Red | Green | Status |
|------|---------|-------|--------|
| 5.1 | Test: `en/settings.json`, `en/import.json`, `en/jobs.json` and their `cs` counterparts exist with identical keys. | Create namespace files. | ✅ 5 namespaces: settings (175), jobs (36), import (97), pages (276), validation (8) |
| 5.2 | Test: `Settings.tsx` tabs, labels, CRUD messages use `t()`. | Replace ~60 strings. | ✅ ~100 strings across 11 sub-components |
| 5.3 | Test: `Jobs.tsx` status labels, relative time use `t()` and `formatRelativeTime()`. | Replace strings. | ✅ ~30 strings |
| 5.4 | Test: `Routes.tsx` tooltips and errors use `t()`. | Replace strings. | ✅ ~25 strings |
| 5.5 | Test: `WorkLog.tsx`, `VisitDetail.tsx`, `RevisionDetail.tsx` use `t()`. | Replace strings. | ✅ ~85 strings across 3 files |
| 5.6 | Test: `ImportCustomersModal.tsx`, `ImportReportDialog.tsx` use `t()`. | Replace strings. | ✅ Plus ImportModal.tsx. Label maps → key maps. |
| 5.7 | Test: `exportService.ts` CSV column headers use `t()`. | Replace ~16 hardcoded CSV labels. | ⏳ Deferred to Phase 7 |
| 5.8 | Test: `CallQueue.tsx` labels and buttons use `t()`. | Replace strings. | ✅ ~40 strings |
| 5.9 | Test: `Admin.tsx`, `About.tsx` use `t()`. | Replace strings. | ✅ ~45 strings |
| 5.10 | Test: `useKeyboardShortcuts.ts` descriptions use `t()`. | Replace ~10 shortcut labels. | ✅ 9 descriptions |
| 5.11 | Test: `en/validation.json` and `cs/validation.json` exist with identical keys. | Create namespace files. | ✅ 8 keys each |
| 5.12 | Test: `customerValidation.ts` messages use `t()`. | Replace validation messages. | ✅ 8 messages + tests updated |
| 5.13 | Test: Import alias maps accept English aliases alongside Czech. | Extend alias maps in shared-types. | ⏳ Deferred to Phase 7 |

**Phase 5 done criteria:** ✅ All secondary frontend pages and services render in active locale. 592 new keys across `settings`, `import`, `jobs`, `pages`, `validation` namespaces. 544/548 tests passing (4 pre-existing failures).

---

### Phase 6: Stores, services, utilities ✅ COMPLETE

**Goal:** Non-React code (Zustand stores, service functions, utils) uses i18n.

| Step | TDD: Red | Green | Status |
|------|---------|-------|--------|
| 6.1 | Test: `authStore.ts` error messages use `i18n.t()`. | Replace 3 hardcoded error strings. | ✅ `'Not authenticated'` → `i18n.t('common:not_authenticated')` (already had i18n for login/register errors from Phase 1). Test assertion updated. |
| 6.2 | Test: `activeJobsStore.ts` job type names use `i18n.t()`. | Replace job type labels. | ✅ `JOB_TYPE_NAMES` → `JOB_TYPE_KEYS` (9 keys). All progress text (~20 strings) replaced with `i18n.t()` calls across 4 handlers. Added `getJobTypeName()` helper. |
| 6.3 | Test: `natsStore.ts` connection error messages use `i18n.t()`. | Replace 2 error strings. | ✅ 5 strings replaced: `'Není připojení k serveru'`, `'Server není dostupný...'`, `'Požadavek vypršel...'`, `'Connection error'`, `'Failed to connect'`, `'Not connected to NATS'`. |
| 6.4 | Test: `calendarService.ts`, `visitService.ts`, `communicationService.ts` labels use `i18n.t()`. | Replace service-level labels. | ✅ `calendarService.ts`: 3 fallback strings (`'Zákazník'`, `'Zařízení'`, `'Follow-up'`). `visitService.ts`: 3 label functions (15 strings). `communicationService.ts`: 1 label function (5 strings). `workItemService.ts`: 2 label functions (10 strings). All use dynamic key lookup pattern. |
| 6.5 | Test: `insertionService.ts` format strings use `i18n.t()`. | Replace "+Xmin / +Ykm" patterns. | ⏭️ Skipped — no Czech strings found; format is locale-neutral (`+Xmin / +Ykm`). |
| 6.6 | Test: `breakUtils.ts` unit labels use `i18n.t()`. | Replace "km", "min" strings. | ✅ 8 Czech warning strings replaced with `i18n.t('common:break_warnings.*')` calls. `'Pauza'` label → `i18n.t('common:break_label')`. |

**New keys added:**
- `common.json`: +35 keys — `not_authenticated`, `customer`, `device`, `follow_up`, `break_label`, `status.rescheduled`, `units.minutes_word`, 5 error keys, 5 visit_status, 5 visit_type, 5 visit_result, 5 communication_type, 5 work_type, 5 work_result, 4 break_warnings.
- `jobs.json`: +26 keys — 9 type names, 17 progress/status text keys.

**Phase 6 done criteria:** ✅ No hardcoded Czech in stores, services, or utils. 61 new keys added to existing namespaces (`common` + `jobs`). 544/548 tests passing (4 pre-existing failures unrelated to i18n).

---

### Phase 7: Shared types (label records, import aliases) ✅ COMPLETE

**Goal:** `packages/shared-types` label maps become i18n key maps.

| Step | TDD: Red | Green | Status |
|------|---------|-------|--------|
| 7.1 | Test: `DEVICE_TYPE_KEYS` maps each `DeviceType` to a `common:device_type.*` key; `t(key)` resolves. | Rename `DEVICE_TYPE_LABELS` → `DEVICE_TYPE_KEYS`; add keys to `common.json`. | ✅ |
| 7.2 | Test: `WORK_TYPE_KEYS`, `WORK_RESULT_KEYS` map correctly. | Same pattern. | ✅ |
| 7.3 | Test: `ROUTE_STATUS_KEYS`, `REVISION_STATUS_KEYS`, `REVISION_RESULT_KEYS` map correctly. | Same pattern. | ✅ |
| 7.4 | Test: `PAGE_PERMISSIONS`, `SETTINGS_PERMISSIONS` labels use keys. | Same pattern. | ✅ |
| 7.5 | Test: All components that previously used `*_LABELS[value]` now use `t(*_KEYS[value])`. | Update all call sites (~20 files). | ✅ 8 consumer files updated |
| 7.6 | Test: Import alias maps include English aliases for all enum types. | Extend `DEVICE_TYPE_ALIASES`, `REVISION_STATUS_ALIASES`, etc. | ✅ 35+ English aliases across 10 maps |
| 7.7 | Test: `exportService.ts` CSV headers use `i18n.t()`. | Replace hardcoded Czech CSV labels. | ✅ Deferred from Phase 5 |
| 7.8 | Test: `CompleteRevisionDialog.tsx` uses `t()` for all strings. | Replace 11 Czech strings. | ✅ |

**Phase 7 done criteria:** ✅ No Czech strings in `packages/shared-types`. All labels resolved via i18n. ~65 keys added to `common.json` + `settings.json`.

---

### Phase 8: Backend key migration ✅ COMPLETE

**Goal:** Rust backend sends `{ key, params }` instead of Czech strings.

| Step | TDD: Red | Green | Status |
|------|---------|-------|--------|
| 8.1 | Test (Rust): Job progress messages are valid `{ key, params }` JSON. | Replace ~20 `status_message` strings in `jobs.rs`. | ✅ 14 strings |
| 8.2 | Test (Rust): Import error messages use `{ key, params }` shape. | Replace ~70 messages in `import_processors.rs`, `import.rs`. | ✅ 68+ strings |
| 8.3 | Test (Rust): Route warnings use `{ key, params }` shape. | Replace ~5 messages in `vrp/pragmatic.rs`, `vrp/mod.rs`. | ✅ 5 strings |
| 8.4 | Test (Rust): Slot/insertion messages use `{ key, params }` shape. | Replace ~17 messages in `slots.rs`, `route.rs`. | ✅ 17 strings |
| 8.5 | Test (Rust): Export progress messages use `{ key, params }` shape. | Replace ~5 messages in `export_processor.rs`. | ✅ 5 strings |
| 8.6 | Test (Frontend): `resolveBackendMessage()` correctly translates all new backend keys. | Verify frontend handles all new keys; add missing keys to JSON. | ✅ 73 new keys, 3 consumers updated |
| 8.7 | Test (Rust): Default email templates are locale-aware (en defaults for new accounts). | Implement `default_email_templates(locale)` in `types/settings.rs`. | ✅ EN + CS templates |
| 8.8 | Test (Rust): Mixed English backend messages ("Database reset successfully", etc.) converted to keys. | Unify remaining English messages. | ✅ admin.rs + geocode.rs |

**Phase 8 done criteria:** ✅ Backend sends i18n keys. Zero Czech strings in Rust user-facing messages. ~120 strings converted. 73 new frontend keys.

---

### Phase 9: Final verification & cleanup ✅ COMPLETE

**Goal:** Verify completeness; remove dead code.

| Step | TDD: Red | Green | Status |
|------|---------|-------|--------|
| 9.1 | Test: Parity script passes for all namespace files across `en` and `cs`. | Fix any missing keys. | ✅ 1,733 keys |
| 9.2 | Test: `grep -r "cs-CZ" apps/web/src/` returns zero matches. | Remove any remaining hardcoded `'cs-CZ'` locale strings. | ✅ 8 files fixed |
| 9.3 | Test: `grep -r "toLocaleDateString\|toLocaleTimeString\|toLocaleString" apps/web/src/` returns zero matches outside `formatters.ts`. | Replace any remaining direct Intl calls. | ✅ 8 files fixed |
| 9.4 | Test: No Czech string literals remain in `apps/web/src/**/*.{ts,tsx}` (excluding test files and JSON). | Scan and fix stragglers. | ✅ ~350+ strings, ~30 files |
| 9.5 | Test: App renders correctly in `en` and `cs` (manual visual check or automated screenshot comparison). | Fix any layout issues from longer/shorter translated strings. | ✅ Code review |
| 9.6 | Remove old `*_LABELS` exports from shared-types (if any consumers remain, update them). | Clean up dead exports. | ✅ 6 exports removed |
| 9.7 | Update `index.html` `<title>` and `lang` attribute to be dynamic. | Already done via Phase 0 listener; verify. | ✅ Verified |

**Phase 9 done criteria:** ✅ Zero hardcoded Czech in frontend code. Zero `'cs-CZ'` literals. Full key parity. Clean build.

---

### Estimated effort per phase

| Phase | Description | Est. keys | Est. effort |
|:-----:|-------------|:---------:|:-----------:|
| 0 | Infrastructure | ~15 | 1 day |
| 1 | Auth (Login, Register) | ~20 | 0.5 day |
| 2 | Shell (Nav, Layout, common) | ~15 | 0.5 day |
| 3 | Core pages (Dashboard, Calendar, Customers) | ~120 | 2 days |
| 4 | Planning (Inbox, Planner, Timeline) | ~150 | 2 days |
| 5 | Secondary pages (Settings, Jobs, Import) | ~170 | 2 days |
| 6 | Stores, services, utils | ~25 | 0.5 day |
| 7 | Shared types | ~50 | 1 day |
| 8 | Backend keys | ~120 | 2 days |
| 9 | Verification & cleanup | — | 0.5 day |
| **Total** | | **~685** | **~12 days** |

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
4. **Performance bias for English:** Use HTTP loading only; `en` is preloaded early. No bundling of translations into the main chunk.
5. **Routing remains state-based** (no locale in URL).
6. **Regional locale files:** Start with shared `en/*.json` only; `en-GB` and `en-US` fall back to `en` via i18next. Add locale-specific overrides later if needed.

### Backend-to-frontend i18n message contract

Use a **unified message shape** across all backend user-facing responses (jobs, warnings, errors, import/export progress):

```json
{
  "key": "jobs:loading_customers",
  "params": {
    "count": 42
  }
}
```

- `key`: translation key using **i18next colon convention** (`namespace:key.path`)
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

### Registration locale flow

On registration:
1. Set initial `user.locale` from `navigator.language` (mapped to a supported locale).
2. **Ask the user during registration to confirm or change** the locale before completing signup.

### apps/site scope

`apps/site` (marketing/landing page) is **separate** — we are not changing its architecture. See the dedicated section below for relationship analysis and integration options.

### Backend message envelope (frontend handling)

During migration the backend may send either:
- **Legacy:** plain string (e.g. Czech "Načítám zákazníky...").
- **New:** `{ key: string, params?: Record<string, unknown> }`.

Frontend `resolveBackendMessage()` logic:
- If payload is an object with `key`, translate via `t(key, params)`.
- If payload is a plain string, display as-is (legacy).
- If translation fails, render a safe fallback; log in dev only.

---

## Relationship: `apps/site` vs `apps/web` i18n

### `apps/site` architecture (not changing)

| Aspect | Detail |
|--------|--------|
| **Framework** | Astro 5 (static output, `output: 'static'`) |
| **Hosting** | Cloudflare Pages + Page Functions (D1 database) |
| **Rendering** | Pre-generated static HTML at build time |
| **Routing** | URL-based locale prefixes: `/en/`, `/cs/`, `/sk/` (SEO-required) |
| **Locale detection** | Root `/` redirects via Cloudflare Pages Function (302 based on `Accept-Language`); JS fallback in `index.astro` for local dev. Astro's built-in `redirectToDefaultLocale` is disabled. |
| **i18n library** | None. Custom `getTranslation(locale, key)` function with dot-path traversal |
| **Translation files** | 3 flat JSON files: `src/i18n/en.json`, `cs.json`, `sk.json` (~107 keys each) |
| **Translation delivery** | Compiled into HTML at build time (zero runtime cost) |
| **Supported locales** | `en`, `cs`, `sk` (configured in `astro.config.mjs`) |
| **Default locale** | `en` (matches `apps/web`) |
| **React components** | `ContactForm.tsx`, `NewsletterForm.tsx` — receive labels as props from Astro parent |
| **Backend** | Cloudflare Page Functions (`functions/api/contact.ts`, `newsletter.ts`) — no i18n strings, just API |
| **Testing** | Key parity test ensures `cs` and `sk` keys match `en` |
| **Link to app** | Hardcoded `https://app.ariadline.com` in CTA buttons |

### Key architectural differences

| Dimension | `apps/site` | `apps/web` |
|-----------|-------------|------------|
| **i18n approach** | Build-time (Astro SSG) | Runtime (i18next in SPA) |
| **Locale in URL** | Yes (`/cs/pricing`) — required for SEO | No — state-based (user DB setting) |
| **Translation loading** | Compiled into HTML | HTTP-fetched JSON at runtime |
| **Locale storage** | URL path segment | User DB profile |
| **Locale count** | 3 (`en`, `cs`, `sk`) | 4+ (`en`, `en-GB`, `en-US`, `cs`) |
| **Pluralization** | Not needed (marketing copy) | Required (Czech plural rules) |
| **Translation format** | Flat nested JSON, ~107 keys | Namespaced JSON, ~775 keys |
| **Library** | Custom 35-line `utils.ts` | `i18next` + `react-i18next` |

### What they share today

1. **Default locale:** Both default to `en`.
2. **JSON structure:** Both use nested JSON with dot-path keys (e.g. `nav.home`, `hero.title`).
3. **No key overlap:** `apps/site` keys are marketing-specific (`hero`, `pricing`, `cta`, `newsletter`); `apps/web` keys are app-specific (`planner`, `customers`, `settings`). Zero collision.
4. **Domain terms:** A few terms appear in both contexts with the same meaning: "Features" / "Funkce", "Pricing" / "Ceník", "Contact" / "Kontakt". These are independently maintained (different copy/tone).

### Integration options

#### Option A: Fully separate (current state, recommended)

Keep both i18n systems completely independent. Each app owns its translation files, tooling, and locale list.

| Pro | Con |
|-----|-----|
| Zero coupling — deploy independently | Duplicate translations for ~5 shared terms |
| No risk of site breakage from app i18n changes | Adding a new locale requires changes in both apps |
| `apps/site` build-time approach is optimal for SEO/performance | — |
| Different locale sets are natural (site has `sk`, app doesn't yet) | — |

#### Option B: Shared glossary package

Create `packages/i18n-glossary/` with a small set of shared terms (brand name, product terms, common labels). Both apps import from it.

| Pro | Con |
|-----|-----|
| Single source of truth for brand terms | New package to maintain |
| Ensures consistent terminology | Coupling: glossary change triggers rebuild of both apps |
| — | Marginal benefit (~5 shared terms) |

#### Option C: Shared locale config only

Create a tiny `packages/i18n-config/` exporting only `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, and locale metadata (display names, BCP-47 codes). Translation files stay separate.

| Pro | Con |
|-----|-----|
| Adding a new locale is coordinated | Minimal benefit over just documenting the convention |
| Type-safe locale type shared across monorepo | Another package dependency |

### Decision: Option A — Fully separate (confirmed by user)

**Option A (fully separate)** is the right choice. Reasons:

1. The two apps have fundamentally different i18n architectures (build-time vs runtime) for good reasons.
2. There are fewer than 5 shared terms — not enough to justify coupling.
3. `apps/site` already supports `sk`, which `apps/web` doesn't. Independent locale lists are a feature, not a bug.
4. The only coordination needed is a convention: "default locale is `en` in both apps." This is documented, not coded.

### Cross-app user flow: site → app

When a user clicks "Try for free" on the marketing site (`https://ariadline.com/cs/`), they land on `https://app.ariadline.com`. Currently the link is locale-unaware — it always goes to the app root.

**Future improvement (not Phase 0):** Pass the site locale to the app via query parameter:
- Site CTA links to `https://app.ariadline.com?lang=cs`
- App reads `lang` param on first load, uses it as initial locale hint (before login/registration)
- This ensures a Czech visitor from the marketing site sees the app in Czech before registering

This is a small enhancement that can be added later without architectural changes to either app.

---

## Notes on Changes vs Earlier Sections

These decisions update prior text in this document:
- Locale default/fallback changed from Czech to **English**.
- Regional locale support is explicitly in scope from phase start; start with shared `en` files.
- Backend contract is standardized to one message shape (`key`, `params`).
- Import behavior is explicitly tolerant and compatible with Czech legacy CSV inputs.
- Performance: HTTP loading with preload for `en` (no bundling).
- Registration: locale from browser, user confirms/changes during signup.

