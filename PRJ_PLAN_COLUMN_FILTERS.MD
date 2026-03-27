# Column Filters (Excel-style) — Implementation Plan

**Status:** Draft (coverage-improved v2)  
**TDD:** Red → Green → Refactor for every phase; commit after each phase where practical.  
**Related:** Customers grid, NATS `sazinka.customer.list.extended`, new `sazinka.customer.column.distinct`.

---

## Design decisions (locked)

| Topic | Decision |
|-------|----------|
| Checklist columns (9) | name, type, city, street, postalCode, phone, email, geocodeStatus, deviceCount |
| Date range columns (2) | nextRevision, createdAt |
| Legacy UI | Remove `geocodeFilter` and `typeFilter` dropdowns (desktop bar + mobile sheet) |
| Kept in bar | Search, revision chips, column picker, view toggle, advanced toggle |
| Filter trigger | Small always-visible icon per column header (table view) |
| Distinct values | Server-side (`sazinka.customer.column.distinct`) with context-aware filtering |
| Distinct list scope | Apply all active filters **except** the target column's own filter |
| Distinct scaling | Server-side search + pagination (`query`, `limit`, `offset`, `hasMore`) |
| Composition | Column filters AND together |
| Legacy profile cleanup | Remove deprecated `geocodeFilter`/`typeFilter` controls from `customersProfile`; stale persisted keys are safely ignored |
| **Duplicate `column` entries in `columnFilters` array** | **First wins** — later duplicates ignored (sanitize + backend must match) |

---

## Product: `getCustomerSummary` vs column filters

**Decision (v1):** `getCustomerSummary` continues to return **global** stats for the user (not filtered by `columnFilters`). Rationale: summary is a dashboard KPI strip; aligning it with filters requires API changes and product sign-off.

**Tests:**  
- Assert summary request payload **does not** include `columnFilters` (or explicitly documents no filter args).  
- Document in `PRJ_CONTEXT.MD` that summary is global while the list is filtered.

**Follow-up (optional):** add `summaryRespectsFilters` or a separate endpoint — out of scope unless product asks.

---

## Distinct endpoint semantics (locked)

- Request includes:
  - `column` (required)
  - `query?: string`, `limit?: number`, `offset?: number`
  - current list context filters: `search`, `hasOverdue`, `nextRevisionWithinDays`, `columnFilters`
- Backend applies all context filters, but excludes filters whose `column` equals the target `column`.
- Only checklist-capable columns are valid for distinct lookup; date-range columns are rejected.
- Response includes `values: string[]`, `total: number`, `hasMore: boolean`.
- Ordering is deterministic: ascending, case-insensitive; empty value (`""`) is normalized and returned last.

---

## Summary: coverage improvements (v2 vs v1)

| Area | Addition |
|------|----------|
| **Count query** | Tests that `total` / count SQL uses the **same** `column_filters` (and WHERE/HAVING) as the main list query — no drift. Includes mandatory automated DB integration tests (no manual-only fallback). |
| **Pagination** | Filtered list: `total` matches DB; `loadMore` offset respects filtered set; empty page returns `total: 0`. |
| **NATS handler** | `handle_column_distinct`: auth failure, invalid/missing column, success path (mock pool or integration). |
| **Serde** | Rust: **serialize** + deserialize round-trip for `ColumnFilter` and `ListCustomersRequest` with `column_filters`. |
| **Dates** | Inclusive day bounds (document), invalid ISO rejected, `from > to` rejected server-side **or** only client-side — **both layers**: client UX + server rejects invalid range. |
| **Timezone** | Store/send **date-only** strings (`YYYY-MM-DD`); treat as **date** in SQL (`::date`), not timestamptz ambiguity — tests for boundary day. |
| **Distinct semantics** | Context-aware distinct values, target-column exclusion, server-side query/limit/offset, deterministic ordering, `hasMore` coverage. |
| **Cards view** | Same `requestOptions` as table — `columnFilters` still sent when user switched to cards after setting filters (UPP). |
| **UPP / profile** | `columnFilters` in `customers.grid`: default `[]`, corrupted storage → `sanitizeColumnFilters` → `[]`; missing key → `[]`. Deprecated `customers.filters` controls (`geocodeFilter`, `typeFilter`) removed with stale-key compatibility tests. |
| **SQLx** | New queries: run `cargo sqlx prepare` / document offline cache update in Phase 7 checklist. |
| **i18n** | New keys `filter_*`, `col_filter_*` — cs/en/sk parity smoke test or checklist in DoD. |

**Path fixes:** All test paths use `__tests__/` (not `lib/tests/`).

