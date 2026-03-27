# Known Bugs

## BUG-1: Plan page — depot and route segment lines not visible

**Reported:** 2026-03-10
**Status:** FIXED (2026-03-10)
**Page:** Plan (`/plan`)

**Steps to reproduce:**
1. Create a route with 3 stops in Inbox.
2. Navigate to the Plan page.
3. Select the route in the route list.

**Expected:** The map shows the depot marker, all stop markers, and route segment lines connecting them.
**Actual:** Stop markers (1, 2, 3) are visible on the map, but the depot marker and all route segment lines are missing.

**Root cause:** `Plan.tsx` never called `actions.setMapDepot()` to sync the depot coordinates into `PanelStateContext`. The map panel wrapper reads `state.mapDepot` and passes it as the `depot` prop to the UI component. Without it, no depot marker was rendered and the geometry fetch ran without depot coordinates, producing incomplete geometry.

**Fix:** Added a `useEffect` in `Plan.tsx` that syncs `selectedRouteDepot` to `actions.setMapDepot()`.

**Regression tests:**
- `Plan.mapBugs.test.tsx` — "BUG-1: syncs depot to PanelState (mapDepot) when a route is selected"
- `Plan.mapBugs.test.tsx` — "BUG-1: mapDepot includes depot name"
- `RouteMapPanel.test.tsx` (panels) — "forwards mapDepot as depot prop to the map UI component"
- `RouteMapPanel.test.tsx` (panels) — "includes depot in geometry fetch when mapDepot is set"

---

## BUG-2: Inbox — route segment lines disappear after returning from Plan

**Reported:** 2026-03-10
**Status:** FIXED (2026-03-10) — side effect of BUG-1
**Page:** Inbox (`/inbox`)

**Steps to reproduce:**
1. Create a route with 3 stops in Inbox (route lines visible).
2. Navigate to the Plan page.
3. Return to the Inbox page.

**Expected:** The map shows stop markers, depot marker, and route segment lines (same as before navigating away).
**Actual:** Stop markers and depot marker are visible, but route segment lines are missing.

**Root cause:** When navigating to the Plan page, the map panel wrapper's geometry fetch fired without depot coordinates (because BUG-1 meant `mapDepot` was never set from Plan). This produced geometry without depot legs that overwrote the correct geometry in `PanelStateContext`. When returning to Inbox, the context contained degraded geometry.

**Fix:** Resolved by fixing BUG-1. With depot properly synced, the wrapper's geometry fetch includes depot coordinates and produces correct geometry.

**Regression tests:** Covered by BUG-1 tests (depot sync ensures geometry fetch includes depot).

---

## BUG-3: Plan page — clicking timeline visits does not highlight stops on map

**Reported:** 2026-03-10
**Status:** FIXED (2026-03-10)
**Page:** Plan (`/plan`)

**Steps to reproduce:**
1. Open a route on the Plan page.
2. Click on a visit/stop card in the route timeline.

**Expected:** The corresponding stop marker on the map is highlighted (same behavior as in Inbox).
**Actual:** Nothing happens on the map. The stop is not highlighted.

**Root cause:** `Plan.tsx`'s `handleStopClick` only set the local `highlightedStopId` state (used by the timeline). It did not call `actions.selectCustomer()` to update `PanelStateContext.selectedCustomerId`, which is what the map panel wrapper reads to set `highlightedStopId` on the map UI component.

**Fix:** Added `actions.selectCustomer(customerId)` call to `handleStopClick` in `Plan.tsx`.

**Regression tests:**
- `Plan.mapBugs.test.tsx` — "BUG-3: clicking a stop in the timeline sets selectedCustomerId in PanelState"
- `RouteMapPanel.test.tsx` (panels) — "highlights stop when SELECT_CUSTOMER signal received"

---

## BUG-4: Route lines intermittently not visible after page load/reload

**Reported:** 2026-03-10
**Status:** FIXED (2026-03-10)
**Page:** Both Inbox (`/inbox`) and Plan (`/plan`)

