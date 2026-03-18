# Batch Route Building from Inbox

## Overview

Two new user stories that extend the Inbox workflow. Both build on the existing multi-select infrastructure (`selectedIds`, checkboxes, batch toolbar) and the VRP optimizer (`sazinka.route.submit`).

---

## Story 1: Batch Select → Add to Route → Optimize

### User Flow

1. User opens Inbox, selects a day/crew/depot context.
2. User checks several customers in the queue (existing checkbox mechanism).
3. **NEW:** All selected customers are shown as pins on the map simultaneously.
4. User clicks a single "Add to Route & Optimize" button.
5. The system builds (or extends) a route for all selected customers, running the VRP optimizer.
6. If some customers already have an agreed visit time, those time windows are passed as hard constraints — the optimizer arranges the remaining visits around them.
7. The optimized route appears in the timeline and on the map.

### What Exists Today

| Capability | Status |
|---|---|
| Multi-select with checkboxes | ✅ `selectedIds: Set<string>` in `PlanningInbox.tsx` |
| Batch toolbar (count + "Add to route" + "Cancel") | ✅ Renders when `selectedIds.size > 0` |
| Show single selected candidate on map | ✅ `selectedCandidateForMap` + `SELECT_CANDIDATE_MAP` signal |
| Batch add to route (basic) | ✅ `handleAddSelectedToRoute` — inserts stops + recalculates ETAs |
| VRP optimizer | ✅ `sazinka.route.submit` → JetStream → VRP solver with time window support |
| Optimizer respects time windows | ✅ `StopTimeWindow { start, end, is_hard }` in `VrpStop` |
| Batch insertion cost calculation | ✅ `sazinka.route.insertion.batch` |

### What Needs to Change

#### A. Map: Show All Selected Candidates as Pins

**Current:** Only one candidate marker is shown (`selectedCandidateForMap`).
**Target:** All checked candidates (from `selectedIds`) are shown as pins.

Design:
- Introduce `selectedCandidatesForMap: SelectedCandidateForMap[]` (array instead of single).
- Compute it in `PlanningInbox.tsx` from `selectedIds` + `candidates` list, filtering to those with valid coordinates and not already in the route.
- When `selectedIds` is empty, fall back to the single-selected candidate (current behavior).
- Broadcast via a new signal `SELECT_CANDIDATES_MAP` (plural) carrying the array, so detached map also works.
- In `RouteMapPanelUI`, render multiple candidate markers. Differentiate visually:
  - **Single selected** (no batch): orange pulsing pin (current).
  - **Batch selected**: orange static pins (no pulse) with count badge or subtle outline.
  - **Single-selected within batch**: highlighted with pulse (the one the user last clicked in the list for detail view).

#### B. Replace "Add to Route" with "Add to Route & Optimize"

**Current:** `handleAddSelectedToRoute` inserts stops at chronological positions and calls `recalculateRoute` (sequential ETA recalculation only, no re-ordering).
**Target:** The batch action submits a full optimization job.

Design:
- When `selectedIds.size > 0` and user clicks the action button:
  1. Collect customer IDs from `selectedIds`.
  2. Merge with any existing route stops (their customer IDs).
  3. Build `timeWindows` array from:
     - Existing route stops that have `scheduledTimeStart/End` (already agreed visits).
     - Selected candidates that have scheduled revisions (from `candidates` data).
  4. Submit via `routeService.submitRoutePlanJob({ customerIds, date, startLocation, crewId, timeWindows, arrivalBufferPercent, arrivalBufferFixedMinutes })`.
  5. Subscribe to `sazinka.job.status.{jobId}` for progress updates.
  6. On completion: replace `routeStops` with the optimized result, update geometry, clear `selectedIds`.
  7. On failure / unassigned: show warning with the names of unassigned customers.

- The existing `submitRoutePlanJob` and `subscribeToRouteJobStatus` already handle this flow (used by the "Optimize" button). The change is to trigger it from the batch action with the merged set of customer IDs.