---

## Must-run tests first (strict sequence)

Run these in order during implementation. Do not proceed to the next gate until the current gate is green.

1. **TS catalog and filter contract gate**  
   File: [`apps/web/src/lib/__tests__/customerColumns.test.ts`](apps/web/src/lib/__tests__/customerColumns.test.ts)  
   Must prove: `filterType` mapping, `isValidColumnFilter`, `sanitizeColumnFilters`, duplicate-first-wins.

2. **Rust wire-contract gate**  
   File: [`worker/src/types/customer.rs`](worker/src/types/customer.rs) `#[cfg(test)]`  
   Must prove: serde deserialize + serialize + round-trip for `ColumnFilter`, `ListCustomersRequest` with `column_filters`.

3. **Backend filter-clause unit gate**  
   File: [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs) `#[cfg(test)]`  
   Must prove: WHERE/HAVING split for all 11 columns, injection safety, param index correctness.

4. **Backend count parity integration gate (mandatory)**  
   File: [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs) integration tests (`#[sqlx::test]` or existing DB harness)  
   Must prove: filtered `items` and `total` stay consistent, including pagination parity (`offset` pages, same total).

5. **Date-boundary correctness gate**  
   File: [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs) tests  
   Must prove: explicit `::date` bounds are inclusive; exact boundary days included; adjacent days excluded.

6. **Distinct endpoint backend gate**  
   Files: [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs), [`worker/src/handlers/customer.rs`](worker/src/handlers/customer.rs) tests  
   Must prove: target-column exclusion semantics, context-aware filtering, pagination/search, deterministic ordering, auth + invalid column handling.

7. **Distinct service-contract frontend gate**  
   File: [`apps/web/src/services/customerService.ts`](apps/web/src/services/customerService.ts) tests  
   Must prove: exact NATS subject, forwards context/query/limit/offset, parses `hasMore`.

8. **Customers request payload gate**  
   File: [`apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx`](apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx)  
   Must prove: `columnFilters` forwarded on initial load and loadMore, cards mode still forwards filters, summary remains global.

9. **Header interaction safety gate**  
   File: [`apps/web/src/components/customers/__tests__/CustomerTable.test.tsx`](apps/web/src/components/customers/__tests__/CustomerTable.test.tsx)  
   Must prove: filter icon opens dropdown and never triggers sort; sort and filter indicators coexist.

10. **Dropdown behavior gate**  
    Files:  
    - [`apps/web/src/components/customers/__tests__/ChecklistFilterDropdown.test.tsx`](apps/web/src/components/customers/__tests__/ChecklistFilterDropdown.test.tsx)  
    - [`apps/web/src/components/customers/__tests__/DateRangeFilterDropdown.test.tsx`](apps/web/src/components/customers/__tests__/DateRangeFilterDropdown.test.tsx)  
    Must prove: loading/error/search/select-all-visible/date validation/apply-clear semantics.

11. **Legacy removal and migration gate**  
    Files:  
    - [`apps/web/src/components/customers/__tests__/CustomerFilterBar.test.tsx`](apps/web/src/components/customers/__tests__/CustomerFilterBar.test.tsx)  
    - [`apps/web/src/components/customers/__tests__/MobileFilterSheet.test.tsx`](apps/web/src/components/customers/__tests__/MobileFilterSheet.test.tsx)  
    - [`apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx`](apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx)  
    Must prove: legacy geocode/type controls are absent, stale persisted keys do not affect behavior or counts.

12. **Revision-chip interaction gate**  
    File: [`apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx`](apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx)  
    Must prove: revision chips and `nextRevision` dateRange filter combine with AND semantics; clear-all resets both.

13. **Final regression gate**  
    Files:
    - [`apps/web/src/pages/__tests__/Customers.sortModel.test.tsx`](apps/web/src/pages/__tests__/Customers.sortModel.test.tsx)  
    - All updated customer filter suites  
    Must prove: `sortModel` + `columnFilters` coexist with no payload regression.

14. **Release hygiene gate**  
    Must run:
    - frontend test suites for all changed files  
    - `SQLX_OFFLINE=true cargo test` on updated Rust modules  
    - `cargo sqlx prepare` update committed  
    - docs update in [`PRJ_CONTEXT.MD`](PRJ_CONTEXT.MD)

---

## Phase 1 — Shared types and column catalog

### Deliverables