**Steps to reproduce:**
1. Open Inbox or Plan page with an existing route.
2. Reload the page repeatedly.

**Expected:** Route segment lines are always visible on the map alongside stop markers.
**Actual:** In roughly 50% of reloads, stop markers appear but route segment lines do not render. No consistent pattern — same data, same page, different outcome on each reload.

**Root cause:** MapLibre's `isStyleLoaded()` returns false not only when the style definition isn't loaded, but also when any raster tile source is still fetching. The route rendering effect used `isStyleLoaded()` as a guard after the `load` event. When it returned false (tiles still loading), the code deferred rendering to a `map.once('style.load', ...)` callback. But `style.load` fires *before* `load` and never re-fires, so the deferred callback was permanently lost. Whether tiles were cached or not on each reload determined the ~50% success rate.

**Fix:** Removed the `isStyleLoaded()` guard and the `style.load` fallback entirely. The `mapLoaded` state (from the `load` event) already guarantees the map is ready to accept `addSource`/`addLayer` calls. Also removed a second `isStyleLoaded()` check in the insertion preview effect.

**Regression tests:**
- `RouteMapPanel.test.tsx` (component) — "BUG-4: renders route even when isStyleLoaded() returns false after load"

---

## BUG-5: Plan page — summary stats omit return-to-depot distance and travel time

**Reported:** 2026-03-10
**Status:** FIXED (2026-03-10)
**Page:** Plan (`/plan`)

**Steps to reproduce:**
1. Create a route with 3+ stops and a depot in Inbox (note total distance / driving time).
2. Navigate to the Plan page.
3. Select the same route.
4. Compare the summary bar values (VZDÁLENOST, JÍZDA) with the Inbox values.

**Expected:** Summary distance and driving time include the return-to-depot segment, matching the Inbox totals.
**Actual:** Summary shows ~10-15% lower distance and driving time because the last-stop → depot segment is omitted.

**Root cause:** `calculateMetrics()` in `Plan.tsx` sums per-stop `distanceFromPreviousKm` and `durationFromPreviousMinutes`, which cover depot→S1→S2→…→Sn but not the Sn→depot return leg. The return leg is stored in a separate `returnToDepotLeg` state that is never passed into `calculateMetrics()`. When per-stop sums are > 0, `calculateMetrics` prefers them over the `routeTotals` fallback (which would include the return), so the return leg is always lost.

**Fix:** Extracted `calculateMetrics()` to `utils/routeMetrics.ts` (pure function, zero React deps). Added a third parameter `returnToDepotLeg?: ReturnToDepotLeg | null` and added its distance/duration to the per-stop sums. Updated both call sites in `Plan.tsx` to pass the return leg.

**Regression tests:**
- `Plan.metrics.test.ts` — "includes return-to-depot distance in total"
- `Plan.metrics.test.ts` — "includes return-to-depot travel time in driving total"
- `Plan.metrics.test.ts` — "works without return-to-depot (null)"
- `Plan.metrics.test.ts` — "works without return-to-depot (undefined / not passed)"
- `Plan.metrics.test.ts` — "handles return leg with null distance/duration"
- `Plan.metrics.test.ts` — "return leg affects loadPercent (9h working day baseline)"

---

## BUG-6: Plan page — date filter resets to today on navigation away and back

**Reported:** 2026-03-11
**Status:** FIXED (2026-03-11)
**Page:** Plan (`/plan`)

**Steps to reproduce:**
1. Open the Plan page and select date 2026-03-21. A planned route appears in the list.
2. Navigate to the Inbox page (or any other page).
3. Return to the Plan page.

**Expected:** The date filter shows 2026-03-21 (the last selected date). The route is visible.
**Actual:** The date filter resets to today (2026-03-24). The route for 2026-03-21 is not visible.

