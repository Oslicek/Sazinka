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

---

# Remove Map/Route Collapse UI and Unify Map Button Cluster (Inbox + Plan)

## Background and motivation

The Inbox right column has collapsible section headers (▲/▼) for both the **Map** and the **Route (timeline)** panels. Product no longer wants these. Additionally there is a second collapse layer deep inside `renderMapPanel`: a `mapMode` state (`normal | collapsed | fullscreen`) with hide-map / fullscreen map controls, a `mapCollapsedBar` restore bar and a draggable resize handle. The `DetachButton` also currently overlaps the MapLibre `NavigationControl` zoom cluster because Inbox uses an absolute-positioned wrapper (`top: 4px; right: 4px`) that competes with MapLibre's own `top-right` slot. Plan's map wrapper is built differently; the two pages do not share a common map shell.

This initiative has three outcomes:

1. **Remove** all collapse-related state, handlers, CSS and JSX from the Inbox right column (section headers + inner `mapMode === 'collapsed'` path).
2. **Decide** once what happens to fullscreen and draggable-resize—both are excluded from removal (product call documented in Decisions section).
3. **Unify** Plan and Inbox behind one shared `MapPanelShell` component that positions `DetachButton` without overlapping MapLibre controls.

## Current state (code references)

| Item | Location |
|------|----------|
| Section-level collapse toggles + localStorage | `PlanningInbox.tsx` ~174–200, ~3252–3293 |
| Inner `mapMode` state, mapControls, mapCollapsedBar | `PlanningInbox.tsx` ~229, ~2760–2827 |
| Map resize handle + `mapHeight` state | `PlanningInbox.tsx` ~230, ~323–343, ~2825 |
| `.rightPanelCollapseBtn`, `.mapCollapsedBar`, `.mapCollapsedLabel` | `PlanningInbox.module.css` ~241–268, ~787–802 |
| Inbox detach absolute-position hack | `PlanningInbox.module.css` ~281–295 (`.mapPanelWrapper > button`) |
| Plan map wrapper (no overlap today) | `Plan.module.css` ~320–326 |
| Detach wiring in Plan | `Plan.tsx` ~1249–1258 |
| `NavigationControl` added at `top-right` | `RouteMapPanel.tsx` ~194 |

## Decisions

1. **Collapse removed:** section-header collapse (`isMapCollapsed`, `isTimelineCollapsed`, localStorage keys `sazinka.inbox.timelineCollapsed` / `sazinka.inbox.mapCollapsed`) and inner `mapMode === 'collapsed'` path are **deleted**.
2. **Fullscreen kept:** `mapMode === 'fullscreen'` and the fullscreen-toggle button in `mapControls` are **kept** — Plan does not have this yet; a follow-up can decide whether to add it to Plan later.
3. **Draggable resize kept:** `mapHeight`, `handleMapResizeStart`, `.mapResizeHandle` are **kept**. This is a size-adjustment UX, not a hide/show toggle.
4. **Hide-map button removed:** the second button in `mapControls` (sets `mapMode = 'collapsed'`) is removed; it was the inner-layer version of the same collapse affordance.
5. **Shared shell introduced:** a new `MapPanelShell` component wraps `DetachButton` (when `canDetach`) and renders its children (the map). `DetachButton` is placed in a CSS stack that does **not** overlap the MapLibre `top-right` control cluster. Both `Plan.tsx` and `PlanningInbox.tsx` use this shell.

## TDD phases

### Phase 1 — RED (tests first, all expected to fail)

Write tests before touching production code. The test suite must go RED on initial run.

#### 1a. `MapPanelShell.test.tsx` — new unit test

Location: `apps/web/src/components/layout/__tests__/MapPanelShell.test.tsx`

Scenarios:

- **renders children** — passes `<div data-testid="child" />` as child and asserts `getByTestId('child')` is in the document.
- **renders DetachButton when canDetach=true** — mocks `useDetachState` returning `{ canDetach: true, isDetached: () => false, detach: vi.fn() }` and asserts `getByRole('button', { name: /open in new window/i })` is present.
- **does not render DetachButton when canDetach=false** — asserts the button is absent.
- **DetachButton is not a direct sibling of child in same div** — asserts the detach button is inside a wrapper with `data-testid="map-panel-shell-controls"` and the child is inside `data-testid="map-panel-shell-content"` (or similar separation); these should be **separate** containers so the absolute-position overlap cannot happen.
- **calls detach when DetachButton clicked** — asserts `detach` mock was called with the panel name.

#### 1b. Collapse-removal assertions in `PlanningInbox.flows.test.tsx`

Extend the existing file with a new `describe('collapse UI removed')` block:

- **no Map section collapse button** — renders `<PlanningInbox />`, asserts `queryByTitle(/Sbalit|collapse|Rozbalit|expand/i)` on the right column returns `null`.
- **no Timeline section collapse button** — same assertion for timeline section header.
- **mapMode collapsed path absent** — `queryByTestId('map-collapsed-bar')` returns `null` (requires adding `data-testid="map-collapsed-bar"` to the `mapCollapsedBar` div in the pre-removal code or just querying by text/aria).
- **localStorage keys not read on mount** — spy on `localStorage.getItem` before render; assert it was **never** called with `'sazinka.inbox.timelineCollapsed'` or `'sazinka.inbox.mapCollapsed'`.

#### 1c. Shared shell data-testid in Plan + Inbox layout tests

Extend or add to `apps/web/src/pages/__tests__/Plan.detach.test.tsx`:

- **Plan map column uses MapPanelShell** — renders `<PlanPage />` (mocks as needed) and asserts `getByTestId('map-panel-shell')` is present.

Add to `PlanningInbox.detachLayout.test.tsx` (existing file):

- **Inbox map wrapper uses MapPanelShell** — asserts `getByTestId('map-panel-shell')` present in desktop layout.

#### 1d. Regression: `localStorage` keys not read

Covered by 1b above. Run separately if needed via `localStorage.getItem` spy.

### Phase 2 — GREEN (implementation)

#### Step A: Introduce `MapPanelShell`

Create `apps/web/src/components/layout/MapPanelShell.tsx`:

```tsx
// Shared wrapper used by both PlanningInbox and Plan.
// Renders an optional DetachButton that does NOT overlap the MapLibre
// NavigationControl (placed at 'top-right').
//
// Layout: `position: relative` outer div fills its flex/grid cell.
// Controls block: absolute, top-right, but right-offset by ~36px
// (MapLibre nav column width) so they stack to the LEFT of the zoom cluster.
interface MapPanelShellProps {
  panelName: string;          // passed to detach()
  children: React.ReactNode;
}
```

Accompanying `MapPanelShell.module.css`:

- `.shell` — `position: relative; width: 100%; height: 100%; overflow: hidden;`
- `.controls` — `position: absolute; top: 8px; right: calc(36px + 8px); z-index: 10; display: flex; flex-direction: column; gap: 4px;` (36 px = MapLibre NavigationControl width)
- `.content` — `width: 100%; height: 100%;`

Export from `apps/web/src/components/layout/index.ts`.

#### Step B: Remove Inbox collapse

In `PlanningInbox.tsx` delete:

- `isTimelineCollapsed`, `setIsTimelineCollapsed`, `toggleTimelineCollapsed` state + callback
- `isMapCollapsed`, `setIsMapCollapsed`, `toggleMapCollapsed` state + callback
- `mapMode === 'collapsed'` branch and the `mapCollapsedBar` JSX block
- The second button in `mapControls` (the "hide map" button that sets `mapMode('collapsed')`)
- The `rightPanelSectionHeader` + `rightPanelCollapseBtn` JSX wrappers around map and timeline sections in `mapAndTimelineContent`; replace with plain `<div className={styles.rightPanelSection}>` children directly rendered without the header band
- `localStorage` reads and writes for the two collapsed keys

In `PlanningInbox.tsx` update `mapPanelContent` and `mapAndTimelineContent`:

- Replace the `.mapPanelWrapper` + `DetachButton` + `RouteMapPanelSelfSufficient` block with `<MapPanelShell panelName="map">…</MapPanelShell>`.

#### Step C: Wire Plan

In `Plan.tsx` replace:

```tsx
{!isDetached('map') && (
  <div className={styles.mapWrapper}>
    {canDetach && <DetachButton … />}
    <RouteMapPanelSelfSufficient />
  </div>
)}
```

with:

```tsx
{!isDetached('map') && (
  <MapPanelShell panelName="map">
    <RouteMapPanelSelfSufficient />
  </MapPanelShell>
)}
```

Remove now-unused `DetachButton` import if it is no longer referenced elsewhere in `Plan.tsx`.

#### Step D: CSS cleanup

In `PlanningInbox.module.css` remove:

- `.rightPanelCollapseBtn` and `.rightPanelCollapseBtn:hover`
- `.mapCollapsedBar`, `.mapCollapsedLabel`
- `.mapPanelWrapper > button` block (overlap hack — replaced by `MapPanelShell.module.css`)

