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
| `src/pages/PlanningInbox.tsx` | `planningInbox.*` | Legacy dual-write window — remove after Phase 8 migration window closes |
| `src/pages/Settings.tsx` | `planningInbox.enforceDrivingBreakRule` | Cross-page write — migrate to UPP commit in next major refactor |

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