**Root cause:** `Plan.tsx` initializes `dateFrom` from `searchParams?.date || today`. When the user selects a date, `handleDateFromChange` writes it to the URL (`?date=2026-03-21`). But when navigating to another page, the URL changes to that page's path. On return, the Plan component re-mounts and `searchParams?.date` is `undefined` (no URL param), so it falls back to `today`. The crew and depot filters had the same issue.

**Fix:** Added `sessionStorage` persistence for Plan filter state (`plan.filters` key). On mount, the initialization chain is `URL param > sessionStorage > today`. A `useEffect` writes `{dateFrom, crewId, depotId}` to `sessionStorage` whenever any filter changes, so the state survives navigation.

**Regression tests:**
- `Plan.persistenceV2.test.tsx` — "BUG-FIX: dateFrom survives unmount and re-mount (nav away and back)"
- `Plan.persistenceV2.test.tsx` — "BUG-FIX: crew filter survives unmount and re-mount"
- `Plan.persistenceV2.test.tsx` — "BUG-FIX: depot filter survives unmount and re-mount"
- `Plan.persistenceV2.test.tsx` — "BUG-FIX: URL param takes precedence over sessionStorage on return"

---

## BUG-7: Inbox — checkboxes on candidate cards cannot be toggled

**Reported:** 2026-02-23
**Status:** FIXED (2026-02-23)
**Page:** Inbox (`/inbox`)

**Steps to reproduce:**
1. Open the Inbox page with candidates in the queue.
2. Start route building (selection mode is active, checkboxes visible).
3. Click the checkbox on any candidate card.

**Expected:** The checkbox toggles on/off, the candidate is added to / removed from the batch selection.
**Actual:** The checkbox does not respond to clicks. It is not possible to select multiple candidates.

**Root cause:** `handleSelectionChange` in `PlanningInboxInner` validated the clicked candidate by looking it up in `sortedCandidatesRef.current` — a ref populated from `PlanningInboxInner`'s own `candidates` state. However, the displayed candidate list comes from `InboxListPanel`, which fetches and manages candidates **independently** via its own `getInbox()` pipeline. Because `InboxListPanel` is rendered without a `candidates` prop (line 3220), it uses its own internal data, while `sortedCandidatesRef` stayed empty (or stale). Every checkbox toggle was silently rejected by the guard `if (!candidate || !hasValidAddress(candidate)) return`.

Runtime evidence (console logs):
- Before fix: `handleSelectionChange { candidateFound: false, refLength: 0 }` → REJECTED
- After fix: `setSelectedIds { prevSize: 0, nextSize: 1 }` → checkbox toggles

**Fix (two parts):**
1. Removed the broken `sortedCandidatesRef` lookup guard from `handleSelectionChange`. The `disableCheckbox: !validAddress` property on `CandidateRowData` already disables the HTML checkbox element for invalid-address candidates, making the guard redundant.
2. Replaced the `<button>` wrapper in `CandidateRow` with `<div role="button" tabIndex={0}>` to comply with the HTML spec (interactive content must not be nested inside `<button>`).

**Regression tests:**
- `CandidateRow.test.tsx` — "BUG-7: row element is not a native <button> when selectable (avoids nested interactive content)"
- `CandidateRow.test.tsx` — "BUG-7: clicking checkbox fires onCheckChange without firing row onClick"

---

## BUG-8: Inbox — queue filters reset after second navigation

**Reported:** 2026-02-23
**Status:** FIXED (2026-02-23)
**Page:** Inbox (`/inbox`)

**Steps to reproduce:**
1. Open the Inbox page and select a filter preset (e.g., "All").
2. Navigate to the Plan page.
3. Return to the Inbox page — filters are correct.
4. Navigate to the Plan page again.
5. Return to the Inbox page — filters are reset to default.

**Expected:** Filters and active preset survive any number of navigations.
**Actual:** Filters survive the first navigation but reset on the second. The active preset indicator is never visible after navigation.

