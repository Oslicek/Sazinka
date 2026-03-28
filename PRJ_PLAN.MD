# Persistence Gaps — Fix Plan

Audit performed 2026-02-23. Each item below describes UI state that was **not**
persisted at audit time (or was redundant), so it reset on route changes; some areas
may already have been fixed later—see `PRJ_BUGS.MD` and recent commits.

---

## Priority 1 — High impact, quick fix

### P1-1: Plan page — `selectedRouteId` not persisted
**Page:** `/plan`
**Current:** When the user selects a route, navigates away, and returns, the selection
resets to the first route in the list.
**Fix:** Persist `selectedRouteId` via UPP session channel.
Restore on mount; fall back to first route if the saved ID is no longer in the list.
**Scope:** `Plan.tsx` + persistence profile/control wiring for route selection state.

#### Tests (RED)
1. Mount → select route B → unmount → remount → assert `selectedRouteId` is B.
2. Mount → select route B → unmount → remove B from route list → remount → assert
   falls back to first available route (not B).
3. Mount with empty route list → assert `selectedRouteId` is `null`, no crash.
4. Two unmount/remount cycles with the same selection → still persisted (multi-cycle).
5. Corrupted/non-UUID value in UPP storage → assert falls back to `null` or first
   route without throwing.

### P1-2: Jobs page — tab filter not persisted
**Page:** `/jobs`
**Current:** The tab filter (`all | completed | failed | cancelled`) resets to `all`
on every navigation.
**Fix:** Persist the active tab via UPP session channel.
**Scope:** `Jobs.tsx` + persistence profile/control wiring for job-history tab state.

#### Tests (RED)
1. Mount → switch to `failed` tab → unmount → remount → assert active tab is `failed`.
2. Two unmount/remount cycles → still `failed` (multi-cycle).
3. Corrupted value in UPP storage (e.g. `"bogus"`) → assert falls back to `all`.

### P1-3: Calendar page — date/day view state not persisted
**Page:** `/calendar`
**Current:** Filters already live in URL params (shareable today). `currentDate` and
`selectedDay` are not—they reset on navigation. This phase does **not** add more URL
state for date/day; it only adds UPP session persistence for those two.
**Fix:** Persist both `currentDate` and `selectedDay` via UPP session channel
(no URL sharing in this phase). Keep existing URL-based filter persistence as-is.
**Scope:** `Calendar.tsx` + persistence profile/control wiring for date/day state.

#### Tests (RED)
1. Mount → navigate to March 2026 → unmount → remount → assert `currentDate` is in
   March 2026.
2. Mount → select a specific day → unmount → remount → assert `selectedDay` restored.
3. Mount → set both `currentDate` and `selectedDay` → unmount → remount → assert both
   restored together (no clobbering).
4. Two unmount/remount cycles → both still persisted (multi-cycle).
5. `Date` / `CalendarDay` serialization roundtrip: persist → read back → assert
   year/month/day match (no timezone drift or type coercion).
6. Corrupted JSON in UPP storage → assert falls back to today / `null` without crash.

---

## Priority 2 — Medium impact, moderate effort

### P2-1: Inbox — remove dead parent filter pipeline
**Page:** `/inbox` (`PlanningInbox.tsx`)
**Current:** `PlanningInboxInner` has a complete filter state + manipulation callbacks
(`toggleTimeFilter`, `toggleProblemFilter`, `setTriState`, `applyPreset`,
`clearFilters`, `setRootOperator`, `setGroupOperator`, `activeFilterCount`,
`filterSummary`, `hasAdvancedActive`) that are **never used in JSX**. This is dead code
left over from before `InboxListPanel` took ownership of the filter UI.
**Fix:** Remove the dead filter state, callbacks, UPP profile usage, and legacy seed
effect from `PlanningInboxInner`. The `InboxListPanel` is the sole filter owner.
**Scope:** ~120 lines of dead code in `PlanningInbox.tsx`. Also remove the
`inboxFiltersProfile` from the `PersistenceProvider` profiles array.
**Migration:** Before dropping the profile, ensure `InboxListPanel` (or one owner) is
the only reader/writer for inbox filter state and either migrate legacy
`sessionStorage` keys into UPP or accept a one-time reset—avoid dual-write races.

#### Tests (RED)
1. Regression: `InboxListPanel` filter bar renders, preset changes persist across
   unmount/remount — same behavior as before cleanup.
2. Regression: no `sessionStorage` key is written by `PlanningInboxInner` for filters
   after removal (assert absence of dual-write).
3. `PersistenceProvider` mounts without `inboxFiltersProfile` in profiles array —
   no error, other profiles still function.

### P2-2: Inbox — remove dead parent candidate pipeline
**Page:** `/inbox` (`PlanningInbox.tsx`)
**Current:** `PlanningInboxInner` loads its own candidates via `getInbox()`, computes
`sortedCandidates`, `candidateRowData`, insertion metrics, etc. — but the actual
candidate list displayed to the user comes from `InboxListPanel`'s independent pipeline.
The parent's pipeline produces stale data (see BUG-7: `sortedCandidatesRef` was empty).
**Fix:** Remove the duplicate candidate pipeline from `PlanningInboxInner`. Any
functionality that depends on candidates (insertion metrics, slot suggestions) should
be moved into `InboxListPanel` or exposed via PanelState signals.
**Scope:** Large refactor. Needs careful dependency analysis to identify what other
features depend on the parent's candidate data.

#### Tests (RED)
1. Regression: candidate list renders with correct data from `InboxListPanel`'s
   pipeline after parent pipeline removal.
2. Regression: checkbox selection (BUG-7 fix) still works — toggling checkbox updates
   `selectedIds` without rejection.
3. If insertion metrics / slot suggestions are moved: assert they produce the same
   output as before (snapshot or value comparison).
4. If insertion metrics / slot suggestions are removed: assert no runtime reference
   to deleted code remains (compile + render without error).

---

## Priority 3 — Low impact, good to have

### P3-1: Customers page — `selectedCustomer` not persisted
**Page:** `/customers`
**Current:** Selecting a customer and navigating away loses the selection.
**Fix:** Persist via UPP session channel.

#### Tests (RED)
1. Mount → select customer → unmount → remount → assert customer restored.
2. Mount → select customer → unmount → delete that customer → remount → assert
   graceful fallback (no selection or first in list), no crash.
3. Two unmount/remount cycles → still persisted (multi-cycle).

### P3-2: Plan page — `timelineView` not persisted
**Page:** `/plan`
**Current:** Timeline view mode resets on navigation.
**Fix:** Persist via UPP session channel.
**Note:** P1-1 also touches `Plan.tsx`; prefer a single plan UI profile with multiple
controls (route selection, timeline mode) if it reduces wiring duplication.

#### Tests (RED)
1. Mount → switch to `compact` view → unmount → remount → assert `timelineView` is
   `compact`.
2. Two unmount/remount cycles → still persisted (multi-cycle).
3. If sharing a profile with P1-1: updating `timelineView` does not clobber
   `selectedRouteId` and vice versa.

### P3-3: Inbox — `isAdvancedFiltersOpen` panel state not persisted
**Page:** `/inbox`
**Current:** The advanced filters panel collapses on every navigation.
**Fix:** Persist via UPP session channel.

#### Tests (RED)
1. Mount → open advanced filters → unmount → remount → assert panel is open.
2. Mount → close advanced filters → unmount → remount → assert panel is closed.
3. Two unmount/remount cycles → still persisted (multi-cycle).

---

## Cross-cutting test requirements

Every persistence item above must also satisfy these patterns:

- **Multi-cycle:** At least 2 consecutive unmount/remount cycles with the same
  persisted value — catches dual-write and stale-overwrite bugs (see BUG-8).
- **Corrupted storage:** Malformed JSON or unexpected type in the UPP channel must
  fall back to the default value without throwing.
- **Profile isolation:** When multiple controls share one UPP profile, updating one
  control must not clobber another.

---

## Notes

- Session-scoped persistence survives same-tab navigation and page refresh, but not
  tab close. It is isolated per tab.
- For this plan, use UPP as the default and preferred mechanism for all new
  persistence controls.
- URL-based sharing is explicitly out of scope for this phase. If needed later,
  add a dedicated explicit sharing action.
- Each fix follows TDD: write the RED tests listed above first, then GREEN
  implementation, then update this plan to mark completion.

---

## Scoring Preset Pack + Localization (Plan Only)

**Status:** Implemented ✅ (2026-03-25)  
**Date:** 2026-02-24  
**Method:** Strict TDD (RED -> GREEN -> REFACTOR), maximum test coverage

### 1) Goal

Prepare **5 predefined scoring profiles** for dispatcher use-cases while keeping
only one default profile active by default:

1. `standard` (default)
2. `new_customers_first`
3. `due_date_radar`
4. `overdue_firefighter`
5. `data_quality_first`

All profile names must be localized to supported languages (**cs/en/sk**).

### 2) Functional Scope

#### 2.1 Preset definitions (baseline weights)

All unspecified factors are `0`.

| Key | lifecycle_rank | days_until_due | customer_age_days | overdue_days | geocode_failed | total_communications | days_since_last_contact | no_open_action |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `standard` | +1000 | -5 | +0.01 | 0 | 0 | 0 | 0 | 0 |
| `new_customers_first` | +1700 | -2 | +0.005 | 0 | 0 | 0 | 0 | +350 |
| `due_date_radar` | +700 | -12 | +0.005 | +3 | 0 | 0 | 0 | 0 |
| `overdue_firefighter` | +500 | -18 | 0 | +8 | 0 | 0 | 0 | +100 |
| `data_quality_first` | +500 | -4 | 0 | 0 | +900 | 0 | 0 | +150 |

#### 2.2 Localized profile names

| Key | cs | sk | en |
|---|---|---|---|
| `standard` | Standardní | Štandardný | Standard |
| `new_customers_first` | Noví zákazníci první | Noví zákazníci prví | New Customers First |
| `due_date_radar` | Radar termínů | Radar termínov | Due-Date Radar |
| `overdue_firefighter` | Krizový režim po termínu | Krízový režim po termíne | Overdue Firefighter |
| `data_quality_first` | Kvalita dat a geokódingu | Kvalita dát a geokódovania | Data Quality First |

#### 2.3 Factor interaction: `days_until_due` vs `overdue_days`

Some presets use **both** factors. That is intentional **only** when the signals differ:

- **`days_until_due`** (often negative when overdue) pushes “due soon / overdue” within the
  usual planning horizon.
- **`overdue_days`** adds extra weight for **depth** of backlog (how long past due).

Implementation must document in code (one place, e.g. scoring service) how raw values are
computed so presets do not produce surprising double-counting. Presets that only need one
signal should set the other weight to `0`.

### 3) Architecture Decisions

1. **System preset identity:** Introduce immutable system preset key (e.g. `system_key`,
   nullable for non-system profiles) with **unique `(user_id, system_key)`** where
   `system_key IS NOT NULL`. Company scope remains the existing `user_id` proxy.
2. **Default behavior:** `standard` remains the only default selected profile.
3. **Localization source:** UI renders preset **display** names from i18n keys (cs/en/sk/en),
   not from persisted `name` for system presets (see 3.1). Persisted `name` may remain for
   backwards compatibility or admin display until migrated.
4. **Backward compatibility:** Existing system profile rows are backfilled with `system_key`.
5. **Custom profiles unchanged:** User-created profile names stay free-form and non-localized;
   `system_key` stays `NULL`.

#### 3.1 Migration & backfill policy (including edited Standard)

- **Insert missing presets only:** For each user, if a system preset row for a key does not
  exist, insert it with factory baseline weights and localized seed `name` **or** leave
  `name` as legacy — but UI must use i18n by `system_key` (decision locked in GREEN).
- **Do not overwrite existing factor weights** on migration except when the user explicitly
  invokes **Restore defaults** for that system profile.
- **Assign `system_key`** to the existing Standard row: match by `is_system = TRUE` and
  known factory name patterns **or** single system profile per user if unambiguous;
  document the exact rule in the migration comment.
- **Edited Standard:** If the user already changed Standard’s weights, **preserve** those
  values; migration only adds `system_key` and any missing preset rows. Restore defaults
  still resets to the baseline table in §2.1.

#### 3.2 List payload & performance (rule sets + factors)

Listing many rule sets with **per-row factor hydration** risks **N+1 queries** and larger
JSON payloads when each user has 5+ system profiles. During GREEN/REFACTOR:

- Prefer **one query** that loads all factors for the user’s rule set IDs, then attach in
  memory, **or** omit `factors` from list responses and load factors only when opening the
  edit form — pick one strategy and cover it with tests so list performance does not regress.

#### 3.3 NATS / shared-types contract

- New fields (`systemKey`, optional `factors` on list) must be **optional** in JSON so older
  clients do not break.
- Document any subject payload change in message schema notes (same repo convention as
  other NATS types).

### 4) TDD Plan (Maximum Coverage)

#### Phase A — RED (tests first, must fail)

#### A.1 Backend/data tests (Rust)

1. **Preset catalog coverage**
   - Assert 5 preset keys exist.
   - Assert each key maps to exact factor weights.
2. **Seed/backfill behavior**
   - New company gets all 5 system presets.
   - Exactly one default (`standard`).
   - Re-running seed is idempotent (no duplicates).
3. **Restore defaults**
   - Restoring each system profile resets exact baseline weights.
4. **System key immutability**
   - API update cannot alter `system_key`.
5. **Localization-aware naming path**
   - API payload includes `system_key`; UI can localize reliably.

#### A.2 Migration tests

1. Existing tenants with only `standard` are backfilled with missing 4 presets.
2. Existing customized non-system profiles remain untouched.
3. Existing system profiles receive correct `system_key` assignment.
4. No duplicate `(user_id, system_key)` rows after migration.

#### A.3 Frontend tests (Vitest + RTL)

1. Settings scoring tab shows 5 presets with localized labels for `cs`, `en`, `sk`.
2. Inbox scoring dropdown shows localized names for system presets.
3. Switching language re-renders localized preset labels correctly.
4. Selecting a preset persists selected rule set as before.
5. Restoring a system preset reflects baseline factor sliders immediately after reload.
6. Editing custom profile name still works and is not overridden by localization.

#### A.4 i18n completeness tests

1. Translation keys for all 5 presets exist in `cs/en/sk`.
2. **Concrete assertion (avoid flakiness):** use a dedicated test i18n instance or assert
   rendered text equals expected Czech/Slovak/English strings from the §2.2 table — not
   merely “key exists”. If using `t(key)`, optionally assert the result is **not** equal to
   the raw key string (catches missing keys when fallback returns the key).
3. Optional: snapshot tests per locale for scoring profile list.

#### Phase B — GREEN (minimal code to pass RED)

1. Add/extend DB model for system preset key + migration/backfill.
2. Extend worker scoring queries/handlers for full preset seed/restore behavior.
3. Extend shared types to include system preset key in rule-set payload.
4. Add locale keys in all 3 languages.
5. Update frontend rendering to resolve localized preset names by system key.

#### Phase C — REFACTOR (while tests stay green)

1. Consolidate preset constants into one shared source-of-truth map.
2. Remove duplicated profile-name mapping logic.
3. Keep all new helper functions small and deterministic.
4. Add short inline comments only where mapping logic is non-obvious.

### 5) Files Expected to Change

- `worker/migrations/*` (new migration for preset keys + backfill)
- `worker/src/db/queries/scoring.rs`
- `worker/src/handlers/scoring.rs` (if response shaping changes)
- `worker/src/types/scoring.rs`
- `worker/src/handlers/onboarding.rs` (seed path)
- `packages/shared-types/src/scoring.ts`
- `apps/web/src/components/settings/ScoringRuleSetsManager.tsx`
- Inbox rule-set selector (confirm owner before coding — e.g. `InboxFilterBar.tsx`,
  `PlanningInbox.tsx`, or shared planner toolbar; update this list to the actual file)
- `apps/web/public/locales/cs/settings.json`
- `apps/web/public/locales/en/settings.json`
- `apps/web/public/locales/sk/settings.json`
- New/updated test files in worker + web

### 6) Coverage Targets

1. **All newly introduced branches** covered by tests (no untested branch in new preset logic).
2. **Locale coverage:** each preset label verified in all 3 locales.
3. **Migration safety:** tested against realistic pre-migration states.
4. **Regression guard:** existing Standard behavior remains unchanged.

### 7) Definition of Done

- [ ] 5 system presets available for every company.
- [ ] `standard` remains the only default profile.
- [ ] Preset names are localized in cs/en/sk in UI.
- [ ] Restore defaults returns exact baseline weights per preset.
- [ ] Existing custom profiles are unaffected.
- [ ] Worker tests + Web tests pass fully.
- [ ] `PRJ_CONTEXT.MD` updated with completed change summary.

### 8) Out of scope (this delivery)

- **Playbook thresholds in product UI:** Percentage triggers and guardrails documented in
  `PRJ_UX.MD` (§8.6b) are **operational guidance** only. This implementation does **not**
  add in-app hints, alerts, or auto-switching of profiles based on those thresholds unless
  explicitly added in a follow-up plan.
- **Changing playbook numbers:** Product may tune thresholds separately; no coupling to code
  constants in this phase.

### 9) Migration testing notes (sqlx / DB)

- Prefer **integration tests** against a real Postgres test DB or the project’s existing
  migration test strategy for: up/down, backfill idempotency, and `(user_id, system_key)`
  uniqueness.
- If only **sqlx offline** is available for CI, document which migration guarantees are
  covered by SQL review + manual staging verification vs automated tests.

---
---

# Customers Grid Enhancement — Implementation Plan

**Source:** PRJ_UX.MD §8.3a  
**Date:** 2026-03-25  
**Method:** Strict TDD (RED → GREEN → REFACTOR), near-100 % code coverage  
**Persistence:** UPP-only (no URL sync for Customers UI state in this scope: filters, sort, view mode, grid configuration)

---

## Architecture Overview

### Current state

- **Page:** `Customers.tsx` — search, 3 select filters (geocode, revision, type), sort via URL+UPP (`sortBy`/`sortOrder`), table/cards toggle.
- **Table:** `CustomerTable.tsx` — 5 hard-coded columns, TanStack Table with **client-side-only** sorting (disconnected from server `sortBy`).
- **UPP profile:** `customers.filters` (session) — 8 controls including `sortBy`, `sortOrder`, `selectedCustomerId`.
- **SavedViewsSelector:** 6 predefined filter presets, used inline.
- **Backend (`customer.list.extended`):** single `sortBy`/`sortOrder`, search, geocode/revision/type filters.

### Target state

| Concern | Channel | Profile | Notes |
|---------|---------|---------|-------|
| Search, geocode, revision, type filters | session | `customers.filters` | Ephemeral per-tab context |
| Advanced filter expression | session | `customers.filters` | Future; placeholder control |
| `isAdvancedFiltersOpen` | session | `customers.filters` | Panel toggle |
| `selectedCustomerId` | session | `customers.filters` | Existing (P3-1) |
| `viewMode` | session | `customers.filters` | Existing |
| `sortModel` | **local** | `customers.grid` | Persists across tabs/restart |
| `visibleColumns` | **local** | `customers.grid` | Persists across tabs/restart |
| `columnOrder` | **local** | `customers.grid` | Persists across tabs/restart |

### Sorting strategy

- **`sortModel`** format: `SortEntry[]` where `SortEntry = { column: string; direction: 'asc' | 'desc' }`.
- Array order = priority (index 0 = primary).
- **All sort levels are server-side**: full `sortModel` is sent to backend and translated into SQL `ORDER BY` sequence.
- **No client-side row reordering fallback** in `CustomerTable`; table renders rows in server-returned order.
- **Deterministic tie-break on backend**: append stable final keys (e.g. `name ASC`, `id ASC`) when needed.

### Column visibility strategy

- All available columns defined in a **column definitions module** (`customerColumns.ts`).
- Each column: `{ id, labelKey, category, sortField?, sortable, core }`.
- `core` columns (e.g. `name`) cannot be hidden.
- `visibleColumns: string[]` — ordered list of column IDs currently shown.
- `columnOrder: string[]` — full ordering (superset of visible); drag-and-drop reorder changes this.
- `CustomerTable` renders **only columns in `visibleColumns`**, in `columnOrder` sequence.
- If user action (single toggle or bulk action) hides one or more columns currently present in `sortModel`, app must show **one summary modal** listing all affected columns/sort rules and require explicit confirmation before mutating `sortModel`.

### Consistency rules (locked for implementation)

1. **UPP-only migration is complete in this delivery:** remove URL coupling for `view`, `geocodeFilter`, `revisionFilter`, `typeFilter`, and sort.
2. **Sanitization ownership:** because the current UPP core does not run profile validators/plugins, all new controls use explicit sanitizers at the page/component boundary (`sanitizeSortModel`, `sanitizeVisibleColumns`, etc.).
3. **Cards mode contract:** cards view keeps filtering/sorting behavior but does not expose table-only controls that are meaningless in cards (e.g., per-column visibility toggles inline in the table header).
4. **Column state invariant:** `columnOrder` is the canonical superset order, `visibleColumns` is a subset for rendering. Visibility toggles never delete IDs from `columnOrder`.
5. **Multisort is server-authoritative:** every active sort priority is executed on backend for full dataset ordering across pagination.
6. **Canonical default sort model:** persisted and committed `sortModel` is always non-empty; reset/clear writes `DEFAULT_SORT_MODEL` (never `[]`).
7. **Default sort visibility is explicit:** UI always shows `name ASC` when default ordering is active.
8. **Hide-sorted-column safety:** hiding sorted columns requires explicit modal confirmation; for multi-impact actions, use one aggregated summary modal (not one modal per column). On confirm, affected entries are removed from `sortModel` and resulting model is canonicalized (fallback `DEFAULT_SORT_MODEL` if emptied).

---

## P0: i18n bug — `filter_type_*` translations

**Bug:** Type filter `<select>` on Customers page shows raw i18n keys (`filter_type_all`, `filter_type_company`, `filter_type_person`) instead of translated text.

**Root cause:** Keys `filter_type_all`, `filter_type_company`, `filter_type_person` are missing from all three locale files (`cs/customers.json`, `en/customers.json`, `sk/customers.json`). Existing `type_company`/`type_person` are used elsewhere (badge labels) and have slightly different wording intent.

### Files

- `apps/web/public/locales/en/customers.json`
- `apps/web/public/locales/cs/customers.json`
- `apps/web/public/locales/sk/customers.json`
- `apps/web/src/pages/__tests__/Customers.i18n.test.tsx` (new)

### Tests (RED)

1. Type filter `<select>` renders **translated** `filter_type_all` in `en` (not the raw key string).
2. Type filter `<select>` renders **translated** `filter_type_company` in `en`.
3. Type filter `<select>` renders **translated** `filter_type_person` in `en`.
4. Same 3 assertions for `cs` locale.
5. Same 3 assertions for `sk` locale.
6. Switching from `en` to `cs` re-renders filter labels to Czech text.
7. Selecting `company` and switching language → persisted enum value is still `'company'`, display label changes.

### GREEN

Add keys to all 3 locale files:
- `en`: `"filter_type_all": "All types"`, `"filter_type_company": "Companies"`, `"filter_type_person": "Individuals"`
- `cs`: `"filter_type_all": "Všechny typy"`, `"filter_type_company": "Firmy"`, `"filter_type_person": "Fyzické osoby"`
- `sk`: `"filter_type_all": "Všetky typy"`, `"filter_type_company": "Firmy"`, `"filter_type_person": "Fyzické osoby"`

### REFACTOR

None needed — pure data addition.

---

## Phase 1: Column definitions & grid persistence

### Phase 1A: Column definitions module

**Goal:** Single source of truth for all available customer table columns — IDs, labels, categories, sort mapping, core flag.

#### Files

- `apps/web/src/lib/customerColumns.ts` (new)
- `apps/web/src/lib/__tests__/customerColumns.test.ts` (new)

#### Types

```typescript
interface CustomerColumnDef {
  id: string;
  labelKey: string;            // i18n key in 'customers' namespace
  category: ColumnCategory;
  sortField?: string;          // maps to ListCustomersRequest.sortBy value, if server-sortable
  sortable: boolean;
  core: boolean;               // true = cannot be hidden
  defaultVisible: boolean;
  defaultWidth?: number;
}

type ColumnCategory = 'identity' | 'contact' | 'location' | 'revision' | 'operations';

// Canonical definition lives in packages/shared-types/src/customer.ts (NATS contract);
// re-exported from customerColumns.ts for frontend convenience.
interface SortEntry {
  column: string;
  direction: 'asc' | 'desc';
}
```

#### Column catalog (initial)

| id | labelKey | category | sortField | sortable | core | defaultVisible |
|----|----------|----------|-----------|----------|------|----------------|
| `name` | `col_name` | identity | `name` | yes | **yes** | yes |
| `type` | `col_type` | identity | — | no | no | no |
| `city` | `col_city` | location | `city` | yes | no | yes |
| `street` | `col_street` | location | — | no | no | no |
| `postalCode` | `col_postal_code` | location | — | no | no | no |
| `phone` | `col_phone` | contact | — | no | no | no |
| `email` | `col_email` | contact | — | no | no | no |
| `deviceCount` | `col_devices` | revision | `deviceCount` | yes | no | yes |
| `nextRevision` | `col_revision` | revision | `nextRevision` | yes | no | yes |
| `geocodeStatus` | `col_geocode` | operations | — | no | no | yes |
| `createdAt` | `col_created_at` | operations | `createdAt` | yes | no | no |

#### Exported constants

