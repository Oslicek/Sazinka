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
  4. Submit via `routeService.submitRoutePlanJob({ customerIds, date, startLocation, crewId, timeWindows, arrivalBufferPercent, arrivalBufferFixedMinutes })`. The `startLocation` is depot coordinates from `depots.find(d => d.id === context.depotId)`; depot is required (see edge case "No depot selected").
  5. Subscribe to `sazinka.job.status.{jobId}` for progress updates.
  6. On completion: replace `routeStops` with the optimized result, update geometry, clear `selectedIds`.
  7. On failure / unassigned: show warning with the names of unassigned customers.

- The existing `submitRoutePlanJob` and `subscribeToRouteJobStatus` already handle this flow (used by the "Optimize" button). The change is to trigger it from the batch action with the merged set of customer IDs.
- **Double-submit guard:** Disable the "Add to Route & Optimize" button when `isOptimizing` is true (reuse the existing `isOptimizing` state from `handleOptimizeRoute`) to prevent double submission.

- Show optimizer progress in the batch toolbar: "Optimizing... 42%", reusing the existing `optimizer_progress` locale key and `OptimizerStatus` pattern.
- **Break handling:** For new routes from batch, the optimizer may or may not return breaks. If crew break settings are enabled, insert breaks after optimization using the same logic as `handleOptimizeRoute` in PlanningInbox (e.g. `calculateBreakPosition`). Reuse the existing break-insertion flow.

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
- **No depot selected:** Batch optimize requires a depot (`context.depotId`). If depot is missing, show an error: "Select a depot to optimize the route." The `startLocation` for the optimizer comes from depot coordinates (`depots.find(d => d.id === context.depotId)`).

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
- **When `mapSelectionMode` is active and `mapSelectedIds` is empty:** Disable the "Add to Route & Optimize" button and show a hint: "Select customers on the map." When `mapSelectedIds` is non-empty, the button is enabled and adds only the sub-selected candidates.
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
- **Interaction model:** Drag (no modifier) = draw rectangle to select. Shift+drag = pan map. Click on pin = toggle sub-selection.
- On `mousedown` (when in selection mode and no Shift): start recording rectangle origin `(x, y)`.
- On `mousemove`: draw a semi-transparent blue rectangle overlay (CSS-positioned div over the map).
- On `mouseup`: compute the geographic bounds from the rectangle corners using `map.unproject()`.
- Find all candidate pins whose coordinates fall within the bounds.
- Add their IDs to `mapSelectedIds`.
- Remove the rectangle overlay.

This is a standard pattern in mapping applications. The rectangle overlay is a DOM element positioned absolutely over the map canvas — no custom MapLibre layers needed.

#### G2. Detached Map Sub-Selection

Map sub-selection must work when the map is detached. The detached map is a primary use case — users detach the map specifically to get a large spatial view for these batch operations.

**Attached vs detached:**
- **Attached map:** Pin clicks and rectangle selection update `mapSelectedIds` directly via callbacks (e.g. `onMapSubSelectToggle`, `onMapSubSelectRect`). No signals — same React tree.
- **Detached map:** The map sends signals via BroadcastChannel; the main window receives them, updates `mapSelectedIds`, and broadcasts `MAP_SUB_SELECTION_SYNC` back so the detached map updates its pin visuals.

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

### Phase 0: Signal Channel Scoping (refactoring, no new behavior)

**Scope:** Replace the single shared `BroadcastChannel('sazinka-panels')` with per-page channels (`sazinka-panels-inbox`, `sazinka-panels-plan`). No new signals, no new UI. All existing behavior must be preserved exactly.

**Why first:** Every subsequent phase adds new signals. Without isolation, signals from Inbox and Plan can leak across pages/tabs. Fixing this later, under a pile of new signal types, is riskier and harder to test. Doing it now is a small, well-bounded change that protects all future work.

**What changes:**

| File | Change |
|---|---|
| `usePanelSignals.ts` | Replace hardcoded `CHANNEL_NAME = 'sazinka-panels'` with a `channelName` parameter in `UsePanelSignalsOptions`. |
| `PanelStateContext.tsx` | Derive channel name from `activePageContext` (e.g. `sazinka-panels-${activePageContext}`) and pass to `usePanelSignals`. |
| `DetachedPanelPage.tsx` | Already receives `pageContext` prop; pass same derived channel name to `PanelStateProvider` and its own `usePanelSignals` call. |
| `useDetachState.ts` | Has its own `usePanelSignals` call; pass the page-scoped channel name. |
| `PanelStateProviderProps` | Add optional `channelName?: string` prop (computed from `activePageContext` by default). |

