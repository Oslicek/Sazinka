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