**Root cause (two issues):**
1. **Dual-write corruption:** `PlanningInboxInner` maintained a separate filter state via UPP (`usePersistentControl`) and dual-wrote to the same `planningInbox.filters` sessionStorage key that `InboxListPanel` uses. Since `InboxListPanel`'s filter changes never propagated to the parent's UPP, the parent's filter state stayed at DEFAULT. On remount, effects fired children-first: InboxListPanel wrote the correct value, then the parent's dual-write overwrote it with DEFAULT. On the first return, InboxListPanel's `useState` initializer read the correct value before effects ran (visual survival), but the storage was already corrupted for the next return.
2. **`activePresetId` not persisted:** `InboxListPanel` initialized `activePresetId` with `useState(null)` — no storage backing. The preset indicator always reset to null on remount.

**Fix:**
1. Removed the parent's dual-write effect (`sessionStorage.setItem('planningInbox.filters', ...)`) from `PlanningInbox.tsx`. The `InboxListPanel` is the single owner of the legacy filter storage key.
2. Added `planningInbox.activePresetId` sessionStorage persistence in `InboxListPanel` — reads on mount, writes on change.

**Regression tests:**
- `InboxListPanel.test.tsx` — "BUG-8a: activePresetId survives unmount and remount"
- `InboxListPanel.test.tsx` — "BUG-8b: filter expression set via preset survives two unmount/remount cycles"

---

## BUG-9: Customers — checklist filter value labels are invisible (only checkboxes render)

**Reported:** 2026-03-27
**Status:** FIXED (2026-03-27) — reporter confirmed
**Page:** Customers (`/customers`)

**Steps to reproduce:**
1. Open the Customers page in table view.
2. Click the filter icon in any checklist column (e.g. `PSČ`, `Ulice`, `Email`).
3. Wait for distinct values to load in the dropdown.

**Expected:** Each row shows a checkbox and the corresponding distinct value label.
**Actual:** Rows show only checkboxes; labels are not visible in all columns.

**Screenshots:** User-provided screenshots show translated UI text (`Hledat`, `Vybrat vše`, `Zrušit výběr`, `Použít`) but blank value labels next to every checkbox.

**Root cause:** Global form reset in `apps/web/src/index.css` applies `input { width: 100%; ... }` to all input types, including `input[type="checkbox"]`. In checklist rows (`display: flex`), each checkbox input consumed row width and pushed label text out of visible area.

**Fix:** Added explicit checkbox override in `apps/web/src/components/customers/ChecklistFilterDropdown.module.css`:
- `.valueRow input[type="checkbox"] { width: auto; flex: 0 0 auto; margin: 0; padding: 0; appearance: auto; }`

**Regression tests:**
- `ChecklistFilterDropdown.cssBug.test.ts` — "defines explicit checkbox override so global input width does not hide labels"

---

## BUG-10: Customers — checklist checkboxes are still visually inert after fix candidates

**Reported:** 2026-03-27
**Status:** VERIFIED FIXED (2026-03-27) — confirmed by runtime logs: toggleValue fires once per click, selected state accumulates correctly, no position drift
**Page:** Customers (`/customers`)

**Steps to reproduce:**
1. Open any checklist-type column filter dropdown on Customers page.
2. Click one or more checkbox rows.
3. Observe whether checked state is visually distinguishable.

**Expected:** Checked boxes and selected rows are clearly visible, and multiple selected values remain visibly selected.
**Actual:** Reporter still sees inert checkbox visuals (no reliable visible checked-state feedback).

**Latest observation:** A separate dropdown-position regression appeared during follow-up attempts (tracked as BUG-11 below).

**Current code state (already deployed but not rendering):**
The code already implements the target approach:
- Native `<input>` is sr-only (`.checkboxInput` with `opacity:0`, `clip`, 1px size).
- Custom `<span class="checkboxFace">` renders a 16px square with blue fill + white tick when selected.
- Selection state driven by `data-selected` on the `<label>`, set by React state.
- CSS rules `.valueRow[data-selected='true'] .checkboxFace` apply the selected visual.
- All existing tests pass (CSS guard + interaction tests).