- `ALL_COLUMNS: CustomerColumnDef[]`
- `COLUMN_CATEGORIES: ColumnCategory[]`
- `DEFAULT_VISIBLE_COLUMNS: string[]` — IDs where `defaultVisible === true`
- `DEFAULT_SORT_MODEL: SortEntry[]` — `[{ column: 'name', direction: 'asc' }]`
- `DEFAULT_COLUMN_ORDER: string[]` — all IDs in the default display order
- `CORE_COLUMN_IDS: string[]` — IDs where `core === true`
- `MAX_VISIBLE_COLUMNS = 10`
- Helper: `getColumnDef(id: string): CustomerColumnDef | undefined`
- Helper: `getSortField(columnId: string): string | undefined` — returns `sortField` for server mapping
- Helper: `isValidSortModel(model: unknown): model is SortEntry[]`
- Helper: `sanitizeSortModel(model: unknown): SortEntry[]` — returns validated model or default
- Helper: `sanitizeVisibleColumns(cols: unknown): string[]` — returns validated column IDs or default
- Helper: `sanitizeColumnOrder(order: unknown): string[]` — returns validated full column order or default

#### Tests (RED) — `customerColumns.test.ts`

**Catalog integrity:**
1. `ALL_COLUMNS` has no duplicate IDs.
2. Every `DEFAULT_VISIBLE_COLUMNS` entry is a valid column ID in `ALL_COLUMNS`.
3. Every `CORE_COLUMN_IDS` entry is a valid column ID in `ALL_COLUMNS`.
4. Every `DEFAULT_COLUMN_ORDER` entry is a valid column ID in `ALL_COLUMNS`.
5. `DEFAULT_COLUMN_ORDER` contains all column IDs (no column forgotten).
6. `DEFAULT_VISIBLE_COLUMNS` includes all `CORE_COLUMN_IDS`.
7. `DEFAULT_VISIBLE_COLUMNS.length <= MAX_VISIBLE_COLUMNS`.
8. `MAX_VISIBLE_COLUMNS >= CORE_COLUMN_IDS.length` (must fit core columns).
9. At least one column per `ColumnCategory`.
10. Every column with `sortable: true` has a non-empty `sortField`.
11. Every column with `sortable: false` has `sortField` undefined.
12. Every `sortField` value is a valid `ListCustomersRequest['sortBy']` union member.
13. `DEFAULT_SORT_MODEL` is a non-empty array.
14. `DEFAULT_SORT_MODEL[0].column` is a sortable column ID.
15. `DEFAULT_SORT_MODEL[0].direction` is `'asc'` or `'desc'`.

**`getColumnDef` helper:**
16. Known ID → returns correct `CustomerColumnDef`.
17. Unknown ID → returns `undefined`.

**`getSortField` helper:**
18. Sortable column ID → returns corresponding `sortField`.
19. Non-sortable column ID → returns `undefined`.
20. Unknown column ID → returns `undefined`.

**`isValidSortModel` validator:**
21. Valid single-entry array → `true`.
22. Valid multi-entry array → `true`.
23. Empty array → `false` (non-canonical; default must be explicit).
24. `null` → `false`.
25. `undefined` → `false`.
26. String → `false`.
27. Number → `false`.
28. Array of strings → `false`.
29. Array with missing `column` → `false`.
30. Array with missing `direction` → `false`.
31. Array with `direction: 'invalid'` → `false`.
32. Array with `column` referencing non-existent column → `false`.
33. Array with `column` referencing non-sortable column → `false`.
34. Array with duplicate columns → `false`.

**`sanitizeSortModel` sanitizer:**
35. Valid model → returns same model.
36. `null` → returns `DEFAULT_SORT_MODEL`.
37. `undefined` → returns `DEFAULT_SORT_MODEL`.
38. Empty array `[]` → returns `DEFAULT_SORT_MODEL` (canonical non-empty output).
39. Corrupted JSON → returns `DEFAULT_SORT_MODEL`.
40. Array with one invalid entry among valid ones → strips invalid, keeps valid; if none remain, returns `DEFAULT_SORT_MODEL`.
41. Array with all invalid entries → returns `DEFAULT_SORT_MODEL`.
42. Array with duplicate column → keeps first occurrence, strips duplicate.

**`sanitizeVisibleColumns` sanitizer:**
43. Valid column ID array → returns same array.
44. `null` → returns `DEFAULT_VISIBLE_COLUMNS`.
45. `undefined` → returns `DEFAULT_VISIBLE_COLUMNS`.
46. Empty array → returns `DEFAULT_VISIBLE_COLUMNS` (never empty table).
47. Array with unknown IDs → strips unknown, keeps valid.
48. Array with all unknown IDs → returns `DEFAULT_VISIBLE_COLUMNS`.
49. Non-array value → returns `DEFAULT_VISIBLE_COLUMNS`.
50. Array with duplicates → deduplicates, keeps first occurrence.
51. Array missing a core column → prepends core column(s).
52. Array exceeding `MAX_VISIBLE_COLUMNS` → truncated to limit (core columns preserved).

**`sanitizeColumnOrder` sanitizer:**
53. Valid full column order array → returns same array.
54. `null` → returns `DEFAULT_COLUMN_ORDER`.
55. `undefined` → returns `DEFAULT_COLUMN_ORDER`.
56. Empty array `[]` → returns `DEFAULT_COLUMN_ORDER`.
57. Non-array value (string, number, object) → returns `DEFAULT_COLUMN_ORDER`.
58. Array with unknown IDs → strips unknown, keeps valid; if none remain, returns `DEFAULT_COLUMN_ORDER`.
59. Array with duplicate IDs → deduplicates, keeps first occurrence.
60. Array missing some known column IDs → appends missing IDs at end (all columns must be represented).
61. Array with all unknown IDs → returns `DEFAULT_COLUMN_ORDER`.
62. Array that is a valid reordering of all columns → returns as-is (preserves user drag-reorder).

### Phase 1B: `customers.grid` UPP profile (local)

**Goal:** New persistence profile for long-term grid personalization — sort model, visible columns, column order.

#### Files

- `apps/web/src/persistence/profiles/customersGridProfile.ts` (new)
- `apps/web/src/persistence/profiles/__tests__/customersGridProfile.test.ts` (new)

#### Profile definition

```typescript
export const CUSTOMERS_GRID_PROFILE_ID = 'customers.grid';

export const customersGridProfile: PersistenceProfile = {
  profileId: CUSTOMERS_GRID_PROFILE_ID,
  controls: [
    { controlId: 'sortModel',      pluginId: 'json', defaultValue: DEFAULT_SORT_MODEL,      writeMode: 'immediate', validators: [] },
    { controlId: 'visibleColumns', pluginId: 'json', defaultValue: DEFAULT_VISIBLE_COLUMNS, writeMode: 'immediate', validators: [] },
    { controlId: 'columnOrder',    pluginId: 'json', defaultValue: DEFAULT_COLUMN_ORDER,    writeMode: 'immediate', validators: [] },
  ],
  readPriority: ['local'],
  writeTargets: ['local'],
};
```

#### Tests (RED) — `customersGridProfile.test.ts`

**Profile structure:**
1. `profileId` equals `'customers.grid'`.
2. `readPriority` is `['local']`.
3. `writeTargets` is `['local']`.
4. Contains exactly 3 controls: `sortModel`, `visibleColumns`, `columnOrder`.
5. `sortModel` default equals `DEFAULT_SORT_MODEL`.
6. `visibleColumns` default equals `DEFAULT_VISIBLE_COLUMNS`.
7. `columnOrder` default equals `DEFAULT_COLUMN_ORDER`.

**Hydration (via PersistenceProvider + localStorage mock):**
8. Mount with empty storage → all 3 controls have default values.
9. Seed `sortModel` in localStorage → hydrates correctly on mount.
10. Seed `visibleColumns` in localStorage → hydrates correctly on mount.
11. Seed `columnOrder` in localStorage → hydrates correctly on mount.
12. Seed all 3 → all hydrate independently, no cross-contamination.

**Corrupted storage — unparseable JSON (adapter returns `null`):**
13. Unparseable JSON string in `sortModel` storage → adapter yields `null`, component sanitizer returns `DEFAULT_SORT_MODEL`.
14. Unparseable JSON string in `visibleColumns` storage → adapter yields `null`, component sanitizer returns `DEFAULT_VISIBLE_COLUMNS`.
15. Unparseable JSON string in `columnOrder` storage → adapter yields `null`, component sanitizer returns `DEFAULT_COLUMN_ORDER`.

**Corrupted storage — parseable but wrong-shaped values (component sanitizer responsibility):**
16. `null` stored for `sortModel` → sanitizer returns `DEFAULT_SORT_MODEL`.
17. `null` stored for `visibleColumns` → sanitizer returns `DEFAULT_VISIBLE_COLUMNS` (not empty table).
18. `null` stored for `columnOrder` → sanitizer returns `DEFAULT_COLUMN_ORDER`.
19. Empty array `[]` stored for `sortModel` → sanitizer returns `DEFAULT_SORT_MODEL` (canonical non-empty).
20. Empty array `[]` stored for `visibleColumns` → sanitizer returns `DEFAULT_VISIBLE_COLUMNS`.
21. Empty array `[]` stored for `columnOrder` → sanitizer returns `DEFAULT_COLUMN_ORDER`.
22. `sortModel` stored as `[{ column: 'nonexistent', direction: 'asc' }]` → sanitizer strips invalid, returns `DEFAULT_SORT_MODEL`.
23. `visibleColumns` stored as `['nonexistent']` → sanitizer strips invalid, returns `DEFAULT_VISIBLE_COLUMNS`.
24. `columnOrder` stored as `['nonexistent']` → sanitizer strips invalid, appends missing known IDs, returns corrected order.

**Write + read cycle (multi-cycle):**
25. Commit `sortModel` → unmount → remount → same `sortModel` restored.
26. Commit `visibleColumns` → unmount → remount → same `visibleColumns` restored.
27. Commit `columnOrder` → unmount → remount → same `columnOrder` restored.
28. Two commit/unmount/remount cycles for all 3 controls → still correct.

**Profile isolation:**
29. Commit `sortModel` → `visibleColumns` unchanged.
30. Commit `visibleColumns` → `sortModel` unchanged.
31. Commit `columnOrder` → neither `sortModel` nor `visibleColumns` clobbered.

**Cross-profile isolation:**
32. `customers.grid` controls independent from `customers.filters` controls (different profile IDs, different adapters).

### Phase 1C: Migrate `customers.filters` profile

**Goal:** Remove `sortBy` and `sortOrder` from the session-scoped `customers.filters` profile — sorting now lives in `customers.grid` (local).  
This phase is **profile migration only**; full URL decoupling is completed in Phase 6B.

#### Files

- `apps/web/src/persistence/profiles/customersProfile.ts` (modify)
- `apps/web/src/pages/Customers.tsx` (modify)
- `apps/web/src/pages/__tests__/Customers.migration.test.tsx` (new)
- `apps/web/src/pages/__tests__/Customers.persistenceV2.test.tsx` (modify)

#### Tests (RED) — `Customers.migration.test.tsx`

**Profile shape:**
1. `customersProfile.controls` does **not** contain `sortBy`.
2. `customersProfile.controls` does **not** contain `sortOrder`.
3. `customersProfile.controls` contains exactly 6 controls at this phase boundary: `search`, `viewMode`, `geocodeFilter`, `revisionFilter`, `typeFilter`, `selectedCustomerId`.

> **Forward-compat note:** Phase 4B adds `isAdvancedFiltersOpen` as the 7th control in `customers.filters`.

**Backward compat — stale session keys ignored:**
4. Session storage contains legacy `sortBy`/`sortOrder` keys → Customers page mounts without crash, ignores them.
5. Session storage contains legacy `sortBy` = `'city'` → page uses `DEFAULT_SORT_MODEL` (from grid profile), not `'city'`.

**URL sort params no longer synced:**
6. URL has `?sortBy=city&sortOrder=desc` → page ignores them, uses `sortModel` from grid profile.
7. After mount, URL sort params are not written back to session.

**Remaining filter persistence unaffected:**
8. `search` round-trip: set → unmount → remount → restored.
9. `geocodeFilter` round-trip: set → unmount → remount → restored.
10. `revisionFilter` round-trip: set → unmount → remount → restored.
11. `typeFilter` round-trip: set → unmount → remount → restored.
12. `selectedCustomerId` round-trip: set → unmount → remount → restored.

---

## Phase 2: Multisort

### Phase 2A: `sortModel` end-to-end contract + wiring

**Goal:** Implement **end-to-end server-side multisort**. Replace legacy `sortBy`/`sortOrder` with `sortModel` across shared types, web, and worker. Backend executes full sort priority in SQL.

#### Files

- `apps/web/src/pages/Customers.tsx` (modify)
- `apps/web/src/pages/__tests__/Customers.sortModel.test.tsx` (new)
- `packages/shared-types/src/customer.ts` (modify request contract)
- `worker/src/types/customer.rs` (modify request contract)
- `worker/src/handlers/customer.rs` (pass-through contract update)
- `worker/src/db/queries/customer.rs` (SQL `ORDER BY` builder for full model + `#[cfg(test)] mod tests` for multisort)

#### Tests (RED) — `Customers.sortModel.test.tsx`

**Default sort:**
1. Mount with empty storage → `requestOptions.sortModel` = `[{ column: 'name', direction: 'asc' }]`.
2. Mount with empty storage → `listCustomersExtended` called with `sortModel` array (not legacy `sortBy`/`sortOrder` fields).

**Single sort from UPP:**
3. Grid storage has `sortModel: [{ column: 'city', direction: 'desc' }]` → request uses the same single-entry model.
4. Same → backend receives `sortModel=[{ column:'city', direction:'desc' }]`.

**Multisort — full model to server:**
5. Grid storage has `sortModel: [{ column: 'nextRevision', direction: 'asc' }, { column: 'name', direction: 'desc' }]` → full two-level model is sent to backend unchanged.
6. Three-level model is sent to backend with order preserved (priority `0,1,2`).
7. Backend returns results ordered by all levels from `sortModel` (verified via response order; SQL tie-break is tested in backend B1–B4).

**`sortModel` ↔ `setSortModel` callback:**
8. Call `setSortModel([{ column: 'deviceCount', direction: 'desc' }])` → UPP grid profile committed.
9. After commit, `listCustomersExtended` re-called with updated `sortModel`.

**Edge cases:**
10. `sortModel` with non-sortable column (e.g. `'email'`) → stripped by sanitizer before request.
11. `sortModel` with duplicate columns → deduplicated (first occurrence wins).
12. If stale `sortModel=[]` appears (legacy/corrupted source), sanitizer normalizes it to `DEFAULT_SORT_MODEL` and writes back canonical non-empty state.
13. Backend receives unknown column in malicious payload → rejects request with contract error (strict mode), no SQL injection path.
14. If backend rejects sort contract unexpectedly, UI shows both a toast and a sticky inline error banner in Customers page.
15. Unexpected contract rejection path keeps current `sortModel`/UI state unchanged (fail-fast, no silent mutation).
16. Unexpected contract rejection path does not auto-reset `sortModel` and does not auto-retry request.
17. Sticky inline banner does not provide a retry action; recovery is manual (user-adjusted next action).

**Sanitization on hydration:**
18. Corrupted `sortModel` in localStorage → sanitized to `DEFAULT_SORT_MODEL` before request.
19. `sortModel` with unknown column IDs → stripped by `sanitizeSortModel`, valid entries remain.

### Phase 2B: Sortable headers in CustomerTable

**Goal:** Make `CustomerTable` a server-authoritative sorting UI. Header interactions only update `sortModel`; row ordering comes from backend responses.

#### Files

- `apps/web/src/components/customers/CustomerTable.tsx` (modify)
- `apps/web/src/components/customers/__tests__/CustomerTable.test.tsx` (new)

#### New props

```typescript
interface CustomerTableProps {
  // ... existing props ...
  sortModel: SortEntry[];
  onSortModelChange: (model: SortEntry[]) => void;
  visibleColumns?: string[];   // Phase 3 — optional now, falls back to all
  columnOrder?: string[];      // Phase 3 — optional now
}
```

#### Tests (RED) — `CustomerTable.test.tsx`

**Rendering sorted state:**
1. `sortModel=[{ column:'name', direction:'asc' }]` → `name` header shows ↑ arrow + priority badge "1".
2. `sortModel=[{ column:'city', direction:'desc' }]` → `city` header shows ↓ arrow + priority badge "1".
3. `sortModel` with 2 entries → primary header shows "1", secondary shows "2".
4. Defensive case: empty `sortModel` input is normalized to `DEFAULT_SORT_MODEL`; UI shows default `name ASC` indicator (arrow + priority badge "1").
5. `aria-sort="ascending"` on ASC-sorted column header.
6. `aria-sort="descending"` on DESC-sorted column header.
7. Unsorted column headers have `aria-sort="none"`.

**Click → primary sort (no modifier):**
8. Click unsorted sortable header → `onSortModelChange([{ column: <id>, direction: 'asc' }])`.
9. Click ASC-sorted header → `onSortModelChange([{ column: <id>, direction: 'desc' }])`.
10. Click DESC-sorted header → `onSortModelChange(DEFAULT_SORT_MODEL)` (reset to canonical default, never `[]`).
11. Click non-sortable header → `onSortModelChange` not called.
12. Click replaces entire `sortModel` (not append).

**Shift+click → secondary sort:**
13. Existing primary on `name ASC`, Shift+click `city` → `onSortModelChange([{ column:'name', direction:'asc' }, { column:'city', direction:'asc' }])`.
14. Existing primary on `name ASC` + secondary on `city ASC`, Shift+click `city` → toggles to `city DESC` (keeps position).
15. Existing primary on `name ASC` + secondary on `city DESC`, Shift+click `city` → removes `city` from model.
16. Shift+click on non-sortable header → no change.
17. Shift+click when model is empty → behaves like regular click (sets primary).
18. Shift+click on primary sort column (`name ASC` only entry) → toggles direction to `name DESC` (stays primary, no removal; single-entry model must stay non-empty).
19. Shift+click on primary sort column (`name DESC` only entry) → toggles back to `name ASC` (cycle: toggle direction indefinitely, never remove the last entry).
20. Shift+click on primary sort column when multisort active (e.g. `[name ASC, city ASC]`) → toggles `name` to DESC in place, preserves secondary entries.

**Keyboard:**
21. `Enter` on focused sortable header → same as click (primary sort).
22. `Shift+Enter` → same as Shift+click.

**Server-authoritative ordering:**
23. Given incoming `customers` order `[B, A]`, table renders `[B, A]` even when `sortModel` changes (no local reorder).
24. Header click updates `sortModel` via callback but does not reorder rows until parent passes new server data.
25. When parent passes updated sorted data, table renders rows in the new provided order.

**Edge cases:**
26. Very long sort model (5+ entries) → all rendered as indicators, no crash.
27. Rapid click toggling → only final state committed (no intermediate flicker).
28. `sortModel` containing a column that was hidden (e.g. stale persisted state) → header indicators only shown for visible+sorted columns; hidden sorted column still sent to backend.

---

## Phase 3: Configurable columns

### Phase 3A: Column picker component

**Goal:** Dropdown/popover listing all available columns grouped by category. Checkboxes for visibility. Drag-and-drop for reorder. Core columns locked.

#### Files

- `apps/web/src/components/customers/ColumnPicker.tsx` (new)
- `apps/web/src/components/customers/ColumnPicker.module.css` (new)
- `apps/web/src/components/customers/__tests__/ColumnPicker.test.tsx` (new)
- `apps/web/public/locales/{cs,en,sk}/customers.json` (add `col_*` label keys)

#### Props

```typescript
interface ColumnPickerProps {
  visibleColumns: string[];
  columnOrder: string[];
  sortModel: SortEntry[];
  onVisibleColumnsChange: (cols: string[]) => void;
  onColumnOrderChange: (order: string[]) => void;
  onSortModelChange: (model: SortEntry[]) => void;
  onReset: () => void;
}
```

#### Tests (RED) — `ColumnPicker.test.tsx`

**Rendering:**
1. Renders a button/trigger labeled with column count (e.g. "Columns (5/11)").
2. Clicking trigger opens the picker popover.
3. Popover lists all `ALL_COLUMNS` grouped under `COLUMN_CATEGORIES` headings.
4. Each category heading is rendered (e.g. "Identity", "Contact", "Location", "Revision", "Operations").
5. Each column shows its translated `labelKey`.
6. Empty category (if all columns removed from a category in future) → category heading not rendered.

**Visibility checkboxes:**
7. Currently visible column → checkbox is checked.
8. Hidden column → checkbox is unchecked.
9. Core column → checkbox is checked **and disabled** (cannot uncheck).
10. Check a hidden column → `onVisibleColumnsChange` called with new array including that column.
11. Uncheck a visible non-core column → `onVisibleColumnsChange` called without that column.
12. Toggle preserves order of other columns in the returned array.
13. Uncheck a visible column that is in `sortModel` → blocking modal dialog appears before applying change.
14. Modal shows explicit actions `Cancel` and `Confirm`.
15. Cancel in modal → column remains visible and `onSortModelChange` is not called.
16. Confirm in modal → column is hidden and removed from `sortModel`; `onSortModelChange` called with canonicalized model.
17. Modal closes on `Escape`; focus returns to the originating checkbox/button.

**Max columns limit:**
18. When `visibleColumns.length === MAX_VISIBLE_COLUMNS` → unchecked columns' checkboxes are disabled.
19. Tooltip/hint explaining limit when disabled.
20. Unchecking one column re-enables others.

**Reset:**
21. Click "Reset" with no sorted columns affected → `onReset` called immediately.
22. Click "Reset" when one or more sorted columns would be hidden → one blocking summary modal is shown.
23. Summary modal lists all affected columns and sort rules/priorities that will be removed.
24. Cancel in summary modal → reset is not applied; `onReset` and `onSortModelChange` are not called.
25. Confirm in summary modal → reset is applied and affected sort entries are removed via `onSortModelChange` with canonicalized output.
26. Even when multiple sorted columns are affected, only one modal is shown for the action.

**Reorder (drag-and-drop):**
27. Drag column A above column B → `onColumnOrderChange` called with reordered array.
28. Reorder does not change visibility (only order).
29. Core column can be reordered (just not hidden).

**Accessibility:**
30. Trigger button has `aria-expanded`.
31. Each checkbox has accessible label matching column name.
32. Category headings are `role="heading"` or semantic `<h*>`.
33. Tab key navigates checkboxes in order.
34. Space bar toggles focused checkbox.
35. Escape closes popover (or modal, if open).

**Close behavior:**
36. Click outside popover → closes.
37. Pressing Escape → closes.

**i18n — `col_*` label keys:**
38. Every `CustomerColumnDef.labelKey` exists as a key in `en/customers.json`.
39. Every `CustomerColumnDef.labelKey` exists as a key in `cs/customers.json`.
40. Every `CustomerColumnDef.labelKey` exists as a key in `sk/customers.json`.
41. Rendered column labels in picker match translated text, not raw key strings (en locale).
42. Switching locale from `en` to `cs` → column labels in picker re-render to Czech translations.

### Phase 3B: Dynamic column rendering in CustomerTable

**Goal:** `CustomerTable` renders only `visibleColumns` in `columnOrder` sequence, instead of hard-coded 5 columns.

#### Files

- `apps/web/src/components/customers/CustomerTable.tsx` (modify)
- `apps/web/src/components/customers/__tests__/CustomerTable.test.tsx` (extend)

#### Tests (RED) — extend `CustomerTable.test.tsx`

**Visibility:**
1. `visibleColumns=['name','city','deviceCount']` → table renders exactly 3 column headers.
2. `visibleColumns=['name','city','deviceCount']` → `nextRevision` and `geocodeStatus` columns absent from DOM.
3. `visibleColumns` not provided (undefined) → falls back to `DEFAULT_VISIBLE_COLUMNS` (backward compat).
4. Core column `name` always rendered even if omitted from `visibleColumns`.

**Order:**
5. `columnOrder=['deviceCount','name','city']`, `visibleColumns=['name','city','deviceCount']` → headers render in order: deviceCount, name, city.
6. `columnOrder` not provided → falls back to `DEFAULT_COLUMN_ORDER`.
7. `columnOrder` with extra IDs not in `visibleColumns` → only visible ones rendered, in order.

**Dynamic changes:**
8. Initially 5 visible columns → parent removes one → table re-renders with 4 columns.
9. Initially 3 visible columns → parent adds one → table re-renders with 4 columns.
10. Column added mid-session appears at correct position per `columnOrder`.

**Cell rendering:**
11. Each column ID maps to the correct cell renderer (name shows compound cell, city shows text, etc.).
12. New columns (e.g. `email`, `phone`, `street`, `postalCode`, `type`, `createdAt`) render correct values.
13. `null`/missing values render `'-'` placeholder.

**Edge cases:**
14. `visibleColumns` is empty `[]` after sanitization → renders core columns (sanitizer ensures non-empty).
15. `visibleColumns` with unknown column IDs → unknown IDs ignored, no crash.
16. `MAX_VISIBLE_COLUMNS` columns visible at once → renders all, no overflow crash (note: catalog has 11 columns, max is 10; not all can be shown simultaneously).

---

## Phase 4: Filter progressive disclosure

### Phase 4A: Quick filter toolbar

**Goal:** Refactor the filter bar into a clean toolbar with quick-access chips (due bucket, geocode, type), search, and column picker trigger. Replace `SavedViewsSelector` with due-bucket chips.

#### Files

- `apps/web/src/components/customers/CustomerFilterBar.tsx` (new)
- `apps/web/src/components/customers/CustomerFilterBar.module.css` (new)
- `apps/web/src/components/customers/__tests__/CustomerFilterBar.test.tsx` (new)
- `apps/web/src/pages/Customers.tsx` (modify — use new toolbar)

#### Props