Keep: `.rightPanelSection`, `.rightPanelSectionContent`, `.rightPanelSectionHeader` if anything non-collapse still uses them, otherwise remove. Keep `.mapControls`, `.mapControlButton` (still used for fullscreen button). Keep `.mapResizeHandle` (resize kept). Keep `.rightPanelStack` if still needed by `isDetached('map')` branch.

In `Plan.module.css` keep `.mapWrapper` intact (or reduce to just `flex: 1; overflow: hidden; position: relative` if the shell takes over styling).

### Phase 3 — REFACTOR

- Run `npx vitest run` in `apps/web`; fix any test mock breakage (`CollapseButton` may now be unused in mocks — remove or keep as no-op).
- `cargo clippy` / `cargo fmt` — no expected changes in Rust.
- Remove unused i18n keys: `map_label`, `map_hide`, `map_show` (verify in planner translation files).
- Update `PROJECT_CONTEXT.MD` with a brief changelog entry.

## Files touched

| File | Change type |
|------|-------------|
| `apps/web/src/components/layout/MapPanelShell.tsx` | New |
| `apps/web/src/components/layout/MapPanelShell.module.css` | New |
| `apps/web/src/components/layout/index.ts` | Export `MapPanelShell` |
| `apps/web/src/components/layout/__tests__/MapPanelShell.test.tsx` | New (RED first) |
| `apps/web/src/pages/PlanningInbox.tsx` | Large deletion + shell swap |
| `apps/web/src/pages/PlanningInbox.module.css` | CSS removal |
| `apps/web/src/pages/Plan.tsx` | Shell swap |
| `apps/web/src/pages/Plan.module.css` | Minor simplification |
| `apps/web/src/pages/PlanningInbox.flows.test.tsx` | New `describe` block (RED first) |
| `apps/web/src/pages/__tests__/PlanningInbox.detachLayout.test.tsx` | Add shell assertion |
| `apps/web/src/pages/__tests__/Plan.detach.test.tsx` | Add shell assertion |
| `PROJECT_CONTEXT.MD` | Changelog entry |

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Right column height collapses to 0 after header removal | Assert flex containers still have `min-height: 0` in RTL; visual-check in browser |
| Detach windows broken by DOM structure change | Re-run `PlanningInbox.detach.test.tsx` after implementation |
| Unused i18n keys cause CI noise | Grep and prune during refactor phase |
| MapPanelShell right offset assumes 36 px nav width | Use CSS custom property `--maplibre-nav-width` with fallback `36px`; override if MapLibre version changes control size |

## Definition of done

- [ ] `PRJ_PLAN.MD` updated (this section).
- [ ] RED tests written and failing before any production code change.
- [ ] Collapse section headers gone from Inbox right column (map + timeline).
- [ ] Inner `mapMode === 'collapsed'` path and "hide map" button removed from Inbox.
- [ ] `localStorage` keys `sazinka.inbox.timelineCollapsed` / `sazinka.inbox.mapCollapsed` not read or written.
- [ ] `DetachButton` does not overlap MapLibre zoom controls in Inbox or Plan.
- [ ] Both Plan and Inbox render `data-testid="map-panel-shell"` for the map column.
- [ ] All Vitest tests green (`npx vitest run` in `apps/web`).
- [ ] `PROJECT_CONTEXT.MD` updated.

---

# Collapse Detached Panel Space in Inbox

## Problem

When a panel (map or candidate list) is detached in the Inbox, the container
that held it still occupies significant screen space — an empty `<div />`
inside a percentage-based layout. The user cannot use this space for the
remaining panels.

**Affected layouts:** Dual, Grid, Wide (all three desktop modes).
**Affected panels:** Map, Candidate list.

## Goal

When a panel is detached, its space must be **reclaimed** by the remaining
panels. The empty placeholder must be removed entirely (zero space) or reduced
to a minimal indicator (e.g., a thin "reattach" strip). All existing
functionality must be preserved.

---

## Current Behavior

| Layout | Detached panel | What happens |
|--------|---------------|--------------|
| **Dual** | List | `splitLeftTop` div not rendered; `splitLeftBottom` (detail) expands to full left height. **Already good.** |
| **Dual** | Map | `mapAndTimelineContent` renders the map section header + empty `<div />`; takes ~50% of the right side via `SplitLayout`. |
| **Grid** | List | `tilesCell` with header + empty content occupies 50% of top row. |
| **Grid** | Map | `tilesCell` with header + empty content occupies 50% of bottom row. |
| **Wide** | List | Left panel in `ThreePanelLayout` renders empty `<div />`; occupies ~22% width. |
| **Wide** | Map | Same as Dual — map section header + empty content in right panel. |

## Target Behavior

| Layout | Detached panel | Target |
|--------|---------------|--------|
| **Dual** | List | *(Already works — no change needed.)* |
| **Dual** | Map | Timeline takes full right-side height; map section not rendered. |
| **Grid** | List | Top row: only the detail tile, full width (single panel, no split). |
| **Grid** | Map | Bottom row: only the timeline tile, full width (single panel, no split). |
| **Wide** | List | Switch from `ThreePanelLayout` (3 panels) to 2-panel `SplitView` (center + right). |
| **Wide** | Map | Timeline takes full right-side height; map section not rendered. |

---

## Design

### Key Insight

All changes are in `PlanningInbox.tsx` layout rendering logic. No changes
needed to `SplitLayout`, `SplitView`, or `ThreePanelLayout` components — the
caller simply adjusts what it passes based on `isDetached()`.

### Change 1: `mapAndTimelineContent` — skip map section when detached

The `mapAndTimelineContent` IIFE builds `mapSection` and `timelineSection` and
combines them via `SplitLayout`. When `isDetached('map')`:

- **Do not render `mapSection` at all** (no header, no collapse button, no
  empty div).
- **Return `timelineSection` directly** (no `SplitLayout` needed — timeline
  gets full height).

This fixes Dual and Wide layouts for detached map in one place.

### Change 2: Grid layout — filter out detached panels

Instead of always rendering a 2-panel `SplitView` per row with
`listPanelContent ?? <div />`, conditionally build the panels array:

- **Top row:** If list is detached, render only `[detail]` panel (full width).
  If not, render `[list, detail]`.
- **Bottom row:** If map is detached, render only `[timeline]` panel (full
  width). If not, render `[map, timeline]`.

When a `SplitView` receives a single-panel array, it renders that panel at
100% width. *(Verify this works or handle the edge case.)*

### Change 3: Wide layout — switch to 2-panel when list detached

When `isDetached('list')`:

- Replace `ThreePanelLayout` with a 2-panel `SplitView` containing only
  `center` (detail) and `right` (map+timeline), with adjusted default widths.

When list is attached, use the existing `ThreePanelLayout` as today.

---

## Implementation Plan (TDD)

### Phase 1: Tests (Red)

Write tests **before** any production code changes. All tests must fail
initially.

**File:** `apps/web/src/pages/__tests__/PlanningInbox.detachLayout.test.tsx`

The test approach: render `PlanningInbox` with mocked services and mocked
planner components (same pattern as existing inbox tests), then simulate
detach and assert on the DOM structure.

Since the layout components are mocked, the tests will verify:
- What JSX is passed to `SplitLayout`, `SplitView`, `ThreePanelLayout`
- Whether detached panel containers exist in the DOM

#### Test cases

**Group A: Dual layout + detached map**

1. `dual + map detached: map section header is NOT in the DOM`
2. `dual + map detached: timeline section takes full height (no SplitLayout
   wrapper)`
3. `dual + map detached: timeline content is rendered`
4. `dual + map detached: list panel is still rendered`

**Group B: Grid layout + detached list**

5. `grid + list detached: top row has only 1 panel (detail), not 2`
6. `grid + list detached: detail panel is rendered`

**Group C: Grid layout + detached map**

7. `grid + map detached: bottom row has only 1 panel (timeline), not 2`
8. `grid + map detached: timeline panel is rendered`

**Group D: Wide layout + detached list**

9. `wide + list detached: layout uses 2-panel SplitView, not
    ThreePanelLayout`
10. `wide + list detached: center (detail) and right (map+timeline) are
    rendered`

**Group E: Wide layout + detached map**

11. `wide + map detached: map section header is NOT in the DOM`
12. `wide + map detached: timeline takes full right-panel height`

**Group F: Both detached (corner cases)**

13. `dual + both detached: only detail panel and timeline visible`
14. `grid + both detached: top row has 1 panel, bottom row has 1 panel`
15. `wide + both detached: 2-panel layout with center (detail) and right
    (timeline only)`

**Group G: Functional preservation**

16. `detached map: route timeline still renders stop cards`
17. `detached list: detail panel still renders candidate info`

### Phase 2: Implementation (Green)