**What does NOT change:** Signal types, signal handlers, `onSignal` switch/case, `getSnapshot`, `CONTEXT_SNAPSHOT`, detach/reattach logic, all UI.

**Tests (TDD):**

Existing tests (must all pass unchanged — proves zero regression):
- All 17 tests in `usePanelSignals.test.ts`
- All 16 tests in `PanelStateProvider.test.tsx`
- All detach tests in `PlanningInbox.detach.test.tsx`
- All detach tests in `Plan.detach.test.tsx`
- All integration tests in `PlanningInbox.integration.test.tsx`, `Plan.integration.test.tsx`
- All panel tests in `RouteMapPanel.test.tsx`, `InboxListPanel.test.tsx`, `CustomerDetailPanel.test.tsx`, `RouteListPanel.test.tsx`

New tests for channel scoping:
- `it('opens channel with page-scoped name when channelName provided')` — verify `BroadcastChannel` constructor receives `sazinka-panels-inbox`.
- `it('defaults to sazinka-panels when no channelName provided')` — backward compat for tests using plain `PanelStateProvider`.
- `it('inbox channel does not receive signals from plan channel')` — two hooks on different channel names, send on one, verify the other does NOT call `onSignal`.
- `it('plan channel does not receive signals from inbox channel')` — reverse of above.
- `it('same-page channels communicate normally')` — two hooks on same channel name, verify signal delivery.
- `it('detached panel page uses page-scoped channel matching main window')` — render `DetachedPanelPage` with `pageContext="inbox"`, verify channel name is `sazinka-panels-inbox`.
- `it('useDetachState uses page-scoped channel')` — verify the detach hook opens the correct channel for its page context.
- `it('PANEL_DETACHED signal only reaches same-page listeners')` — send from inbox channel, verify plan channel ignores it.
- `it('REQUEST_CONTEXT_SNAPSHOT only answered by same-page source-of-truth')` — source-of-truth on inbox channel ignores snapshot request on plan channel.

**🛑 MANUAL TESTING CHECKPOINT after Phase 0:**
Deploy and manually verify before proceeding:
- Inbox: detach map → verify route + candidate selection works in detached window.
- Inbox: detach list → verify list populates, selection syncs back to main window.
- Plan: detach map → verify route display works in detached window.
- Switch between Inbox and Plan pages → verify no stale state leaks.
- Close detached panel → verify main window detects reattachment.

---

### Phase 1: Multi-Pin Map Display (Story 1, part A)

**Scope:** Show all checked candidates on the map.

1. Replace `selectedCandidateForMap: single` with `selectedCandidatesForMap: SelectedCandidateForMap[]` (array).
2. Compute array in `PlanningInbox.tsx` from `selectedIds` + `candidates`, filtering for valid coordinates and not already in route.
3. When `selectedIds` is empty, fall back to the single-selected candidate (backward compat).
4. Add `SELECT_CANDIDATES_MAP` signal (plural, carries array) to `panelSignals.ts`.
5. Update `PanelStateContext` to store array and relay via signal/snapshot.
6. Update `RouteMapPanelUI` to render multiple candidate markers with visual differentiation.
7. Update detached map to receive array from context.
8. Add selection counter badge on map overlay.

**Tests (TDD):**
- `it('computes selectedCandidatesForMap from selectedIds filtering invalid coords')` — PlanningInbox unit.
- `it('excludes candidates already in route from selectedCandidatesForMap')` — PlanningInbox unit.
- `it('falls back to single selectedCandidateForMap when selectedIds is empty')` — PlanningInbox unit.
- `it('renders N candidate markers for N-element array')` — RouteMapPanelUI.
- `it('shows pulsing style for single-selected candidate within batch')` — RouteMapPanelUI.
- `it('shows static style for batch-selected candidates')` — RouteMapPanelUI.
- `it('broadcasts SELECT_CANDIDATES_MAP array to detached map')` — signal test.
- `it('includes selectedCandidatesForMap in CONTEXT_SNAPSHOT')` — PanelStateProvider.
- `it('displays selection counter badge on map')` — RouteMapPanelUI.
- `it('shows amber counter when selectedIds.size > 25')` — soft limit warning.

---

### Phase 2: Batch Optimize (Story 1, parts B + C)

**Scope:** Replace naive batch-add with VRP-optimized route building.