```typescript
interface CustomerFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  geocodeFilter: GeocodeStatus | '';
  onGeocodeFilterChange: (value: GeocodeStatus | '') => void;
  revisionFilter: '' | 'overdue' | 'week' | 'month';
  onRevisionFilterChange: (value: '' | 'overdue' | 'week' | 'month') => void;
  typeFilter: 'company' | 'person' | '';
  onTypeFilterChange: (value: 'company' | 'person' | '') => void;
  activeFilterCount: number;
  onClearAllFilters: () => void;
  isAdvancedOpen: boolean;
  onToggleAdvanced: () => void;
  // Sort model pass-through (for ColumnPicker sort-impact warnings)
  sortModel: SortEntry[];
  onSortModelChange: (model: SortEntry[]) => void;
  // Column picker pass-through
  visibleColumns: string[];
  columnOrder: string[];
  onVisibleColumnsChange: (cols: string[]) => void;
  onColumnOrderChange: (order: string[]) => void;
  onResetColumns: () => void;
  // View mode
  viewMode: 'table' | 'cards';
  onViewModeChange: (mode: 'table' | 'cards') => void;
}
```

#### Tests (RED) — `CustomerFilterBar.test.tsx`

**Search input:**
1. Renders search input with current `search` value.
2. Typing in search input calls `onSearchChange` with new value.
3. Empty search → no clear button.
4. Non-empty search → clear button visible; clicking it calls `onSearchChange('')`.

**Due-bucket chips:**
5. Renders chips: "All", "Overdue", "Within 7 days", "Within 30 days".
6. `revisionFilter=''` → "All" chip active.
7. `revisionFilter='overdue'` → "Overdue" chip active.
8. Clicking "Overdue" chip calls `onRevisionFilterChange('overdue')`.
9. Clicking active chip calls `onRevisionFilterChange('')` (toggle off).

**Geocode quick filter:**
10. Renders geocode filter dropdown/chips.
11. Selecting `'failed'` calls `onGeocodeFilterChange('failed')`.
12. Active geocode filter visually indicated.

**Type filter:**
13. Renders type filter with translated labels (not raw keys).
14. Selecting `'company'` calls `onTypeFilterChange('company')`.

**Active filter count:**
15. `activeFilterCount=0` → no badge.
16. `activeFilterCount=3` → badge shows "3".

**Clear all:**
17. Clear-all button calls `onClearAllFilters`.
18. Clear-all button hidden when `activeFilterCount === 0`.

**Advanced toggle:**
19. Toggle button present, labeled (e.g. "Advanced filters").
20. Clicking toggle calls `onToggleAdvanced`.
21. `isAdvancedOpen=true` → toggle visually indicates open state.

**Column picker integration:**
22. Column picker trigger button rendered.
23. Clicking opens `ColumnPicker` (tested separately).

**View mode toggle:**
24. Table/cards toggle rendered.
25. Clicking table icon calls `onViewModeChange('table')`.
26. Clicking cards icon calls `onViewModeChange('cards')`.
27. Current mode visually highlighted.
28. In `cards` mode, table-specific affordances are hidden or disabled (e.g., column picker trigger), while filtering and sort controls remain available.

### Phase 4B: Advanced filter panel

**Goal:** Expandable panel below toolbar for less common filters. Toggle state persisted via UPP session.

#### Files

- `apps/web/src/components/customers/AdvancedFilterPanel.tsx` (new)
- `apps/web/src/components/customers/AdvancedFilterPanel.module.css` (new)
- `apps/web/src/components/customers/__tests__/AdvancedFilterPanel.test.tsx` (new)
- `apps/web/src/persistence/profiles/customersProfile.ts` (add `isAdvancedFiltersOpen` control)

#### Tests (RED) — `AdvancedFilterPanel.test.tsx`

**Visibility:**
1. `isOpen=false` → panel content not rendered.
2. `isOpen=true` → panel content rendered.
3. Transition: `isOpen` false → true → panel appears with animation (CSS class).

**Panel content (initial set — expand as backend adds support):**
4. Renders "Contactability" section placeholder.
5. Renders "Lifecycle" section placeholder.
6. Renders "Data quality" section placeholder.
7. Each section has a heading.

**Clear:**
8. "Clear advanced filters" button resets all panel fields.
9. After clear, `activeAdvancedCount` = 0.

**UPP persistence of `isAdvancedFiltersOpen`:**
10. Mount with UPP seeded `isAdvancedFiltersOpen: true` → panel open.
11. Mount with UPP seeded `isAdvancedFiltersOpen: false` → panel closed.
12. Toggle open → unmount → remount → panel still open.
13. Toggle closed → unmount → remount → panel still closed.
14. Multi-cycle: open → close → unmount → remount → closed.
15. Corrupted value in session storage → defaults to closed.
16. After adding this control, `customers.filters` control count is 7 (migration tests updated accordingly).

**Active advanced filter count:**
17. No advanced filters active → count = 0.
18. One advanced filter active → count = 1.
19. Count displayed on the toggle button in the toolbar.

---

## Phase 5: Mobile adaptations

### Phase 5A: Mobile filter/sort/column sheet

**Goal:** On mobile viewport, filters and sort controls render inside a bottom sheet instead of inline toolbar. Same functionality, touch-optimized layout.

#### Files

- `apps/web/src/components/customers/MobileFilterSheet.tsx` (new)
- `apps/web/src/components/customers/MobileFilterSheet.module.css` (new)
- `apps/web/src/components/customers/__tests__/MobileFilterSheet.test.tsx` (new)
- `apps/web/src/pages/Customers.tsx` (modify — conditional rendering)

#### Tests (RED) — `MobileFilterSheet.test.tsx`

**Rendering:**
1. On mobile viewport (`matchMedia` mock) → sheet trigger button visible.
2. On desktop viewport → sheet trigger button hidden (uses inline toolbar).
3. Click trigger → sheet opens.
4. Sheet has drag handle for dismiss.

**Content:**
5. Sheet contains search input.
6. Sheet contains due-bucket chips.
7. Sheet contains geocode filter.
8. Sheet contains type filter.
9. Sheet contains sort controls (primary sort picker + direction).
10. Sheet contains secondary sort picker.
11. Sheet contains column picker or link to column picker.

**Interaction:**
12. Changing filter in sheet calls parent filter callback.
13. Changing sort in sheet calls parent `onSortModelChange`.
14. Swipe down / tap outside → sheet closes.
15. "Apply" button closes sheet.
16. Filters applied in sheet immediately reflected in main list.

**Sort in sheet:**
17. Sort picker shows sortable columns with translated names.
18. Selecting column + direction → `onSortModelChange` called with single entry.
19. Adding secondary sort → `onSortModelChange` called with 2 entries.
20. "Clear sort" returns to default sort.

---

## Phase 6: Integration & cleanup

### Phase 6A: Remove `SavedViewsSelector`

**Goal:** Quick filter chips in the new toolbar replace the saved-views dropdown. Remove component and references.

#### Files

- `apps/web/src/components/customers/SavedViewsSelector.tsx` (delete)
- `apps/web/src/components/customers/SavedViewsSelector.module.css` (delete)
- `apps/web/src/pages/Customers.tsx` (remove import + usage)
- `apps/web/src/pages/__tests__/Customers.persistenceV2.test.tsx` (remove mock)

#### Tests (RED)

1. `SavedViewsSelector` component not rendered in the Customers page.
2. No import of `SavedViewsSelector` in `Customers.tsx`.
3. Quick filter chips provide the same filtering capability (overdue, due-week, no-address, etc.).
4. Selecting "Overdue" chip produces the same `listCustomersExtended` request as the old "Overdue" saved view.

### Phase 6B: Remove URL coupling for Customers UI state

**Goal:** Customers UI state is UPP-only. Remove URL-based precedence/sync for `view`, `geocodeStatus`, `revisionFilter`/`hasOverdue`, `typeFilter`, and sort params.

#### Files

- `apps/web/src/pages/Customers.tsx` (modify)
- `apps/web/src/pages/__tests__/Customers.migration.test.tsx` (extend)

#### Tests (RED)

1. `SearchParams` interface no longer contains `sortBy` and `sortOrder`.
2. `SearchParams` interface no longer contains `view`, `geocodeStatus`, `revisionFilter`, `hasOverdue`, and `typeFilter` for Customers UI-state control.
3. `SearchParams` interface still contains `action` — it is a navigation intent (e.g. `?action=new` opens add-customer form), not UI state, and must remain functional.
4. Mount-time URL→UPP bootstrap (`didSyncRef`) for Customers UI state is removed.
5. Navigating to `/customers?sortBy=city&sortOrder=desc` → sort state from grid profile used, URL params ignored.
6. Navigating to `/customers?view=cards&geocodeStatus=failed&revisionFilter=overdue` does not override UPP state.
7. Navigating to `/customers?action=new` → add-customer form opens (intent param preserved).
8. Changing filters/view/sort does not update URL search params.

### Phase 6C: Empty state & clear-filters UX

**Goal:** When filters produce 0 results, show a clear empty state with actions to reset.

#### Files

- `apps/web/src/pages/Customers.tsx` (modify)
- `apps/web/src/pages/__tests__/Customers.emptyState.test.tsx` (new)

#### Tests (RED)

1. 0 results with active filters → shows "No customers match your filters" message.
2. 0 results → shows "Clear filters" button.
3. Clicking "Clear filters" → resets all filter controls to defaults.
4. After clear, `listCustomersExtended` re-called with no filters.
5. 0 results with non-default sort but no filters → shows "No customers found" (different message, no "match your filters" language).
6. "Reset sort" button shown when `sortModel` differs from `DEFAULT_SORT_MODEL`.
7. Both filter and sort reset actions work independently.

---

## Cross-cutting test requirements

Every persistence-touching phase must satisfy:

1. **Multi-cycle:** ≥ 2 consecutive unmount/remount cycles with the same value, for every persisted control (including `columnOrder`).
2. **Corrupted storage — two layers:**
   a. **Unparseable JSON** (e.g. `"{broken"`) → adapter returns `null` → component-boundary sanitizer falls back to default.
   b. **Parseable but wrong-shaped values** (e.g. `null`, `[]`, `['nonexistent']`) → adapter returns the value → component-boundary sanitizer normalizes/falls back to default.
3. **Profile isolation:** Updating one control does not clobber sibling controls in the same profile.
4. **Cross-profile isolation:** `customers.grid` and `customers.filters` do not interfere.
5. **Type safety:** Sanitizers reject wrong types (`number` where `string[]` expected, etc.).
6. **Canonical non-empty:** `sortModel` is never `[]` after sanitization; always at least `DEFAULT_SORT_MODEL`.

---

## Files expected to change (summary)

### New files

| File | Phase |
|------|-------|
| `apps/web/src/lib/customerColumns.ts` | 1A |
| `apps/web/src/lib/__tests__/customerColumns.test.ts` | 1A |
| `apps/web/src/persistence/profiles/customersGridProfile.ts` | 1B |
| `apps/web/src/persistence/profiles/__tests__/customersGridProfile.test.ts` | 1B |
| `apps/web/src/pages/__tests__/Customers.i18n.test.tsx` | P0 |
| `apps/web/src/pages/__tests__/Customers.migration.test.tsx` | 1C |
| `apps/web/src/pages/__tests__/Customers.sortModel.test.tsx` | 2A |
| `apps/web/src/components/customers/__tests__/CustomerTable.test.tsx` | 2B, 3B |
| `apps/web/src/components/customers/ColumnPicker.tsx` | 3A |
| `apps/web/src/components/customers/ColumnPicker.module.css` | 3A |
| `apps/web/src/components/customers/__tests__/ColumnPicker.test.tsx` | 3A |
| `apps/web/src/components/customers/CustomerFilterBar.tsx` | 4A |
| `apps/web/src/components/customers/CustomerFilterBar.module.css` | 4A |
| `apps/web/src/components/customers/__tests__/CustomerFilterBar.test.tsx` | 4A |
| `apps/web/src/components/customers/AdvancedFilterPanel.tsx` | 4B |
| `apps/web/src/components/customers/AdvancedFilterPanel.module.css` | 4B |
| `apps/web/src/components/customers/__tests__/AdvancedFilterPanel.test.tsx` | 4B |
| `apps/web/src/components/customers/MobileFilterSheet.tsx` | 5A |
| `apps/web/src/components/customers/MobileFilterSheet.module.css` | 5A |
| `apps/web/src/components/customers/__tests__/MobileFilterSheet.test.tsx` | 5A |
| `apps/web/src/pages/__tests__/Customers.emptyState.test.tsx` | 6C |

### Modified files

| File | Phases |
|------|--------|
| `apps/web/public/locales/en/customers.json` | P0, 3A |
| `apps/web/public/locales/cs/customers.json` | P0, 3A |
| `apps/web/public/locales/sk/customers.json` | P0, 3A |
| `apps/web/src/persistence/profiles/customersProfile.ts` | 1C, 4B |
| `apps/web/src/pages/Customers.tsx` | 1C, 2A, 4A, 5A, 6A, 6B, 6C |
| `apps/web/src/components/customers/CustomerTable.tsx` | 2B, 3B |
| `apps/web/src/pages/__tests__/Customers.persistenceV2.test.tsx` | 1C, 6A |
| `packages/shared-types/src/customer.ts` | 2A |
| `worker/src/types/customer.rs` | 2A |
| `worker/src/handlers/customer.rs` | 2A |
| `worker/src/db/queries/customer.rs` | 2A |

### Deleted files

| File | Phase |
|------|-------|
| `apps/web/src/components/customers/SavedViewsSelector.tsx` | 6A |
| `apps/web/src/components/customers/SavedViewsSelector.module.css` | 6A |

---

## Implementation order & dependencies

```
P0 ──────────────────────────────── (independent, can start immediately)

Phase 1A (column defs)
  └─► Phase 1B (grid profile) ──► Phase 1C (migrate session profile)
        │                               │
        ▼                               ▼
  Phase 2A (sortModel wiring + backend multisort) ── Phase 2B (sortable headers)
        │
        ▼
  Phase 3A (column picker) ───── Phase 3B (dynamic columns)
                                        │
                                        ▼
                                  Phase 4A (filter toolbar) ── Phase 4B (advanced panel)
                                        │
                                        ▼
                                  Phase 5A (mobile sheet)
                                        │
                                        ▼
                                  Phase 6A (remove SavedViews)
                                  Phase 6B (remove URL coupling)
                                  Phase 6C (empty state)
```

## Backend workstream (required in this plan)

Server-side multisort is mandatory for this delivery. Backend work items:

1. **Contract update:** `ListCustomersRequest.sortBy` / `sortOrder` → `sortModel: [{ column, direction }]` in shared types + Rust types.
2. **Handler pass-through:** `customer.list.extended` handler forwards validated `sortModel`.
3. **SQL multisort:** build `ORDER BY` from full `sortModel` array using whitelist-only column mapping and direction normalization.
4. **Deterministic tie-break:** append stable fallback keys (`name ASC`, `id ASC`) when needed.
5. **SQL safety guardrails:** no user-provided SQL fragments; mapping via match/whitelist only; all dynamic values parameterized.
6. **Backend tests (Rust `#[cfg(test)]`):**

   **SQL `ORDER BY` generation from `sortModel`:**
   B1. Single-entry `sortModel` `[{ column: "name", direction: "asc" }]` → SQL `ORDER BY name ASC, id ASC`.
   B2. Two-entry `sortModel` `[{ column: "city", direction: "desc" }, { column: "name", direction: "asc" }]` → SQL `ORDER BY city DESC, name ASC, id ASC`.
   B3. Three-entry `sortModel` → all three appear in SQL in correct priority order, plus tie-break suffix.
   B4. `sortModel` already contains the tie-break column(s) → no duplicate `ORDER BY` key appended.
   B5. Direction normalization: `"ASC"` (uppercase) in input → still works (case-insensitive parse or upfront normalization).

   **Whitelist / validation:**
   B6. `sortModel` entry with unknown column (e.g. `"nonexistent"`) → handler returns contract error, SQL never executed.
   B7. `sortModel` with empty array `[]` → handler returns contract error (canonical non-empty rule enforced server-side).
   B8. `sortModel` with duplicate columns (e.g. `[{ column: "name", direction: "asc" }, { column: "name", direction: "desc" }]`) → handler returns contract error.
   B9. Request missing `sortModel` field entirely → handler returns contract error (strict rejection / D4).
   B10. Request containing legacy-only `sortBy`/`sortOrder` without `sortModel` → handler returns contract error (D4 strict rejection).

   **Deterministic tie-break and pagination:**
   B11. Two rows with identical values in all `sortModel` columns → returned in deterministic order (tie-break by `name ASC`, `id ASC`).
   B12. Pagination: page 1 last row < page 2 first row for the same `sortModel` (no overlap or reorder across pages).

   **Integration with filters:**
   B13. `sortModel` combined with `search` filter → both SQL `WHERE` and `ORDER BY` applied correctly.
   B14. `sortModel` combined with `typeFilter='company'` → filtered + sorted result set.

---

## Resolved product decisions

### D1: Multisort behavior with infinite scroll pagination — DECIDED

Locked: **all multisort levels are server-side** (authoritative ordering over full dataset, including pagination).

### D2: Header indicator for default sort (`name ASC`) — DECIDED

Locked: **Option B** — always show `name ASC` indicator whenever default ordering is active.

### D3: Contract rollout strategy for `sortModel` migration — DECIDED

Locked: **Option A (hard cutover)** — remove legacy `sortBy`/`sortOrder` in one coordinated release across web + shared-types + worker.

### D4: Hard-cutover backend behavior for legacy payloads — DECIDED

Locked: **Option A (strict rejection)** — backend rejects payloads missing `sortModel` or containing legacy-only sort intent (`sortBy`/`sortOrder`) with a contract error.

### D5: Canonical representation of default sort in persisted state — DECIDED

Locked: **Option A** — persist explicit default at all times (`sortModel=[{ column:'name', direction:'asc' }]`), never store `[]`.

### D6: Sorting on hidden columns — DECIDED

Locked: **Option B with explicit confirmation** — when user hides a sorted column, app must show warning, require explicit confirm, and on confirm remove that column from `sortModel`.

### D7: Confirmation UX style when hiding a sorted column — DECIDED

Locked: **Option A (modal dialog)** — blocking modal with explicit `Cancel` / `Confirm`.

### D8: Behavior of bulk actions that can hide sorted columns (e.g. Reset columns) — DECIDED

Locked: **Option A** — bulk actions use the same confirmation safety model; if any active sort column would be hidden, show **one aggregated summary modal** for the whole action.

### D9: Summary modal detail level — DECIDED

Locked: **Option B** — modal lists affected columns **and** sort rules/priorities that will be removed.

### D10: Defensive UX when backend rejects sort contract (unexpected in hard cutover) — DECIDED

Locked: **Option A** — show explicit error feedback and keep current UI state unchanged (no automatic retry/mutation).

### D11: Error presentation style for unexpected contract rejection — DECIDED

Locked: **Option B** — show toast plus sticky inline error banner in Customers page.

### D12: Retry action semantics in sticky error banner — DECIDED

Locked: **No retry action** — banner is informational/recovery guidance only; user must change state manually and trigger a fresh action.

---

## Definition of done

- [ ] All `filter_type_*` labels translated in cs/en/sk.
- [ ] Column definitions module with 100 % test coverage on helpers/sanitizers.
- [ ] `customers.grid` profile (local) persists `sortModel`, `visibleColumns`, `columnOrder`.
- [ ] `customers.filters` profile (session) no longer contains sort controls.
- [ ] Multisort is end-to-end server-side: click/Shift+click builds `sortModel`, backend executes full priority order, headers show priority indicators.
- [ ] Shared-types + worker contract migrated to `sortModel` with hard cutover (legacy `sortBy`/`sortOrder` removed).
- [ ] Backend strictly rejects missing/legacy-only sort payloads in hard-cutover mode.
- [ ] Unexpected sort-contract rejection in UI is fail-fast: toast + sticky inline banner, no retry action, no auto-reset, no automatic retry.
- [ ] Default sort is stored canonically (`DEFAULT_SORT_MODEL`), never as empty `sortModel=[]`.
- [ ] Column picker: grouped categories, core lock, max limit, reset, drag reorder.
- [ ] Hiding sorted columns (single or bulk action) uses one blocking summary modal listing affected columns and sort rules/priorities; on confirm, affected sort entries are removed from `sortModel`.
- [ ] `CustomerTable` renders only visible columns in specified order.
- [ ] Quick filter chips replace `SavedViewsSelector`.
- [ ] Advanced filter panel with UPP-persisted toggle.
- [ ] Mobile: bottom sheet for filters, sort, column picker.
- [ ] Empty state with "Clear filters" / "Reset sort" actions.
- [ ] No URL sync for Customers UI state (`view`, filters, sort, grid config) — UPP-only; `?action=new` navigation intent preserved.
- [ ] All `col_*` label keys translated in cs/en/sk and rendered in column picker.
- [ ] `sanitizeColumnOrder` covers all corruption/edge cases (missing IDs appended, unknown stripped, deduped).
- [ ] Corrupted-storage tests cover both unparseable JSON and wrong-shaped-but-parseable values for all 3 grid controls.
- [ ] Shift+click on primary sort column toggles direction (does not remove).
- [ ] All tests green, near-100 % branch coverage on new code (~304 frontend + 14 backend = ~318 total test cases).
- [ ] `PRJ_CONTEXT.MD` updated.

---

# Column Filters (Excel-style) — Implementation Plan

**Status:** Final  
**TDD:** Red → Green → Refactor for every phase; commit after each phase where practical.  
**Related:** Customers grid, NATS `sazinka.customer.list.extended`, new `sazinka.customer.column.distinct`.

---

## Design decisions (locked)

| Topic | Decision |
|-------|----------|
| Checklist columns (9) | name, type, city, street, postalCode, phone, email, geocodeStatus, deviceCount |
| Date range columns (2) | nextRevision, createdAt |
| Legacy UI | Remove `geocodeFilter` and `typeFilter` dropdowns (desktop bar + mobile sheet) |
| Kept in bar | Search, revision chips, column picker, view toggle, advanced toggle |
| Filter trigger | Small always-visible icon per column header (table view) |
| Distinct values | Server-side (`sazinka.customer.column.distinct`) with context-aware filtering |
| Distinct list scope | Apply all active filters **except** the target column's own filter |
| Distinct scaling | Server-side search + pagination (`query`, `limit`, `offset`, `hasMore`) |
| Composition | Column filters AND together |
| Legacy profile cleanup | Remove deprecated `geocodeFilter`/`typeFilter` controls from `customersProfile`; stale persisted keys are safely ignored |
| **Duplicate `column` entries in `columnFilters` array** | **First wins** — later duplicates ignored (sanitize + backend must match) |

---

## Product: `getCustomerSummary` vs column filters

**Decision (v1):** `getCustomerSummary` continues to return **global** stats for the user (not filtered by `columnFilters`). Rationale: summary is a dashboard KPI strip; aligning it with filters requires API changes and product sign-off.

**Tests:**  
- Assert summary request payload **does not** include `columnFilters` (or explicitly documents no filter args).  
- Document in `PRJ_CONTEXT.MD` that summary is global while the list is filtered.

**Follow-up (optional):** add `summaryRespectsFilters` or a separate endpoint — out of scope unless product asks.

---

## Distinct endpoint semantics (locked)

- Request includes:
  - `column` (required)
  - `query?: string`, `limit?: number`, `offset?: number`
  - current list context filters: `search`, `hasOverdue`, `nextRevisionWithinDays`, `columnFilters`
- Backend applies all context filters, but excludes filters whose `column` equals the target `column`.
- Only checklist-capable columns are valid for distinct lookup; date-range columns are rejected.
- Response includes `values: string[]`, `total: number`, `hasMore: boolean`.
- Ordering is deterministic: ascending, case-insensitive; empty value (`""`) is normalized and returned last.

---

## Summary: coverage improvements (v2 vs v1)

| Area | Addition |
|------|----------|
| **Count query** | Tests that `total` / count SQL uses the **same** `column_filters` (and WHERE/HAVING) as the main list query — no drift. Includes mandatory automated DB integration tests (no manual-only fallback). |
| **Pagination** | Filtered list: `total` matches DB; `loadMore` offset respects filtered set; empty page returns `total: 0`. |
| **NATS handler** | `handle_column_distinct`: auth failure, invalid/missing column, success path (mock pool or integration). |
| **Serde** | Rust: **serialize** + deserialize round-trip for `ColumnFilter` and `ListCustomersRequest` with `column_filters`. |
| **Dates** | Inclusive day bounds (document), invalid ISO rejected, `from > to` rejected server-side **or** only client-side — **both layers**: client UX + server rejects invalid range. |
| **Timezone** | Store/send **date-only** strings (`YYYY-MM-DD`); treat as **date** in SQL (`::date`), not timestamptz ambiguity — tests for boundary day. |
| **Distinct semantics** | Context-aware distinct values, target-column exclusion, server-side query/limit/offset, deterministic ordering, `hasMore` coverage. |
| **Cards view** | Same `requestOptions` as table — `columnFilters` still sent when user switched to cards after setting filters (UPP). |
| **UPP / profile** | `columnFilters` in `customers.grid`: default `[]`, corrupted storage → `sanitizeColumnFilters` → `[]`; missing key → `[]`. Deprecated `customers.filters` controls (`geocodeFilter`, `typeFilter`) removed with stale-key compatibility tests. |
| **SQLx** | New queries: run `cargo sqlx prepare` / document offline cache update in Phase 7 checklist. |
| **i18n** | New keys `filter_*`, `col_filter_*` — cs/en/sk parity smoke test or checklist in DoD. |

**Path fixes:** All test paths use `__tests__/` (not `lib/tests/`).

