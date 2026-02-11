# Solver Architecture

> **Last Updated:** 2026-02-02 (v0.18.6 — frontend time window pass-through, point arrival mapping)

## Overview

Sazinka uses a **Vehicle Routing Problem with Time Windows (VRPTW)** solver to optimize daily routes for tradespeople (chimney sweeps, HVAC technicians, etc.). The solver takes a set of customer stops with optional time constraints and produces an ordered route that minimizes travel distance/time while respecting all scheduling constraints.

## Architecture

```
Frontend (React)                    NATS JetStream                   Rust Worker
────────────────                    ──────────────                   ───────────
PlanningInbox.tsx                   sazinka.route.submit             handlers/jobs.rs
Planner.tsx                                                         ┌─────────────────────┐
 │                                                                  │ execute_route_plan() │
 │  submitRoutePlanJob({                                            │                     │
 │    customerIds,                                                  │ 1. Load customers   │
 │    date,                         ┌──────────────┐                │ 2. Resolve TWs      │
 │    startLocation,       ────────►│ SAZINKA_JOBS │───────────────►│ 3. Get matrices     │
 │    crewId?,                      │ (WorkQueue)  │                │ 4. Build VRP problem│
 │    timeWindows?  ◄──────────     └──────────────┘                │ 5. Solve            │
 │  })                status updates                                │ 6. Build geometry   │
 │                                                                  └──────┬──────────────┘
 │                                                                         │
 │                                                                         ▼
 │                                                              ┌──────────────────────┐
 │                                                              │ VrpSolver            │
 │                                                              │ ├─ vrp-pragmatic     │
 │                                                              │ │  (primary)         │
 │                                                              │ └─ nearest-neighbor  │
 │                                                              │    (fallback)        │
 │                                                              └──────────────────────┘
```

## Components

### 1. Frontend: Time Window Extraction

**Files:** `apps/web/src/pages/PlanningInbox.tsx`, `apps/web/src/pages/Planner.tsx`, `apps/web/src/services/routeService.ts`

When the user clicks "Optimalizovat", the frontend extracts `scheduledTimeStart` and `scheduledTimeEnd` from each `SavedRouteStop` and passes them as `timeWindows` in the `RoutePlanJobRequest`. This ensures the solver sees exactly the same time windows the user sees in the UI.

```typescript
// routeService.ts
export interface CustomerTimeWindow {
  customerId: string;
  start: string;  // "HH:MM"
  end: string;    // "HH:MM"
}

export interface RoutePlanJobRequest {
  customerIds: string[];
  date: string;
  startLocation: Coordinates;
  crewId?: string;
  timeWindows?: CustomerTimeWindow[];  // Takes priority over DB lookup
}
```

**Critical invariant:** `timeWindows` are only included when `length > 0`. An omitted or empty array causes the backend to fall back to database lookup.

### 2. Backend: Time Window Resolution

**File:** `worker/src/handlers/jobs.rs` — `load_customers_for_route()`

Time window resolution follows a strict priority chain:

| Priority | Source | When Used |
|----------|--------|-----------|
| 1 | **Frontend `timeWindows`** | Always preferred when present and parseable |
| 2 | **`revisions` table** | Fallback when frontend doesn't provide windows |
| 3 | **`visits` table** | Legacy fallback when revision has no window |

The frontend time windows are parsed from both `"HH:MM"` and `"HH:MM:SS"` formats.

### 3. VRP Problem Builder

**File:** `worker/src/handlers/jobs.rs` — `build_vrp_problem()`

Converts `CustomerForRoute` records into `VrpProblem` with these key mappings:

#### Point Time Window Mapping

Scheduled customer visits use **point time windows** `[start, start]`:

```
Customer slot: 08:00 – 09:00 (agreed visit time)
  → VRP time window: [08:00, 08:00]  (arrive exactly at slot start)
  → Service duration: 60 minutes      (full slot length, not default)
```

**Rationale:** The `scheduled_time_start`/`end` represent a _work slot_, not an arrival range. The crew must arrive at the start of the slot. Setting `start == end` forces `vrp-pragmatic` to schedule arrival exactly at that time.

#### Unscheduled Customers

Customers without agreed times get:
- No time window constraint (arrive anytime within shift)
- Default service duration from user settings (typically 30 min)

### 4. VRP Solver

**File:** `worker/src/services/vrp/mod.rs`

The `VrpSolver` wraps both solving strategies:

#### Primary: vrp-pragmatic (Metaheuristic)

**Files:** `worker/src/services/vrp/pragmatic.rs`, `worker/src/services/vrp/adapter.rs`

Uses the `vrp-pragmatic` crate (pure Rust) with guided local search metaheuristics:

```rust
// Cargo.toml
vrp-pragmatic = "1.25"
vrp-core = "1.25"
vrp-cli = "1.25"
```

**Features:**
- Hard and soft time window constraints
- Service duration per stop
- Vehicle shift (working hours)
- Mandatory breaks with configurable window
- Arrival buffer (configurable % of segment travel time)
- Single vehicle (crew) model

**Execution model:** `solve()` is `async` — the CPU-bound solver runs in `tokio::task::spawn_blocking` wrapped with `tokio::time::timeout` (config time + 10s buffer).

#### Fallback: Nearest-Neighbor Heuristic

**File:** `worker/src/services/vrp/mod.rs` — `nearest_neighbor()` + `build_solution()`

Used when vrp-pragmatic fails, panics, or times out:

1. **Phase 1:** Sort stops with hard time windows by window start (earliest first)
2. **Phase 2:** Fill remaining stops by nearest-neighbor from current position
3. **Build solution:** Calculate arrival/departure times, wait if early, warn if late

The heuristic always emits a `SOLVER_FALLBACK` warning so the user knows the result may be suboptimal.

### 5. Arrival Buffer

**File:** `worker/src/services/vrp/adapter.rs` — `apply_arrival_buffer()`

For range time windows (not point windows), the solver shifts the window start earlier by a configurable percentage of the estimated segment travel time:

```
Buffer = arrival_buffer_percent × avg_travel_time_to_stop
Example: 10% × 45 min = 4.5 min → arrive 4.5 min early

Original window: [10:00, 12:00]
Buffered window: [09:55:30, 12:00]
```

**Important:** Point windows (`start == end`) are **never** buffered — they represent fixed appointments where the exact arrival time matters.

The buffer percentage comes from crew settings (default: 10%).

### 6. Routing Engine (Valhalla)

**File:** `worker/src/services/routing/`

Valhalla provides real road distance/time matrices:

- `POST /sources_to_targets` — N×N distance/time matrix
- `POST /route` — Detailed route geometry (GeoJSON LineString for map display)

**Fallback:** If Valhalla is unavailable, `MockRoutingService` uses Haversine × 1.3 coefficient and 40 km/h average speed.

## Configuration

### Solver Config Presets

| Preset | `max_time_seconds` | `max_generations` | Use Case |
|--------|-------------------|-------------------|----------|
| `instant` | 2 | 200 | Interactive preview |
| `fast` | 5 | 500 | Route planning (current default) |
| `default` | 30 | 3000 | Background optimization |
| `quality` | 60 | 10000 | Best results (batch mode) |

The production route planning job uses `SolverConfig::with_buffer(5, 500, arrival_buffer_percent)`.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VALHALLA_URL` | — | Valhalla endpoint (e.g. `http://localhost:8002`) |

## Data Flow (Complete)

```
1. User clicks "Optimalizovat" in PlanningInbox or Planner
   ↓
2. Frontend extracts timeWindows from saved route stops
   ↓
3. submitRoutePlanJob() sends NATS request to sazinka.route.submit
   Payload: { customerIds, date, startLocation, crewId?, timeWindows? }
   ↓
4. JobProcessor.process_job() picks up from JetStream
   ↓
5. load_customers_for_route():
   - For each customer ID:
     a. Check frontend timeWindows map → use if found and parseable
     b. Else query revisions table → use if found
     c. Else query visits table → use if found
     d. Else → no time window
   ↓
6. build_vrp_problem():
   - Scheduled customers → point time window [start, start], service = slot length
   - Unscheduled customers → no window, service = default from settings
   - Shift: crew working hours (or user settings fallback)
   - Break: from user settings (if enabled)
   ↓
7. Valhalla /sources_to_targets → distance/time matrices
   ↓
8. VrpSolver.solve():
   - Primary: vrp-pragmatic (spawn_blocking + timeout)
   - Fallback: nearest-neighbor heuristic
   ↓
9. Map solution → RoutePlanResponse
   ↓
10. Valhalla /route → GeoJSON geometry for map display
    ↓
11. Publish JobStatus::Completed with result → Frontend updates
```

## Module Structure