1. Modify `handleAddSelectedToRoute` to call `submitRoutePlanJob` instead of manual insertion.
2. Build `customerIds` as: `unique(existingRouteCustomerIds + selectedIds)`, filtering nulls and break stops.
3. Build `timeWindows` from existing route stops + selected candidates with scheduled revisions.
4. Guard: require depot selected, show error if missing.
5. Guard: disable button when `isOptimizing` is true (double-submit prevention).
6. Show optimizer progress in batch toolbar (reuse `OptimizerStatus` pattern).
7. On completion: replace `routeStops`, insert breaks via `calculateBreakPosition` if crew settings enabled, update geometry, clear `selectedIds`.
8. On failure / unassigned: show warning, keep assigned stops, keep unassigned in `selectedIds`.

**Tests (TDD):**
- `it('builds unique customerIds from existing route + selectedIds')` — unit, verify dedup.
- `it('filters out break stops and null customerIds from merge')` — unit.
- `it('submits optimize job with merged customerIds and timeWindows')` — handler test.
- `it('blocks submission when no depot is selected and shows error')` — guard test.
- `it('disables button when isOptimizing is true')` — double-submit guard.
- `it('shows optimizer progress in batch toolbar')` — UI test.
- `it('replaces routeStops on optimizer completion')` — state update test.
- `it('inserts break after optimization when crew break settings enabled')` — break handling test.
- `it('clears selectedIds on successful optimization')` — cleanup test.
- `it('handles unassigned: keeps assigned route, keeps unassigned in selectedIds')` — error handling.
- `it('preserves existing time windows as hard constraints')` — integration.
- `it('shows names of excluded candidates with no coordinates')` — warning test.

---

### Phase 3: Map Sub-Selection (Story 2, parts D–H, G2)

**Scope:** Click-to-toggle and rectangle selection on the map, including detached map.

1. Add `mapSelectionMode` toggle to toolbar.
2. Implement click-to-toggle on candidate pins.
3. Implement rectangle drag selection (drag = rect, Shift+drag = pan, click = toggle).
4. Add `mapSelectedIds: Set<string>` state.
5. Wire "Add to Route & Optimize" to use `mapSelectedIds` when non-empty in map mode.
6. Disable button with hint when `mapSelectedIds` is empty in map mode.
7. Visual differentiation (three pin states: muted, bright, not shown).
8. Dual soft-limit warning: primary for optimization payload, secondary info for total checked.
9. BroadcastChannel signals for detached map (`MAP_SUB_SELECT`, `MAP_SUB_DESELECT`, `MAP_SUB_SELECT_TOGGLE`, `MAP_SUB_SELECTION_SYNC`, `MAP_SELECTION_MODE`). All on page-scoped channel (from Phase 0).
10. Selection counter on map overlay: "5 of 12 on map".
11. Toolbar: "Select All" / "Clear" / "Done" buttons.

**Tests (TDD):**
- `it('toggles candidate pin on click in selection mode')` — map interaction.
- `it('does not toggle pin when mapSelectionMode is false')` — guard.
- `it('selects candidates within rectangle bounds')` — rectangle selection.
- `it('Shift+drag pans map instead of drawing rectangle')` — interaction model.
- `it('uses mapSelectedIds for route building when mapSelectionMode active and mapSelectedIds non-empty')` — integration.
- `it('disables Add to Route button when mapSelectionMode active and mapSelectedIds empty')` — button state.
- `it('shows correct visual state for each pin category')` — visual state.
- `it('clears mapSelectedIds when exiting map selection mode')` — cleanup.
- `it('sends MAP_SUB_SELECT_TOGGLE signal from detached map on pin click')` — detached signal.
- `it('receives MAP_SUB_SELECTION_SYNC and updates pin visuals in detached map')` — detached sync.
- `it('enables/disables selection mode in detached map via MAP_SELECTION_MODE signal')` — mode sync.
- `it('MAP_SUB_* signals only travel on page-scoped channel')` — isolation (Phase 0 guarantee).
- `it('shows dual warning: payload count + total checked')` — soft limit.
- `it('Select All adds all checked candidates to mapSelectedIds')` — toolbar action.
- `it('Clear removes all from mapSelectedIds')` — toolbar action.
- `it('Done exits map selection mode and clears mapSelectedIds')` — toolbar action.

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

6. **Signal channel scoping:** Separate `BroadcastChannel` per page context (`sazinka-panels-inbox`, `sazinka-panels-plan`). This prevents cross-page signal leakage and ensures detached panels only communicate with their parent page. (Decision B from review.)

