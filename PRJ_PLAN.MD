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