```
worker/src/services/vrp/
├── mod.rs          # VrpSolver: async solve(), heuristic fallback, build_solution()
├── adapter.rs      # build_pragmatic_problem(), build_pragmatic_matrix(), arrival buffer
├── pragmatic.rs    # solve_pragmatic(): vrp-pragmatic integration, solution mapping
├── problem.rs      # VrpProblem, VrpStop, StopTimeWindow, BreakConfig, Depot
├── solution.rs     # RouteSolution, PlannedStop, RouteWarning
└── config.rs       # SolverConfig presets (instant/fast/default/quality)

worker/src/handlers/
└── jobs.rs         # JobProcessor: load_customers_for_route(), build_vrp_problem(),
                    #   execute_route_plan(), time window resolution chain

worker/src/types/
└── job.rs          # CustomerTimeWindow, RoutePlanJobRequest (with time_windows field)

apps/web/src/services/
└── routeService.ts # CustomerTimeWindow, RoutePlanJobRequest, submitRoutePlanJob()

apps/web/src/pages/
├── PlanningInbox.tsx  # handleOptimizeRoute() — extracts timeWindows from route stops
└── Planner.tsx        # handleOptimizeRoute() — same extraction logic
```

## Test Coverage

### Rust Tests

| File | Tests | What They Guard |
|------|-------|-----------------|
| `worker/src/types/job.rs` | 6 tests | `CustomerTimeWindow` serde (camelCase), `RoutePlanJobRequest` deserialization with/without `timeWindows`, `#[serde(default)]` for missing field, roundtrip preservation |
| `worker/src/services/vrp/mod.rs` | 13 tests | Solver config, empty/single/multi-stop problems, heuristic ordering (no-window nearest-neighbor, windowed-by-start), heuristic waiting for hard windows, late arrival warnings, `add_seconds_to_time` |
| `worker/src/services/vrp/adapter.rs` | 14 tests | Problem JSON structure, time window encoding, point time window validity, break deserialization, arrival buffer (shift/noop/midnight clamp/point window skip), matrix flattening |
| `worker/src/services/vrp/pragmatic.rs` | 8 tests | End-to-end pragmatic solve, service duration accounting, break config acceptance/placement, point time window assignment, post-solve validation (late/insufficient buffer/ok) |
| `worker/src/services/vrp/problem.rs` | 3 tests | Type construction |
| `worker/src/services/vrp/solution.rs` | 3 tests | Empty solution, planned stop, warning types |
| `worker/src/services/vrp/config.rs` | 7 tests | Config presets, custom config, buffer config |

### TypeScript Tests

| File | Tests | What They Guard |
|------|-------|-----------------|
| `apps/web/src/services/routeService.test.ts` | 6 tests | `submitRoutePlanJob` includes/excludes `timeWindows` correctly, empty array handling, `crewId` pass-through, error propagation, `CustomerTimeWindow` type shape |

## Key Invariants (Do Not Break)

1. **Frontend time windows take priority** over database lookups. The `time_windows` field in `RoutePlanJobRequest` must always be checked first in `load_customers_for_route()`.

2. **Point time window mapping:** Scheduled visits must use `[start, start]` (not `[start, end]`) so the solver forces arrival at the slot start. Service duration must equal the slot length (`end - start`).

3. **Arrival buffer skips point windows:** `apply_arrival_buffer()` must return the window unchanged when `start == end`.

4. **`#[serde(default)]` on `time_windows`:** The field must have `#[serde(default)]` so older clients or requests without this field still deserialize correctly.

5. **Solver fallback chain:** vrp-pragmatic failure → nearest-neighbor heuristic. Never silently fail — always produce a solution or error.

6. **`timeWindows` exclusion when empty:** The frontend must not send `timeWindows: []` — either send the populated array or omit the field entirely.

## Performance

| Stops | Solver | Typical Time | Notes |
|-------|--------|-------------|-------|
| 1–5 | vrp-pragmatic | <100ms | Near-instant |
| 5–10 | vrp-pragmatic | 100–500ms | Normal daily route |
| 10–15 | vrp-pragmatic | 500ms–2s | Maximum practical size |
| >15 | vrp-pragmatic | 2–5s | May hit timeout |
| Any | heuristic fallback | <10ms | Fast but suboptimal |

Memory: ~10 MB per request.

## Troubleshooting

### "Time windows are ignored"

Check the worker log for lines like:
```
Customer <uuid> (<name>): using frontend time window Some(08:00:00)-Some(09:00:00)
```

If you see "falling back to DB" or no time window log at all, the frontend is not passing `timeWindows` in the request.

### "Solver falls back to heuristic"

Look for `pragmatic_error=`, `pragmatic_panic=`, or `pragmatic_timeout=` in `solver_log`. Common causes:
- Invalid break config format (fixed in v0.18.4)
- Infeasible problem (all stops unassignable within shift)
- Timeout (increase `max_time_seconds`)

### "Stop is unassigned"

The solver may mark stops as unassigned when:
- Time window cannot be met (e.g., two stops with overlapping point windows and insufficient travel time)
- Working hours are too short for all stops + travel
- Break constraint conflicts with time windows

Check `solver_log` for `unassigned: <customer_name> - <reason>`.