7. **Optimizer customerIds payload:** Unique union of existing route customer IDs + `selectedIds` (or `mapSelectedIds` in map mode), filtered to remove nulls, break stops, and duplicates. (Decision A from review.)

8. **Soft-limit warning trigger:** Dual warning — primary is based on the actual optimization payload size (the merged, deduped set sent to the solver), and the counter always shows total selected count as additional context. (Decision C from review.)

9. **Unassigned customers from optimizer:** Keep the assigned portion of the route; keep unassigned customers in `selectedIds` so the user can re-attempt, adjust, or remove them. Show warning naming the unassigned customers. (Decision A from review.)

10. **Missing depot:** Hard block — the "Add to Route & Optimize" button is disabled (greyed out with tooltip) when no depot is selected. The optimizer cannot compute distances without a start/end location. (Decision A from review.)

## Selection Counter

Both the **list toolbar** and the **map overlay** display a persistent counter showing the current selection size:

- **List toolbar:** "12 selected" (existing `selected_count` key) — always visible when `selectedIds.size > 0`.
- **Map overlay:** A small badge/chip in the map corner showing "12" or "12 / 25" (selected / soft limit) when candidates are checked.
- **Map selection mode (Story 2):** The counter updates to show the sub-selection: "5 of 12 on map" — how many are sub-selected out of the total checked.
- **Soft limit warning:** When optimization payload size > 25, the counter turns orange/amber and shows a tooltip: "Large batch — optimization may take longer."

---

## Inbox UI Test Coverage Overhaul

### Goal

Radically improve frontend test coverage around the Inbox UI to reduce regressions in scheduling, route building, selection, and map interactions.  
Stack: **Vitest + React Testing Library** (unit + integration at component/page boundary).

### Why this is needed

- `PlanningInbox.tsx` is a large orchestration page (state + services + routing + map + timeline) and currently has only narrow layout-focused tests.
- Most production regressions happened in UI wiring (selection, scheduling, state merge, route updates), not in isolated utility functions.
- Existing utility tests are already strong in some areas (`planningInboxFilters`, `inboxAdapter`, `useAutoSave`), so the highest ROI is page/flow coverage.

### Current baseline (reviewed)

- Good coverage already:
  - `planningInboxFilters.test.ts`
  - `inboxAdapter.test.ts`
  - `useAutoSave.test.ts`
  - `InboxFilterBar.test.tsx`
  - `InboxListPanel.test.tsx`
- Partial coverage:
  - `CandidateDetail.test.tsx` (snooze/unschedule paths mostly covered)
- Major gaps:
  - `PlanningInbox.test.tsx` (mostly responsive layout checks)
  - `PlanningTimeline.tsx` (complex interactions, no direct tests)
  - `VirtualizedInboxList.tsx` (keyboard and selection behavior not directly tested)
  - `RouteSummaryStats.tsx`, `ArrivalBufferBar.tsx`, `TimelineViewToggle.tsx` (low/zero direct tests)

### Scope and phases

#### Phase 0 - Shared test harness

Create reusable helpers to avoid brittle one-off mocks in every test:

- `apps/web/src/test/factories/inbox.ts`
  - candidate, route stop, route context, slot suggestion builders
- `apps/web/src/test/factories/services.ts`
  - consistent service mocks (`inbox`, `route`, `insertion`, `scoring`, `settings`, `calendar`)
- `apps/web/src/test/helpers/renderPlanningInbox.tsx`
  - common render wrapper with router/store defaults and override hooks

#### Phase 1 - PlanningInbox page integration tests (highest priority)

Expand `apps/web/src/pages/PlanningInbox.test.tsx` to cover real user flows:

- Data loading and empty states
- Candidate selection/deselection and detail panel sync
- Scheduling and unscheduling visual state updates
- Batch selection toolbar behavior
- Guardrails (disabled actions when depot missing / optimizing)
- Route operations that update timeline/list states
- Filter interactions affecting visible candidates

Primary rule: mock network/service boundaries, but keep real page logic and real child wiring where practical.

#### Phase 2 - Candidate detail interaction tests

Expand `apps/web/src/components/planner/CandidateDetail.test.tsx`:

- Schedule form open/confirm/cancel
- Slot suggestion selection callback contract
- Contact and address edit-save paths
- Callback note flow and action state transitions
- State flag rendering assertions aligned with current DOM