---

## Must-run tests first (strict sequence)

Run these in order during implementation. Do not proceed to the next gate until the current gate is green.

1. **TS catalog and filter contract gate**  
   File: [`apps/web/src/lib/__tests__/customerColumns.test.ts`](apps/web/src/lib/__tests__/customerColumns.test.ts)  
   Must prove: `filterType` mapping, `isValidColumnFilter`, `sanitizeColumnFilters`, duplicate-first-wins.

2. **Rust wire-contract gate**  
   File: [`worker/src/types/customer.rs`](worker/src/types/customer.rs) `#[cfg(test)]`  
   Must prove: serde deserialize + serialize + round-trip for `ColumnFilter`, `ListCustomersRequest` with `column_filters`.

3. **Backend filter-clause unit gate**  
   File: [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs) `#[cfg(test)]`  
   Must prove: WHERE/HAVING split for all 11 columns, injection safety, param index correctness.

4. **Backend count parity integration gate (mandatory)**  
   File: [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs) integration tests (`#[sqlx::test]` or existing DB harness)  
   Must prove: filtered `items` and `total` stay consistent, including pagination parity (`offset` pages, same total).

5. **Date-boundary correctness gate**  
   File: [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs) tests  
   Must prove: explicit `::date` bounds are inclusive; exact boundary days included; adjacent days excluded.

6. **Distinct endpoint backend gate**  
   Files: [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs), [`worker/src/handlers/customer.rs`](worker/src/handlers/customer.rs) tests  
   Must prove: target-column exclusion semantics, context-aware filtering, pagination/search, deterministic ordering, auth + invalid column handling.

7. **Distinct service-contract frontend gate**  
   File: [`apps/web/src/services/customerService.ts`](apps/web/src/services/customerService.ts) tests  
   Must prove: exact NATS subject, forwards context/query/limit/offset, parses `hasMore`.

8. **Customers request payload gate**  
   File: [`apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx`](apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx)  
   Must prove: `columnFilters` forwarded on initial load and loadMore, cards mode still forwards filters, summary remains global.

9. **Header interaction safety gate**  
   File: [`apps/web/src/components/customers/__tests__/CustomerTable.test.tsx`](apps/web/src/components/customers/__tests__/CustomerTable.test.tsx)  
   Must prove: filter icon opens dropdown and never triggers sort; sort and filter indicators coexist.

10. **Dropdown behavior gate**  
    Files:  
    - [`apps/web/src/components/customers/__tests__/ChecklistFilterDropdown.test.tsx`](apps/web/src/components/customers/__tests__/ChecklistFilterDropdown.test.tsx)  
    - [`apps/web/src/components/customers/__tests__/DateRangeFilterDropdown.test.tsx`](apps/web/src/components/customers/__tests__/DateRangeFilterDropdown.test.tsx)  
    Must prove: loading/error/search/select-all-visible/date validation/apply-clear semantics.

11. **Legacy removal and migration gate**  
    Files:  
    - [`apps/web/src/components/customers/__tests__/CustomerFilterBar.test.tsx`](apps/web/src/components/customers/__tests__/CustomerFilterBar.test.tsx)  
    - [`apps/web/src/components/customers/__tests__/MobileFilterSheet.test.tsx`](apps/web/src/components/customers/__tests__/MobileFilterSheet.test.tsx)  
    - [`apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx`](apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx)  
    Must prove: legacy geocode/type controls are absent, stale persisted keys do not affect behavior or counts.

12. **Revision-chip interaction gate**  
    File: [`apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx`](apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx)  
    Must prove: revision chips and `nextRevision` dateRange filter combine with AND semantics; clear-all resets both.

13. **Final regression gate**  
    Files:
    - [`apps/web/src/pages/__tests__/Customers.sortModel.test.tsx`](apps/web/src/pages/__tests__/Customers.sortModel.test.tsx)  
    - All updated customer filter suites  
    Must prove: `sortModel` + `columnFilters` coexist with no payload regression.

14. **Release hygiene gate**  
    Must run:
    - frontend test suites for all changed files  
    - `SQLX_OFFLINE=true cargo test` on updated Rust modules  
    - `cargo sqlx prepare` update committed  
    - docs update in [`PRJ_CONTEXT.MD`](PRJ_CONTEXT.MD)

---

## Phase 1 — Shared types and column catalog

### Deliverables

- **TS:** `ColumnFilter` union, `columnFilters?` on `ListCustomersRequest`, and `ColumnDistinctRequest` / `ColumnDistinctResponse` in [`packages/shared-types/src/customer.ts`](packages/shared-types/src/customer.ts), including `query`/`limit`/`offset` and `hasMore`.
- **Catalog:** `filterType: 'checklist' | 'dateRange'` on every column in [`apps/web/src/lib/customerColumns.ts`](apps/web/src/lib/customerColumns.ts); `getFilterType`, `isValidColumnFilter`, `sanitizeColumnFilters` (**duplicate column: first wins**).
- **Rust:** `ColumnFilter` enum, `column_filters` on `ListCustomersRequest`, and distinct request/response in [`worker/src/types/customer.rs`](worker/src/types/customer.rs), mirroring `query`/`limit`/`offset` and `has_more`.

### Tests (TS) — [`apps/web/src/lib/__tests__/customerColumns.test.ts`](apps/web/src/lib/__tests__/customerColumns.test.ts)

- All v1 cases (filterType per column, validators, invalid shapes, empty array).
- **sanitizeColumnFilters duplicates:** `[{city: A}, {city: B}]` → first city entry kept only.
- **`ALL_COLUMNS.length` guard** if still 11 columns with filterType.

### Tests (Rust) — `worker/src/types/customer.rs` `#[cfg(test)]`

- All v1 deserialize cases.
- **Serialize:** `ColumnFilter::Checklist { ... }` → JSON → deserialize equals original.
- **Round-trip:** full `ListCustomersRequest` with `column_filters` + `sort_model`.
- **Invalid UTF-8 / edge:** N/A at serde level; skip.

---

## Phase 2 — Backend: `column_filters` in list + **count query**

### Deliverables

- `build_column_filter_clauses` + wire into `list_customers_extended` **and** the **count** subquery path in [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs).

### Tests — `customer.rs` `#[cfg(test)]`

- All v1 builder tests (WHERE/HAVING, deviceCount, dates, injection, param_idx).
- **Count parity:** helper or test that **given the same `req`**, the WHERE/HAVING fragment used for count matches the one used for the main query (shared builder — assert single source of truth).
- **Integration (mandatory):** automated DB test (`#[sqlx::test]` or existing integration harness) where a filter matching exactly 3 rows yields `total == 3`.
- **Pagination integration (mandatory):** `limit=2, offset=0` vs `offset=2` with same filters returns disjoint sets and same `total`.
- **No manual-only fallback:** integration parity coverage must run in CI for this feature.

### Corner cases

- **Empty `values` in checklist:** skipped (already in v1).
- **`createdAt` bounds are explicit:** `c.created_at::date >= $N::date` and `c.created_at::date <= $M::date` (inclusive).
- **`nextRevision` bounds are explicit:** `MIN(r.due_date) FILTER (WHERE r.status NOT IN ('completed', 'cancelled') AND r.due_date >= CURRENT_DATE) >= $N::date` and `<= $M::date` (inclusive).
- **Boundary tests:** rows on exact `from`/`to` days are included; adjacent-day rows excluded.

---

## Phase 3 — Distinct values endpoint

> **Dependency:** Phase 3 reuses `build_column_filter_clauses` from Phase 2 to apply context filters. Phase 2 must be green before Phase 3 begins.

### Deliverables

- `get_column_distinct_values`, `sazinka.customer.column.distinct`, [`customerService.getColumnDistinctValues`](apps/web/src/services/customerService.ts).
- Distinct request carries context (`search`, revision filters, `columnFilters`) plus `query`/`limit`/`offset`.
- Distinct response returns `values`, `total`, and `hasMore`.
- Backend excludes target-column filter from context when computing its distinct options.
- **Aggregate columns** (`deviceCount`, `nextRevision`): the distinct query wraps the base `FROM … GROUP BY` as a CTE/subquery first, then `SELECT DISTINCT` on the materialized column. This avoids re-aggregating inside a nested `HAVING`.

### Tests — Rust

- v1 `column_to_distinct_sql` tests.
- **Handler:** `handle_column_distinct` — invalid column → error response; missing auth → error; success returns `values` + `total`.
- **SQLx:** after adding query, **`cargo sqlx prepare`** committed in CI/offline cache.
- **Context semantics:** `city` distinct call with active `type=company` filter narrows city list; active `city` filter itself is ignored for city distinct.
- **Server pagination/search:** `query` narrows values; `limit`/`offset` paginate; `hasMore` reflects remaining rows.
- **Deterministic ordering:** case-insensitive ascending; empty value normalized to `""` and appears last.

### Tests — Frontend service

- v1 cases + **subject string** exact match `sazinka.customer.column.distinct`.
- Forwards `query`/`limit`/`offset` and context filters unchanged.
- Parses and returns `hasMore` correctly.

---

## Phase 4 — Dropdown components

### Tests — ChecklistFilterDropdown

- Shows loading state while fetching distinct values.
- Renders a checkbox for each distinct value returned by the service.
- Checkbox selection toggles value in/out of selection set.
- Search input filters the visible checkbox options (client-side).
- “Select all” selects all currently visible values; “Deselect all” deselects all.
- Apply button calls `onApply` with the selected `values` array.
- Clear button calls `onClear` and resets selection.
- Displays i18n labels for enum values (`CustomerType`, `GeocodeStatus`).
- Handles `null`/empty values gracefully (rendered as `""` or a placeholder label).
- Shows “No results” when search matches nothing.
- Pre-selects values from an existing filter (edit mode).
- Closes on outside click; Escape key closes dropdown.
- `aria-label` and `role` attributes present for accessibility.
- **Retry:** optional “Retry” on fetch failure if implemented; else assert error UI + dismiss.
- **Select all when search narrows list:** “select all” applies to **visible** rows only (document + test).

### Tests — DateRangeFilterDropdown

- Renders two date inputs (From, To).
- Apply button calls `onApply` with `{ from, to }` dates.
- Clear button calls `onClear`.
- Validates `from <= to`; shows validation error when `from > to`.
- Apply disabled when range is invalid.
- Allows only “from” set (open-ended to); allows only “to” set (open-ended from).
- Pre-populates from an existing filter (edit mode).
- Closes on outside click; Escape key closes dropdown.
- **Invalid date string** in input (if free text): validation message.
- **Same day from and to:** valid (inclusive single day).

### Tests — ColumnFilterDropdown

- Renders `ChecklistFilterDropdown` for columns with `filterType: 'checklist'`.
- Renders `DateRangeFilterDropdown` for columns with `filterType: 'dateRange'`.
- Passes **initial filter** from parent for edit mode.

---

## Phase 5 — CustomerTable headers

### Tests — [`CustomerTable.test.tsx`](apps/web/src/components/customers/__tests__/CustomerTable.test.tsx)

- v1 cases.
- **Dropdown positioning:** `fixed`/`portal` if used — smoke test that dropdown mounts (no crash).
- **Focus:** first focusable inside dropdown on open (optional a11y).

---

## Phase 6 — Customers page + legacy removal

### Deliverables

- UPP `columnFilters` on grid profile; `requestOptions` includes sanitized filters; remove geocode/type props from bar and sheet.
- Update [`apps/web/src/persistence/profiles/customersProfile.ts`](apps/web/src/persistence/profiles/customersProfile.ts): remove `geocodeFilter` and `typeFilter` controls (deprecated); hydration remains tolerant of stale keys in stored blobs.

### Tests — [`Customers.columnFilters.test.tsx`](apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx)

- v1 payload + UPP + legacy DOM absence.
- **Cards mode:** `viewMode === 'cards'` → `listCustomersExtended` still receives `columnFilters` from UPP when filters were set in table mode (simulate: set filters in table, switch to cards, assert last call includes filters).
- **Summary:** `getCustomerSummary` called **without** column filter params (or as per product decision).
- **Clear all:** clears `columnFilters`, search, revision chips; **mock** `setUppColumnFilters` or similar.
- **Revision + column date interaction:** revision chip (`overdue`/`week`/`month`) and `nextRevision` column dateRange are both sent and combined with AND semantics. Implementation note: revision chips translate to `next_revision_within_days` (existing HAVING clause) while the column dateRange adds a separate HAVING bound via `build_column_filter_clauses`; both appear in the final HAVING and the DB ANDs them.
- **Revision + clear-all interaction:** clear all resets revision chips and removes `nextRevision` dateRange filter together.
- **Legacy persistence migration:** stale `geocodeFilter`/`typeFilter` values in persisted `customers.filters` state do not crash, do not affect request payload, and do not appear in active filter count.

### Tests — FilterBar / MobileSheet

- Update/remove geocode/type tests as in v1.

### Tests — [`Customers.sortModel.test.tsx`](apps/web/src/pages/__tests__/Customers.sortModel.test.tsx)

- Update props if `CustomerTable` / page mocks change; **assert `sortModel` + `columnFilters` together** in one test (no regression).

---

## Phase 7 — Documentation

- [`PRJ_CONTEXT.MD`](PRJ_CONTEXT.MD): v0.24.0, NATS subjects, duplicate-first-wins, summary global vs list filtered, inclusive date semantics.
- **DoD checklist:** sqlx cache, i18n keys, all tests green.

---

## Definition of done (column filters)

- [ ] Duplicate `column` in `columnFilters`: **first wins** (TS sanitize + Rust skip duplicates).
- [ ] List **total** count matches filtered dataset (count query uses same logic as list).
- [ ] `getCustomerSummary` behavior documented and tested (global KPIs in v1).
- [ ] `handle_column_distinct` tested with invalid column + auth failure paths.
- [ ] Rust serde **round-trip** for `ColumnFilter` on the wire.
- [ ] Cards view still sends `columnFilters` when filters active.
- [ ] Date range: inclusive bounds documented; invalid ranges rejected.
- [ ] New SQL: `sqlx` offline data updated.
- [ ] Legacy geocode/type dropdowns removed; DOM tests prove absence.
- [ ] Distinct endpoint is context-aware (target-column exclusion), paginated, searchable, deterministic, and exposes `hasMore`.
- [ ] Deprecated `customers.filters` controls (`geocodeFilter`, `typeFilter`) removed from profile with stale-key compatibility verified.
- [ ] Mandatory automated DB integration tests validate filtered `items`/`total` parity and pagination parity.
- [ ] Revision chips + `nextRevision` column dateRange coexistence and clear-all behavior are explicitly tested.
- [ ] `PRJ_CONTEXT.MD` updated.

---

## Files touched (reference)

See implementation in repo: `packages/shared-types`, `apps/web/src/lib/customerColumns.ts`, `customerService.ts`, `CustomerTable.tsx`, `Customers.tsx`, `CustomerFilterBar.tsx`, `MobileFilterSheet.tsx`, `apps/web/src/persistence/profiles/customersProfile.ts`, `apps/web/src/persistence/profiles/customersGridProfile.ts`, `worker/src/db/queries/customer.rs`, `worker/src/types/customer.rs`, `worker/src/handlers/customer.rs`, `worker/src/handlers/mod.rs`.

---

# Inbox — Last Visit Comment in Detail + Timeline (Plan Only)

**Status:** ✅ Implemented (Phase A RED → Phase B GREEN → Phase C REFACTOR complete)  
**Method:** Strict TDD (RED -> GREEN -> REFACTOR)  
**Quality bar:** Near-100% coverage for touched logic + explicit corner-case coverage

## 1) Goal

Show the **last comment from the most recent completed visit** of a customer in two places:

1. **Customer detail panel** (see §2 for the two code paths in the app).
2. **Visit panel in route timeline** when:
   - compact timeline stop is **selected** (highlighted), or
   - planning timeline stop is **expanded**

**Product rule (locked for this delivery):** timeline comment is **not** shown on hover alone; only **selected** (compact) or **expanded** (planning).  
> Assumption for informal wording “high again”: **highlighted/selected** stop.

## 2) Scope and constraints

### UI surfaces (name the real owners)

| Surface | Where it lives today | Work planned |
|--------|----------------------|--------------|
| Inbox detail column | `PlanningInbox.tsx` renders `CandidateDetail` with full `CandidateDetailData` | **Refactor** existing last-visit fetch in `CandidateDetail` to shared helper + hook; behavior preserved, tests updated/extended. |
| Plan customer panel | `CustomerDetailPanel.tsx` (used from `Plan.tsx`) currently passes **`candidate={null}`** stub | **Wire** real candidate data for `selectedCustomerId` (derive `CandidateDetailData` similarly to inbox fallback-from-route-stop, or lift shared mapper) so last-visit comment can appear here too. |
| Route timeline | `RouteDetailTimeline.tsx`, `PlanningTimeline.tsx`; parents include `PlanningInbox.tsx` and `Plan.tsx` | Embed comment UI + hook; parents need **no new props** if hook reads `customerId` from stop + panel selection state. |
| Detached / wrapper | `RouteTimelinePanel.tsx` composes the same timeline components | Re-test if this path is still used; same behavior as parent. |

### In scope
- Shared comment-loading and normalization logic (frontend); **refactor** `CandidateDetail` instead of duplicating a second implementation.
- Wiring **Plan** customer detail panel when it is the target for “customer detail panel.”
- i18n keys for timeline label / empty copy (if introduced).
- Tests with near-100% coverage on changed modules.

### Out of scope (this delivery)
- New DB schema/migration.
- Reworking visit completion workflow.
- Broad redesign of timeline card layout beyond a comment slot (see §3.6 for long-text UX within the slot).

### Future (not this delivery)
- Optional backend optimization: enrich `route.get` stops with `lastVisitComment` (or batch query) to avoid N parallel client fetches on large routes. **On-demand + cache** remains the v1 approach per §3.2.

## 3) Technical approach (planned)

### 3.1 Single source of truth for "last visit comment"

`CandidateDetail.tsx` **already** loads last completed visit (`listVisits` + `getVisit`) and merges notes. **Do not** add a parallel second implementation.

1. Extract **pure** normalization into `lastVisitComment.ts` (visit + work items → single `string | null`). The pure function is concerned **only** with note extraction/concatenation.
2. Extract **async** load + cache + stale guard into `useLastVisitComment` hook. The hook returns the **full `Visit` object** alongside the extracted notes so consumers can access any visit metadata (date, follow-up, type, result) without predicting every future need:
   ```ts
   interface LastVisitCommentResult {
     notes: string | null;
     visit: Visit | null;
     isLoading: boolean;
   }
   ```
3. **Refactor** `CandidateDetail` to consume the hook/helper so existing banner tests migrate to the shared behavior.

### 3.1a Device-loading split strategy

`CandidateDetail` currently loads devices + visits together in one `Promise.all`. When extracting the visit part into `useLastVisitComment`:

- **Keep devices in `CandidateDetail`** as a separate `useEffect` (or its own `useCustomerDevices` hook).
- The visit hook handles visits independently; no duplicate `listVisits` calls.
- Minor UX change: two sequential `setState` instead of one combined — acceptable because the loading indicator already covers both.
- A.2 tests must assert no duplicate `listVisits` call when hook is consumed alongside remaining device logic.

### 3.2 Fetch strategy

- Reusable hook (or service) with:
  - per-customer in-memory cache
  - stale-response guard when `customerId` changes mid-flight
  - graceful fallback if `getVisit` fails after `listVisits` succeeds
- Fetch **on demand only**: selected customer in detail; selected compact stop or expanded planning stop in timeline.

### 3.2a Timeline hook placement

Each **individual stop card** does NOT call the hook. Instead:

- The **parent timeline component** determines which stop is selected (compact) or expanded (planning) and reads its `customerId`.
- The parent calls `useLastVisitComment(customerId)` **once** for the active stop and passes the result down as a prop to the card.
- When no stop is selected/expanded, `customerId` is `null` and the hook skips the fetch.
- This avoids N hook instances and keeps the card component pure/testable without NATS mocking.

### 3.3 `listVisits` ordering contract

**RED must include a failing test if the contract is wrong:** `visit.list` with `customerId` + `status='completed'` + `limit=1` must return the **chronologically latest** completed visit (verify against `worker` `visit` list query / `ORDER BY`). If the API does not guarantee order, **fix in one place**: either adjust backend ordering (still no schema migration) or client-side pick max by `scheduledDate`/`updatedAt` from a small window — document the chosen rule in code + test.

### 3.4 NATS / connection parity

Match existing `CandidateDetail` behavior: when **`useNatsStore` reports not connected**, do not fire visit fetches; clear or hide comment state without throwing. Hook tests must cover **`isConnected === false`**.

### 3.5 UI strategy

- **Customer detail:** last visit comment in panel flow (inbox via refactored `CandidateDetail`; plan via wired `CustomerDetailPanel` + same hook).
- **Timeline:** concise comment block when **selected** (compact) or **expanded** (planning).
- Break stops and stops without `customerId`: **no fetch**.

### 3.5a Plan-mode `CustomerDetailPanel` data source

`CustomerDetailPanel.tsx` currently stubs `candidate: null`. To wire it:

- When `selectedCustomerId` is set, derive `CandidateDetailData` from the route's `SavedRouteStop[]` (already available in Plan via the route store / parent props) — map `stop.customerId`, `stop.customerName`, `stop.address`, etc.
- If the stop alone doesn't carry enough fields for `CandidateDetailData` (e.g. `dueDate`, `priority`), fetch the missing revision data via existing `getRevision` / `listRevisions` service (same pattern as inbox fallback in `PlanningInbox`).
- The `useLastVisitComment` hook is called inside `CandidateDetail` (or `CustomerDetailPanel`), so once `candidate` is non-null the comment loads automatically.
- **Test strategy (A.3 Plan path):** mock `usePanelState` to return a `selectedCustomerId`, provide a minimal `CandidateDetailData` via the wiring, and assert the comment banner appears. The data-derivation mapping itself gets a small unit test if non-trivial.

### 3.6 Long text in timeline cards

Avoid layout blow-up: e.g. **line-clamp** (2–3 lines) + **`title` / tooltip** with full text, or a compact “expand” control — pick one in GREEN; cover with one RTL assertion.

## 4) TDD plan (maximum coverage)

### Phase A — RED (tests first; must fail)

#### A.1 Pure unit tests: comment extraction/normalization
**New file:** `apps/web/src/lib/__tests__/lastVisitComment.test.ts`

Test matrix:
1. No visits (empty array / null) -> `null`
2. Visit exists, `resultNotes` present, no work items -> returns trimmed `resultNotes`
3. `resultNotes` whitespace only -> ignored, treated as empty
4. Visit `resultNotes` empty, fallback to first non-empty work-item `resultNotes`
5. Fallback to work-item `findings` when both visit-level and work-item `resultNotes` are empty
6. Work-item follow-up reason included when `requiresFollowUp === true` (with `⚠` prefix preserved)
7. Work-item follow-up reason excluded when `requiresFollowUp === false` even if `followUpReason` is set
8. **Multi-source join:** visit has `resultNotes` AND work item has `findings` AND another work item has follow-up -> joined with `'\n'` in deterministic order (visit-level first, then work items in array order)
9. **Empty `workItems` array:** `getVisit` succeeds, `workItems` is `[]` -> returns visit-level `resultNotes` only
10. Multiple candidate note fields -> deterministic precedence (visit.resultNotes > wi.resultNotes > wi.findings > wi.followUpReason per work item)
11. Multiline text preserved (no collapsing of internal newlines)
12. Very long note -> full pass-through in pure layer (truncation/clamping is a UI concern, tested in A.4)
13. Unicode/diacritics preserved (Czech characters)
14. **Ordering:** API pre-filters to one row (limit=1, ORDER BY scheduled_date DESC); pure function accepts single Visit + workItems, no multi-visit logic needed — contract verified in A.2

#### A.2 Hook/service tests: load + cache + race safety
**New file:** `apps/web/src/hooks/__tests__/useLastVisitComment.test.ts`

Hook returns `{ notes: string | null; visit: Visit | null; isLoading: boolean }`.

Test matrix:
1. Calls `listVisits` with expected filters (`customerId`, `status='completed'`, `limit=1`)
2. Calls `getVisit` for returned visit id; returns `{ notes, visit, isLoading: false }`
3. `getVisit` failure -> fallback: `visit` from `listVisits` row, `notes` from `visit.resultNotes`
4. `listVisits` failure -> stable `{ notes: null, visit: null, isLoading: false }` (no crash)
5. Customer switch A -> B before A resolves -> A result ignored (stale guard)
6. Same customer requested twice -> second call served from cache (no extra `listVisits`/`getVisit`)
7. Null/undefined customer id -> no fetch, returns `{ notes: null, visit: null, isLoading: false }`
8. **`isConnected === false`** -> no fetch / clears state, no throw (mirror `CandidateDetail` gating)
9. **No duplicate `listVisits`:** when hook is used alongside separate device loading in `CandidateDetail`, only one `listVisits` call fires (regression guard for §3.1a split)

#### A.3 Component tests: customer detail

**Update:** `apps/web/src/components/planner/CandidateDetail.test.tsx`  
**Update:** `apps/web/src/panels/__tests__/CustomerDetailPanel.test.tsx`

> **Setup note:** existing `CandidateDetail.test.tsx` mocks `useNatsStore` with `isConnected: false` globally (line 12-16). Tests that need the visit banner **must override** this mock to `isConnected: true` in a nested `describe` or per-test `vi.mocked()` call, otherwise the visit `useEffect` never fires.