**Execution order:** Fix BUG-11 first (clear, isolated), then BUG-10. Resolving the position bug makes BUG-10 easier to manually verify.

**TDD remediation plan (NOT IMPLEMENTED YET):**

**Phase 0 — Diagnose (before writing any code):**
The current custom-face approach is structurally correct. Before another code change, we must determine *why* it isn't rendering. Two hypotheses:
1. **Stale CSS delivery:** The JS bundle updated (confirmed by BUG-11 position change), but Vite may have served a cached CSS module chunk. The `.checkboxFace` span would exist in the DOM with zero styling (invisible 0x0 element).
2. **Unknown CSS specificity conflict:** Another stylesheet or `<style>` tag may override `.checkboxFace` properties.

Diagnostic steps (choose one):
- **(a) DevTools inspection:** Ask the user to inspect a checkbox row in the filter dropdown and report whether `.checkboxFace` has computed `width: 16px` / `height: 16px` / `border`, or whether these are absent/overridden.
- **(b) CSS smoke test:** Temporarily add `outline: 3px solid red !important` to `.checkboxFace` and deploy. If the red outline is visible, CSS delivery is working and the issue is a specificity conflict. If invisible, CSS delivery itself is broken.
- **(c) Force cache bust:** Ask the user to hard-refresh (Ctrl+Shift+R), clear browser cache, or open in a private/incognito window. If that fixes it, the issue is purely cache-related and no further code change is needed.

**Phase 1 — RED (tests):**
- Add/adjust interaction tests in `ChecklistFilterDropdown.test.tsx` to verify one-toggle-per-click behavior (clicking a row toggles selection exactly once, not twice).
- Add a guard test that fails if row-level click handling introduces double-toggles.
- Keep CSS guard coverage in `ChecklistFilterDropdown.cssBug.test.ts` for required selected-state selectors (`.checkboxFace`, `[data-selected='true'] .checkboxFace`, `::after` tick).

**Phase 2 — GREEN (code fix, driven by diagnosis outcome):**
- *If diagnosis = stale CSS:* No code change needed; add a cache-busting mechanism or document the manual refresh step.
- *If diagnosis = specificity conflict:* Increase specificity of `.checkboxFace` rules (e.g. via extra attribute selector or `!important` on the critical properties) and remove the conflicting source.
- *If diagnosis = something else:* Address the specific finding.
- In all cases: keep checkbox toggle logic on input `onChange` only (no extra row `onClick` toggle path).

**Phase 3 — REFACTOR:**
- Remove redundant style overrides accumulated from previous fix attempts.
- Keep a single, deterministic visual path for selected-state rendering.

**Phase 4 — VERIFY:**
- Run customer filter test suites and full customers-related test subset.
- Manual verification in browser (with confirmed-fresh build): single select, multi-select, deselect, and "Apply" behavior.
- Confirm deployment delivers the correct CSS (version check or DevTools computed-style inspection).

**Implementation guardrails:**
- Do **not** add row-level `onClick` that also toggles selection; this risks double-toggle because `<label>` wrapping `<input>` already propagates the click.
- Prefer deterministic React-driven selected-state visuals over reliance on native checkbox paint differences.
- Do **not** treat "restart dev server / hard refresh" as a code fix; it is a diagnostic step only.

---

## BUG-11: Customers — filter dropdown opens at nonsensical horizontal position

**Reported:** 2026-03-27
**Status:** VERIFIED FIXED (2026-03-27) — runtime logs confirm measure fires once, position stable at left=272.07/top=227.4 across 11 renders
**Page:** Customers (`/customers`)

**Execution order:** Fix this BEFORE BUG-10. It is a clear, isolated regression and resolving it first makes BUG-10 easier to manually verify.

**Steps to reproduce:**
1. Open Customers table.
2. Click the filter icon in a wide column (e.g. `Ulice`, `E-MAIL`).
3. Observe dropdown horizontal alignment vs. clicked icon.

