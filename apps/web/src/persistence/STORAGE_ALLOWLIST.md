# UPP Storage Allowlist

Files that legitimately access `localStorage` / `sessionStorage` directly
(outside of UPP adapters) and are **explicitly excluded** from any future
ESLint `no-direct-storage` rule.

| File | Key(s) | Reason |
|------|--------|--------|
| `src/stores/authStore.ts` | `sazinka.auth.*` | Auth tokens — security-sensitive, intentionally outside UPP |
| `src/components/common/ErrorBoundary.tsx` | `sazinka.errorLog` | Error logging — must survive UPP failures |
| `src/persistence/adapters/SessionStorageAdapter.ts` | (all UPP keys) | UPP adapter — this IS the abstraction layer |
| `src/persistence/adapters/LocalStorageAdapter.ts` | (all UPP keys) | UPP adapter — this IS the abstraction layer |
| `src/pages/PlanningInbox.tsx` | `planningInbox.context`, `planningInbox.selectedId` | Route timeline critical — intentionally outside UPP (direct storage for safety) |
| `src/pages/PlanningInbox.tsx` | `planningInbox.filters`, `planningInbox.enforceDrivingBreakRule` | Legacy dual-write window — UPP is primary, direct write kept for backward compatibility |
| `src/pages/Settings.tsx` | `planningInbox.enforceDrivingBreakRule` | Cross-page write — reads by Inbox via UPP legacy seeding; direct key kept for Settings compatibility |

## Deferred layout keys

| Key | Current storage | Decision |
|-----|----------------|----------|
| `planner.sidebarWidth` | `localStorage` | Deferred — not in UPP profile (layout preference, not filter) |
| `planner.routeListHeight` | `localStorage` | Deferred — not in UPP profile (layout preference, not filter) |
| `sazinka.layoutPreference` | `localStorage` | Deferred — managed by `useLayoutMode` hook |
| `sazinka.snooze.defaultDays` | `localStorage` | Deferred — not a filter, rarely changes |

## Migration status

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 0 | ✅ Done | Safety baseline guard tests |
| Phase 1 | ✅ Done | Core contracts + orchestrator |
| Phase 2 | ✅ Done | Adapter contract suite |
| Phase 3 | ✅ Done | Control plugin registry |
| Phase 4 | ✅ Done | React integration layer |
| Phase 5 | ✅ Done | Customers page migration |
| Phase 6 | ✅ Done | Routes page migration |
| Phase 7 | ✅ Done | Plan page migration (filters only) |
| Phase 8 | ✅ Done | Inbox migration with legacy compatibility bridge |
| Phase 9 | ✅ Done | Cleanup, allowlist, docs |

## UPP Wiring Status (P0–P6)

| Phase | Status | Description |
|-------|--------|-------------|
| P0 | ✅ Done | Route timeline guard tests — context/selectedId invariants |
| P1 | ✅ Done | Wiring primitives: resolveValue, singletons, legacySeed; debounce fix |
| P2 | ✅ Done | Customers page wired — all 7 controls via sessionStorage |
| P3 | ✅ Done | Routes page wired — all 5 controls via sessionStorage, server defaults respected |
| P4 | ✅ Done | Plan page wired — removed hand-rolled plan.filters, URL sync on mount |
| P5 | ✅ Done | PlanningInbox partial wiring — split profiles (session/local), legacy seeding |
| P6 | ✅ Done | Cleanup: barrel exports, allowlist updated, full suite green |

## Pages NOT using UPP (intentional)

| Page | Reason |
|------|--------|
| `CustomerDetail` | No filter state to persist |
| `Settings` | Writes to direct localStorage keys (cross-page contract) |
| `Login` / `Register` | No filter state |