Test matrix:
1. Comment banner shown when resolved comment exists (notes non-null)
2. Comment banner hidden when no comment (notes null)
3. **Visit date in banner:** `formatDate(visit.scheduledDate)` rendered in banner header when comment is visible
4. **Follow-up indicator block:** separate styled block with `AlertTriangle` icon shown when `visit.requiresFollowUp === true` and `visit.followUpReason` is set
5. **Follow-up indicator hidden:** block not rendered when `requiresFollowUp === false`
6. Loading state does not flash stale previous customer comment
7. Switching selected customer updates displayed comment correctly
8. **Plan path:** `CustomerDetailPanel` receives non-null candidate (wired from route stop data per §3.5a), same banner visibility rules as inbox — mock `usePanelState` with `selectedCustomerId` + provide `CandidateDetailData`

#### A.4 Component tests: route timeline (compact + planning)

**Update:** `apps/web/src/components/planner/RouteDetailTimeline.test.tsx`  
**New:** `apps/web/src/components/planner/PlanningTimeline.test.tsx`

Per §3.2a, the **parent** calls the hook and passes the result down as a prop. Card components receive `lastVisitComment?: { notes: string | null; visit: Visit | null }` — no NATS mocking needed in card-level tests.

Test matrix:
1. Compact: **selected** stop shows comment text
2. Compact: **selected** stop shows visit date alongside comment
3. Compact: non-selected stop does **not** show comment
4. Planning: **expanded** stop shows comment text
5. Planning: **expanded** stop shows visit date alongside comment
6. Planning: collapsed stop hides comment
7. Break card (`stopType === 'break'` / `item.type === 'break'`) never shows comment — even if prop is passed
8. Stop with `customerId = null` -> parent passes no comment prop (no fetch triggered)
9. API failure -> comment prop is `{ notes: null, visit: null }` -> hidden block, no crash
10. **Long text:** clamp/tooltip behavior per §3.6 — assert text is truncated (CSS class applied) and full text accessible via `title` attribute or tooltip
11. **Follow-up indicator in timeline:** if `visit.requiresFollowUp`, show compact follow-up badge/icon (at least one assertion)

#### A.5 i18n tests (if new keys are introduced)

**Concrete file:** add keys to `planner.json` and either extend an existing planner i18n completeness test or add **`apps/web/src/components/planner/__tests__/lastVisitCommentPlannerI18n.test.ts`** (same pattern as `ScoringPresetI18n.test.ts`: import `en`/`cs`/`sk` `planner.json`, assert keys exist and values ≠ raw keys).

Test matrix:
1. New keys exist in `en`, `cs`, `sk`
2. Values are not raw key fallbacks

### Phase B — GREEN (minimal code to pass RED)

1. Add pure `lastVisitComment` extractor/normalizer + **A.1** green.
2. Add `useLastVisitComment` (+ **A.2** green).
3. **Refactor** `CandidateDetail` to use hook/helper; **CandidateDetail** tests green.
4. Wire **`CustomerDetailPanel` + `Plan.tsx`** (or panel-only) so plan mode passes real `candidate` when `selectedCustomerId` is set; **A.3** green.
5. Wire **RouteDetailTimeline** + **PlanningTimeline** for selected/expanded + **A.4** green.
6. i18n keys + **A.5** green.

### Phase C — REFACTOR (keep tests green)

1. Ensure **one** note pipeline (no duplicate `listVisits` blocks).
2. Consistent naming for hook vs `CandidateDetail` props.
3. Memoization where needed for timeline rows.
4. Shared test fixtures for visit payloads.

## 5) Files expected to change

### Frontend logic/UI
- `apps/web/src/components/planner/CandidateDetail.tsx` (refactor to shared hook/helper)
- `apps/web/src/pages/PlanningInbox.tsx` (only if prop wiring / imports change — ideally none)
- `apps/web/src/pages/Plan.tsx` and/or `apps/web/src/panels/CustomerDetailPanel.tsx` (wire candidate for plan detail)
- `apps/web/src/components/planner/RouteDetailTimeline.tsx`
- `apps/web/src/components/planner/PlanningTimeline.tsx`
- `apps/web/src/panels/RouteTimelinePanel.tsx` (verify only if behavior must match)
- `apps/web/src/hooks/useLastVisitComment.ts` (new, planned)
- `apps/web/src/lib/lastVisitComment.ts` (new, planned)

### Frontend tests
- `apps/web/src/components/planner/CandidateDetail.test.tsx`
- `apps/web/src/panels/__tests__/CustomerDetailPanel.test.tsx`
- `apps/web/src/components/planner/RouteDetailTimeline.test.tsx`
- `apps/web/src/components/planner/PlanningTimeline.test.tsx` (new, planned)
- `apps/web/src/hooks/__tests__/useLastVisitComment.test.ts` (new, planned)
- `apps/web/src/lib/__tests__/lastVisitComment.test.ts` (new, planned)
- `apps/web/src/components/planner/__tests__/lastVisitCommentPlannerI18n.test.ts` (new, planned — if new i18n keys)

### i18n
- `apps/web/public/locales/en/planner.json`
- `apps/web/public/locales/cs/planner.json`
- `apps/web/public/locales/sk/planner.json`

### Backend (read-only verification for §3.3)
- `worker/src/db/queries/visit.rs` (or handler for `sazinka.visit.list`) — confirm `ORDER BY` for list; adjust only if tests prove wrong contract (still compatible with “no migration” if change is query-only).

## 6) Coverage targets

1. **Pure logic (`lastVisitComment.ts`):** 100% statements/branches — 14 cases in A.1 cover every conditional path.
2. **Hook (`useLastVisitComment.ts`):** 100% statements/branches — 9 cases in A.2 cover fetch, cache, stale guard, fallback, disconnect, no-duplicate.
3. **Changed UI components:** >=95% statements/branches on modified lines.
4. **Corner-case suite:** sections A.1–A.4 including **multi-source join**, **empty workItems**, **ordering contract**, **NATS off**, **Plan panel** path, **follow-up indicator**, **visit date display**, **long text clamp**.
5. **No untested fallback paths** (API failure, empty data, race switch, break stop, disconnected, null customerId, whitespace-only notes).

## 7) Definition of done

- [ ] Last visit comment visible in **inbox** detail (`CandidateDetail`) after refactor — behavior preserved or improved, not duplicated.
- [ ] **Visit date** shown in banner header when comment is visible.
- [ ] **Follow-up indicator** (separate styled block) shown when `requiresFollowUp` is true; hidden otherwise.
- [ ] Last visit comment visible in **Plan** customer detail panel when a customer is selected and data is available (§3.5a wiring).
- [ ] Last visit comment visible in route timeline for **selected** (compact) / **expanded** (planning) visit cards.
- [ ] No comment leakage between customers on fast selection changes.
- [ ] Break stops and null-`customerId` stops never fetch/show comments.
- [ ] **Disconnected NATS:** no spurious fetch / no crash.
- [ ] **`listVisits` latest-first contract** verified or compensated; test documents outcome.
- [ ] **No duplicate `listVisits` calls** after device-loading split (§3.1a).
- [ ] Timeline long text does not break layout (clamp + full text accessible per §3.6).
- [ ] Timeline follow-up badge/icon shown when applicable.
- [ ] i18n complete for `en`, `cs`, `sk` if new keys added.
- [ ] New/updated tests pass with near-100% coverage on touched code (A.1: 14 cases, A.2: 9 cases, A.3: 8 cases, A.4: 11 cases, A.5: 2 cases = **44 test cases minimum**).
- [ ] `PRJ_CONTEXT.MD` updated after implementation (not in planning step).

---

# Visit Field Notes — Plan (Reviewed)

> **Status:** Planned (final review complete, TDD plan locked, ready for implementation)
> **Created:** 2026-03-27
> **Final review:** 2026-03-27

## Problem

Technicians need a comfortable way to take notes during a visit. Today notes are effectively captured at completion time, which causes memory loss, rework, and poor note quality.

## Final decisions (locked)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Editable after completion | Always editable, with audit trail |
| 2 | Max length | Hard DB limit: 10,000 chars |
| 3 | Rich editor | Tiptap WYSIWYG, Markdown storage |
| 4 | Images in notes | Not allowed; separate photo feature in `PRJ_ROADMAP.MD` |
| 5 | Offline resilience | Browser-level draft (`localStorage`) + sync on reconnect |
| 6 | Migration strategy | Use migration; if old note >10,000 chars, truncate |
| 7 | Completion consistency | `complete_visit` accepts optional `fieldNotes` and persists atomically in one transaction |
| 8 | Compact UI rendering | Full Markdown only in Visit Detail; plain-text excerpt in timeline/cards |
| 9 | Markdown security | Strict markdown only, no raw HTML, sanitized allowlist |
| 10 | Edit permissions | Anyone who has access to the visit can edit |
| 11 | Audit retention | Keep forever |
| 12 | Snapshot granularity | One snapshot row per browser-tab session; keep latest changed version for that session |
| 13 | Session definition | Browser-tab session (new session on open/reload) |
| 14 | Author tracking | Required on every audit update (`edited_by_user_id`) |

## Proposed solution

Single Markdown note per visit, backed by `visits.field_notes`, edited via Tiptap, auto-saved, with session-level audit history and author tracking.

## Data model

```sql
-- 1) Rename note column and normalize legacy data
ALTER TABLE visits RENAME COLUMN result_notes TO field_notes;

-- 2) Truncate pre-existing over-limit values before adding hard check
UPDATE visits
SET field_notes = substring(field_notes from 1 for 10000)
WHERE field_notes IS NOT NULL
  AND length(field_notes) > 10000;

-- 3) Hard limit for all future writes
ALTER TABLE visits
  ADD CONSTRAINT visits_field_notes_max_length
  CHECK (field_notes IS NULL OR length(field_notes) <= 10000);

-- 4) Session-level audit table (one row per visit+session, updatable)
CREATE TABLE visit_notes_history (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  visit_id           UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  session_id         UUID NOT NULL,
  edited_by_user_id  UUID NOT NULL REFERENCES users(id),
  field_notes        TEXT NOT NULL,
  first_edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_edited_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_count       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (visit_id, session_id)
);

CREATE INDEX idx_visit_notes_history_visit ON visit_notes_history(visit_id);
CREATE INDEX idx_visit_notes_history_last_edit ON visit_notes_history(last_edited_at);
```

### Audit semantics

- Audit row is created/updated only when content actually changes.
- For the same `(visit_id, session_id)`, only the latest version is kept.
- On repeated changes in the same session, row is updated:
  - `field_notes` = latest value
  - `last_edited_at` = now
  - `edited_by_user_id` = current editor
  - `change_count` increments

### Rename scope (important)

- `visits.result_notes` → `visits.field_notes` and `Visit.resultNotes` → `Visit.fieldNotes` — **visit-level only**.
- `VisitWorkItem.resultNotes`, `VisitWorkItem.findings`, `VisitWorkItem.followUpReason` are **NOT renamed**. They remain as-is on the work-item model.
- All import/export paths that reference `result_notes` on the **visits** table must be updated. Import/export paths for **work items** stay unchanged.

## API changes

### New endpoint: `sazinka.visit.update_field_notes`

```typescript
interface UpdateFieldNotesRequest {
  visitId: string;
  sessionId: string;   // browser-tab session id (UUID v4)
  fieldNotes: string;  // markdown, max 10,000 chars
}
// Response: updated Visit object
```

Behavior:
- Validate permission: caller must have access to the visit.
- Validate length <= 10,000 → reject with `FIELD_NOTES_TOO_LONG`.
- Validate `visitId` exists → reject with `VISIT_NOT_FOUND`.
- No-op if content is unchanged (no DB write, no audit row).
- If changed: update `visits.field_notes` and upsert audit row for `(visit_id, session_id)`.

### New endpoint: `sazinka.visit.notes.history`

```typescript
interface ListNotesHistoryRequest {
  visitId: string;
}

interface NotesHistoryEntry {
  id: string;
  sessionId: string;
  editedByUserId: string;
  editedByName?: string;  // joined from users table
  fieldNotes: string;
  firstEditedAt: string;
  lastEditedAt: string;
  changeCount: number;
}

interface ListNotesHistoryResponse {
  entries: NotesHistoryEntry[];  // ordered by last_edited_at DESC
}
```

Behavior:
- Returns all audit snapshots for a visit, newest first.
- No pagination for v1 (session count per visit is naturally bounded).

### Existing endpoint update: `sazinka.visit.complete`

Extends the **current** `CompleteVisitRequest` (preserving all existing fields):

```typescript
interface CompleteVisitRequest {
  id: string;
  result: VisitResult;           // 'successful' | 'partial' | 'failed' | 'customer_absent' | 'rescheduled'
  actualArrival?: string;        // existing field (preserved)
  actualDeparture?: string;      // existing field (preserved)
  fieldNotes?: string;           // NEW — optional final note state
  sessionId?: string;            // NEW — optional for audit upsert
  requiresFollowUp?: boolean;
  followUpReason?: string;
}
```

Behavior:
- Complete visit and optional final notes write happen in a **single DB transaction**.
- If `fieldNotes` is provided and differs from current value, visit note + audit row are updated before commit.
- Prevents race where completion succeeds but latest notes are lost.
- Existing fields (`result`, `actualArrival`, `actualDeparture`, `requiresFollowUp`, `followUpReason`) behave identically to today.

## UI/UX

### Visit Detail

- New `Notes` tab with Tiptap editor and small toolbar.
- Status line: character count and save status.
- Button: `History` opens note change history for that visit.

### Completion dialog

- Shows read-only preview of current note.
- Provides `Edit notes before completing` action.
- No separate legacy `resultNotes` textarea.

### Compact surfaces

- Timeline/cards use plain-text excerpt generated from markdown (clamped).
- Full markdown rendering is only in Visit Detail and dedicated note view.

## Offline and conflicts

- Draft mirrored to `localStorage` per `visitId + sessionId`.
- On reconnect, unsynced draft is pushed automatically.
- If local draft and server differ on reopen, show conflict prompt:
  - Keep local
  - Use server
  - Compare
- **Compare:** two panes of **side-by-side rendered Markdown** (sanitized HTML in both), not a raw text diff.

### Complete visit with unsynced draft

- **Default:** **auto-save (flush draft to server) then complete** in one user action.
- **If flush fails:** show a **warning dialog** (save failed): options such as Retry, Discard local draft and complete, or Cancel — do not complete silently while local draft still differs.

## Security

- Raw HTML disabled.
- Render through strict markdown pipeline with sanitized allowlist output.
- Links sanitized and opened safely.

## Migration plan

1. Rename `result_notes` -> `field_notes`.
2. Truncate over-limit legacy values to 10,000 chars (**silent** — no migration report, admin list, or structured “truncated visits” export).
3. Add hard `CHECK` constraint.
4. Create `visit_notes_history`.
5. Update shared types and backend handlers.
6. Update frontend references and completion flow.
7. Roll out with regression tests and fixtures containing long legacy notes.

## Utility: `stripMarkdown`

**Location:** `apps/web/src/lib/stripMarkdown.ts`

```typescript
/**
 * Strip markdown formatting to produce a plain-text string for compact UIs.
 * Used by extractLastVisitComment, timeline cards, StopCommentBlock.
 * Removes headings, bold, italic, links, images, lists, code blocks.
 * Collapses whitespace. Does NOT truncate (truncation is a UI concern).
 */
export function stripMarkdown(md: string): string;
```

Implementation approach: lightweight regex-based stripping (no full AST).
Library option: `remove-markdown` (tiny, 0 deps) or hand-rolled.

### `extractLastVisitComment` update

After rename, reads `visit.fieldNotes` (was `visit.resultNotes`).
Applies `stripMarkdown()` to the visit-level note before joining.
Work-item `resultNotes`/`findings` are already plain-text, no stripping needed.

## Scope estimate

| Layer | Work |
|-------|------|
| DB migration | Rename column, truncate long legacy notes, add check constraint, create history table |
| Shared types | `Visit.fieldNotes`, `UpdateFieldNotesRequest`, extend `CompleteVisitRequest`, `ListNotesHistoryRequest/Response` |
| Rust handlers | `update_field_notes`, `notes_history`, transactional `complete_visit` note merge, permission checks |
| Frontend service | Save note, fetch history, complete with optional final notes payload |
| Utility | `stripMarkdown` — plain-text extraction from markdown |
| Editor UI | `VisitFieldNotes.tsx` with Tiptap + save state + character count |
| History UI | Visit Detail `History` button + list of session snapshots + side-by-side compare |
| Rendering | Markdown in detail (sanitized), plain excerpt in timeline/cards |
| Offline | `localStorage` draft + conflict prompt + reconnect sync |
| Tests | 88 focused tests across 7 TDD phases (see below) |

## Follow-up decisions (resolved 2026-03-27)

| Topic | Decision |
|-------|----------|
| History Compare UX | **Side-by-side rendered Markdown** (two sanitized preview panes). |
| Truncation transparency | **Silent** — no post-migration report or UI for truncated rows. |
| Completion with unsynced draft | **Flush draft (save) then complete**; if save fails, **warning dialog** with retry / discard local / cancel (no silent complete with divergent draft). |

---

## TDD Implementation Plan

> Strict RED → GREEN → REFACTOR per phase.
> Coverage target: **≥ 95%** statements per module, **100%** for pure functions and handlers.

### Phase 1: DB migration + Shared types

**Scope:** SQL migration, `Visit.fieldNotes` rename, new request/response types.

#### 1a — RED (write tests before any implementation)

**Rust migration tests** (`worker/src/db/migration_tests.rs` or integration test):

| # | Test | What it verifies |
|---|------|-----------------|
| M1 | `migration_renames_result_notes_column` | Column `field_notes` exists, `result_notes` does not |
| M2 | `migration_truncates_long_notes` | Pre-seeded 15,000-char note → exactly 10,000 after migration |
| M3 | `migration_preserves_short_notes` | 500-char note unchanged |
| M4 | `migration_preserves_null_notes` | NULL stays NULL |
| M5 | `migration_creates_check_constraint` | INSERT with 10,001-char note → DB error |
| M6 | `migration_allows_max_length_note` | INSERT with exactly 10,000 chars → succeeds |
| M7 | `migration_creates_history_table` | `visit_notes_history` table exists with correct columns |
| M8 | `migration_unique_constraint_visit_session` | Duplicate `(visit_id, session_id)` → unique violation |

**TypeScript type tests** (`packages/shared-types/src/__tests__/visit.test.ts`):

| # | Test | What it verifies |
|---|------|-----------------|
| T1 | `Visit_has_fieldNotes_property` | `Visit` type has `fieldNotes?: string \| null` |
| T2 | `Visit_no_longer_has_resultNotes` | Compile-time: accessing `resultNotes` on `Visit` is a type error |
| T3 | `CompleteVisitRequest_accepts_fieldNotes` | `fieldNotes` and `sessionId` are optional valid fields |
| T4 | `UpdateFieldNotesRequest_requires_all_fields` | `visitId`, `sessionId`, `fieldNotes` are required |
| T5 | `ListNotesHistoryResponse_shape` | Response contains `entries: NotesHistoryEntry[]` |

#### 1b — GREEN

- Write SQL migration file.
- Update `Visit` interface: rename `resultNotes` → `fieldNotes`.
- Add `UpdateFieldNotesRequest`, `ListNotesHistoryRequest`, `ListNotesHistoryResponse`, `NotesHistoryEntry`.
- Extend `CompleteVisitRequest` with optional `fieldNotes` + `sessionId`.
- Update Rust `Visit` struct: `result_notes` → `field_notes`.

#### 1c — REFACTOR

- Clean up migration SQL (comments, consistent naming).
- Verify all 8 migration tests + 5 type tests green.

---

### Phase 2: Rust handlers (`update_field_notes`, `notes_history`, `complete_visit` update)

#### 2a — RED

**Handler tests** (`worker/src/handlers/visit_tests.rs`):

| # | Test | What it verifies |
|---|------|-----------------|
| H1 | `update_field_notes_saves_new_note` | Empty → "Hello" written to `visits.field_notes` |
| H2 | `update_field_notes_creates_audit_row` | Audit row exists with correct `session_id`, `edited_by_user_id`, `change_count = 1` |
| H3 | `update_field_notes_upserts_same_session` | Second save in same session → `change_count = 2`, `last_edited_at` updated |
| H4 | `update_field_notes_new_session_new_row` | Different `session_id` → second audit row, both have `change_count = 1` |
| H5 | `update_field_notes_noop_unchanged` | Save same content twice → no new audit row, no `updated_at` change |
| H6 | `update_field_notes_rejects_too_long` | 10,001 chars → error `FIELD_NOTES_TOO_LONG` |
| H7 | `update_field_notes_accepts_max_length` | Exactly 10,000 chars → success |
| H8 | `update_field_notes_rejects_missing_visit` | Non-existent `visitId` → `VISIT_NOT_FOUND` |
| H9 | `update_field_notes_stores_editor_id` | `edited_by_user_id` matches the caller |
| H10 | `notes_history_returns_entries_newest_first` | 3 sessions → 3 entries, `last_edited_at` descending |
| H11 | `notes_history_empty_for_no_edits` | Visit with no audit rows → empty `entries` |
| H12 | `notes_history_includes_user_name` | `editedByName` joined from `users` table |
| H13 | `complete_visit_with_field_notes_atomic` | `fieldNotes` written + visit completed in one transaction |
| H14 | `complete_visit_field_notes_creates_audit` | Completing with `fieldNotes` + `sessionId` → audit row |
| H15 | `complete_visit_without_field_notes_unchanged` | Completing without `fieldNotes` → `field_notes` stays as-is |
| H16 | `complete_visit_field_notes_noop_same_content` | Same content → no audit write |
| H17 | `complete_visit_preserves_existing_fields` | `actualArrival`, `actualDeparture`, `requiresFollowUp` all stored correctly alongside `fieldNotes` |

#### 2b — GREEN

- Implement `handle_update_field_notes` handler + SQL queries.
- Implement `handle_notes_history` handler + SQL query with `LEFT JOIN users`.
- Update `handle_complete_visit` to accept and persist `fieldNotes/sessionId` transactionally.
- Register NATS subjects `sazinka.visit.update_field_notes` and `sazinka.visit.notes.history`.

#### 2c — REFACTOR

- Extract shared audit-upsert logic into `db::queries::visit_notes::upsert_audit`.
- All 17 handler tests green.

---

### Phase 3: Frontend utilities (`stripMarkdown`, `extractLastVisitComment` update)

#### 3a — RED

**`stripMarkdown` tests** (`apps/web/src/lib/__tests__/stripMarkdown.test.ts`):

| # | Test | What it verifies |
|---|------|-----------------|
| S1 | `strips_bold` | `**bold**` → `bold` |
| S2 | `strips_italic` | `*italic*` and `_italic_` → `italic` |
| S3 | `strips_headings` | `## Heading` → `Heading` |
| S4 | `strips_links` | `[text](url)` → `text` |
| S5 | `strips_images` | `![alt](url)` → `alt` |
| S6 | `strips_inline_code` | `` `code` `` → `code` |
| S7 | `strips_code_blocks` | Fenced block → content only |
| S8 | `strips_unordered_lists` | `- item` → `item` |
| S9 | `strips_ordered_lists` | `1. item` → `item` |
| S10 | `collapses_whitespace` | Multiple newlines / spaces → single space |
| S11 | `empty_string_returns_empty` | `""` → `""` |
| S12 | `null_safe` | `null` / `undefined` → `""` |
| S13 | `plain_text_unchanged` | No markdown → same string |
| S14 | `strips_strikethrough` | `~~text~~` → `text` |
| S15 | `strips_blockquotes` | `> quote` → `quote` |

**`extractLastVisitComment` update tests** (extend `apps/web/src/lib/__tests__/lastVisitComment.test.ts`):

| # | Test | What it verifies |
|---|------|-----------------|
| E1 | `reads_fieldNotes_instead_of_resultNotes` | Visit with `fieldNotes` → included in output |
| E2 | `strips_markdown_from_fieldNotes` | `**bold** text` → `bold text` in output |
| E3 | `does_not_strip_workItem_resultNotes` | Work-item plain-text stays unchanged |
| E4 | `handles_mixed_markdown_and_plain` | Visit markdown + work-item plain → correct concatenation |

#### 3b — GREEN

- Implement `stripMarkdown.ts`.
- Update `extractLastVisitComment`: read `visit.fieldNotes`, apply `stripMarkdown`.
- Update all test fixtures to use `fieldNotes` instead of `resultNotes`.

#### 3c — REFACTOR

- All 19 utility tests green.
- Verify no `resultNotes` references remain on `Visit` in frontend code.

---

### Phase 4: Frontend services + editor component

#### 4a — RED

**Service tests** (`apps/web/src/services/__tests__/visitService.test.ts`):

| # | Test | What it verifies |
|---|------|-----------------|
| SV1 | `saveFieldNotes_publishes_correct_subject` | Publishes to `sazinka.visit.update_field_notes` |
| SV2 | `saveFieldNotes_sends_visitId_sessionId_fieldNotes` | Payload shape matches `UpdateFieldNotesRequest` |
| SV3 | `fetchNotesHistory_publishes_correct_subject` | Publishes to `sazinka.visit.notes.history` |
| SV4 | `completeVisit_includes_fieldNotes_when_provided` | `fieldNotes` + `sessionId` in payload |
| SV5 | `completeVisit_omits_fieldNotes_when_absent` | No `fieldNotes` key in payload |

**Editor component tests** (`apps/web/src/components/visit/__tests__/VisitFieldNotes.test.tsx`):