#### Step 2a: Modify `mapAndTimelineContent` (fixes Dual + Wide map-detached)

In the `mapAndTimelineContent` IIFE:

```typescript
// If map is detached, skip the map section entirely
if (isDetached('map')) {
  return timelineSection;
}
```

Insert this before the `if (isMapCollapsed)` checks. `timelineSection` already
includes its header and collapse button, so it works standalone.

#### Step 2b: Modify Grid layout (fixes Grid list-detached + map-detached)

Build the `panels` arrays conditionally:

```typescript
const topPanels = [
  ...(!isDetached('list') ? [{ id: 'list', content: tileCell(..., listPanelContent), ... }] : []),
  { id: 'detail', content: tileCell(..., renderDetailPanel()), ... },
];

const bottomPanels = [
  ...(!isDetached('map') ? [{ id: 'map', content: tileCell(..., mapPanelContent), ... }] : []),
  { id: 'timeline', content: tileCell(..., renderRouteTimelineOnly()), ... },
];
```

If `SplitView` doesn't handle single-panel arrays gracefully, add a guard:
when the array has 1 panel, render the content directly without `SplitView`.

#### Step 2c: Modify Wide layout (fixes Wide list-detached)

```typescript
if (layoutMode === 'wide' || !layoutMode) {
  if (isDetached('list')) {
    return (
      <div className={styles.page}>
        {pageHeader}
        {breakWarningBanner}
        <div className={styles.content}>
          <SplitView
            panels={[
              { id: 'center', content: renderDetailPanel(), defaultWidth: 40, minWidth: 25, maxWidth: 60 },
              { id: 'right', content: mapAndTimelineContent, defaultWidth: 60, minWidth: 30, maxWidth: 75 },
            ]}
            className={styles.splitLayout}
          />
        </div>
      </div>
    );
  }
  // ... existing ThreePanelLayout ...
}
```

### Phase 3: Verify (Green)

1. Run all new tests — must pass.
2. Run all existing PlanningInbox tests — must pass without modification.
3. Run production build.
4. Manual verification in all three layouts:
   - Detach map → verify space is reclaimed.
   - Detach list → verify space is reclaimed.
   - Detach both → verify layout is usable.
   - Reattach → verify layout returns to normal.

### Phase 4: Refactor

- Review CSS — remove any dead styles that were only used for detached
  placeholders.