- **TS:** `ColumnFilter` union, `columnFilters?` on `ListCustomersRequest`, and `ColumnDistinctRequest` / `ColumnDistinctResponse` in [`packages/shared-types/src/customer.ts`](packages/shared-types/src/customer.ts), including `query`/`limit`/`offset` and `hasMore`.
- **Catalog:** `filterType: 'checklist' | 'dateRange'` on every column in [`apps/web/src/lib/customerColumns.ts`](apps/web/src/lib/customerColumns.ts); `getFilterType`, `isValidColumnFilter`, `sanitizeColumnFilters` (**duplicate column: first wins**).
- **Rust:** `ColumnFilter` enum, `column_filters` on `ListCustomersRequest`, and distinct request/response in [`worker/src/types/customer.rs`](worker/src/types/customer.rs), mirroring `query`/`limit`/`offset` and `has_more`.

### Tests (TS) — [`apps/web/src/lib/__tests__/customerColumns.test.ts`](apps/web/src/lib/__tests__/customerColumns.test.ts)

- All v1 cases (filterType per column, validators, invalid shapes, empty array).
- **sanitizeColumnFilters duplicates:** `[{city: A}, {city: B}]` → first city entry kept only.
- **`ALL_COLUMNS.length` guard** if still 11 columns with filterType.

### Tests (Rust) — `worker/src/types/customer.rs` `#[cfg(test)]`

- All v1 deserialize cases.
- **Serialize:** `ColumnFilter::Checklist { ... }` → JSON → deserialize equals original.
- **Round-trip:** full `ListCustomersRequest` with `column_filters` + `sort_model`.
- **Invalid UTF-8 / edge:** N/A at serde level; skip.

---

## Phase 2 — Backend: `column_filters` in list + **count query**

### Deliverables

- `build_column_filter_clauses` + wire into `list_customers_extended` **and** the **count** subquery path in [`worker/src/db/queries/customer.rs`](worker/src/db/queries/customer.rs).

### Tests — `customer.rs` `#[cfg(test)]`

- All v1 builder tests (WHERE/HAVING, deviceCount, dates, injection, param_idx).
- **Count parity:** helper or test that **given the same `req`**, the WHERE/HAVING fragment used for count matches the one used for the main query (shared builder — assert single source of truth).
- **Integration (mandatory):** automated DB test (`#[sqlx::test]` or existing integration harness) where a filter matching exactly 3 rows yields `total == 3`.
- **Pagination integration (mandatory):** `limit=2, offset=0` vs `offset=2` with same filters returns disjoint sets and same `total`.
- **No manual-only fallback:** integration parity coverage must run in CI for this feature.

### Corner cases

- **Empty `values` in checklist:** skipped (already in v1).
- **`createdAt` bounds are explicit:** `c.created_at::date >= $N::date` and `c.created_at::date <= $M::date` (inclusive).
- **`nextRevision` bounds are explicit:** `MIN(r.due_date) FILTER (...) >= $N::date` and `<= $M::date` (inclusive).
- **Boundary tests:** rows on exact `from`/`to` days are included; adjacent-day rows excluded.

---

## Phase 3 — Distinct values endpoint

### Deliverables

- `get_column_distinct_values`, `sazinka.customer.column.distinct`, [`customerService.getColumnDistinctValues`](apps/web/src/services/customerService.ts).
- Distinct request carries context (`search`, revision filters, `columnFilters`) plus `query`/`limit`/`offset`.
- Distinct response returns `values`, `total`, and `hasMore`.
- Backend excludes target-column filter from context when computing its distinct options.

### Tests — Rust

- v1 `column_to_distinct_sql` tests.
- **Handler:** `handle_column_distinct` — invalid column → error response; missing auth → error; success returns `values` + `total`.
- **SQLx:** after adding query, **`cargo sqlx prepare`** committed in CI/offline cache.
- **Context semantics:** `city` distinct call with active `type=company` filter narrows city list; active `city` filter itself is ignored for city distinct.
- **Server pagination/search:** `query` narrows values; `limit`/`offset` paginate; `hasMore` reflects remaining rows.
- **Deterministic ordering:** case-insensitive ascending; empty value normalized to `""` and appears last.

### Tests — Frontend service

- v1 cases + **subject string** exact match `sazinka.customer.column.distinct`.
- Forwards `query`/`limit`/`offset` and context filters unchanged.
- Parses and returns `hasMore` correctly.

---

## Phase 4 — Dropdown components

### Tests — ChecklistFilterDropdown

- v1 cases.
- **Retry:** optional “Retry” on fetch failure if implemented; else assert error UI + dismiss.
- **Select all when search narrows list:** “select all” applies to **visible** rows only (document + test).

### Tests — DateRangeFilterDropdown