| # | Test | What it verifies |
|---|------|-----------------|
| VN1 | `renders_tiptap_editor` | Editor container is in the DOM |
| VN2 | `displays_character_count` | Shows "0 / 10,000" initially |
| VN3 | `updates_character_count_on_input` | Typing "Hi" → "2 / 10,000" |
| VN4 | `shows_save_status_saving` | During save → "Saving..." indicator |
| VN5 | `shows_save_status_saved` | After save → "Saved" indicator |
| VN6 | `shows_save_status_error` | Failed save → "Save failed" indicator |
| VN7 | `prevents_input_beyond_max_length` | Pasting 11,000 chars → truncated to 10,000 |
| VN8 | `auto_saves_after_debounce` | Typing → wait debounce → `saveFieldNotes` called |
| VN9 | `loads_existing_notes_into_editor` | Visit with existing `fieldNotes` → editor pre-filled |
| VN10 | `read_only_when_no_permission` | No access → editor disabled (edge case if permissions evolve) |

#### 4b — GREEN

- Add `saveFieldNotes`, `fetchNotesHistory` to `visitService.ts`.
- Update `completeVisit` to accept + forward `fieldNotes`/`sessionId`.
- Implement `VisitFieldNotes.tsx` with Tiptap, debounced auto-save, char count, save status.

#### 4c — REFACTOR

- All 15 service + editor tests green.

---

### Phase 5: Offline draft + conflict resolution

#### 5a — RED

**Draft hook tests** (`apps/web/src/hooks/__tests__/useFieldNotesDraft.test.ts`):

| # | Test | What it verifies |
|---|------|-----------------|
| D1 | `saves_draft_to_localStorage` | After typing, `localStorage` has key `fieldNotes:{visitId}:{sessionId}` |
| D2 | `restores_draft_on_mount` | Existing `localStorage` entry → editor pre-filled |
| D3 | `clears_draft_after_successful_save` | Server save OK → `localStorage` key removed |
| D4 | `detects_conflict_local_vs_server` | Server has different content → conflict state true |
| D5 | `resolve_keep_local` | Choose local → server updated with local content |
| D6 | `resolve_use_server` | Choose server → local draft discarded, editor updated |
| D7 | `flush_before_complete` | `flushDraft()` triggers save → returns success/failure |
| D8 | `flush_failure_does_not_clear_draft` | Failed flush → draft preserved in `localStorage` |

#### 5b — GREEN

- Implement `useFieldNotesDraft` hook: `localStorage` read/write, conflict detection, `flushDraft`.
- Wire into `VisitFieldNotes.tsx`.

#### 5c — REFACTOR

- All 8 draft tests green.

---

### Phase 6: History UI + completion dialog update

#### 6a — RED

**History component tests** (`apps/web/src/components/visit/__tests__/NotesHistory.test.tsx`):

| # | Test | What it verifies |
|---|------|-----------------|
| NH1 | `renders_list_of_history_entries` | 3 entries → 3 items rendered |
| NH2 | `shows_editor_name_and_date` | Each entry shows `editedByName` + formatted `lastEditedAt` |
| NH3 | `shows_change_count` | "5 edits" badge |
| NH4 | `empty_state` | No entries → "No edit history" message |
| NH5 | `compare_button_opens_side_by_side` | Click compare → two rendered markdown panes |

**Completion dialog tests** (`apps/web/src/components/visit/__tests__/CompleteVisitDialog.test.tsx`):

| # | Test | What it verifies |
|---|------|-----------------|
| CD1 | `shows_note_preview` | Current note markdown rendered read-only |
| CD2 | `edit_notes_link_navigates_to_editor` | Click "Edit notes" → editor opened |
| CD3 | `flush_before_complete_success` | Unsynced draft → flushed → complete proceeds |
| CD4 | `flush_before_complete_failure_shows_warning` | Flush fails → warning dialog with retry/discard/cancel |
| CD5 | `discard_local_and_complete` | Discard → complete without local draft |

#### 6b — GREEN

- Implement `NotesHistory.tsx` with `fetchNotesHistory` + side-by-side compare modal.
- Update `CompleteVisitDialog` to show note preview, wire flush logic.

#### 6c — REFACTOR

- All 10 history + completion tests green.

---

### Phase 7: Rename blast radius cleanup + integration

#### 7a — RED

**Rename verification tests:**

| # | Test | What it verifies |
|---|------|-----------------|
| R1 | `no_resultNotes_on_Visit_in_frontend` | `grep -r "resultNotes"` in frontend Visit-typed code → 0 hits (work-item refs excluded) |
| R2 | `no_result_notes_in_rust_visit_struct` | Rust `Visit` struct uses `field_notes` |
| R3 | `existing_lastVisitComment_tests_pass` | All existing `lastVisitComment.test.ts` tests still green after rename |
| R4 | `useLastVisitComment_reads_fieldNotes` | Hook returns data derived from `visit.fieldNotes` |
| R5 | `CandidateDetail_displays_fieldNotes` | Component shows note from `fieldNotes` |
| R6 | `StopCommentBlock_shows_stripped_markdown` | Markdown notes → plain-text in compact surface |

#### 7b — GREEN

- Rename all `resultNotes` → `fieldNotes` on `Visit` across 12 frontend files.
- Rename `result_notes` → `field_notes` in 13 Rust files (visit-related only).
- Update test fixtures.

#### 7c — REFACTOR

- Full test suite green.
- `cargo clippy` clean, `cargo fmt` applied.
- No unused imports.

---

### Coverage summary

| Module | IDs | Count | Target |
|--------|-----|-------|--------|
| DB migration (Rust) | M1–M8 | 8 | 100% |
| Shared types (TS) | T1–T5 | 5 | 100% |
| Rust handlers | H1–H17 | 17 | 100% branches |
| `stripMarkdown` | S1–S15 | 15 | 100% |
| `extractLastVisitComment` update | E1–E4 | 4 | 100% |
| Visit service | SV1–SV5 | 5 | 100% |
| `VisitFieldNotes` editor | VN1–VN10 | 10 | ≥ 95% |
| `useFieldNotesDraft` hook | D1–D8 | 8 | 100% |
| `NotesHistory` component | NH1–NH5 | 5 | ≥ 95% |
| `CompleteVisitDialog` update | CD1–CD5 | 5 | ≥ 95% |
| Rename verification | R1–R6 | 6 | N/A (integration) |
| **Total** | | **88** | **≥ 95% overall** |

---

## Visit Field Notes — UI Wiring Plan (TDD)

### Context

Phases 1–7 built all the building blocks — `VisitFieldNotes` (Tiptap editor),
`useFieldNotesDraft` (offline draft + conflict resolution), `NotesHistory`
(audit trail UI), `saveFieldNotes` / `fetchNotesHistory` (service layer) — but
none of them are imported or rendered in any actual page or dialog. This plan
wires them into the four UI surfaces where visit notes are read, written, or
edited.

### Surfaces to wire

| # | Surface | File | Current state | Target state |
|---|---------|------|---------------|--------------|
| S1 | **VisitDetail page** | `pages/VisitDetail.tsx` | Plain text `{visit.fieldNotes}` (read-only) + `<textarea>` in complete dialog | Rich `<VisitFieldNotes>` for viewing + editing, `<NotesHistory>`, draft hook, auto-save |
| S2 | **VisitDetailDialog** | `components/timeline/VisitDetailDialog.tsx` | `<textarea>` in complete form, plain text for completed | `<VisitFieldNotes>` in complete form, editable for all statuses (per status matrix), flush-before-complete |
| S3 | **CustomerTimeline** | `components/timeline/CustomerTimeline.tsx` | `{visit.fieldNotes}` plain-text excerpt | `stripMarkdown(visit.fieldNotes)` — compact plain-text excerpt (no editor) |
| S4 | **CustomerDetail page** | `pages/CustomerDetail.tsx` | `full.visit.fieldNotes` aggregated into notes string | `stripMarkdown(full.visit.fieldNotes)` — strip markdown before aggregation |

### Visit status matrix (explicit buckets)

Implementation rule is locked from prior decisions: **notes are editable in all statuses** for users who can access the visit. Do not leave any status implicit.

| Status | Notes UI on VisitDetail | Notes UI on VisitDetailDialog | Complete form | Rationale |
|--------|-------------------------|-------------------------------|---------------|-----------|
| `planned` | Editable | Editable (via complete form) | Available | Default field-work flow |
| `in_progress` | Editable | Editable (via complete form) | Available | Same |
| `completed` | Editable | Editable | Hidden | Post-completion corrections allowed; audit trail preserves history |
| `cancelled` | Editable | Editable | Hidden | Notes may still carry context, cancellation reasons, and follow-up handover |
| `rescheduled` | Editable | Editable | Hidden | Keep context while workflow continues in a new slot |

Add tests that lock this matrix (W31–W32, VD13–VD14).

### Suggested improvements incorporated

- Convert status behavior from ambiguous to explicit, test-locked policy (editable in all statuses).
- Lock autosave behavior to concrete timing and retry semantics (below), so tests are deterministic.
- Replace either/or stale-refresh behavior with a single conflict-prompt rule (no silent overwrite).
- Keep both test-count targets and measurable coverage thresholds (line/branch) to avoid false confidence.

### Dual editors & `sessionId` (VisitDetail)

`VisitDetail` will host **two** rich-note surfaces: the main “Field notes” card **and** the complete-visit dialog. Without rules, drafts and `sessionId` can diverge.

**Decisions (document in code + tests):**

1. **Single `sessionId` per page load** for both surfaces (same browser tab session as backend audit expects).
2. **Single source of truth for markdown:** lift `fieldNotes` string state (or draft hook output) so the complete dialog does **not** maintain a separate `useState` that can disagree with the main editor. Alternatively, unmount one editor when the other mounts — if so, document and test.
3. **Opening “Complete”** must pre-fill from the same state as the main editor (including unsynced draft), unless product explicitly wants “completion notes separate” (not recommended).

Tests: W33–W37 (W33–W36 dual editor + shared state; W37 stale server / refetch).

### Autosave policy (locked)

- **Debounce interval:** `1500 ms` before server autosave.
- **Draft persistence:** local draft writes happen on every change via `useFieldNotesDraft`.
- **Failure strategy C:** non-blocking warning + exponential backoff retries + manual `Retry now`.
  - Recommended backoff sequence for tests: `1500ms`, `3000ms`, `6000ms`, `12000ms`, cap at `30000ms`.
  - Success clears warning and resets retry schedule.
- **Completing visit:** keep existing locked rule: flush draft to server before completion.

### Stale server content & refresh

If `loadVisit()` runs again while the user has a local draft (e.g. background refetch, reconnect), `serverContent` in `useFieldNotesDraft` can change.

- **Locked behavior:** if server content differs from unsynced local draft, show conflict prompt (`Keep local`, `Use server`, `Compare`), never overwrite local silently.
- After **successful `saveFieldNotes`**, update in-memory `visit.fieldNotes` from the returned `Visit` payload so UI matches server normalization (trimming, etc.) — test **INT13**.

### Storage & environment fallbacks

| Concern | Expected behavior | Test |
|---------|-------------------|------|
| `localStorage` quota exceeded | Draft write fails silently (per hook); UI still usable; optional toast — at minimum no crash | **INT15** |
| `crypto.randomUUID` unavailable | Fallback UUID generator; same format as INT1 | **INT16** |
| Storage disabled / private mode | Same as quota — no throw from page | **INT17** |

### Coverage measurement (not only test count)

“High test count” ≠ 100% line coverage. After GREEN, run **Vitest coverage** on touched wiring files (e.g. `VisitDetail.tsx`, `VisitDetailDialog.tsx`, `CustomerTimeline.tsx`, `CustomerDetail.tsx`) and target **≥ 90% lines** on those files (branches **≥ 85%** where practical). CI or `package.json` script optional; document the command in REFACTOR.

### Out of scope (optional follow-up)

- **i18n:** new conflict / flush / history strings — smoke only unless keys are added (no separate test file required for wiring).
- **a11y:** focus trap, toolbar roving tabindex — not part of this wiring plan.

### Open questions — resolved

All originally-open questions turned out to be answered by existing locked decisions and test coverage. Kept here for traceability.

| ID | Topic | Resolution | Covered by |
|----|-------|------------|------------|
| OQ1 | Complete click while autosave is already in-flight | INT14 mandates a concurrency gate (mutex/promise queue) that serialises saves. W19–W22 mandate flush-before-complete. Combined: if autosave is in-flight when user clicks Complete, the gate holds flushDraft until the in-flight save resolves, then flush proceeds, then complete fires. No additional test needed. | INT14, W19–W22 |
| OQ2 | Backoff tuning/jitter | Autosave policy (locked) already specifies the exact deterministic sequence: `1500ms, 3000ms, 6000ms, 12000ms, cap at 30000ms`, no jitter. INT20 tests this. | Autosave policy section, INT20 |
| OQ3 | Retry persistence across reload | Decision 13 defines session as "new on open/reload." Retry state lives in React `useState` (in-memory), which naturally resets on page load. INT23 covers unmount cleanup (reload is a full unmount + fresh mount with new sessionId). | Decision 13, INT23 |

---

### Phase W1: VisitDetail page — editable rich editor + history + draft

The main Visit Detail page is the primary surface for reading, writing, and
editing field notes.

#### W1a — RED

**Test file:** `apps/web/src/pages/__tests__/VisitDetail.fieldNotes.test.tsx`

| # | Test name | What it verifies |
|---|-----------|-----------------|
| W1 | `renders_rich_editor_for_planned_visit` | Planned visit → `<VisitFieldNotes>` rendered with `readOnly=false`, toolbar visible |
| W2 | `renders_rich_editor_for_in_progress_visit` | In-progress visit → editor is editable |
| W3 | `renders_editable_editor_for_completed_visit` | Completed visit → `<VisitFieldNotes>` editable, toolbar visible |
| W4 | `renders_editable_editor_for_cancelled_visit` | Cancelled visit → `<VisitFieldNotes>` editable, toolbar visible |
| W5 | `editor_populated_with_existing_notes` | Visit with `fieldNotes: '**bold** text'` → editor contains 'bold text' |
| W6 | `editor_empty_when_no_notes` | Visit with `fieldNotes: null` → editor rendered but empty |
| W7 | `save_button_calls_saveFieldNotes` | Click toolbar Save → `saveFieldNotes()` called with correct `visitId`, `sessionId`, `fieldNotes` |
| W8 | `save_error_shows_error_banner` | `saveFieldNotes` rejects → error message displayed |
| W9 | `save_success_clears_error` | After error, next save succeeds → error banner removed |
| W10 | `draft_hook_wired_onChange_persists_to_localStorage` | Type in editor → `localStorage` key `fieldNotes:{visitId}:{sessionId}` written |
| W11 | `draft_restored_on_remount` | `localStorage` has draft → editor pre-filled with draft, not server value |
| W12 | `conflict_banner_shown_when_draft_differs_from_server` | Draft in `localStorage` differs from `visit.fieldNotes` → conflict UI shown with "Keep local" / "Use server" buttons |
| W13 | `conflict_keep_local_calls_save_and_hides_banner` | Click "Keep local" → `saveFieldNotes` called, conflict banner hidden |
| W14 | `conflict_use_server_discards_draft` | Click "Use server" → `localStorage` cleared, editor content matches server |
| W15 | `history_section_renders_after_fetch` | `fetchNotesHistory` returns 3 entries → `<NotesHistory>` renders 3 items |
| W16 | `history_section_empty_state` | `fetchNotesHistory` returns 0 entries → "No edit history" shown |
| W17 | `history_fetch_error_shows_graceful_fallback` | `fetchNotesHistory` rejects → history section hidden, no crash |
| W18 | `complete_dialog_textarea_replaced_by_rich_editor` | Open complete dialog → `<VisitFieldNotes>` rendered instead of `<textarea>` |
| W19 | `complete_dialog_flushes_draft_before_completing` | Unsaved draft exists → completing calls `flushDraft` before `completeVisit` |
| W20 | `complete_dialog_flush_failure_shows_warning` | `flushDraft` returns false → warning shown, complete not called yet |
| W21 | `complete_dialog_flush_failure_retry_succeeds` | Warning shown → click retry → flush succeeds → complete proceeds |
| W22 | `complete_dialog_flush_failure_discard_and_complete` | Warning shown → click "Discard & Complete" → `completeVisit` called without draft |
| W23 | `session_id_stable_across_rerenders` | Multiple renders → same `sessionId` used (not regenerated) |
| W24 | `session_id_changes_on_fresh_page_load` | Component unmounts/remounts from scratch → new `sessionId` generated |
| W25 | `editor_not_rendered_during_loading_state` | While `getVisit` is pending → no editor, spinner shown |
| W26 | `editor_not_rendered_on_error_state` | `getVisit` rejects → no editor, error state shown |
| W27 | `char_count_visible_for_planned_visit` | Planned visit → character count footer visible |
| W28 | `char_count_visible_for_completed_visit` | Completed visit → character count footer visible |
| W29 | `disconnected_state_disables_save` | NATS disconnected → save button disabled or absent |
| W30 | `history_refetched_after_save` | After successful save → `fetchNotesHistory` called again to refresh |
| W31 | `rescheduled_visit_matches_status_matrix` | `status: 'rescheduled'` → notes editor is editable; complete form hidden |
| W32 | `cancelled_visit_matches_status_matrix` | `status: 'cancelled'` → notes editor is editable; complete form hidden |
| W33 | `main_and_complete_dialog_share_sessionId` | Main card and complete dialog both use the same `sessionId` prop/value for `useFieldNotesDraft` / `saveFieldNotes` |
| W34 | `complete_dialog_prefills_from_shared_fieldNotes_state` | User edits main editor → opens complete dialog → complete editor shows same markdown (no stale fork) |
| W35 | `no_duplicate_conflicting_fieldNotes_state` | Completing visit sends `fieldNotes` consistent with shared state (not a second hidden `useState` that diverged) |
| W36 | `conflict_ux_when_server_empty_local_nonempty` | Follows locked conflict behavior: prompt with `Keep local` / `Use server` / `Compare`, no silent overwrite |
| W37 | `stale_server_after_refetch_does_not_silently_wipe_draft` | Simulated second `loadVisit` with new `fieldNotes` while draft exists → user sees conflict or merge per chosen strategy (no silent data loss) |
| W38 | `autosave_uses_1500ms_debounce` | User types notes → `saveFieldNotes` fires after exactly `1500ms` idle (fake timers) |
| W39 | `autosave_failure_shows_warning_and_starts_backoff` | Save reject → non-blocking warning shown + retry schedule starts |
| W40 | `manual_retry_triggers_immediate_save` | Click `Retry now` bypasses waiting timer and calls `saveFieldNotes` immediately |
| W41 | `autosave_success_clears_warning_and_resets_backoff` | Successful retry/save clears warning state and resets retry interval to first step |

#### W1b — GREEN

- Import `VisitFieldNotes`, `NotesHistory`, `useFieldNotesDraft`, `saveFieldNotes`, `fetchNotesHistory` into `VisitDetail.tsx`.
- Generate a stable `sessionId` (UUID v4) on mount via `useRef` + `useMemo`.
- Add a "Field Notes" card section between the basic-info card and the timeline card.
  - For all statuses (`planned`, `in_progress`, `completed`, `cancelled`, `rescheduled`): render editable `<VisitFieldNotes>` wired to `useFieldNotesDraft` for `onChange`, `onSave`.
- Show conflict banner above editor when `hasConflict` is true, with "Keep local" / "Use server" buttons wired to `resolveKeepLocal` / `resolveUseServer`.
- Add a collapsible "Edit history" section below the editor with `<NotesHistory>` populated from `fetchNotesHistory`.
- Replace the `<textarea>` in the complete dialog with `<VisitFieldNotes>`.
- Wire flush-before-complete logic: on "Complete" click → `flushDraft()` → if true, proceed with `completeVisit`; if false, show warning dialog with Retry / Discard & Complete / Cancel.
- On save success, re-fetch notes history.
- Implement autosave with `1500ms` debounce.
- Implement Strategy C on autosave failures: non-blocking warning + exponential backoff retries + manual `Retry now`.

#### W1c — REFACTOR

- All 41 W-tests green.
- Extract `useSessionId` helper if used in more than one place.
- Remove the `completeNotes` state variable (replaced by editor content).
- Clean up unused `<textarea>` styles.

---

### Phase W2: VisitDetailDialog — rich editor in timeline dialog

The dialog opened from `CustomerTimeline` when clicking a visit.

#### W2a — RED

**Test file:** `apps/web/src/components/timeline/__tests__/VisitDetailDialog.fieldNotes.test.tsx`

| # | Test name | What it verifies |
|---|-----------|-----------------|
| VD1 | `completed_visit_shows_editable_rich_notes` | Completed visit with `fieldNotes: '**bold**'` → editable rich editor rendered |
| VD2 | `completed_visit_no_notes_shows_empty_editor` | Completed visit with `fieldNotes: null` → empty editable editor shown |
| VD3 | `complete_form_shows_rich_editor` | Click "Mark complete" → `<VisitFieldNotes>` shown instead of `<textarea>` |
| VD4 | `complete_form_editor_starts_empty` | Editor starts with empty content when visit has no prior notes |
| VD5 | `complete_form_editor_prefilled` | Visit has existing `fieldNotes` → editor pre-filled |
| VD6 | `complete_sends_fieldNotes_from_editor` | Type in editor + confirm → `completeVisit` called with markdown from editor |
| VD7 | `complete_sends_undefined_fieldNotes_when_empty` | Editor left empty → `completeVisit` called with `fieldNotes: undefined` |
| VD8 | `editor_disabled_while_submitting` | During submission → editor is `readOnly` |
| VD9 | `cancel_complete_hides_editor` | Click cancel in complete form → editor hidden, "Mark complete" button visible again |
| VD10 | `editor_shown_for_cancelled_visit_no_complete_form` | Cancelled visit → editable notes editor present, complete form hidden |
| VD11 | `planned_visit_shows_no_notes_section_until_complete` | Planned visit before clicking "Mark complete" → no editor in the non-complete body |
| VD12 | `dialog_close_does_not_crash_with_active_editor` | Editor is open → click overlay close → dialog closes cleanly, no console errors |
| VD13 | `rescheduled_visit_matches_status_matrix` | `status: 'rescheduled'` → editable notes editor present, complete form hidden |
| VD14 | `cancelled_visit_matches_status_matrix` | `status: 'cancelled'` → editable notes editor present, complete form hidden |

#### W2b — GREEN

- Replace the `<textarea>` at line ~257 of `VisitDetailDialog.tsx` with `<VisitFieldNotes>`.
- Replace plain `{visit.fieldNotes}` paragraph with `<VisitFieldNotes initialContent={visit.fieldNotes ?? ''} visitId={visit.id}>` (editable for all statuses with access).
- Wire the editor's `onChange` callback to update `completeData.fieldNotes`.
- Set `readOnly` on the editor while `isSubmitting` is true.
- Remove the `<textarea>` element entirely.

#### W2c — REFACTOR

- All 14 VD-tests green.
- Remove unused `textarea` CSS rules from `VisitDetailDialog.module.css`.
- Verify no `<textarea>` remains in the component.

---

### Phase W3: CustomerTimeline — markdown-stripped excerpt

A compact surface — no editor, just plain-text excerpt with markdown stripped.

#### W3a — RED

**Test file:** `apps/web/src/components/timeline/__tests__/CustomerTimeline.fieldNotes.test.tsx`

| # | Test name | What it verifies |
|---|-----------|-----------------|
| CT1 | `visit_with_markdown_notes_shows_plain_text` | Visit with `fieldNotes: '**bold** and *italic*'` → timeline card text reads "bold and italic" |
| CT2 | `visit_with_null_notes_shows_no_text` | Visit with `fieldNotes: null` → no notes paragraph rendered |
| CT3 | `visit_with_empty_string_notes_shows_no_text` | Visit with `fieldNotes: ''` → no notes paragraph |
| CT4 | `long_notes_truncated_in_timeline` | Visit with 500-char fieldNotes → text clamped (CSS or JS truncation) |
| CT5 | `html_entities_in_notes_not_rendered_as_html` | `fieldNotes: '<script>alert(1)</script>'` → rendered as escaped text, no XSS |
| CT6 | `multiline_markdown_collapsed_to_single_line` | `fieldNotes: '# Heading\n\nParagraph'` → single-line "Heading Paragraph" |
| CT7 | `whitespace_only_notes_hidden` | `fieldNotes: '   \n\t'` → after strip + trim, no notes paragraph (or single space — document expected) |

#### W3b — GREEN

- Import `stripMarkdown` into `CustomerTimeline.tsx`.
- Replace `{visit.fieldNotes}` (line ~306) with `{stripMarkdown(visit.fieldNotes ?? '')}`.
- Guard rendering with `visit.fieldNotes?.trim()` to avoid empty paragraphs.

#### W3c — REFACTOR

- All 7 CT-tests green.
- Verify no raw `visit.fieldNotes` rendering remains in the component.

---

### Phase W4: CustomerDetail page — markdown-stripped aggregation

Another compact surface — aggregates visit + work-item notes.

#### W4a — RED

**Test file:** `apps/web/src/pages/__tests__/CustomerDetail.fieldNotes.test.tsx`

| # | Test name | What it verifies |
|---|-----------|-----------------|
| CDN1 | `aggregated_notes_strips_markdown_from_fieldNotes` | Visit with `fieldNotes: '**Important**'` → aggregated notes contain "Important" not "**Important**" |
| CDN2 | `null_fieldNotes_excluded_from_aggregation` | Visit with `fieldNotes: null` → only work-item notes appear |
| CDN3 | `empty_fieldNotes_excluded_from_aggregation` | Visit with `fieldNotes: ''` → not pushed to `allNotes` |
| CDN4 | `work_item_resultNotes_not_stripped` | Work item `resultNotes: 'plain text'` → appears verbatim (no markdown stripping needed for plain text) |
| CDN5 | `mixed_visit_and_work_item_notes` | Visit has fieldNotes + 2 work items with notes → all three appear in order |
| CDN6 | `fallback_path_strips_markdown_too` | `getVisit` fails, fallback to `visit.fieldNotes` → stripped markdown |