- Show optimizer progress in the batch toolbar: "Optimizing... 42%", reusing the existing `optimizer_progress` locale key and `OptimizerStatus` pattern.

#### C. Selection Counter

A persistent counter is shown in two places:
- **List toolbar:** "12 selected" — visible whenever `selectedIds.size > 0`.
- **Map overlay:** A badge/chip in the map corner showing the count. In map selection mode (Story 2), shows "5 of 12 on map".
- When count exceeds the soft limit (25), the counter turns amber with a tooltip: "Large batch — optimization may take longer."

#### C2. Edge Cases

- **Empty route + batch select:** Create a new route from scratch with only the selected candidates.
- **Existing route + batch select:** Merge existing stops + new candidates, re-optimize the whole route.
- **All selected already in route:** No-op or show info toast.
- **Some selected have no coordinates:** Skip them, show a warning listing which were excluded.
- **Optimizer returns unassigned:** Keep unassigned candidates in the selection with a visual indicator; let user decide (remove from selection or force-add without optimization).
- **Soft limit exceeded (>25):** Show amber warning but allow the operation to proceed.

---

## Story 2: Batch Select → Map Sub-Selection → Add to Route → Optimize

### User Flow

1. Steps 1–3 from Story 1: user checks multiple customers, sees them all on the map.
2. **NEW:** User switches to a "map selection" mode by clicking a toolbar button.
3. User sub-selects candidates directly on the map:
   - **Click pin:** Toggle individual candidate in/out of sub-selection.
   - **Rectangle drag:** Draw a rectangle on the map to select all candidate pins within it.
4. Only sub-selected candidates (highlighted differently) are included in the route.
5. User clicks "Add to Route & Optimize" — works the same as Story 1 but only for the sub-selected subset.

### What Needs to Change (on top of Story 1)

#### D. Map Sub-Selection Mode

Design:
- Add a `mapSelectionMode: boolean` state to `PlanningInbox.tsx`, toggled by a toolbar button (e.g., a crosshair/selection icon).
- When `mapSelectionMode` is active:
  - Candidate pins become clickable (toggle sub-selection).
  - A rectangle selection tool is enabled (drag-to-select).
  - Map panning requires holding a modifier key (Shift) or uses a separate gesture to avoid conflict with rectangle selection.

#### E. Sub-Selection State

Design:
- Introduce `mapSelectedIds: Set<string>` — the sub-selection set (subset of `selectedIds`).
- Initially empty when entering map selection mode.
- Click on a candidate pin: toggle its ID in `mapSelectedIds`.
- Rectangle selection: add all candidate IDs whose coordinates fall within the rectangle to `mapSelectedIds`.
- The "Add to Route & Optimize" button uses `mapSelectedIds` (when non-empty) instead of `selectedIds`.
- Exiting map selection mode clears `mapSelectedIds`.

#### F. Visual Differentiation on Map

Three visual states for candidate pins:
| State | Appearance |
|---|---|
| Checked in list but NOT sub-selected on map | Gray/muted orange pin |
| Checked in list AND sub-selected on map | Bright orange pin with highlight ring |
| Not checked in list | Not shown on map |

#### G. Rectangle Selection Implementation

MapLibre GL JS supports custom interaction handlers. Design:
- On `mousedown` (when in selection mode and no modifier): start recording rectangle origin `(x, y)`.
- On `mousemove`: draw a semi-transparent blue rectangle overlay (CSS-positioned div over the map).
- On `mouseup`: compute the geographic bounds from the rectangle corners using `map.unproject()`.
- Find all candidate pins whose coordinates fall within the bounds.
- Add their IDs to `mapSelectedIds`.
- Remove the rectangle overlay.

This is a standard pattern in mapping applications. The rectangle overlay is a DOM element positioned absolutely over the map canvas — no custom MapLibre layers needed.

#### G2. Detached Map Sub-Selection

Map sub-selection must work when the map is detached. The detached map is a primary use case — users detach the map specifically to get a large spatial view for these batch operations.

