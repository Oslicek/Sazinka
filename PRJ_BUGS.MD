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
**Status:** INVESTIGATING
**Page:** Both Inbox (`/inbox`) and Plan (`/plan`)

**Steps to reproduce:**
1. Open Inbox or Plan page with an existing route.
2. Reload the page repeatedly.

**Expected:** Route segment lines are always visible on the map alongside stop markers.
**Actual:** In roughly 50% of reloads, stop markers appear but route segment lines do not render. No consistent pattern — same data, same page, different outcome on each reload.

**Likely cause:** Race condition between map initialization (`load` / `style.load` events) and the route rendering effect.