#### W4b — GREEN

- Import `stripMarkdown` into `CustomerDetail.tsx`.
- Wrap `full.visit.fieldNotes` with `stripMarkdown()` before pushing to `allNotes` (line ~99).
- In the catch fallback (line ~107), wrap `visit.fieldNotes` with `stripMarkdown()`.
- Guard both with `?.trim()` to skip empty strings.

#### W4c — REFACTOR

- All 6 CDN-tests green.
- Verify no raw markdown `fieldNotes` is pushed to `allNotes`.

---

### Phase W5: Integration smoke tests + edge cases

Cross-cutting concerns that span multiple surfaces.

#### W5a — RED

**Test file:** `apps/web/src/__tests__/fieldNotesIntegration.test.ts`

| # | Test name | What it verifies |
|---|-----------|-----------------|
| INT1 | `sessionId_uuid_format` | Generated `sessionId` matches UUID v4 regex |
| INT2 | `localStorage_key_format_matches_hook` | Key format `fieldNotes:{visitId}:{sessionId}` consistent between page and hook |
| INT3 | `saveFieldNotes_payload_shape` | Payload sent to NATS matches `UpdateFieldNotesRequest` interface exactly |
| INT4 | `fetchNotesHistory_payload_shape` | Payload sent to NATS matches `ListNotesHistoryRequest` interface exactly |
| INT5 | `concurrent_saves_serialized` | Two rapid saves → second waits for first to complete (no race condition) |
| INT6 | `very_long_content_truncated_at_10000` | Typing past 10,000 chars → character count extension blocks further input |
| INT7 | `empty_content_save_sends_empty_string` | Saving with empty editor → `fieldNotes: ''` sent (not `null` or `undefined`) |
| INT8 | `special_characters_roundtrip` | Content with `<>&"'` → survives html→markdown→html roundtrip |
| INT9 | `unicode_content_preserved` | Czech text "Příliš žluťoučký kůň" → preserved through all layers |
| INT10 | `stripMarkdown_called_only_on_compact_surfaces` | `VisitDetail` editor receives raw markdown, `CustomerTimeline` receives stripped |
| INT11 | `no_editor_import_in_compact_surfaces` | `CustomerTimeline.tsx` and `CustomerDetail.tsx` do NOT import `VisitFieldNotes` (keeps bundle small) |
| INT12 | `history_entries_sorted_by_lastEditedAt_desc` | `fetchNotesHistory` returns entries in chronological order → `NotesHistory` renders them as-is |
| INT13 | `save_success_updates_in_memory_visit_fieldNotes` | After `saveFieldNotes` resolves, page state `visit.fieldNotes` matches `response.payload.fieldNotes` (server normalization) |
| INT14 | `concurrent_saves_use_documented_strategy` | INT5 satisfied via **one** of: in-flight mutex, promise queue, or disabled Save until prior completes — document which in code comment + test observes no overlapping `saveFieldNotes` calls |
| INT15 | `localStorage_quota_exceeded_no_uncaught_throw` | Mock `setItem` to throw `QuotaExceededError` → page still renders, editor usable |
| INT16 | `sessionId_generation_fallback_without_randomUUID` | Stub `crypto.randomUUID` missing → fallback still produces string matching UUID v4 regex (INT1) |
| INT17 | `storage_disabled_no_uncaught_throw` | Mock `localStorage` to throw on all ops → no uncaught exception from draft wiring |
| INT18 | `whitespace_only_fieldNotes_persistence` | Editor content only spaces/newlines → save behavior explicit (`''` vs strip — match backend) |
| INT19 | `autosave_debounce_exact_1500ms` | Fake timers confirm no save before `1499ms`, save occurs at/after `1500ms` idle |
| INT20 | `autosave_strategy_c_backoff_schedule` | Save failures trigger retries at configured exponential intervals up to cap |
| INT21 | `manual_retry_now_bypasses_backoff_timer` | `Retry now` immediately triggers save attempt regardless of pending timer |
| INT22 | `autosave_warning_clears_after_successful_retry` | Warning UI disappears after a successful retry/save |
| INT23 | `retry_loop_stops_after_unmount_or_sync` | No leaked timers/retries once component unmounts or draft becomes synced |

**Note:** INT5 is the user-visible guarantee; **INT14** is the concrete strategy (mutex, queue, or disabled Save) that satisfies INT5 — implement once, assert both if redundancy is acceptable.

#### W5b — GREEN

- Fix any issues found by the integration tests.
- Ensure `sessionId` generation uses `crypto.randomUUID()` with fallback.
- Ensure the character count extension on the editor actually blocks at 10,000.
- Implement **INT14** strategy (mutex or queue); add a one-line comment at the save call site.
- Implement Strategy C retry flow (INT20–INT23) with deterministic timer behavior for tests.
- Run **Vitest coverage** on wiring files; meet thresholds from “Coverage measurement” subsection (≥90% lines / ≥85% branches where practical).

#### W5c — REFACTOR

- All 23 INT-tests green.
- Full test suite green.
- No unused imports across all modified files.
- `cargo clippy` clean (no new warnings).

---

### Execution order and commits

| Commit | Phase | Tests | Files modified |
|--------|-------|-------|----------------|
| 1 | W1a+W1b+W1c | W1–W41 (41) | `VisitDetail.tsx`, `VisitDetail.module.css` |
| 2 | W2a+W2b+W2c | VD1–VD14 (14) | `VisitDetailDialog.tsx`, `VisitDetailDialog.module.css` |
| 3 | W3a+W3b+W3c | CT1–CT7 (7) | `CustomerTimeline.tsx` |
| 4 | W4a+W4b+W4c | CDN1–CDN6 (6) | `CustomerDetail.tsx` |
| 5 | W5a+W5b+W5c | INT1–INT23 (23) | Cross-cutting fixes only |

### Coverage summary (wiring only)

| Module | IDs | Count | Target |
|--------|-----|-------|--------|
| VisitDetail page wiring | W1–W41 | 41 | 100% |
| VisitDetailDialog wiring | VD1–VD14 | 14 | 100% |
| CustomerTimeline wiring | CT1–CT7 | 7 | 100% |
| CustomerDetail wiring | CDN1–CDN6 | 6 | 100% |
| Integration + edge cases | INT1–INT23 | 23 | 100% |
| **Total (wiring)** | | **91** | **≥ 98%** (see also Vitest line/branch thresholds above) |

### Combined coverage (Phases 1–7 + wiring)

| Scope | Count |
|-------|-------|
| Phases 1–7 (building blocks) | 88 |
| Wiring (W1–W5) | 91 |
| **Grand total** | **179** |

---

## Unified Notes System — Architecture & Migration Plan

### Motivation

The codebase has 7 separate free-form text fields acting as "notes," each with its own storage column, editing surface, and (often incomplete) UI. Three of them (`work_item.result_notes`, `work_item.findings`, `revision.findings`) are semantically redundant — all describe "observations about a device during work." Several are only editable through completion forms, invisible during the actual visit.

This plan unifies all observational notes under a single journal-style system with:
- One rich Tiptap editor (reusing the building blocks from Phases 1–7)
- One versioning/audit trail
- One export file (`notes.csv`)
- Full accessibility — every note type visible and editable from every relevant context, not just completion forms

### Decisions (locked)

| # | Topic | Decision |
|---|-------|----------|
| N1 | Notes model | **Journal-style (Model B):** multiple note entries per entity, each with its own content and timestamp |
| N2 | Entity types | **Three:** `customer`, `device`, `visit` |
| N3 | Merge scope | `visit_work_items.result_notes` + `visit_work_items.findings` + `revisions.findings` → device note entries. `customers.notes` → customer note entries. `devices.notes` → device note entries. `visits.field_notes` → visit note entries. |
| N4 | Communications | **Stay separate.** Future CRM pipeline (email integration, threading, automation) requires a different data model. |
| N5 | Editor & versioning | Same Tiptap + markdown storage + session-level audit trail for all three note types |
| N6 | Accessibility | All customer/device/visit notes visible and editable from the visit context (during and after visit). Technician sees full history. |
| N7 | Export format | Raw markdown in CSV (lossless round-trip) |
| N8 | Export file | Single `notes.csv` in the ZIP (replaces embedding notes in parent entity CSVs) |
| N9 | Import file | Single `notes.csv` import processor; **idempotent** re-import — skip rows whose `(entity_type, entity_id, content, created_at)` already exists (not “first-non-empty-wins”; that phrase applied to an older `work_log.csv` row-merge idea, superseded by `notes.csv`) |
| N10 | Existing decisions | All decisions from the visit field notes plan (1–14) apply to the unified system: 10,000 char limit, no images, localStorage draft, session = browser tab, audit rows kept forever (never auto-purged; GDPR redaction per N13 anonymizes content but does **not** delete rows), etc. |
| N11 | Empty content policy | **Allowed:** `content: ''` is valid (supports clear-note behavior). Soft delete remains a separate action via `note.delete`. |
| N12 | Audit subject naming | **Only** `sazinka.note.audit` is exposed. Do not add `sazinka.note.history` alias. |
| N13 | GDPR audit policy | **Anonymize payloads:** on GDPR delete, redact `notes.content` and matching `notes_history.content` to `[GDPR-REDACTED]`; keep structural metadata (`timestamps`, `change_count`, linkage). |
| N14 | Compact projection fallback | If no note exists, projected entity fields (`Visit.fieldNotes`, `Customer.notes`, `Device.notes`) return **`null`** (not empty string). |
| N15 | Visit Detail multi-device layout | **Accordion** for device notes (mobile-friendly). One section per device, collapsible. |
| N16 | Migration 045 drop gate | **Time-gated only:** drop legacy columns/table after one full release cycle. Telemetry/legacy-read checks are recommended but not required blockers. |
| N17 | Note entry titles | **No titles.** Notes are content-only journal entries. Simpler model, zero friction for field technicians. Revisit if CRM evolution demands it. |

### Relationship to existing work

Phases 1–7 built **visit-specific** building blocks (Tiptap editor, draft hook, `visit_notes_history` table, NATS handlers). The wiring plan (W1–W5) connects those to the UI.

This unified plan **generalizes** that work:

| Existing piece | Becomes |
|----------------|---------|
| `visits.field_notes` column | Fully normalized — dropped in migration 045. All reads use `notes` table (latest entry per entity). |
| `visit_notes_history` table | Dropped in migration 045; replaced by universal `notes_history` table |
| `VisitFieldNotes` component | Renamed to generic `NoteEditor`; same Tiptap internals |
| `useFieldNotesDraft` hook | Generalized to accept any `entityType + entityId` |
| `saveFieldNotes` / `fetchNotesHistory` | Generalized to `saveNote` / `fetchNoteHistory` |
| Wiring plan W1–W5 | **Superseded** — replaced by the unified wiring phases below |

### Data model

#### New tables (migration 044)

```sql
-- Universal notes table (journal-style: many entries per entity)
CREATE TABLE notes (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type       VARCHAR(20) NOT NULL,  -- 'customer', 'device', 'visit'
    entity_id         UUID        NOT NULL,  -- FK to the parent entity
    visit_id          UUID        REFERENCES visits(id) ON DELETE SET NULL,
                                             -- which visit this note was created during (NULL for standalone notes)
    content           TEXT        NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ NULL,

    CONSTRAINT notes_content_max_length CHECK (length(content) <= 10000),
    CONSTRAINT notes_entity_type_valid CHECK (entity_type IN ('customer', 'device', 'visit'))
);

CREATE INDEX idx_notes_entity       ON notes(entity_type, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_notes_entity_all   ON notes(entity_type, entity_id);
CREATE INDEX idx_notes_user         ON notes(user_id);
CREATE INDEX idx_notes_visit        ON notes(visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX idx_notes_created      ON notes(created_at);

-- Universal audit trail (replaces visit_notes_history)
CREATE TABLE notes_history (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    note_id           UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    session_id        UUID        NOT NULL,
    edited_by_user_id UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content           TEXT        NOT NULL,
    first_edited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    change_count      INTEGER     NOT NULL DEFAULT 1,
    UNIQUE (note_id, session_id)
);

CREATE INDEX idx_notes_history_note      ON notes_history(note_id);
CREATE INDEX idx_notes_history_last_edit ON notes_history(last_edited_at);
```

#### Data migration (same migration 044)

```sql
-- 1. Migrate customers.notes → notes entries
INSERT INTO notes (user_id, entity_type, entity_id, content, created_at, updated_at)
SELECT user_id, 'customer', id, notes, created_at, updated_at
FROM customers
WHERE notes IS NOT NULL AND trim(notes) <> '';

-- 2. Migrate devices.notes → notes entries
INSERT INTO notes (user_id, entity_type, entity_id, content, created_at, updated_at)
SELECT d.user_id, 'device', d.id, d.notes, d.created_at, d.updated_at
FROM devices d
WHERE d.notes IS NOT NULL AND trim(d.notes) <> '';

-- 3. Migrate visits.field_notes → notes entries
INSERT INTO notes (user_id, entity_type, entity_id, visit_id, content, created_at, updated_at)
SELECT user_id, 'visit', id, id, field_notes, created_at, updated_at
FROM visits
WHERE field_notes IS NOT NULL AND trim(field_notes) <> '';

-- 4. Migrate visit_work_items.result_notes + findings → device note entries
--    Each work item becomes a note entry on its device; if the same device has multiple work items
--    in the same visit, there will be multiple note entries. Concatenate result_notes and findings
--    from each work item.
INSERT INTO notes (user_id, entity_type, entity_id, visit_id, content, created_at, updated_at)
SELECT
    v.user_id,
    'device',
    wi.device_id,
    wi.visit_id,
    substring(
        CASE
            WHEN wi.result_notes IS NOT NULL AND wi.findings IS NOT NULL
                THEN wi.result_notes || E'\n\n---\n\n' || wi.findings
            WHEN wi.result_notes IS NOT NULL THEN wi.result_notes
            ELSE wi.findings
        END
    FROM 1 FOR 10000),
    wi.created_at,
    wi.created_at
FROM visit_work_items wi
JOIN visits v ON v.id = wi.visit_id
WHERE wi.device_id IS NOT NULL
  AND (wi.result_notes IS NOT NULL OR wi.findings IS NOT NULL);

-- 5. Migrate revisions.findings → device note entries (only if not already covered by a work item)
INSERT INTO notes (user_id, entity_type, entity_id, content, created_at, updated_at)
SELECT
    r.user_id,
    'device',
    r.device_id,
    r.findings,
    r.created_at,
    r.updated_at
FROM revisions r
WHERE r.findings IS NOT NULL AND trim(r.findings) <> ''
  AND NOT EXISTS (
      SELECT 1 FROM visit_work_items wi
      WHERE wi.revision_id = r.id
        AND (wi.result_notes IS NOT NULL OR wi.findings IS NOT NULL)
  );

-- 6. Migrate visit_notes_history → notes_history
INSERT INTO notes_history (note_id, session_id, edited_by_user_id, content, first_edited_at, last_edited_at, change_count)
SELECT
    n.id,
    vnh.session_id,
    vnh.edited_by_user_id,
    vnh.field_notes,
    vnh.first_edited_at,
    vnh.last_edited_at,
    vnh.change_count
FROM visit_notes_history vnh
JOIN notes n ON n.entity_type = 'visit' AND n.entity_id = vnh.visit_id;
```

#### Migration edge cases (document + test)

| Case | Expected behavior |
|------|-------------------|
| `visit_notes_history` row exists but `visits.field_notes` was empty / trimmed | No matching row in step 3 → step 6 inserts **nothing** for that audit row (orphan history). Acceptable rare edge case; optional one-time cleanup script or log in migration report. |
| Step 3 creates visit note; step 6 maps multiple `visit_notes_history` sessions | Multiple `notes_history` rows for the **same** `note_id` (different `session_id`) — valid. |
| Work item with `device_id` NULL but has `result_notes` | Step 4 skips (`WHERE device_id IS NOT NULL`); data stays only on work item until UI migration — document. |
| Content over 10k after concatenation in step 4 | **Locked:** truncate to 10,000 chars during migration (`substring(..., 1, 10000)`) and record truncation count in migration report; test **UM6**. |

#### Deprecation of old columns (migration 045, separate commit)

Old columns (`customers.notes`, `devices.notes`, `visits.field_notes`, `visit_work_items.result_notes`, `visit_work_items.findings`, `revisions.findings`) and the `visit_notes_history` table are **dropped in migration 045** after one full release cycle (time gate).

**Normalization strategy:** Canonical data lives only in `notes`. No denormalized columns after migration 045.

**Two read patterns (both from `notes` only):**
1. **Journal / full history:** `note.list` (or SQL equivalent) — all rows for `(entity_type, entity_id)` ordered by `created_at` — used by Visit Detail, Device Detail, Customer workspace.
2. **Compact single string on embedded types:** For API responses that still expose one string (e.g. `Visit.fieldNotes`, `Customer.notes`, `Device.notes` for cards and backward compatibility), derive **the latest entry** by `created_at DESC LIMIT 1` **or** `NULL` if none. This is a **projection**, not a second source of truth — timeline/cards show “latest note body,” not a merge of all entries.

**Backend API changes:** Types and handlers updated so list/detail endpoints that need the journal call `note.list`; compact fields use the latest-entry projection only where the old contract required a single string.

### Implementation notes (incorporated from review)

| Topic | Decision |
|-------|----------|
| **Polymorphic `entity_id`** | No single FK in DB — enforce in handlers: `(entity_type, entity_id)` must resolve to a row the user owns. Tests: wrong-type UUID, cross-user access, non-existent id → contract errors. |
| **`updated_at` management** | No DB trigger — handlers set `updated_at = NOW()` explicitly in `UPDATE` statements (`note.update` and `note.delete` handlers). Consistent with existing codebase pattern. |
| **NATS naming** | `note.list` = journal for an entity; **`sazinka.note.audit`** is the only session-level audit subject for one `note_id` (no `note.history` alias). |
| **CSV transition** | Until migration 045 removes legacy columns, exports may include **both** `notes.csv` (canonical) **and** legacy `result_notes` / `findings` on `work_log.csv` / `revisions.csv`. Support docs: “Use `notes.csv` as source of truth; legacy columns are transitional.” Import path for new data: **`notes.csv` only**. |
| **`notes_history` after soft delete** | **Locked:** normal soft delete keeps audit rows unchanged. GDPR delete redacts note payloads in both `notes` and `notes_history` (`[GDPR-REDACTED]`), preserving structural metadata. |

### NATS subjects

| Subject | Purpose | Replaces |
|---------|---------|----------|
| `sazinka.note.create` | Create a new note entry | — |
| `sazinka.note.update` | Update note content (with audit) | `sazinka.visit.update_field_notes` |
| `sazinka.note.list` | List notes for an entity (`entity_type` + `entity_id`) | `sazinka.visit.notes.history` (partially) |
| `sazinka.note.audit` | Fetch session-level audit trail for a **specific** `note_id` | `sazinka.visit.notes.history` |
| `sazinka.note.delete` | Soft-delete a note entry (`deleted_at`) | — |

`sazinka.note.history` is intentionally not implemented.

**Delete semantics:** `deleted_at` on `notes` — **soft delete**; list queries exclude rows where `deleted_at IS NOT NULL`. `notes_history` rows remain for audit. On GDPR delete workflow, redact payloads (`notes.content`, `notes_history.content`) to `[GDPR-REDACTED]`.

Old visit-specific subjects (`sazinka.visit.update_field_notes`, `sazinka.visit.notes.history`) remain registered during transition but delegate to the new handlers internally.

### Shared types (TypeScript)

```typescript
type NoteEntityType = 'customer' | 'device' | 'visit';

interface Note {
  id: string;
  userId: string;
  entityType: NoteEntityType;
  entityId: string;
  visitId?: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

interface CreateNoteRequest {
  entityType: NoteEntityType;
  entityId: string;
  visitId?: string;
  sessionId: string;
  content: string;
}

interface UpdateNoteRequest {
  noteId: string;
  sessionId: string;
  content: string;
}

interface DeleteNoteRequest {
  noteId: string;
}

interface AuditNoteRequest {
  noteId: string;
}

interface ListNotesRequest {
  entityType: NoteEntityType;
  entityId: string;
}

interface ListNotesResponse {
  notes: Note[];
}

interface NoteHistoryEntry {
  id: string;
  noteId: string;
  sessionId: string;
  editedByUserId: string;
  content: string;
  firstEditedAt: string;
  lastEditedAt: string;
  changeCount: number;
}
```

### Export changes

#### `notes.csv` (new file in ZIP)

| Column | Description |
|--------|-------------|
| `entity_type` | `customer`, `device`, or `visit` |
| `entity_ref` | Human-readable ref: customer name/ICO, device serial/name, or visit `customer_ref + date` |
| `entity_id` | UUID (for machine re-import) |
| `visit_ref` | `customer_ref + date` of linked visit, if any; empty for standalone notes |
| `content` | Raw markdown |
| `created_at` | ISO 8601 |
| `updated_at` | ISO 8601 |

**Soft-deleted notes (`deleted_at IS NOT NULL`) are excluded from export.** Only active notes appear in `notes.csv`.

#### Removals from other CSVs

- `customers.csv`: drop `notes` column (moved to `notes.csv`)
- `devices.csv`: drop `notes` column (moved to `notes.csv`)
- `work_log.csv`: `result_notes` and `findings` columns **remain for work-item-level data during transition**; new device notes are only in `notes.csv`
- `revisions.csv`: `findings` column remains during transition

### Import changes

#### `notes.csv` import processor

New NATS subject: `sazinka.import.notes.submit`

CSV row struct:
```rust
struct CsvNoteRow {
    entity_type: String,            // 'customer', 'device', 'visit'
    entity_ref: String,             // resolved to UUID via existing ref resolvers
    entity_id: Option<String>,      // UUID for machine re-import; if present, used directly; otherwise falls back to entity_ref resolution
    content: String,                // markdown, max 10,000 chars
    visit_ref: Option<String>,      // optional visit linkage
    created_at: Option<String>,     // optional; defaults to NOW()
}
```

**Resolution and deduplication:**
- `entity_ref` is resolved to UUID using existing `resolve_customer_ref` / device serial lookup / visit date+customer lookup.
- **Duplicate detection:** Skip if an entry with the same `(entity_type, entity_id, content, created_at)` already exists in the `notes` table. This prevents re-importing the same note twice (safety for idempotent re-runs).
- **Import report:** Log skipped duplicates for user transparency.

#### "Download my data" (GDPR)

Automatically includes `notes.csv` since it uses the Export+ pipeline with all file types selected.

### UI changes

#### Visit Detail page (primary work surface)

The Visit Detail page becomes the technician's unified workspace during a visit. It shows:

1. **Visit notes** section — journal entries for this visit (`entity_type='visit'`)
2. **Customer notes** section — all note entries for this customer (`entity_type='customer'`), full history
3. **Device notes** per device — for each device in this visit's work items (`entity_type='device'`), all note entries, newest first
4. **"Add note" buttons** — create new note entry for visit, customer, or any device, all from this page

Device notes use an **accordion layout** (one section per device) for mobile compatibility.

Each section uses the same `NoteEditor` component (Tiptap), same `useNoteDraft` hook, same autosave behavior.

#### Device Detail page

Shows all device note entries (full journal), with visit date context. Editable. "Add note" button for standalone notes (not linked to a visit).

#### Customer Detail / CustomerWorkspace

Shows all customer note entries (full journal). Editable. "Add note" for standalone customer notes.

#### VisitDetailDialog (timeline)

For `completed`/`cancelled`/`rescheduled`: shows latest visit note entry + latest device note entries as **read-only excerpts** (the dialog is a compact view — not enough space for a full editor); includes a "View / Edit" link that navigates to the full Visit Detail page where notes are editable in all statuses. For `planned`/`in_progress`: editable via unified `NoteEditor` within the complete form. **Note:** the "editable in all statuses" policy applies on the Visit Detail page; the dialog is intentionally read-only for completed visits to keep it compact.

#### CustomerTimeline

Shows `stripMarkdown()` excerpt of latest visit note entry. No editor. No change to current compact behavior except data source changes from `visit.fieldNotes` to latest note entry.

#### WorkItemDetail

Remove separate `result_notes` and `findings` textareas from completion form. Instead, show **device note entries** for this device with `visit_id = current visit` (there may be more than one if multiple work items exist) or an "Add device note" action. The work item completion form focuses on `result` and `follow_up` — free-form observations live on the device note journal, not on the work item row.

### Bug fix (included)

`WorkLog.tsx` line ~254 sends `resultNotes` on completion, but `CompleteVisitRequest` expects `fieldNotes`. Fix: either wire correctly to `fieldNotes` or (with unified system) create a visit note entry on completion instead.

### Phases (TDD)

| Phase | Scope | Test IDs (prefix) | Count |
|-------|-------|-------------------|-------|
| U1 | DB migration 044 + data migration + Rust types | `UM1`–`UM21` | 21 | ✅ DONE |
| U2 | NATS handlers (`note.create/update/list/audit/delete`) | `NH1`–`NH26` | 26 | ✅ DONE |
| U3 | Shared TypeScript types + `noteService.ts` | `NT1`–`NT10` | 10 | ✅ DONE |
| U4 | `NoteEditor`, `useNoteDraft`, `NoteHistory` (generalized) | `NB1`–`NB18` | 18 | ✅ DONE |
| U5 | Visit Detail — unified workspace | `NV1`–`NV42` | 42 |
| U6 | Device Detail, Customer Detail/Workspace, VisitDetailDialog, CustomerTimeline | `NS1`–`NS28` | 28 |
| U7 | WorkItemDetail — device notes, no legacy textareas | `NW1`–`NW12` | 12 |
| U8 | Export `notes.csv`, legacy CSV changes | `NE1`–`NE15` | 15 |
| U9 | Import `notes.csv` + ref resolution | `NI1`–`NI14` | 14 |
| U10 | Cross-cutting integration (draft, autosave, conflict, GDPR, concurrent saves) | `NX1`–`NX24` | 24 |
| | **Total (unified notes)** | | **210** |