Design:
- The **main window** owns `mapSelectedIds` state.
- The **detached map** sends signals when the user interacts with pins or the rectangle tool:
  - `MAP_SUB_SELECT { candidateIds: string[] }` — add IDs to sub-selection.
  - `MAP_SUB_DESELECT { candidateIds: string[] }` — remove IDs from sub-selection.
  - `MAP_SUB_SELECT_TOGGLE { candidateId: string }` — toggle a single pin.
- The **main window** receives these signals, updates `mapSelectedIds`, and broadcasts back:
  - `MAP_SUB_SELECTION_SYNC { mapSelectedIds: string[] }` — the authoritative sub-selection set.
- The **detached map** receives the sync signal and updates pin visuals accordingly.
- The `mapSelectionMode` toggle is controlled from the main window toolbar and broadcast via `MAP_SELECTION_MODE { active: boolean }` so the detached map enables/disables its interaction handlers.

#### H. Toolbar Changes

When `mapSelectionMode` is active, the batch toolbar shows:
- "Map selection: X of Y" (how many sub-selected out of total checked).
- "Select All" / "Clear" buttons for quick toggle.
- "Done" button to confirm and exit map selection mode.
- "Add Selected to Route & Optimize" (uses `mapSelectedIds`).

---

## Implementation Phases

### Phase 1: Multi-Pin Map Display (Story 1, part A)

**Scope:** Show all checked candidates on the map.

1. Replace `selectedCandidateForMap: single` with `selectedCandidatesForMap: array`.
2. Update `PanelSignals` with `SELECT_CANDIDATES_MAP` signal.
3. Update `PanelStateContext` to store and relay the array.
4. Update `RouteMapPanelUI` to render multiple candidate markers.
5. Update detached map support.

**Tests (TDD):**
- `it('computes selectedCandidatesForMap from selectedIds')` — PlanningInbox unit test.
- `it('renders multiple candidate markers on map')` — RouteMapPanelUI test.
- `it('broadcasts candidates array to detached map')` — signal/context test.

### Phase 2: Batch Optimize (Story 1, parts B + C)

**Scope:** Replace naive batch-add with VRP-optimized route building.

1. Modify `handleAddSelectedToRoute` to call `submitRoutePlanJob` instead of manual insertion.
2. Merge existing route stops with new candidates.
3. Build `timeWindows` from scheduled visits.
4. Show optimizer progress in batch toolbar.
5. Handle optimizer result: update route, geometry, clear selection.
6. Handle errors and unassigned customers.

**Tests (TDD):**
- `it('submits optimize job with merged customerIds and timeWindows')` — handler test.
- `it('shows optimizer progress in batch toolbar')` — UI test.
- `it('handles unassigned customers with warning')` — error handling test.
- `it('preserves existing time windows as hard constraints')` — integration test.

### Phase 3: Map Sub-Selection (Story 2, parts D–H, G2)

**Scope:** Click-to-toggle and rectangle selection on the map, including detached map.

1. Add `mapSelectionMode` toggle to toolbar.
2. Implement click-to-toggle on candidate pins.
3. Implement rectangle drag selection.
4. Add `mapSelectedIds` state.
5. Wire up "Add to Route & Optimize" to use sub-selection when active.
6. Visual differentiation (three pin states).
7. BroadcastChannel signals for detached map sub-selection (`MAP_SUB_SELECT`, `MAP_SUB_DESELECT`, `MAP_SUB_SELECT_TOGGLE`, `MAP_SUB_SELECTION_SYNC`, `MAP_SELECTION_MODE`).
8. Selection counter on map overlay.

**Tests (TDD):**
- `it('toggles candidate pin on click in selection mode')` — map interaction test.
- `it('selects candidates within rectangle bounds')` — rectangle selection test.
- `it('uses mapSelectedIds for route building when active')` — integration test.
- `it('shows correct visual state for each pin category')` — visual state test.
- `it('sends MAP_SUB_SELECT_TOGGLE signal from detached map on pin click')` — detached signal test.
- `it('receives MAP_SUB_SELECTION_SYNC and updates pin visuals in detached map')` — detached sync test.
- `it('enables/disables selection mode in detached map via MAP_SELECTION_MODE signal')` — mode sync test.

