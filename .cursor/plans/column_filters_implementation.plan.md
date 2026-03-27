---
name: Column Filters Implementation
overview: Excel-style per-column filters for Customers grid. Canonical plan with v2 coverage improvements lives in PRJ_PLAN_COLUMN_FILTERS.MD at repo root.
todos:
  - id: read-canonical
    content: Implement from PRJ_PLAN_COLUMN_FILTERS.MD (single source of truth)
    status: pending
isProject: false
---

# Column Filters — pointer

The full TDD plan, test matrix, and Definition of Done are in:

**[PRJ_PLAN_COLUMN_FILTERS.MD](../../PRJ_PLAN_COLUMN_FILTERS.MD)**

**Short link from main plan:** [PRJ_PLAN.MD](../PRJ_PLAN.MD) — section "Column Filters — Excel-style".

**v2 coverage additions:** count-query parity with list query, `getCustomerSummary` global vs filtered (v1 global + tests), NATS distinct handler tests, Rust serde round-trip, date inclusive bounds + invalid range, cards view still sends `columnFilters`, UPP corruption, SQLx prepare, duplicate column first-wins.