- v1 cases.
- **Invalid date string** in input (if free text): validation message.
- **Same day from and to:** valid (inclusive single day).

### Tests — ColumnFilterDropdown

- v1 + passes **initial filter** from parent for edit mode.

---

## Phase 5 — CustomerTable headers

### Tests — [`CustomerTable.test.tsx`](apps/web/src/components/customers/__tests__/CustomerTable.test.tsx)

- v1 cases.
- **Dropdown positioning:** `fixed`/`portal` if used — smoke test that dropdown mounts (no crash).
- **Focus:** first focusable inside dropdown on open (optional a11y).

---

## Phase 6 — Customers page + legacy removal

### Deliverables

- UPP `columnFilters` on grid profile; `requestOptions` includes sanitized filters; remove geocode/type props from bar and sheet.
- Update [`apps/web/src/persistence/profiles/customersProfile.ts`](apps/web/src/persistence/profiles/customersProfile.ts): remove `geocodeFilter` and `typeFilter` controls (deprecated); hydration remains tolerant of stale keys in stored blobs.

### Tests — [`Customers.columnFilters.test.tsx`](apps/web/src/pages/__tests__/Customers.columnFilters.test.tsx)

- v1 payload + UPP + legacy DOM absence.
- **Cards mode:** `viewMode === 'cards'` → `listCustomersExtended` still receives `columnFilters` from UPP when filters were set in table mode (simulate: set filters in table, switch to cards, assert last call includes filters).
- **Summary:** `getCustomerSummary` called **without** column filter params (or as per product decision).
- **Clear all:** clears `columnFilters`, search, revision chips; **mock** `setUppColumnFilters` or similar.
- **Revision + column date interaction:** revision chip (`overdue`/`week`/`month`) and `nextRevision` column dateRange are both sent and combined with AND semantics.
- **Revision + clear-all interaction:** clear all resets revision chips and removes `nextRevision` dateRange filter together.
- **Legacy persistence migration:** stale `geocodeFilter`/`typeFilter` values in persisted `customers.filters` state do not crash, do not affect request payload, and do not appear in active filter count.

### Tests — FilterBar / MobileSheet

- Update/remove geocode/type tests as in v1.

### Tests — [`Customers.sortModel.test.tsx`](apps/web/src/pages/__tests__/Customers.sortModel.test.tsx)

- Update props if `CustomerTable` / page mocks change; **assert `sortModel` + `columnFilters` together** in one test (no regression).

---

## Phase 7 — Documentation

- [`PRJ_CONTEXT.MD`](PRJ_CONTEXT.MD): v0.24.0, NATS subjects, duplicate-first-wins, summary global vs list filtered, inclusive date semantics.
- **DoD checklist:** sqlx cache, i18n keys, all tests green.

---

## Definition of done (column filters)

- [ ] Duplicate `column` in `columnFilters`: **first wins** (TS sanitize + Rust skip duplicates).
- [ ] List **total** count matches filtered dataset (count query uses same logic as list).
- [ ] `getCustomerSummary` behavior documented and tested (global KPIs in v1).
- [ ] `handle_column_distinct` tested with invalid column + auth failure paths.
- [ ] Rust serde **round-trip** for `ColumnFilter` on the wire.
- [ ] Cards view still sends `columnFilters` when filters active.
- [ ] Date range: inclusive bounds documented; invalid ranges rejected.
- [ ] New SQL: `sqlx` offline data updated.
- [ ] Legacy geocode/type dropdowns removed; DOM tests prove absence.
- [ ] Distinct endpoint is context-aware (target-column exclusion), paginated, searchable, deterministic, and exposes `hasMore`.
- [ ] Deprecated `customers.filters` controls (`geocodeFilter`, `typeFilter`) removed from profile with stale-key compatibility verified.
- [ ] Mandatory automated DB integration tests validate filtered `items`/`total` parity and pagination parity.
- [ ] Revision chips + `nextRevision` column dateRange coexistence and clear-all behavior are explicitly tested.
- [ ] `PRJ_CONTEXT.MD` updated.

---

## Files touched (reference)

See implementation in repo: `packages/shared-types`, `apps/web/src/lib/customerColumns.ts`, `customerService.ts`, `CustomerTable.tsx`, `Customers.tsx`, `CustomerFilterBar.tsx`, `MobileFilterSheet.tsx`, `apps/web/src/persistence/profiles/customersProfile.ts`, `apps/web/src/persistence/profiles/customersGridProfile.ts`, `worker/src/db/queries/customer.rs`, `worker/src/types/customer.rs`, `worker/src/handlers/customer.rs`, `worker/src/handlers/mod.rs`.