**Expected:** Dropdown opens aligned to the clicked filter icon (or immediately near it), with stable position while interacting.
**Actual:** Dropdown appears offset in a surprising position (aligned to column cell left edge rather than icon).

**Confirmed root cause:** Current code anchors the portal to the open `<th>` (`filterHeaderCellRef`) instead of the filter `<button>`, so `left` is computed from the header cell's left boundary. The anti-drift fix (removing scroll listener) is already in place independently of the anchor target, so there is no reason to keep the `<th>` anchor.

**TDD remediation plan (NOT IMPLEMENTED YET):**

**Phase 1 — RED (tests):**
- Add a behavioral test in `CustomerTable.test.tsx`: verify that `ColumnFilterDropdown` receives an `anchorRef` whose `current` is the filter `<button>` element (not a `<th>`). This guards against future anchor regressions.
- Add an interaction regression test: repeated checkbox clicks inside the dropdown do not shift the dropdown position (no drift).

**Phase 2 — GREEN (minimal code fix):**
- In `CustomerTable.tsx`: change the ref type back to `useRef<HTMLButtonElement>(null)` (`filterButtonRef`).
- Assign `ref={isFilterOpen ? filterButtonRef : undefined}` on the filter `<button>`, not on the `<th>`.
- Pass `filterButtonRef` as `anchorRef` to `ColumnFilterDropdown`.
- Remove the `ref` assignment from the `<th>` element.

**Phase 3 — VERIFY:**
- Run `CustomerTable.test.tsx` and `ColumnFilterDropdown.test.tsx`.
- Manual browser check on both narrow and wide columns for alignment and stability.
- Confirm outside-click close behavior is not regressed: clicking the `<th>` (but not the button) should count as "outside" and close the dropdown. Clicking the filter button should toggle the dropdown open/closed.

---

## BUG-12: Customers — SQL error "op ANY/ALL (array) requires array on right side" when applying checklist filter

**Reported:** 2026-03-27
**Status:** OPEN
**Page:** Customers (`/customers`)

**Steps to reproduce:**
1. Open Customers page in table view.
2. Click the filter icon on any checklist column (e.g. `Ulice`).
3. Select one or more values and click "Použít" (Apply).

**Expected:** The table filters to show only customers matching the selected values.
**Actual:** Red error banner: `error returned from database: op ANY/ALL (array) requires array on right side`.

**Root cause:** `param_idx` convention mismatch between `list_customers_extended` and `build_column_filter_clauses`.

`build_column_filter_clauses` uses "increment-then-use" (`*param_idx += 1;` then `format!("= ANY(${})", param_idx)`), treating `param_idx` as "last used index". This matches the distinct-values query which also uses this convention.

However, `list_customers_extended` initializes `param_idx = 2` (meaning "next available"), and its own search/geocode/type filters use "use-then-increment" (`format!("LIKE ${}", param_idx);` then `param_idx += 1`). When `build_column_filter_clauses` is called, it receives a "next available" value but interprets it as "last used", so it increments *past* the intended slot. Every column filter SQL placeholder is +1 too high.

Example (no search/geocode/type, one street checklist):
- `param_idx` enters `build_column_filter_clauses` as 2 ("next available" in caller's view)
- Function increments to 3, emits `c.street = ANY($3)`
- Bind order: `user_id` → $1, `arr` → $2, `limit` → $3, `offset` → $4
- Result: `= ANY($3)` reads the `limit` (i64) instead of the array → PostgreSQL error

**Fix:** Change `list_customers_extended` to use Convention B ("last used") throughout:
1. `param_idx` starts at 1 (not 2)
2. search/geocode/type use "increment-then-use" (matching `build_column_filter_clauses`)
3. LIMIT/OFFSET use `param_idx + 1` / `param_idx + 2`

**Regression tests:**
- `customer.rs` unit test: `bug12_param_alignment_with_search_and_checklist` — verifies SQL placeholders match bind positions across the full filter chain