---

## Data Flow Diagram

```
                    PlanningInbox.tsx
                    ┌─────────────────────────────┐
                    │  selectedIds: Set<string>    │  ← checkboxes
                    │  mapSelectedIds: Set<string> │  ← map sub-selection (Story 2)
                    │                              │
                    │  selectedCandidatesForMap: [  │  ← computed from selectedIds
                    │    { id, name, coords },     │     + candidates list
                    │    { id, name, coords },     │
                    │  ]                           │
                    └──────┬──────────────────┬────┘
                           │                  │
              props (attached)    BroadcastChannel (detached)
                           │          SELECT_CANDIDATES_MAP
                           ▼                  ▼
                    RouteMapPanel(UI)
                    ┌─────────────────────────────┐
                    │  Renders N candidate pins    │
                    │  Click pin → toggle sub-sel  │  (Story 2)
                    │  Rect drag → batch sub-sel   │  (Story 2)
                    └─────────────────────────────┘

    "Add to Route & Optimize" click
                    │
                    ▼
    ┌───────────────────────────────────┐
    │  Merge: existing route stops      │
    │       + selected candidates       │
    │  Build timeWindows from scheduled │
    │  Submit: submitRoutePlanJob(...)   │
    └──────────────┬────────────────────┘
                   │
                   ▼  NATS: sazinka.route.submit
    ┌───────────────────────────────────┐
    │  Worker: JetStream consumer       │
    │  VRP solver (vrp-pragmatic)       │
    │  Respects time windows            │
    │  Returns optimized stop order     │
    └──────────────┬────────────────────┘
                   │
                   ▼  NATS: sazinka.job.status.{jobId}
    ┌───────────────────────────────────┐
    │  Frontend: subscribeToRouteJob    │
    │  Update routeStops + geometry     │
    │  Clear selectedIds                │
    │  Show unassigned warnings         │
    └───────────────────────────────────┘
```

## Decisions

1. **Optimizer scope on merge:** Full re-optimization of the entire route (existing + new stops). Scheduled time windows are hard constraints — the stop order may change but agreed visit times are always preserved.

2. **Maximum batch size:** Soft limit of **25 candidates**. Above this threshold, a warning is shown but the user can proceed. A **selection counter** is always visible on both the list toolbar and the map (e.g., "12 selected" / "12 vybráno"), so the user always knows how many customers are in the batch.

3. **Map selection tool:** Rectangle selection only. No lasso/freeform polygon for now.

4. **Sub-selection persistence:** Cleared when the user exits map selection mode. The sub-selection is a transient refinement step.

5. **Detached map interaction:** Map sub-selection (Story 2) **must work** when the map is detached. This is a primary use case — the reason for detaching the map is precisely to have a large map view for spatial selection. Implementation: pin clicks and rectangle selections in the detached map window send `MAP_SUB_SELECT` / `MAP_SUB_DESELECT` signals via BroadcastChannel back to the main window, which owns the `mapSelectedIds` state. The detached map receives the updated `mapSelectedIds` set via a return signal to keep its visual state in sync.

## Selection Counter

Both the **list toolbar** and the **map overlay** display a persistent counter showing the current selection size:

- **List toolbar:** "12 selected" (existing `selected_count` key) — always visible when `selectedIds.size > 0`.
- **Map overlay:** A small badge/chip in the map corner showing "12" or "12 / 25" (selected / soft limit) when candidates are checked.
- **Map selection mode (Story 2):** The counter updates to show the sub-selection: "5 of 12 on map" — how many are sub-selected out of the total checked.
- **Soft limit warning:** When `selectedIds.size > 25`, the counter turns orange/amber and shows a tooltip: "Large batch — optimization may take longer."