#### Phase 3 - Map/timeline child coverage

Add/expand tests for components with meaningful interaction logic:

- `RouteMapPanel` (planner component): selection badge, click/rect mode toggles, callbacks
- `PlanningTimeline`: gap insertion callbacks, key timeline rendering branches
- `VirtualizedInboxList`: keyboard navigation + selection callback behavior
- `ArrivalBufferBar`: edit/save/cancel flows
- `RouteSummaryStats`: fallback and explicit time calculations
- `TimelineViewToggle`: controlled toggle behavior

Note: full drag-and-drop fidelity is better suited for browser/E2E; here we verify event contracts and state transitions.

#### Phase 4 - Extract pure logic from PlanningInbox for deterministic unit tests

Create `apps/web/src/pages/planningInboxUtils.ts` and unit tests in `planningInboxUtils.test.ts` for pure computations currently embedded in `PlanningInbox.tsx` (key builders, route-end calculations, candidate detail merge helpers, etc.).

### Execution order

1. Phase 0 (harness)
2. Phase 1 (page flows)
3. Phase 2 + Phase 3 (parallel)
4. Phase 4 (small extraction/refactor after flow coverage is stable)

### Testing principles for this work

- Prefer behavior assertions over snapshots.
- Prefer role/text queries over implementation details.
- Keep tests deterministic (fake timers only where necessary).
- Avoid over-mocking internal component behavior when integration value is needed.
- Keep each test focused on one user-visible outcome.

### Risks and mitigations (review)

- **Risk:** brittle tests due to heavy global mocks.  
  **Mitigation:** centralize factories/harness and reuse defaults.
- **Risk:** map interactions in jsdom can be flaky.  
  **Mitigation:** assert callback contracts and rendered state, not WebGL internals.
- **Risk:** tests becoming obsolete after UI copy/layout tweaks.  
  **Mitigation:** target stable semantics (roles, states, callbacks), avoid CSS-class assertions unless intentional.
- **Risk:** long-running suites.  
  **Mitigation:** keep page integration tests focused and push pure logic to unit tests.

### Definition of done

- Inbox-focused tests added across page + critical child components.
- Existing tests remain green.
- New tests cover previously failing regression paths (especially scheduling/detail synchronization).
- Frontend coverage improves meaningfully in Inbox-related files and remains maintainable.

### Measurable coverage targets (added)

To avoid "more tests, same risk" outcomes, track explicit thresholds:

- **Baseline capture (before work):**
  - Run `npx vitest run --coverage` in `apps/web` and save the coverage summary as baseline.
  - Record current values for lines/functions/branches/statements.

- **Inbox-critical surface target (after Phases 1-3):**
  - File group: `PlanningInbox.tsx`, `CandidateDetail.tsx`, `RouteMapPanel.tsx`, `PlanningTimeline.tsx`, `VirtualizedInboxList.tsx`, `InboxListPanel.tsx`.
  - Minimum aggregated target for this group:
    - lines >= 60%
    - functions >= 65%
    - branches >= 50%

- **Extracted pure helpers target (Phase 4):**
  - `planningInboxUtils.ts` (and similar extracted pure modules):
    - lines >= 90%
    - functions >= 90%
    - branches >= 85%

- **Frontend-wide guardrail:**
  - No overall frontend coverage metric may decrease from baseline.
  - At least one overall metric (preferably lines/branches) must improve by >= 2 percentage points.

### CI acceptance checklist (added)

Before considering this initiative complete, all of the following must pass:

- **Core test gate**
  - `npx vitest run --coverage` passes in `apps/web`.
  - No `.only` tests and no newly added skipped tests without explicit TODO rationale.

- **Inbox regression gate**
  - `PlanningInbox.test.tsx`, `CandidateDetail.test.tsx`, `InboxListPanel.test.tsx`, and new Inbox child tests all pass in one run.
  - Scheduling regression path is explicitly covered by at least one page-level test (confirming detail/list state synchronization after scheduling).

- **Flakiness gate**
  - Run Inbox-focused test set 3 times back-to-back; all 3 runs must pass.
  - If any run fails intermittently, treat as blocker and fix test determinism before merge.

- **Runtime sanity gate**
  - Inbox-focused subset should remain fast enough for local iteration (target: under 90 seconds on standard dev machine).

- **Review gate**
  - PR description includes:
    - baseline coverage snapshot,
    - post-change coverage snapshot,
    - list of newly covered high-risk Inbox flows.
