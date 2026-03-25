# Persistence Gaps — Fix Plan

Audit performed 2026-02-23. All items below are state that resets on page navigation
or browser refresh, causing user friction.

---

## Priority 1 — High impact, quick fix

### P1-1: Plan page — `selectedRouteId` not persisted
**Page:** `/plan`
**Current:** When the user selects a route, navigates away, and returns, the selection
resets to the first route in the list.
**Fix:** Persist `selectedRouteId` to `sessionStorage` (or UPP session channel).
Restore on mount; fall back to first route if the saved ID is no longer in the list.
**Scope:** `Plan.tsx` — add sessionStorage read/write for the route ID.

### P1-2: Jobs page — tab filter not persisted
**Page:** `/jobs`
**Current:** The tab filter (`all | active | completed | failed`) resets to `all`
on every navigation.
**Fix:** Persist the active tab to `sessionStorage`.
**Scope:** `Jobs.tsx` — one `useState` + `useEffect` pair.

### P1-3: Calendar page — uses URL-only persistence (no sessionStorage/UPP)
**Page:** `/calendar`
**Current:** Filters persist via URL params, which is good for sharing. But
`currentDate` and `selectedDay` reset on navigation (they aren't in the URL).
**Fix:** Add `currentDate` to the URL params (or sessionStorage). Keep existing
URL-based filter persistence as-is.
**Scope:** `Calendar.tsx` — add `date` to URL sync effect.

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

---

## Priority 3 — Low impact, good to have

### P3-1: Customers page — `selectedCustomer` not persisted
**Page:** `/customers`
**Current:** Selecting a customer and navigating away loses the selection.
**Fix:** Persist to sessionStorage or URL param.

### P3-2: Plan page — `timelineView` not persisted
**Page:** `/plan`
**Current:** Timeline view mode resets on navigation.
**Fix:** Persist to sessionStorage.

### P3-3: Inbox — `isAdvancedFiltersOpen` panel state not persisted
**Page:** `/inbox`
**Current:** The advanced filters panel collapses on every navigation.
**Fix:** Persist to sessionStorage.

---

## Notes

- All sessionStorage persistence survives same-tab navigation but not new tabs/refresh.
  For cross-tab persistence, use localStorage or URL params.
- The UPP (Unified Persistence Platform) should be the preferred mechanism for new
  persistence work. Direct sessionStorage/localStorage is acceptable for simple cases.
- Each fix should follow TDD: RED test → GREEN implementation → update this plan.