#### U1 — RED (`UM1`–`UM21`): migration & types

| ID | Test | What it verifies |
|----|------|------------------|
| UM1 | `migration_up_creates_notes_and_notes_history` | Tables + indexes exist |
| UM2 | `notes_content_over_10k_rejected` | CHECK constraint |
| UM3 | `notes_entity_type_enum_rejects_invalid` | CHECK on `entity_type` |
| UM4 | `migrate_customer_notes_non_empty` | Row in `notes` per customer with legacy text |
| UM5 | `migrate_device_notes_non_empty` | Row in `notes` per device with legacy text |
| UM6 | `migrate_work_item_concat_truncates_to_10000_and_reports` | Over-limit concat is truncated to 10,000 and logged in migration report |
| UM7 | `migrate_visit_field_notes_to_visit_entity` | `entity_type='visit'`, `visit_id` set |
| UM8 | `migrate_revision_findings_skips_when_work_item_has_notes` | NOT EXISTS branch |
| UM9 | `notes_history_unique_note_session` | UNIQUE `(note_id, session_id)` |
| UM10 | `foreign_key_notes_user_cascade` | User delete behavior documented |
| UM11 | `visit_notes_history_maps_only_when_visit_note_exists` | Orphan audit rows documented |
| UM12 | `multiple_work_items_same_device_multiple_notes` | One row per work item from step 4 |
| UM13 | `soft_delete_column_null_by_default` | `deleted_at` nullable |
| UM14 | `rust_types_serialize_note_entity_type` | serde round-trip |
| UM15 | `migration_idempotent_report` | Re-run safety or documented one-shot |
| UM16 | `empty_string_notes_skipped` | No row for trim-empty legacy |
| UM17 | `unicode_content_preserved_migration` | UTF-8 in content |
| UM18 | `sqlx_offline_metadata` | `cargo sqlx prepare` updated |
| UM19 | `visit_delete_sets_visit_id_null` | Deleting a visit sets `notes.visit_id = NULL` (ON DELETE SET NULL) |
| UM20 | `notes_history_edited_by_cascade` | Deleting a user cascades to `notes_history.edited_by_user_id` rows |
| UM21 | `partial_index_excludes_soft_deleted` | `idx_notes_entity` partial index only covers `deleted_at IS NULL` rows |

#### U2 — RED (`NH1`–`NH26`): handlers

| ID | Test | What it verifies |
|----|------|------------------|
| NH1 | `create_note_customer` | Valid payload → row |
| NH2 | `create_note_device_with_visit_id` | `visit_id` optional FK |
| NH3 | `create_note_visit` | `entity_type=visit` |
| NH4 | `create_rejects_wrong_user_entity` | Ownership |
| NH5 | `create_rejects_over_10k` | Length |
| NH6 | `update_note_content_audit` | `notes_history` upsert session |
| NH7 | `list_notes_excludes_deleted` | `deleted_at` filter |
| NH8 | `list_notes_orders_created_at` | Order |
| NH9 | `audit_returns_sessions_for_note` | `note.audit` |
| NH10 | `delete_soft_sets_deleted_at` | Not hard delete by default |
| NH11 | `polymorphic_invalid_entity_rejected` | Non-existent `entity_id` |
| NH12 | `polymorphic_entity_type_mismatch` | e.g. visit UUID with `entity_type=device` |
| NH13 | `jwt_missing_user_rejected` | |
| NH14 | `nats_reply_error_shape` | ErrorResponse contract |
| NH15 | `update_last_writer_wins_no_version` | Without a `version`/`etag` field, update uses last-writer-wins; test documents this behavior and stubs future optimistic locking |
| NH16 | `legacy_visit_update_field_notes_delegates` | Old subject calls new handler |
| NH17 | `legacy_visit_notes_history_delegates_to_audit` | |
| NH18 | `list_empty_entity_returns_empty_array` | |
| NH19 | `create_empty_string_content_allowed` | Backend accepts `content: ''`; used for clear-note behavior (not delete) |
| NH20 | `audit_note_not_found_404` | |
| NH21 | `delete_idempotent_second_call` | |
| NH22 | `note_belongs_to_other_user_forbidden` | |
| NH23 | `sql_injection_safe_entity_id` | Parameterized only |
| NH24 | `rate_limit_not_in_scope` | Document skip or stub |
| NH25 | `gdpr_delete_redacts_note_and_audit_payloads` | `notes.content` and `notes_history.content` become `[GDPR-REDACTED]`, metadata preserved |
| NH26 | `handler_no_unwrap_production` | `?` / `expect` with message |

#### U3 — RED (`NT1`–`NT10`): shared types + service

| ID | Test | What it verifies |
|----|------|------------------|
| NT1 | `CreateNoteRequest_matches_rust` | TS ↔ JSON |
| NT2 | `Note_deletedAt_optional` | Optional field |
| NT3 | `noteService_create_payload` | NATS subject + shape |
| NT4 | `noteService_list_entity` | |
| NT5 | `noteService_audit` | |
| NT6 | `noteService_delete` | |
| NT7 | `compact_projection_null_when_no_notes` | Service/types handle `null` for projected compact fields |
| NT8–NT10 | Retry / disconnect stubs | Align with existing `visitService` patterns |

#### U4 — RED (`NB1`–`NB18`): building blocks

| ID | Test | What it verifies |
|----|------|------------------|
| NB1 | `NoteEditor_renders_for_entity_type_customer` | |
| NB2 | `NoteEditor_device` | |
| NB3 | `NoteEditor_visit` | |
| NB4 | `useNoteDraft_key_includes_entity` | localStorage key |
| NB5 | `useNoteDraft_conflict_same_as_visit` | |
| NB6 | `NoteHistory_lists_audit_entries` | |
| NB7 | `max_length_10000_all_entities` | |
| NB8–NB18 | Autosave debounce, Strategy C, toolbar, read-only permission | Mirror prior VN/D tests generalized |

#### U5 — RED (`NV1`–`NV42`): Visit Detail workspace

Journal sections for visit + customer + device; Add note actions; latest projection for compact child if any; same coverage intent as superseded **W1–W41** plus multi-entity: **NV1–NV20** core render + save; **NV21–NV30** customer + device sections + multi-device; **NV31–NV42** conflict, refetch, offline, char count, status matrix (all statuses editable).

#### U6 — RED (`NS1`–`NS28`): other surfaces

Device Detail journal (**NS1**–**NS8**); Customer Detail / Workspace (**NS9**–**NS16**); VisitDetailDialog (**NS17**–**NS22**); CustomerTimeline excerpt from latest visit note (**NS23**–**NS28**).

#### U7 — RED (`NW1`–`NW12`): WorkItemDetail

No `result_notes`/`findings` textareas; device notes filtered by `visit_id`; multiple entries; complete still sends `result` / follow-up; **NW1**–**NW12** cover accessibility + regression.

#### U8 — RED (`NE1`–`NE15`): export

**NE1** `notes_csv_in_zip`; **NE2** raw markdown cells; **NE3** `entity_id` column; **NE4** `visit_ref`; **NE5** customers.csv without notes column; **NE6** devices.csv without notes; **NE7** GDPR bundle includes notes.csv; **NE8**–**NE14** escaping, semicolons in content, empty journal, large batch; **NE15** `soft_deleted_notes_excluded_from_export`.

#### U9 — RED (`NI1`–`NI14`): import

**NI1** idempotent duplicate skip; **NI2**–**NI4** ref resolution per entity type; **NI5** invalid ref error row; **NI6**–**NI14** report lines, charset, 10k reject, optional `created_at`.

#### U10 — RED (`NX1`–`NX24`): integration

**NX1**–**NX8** round-trip export→import; **NX9**–**NX14** concurrent saves / mutex; **NX15**–**NX20** localStorage draft keys per entity; **NX21**–**NX24** GDPR download + stripMarkdown on timeline only.

### Coverage measurement (unified notes)

- **Rust:** `cargo test` for migration + handlers; **`cargo clippy`** clean; aim for **high line coverage** on `handlers/note*.rs`, `db/queries/*note*`, `export_processor` / `import` note paths (target **≥90% lines** on new/changed modules where practical).
- **TypeScript:** Vitest on services, components, hooks — **≥90% lines**, **≥85% branches** on touched files (`noteService.ts`, `NoteEditor.tsx`, VisitDetail/Device/Customer wiring).
- **Coverage ≠ exhaustive E2E:** Manual browser flows (mobile, slow network) are out of scope for this plan; listed tests target **automated** near-complete **branch** coverage.

### Is test coverage “almost complete”?

**Yes, for the planned automated scope:** the **210** enumerated IDs cover migration edge cases (including FK cascade behaviors), polymorphic validation, soft delete, all three entity types, journal vs projection, export/import round-trip (including soft-delete exclusion), GDPR inclusion, and the superseded wiring scenarios (re-homed under U5–U7). **Residual gaps** (normal for any plan): full end-to-end browser automation, flaky-network chaos, and a11y/i18n deep passes — call these out in **REFACTOR** or a follow-up checklist, not as mandatory unit counts.

### Superseded plans

The **wiring plan (W1–W5, 91 tests)** is superseded by phases U5–U7 above, which cover the same surfaces but with the unified notes model. The **building block phases (1–7, 88 tests)** remain valid — the components they built are generalized, not discarded.

### Combined coverage (Phases 1–7 + wiring + unified notes)

| Scope | Count |
|-------|-------|
| Phases 1–7 (visit field notes building blocks) | 88 |
| Wiring W1–W5 (superseded by U5–U7; counts kept for archive) | 91 |
| **Unified notes U1–U10** | **210** |
| **Grand total (if all delivered)** | **389** (includes overlapping superseded wiring — see note below) |

**Note:** The **389** grand total **double-counts** the replaced wiring surface (91 tests) that U5–U7 replace. A cleaner **forward-looking** total is **88 + 210 + adjustment**: treat **Phases 1–7 (88) + Unified U1–U10 (210) = 298** as the **canonical** test count for “field notes + unified notes” once W1–W5 is abandoned; add **+91** only if you keep historical comparison to the old wiring plan.

All open questions have been resolved and locked as decisions N1–N17.

---

# "Show in Inbox" - Customer deep-link with top pin

## Goal

From Customer Detail (full page and side preview), user can jump to Inbox and land
with:

1. the target customer selected,
2. the target customer rendered at the top of the queue,
3. customer detail visible in the Inbox layout,
4. URL cleaned after consumption.

---

## Acceptance criteria (must pass)

1. Clicking "Show in Inbox" navigates to `/inbox?customerId=<id>`.
2. Inbox consumes `customerId`, updates selection state, persists it to session, and
   clears URL with `replace: true`.
3. Target customer is placed at row index 0 in queue order for this deep-link flow.
4. If target is not present in default top-100 slice, API still includes it.
5. If target is invalid/inaccessible, app does not crash; shows non-blocking warning.
6. Existing inbox behavior remains unchanged when `customerId` is not provided.

---

## Coverage target

- Changed-file line coverage: >= 95%
- New helper/mapper functions (`validateInboxSearch`, pinning helpers): 100%
- Branch coverage for all deep-link branches:
  - valid id
  - missing id
  - empty/invalid id
  - target included
  - target not found/inaccessible
  - regular (non deep-link) inbox path

---

## Architecture decisions

1. **Route query param**: `/inbox?customerId=...`, validated by exported helper
   `validateInboxSearch`.
2. **Backend include hook (mandatory)**:
   - Add `focusCustomerId?: string` to `InboxRequest`.
   - Add `focusedCustomerIncluded?: boolean` to `InboxResponse`.
   - Worker guarantees focused customer inclusion (if valid and accessible) even when
     normally outside current pagination slice.
3. **Top pin (mandatory)**:
   - Worker returns focused customer in response set.
   - Frontend applies deterministic "focused first" ordering for deep-link flow in
     `InboxListPanel` so target row is index 0.
4. **One-time consume**:
   - Deep-link focus is consumed once, then URL is cleaned.
   - Use `replace: true` to avoid polluting browser history.
5. **Security**:
   - Worker enforces user ownership (`user_id` scoping) for `focusCustomerId`.
   - Unknown or foreign IDs set `focusedCustomerIncluded = false` with no data leak.

---

## Data contract changes

### Shared TS

- `packages/shared-types/src/inbox.ts`
  - `InboxRequest.focusCustomerId?: string`
  - `InboxResponse.focusedCustomerIncluded?: boolean`

### Worker Rust

- `worker/src/types/inbox.rs`
  - `InboxRequest.focus_customer_id: Option<Uuid>`
  - `InboxResponse.focused_customer_included: Option<bool>` (or non-optional bool if
    safe to migrate broadly)

---

## Phase 1 - Route search validation helper

### Scope

- New file: `apps/web/src/routes/inboxSearch.ts`
  - Export `validateInboxSearch(raw: Record<string, unknown>)`.
- Wire helper in `apps/web/src/routes/index.tsx` via `validateSearch` for `/inbox`.

### Normalization rules

- Keep `customerId` only if non-empty string after trim.
- Drop non-string or empty values.
- Return only supported search keys.

### Tests (RED -> GREEN)

**File:** `apps/web/src/routes/__tests__/inboxSearch.test.ts`

| ID | Test | Asserts |
|----|------|---------|
| R1-1 | Empty object | Returns `{}` |
| R1-2 | Valid string id | Returns `{ customerId }` |
| R1-3 | Non-string id | Returns `{}` |
| R1-4 | Empty string id | Returns `{}` |
| R1-5 | Whitespace id | Returns `{}` |
| R1-6 | Trims valid id with spaces | Returns trimmed `customerId` |

**Count: 6 tests**

---

## Phase 2 - Customer entry points (header + preview) and i18n

### Scope

- `apps/web/src/components/customers/CustomerHeader.tsx`
  - Add `Link` to `/inbox` with `search={{ customerId: customer.id }}`.
- `apps/web/src/components/customers/CustomerPreviewPanel.tsx`
  - Add same action in bottom action bar.
- Locale key (single shared key):
  - `apps/web/public/locales/{en,cs,sk}/customers.json`
  - `action_show_in_inbox`

### Tests (RED -> GREEN)

**Header file:** `apps/web/src/components/customers/__tests__/CustomerHeader.test.tsx`

| ID | Test | Asserts |
|----|------|---------|
| H2-1 | Renders action | "Show in Inbox" link exists |
| H2-2 | Link contains `customerId` query | `href` has `/inbox` + `customerId=` |
| H2-3 | Visible without coordinates | action still present |
| H2-4 | Visible for company customer | action still present |
| H2-5 | Action order in CTA group | `getAllByRole('link')` / `getAllByRole('button')` indexes: "Show in Inbox" appears after Add-to-plan and before Edit |

**Preview file:** `apps/web/src/components/customers/__tests__/CustomerPreviewPanel.test.tsx`

| ID | Test | Asserts |
|----|------|---------|
| P2-1 | Renders action when customer selected | link exists |
| P2-2 | Link contains `customerId` query | `href` includes `customerId` |
| P2-3 | Hidden in empty state | no link when `customer === null` |
| P2-4 | Coexists with edit/add actions | `getAllByRole` includes all expected actions; "Show in Inbox" index is consistent with header ordering |

**Locale key tests:** `apps/web/src/components/customers/__tests__/customersLocaleKeys.test.ts`

| ID | Test | Asserts |
|----|------|---------|
| L2-1 | EN key exists | `action_show_in_inbox` in `en/customers.json` |
| L2-2 | CS key exists | `action_show_in_inbox` in `cs/customers.json` |
| L2-3 | SK key exists | `action_show_in_inbox` in `sk/customers.json` |

**Count: 12 tests**

---

## Phase 3 - Inbox service transport contract

### Scope

- `apps/web/src/services/inboxService.ts`
  - Ensure `focusCustomerId` is forwarded in request payload.
- Shared type updates from "Data contract changes" are consumed by service tests.

### Tests (RED -> GREEN)

**File:** `apps/web/src/services/inboxService.focusCustomer.test.ts`

| ID | Test | Asserts |
|----|------|---------|
| S3-1 | Sends `focusCustomerId` when provided | outgoing payload contains `focusCustomerId` |
| S3-2 | Omits `focusCustomerId` when undefined | outgoing payload has no focus field |
| S3-3 | Handles response with `focusedCustomerIncluded=true` | parsed response preserves flag |
| S3-4 | Handles response with `focusedCustomerIncluded=false` | parsed response preserves false |
| S3-5 | Backward compatibility (flag absent) | does not throw, works with old payload |
| S3-6 | Error response path unchanged | still throws expected error |

**Count: 6 tests**

---

## Phase 4 - Worker inbox query: include and pin focused customer

### Scope

- `worker/src/types/inbox.rs`
- `worker/src/db/queries/planned_action.rs`
- `worker/src/handlers/inbox.rs` (only if serialization glue needed)

### Implementation rules

1. If `focus_customer_id` is provided:
   - verify customer belongs to authenticated user and is not anonymized/abandoned.
   - ensure focused customer row is present in result set (inject if needed).
2. Return `focused_customer_included = true` only when focus row is actually included.
3. Apply ordering:
   - focused row first,
   - remaining rows keep normal scoring order.
4. Preserve limit behavior for remaining rows:
   - final payload size should remain deterministic (focused row + top N-1 others when
     focused row is outside first N).

### Testability strategy

The existing tests in `planned_action.rs` are pure unit tests against
`build_inbox_sql_parts` (SQL string assertions). The new focus-pin logic involves
**post-query reordering and injection** which runs _after_ `sqlx::query_as` — this
cannot be tested against the SQL builder alone.

**Required approach:** Extract the focus-pin logic into a **pure function**:

```rust
pub fn apply_focus_pin(
    items: Vec<InboxItem>,
    focus_id: Option<Uuid>,
    limit: usize,
) -> (Vec<InboxItem>, bool)
```

Returns `(reordered_items, focused_customer_included)`. This function:
- finds and moves the focused row to index 0,
- trims the result to `limit` (keeping focus + top N-1 others),
- returns `false` if the focus ID was not found in the full set.

Tests W4-1 through W4-11 target this pure function with in-memory `InboxItem`
fixtures. W4-12 targets the handler response shape (can use a mock or the existing
handler test pattern).

### Tests (RED -> GREEN)

**File:** `worker/src/db/queries/planned_action.rs` (extend `#[cfg(test)] mod tests`)
— tests call `apply_focus_pin` with synthetic `Vec<InboxItem>` fixtures

| ID | Test | Asserts |
|----|------|---------|
| W4-1 | No focus id | baseline behavior unchanged |
| W4-2 | Focus id already in top slice | `focused_customer_included=true`, row index 0 |
| W4-3 | Focus id outside top slice | row injected, index 0, size remains at limit |
| W4-4 | Remaining rows keep score order | ordering after index 0 equals baseline order |
| W4-5 | Invalid UUID / missing customer | `focused_customer_included=false`, no panic |
| W4-6 | Foreign user customer id | `focused_customer_included=false`, no data leak |
| W4-7 | Abandoned/anonymized focused customer | not included, flag false |
| W4-8 | Limit edge: limit=1 with focused id | only focused row returned |
| W4-9 | Limit edge: limit=1 without focused match | baseline top row returned |
| W4-10 | Offset baseline path unchanged without focus | existing offset behavior preserved |
| W4-11 | Focus + offset path deterministic | defined behavior documented and asserted |
| W4-12 | Response serialization includes focus flag | handler returns expected payload shape |

**Count: 12 tests**

---

## Phase 5 - PlanningInbox deep-link consume and URL cleanup

### Scope

- `apps/web/src/pages/PlanningInbox.tsx`
  - Read validated `customerId` from route search.
  - Set selected customer.
  - Persist to `sessionStorage`.
  - Trigger one-time focus handoff for inbox fetch (via dedicated session key or prop).
  - Cleanup URL with `replace: true`.

### Test harness guidance

- Fix breakpoint in tests (mock `useBreakpoint`) to avoid layout ambiguity.
- In StrictMode, avoid brittle "exactly once" assertions unless deduping with ref.
- Assert deterministic outputs directly: selection state, session keys, navigation args.

### Tests (RED -> GREEN)

**File:** `apps/web/src/pages/__tests__/PlanningInbox.deepLink.test.tsx`

| ID | Test | Asserts |
|----|------|---------|
| PI5-1 | Search has `customerId` | selected id set to target |
| PI5-2 | URL cleanup executes | navigate called with `replace: true` and cleared search |
| PI5-3 | Session selected key updated | `planningInbox.selectedId` equals target |
| PI5-4 | Focus handoff key set | focus key stored for inbox fetch |
| PI5-5 | Missing `customerId` | falls back to existing session selected id |
| PI5-6 | Query id overrides prior session selected id | selected/focus use query id |
| PI5-7 | Empty/invalid defensive path | no crash, fallback behavior |
| PI5-8 | One-time consume behavior | no repeated cleanup/focus handoff loops |

**Count: 8 tests**

---

## Phase 6 - InboxListPanel focused fetch and top pin

### Scope

- `apps/web/src/panels/InboxListPanel.tsx`
  - Include `focusCustomerId` in first `getInbox` call when deep-link focus exists.
  - Apply deterministic "focused first" ordering in final rendered candidate list.
  - Clear one-time focus handoff after first successful load.
  - If API returns `focusedCustomerIncluded=false`, show non-blocking inline warning.

### Adapter layer note

`InboxListPanel.loadCandidates` currently passes `InboxResponse` through
`inboxResponseToCallQueueResponse` before storing as `rawCandidates`. The
`focusedCustomerIncluded` flag lives on `InboxResponse`, **not** on the adapted
`CallQueueResponse`. Implementation must capture the flag from the raw
`inboxResponse` **before** the adapter call:

```typescript
const inboxResponse = await getInbox({ ..., focusCustomerId });
const focusIncluded = inboxResponse.focusedCustomerIncluded ?? true;
const response = inboxResponseToCallQueueResponse(inboxResponse);
```

### Warning UI

No toast/notification system exists in the app. Use an **inline dismissible banner**
rendered between `InboxFilterBar` and `VirtualizedInboxList` inside
`InboxListPanelInner`, visible only when `focusedCustomerIncluded === false` after a
deep-link attempt. Style with existing `var(--color-warning)` / `AlertTriangle` icon
pattern (used in `PlanningInbox` for break warnings). The banner is dismissed
automatically on the next user action or filter change. Test IL6-5 asserts presence
of `[data-testid="focus-customer-warning"]`.

### Tests (RED -> GREEN)

**File:** `apps/web/src/panels/__tests__/InboxListPanel.focusCustomer.test.tsx`

| ID | Test | Asserts |
|----|------|---------|
| IL6-1 | First load sends `focusCustomerId` | `getInbox` called with focus field; `focusedCustomerIncluded` captured **before** adapter call |
| IL6-2 | Subsequent reload without new deep-link | focus field omitted after consume |
| IL6-3 | Focus included true -> row index 0 | target row rendered first |
| IL6-4 | Non-focused rows preserve relative sort | remainder order unchanged |
| IL6-5 | Focus included false | `[data-testid="focus-customer-warning"]` rendered, no crash, list shows remaining rows normally |
| IL6-6 | No deep-link path | list order remains baseline behavior |
| IL6-7 | Filters active after deep-link | target still visible and first |
| IL6-8 | Manual user selection later | does not permanently force pin for unrelated ids |
| IL6-9 | Selected detail visible when focused row present | detail pane/sheet bound to target |
| IL6-10 | Candidate count consistent with pin logic | counts stay deterministic |

**Count: 10 tests**

---

## Phase 7 - Mandatory router integration

### Scope

- Validate complete user flow through router wiring, not only static `href`.

### Tests (RED -> GREEN)

**File:** `apps/web/src/pages/__tests__/CustomerToInbox.router.test.tsx`

| ID | Test | Asserts |
|----|------|---------|
| RI7-1 | Click from `CustomerHeader` action | router location becomes `/inbox?customerId=<id>` |
| RI7-2 | Click from `CustomerPreviewPanel` action | router location contains same query |
| RI7-3 | Landing on `/inbox?customerId=<id>` | PlanningInbox consumes and cleans URL |
| RI7-4 | Full mocked flow | target row rendered at index 0 and selected detail visible |

**Count: 4 tests**

---

## Test summary

| Phase | Scope | Tests |
|-------|-------|-------|
| 1 | Route search validation | 6 |
| 2 | Customer entry points + i18n | 12 |
| 3 | Service transport contract | 6 |
| 4 | Worker include + pin logic | 12 |
| 5 | PlanningInbox consume + cleanup | 8 |
| 6 | InboxListPanel focused fetch + top pin | 10 |
| 7 | Router integration (mandatory) | 4 |
| **Total mandatory** | | **58** |

---

## Execution order

```
Phase 1 (route helper)
  -> Phase 3 (shared/service contract)
  -> Phase 4 (worker include+pin)
  -> Phase 5 (PlanningInbox consume)
  -> Phase 2 (Customer entry actions + i18n)
  -> Phase 6 (InboxListPanel focus/pin UI behavior)
  -> Phase 7 (router integration)
```

Dependencies:

- Phase 4 depends on Phase 3 contract.
- Phase 5 depends on Phase 1.
- Phase 6 depends on Phases 3, 4, and 5.
- Phase 7 runs last and validates full path end-to-end.