- Ensure no regressions in mobile layout (mobile doesn't use detach).

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| `SplitView` with 1 panel | Test this edge case; add guard if needed |
| Existing tests depend on detached panel structure | No pre-existing tests will be modified (per project rule) — new tests only |
| Mobile layout affected | Mobile doesn't use `isDetached` — not affected |
| Reattach loses panel state | Panel state lives in `PanelStateContext`, not in DOM — reattach picks it up |

---

# Plan Page: Print Route & Export to Google Maps

## Overview

Two new features for the Plan page that allow users to produce outputs from a
planned route:

1. **Print** — one-click print of the map snapshot and route timeline.
2. **Export to Google Maps** — open the route as turn-by-turn directions in
   Google Maps (new browser tab).

Both features are added as buttons in the existing `RouteSummaryActions` bar,
next to Optimize / Break / Delete.

### Decisions (locked)

| Topic | Decision |
|--------|----------|
| **Scope** | **Plan page only** for this release. Inbox wiring is a **follow-up** (not in initial implementation). |
| **Map detachment + print** | **Not applicable on Plan today** — there is no map detach on Plan. Implement **`captureMap()` from the single in-page map** only. **Future:** if Plan gains detach or Inbox gets print, revisit cross-window capture / print-without-map fallback. |
| **Warnings UX** | **Inline non-blocking banner** near the route summary / actions (`role="status"` for export messages). Optional **auto-dismiss** (e.g. 6–8 s) + dismiss control. **No** toast library for now. **Print-only caveats** (e.g. map snapshot missing) may also appear as a **short note inside `buildPrintHtml`** so the PDF/paper is self-explanatory. |
| **`canPrint` / `canExport`** | **`canPrint` is explicitly controlled in Plan** and must be `selectedRouteStops.length > 0 && mapReady` (Print disabled until the map is ready). `canExport` may default to `true` if omitted, but Plan should pass explicit `canExport` based on route data quality (at least one customer stop with coordinates). |

---

## Feature 1: Print Map + Route Timeline

### Problem

Users need a paper or PDF copy of the planned route — the map showing the path
and stops, plus the timeline with ETAs, addresses, and durations — to hand to a
driver or keep as a record.

### Design

#### Approach: Capture-and-Print

1. **Capture the map canvas** — MapLibre renders to WebGL canvas. To read pixels
   from it we need `preserveDrawingBuffer: true` on the Map constructor. Then
   `map.getCanvas().toDataURL('image/png')` returns a data-URL of the current
   viewport.

2. **Build a print document** — Open a new browser window with a minimal HTML
   page containing:
   - Route header: date, crew name, depot name, summary stats.
   - Map image (`<img>` from the data-URL).
   - Timeline table: stop order, customer name, address, ETA, ETD, service
     duration, travel time/distance to next stop.
   - Footer: generated timestamp.

3. **Trigger print** — Call `window.print()` in the new window. **Do not**
   `win.close()` immediately after `print()` — some browsers finish the print
   dialog asynchronously; closing too early can cancel preview. Prefer:
   **`print()` then leave the window open** for the user to close, **or** use
   `setTimeout(() => win.close(), 0)` / `afterprint` event only after manual QA
   on target browsers.

#### Why not `@media print` CSS?

The Plan page layout is complex (resizable sidebar, WebGL canvas, drag-and-drop
timeline). Trying to restyle all of that for print is fragile, hard to test, and
couples print layout to runtime layout. A separate print document is isolated,
fully testable, and gives total control over the print layout.

### Files Changed

**Map implementation (two different files — do not confuse):**

| File | Role |
|------|------|
| `apps/web/src/components/planner/RouteMapPanel.tsx` | **Map UI** — MapLibre `Map` constructor: add `preserveDrawingBuffer: true`; register `registerMapCapture` callback here (this is where `mapRef` lives). |
| `apps/web/src/panels/RouteMapPanel.tsx` | **Smart panel wrapper** — forwards panel state; only needs changes if capture must be bridged from this layer (usually the UI component registers directly with context). |

| File | Change |
|------|--------|
| `apps/web/src/utils/routePrint.ts` | **New** — `buildPrintHtml(params): string` pure function |
| `apps/web/src/utils/routePrint.test.ts` | **New** — unit tests for `buildPrintHtml` |
| `apps/web/src/components/planner/RouteSummaryActions.tsx` | Add optional `onPrint`, `onExportGoogleMaps`, `canPrint`, `canExport` + buttons |
| `apps/web/src/components/planner/RouteSummaryActions.test.tsx` | **New** (no pre-existing file) — button wiring tests |
| `apps/web/src/pages/Plan.tsx` | `handlePrint`, `handleExportGoogleMaps`, inline warning banner state, wire actions |
| `apps/web/src/types/panelState.ts`, `PanelStateContext.tsx` | `registerMapCapture` / `captureMap` |
| `public/locales/{en,cs,sk}/planner.json` | `actions_print`, `actions_export_gmaps`, warning strings |

### HTML escaping (security & robustness)

All **dynamic** text embedded in `buildPrintHtml` (names, addresses, title,
stats, times) must pass through a small **`escapeHtml(s: string): string`**
helper (`&`, `<`, `>`, `"`, `'`) so user content cannot break markup or inject
scripts. Add **unit tests** that prove `<script>` and `&` in a customer name are
escaped to safe text nodes.

### `buildPrintHtml` — Pure Function Signature

```typescript
interface PrintRouteParams {
  title: string;               // e.g. "P1 · D1 · 2026-03-21"
  mapImageDataUrl: string;     // from canvas.toDataURL()
  stops: Array<{
    order: number;
    name: string;
    address: string;
    eta: string | null;
    etd: string | null;
    serviceDuration: string | null;
    stopType: 'customer' | 'break';
  }>;
  depot: { name: string } | null;
  depotDeparture: string | null;
  returnTime: string | null;
  stats: {
    totalTime: string | null;
    workTime: string | null;
    travelTime: string | null;
    distance: string | null;
    stopCount: number;
  };
}

function buildPrintHtml(params: PrintRouteParams): string;
```

Returns a self-contained HTML string with inline CSS. No external dependencies.

### `handlePrint` Handler (Plan.tsx)

```
1. Guard: selectedRouteStops.length === 0 → return early (or rely on disabled Print button).
2. const dataUrl = actions.captureMap() — registered by components/planner/RouteMapPanel.
3. const html = buildPrintHtml({ ... mapImageDataUrl: dataUrl ?? '' ... });
4. const win = window.open('', '_blank');  // synchronous, in same turn as click
5. win.document.write(html);
6. win.document.close();
7. win.onload = () => { win.print(); };  // avoid immediate win.close() — see "Trigger print" above
```

**Popup blockers:** If `handlePrint` becomes `async` (e.g. `await` before `open`),
browsers may block the popup. Prefer: **`window.open` first** (user gesture), then
fill `document` if any async work is added later.

### Map Canvas Access Design

On **Plan**, the map is shown inline (no detach). Add:

- `PanelActions.registerMapCapture(fn: () => string | null): () => void` — map UI
  registers on mount; returns unregister on unmount.
- `PanelActions.captureMap: () => string | null` — calls the registered function.

**Fallback:** If `captureMap()` returns `null` (unexpected readback failure even
when `mapReady` is true), `buildPrintHtml` omits `<img>` and may include a
**short i18n note** in the print document body (`print_map_unavailable` or
similar).

**Future (out of scope for this release):** Plan map detach or print from Inbox
with detached map → consider panel signals + cross-window capture or
timeline-only print; document when that work is scheduled.

---

## Feature 2: Export Route to Google Maps

### Problem

After planning a route, the driver needs turn-by-turn navigation. Google Maps
is the most common navigation tool. The user wants one click to open the full
route (depot → stops → depot) in Google Maps.

### Design

#### Google Maps Directions URL Format

```
https://www.google.com/maps/dir/?api=1
  &origin=LAT,LNG
  &destination=LAT,LNG
  &waypoints=LAT1,LNG1|LAT2,LNG2|...
  &travelmode=driving
```

- **origin**: depot coordinates (start)
- **destination**: depot coordinates (return to depot)
- **waypoints**: customer stops in route order, pipe-separated
- **travelmode**: `driving`

#### Limitations

- Google’s public **directions URL** limits the number of intermediate
  **waypoints** (often cited as **23–25** depending on product/version). **Before
  implementation**, confirm the current documented limit and set the constant in
  `routeExport.ts` accordingly (e.g. `MAX_WAYPOINTS = 23` vs `25`).
- Breaks (`stopType === 'break'`) must be filtered out — they are not locations.
- If the route exceeds the limit, truncate and surface messages via the **inline
  banner** (see **Decisions**).

#### Pure Function

```typescript
interface GoogleMapsExportParams {
  depot: { lat: number; lng: number } | null;
  stops: Array<{
    customerLat: number | null;
    customerLng: number | null;
    stopType: 'customer' | 'break';
  }>;
}

type GoogleMapsWarningCode = 'TRUNCATED' | 'SKIPPED_NO_COORDS' | 'NO_STOPS' | 'NO_DEPOT';

interface GoogleMapsExportResult {
  url: string;
  warnings: GoogleMapsWarningCode[];
  includedStopCount: number;
  totalCustomerStops: number;
}

function buildGoogleMapsUrl(params: GoogleMapsExportParams): GoogleMapsExportResult;
```

Edge cases handled:
- No depot → use first stop as origin, last stop as destination
- No stops → return empty string + warning
- Stops with null coordinates → skip + add warning
- More than `MAX_WAYPOINTS` customer stops → truncate + warning

### Files Changed

| File | Change |
|------|--------|
| `apps/web/src/utils/routeExport.ts` | **New** — `buildGoogleMapsUrl` pure function |
| `apps/web/src/utils/routeExport.test.ts` | **New** — unit tests |
| `apps/web/src/components/planner/RouteSummaryActions.tsx` | Export button (shared with Feature 1 table above) |
| `apps/web/src/pages/Plan.tsx` | `handleExportGoogleMaps` |
| `public/locales/{en,cs,sk}/planner.json` | `actions_export_gmaps`, `export_gmaps_truncated`, banner strings |

---

## TDD Implementation Plan

### Phase 1: Google Maps Export (Red → Green)

Pure logic, no UI dependencies. Fastest to TDD.

#### Tests (`utils/routeExport.test.ts`)

| # | Test | Asserts |
|---|------|---------|
| 1 | depot + 3 customer stops → valid URL | URL contains `origin=depotLat,depotLng`, `destination=depotLat,depotLng`, 3 pipe-separated waypoints, `travelmode=driving` |
| 2 | breaks are excluded from waypoints | Given 2 customers + 1 break → only 2 waypoints in URL |
| 3 | stops with null coordinates are skipped | Given 3 stops (1 with null lat) → 2 waypoints + `'SKIPPED_NO_COORDS'` in warnings |
| 4 | no depot → first stop as origin, last as destination | URL `origin` = first stop coords, `destination` = last stop coords, remaining stops as waypoints |
| 5 | no stops → empty URL + warning | `url === ''`, `warnings` includes `'NO_STOPS'` |
| 6 | single customer stop + depot → **one** waypoint (depot→stop→depot) | `origin`/`destination` = depot; `waypoints` contains **exactly** the one customer `lat,lng` (not “zero waypoints”) |
| 7 | 30 customer stops → truncated to max + warning | waypoints count === `MAX_WAYPOINTS`, `'TRUNCATED'` in warnings |
| 8 | exactly `MAX_WAYPOINTS` customer stops → no truncation warning | `'TRUNCATED'` NOT in warnings |
| 9 | coordinates use max 6 decimal places | No excessive precision in URL |
| 10 | no depot AND no stops → combined edge | `url === ''`, warnings include both `'NO_STOPS'` and `'NO_DEPOT'` |
| 11 | no depot AND single stop → stop is both origin and destination | `origin` = `destination` = stop coords, no `waypoints` param |
| 12 | no depot → `'NO_DEPOT'` warning code is present | Ensures the code path fires (type exists but no earlier test covers it) |
| 13 | all stops are breaks (zero customer stops after filtering) | Same result as "no stops": `url === ''`, `'NO_STOPS'` in warnings |
| 14 | depot present but ALL stops have null coords | URL has `origin`/`destination` = depot only, no `waypoints`, `'SKIPPED_NO_COORDS'` in warnings |
| 15 | mixed: breaks + null coords + valid stops in one call | Combined filtering produces correct waypoints and correct warning codes |
| 16 | negative coordinates (e.g. `-33.8688,151.2093`) | Minus signs preserved in URL; URL is valid |
| 17 | coordinate at `0,0` (lat=0, lng=0) is NOT treated as null | `customerLat: 0` must not be skipped — classic JS falsy bug guard |

#### Implementation (`utils/routeExport.ts`)

Write the `buildGoogleMapsUrl` function. Pure, no side effects.

#### Phase 1 Commit: `feat: add buildGoogleMapsUrl utility with tests`

---

### Phase 2: Print HTML Builder (Red → Green)

Pure logic, no DOM/canvas dependencies.

#### Tests (`utils/routePrint.test.ts`)

| # | Test | Asserts |
|---|------|---------|
| 1 | returns valid HTML string with doctype | Starts with `<!DOCTYPE html>`, contains `<html>`, `</html>` |
| 2 | includes map image when dataUrl provided | Contains `<img` with the data URL as `src` |
| 3 | omits map image when dataUrl is empty string | No `<img` tag in output |
| 4 | renders all customer stops in order | For 3 stops, output contains all 3 names in sequence |
| 5 | skips break stops from the table | Given 2 customers + 1 break → only 2 rows with customer names |
| 6 | includes depot name in header | Contains depot name string |
| 7 | includes title in header | Contains the title string |
| 8 | includes stats (total time, distance, stop count) | Contains all stat values |
| 9 | includes depot departure time | Contains `depotDeparture` value |
| 10 | includes return time | Contains `returnTime` value |
| 11 | handles null ETAs gracefully | Stop with null `eta` → renders `—` or empty cell, no crash |
| 12 | HTML is self-contained (inline styles, no external refs) | No `<link>`, no `<script src=`, no external URLs except the data-URL image |
| 13 | dangerous characters escaped | Input name `"Foo & Bar <script>"` appears escaped in output, not raw HTML |
| 14 | empty stops array → no crash, renders table with no rows or "no stops" note | Zero-stop edge case |
| 15 | depot is `null` → header gracefully omits depot name, no crash | Null depot path |
| 16 | all stats fields are `null` → renders `—` or equivalent, no crash | All-null stats edge |
| 17 | unicode in names (e.g. `Říčany`, `Břeclav`) → renders correctly | i18n / encoding correctness |
| 18 | stop order is preserved: index of name1 < index of name2 < name3 in output | Explicitly assert relative positions, not just "all present" |
| 19 | `escapeHtml` handles all 5 characters individually (`&`, `<`, `>`, `"`, `'`) | Each mapped to its HTML entity |
| 20 | `depotDeparture` is `null` → no crash, renders `—` or omits | Null departure path |

#### Implementation (`utils/routePrint.ts`)

Write `escapeHtml` + `buildPrintHtml`. Returns HTML string.

#### Phase 2 Commit: `feat: add buildPrintHtml utility with tests`

---

### Phase 3: RouteSummaryActions — New Buttons (Red → Green)

#### Tests (new file `RouteSummaryActions.test.tsx` — none exists today)

| # | Test | Asserts |
|---|------|---------|
| 1 | renders print button when `onPrint` is provided | Button with `actions_print` text is in DOM |
| 2 | does not render print button when `onPrint` is undefined | No print button |
| 3 | calls `onPrint` on click | `onPrint` mock called once |
| 4 | renders Google Maps export button when `onExportGoogleMaps` is provided | Button with `actions_export_gmaps` text |
| 5 | does not render export button when `onExportGoogleMaps` is undefined | No export button |
| 6 | calls `onExportGoogleMaps` on click | Mock called once |
| 7 | export disabled when `canExport` is false | `disabled` on export button |
| 8 | print disabled when `canPrint` is false | `disabled` on print button (symmetric with export) |
| 9 | existing buttons (Optimize, Break, Delete) still render when new props added | Regression: all three original buttons present alongside new ones |
| 10 | both `onPrint` AND `onExportGoogleMaps` provided → both buttons render | Combinatorial: two new buttons coexist |
| 11 | neither `onPrint` nor `onExportGoogleMaps` provided → zero new buttons | Baseline: no leakage of print/export UI |
| 12 | disabled print button does not fire `onPrint` on click | `onPrint` mock NOT called when `canPrint = false` |
| 13 | `canPrint` omitted + `onPrint` provided → button is enabled (default `true`) | Tests the documented default behavior |

#### Implementation

Add optional `onPrint`, `onExportGoogleMaps`, `canPrint`, `canExport`. **Defaults:**
if `onPrint` / `onExportGoogleMaps` is provided and `canPrint` / `canExport` is
omitted, treat as **`true`**. Add two buttons with **`title` / `aria-label`**
attributes for icon-only or compact layouts later.

#### Phase 3 Commit: `feat: add Print and Export buttons to RouteSummaryActions`

---

### Phase 4: Map Canvas Capture Infrastructure

#### Changes

1. **`apps/web/src/components/planner/RouteMapPanel.tsx`** — `preserveDrawingBuffer: true`; register/unregister capture in `useEffect`; call `actions.setMapReady(true)` in existing `map.on('load')` handler.
2. **`apps/web/src/types/panelState.ts`** — add `mapReady: boolean` to `PanelState`; add `registerMapCapture`, `captureMap`, `setMapReady` to `PanelActions`.
3. **`apps/web/src/contexts/PanelStateContext.tsx`** — capture registry + `setMapReady` reducer.

#### Tests

| # | Test | Asserts |
|---|------|---------|
| 1 | `captureMap()` returns null when no map registered | `actions.captureMap() === null` |
| 2 | `captureMap()` returns data URL after map registers | Returns string starting with `data:image/png` |
| 3 | `captureMap()` returns null after map unmounts | Register → unregister → `null` |
| 4 | `state.mapReady` is false initially | Default state `mapReady === false` |
| 5 | `state.mapReady` becomes true after `actions.setMapReady(true)` | State updated |
| 6 | `state.mapReady` resets to false after map unmounts / re-registers | Simulates remount → `mapReady` starts `false` again until next `load` |

#### Phase 4 Commit: `feat: add map canvas capture to PanelStateContext`

---

### Phase 5: Wire Handlers in `Plan.tsx` Only

#### Plan.tsx

- **Export:** `buildGoogleMapsUrl` → if `url` non-empty,
  `window.open(url, '_blank', 'noopener,noreferrer')`. Map `result.warnings` to
  i18n strings and set **inline banner** state (`role="status"`). Clear banner
  on next successful action or dismiss.
- **Print:** `captureMap()` → `buildPrintHtml` → `window.open` → write →
  `print()` (see popup/async notes above). If capture unexpectedly returns null,
  map image is omitted and a print-note may appear in HTML.
- **`canPrint` (locked):** `selectedRouteStops.length > 0 && state.mapReady`
  (strict gate: Print button stays disabled until the map fires `load`).
  `mapReady` is a **new boolean in `PanelState`**, set by the map UI component
  via `actions.setMapReady(true)` when `mapLoaded` becomes true (existing
  `map.on('load', ...)` handler).
- **`canExport`:** e.g. at least one customer stop with coordinates.

**Banner UI:** A slim row **below** `routeSummaryBar` (or between stats and
actions — pick one consistent slot), non-blocking, optional auto-dismiss.

#### Tests (integration-level, e.g. `Plan.printExport.test.tsx`)

| # | Test | Asserts |
|---|------|---------|
| 1 | Print flow opens window and writes document | `window.open` spy; `document.write` or equivalent |
| 2 | Export opens Google Maps URL | `window.open` with `google.com/maps/dir` |
| 3 | Export disabled when `canExport` false | per props |
| 4 | Print disabled when `mapReady` is false | `canPrint = false` → button disabled |
| 4b | Print enabled when `mapReady` is true and stops exist | `canPrint = true` → button enabled |
| 5 | Export warning banner appears on truncation/skip warnings | Inline banner rendered with mapped i18n warning text |
| 6 | Export warning banner dismiss/clear behavior | Dismiss hides banner; successful export without warnings clears stale banner |
| 7 | Print fallback note path works when capture returns null unexpectedly | Printed HTML omits map `<img>` and includes `print_map_unavailable` note |
| 8 | Export with zero warnings → no banner shown | Happy-path: banner element absent from DOM |
| 9 | Print succeeds with map capture → written HTML contains `<img` | Happy-path: verify map image is in the printed document |
| 10 | All stops are breaks → `canExport` is false | Edge: no exportable customer stops → button disabled |
| 11 | Banner auto-dismiss clears after timeout (if enabled) | Fake timer: banner disappears after configured interval |

Mock `window.open` to return a stub `document` for assertions. Use fake timers
if auto-dismiss is enabled for banner tests.

#### Phase 5 Commit: `feat: wire Print and Export handlers on Plan page`

---

### Phase 6: Localization + Manual Verification

- **Actions:** `actions_print`, `actions_export_gmaps`.
- **Warnings / banner:** `export_gmaps_truncated`, `export_gmaps_skipped_no_coords`,
  etc.
- **Print HTML:** `print_map_unavailable` (or similar) when snapshot omitted.
- Manual test:
  - Plan a route with 3+ stops.
  - Print (map ready) → preview shows map image + timeline.
  - Export → Google Maps route order matches app.
  - Many stops / invalid coords → **inline banner** shows warning text.
  - Map not ready → Print button is disabled; click does not open popup.
  - Forced capture failure (dev mock) → print opens without map image and shows
    `print_map_unavailable` note.

#### Phase 6 Commit: `feat: add i18n keys for Print and Export actions`

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| `preserveDrawingBuffer: true` has minor perf cost | Negligible for our map usage; no constant re-rendering |
| XSS / broken print layout from raw names | `escapeHtml` on all dynamic strings + test #13 |
| Google waypoint limit changes | Verify docs at implementation time; central `MAX_WAYPOINTS` constant |
| Future: cross-window map capture | Out of scope; see **Decisions** |
| User-visible warnings | **Inline banner** + optional print HTML note (locked) |
| Print window blocked by popup blocker | `window.open` synchronously in click handler; avoid `async` before `open` |
| Map not loaded when print clicked | `canPrint` is strictly gated by `mapReady` (button disabled until ready) |
| `win.close()` vs print dialog | Prefer leave window open or use `afterprint` after QA |
| Large routes / long HTML | Table-only content; acceptable for typical routes |

---

# Import/Export Overhaul — TDD Plan

> **Status:** Phase 5 COMPLETE — ZIP pipeline uses corrected entity logic. Phase 6 in progress.  
> **Context:** Align CSV import/export with code and DB; no backwards compatibility required; DB may be recreated from scratch (admin user preserved).  
> **Constraint from owner:** Build the **complete test suite first**, before production code changes.

---

## Execution contract (strict tests-first + strict TDD)

1. **Test-suite-first gate:** No production-code changes until the full import/export/NATS/frontend test suite from this plan exists and runs (expected RED).
2. **Then strict TDD slices:** for each fix, run targeted tests RED -> implement minimum GREEN -> refactor while GREEN.
3. **No scope drift:** legacy sync import path decision is locked in this plan (see Cross-cutting F).

---

## Definition of “complete” test coverage

“100%” means:

1. **Every case listed in this plan** exists as an automated test.
2. **Coverage gates on touched modules**:
   - **Rust (`cargo llvm-cov`)**
     - `worker/src/handlers/import.rs`
     - `worker/src/handlers/import_processors.rs`
     - `worker/src/services/export_processor.rs`
     - `worker/src/db/queries/import.rs` (if touched)
   - **TypeScript (Vitest coverage)**
     - `apps/web/src/services/import/importService.ts`
     - `apps/web/src/services/importJobService.ts`
     - `apps/web/src/services/exportPlusService.ts`
     - `apps/web/src/components/import/ImportModal.tsx`
     - `apps/web/src/components/customers/ImportCustomersModal.tsx`
     - `apps/web/src/components/shared/ExportPlusPanel.tsx`
     - `apps/web/src/components/import/ImportReportDialog.tsx`
   - **Gate:** at least **85% branch coverage** on touched files; CI fails below.
3. **NATS coverage:** submit/status/download subjects used by import and export are all exercised by tests.

---

## Cross-cutting design decisions (locked)

### A. Parser consolidation

`import.rs` and `import_processors.rs` currently duplicate parsing. Final design:

- Move shared parsing into one module (e.g. `worker/src/services/csv_import_parse.rs`), used by both paths.
- Add parity tests proving same output for same inputs.

### B. Dual header support

- Canonical export/docs headers are **snake_case**.
- Import accepts both **snake_case** and existing **camelCase** aliases.

### C. Work log deterministic grouping

For grouping by `(customer_ref, scheduled_date)`:

- Keep original file order within each group.
- Visit-level fields use deterministic conflict rule: first non-empty wins.

### D. Export row model for `work_log.csv`

- Export will emit **one row per work item** (not one row per visit).
- `load_dataset` must load `visit_work_items` (batch by `visit_id`) and join to visit/customer/device context.

### E. Round-trip-safe fallback references

To avoid non-reimportable UUID fallbacks:

- `customer_ref` export priority: ICO -> email -> phone -> `customer_uuid:<uuid>`.
- `device_ref` export priority: serial_number -> device_name -> device_type (if unique) -> `device_uuid:<uuid>`.
- Import resolvers must recognize `customer_uuid:` and `device_uuid:` prefixes before normal heuristics.

### F. Legacy import path scope

- No backwards compatibility required.
- Legacy sync batch handlers in `import.rs` marked dead code are **out of target runtime path**.
- Plan includes explicit cleanup step after parity: remove or isolate legacy path to avoid dual behavior.

### G. NATS subject consistency is mandatory

Known mismatch must be fixed and covered:

- Backend customer status prefix currently `sazinka.job.import.status`.
- Frontend listens on `sazinka.job.import.customer.status`.
- Final subject contract must be single and documented.

### H. Route export strategy

- No “uuid or label” ambiguity.
- Route-related refs are exported as stable UUID strings (or documented explicit prefixed refs), consistently.

### I. CI prerequisites

- CI job must run with Postgres and NATS services for mandatory test suites.
- No “optional CI” for core contract tests.

### J. Edge/stress bucket

| Case | Expectation |
|------|-------------|
| UTF-8 BOM | Header parsed correctly |
| Empty ZIP / missing required files | Graceful error |
| Unknown ZIP files | Ignored or warned (defined behavior) |
| Header-only CSV | `totalRows=0` correct report |
| Quoted semicolon values | Preserved round-trip |
| Near 20k rows | Bounded runtime and memory |
| Concurrent imports same user | Defined queue/lock behavior |

---

## Problems addressed

| # | Severity | Issue | Planned fix |
|---|----------|-------|-------------|
| 1 | CRITICAL | `device_name` missing in JetStream device CSV struct | Add field and wire through create/update |
| 2 | CRITICAL | `device_type_config_id` omitted in `create_device_import` | Resolve and bind config ID like `device::create_device` |
| 3 | CRITICAL | Communication `date` parsed but not persisted | Pass and store as created timestamp |
| 4 | CRITICAL | Work log `visit_type` vs `work_type` inconsistency | Unify to `work_type` across Rust/TS/export/docs |
| 5 | CRITICAL | Work log `duration_minutes`/`findings` dropped | Parse and persist to work items |
| 6 | CRITICAL | Work log `device_ref` ignored | Resolve and attach `device_id` |
| 7 | MODERATE | Customer `type` missing in Rust CSV row | Add + aliases + behavior tests |
| 8 | MODERATE | Work log grouping absent | Implement deterministic grouping logic |
| 9 | MODERATE | Export pseudo IDs break round-trip | Replace with real refs + prefixed UUID fallback |
| 10 | MODERATE | Device export lacks `device_name` | Add canonical column |
| 11 | MODERATE | Customer import status subject mismatch FE/BE | Fix contract and tests |
| 12 | MODERATE | Frontend tests miss import/export UI flows | Add modal/panel/component tests |
| 13 | MINOR | Czech aliases undocumented | Update `PRJ_IMPORT.MD` |
| 14 | MINOR | Wrong NATS/Web Worker docs | Update `PRJ_IMPORT.MD` |
| 15 | MINOR | Legacy sync path ambiguity | Remove/isolate after parity |

---

## Canonical CSV formats

Delimiter: `;`, UTF-8.

| File | Header columns (order) |
|------|-------------------------|
| `customers.csv` | `type`, `name`, `contact_person`, `ico`, `dic`, `street`, `city`, `postal_code`, `country`, `phone`, `email`, `notes` |
| `devices.csv` | `customer_ref`, `device_type`, `device_name`, `manufacturer`, `model`, `serial_number`, `installation_date`, `revision_interval_months`, `notes` |
| `revisions.csv` | `device_ref`, `customer_ref`, `due_date`, `status`, `scheduled_date`, `scheduled_time_start`, `scheduled_time_end`, `completed_at`, `duration_minutes`, `result`, `findings` |
| `communications.csv` | `customer_ref`, `date`, `comm_type`, `direction`, `subject`, `content`, `contact_name`, `contact_phone`, `duration_minutes` |
| `work_log.csv` | `customer_ref`, `scheduled_date`, `scheduled_time_start`, `scheduled_time_end`, `device_ref`, `work_type`, `status`, `result`, `duration_minutes`, `result_notes`, `findings`, `requires_follow_up`, `follow_up_reason` |
| `routes.csv` (export-only) | `route_id`, `date`, `status`, `crew_id`, `crew_name`, `depot_id`, `total_distance_km`, `total_duration_minutes`, `optimization_score`, `stops_count` |
| `route_stops.csv` (export-only) | `route_id`, `stop_order`, `stop_type`, `customer_ref`, `revision_ref`, `customer_name`, `address`, `eta`, `etd`, `break_duration_minutes`, `break_time_start`, `scheduled_date`, `scheduled_time_start`, `scheduled_time_end`, `revision_status` |

---

## Phase 0 (tests only): build full suite before code changes

### 0.1 Rust unit tests (parsers/helpers/reporting)
- `parse_*` helpers EN/CS/invalid
- `classify_error`
- `build_import_report`

### 0.2 Rust DB-backed tests (`#[sqlx::test]`)
- `resolve_customer_ref` and `resolve_device_ref`
- CRUD/update/dedup behavior per entity
- Work log grouping expectations
- `device_type_config_id` insertion requirements

### 0.3 Rust processor tests
- Customer/device/revision/communication/work log/zip process jobs
- Status payload correctness
- Subject constants contracts

### 0.4 Rust export tests
- Header and ordering snapshots
- Real ref resolution rules including prefixed UUID fallback
- Work item row model for work_log export
- CSV escaping

### 0.5 Frontend tests
- `importService.test.ts` extension (headers, edge cases)
- New `importJobService.test.ts`, `exportPlusService.test.ts`
- New component tests:
  - `ImportModal`
  - `ImportCustomersModal`
  - `ExportPlusPanel`
  - `ImportReportDialog`

### 0.6 NATS contract/integration tests
- Submit -> status -> completed for each import type
- Export submit -> status -> download
- Auth and error paths
- Mandatory in CI with NATS + Postgres services

**Commit after Phase 0:** `test(import-export): complete baseline suite (expected red)` ✅ DONE

---

## Implementation phases (strict TDD slices)

### Phase 1: Parser consolidation and subject contract
- Make parser/shared-helper tests pass.
- Fix customer status subject mismatch.
- Keep all unrelated tests failing.
- Commit: `fix(import): consolidate parsers and align customer status subject` ✅ DONE

### Phase 2: Customer + device import fixes
- Add customer `type`.
- Add device `device_name`.
- Fix `device_type_config_id` insertion.
- Commit: `fix(import): customer type and device config integrity` ✅ DONE

### Phase 3: Revision + communication fixes
- Ensure date/time and duplicate handling.
- Persist communication CSV `date`.
- Commit: `fix(import): revisions and communication date persistence` ✅ DONE

### Phase 4: Work log correctness
- Unify `work_type`.
- Parse and persist duration/findings/device_ref.
- Deterministic grouping into visit + work items.
- Commit: `fix(import): work log schema and grouping` ✅ DONE

### Phase 5: ZIP pipeline alignment
- Ensure ZIP imports use corrected entity logic and reports.
- Commit: `fix(import): zip pipeline parity` ✅ DONE

### Phase 6: Export overhaul ✅ DONE
- Real refs + prefixed UUID fallback.
- Add missing columns and work item-based work_log export.
- Lock route/route_stops ref strategy.
- Commit: `fix(export): canonical round-trip-safe csv output`

### Phase 7: Frontend alignment ✅ DONE
- Header alias support and new tests.
- Modal/panel/report behavior validation.
- Commit: `fix(frontend): import-export contract and ui tests`

### Phase 8: Legacy path cleanup + docs ✅ DONE
- Remove/isolate dead legacy sync import path.
- Update `PRJ_IMPORT.MD` with final contracts, aliases, NATS subjects.
- Commit: `docs+refactor(import): remove legacy ambiguity and update docs`

---

## Estimated effort

| Phase | ~Hours |
|-------|--------|
| 0 (tests only) | 5 |
| 1 | 2 |
| 2 | 3 |
| 3 | 2 |
| 4 | 3 |
| 5 | 1.5 |
| 6 | 3 |
| 7 | 2.5 |
| 8 | 1 |
| **Total** | **~23** |

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Test-suite-first increases early RED noise | Track failures by phase labels and fixed order |
| Parser divergence returns later | Single shared parser module + parity tests |
| Round-trip breaks on fallback refs | Prefixed UUID fallback with importer support |
| CI instability | Dedicated services and deterministic fixtures |
| Legacy path regressions | Explicit cleanup phase with scope lock |

---

# Page Filter Persistence — Full URL Sync

## Problem

When a user leaves a page and returns, filters reset to defaults. The Plan page
always resets the date to "today", crew and depot to empty. This is because
filter state lives in React `useState` (destroyed on unmount) and the URL is
only partially synced. The same gap exists on Routes and Customers.

## Goal

Every page that has user-configurable filters must persist the full filter state
in URL search params so that:

1. Navigating away and back preserves the last configuration.
2. Browser back/forward restores previous filter state.
3. URLs are shareable and bookmarkable.
4. Page refresh preserves filters.

## Scope

| Page | Current state | Gap |
|------|--------------|-----|
| **Plan** | `date` synced to URL on change; `crew`/`depot` only written when date changes; `dateTo`/`isDateRange` never synced | Crew/depot/dateTo/isDateRange changes lost on navigation |
| **Routes** | Same partial sync as Plan (`dateFrom` only writes URL) | Crew/depot/dateTo changes lost |
| **Customers** | Reads URL params on mount but never writes back on filter change | All filter changes lost |
| **WorkLog** | Full sync via `syncUrl` on every filter change | **No gap — reference implementation** |
| **Calendar** | Full sync via `updateSearchParams` on every filter change | **No gap** |

## Design

Adopt the WorkLog `syncUrl` pattern on all three pages. Each page gets a single
`syncUrl(params)` function that calls `navigate({ to, search, replace: true })`
with the merged current filter state. Every filter change handler calls `syncUrl`
in addition to `setState`.

### Plan page changes

**Search params schema** (extends current `date`, `crew`, `depot`):

```typescript
interface PlannerSearchParams {
  date?: string;      // dateFrom (existing)
  dateTo?: string;    // new — only present when range mode is active
  crew?: string;      // existing
  depot?: string;     // existing
}
```

**Changes:**

1. Add `syncUrl` helper (like WorkLog) that merges all filter values into
   `navigate({ to: '/plan', search: { ... }, replace: true })`.
2. `handleDateFromChange` — already calls `navigate`; refactor to use `syncUrl`.
3. `handleDateToChange` — add `syncUrl({ dateTo: value })`.
4. `handleCrewFilterChange` — add `syncUrl({ crew: value })`.
5. `handleDepotFilterChange` — add `syncUrl({ depot: value })`.
6. `handleToggleRange` — when collapsing range, remove `dateTo` from URL.
7. Initialize `dateTo` from `searchParams.dateTo ?? searchParams.date ?? today`.
8. Initialize `isDateRange` from
   `!!searchParams.dateTo && searchParams.dateTo !== (searchParams.date || today)`.
9. Server preferences (default crew/depot) still apply only when URL params are
   absent.

### Routes page changes

**Search params schema** (extends current `dateFrom`, `crew`, `depot`):

```typescript
interface RoutesSearchParams {
  dateFrom?: string;
  dateTo?: string;
  crew?: string;
  depot?: string;
}
```

**Changes:**

1. Add `syncUrl` helper (same pattern, `to: '/routes'`).
2. Add `syncUrl` call to `handleDateToChange`.
3. Add `syncUrl` call to `handleCrewFilterChange`.
4. Add `syncUrl` call to `handleDepotFilterChange`.
5. Refactor `handleDateFromChange` to use `syncUrl`.

### Customers page changes

**Search params schema** (new — currently no URL write-back):

```typescript
interface CustomersSearchParams {
  view?: 'table' | 'cards';
  geocodeStatus?: string;
  hasOverdue?: string;
  sortBy?: string;
  sortOrder?: string;
  search?: string;
  type?: string;
}
```

**Changes:**

1. Add `syncUrl` helper (same pattern, `to: '/customers'`).
2. Call `syncUrl` from every filter/sort/view change handler.
3. Initialize `typeFilter` from `searchParams.type`.
4. Initialize `search` from `searchParams.search`.
5. Debounce text search URL sync (300ms) via `setTimeout`/`clearTimeout`
   ref pattern — no new dependency.
6. When clearing a filter, write `undefined` (not empty string) so the param is
   removed from the URL entirely.

### What does NOT change

- **WorkLog** — already has full `syncUrl`.
- **Calendar** — already has full `updateSearchParams`.
- **PlanningInbox** — uses `sessionStorage` for complex ephemeral state (drag
  context, selected candidate, scroll position); not changed in this initiative.
- Backend / Rust worker — no changes.
- Route definitions in `routes/index.tsx` — no `validateSearch` added
  (matches existing untyped pattern across all pages; typed search validation is
  a separate initiative).

---

## TDD Phases

### Phase 0: Tests (RED) — all tests written before any production code

Write all test cases first. They will fail because the sync behavior does not
exist yet.

#### 0.1 Plan page URL sync tests

**File:** `apps/web/src/pages/__tests__/Plan.urlSync.test.tsx`

Mock setup: same pattern as existing `Plan.detach.test.tsx` — mock NATS, route
service, crew service, settings service, geometry service, router, i18n. Capture
`navigate` mock calls to assert URL search params.

| # | Test | Asserts |
|---|------|---------|
| 1 | `initializes dateFrom from URL ?date= param` | `dateFrom` input has the URL value, not today |
| 2 | `initializes crew from URL ?crew= param` | crew select shows the URL crew value |
| 3 | `initializes depot from URL ?depot= param` | depot select shows the URL depot value |
| 4 | `defaults dateFrom to today when no URL param` | `dateFrom` input has today's date |
| 5 | `changing crew updates URL with crew param` | `navigate` called with `search` containing `crew` |
| 6 | `changing depot updates URL with depot param` | `navigate` called with `search` containing `depot` |
| 7 | `changing dateFrom updates URL with all current filters` | `navigate` search includes `date`, `crew`, `depot` |
| 8 | `changing dateTo in range mode updates URL` | `navigate` search includes `dateTo` |
| 9 | `toggling range off removes dateTo from URL` | `navigate` search does NOT include `dateTo` |
| 10 | `initializes dateTo from URL ?dateTo= param in range mode` | range mode active, `dateTo` input has URL value |
| 11 | `initializes isDateRange=true when URL has dateTo different from date` | range toggle is active |
| 12 | `initializes isDateRange=false when URL has no dateTo` | range toggle is inactive |
| 13 | `server preferences apply when URL params absent` | crew defaults to preference, not empty |
| 14 | `server preferences do NOT override URL params` | URL crew takes priority over preference |
| 15 | `navigate uses replace: true (no history pollution)` | `navigate` options include `replace: true` |
| 16 | `empty crew/depot written as undefined (clean URL)` | selecting "all crews" writes `crew: undefined` |

#### 0.2 Routes page URL sync tests

**File:** `apps/web/src/pages/__tests__/Routes.urlSync.test.tsx`

| # | Test | Asserts |
|---|------|---------|
| 1 | `initializes dateFrom from URL ?dateFrom= param` | input value matches URL |
| 2 | `initializes dateTo from URL ?dateTo= param` | input value matches URL |
| 3 | `initializes crew from URL ?crew= param` | select value matches URL |
| 4 | `initializes depot from URL ?depot= param` | select value matches URL |
| 5 | `defaults to ±7 day range when no URL params` | inputs show weekAgo and weekAhead |
| 6 | `changing crew updates URL` | `navigate` search includes `crew` |
| 7 | `changing depot updates URL` | `navigate` search includes `depot` |
| 8 | `changing dateTo updates URL` | `navigate` search includes `dateTo` |
| 9 | `changing dateFrom preserves other params in URL` | all filter values present in `navigate` search |
| 10 | `navigate uses replace: true` | options include `replace: true` |

#### 0.3 Customers page URL sync tests

**File:** `apps/web/src/pages/__tests__/Customers.urlSync.test.tsx`

| # | Test | Asserts |
|---|------|---------|
| 1 | `initializes viewMode from URL ?view= param` | renders in correct mode |
| 2 | `initializes geocodeFilter from URL ?geocodeStatus= param` | filter has URL value |
| 3 | `initializes sortBy from URL ?sortBy= param` | sort shows URL value |
| 4 | `initializes sortOrder from URL ?sortOrder= param` | sort direction matches URL |
| 5 | `defaults to table view when no URL param` | renders table mode |
| 6 | `defaults sortBy to name when no URL param` | sort is "name" |
| 7 | `changing viewMode updates URL` | `navigate` search includes `view` |
| 8 | `changing geocodeFilter updates URL` | `navigate` search includes `geocodeStatus` |
| 9 | `changing sortBy updates URL` | `navigate` search includes `sortBy` |
| 10 | `changing sortOrder updates URL` | `navigate` search includes `sortOrder` |
| 11 | `changing revisionFilter updates URL` | `navigate` search includes `hasOverdue` |
| 12 | `changing typeFilter updates URL` | `navigate` search includes `type` |
| 13 | `text search updates URL after debounce` | `navigate` called after 300ms, not before |
| 14 | `rapid text input only triggers one URL update` | single `navigate` call after debounce settles |
| 15 | `clearing text search removes search param from URL` | `search: undefined` in navigate |
| 16 | `initializes text search from URL ?search= param` | search input shows URL value |
| 17 | `navigate uses replace: true` | options include `replace: true` |
| 18 | `empty filter values written as undefined (clean URL)` | clearing geocodeFilter removes param |

#### 0.4 Cross-page navigation persistence test

**File:** `apps/web/src/pages/__tests__/filterPersistence.integration.test.tsx`

A lightweight integration test proving the core user story works end-to-end with
the router.

| # | Test | Asserts |
|---|------|---------|
| 1 | `Plan: set date+crew → navigate to Customers → navigate back → date+crew preserved` | After back-navigation, Plan mounts with URL params from the previous visit |
| 2 | `Routes: set crew+depot → navigate away → return → crew+depot preserved` | Same pattern |
| 3 | `Customers: set sort+filter → navigate away → return → sort+filter preserved` | Same pattern |

These tests use TanStack Router's `createMemoryHistory` to simulate navigation
without a real browser.

**Commit after Phase 0:** `test(filters): url sync tests for Plan, Routes, Customers (expected red)`

---

### Phase 1: Plan page — full URL sync (GREEN)

**Scope:** Make Phase 0.1 tests pass.

**Changes in `Plan.tsx`:**

1. Add `syncUrl` helper:

```typescript
const syncUrl = useCallback((params: Partial<PlannerSearchParams>) => {
  navigate({
    to: '/plan',
    search: {
      date: params.date ?? dateFrom,
      dateTo: isDateRange ? (params.dateTo ?? dateTo) : undefined,
      crew: (params.crew ?? filterCrewId) || undefined,
      depot: (params.depot ?? filterDepotId) || undefined,
    } as Record<string, string | undefined>,
    replace: true,
  });
}, [dateFrom, dateTo, isDateRange, filterCrewId, filterDepotId, navigate]);
```

2. Refactor `handleDateFromChange` to use `syncUrl`.
3. Add `syncUrl` call to `handleDateToChange`.
4. Add `syncUrl` call to `handleCrewFilterChange`.
5. Add `syncUrl` call to `handleDepotFilterChange`.
6. Add `syncUrl` call to `handleToggleRange` (remove `dateTo` when collapsing).
7. Update initialization:

```typescript
const [dateFrom, setDateFrom] = useState(searchParams?.date || today);
const [dateTo, setDateTo] = useState(
  searchParams?.dateTo || searchParams?.date || today
);
const [isDateRange, setIsDateRange] = useState(
  !!searchParams?.dateTo
    && searchParams.dateTo !== (searchParams.date || today)
);
```

**Commit:** `fix(plan): full url sync for all filter params`

---

### Phase 2: Routes page — full URL sync (GREEN)

**Scope:** Make Phase 0.2 tests pass.

**Changes in `Routes.tsx`:**

1. Add `syncUrl` helper (same pattern, `to: '/routes'`).
2. Add `syncUrl` call to `handleDateToChange`.
3. Add `syncUrl` call to `handleCrewFilterChange`.
4. Add `syncUrl` call to `handleDepotFilterChange`.
5. Refactor `handleDateFromChange` to use `syncUrl`.

**Commit:** `fix(routes): full url sync for all filter params`

---

### Phase 3: Customers page — full URL sync (GREEN)

**Scope:** Make Phase 0.3 tests pass.

**Changes in `Customers.tsx`:**

1. Add `syncUrl` helper (same pattern, `to: '/customers'`).
2. Call `syncUrl` from every filter/sort/view change handler.
3. Initialize `typeFilter` and `search` from URL params.
4. Add debounced URL sync for text search (300ms via `setTimeout`/`clearTimeout`
   ref pattern — no new dependency).
5. When clearing a filter, write `undefined` (not empty string) so the param is
   removed from the URL entirely.

**Commit:** `fix(customers): full url sync for all filter params`

---

### Phase 4: Cross-page integration + refactor (GREEN)

**Scope:** Make Phase 0.4 tests pass. Clean up.

1. Verify cross-page navigation tests pass (they should if Phases 1–3 are
   correct).
2. Remove any dead code from the old partial-sync patterns.
3. Verify no regressions in existing page test suites.
4. Run full `npx vitest run` in `apps/web`.

**Commit:** `test(filters): verify cross-page filter persistence`

---

## Corner Cases (covered by tests)

| Corner case | Expected behavior | Test phase |
|-------------|-------------------|------------|
| URL has `?date=` but no `?crew=` | Date from URL, crew from server preferences (if set), else empty | 0.1 #13, #14 |
| URL has stale crew ID (deleted crew) | Crew select shows empty/unknown; filter applies but returns no matches; no crash | Manual QA |
| `dateTo` in URL without `date` | `dateFrom` defaults to today, `dateTo` from URL, range mode active | 0.1 #10, #11 |
| Empty string filter values | Written as `undefined` to keep URL clean | 0.1 #16, 0.3 #18 |
| Rapid text search typing (Customers) | URL updates only after 300ms debounce | 0.3 #13, #14 |
| Browser back after filter change | Previous filter state restored from URL | 0.4 #1–3 |
| Direct URL entry with all params | All filters initialized from URL | 0.1 #1–3, 0.2 #1–4, 0.3 #1–4 |
| `replace: true` prevents history bloat | Each filter change replaces current entry, not pushes | 0.1 #15, 0.2 #10, 0.3 #17 |
| Range mode toggled off | `dateTo` removed from URL; `dateTo` state set to `dateFrom` | 0.1 #9 |
| Page refresh | URL params survive; filters restored exactly | Same as direct URL entry |

---

## Files Touched

| File | Change |
|------|--------|
| `apps/web/src/pages/Plan.tsx` | Add `syncUrl`; refactor filter handlers; update initialization |
| `apps/web/src/pages/Routes.tsx` | Add `syncUrl`; add sync to crew/depot/dateTo handlers |
| `apps/web/src/pages/Customers.tsx` | Add `syncUrl`; add sync to all filter/sort/view handlers; debounced search; init from URL |
| `apps/web/src/pages/__tests__/Plan.urlSync.test.tsx` | New — 16 test cases |
| `apps/web/src/pages/__tests__/Routes.urlSync.test.tsx` | New — 10 test cases |
| `apps/web/src/pages/__tests__/Customers.urlSync.test.tsx` | New — 18 test cases |
| `apps/web/src/pages/__tests__/filterPersistence.integration.test.tsx` | New — 3 integration test cases |

## Estimated Effort

| Phase | ~Hours |
|-------|--------|
| 0 (tests — RED) | 3 |
| 1 (Plan sync) | 1 |
| 2 (Routes sync) | 0.5 |
| 3 (Customers sync) | 1.5 |
| 4 (Integration + cleanup) | 0.5 |
| **Total** | **~6.5** |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| URL becomes long with many params | Only non-default values written; empty/default values are `undefined` (omitted) |
| Debounce timer leaks on unmount | Clear timeout in cleanup return of `useEffect` or `useCallback` ref |
| TanStack Router search params lose type safety | Matches existing `useSearch({ strict: false })` pattern; typed validation is a separate initiative |
| Stale URL params (e.g. deleted crew ID) | Graceful: filter applies but returns no data; user can clear; no crash |
| `replace: true` vs `push` | All filter changes use `replace` to avoid polluting history with every click |
