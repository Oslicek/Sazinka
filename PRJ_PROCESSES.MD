# Business Processes & Customer Lifecycle

> **Status**: Draft — consolidated after review; model/policy decisions recorded.  
> **Last-Modified**: 2026-03-11

---

## 1. Problem Statement

The Planning Inbox is the dispatcher's primary work surface. Its job is to answer one question: **"Who do I need to deal with next?"**

Currently the inbox queries `revisions` via `INNER JOIN`, so only customers that already have a revision record appear. This breaks down because:

- Newly imported customers have no revisions → invisible to the dispatcher.
- Customers whose devices have due dates far in the future (>60 days) are filtered out by the date window.
- There is no concept of "I called this customer, they said call back in summer" — the only deferral mechanism is `revisions.snooze_until`, which is device-scoped, not customer-scoped.

The inbox must be **customer-centric**, not revision-centric.

---

## 2. Customer Lifecycle

A customer moves through discrete states. Each state implies a different dispatcher action.

```
                ┌─────────────┐
   Import ────►│  UNTOUCHED   │  No communication, no actions
                └──────┬──────┘
                       │ first contact attempt
                       ▼
                ┌─────────────┐     dispatcher schedules
                │ NEEDS_ACTION │◄─── next action
                │  (pending)   │     │
                └──────┬──────┘     │ all actions completed,
                       │            │ no next action created
                       │ action     │
                       │ scheduled  │
                       ▼            │
                ┌─────────────┐     │
                │   ACTIVE     │────┘  Has a planned next action
                └──────┬──────┘

  Any state except DELETED:
       │
       │ dispatcher explicitly abandons
       ▼
  ┌─────────────┐     dispatcher removes abandoned status
  │  ABANDONED   │──── or schedules action ────► back to inbox (ACTIVE or NEEDS_ACTION)
  └──────┬──────┘
         │ dispatcher deletes (GDPR anonymization)
         ▼
  ┌─────────────┐
  │  DELETED     │  PII scrubbed, row kept as
  └─────────────┘  "Smazaný zákazník NNNNN";
                   historical records preserved
```

### 2.1. State Definitions

| State | Condition | Inbox visibility |
|---|---|---|
| **UNTOUCHED** | Zero rows in `communications` for this customer. No planned actions. | Always visible — highest priority group. |
| **NEEDS_ACTION** | Customer has some history (communications or past planned actions) but no open/snoozed planned action. Dispatcher should decide what to do next (call, schedule visit, etc.). Merges the former CONTACTED and IDLE states. This is the fallback state: any non-deleted, non-abandoned customer that is neither untouched nor active lands here. | Visible — rank 3 (lowest among non-abandoned). |
| **ACTIVE** | Has at least one open planned action: a scheduled visit, a pending callback, or an upcoming task (e.g. revision). | Visible. Sort rank 1 (overdue) or 2 (upcoming). Ordered by next action date (closest first; for multi-device customers, the nearest due date across all devices). |
| **ABANDONED** | Explicitly marked by the dispatcher. Never automatic — no timeout or inactivity heuristic. Stored as a flag (`is_abandoned`) on the customer row. The dispatcher can remove the abandoned status (clears the flag); the customer then reappears in the inbox. Alternatively, scheduling a new planned action also clears the flag. | Excluded from the Planning Inbox. Visible **only on the Customers page**, which must have a filter to show abandoned customers. The most common action for abandoned customers is deletion (GDPR anonymization). |
| **DELETED** | PII irrecoverably anonymized (name → "Smazaný zákazník NNNNN", address/phone/email/notes/GPS cleared). `is_anonymized = TRUE`, `deleted_at` set. Row preserved for historical record linkage. Open planned actions deleted. Devices soft-deleted — device type and work journal descriptions preserved for historical tasks. | Never visible. Historical visits, communications, and completed actions remain linked to the anonymized row. |

### 2.2. State Derivation: Hybrid Approach

`ABANDONED` and `DELETED` are **stored states** (explicit dispatcher actions), while the remaining states are **computed at query time** from existing data.

**Required schema additions**:
- `customers.is_abandoned BOOLEAN NOT NULL DEFAULT FALSE`
- `customers.deleted_at TIMESTAMPTZ` (already have `is_anonymized`)

**Lifecycle state derivation**:

```sql
CASE
  WHEN c.is_anonymized = TRUE
    THEN 'deleted'
  WHEN c.is_abandoned = TRUE
    THEN 'abandoned'
  WHEN NOT EXISTS (SELECT 1 FROM communications WHERE customer_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM planned_actions WHERE customer_id = c.id)
    THEN 'untouched'
  WHEN EXISTS (SELECT 1 FROM planned_actions WHERE customer_id = c.id AND status IN ('open', 'snoozed'))
    THEN 'active'
  ELSE 'needs_action'
END AS lifecycle_state
```

The `CASE` is evaluated top-down: stored states (`deleted`, `abandoned`) are checked first via flags, then the dynamic states (`untouched`, `active`, `needs_action`) are computed from `communications` and `planned_actions` data. No triggers needed for the dynamic states; the two stored states are set by explicit dispatcher actions.

---

## 3. Planned Actions — The Missing Concept

The system currently has three action types, but they are disconnected:

| Existing construct | Table | Limitation |
|---|---|---|
| Revision (upcoming/scheduled) | `revisions` | Device-scoped, not customer-scoped. Only covers periodic inspections. |
| Visit (planned) | `visits` | Requires a date, crew, and device. Cannot represent "call back later." |
| Communication follow-up | `communications.follow_up_date` | Informal — a date on a past communication record, not a first-class action. |

What's missing is a **unified planned action** that can represent any future interaction with a customer.

### 3.1. Proposed: `planned_actions` + `action_targets`

```sql
CREATE TYPE action_status AS ENUM (
    'open',            -- pending, not yet performed
    'completed',       -- done
    'cancelled',       -- no longer needed
    'snoozed'          -- deferred to a later date
);

CREATE TYPE action_target_kind AS ENUM (
    'task',
    'visit',
    'project',
    'other'
);

CREATE TABLE action_targets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_kind     action_target_kind NOT NULL,

    -- Exactly one of these target references must be set.
    -- task_id gets an FK in Phase 6 when tasks table is introduced.
    task_id         UUID,
    visit_id        UUID REFERENCES visits(id) ON DELETE SET NULL,
    project_id      UUID,
    other_ref       TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        (target_kind = 'task'    AND task_id IS NOT NULL AND visit_id IS NULL AND project_id IS NULL AND other_ref IS NULL) OR
        (target_kind = 'visit'   AND task_id IS NULL AND visit_id IS NOT NULL AND project_id IS NULL AND other_ref IS NULL) OR
        (target_kind = 'project' AND task_id IS NULL AND visit_id IS NULL AND project_id IS NOT NULL AND other_ref IS NULL) OR
        (target_kind = 'other'   AND task_id IS NULL AND visit_id IS NULL AND project_id IS NULL AND other_ref IS NOT NULL)
    )
);

CREATE TABLE planned_actions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    status          action_status NOT NULL DEFAULT 'open',

    -- When should the dispatcher deal with this?
    due_date        DATE NOT NULL,
    snooze_until    DATE,
    snooze_reason   VARCHAR(255),

    -- Polymorphic target (recommended)
    action_target_id UUID REFERENCES action_targets(id) ON DELETE SET NULL,

    -- Legacy transitional links (Phase 1-4; replaced by action_target_id in Phase 6)
    revision_id     UUID REFERENCES revisions(id) ON DELETE SET NULL,
    visit_id        UUID REFERENCES visits(id) ON DELETE SET NULL,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,

    -- Context
    note            TEXT,

    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_planned_actions_queue
    ON planned_actions(user_id, status, due_date)
    WHERE status IN ('open', 'snoozed');

CREATE INDEX idx_planned_actions_customer
    ON planned_actions(customer_id);

CREATE INDEX idx_action_targets_user_kind
    ON action_targets(user_id, target_kind);
```

### 3.2. How It Connects

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  customers   │──1:N──│  planned_actions  │──N:1──│ action_targets  │
└──────────────┘       └──────────────────┘       └──────┬──────────┘
                                                          │
                                                          ├──► task (Phase 6)
                                                          ├──► visit
                                                          ├──► project (future)
                                                          └──► other_ref (future-safe)
```

- Each customer can have 0..N planned actions.
- Each planned action references one `action_target`.
- `action_target` points to exactly one entity: `task`, `visit`, `project`, or `other_ref`.
- `planned_actions` has no hardcoded business type enum. Display/behavior type is derived from the resolved target (e.g., `task_types`, visit metadata, project metadata).
- In Phase 1-4, legacy direct links (`revision_id`, `visit_id`) may coexist.
- In Phase 6, canonical linkage is `planned_actions.action_target_id` + `action_targets.task_id`.

**Future extensibility**: The schema is designed to support more complex project plans (tasks/actions related to each other) without introducing mandatory coupling now. For example: add `parent_id`/`group_id`, or a separate `work_orders` / `projects` layer that `action_targets` can reference.

### 3.3. Generic Task Model & Design Decisions

**Direction**: Introduce a generic **task** (or **work_item**) entity of which revision is just one type. This supports installation tasks, remote tasks (e.g. software update), and multiple tasks per visit.

| Concept | Role |
|--------|------|
| **Task** | Generic unit of work. Has `task_type`. Each type has type-specific payload. Can be visit-bound or remote. |
| **Revision** | One task type — device inspection (findings, result, duration). |
| **Installation** | Task type — device setup, commissioning. |
| **Software update** | Remote task type — no visit required. |
| **Visit** | Physical presence. Can group 0..N tasks. |
| **planned_action** | Scheduling layer. Links to exactly one `action_target`, which can resolve to task, visit, project, or other typed target. |

**Benefits**: One extensible model; multiple task types per visit; remote work first-class; aligns with future project plans; `planned_actions` remains scheduling-only.

**Design decisions** (grouped by domain):

#### A. Task Model

1. **Task table structure**: Single `tasks` table. Task types are **user-specifiable** (not hardcoded) — companies define their own types (revision, installation, software update, repair, etc.) via a `task_types` reference table. The `tasks` table references `task_type_id`; type-specific data can be stored in JSON or extensible columns.
2. **Task–visit relationship**: Tasks can be standalone. Remote tasks have `visit_id = NULL`; only on-site tasks link to a visit.
3. **Migration of `revisions`**: Migrate into `tasks`. All existing revision rows become task rows (task type = revision). The `revisions` table is dropped or replaced by a view over `tasks`. New import CSV file formats and column definitions will be needed.
4. **Callbacks / follow-ups**: Model as task types. Callback and follow-up are regular user-definable task types in `task_types` (lightweight payload), not a separate reminder entity.

#### B. Planned Actions & Targets

5. **`planned_action` linkage**: Use polymorphic target linkage. `planned_actions` references `action_targets`; each `action_target` points to exactly one target entity (task, visit, project, other). Extensible for future target types without changing the `planned_actions` schema.
6. **`planned_actions.action_type`**: Removed. Queue item semantics are derived from the target and its metadata (`task_types`, visit/project attributes).
7. **`action_targets.target_kind`**: Keep as system enum. `target_kind` stays fixed (`task`, `visit`, `project`, `other`) and is not user-configurable.

#### C. Inbox Display & Localization

8. **Inbox next-action fields**: Return both kind and label. Use `next_action_kind` (stable system value from `action_targets.target_kind`) plus `next_action_label` (human-readable display text, e.g., task type display name).
9. **Localization contract for next action label**: Return key + fallback text. Backend returns `next_action_label_key` and `next_action_label_fallback`; frontend resolves translation and falls back when key is missing.

#### D. Inbox State Persistence

10. **Sort/filter persistence**: Persist per dispatcher in DB. Default ordering is rank-first (untouched, overdue, upcoming, needs_action), with a UI switch for pure due-date ordering. The last inbox configuration (sort mode, filters, selected scoring rule set, pagination/page) is stored for each dispatcher and restored when they reopen Inbox. Not managed from the global Settings page.
11. **Saved views scope**: Single auto-saved last state only. No named saved views in current scope.
12. **Persistence timing & UX**: Debounced autosave with background persistence (worker/background thread) after short debounce to avoid UI slowdown.
13. **Persistence failure UX**: Silent retry + subtle indicator. Failed autosave retries in background; UI shows a non-blocking indicator (e.g., unsynced state icon).
14. **Persistence scope**: Per dispatcher account (shared across devices).
15. **Saved-state compatibility on schema/filter changes**: Best-effort migration. On load, keep valid state parts and drop/normalize invalid ones; persist the corrected state back.
16. **State restore behavior**: Always automatic on inbox open, without confirmation prompt.
17. **Default page size (no saved state)**: 25 candidates per page.

#### E. Ordering & Urgency Scoring

18. **Overdue ordering**: Oldest overdue first. Within overdue group, the most late customers are shown first.
19. **Urgency score scope**: Apply weighted urgency score within all visible lifecycle groups. Lifecycle grouping remains primary; score influences ordering inside each group, with explicit subgroup overrides (e.g., oldest-overdue-first).
20. **Urgency score computation strategy**: Hybrid. Default is compute-on-query; optional materialized/cache path can be enabled for large tenants, with compute path kept as fallback.
21. **Urgency explainability payload**: Default minimal, on-demand full. Inbox API returns only final `urgency_score` by default. Full factor breakdown on explicit request (e.g., button in customer detail).
22. **Score breakdown access**: Same as customer detail access.

#### F. Scoring Rule Sets — Structure & Governance

23. **Rule-set scope**: Named rule sets per company. Each company can define multiple named scoring rule sets; one set is marked as default.
24. **Rule-set metadata**: Name + description. Each rule set has a required unique name (unique per company, case-insensitive) and optional descriptive note.
25. **Rule-set update application**: Immediate with short TTL cache (e.g., 1-5 minutes).
26. **Rule-set edit permissions**: Company-defined role matrix. Permission to create/edit/select default rule sets is controlled by configurable company role/permission settings (not hardcoded).
27. **Inbox vs admin editing boundary**: Inbox can select only. Create/edit/delete operations happen in dedicated admin/config area.
28. **Rule-set selection permissions in Inbox**: Available to all dispatchers.

#### G. Scoring Factors & Weights

29. **Geocode factor policy**: Configurable per company (including negative values). Default weight should be relatively high, but companies can tune it down or make it negative.
30. **Weight safety bounds**: Fixed global safe range. Enforce hard bounds for each scoring weight (e.g., `-100 .. +100`).
31. **Factor optionality**: All factors optional. Any factor can be disabled by setting its weight to `0`.
32. **All-zero configuration**: Allowed. Ordering falls back to lifecycle rank/date rules.
33. **All-zero UX hint**: Show subtle informational hint when all weights are zero.

#### H. Dispatcher Rule-Set Selection & Defaults

34. **Dispatcher rule-set selection**: Dispatcher can choose one company rule set or choose none. One company rule set is default, but dispatcher can override per inbox session/state. Choosing none disables custom scoring. The selected rule set (including "none") is persisted as part of per-dispatcher last inbox state.
35. **Missing saved rule-set fallback**: Fallback to company default if dispatcher's saved rule set no longer exists.
36. **Deleting current default rule set**: Allowed with auto-promotion. System promotes another existing rule set.
37. **Auto-promotion selection rule**: Alphabetical by name.
38. **Changing company default rule set**: Allowed anytime with guardrails. Requires explicit confirmation and an audit reason.
39. **Effect of default change on dispatcher overrides**: Keep explicit dispatcher selection unchanged.
40. **Effect of default change for non-overridden users**: Apply new default immediately on next inbox load.

#### I. Rule-Set Archival

41. **Archival**: Supported. Company can archive rule sets so they are retained for history/audit but no longer actively used.
42. **Archived saved-selection behavior**: Fallback to company default if dispatcher's saved rule set becomes archived.
43. **Archive reversibility**: Unarchive supported. Archived rule sets can be restored to active state.
44. **Unarchive activation behavior**: Immediate availability once unarchived.

#### J. Materialized Scoring Path

45. **Materialized path enablement governance**: Automatic suggestion + manual confirmation. System flags candidates based on thresholds/telemetry; activation confirmed manually per company.
46. **Materialized freshness strategy**: Two-tier refresh. Quick incremental updates for recent changes plus periodic full recompute for consistency drift correction.
47. **Materialized failure behavior**: Immediate fallback to compute-on-query until health is restored.
48. **Fallback visibility**: Internal observability only. No user-facing indicator.

#### K. Audit Logging & Export

49. **Rule-set auditability**: Audit log enabled. Record who changed which rule set / factors and when (no rollback requirement in current scope).
50. **Audit retention**: Indefinite. Audit logs for rule-set and scoring changes are kept without time limit.
51. **Audit export**: Supported. Authorized roles can export audit logs in CSV/JSON formats.
52. **Export detail level**: Both, configurable per export. Metadata always included; before/after factor diff as optional detail.
53. **Export generation mode**: Asynchronous job. Exports generated in background and downloaded when ready.
54. **Export file retention**: Short TTL (e.g., 24 hours), then removed.
55. **Export download policy**: Multiple downloads allowed within TTL.
56. **Export access scope**: Company-authorized access. Any authorized user within the company can download during TTL.
57. **Export download logging**: Enabled. Each download event is logged (who, which export, when).

### 3.4. Company Rule-Set & State Tables (Conceptual)

The following tables make company-level scoring decisions explicit and align with persisted per-dispatcher Inbox state.

```sql
-- Company scoring rule sets (named profiles)
CREATE TABLE scoring_rule_sets (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id          UUID NOT NULL, -- FK to companies table (not created yet; will reference companies(id))
    name                VARCHAR(120) NOT NULL,
    description         TEXT,
    is_default          BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived         BOOLEAN NOT NULL DEFAULT FALSE,
    created_by_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    updated_by_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce unique (case-insensitive) names per company
CREATE UNIQUE INDEX uq_scoring_rule_sets_company_name_ci
    ON scoring_rule_sets(company_id, LOWER(name));

-- Weights/factors for a rule set
CREATE TABLE scoring_rule_factors (
    rule_set_id         UUID NOT NULL REFERENCES scoring_rule_sets(id) ON DELETE CASCADE,
    factor_key          VARCHAR(80) NOT NULL, -- e.g., overdue_days, geocode_failed
    weight              NUMERIC NOT NULL CHECK (weight >= -100 AND weight <= 100),
    PRIMARY KEY (rule_set_id, factor_key)
);

-- Per-dispatcher persisted Inbox state
CREATE TABLE dispatcher_inbox_state (
    user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    selected_rule_set_id    UUID REFERENCES scoring_rule_sets(id) ON DELETE SET NULL,
    sort_mode               VARCHAR(20) NOT NULL, -- rank_first | due_date
    active_filters_json     JSONB NOT NULL,
    page_number             INTEGER NOT NULL DEFAULT 1,
    page_size               INTEGER NOT NULL DEFAULT 25,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

> Note: if current tenancy is user-scoped, `company_id` should be derived consistently (e.g., via user's company relation) for all rule-set operations.

---

## 4. Redesigned Inbox Query

### 4.1. Phase 2 Query (planned actions, no scoring)

Introduced with Phase 2 backend. Uses `planned_actions` with legacy `revision_id` joins. No `action_targets` join yet (comes with Phase 4). No urgency scoring — ordered purely by lifecycle rank and dates.

```sql
-- Inputs:
-- $1 user_id
-- $2 limit
-- $3 offset
WITH queue AS (
    SELECT
        c.id, c.name, c.phone, c.city, c.postal_code,
        c.lat, c.lng, c.geocode_status,
        c.created_at AS customer_created_at,
        CASE
            WHEN NOT EXISTS (SELECT 1 FROM communications cm WHERE cm.customer_id = c.id)
                 AND NOT EXISTS (SELECT 1 FROM planned_actions p0 WHERE p0.customer_id = c.id)
                THEN 'untouched'
            WHEN pa.id IS NOT NULL
                THEN 'active'
            ELSE 'needs_action'
        END AS lifecycle_state,
        CASE
            WHEN NOT EXISTS (SELECT 1 FROM communications cm WHERE cm.customer_id = c.id)
                 AND NOT EXISTS (SELECT 1 FROM planned_actions p0 WHERE p0.customer_id = c.id)
                THEN 0
            WHEN pa.id IS NOT NULL AND pa.due_date < CURRENT_DATE
                THEN 1
            WHEN pa.id IS NOT NULL
                THEN 2
            ELSE 3
        END AS lifecycle_rank,
        pa.due_date AS next_action_due,
        pa.note     AS next_action_note,
        -- Legacy revision detail
        r.device_id, d.device_name, d.device_type,
        (SELECT COUNT(*) FROM communications cm WHERE cm.customer_id = c.id) AS total_communications,
        (SELECT MAX(created_at) FROM communications cm WHERE cm.customer_id = c.id) AS last_contact_at
    FROM customers c
    LEFT JOIN LATERAL (
        SELECT * FROM planned_actions pa
        WHERE pa.customer_id = c.id
          AND pa.status IN ('open', 'snoozed')
          AND (pa.snooze_until IS NULL OR pa.snooze_until <= CURRENT_DATE)
        ORDER BY pa.due_date ASC
        LIMIT 1
    ) pa ON TRUE
    LEFT JOIN revisions r ON pa.revision_id = r.id
    LEFT JOIN devices d ON r.device_id = d.id
    WHERE c.user_id = $1
      AND c.is_anonymized = FALSE
      AND c.is_abandoned = FALSE
)
SELECT *
FROM queue
ORDER BY
    lifecycle_rank ASC,
    CASE WHEN lifecycle_rank = 1 THEN next_action_due END ASC,
    CASE WHEN lifecycle_rank = 2 THEN next_action_due END ASC,
    CASE WHEN lifecycle_rank = 3 THEN COALESCE(last_contact_at, customer_created_at) END ASC,
    customer_created_at ASC
LIMIT $2 OFFSET $3;
```

### 4.2. Phase 4 Query (adds action_targets + urgency scoring)

Adds `action_targets` join for polymorphic target metadata, urgency scoring via a lateral function call, sort-mode selection, and dispatcher-persisted state parameters.

```sql
-- Inputs:
-- $1 user_id
-- $2 limit
-- $3 offset
-- $4 selected_rule_set_id (nullable; NULL means "no scoring")
-- $5 sort_mode ('rank_first' | 'due_date')
WITH queue AS (
    SELECT
        c.id, c.name, c.phone, c.city, c.postal_code,
        c.lat, c.lng, c.geocode_status,
        c.created_at AS customer_created_at,
        CASE
            WHEN NOT EXISTS (SELECT 1 FROM communications cm WHERE cm.customer_id = c.id)
                 AND NOT EXISTS (SELECT 1 FROM planned_actions p0 WHERE p0.customer_id = c.id)
                THEN 'untouched'
            WHEN pa.id IS NOT NULL
                THEN 'active'
            ELSE 'needs_action'
        END AS lifecycle_state,
        CASE
            WHEN NOT EXISTS (SELECT 1 FROM communications cm WHERE cm.customer_id = c.id)
                 AND NOT EXISTS (SELECT 1 FROM planned_actions p0 WHERE p0.customer_id = c.id)
                THEN 0
            WHEN pa.id IS NOT NULL AND pa.due_date < CURRENT_DATE
                THEN 1
            WHEN pa.id IS NOT NULL
                THEN 2
            ELSE 3
        END AS lifecycle_rank,
        at.target_kind AS next_action_kind,
        CONCAT('inbox.action_target.', COALESCE(at.target_kind::text, 'none')) AS next_action_label_key,
        COALESCE(at.target_kind::text, 'none') AS next_action_label_fallback,
        pa.due_date AS next_action_due,
        pa.note     AS next_action_note,
        -- Legacy revision detail (dropped in Phase 6)
        r.device_id, d.device_name, d.device_type,
        (SELECT COUNT(*) FROM communications cm WHERE cm.customer_id = c.id) AS total_communications,
        (SELECT MAX(created_at) FROM communications cm WHERE cm.customer_id = c.id) AS last_contact_at,
        COALESCE(sc.urgency_score, 0) AS urgency_score
    FROM customers c
    LEFT JOIN LATERAL (
        SELECT * FROM planned_actions pa
        WHERE pa.customer_id = c.id
          AND pa.status IN ('open', 'snoozed')
          AND (pa.snooze_until IS NULL OR pa.snooze_until <= CURRENT_DATE)
        ORDER BY pa.due_date ASC
        LIMIT 1
    ) pa ON TRUE
    LEFT JOIN action_targets at ON pa.action_target_id = at.id
    LEFT JOIN revisions r ON pa.revision_id = r.id
    LEFT JOIN devices d ON r.device_id = d.id
    LEFT JOIN LATERAL scoring.compute_customer_urgency(c.id, $4) sc(urgency_score) ON TRUE
    WHERE c.user_id = $1
      AND c.is_anonymized = FALSE
      AND c.is_abandoned = FALSE
)
SELECT *
FROM queue
ORDER BY
    CASE WHEN $5 = 'rank_first' THEN lifecycle_rank END ASC,
    CASE WHEN $5 = 'rank_first' AND lifecycle_rank = 1 THEN next_action_due END ASC,
    CASE WHEN $5 = 'rank_first' THEN urgency_score END DESC,
    CASE WHEN $5 = 'rank_first' AND lifecycle_rank = 2 THEN next_action_due END ASC,
    CASE WHEN $5 = 'rank_first' AND lifecycle_rank = 3 THEN COALESCE(last_contact_at, customer_created_at) END ASC,
    CASE WHEN $5 = 'due_date' THEN COALESCE(next_action_due, DATE '9999-12-31') END ASC,
    customer_created_at ASC
LIMIT $2 OFFSET $3;
```

### 4.3. Phase 6+ Target Query Adjustments

- Replace legacy `revisions`/`devices` joins with `tasks` + `task_types` via `action_targets.task_id`.
- Derive `next_action_label_key` / `next_action_label_fallback` from task-type metadata for task targets.
- Keep the same sorting contract (rank-first default, due-date optional, scoring within groups).
- Keep fallback behavior when selected rule set is missing/archived (`company default`, or `none` if explicitly selected).

### 4.4. Sort Priority

The default inbox applies **no date filter** and uses **rank-first ordering** (untouched → overdue → upcoming → needs_action). Within each rank, urgency score is applied, with group-specific tie-breakers (notably: overdue group keeps oldest overdue first). Dispatchers can switch to an alternative pure due-date ordering mode.

| Rank | Group | Rationale |
|---|---|---|
| 0 | Untouched customers | Never contacted — needs first outreach immediately. Ordered by urgency score (when enabled). |
| 1 | Overdue planned actions | Highest urgency among active. Ordered oldest overdue first, then urgency score. |
| 2 | Upcoming planned actions | Ordered by urgency score, then nearest due date. |
| 3 | Needs action | Ordered by urgency score, then oldest last-contact timestamp. |

Abandoned customers (`is_abandoned = TRUE`) are excluded from the Planning Inbox. They are visible only on the Customers page, which must provide a filter to show them. The typical next step for abandoned customers is deletion (GDPR anonymization).

### 4.5. Filter Tabs (Inbox UI)

The current filter tabs would map to:

| Current tab | New meaning |
|---|---|
| **Vše** (All) | All customers except abandoned and deleted. No date filter. Default order is rank-first; optional mode orders purely by nearest due date. |
| **Akutní** (Urgent) | Overdue actions + untouched customers. |
| **Do 7 dnů** | Actions due within 7 days. |
| **Do 30 dnů** | Actions due within 30 days. |
| **Má termín** (Has date) | Active customers with a scheduled action. |
| **Problémové** (Problems) | Overdue > 30 days, customers with failed visits, and customers with failed geocoding (`geocode_status = 'failed'`). |

*Abandoned customers are excluded from the inbox. They appear on the Customers page only, with a dedicated "Opuštění" (Abandoned) filter. The typical action for abandoned customers is deletion.*

*Inbox UI state is persisted per dispatcher in DB (sort mode, active filters, selected scoring rule set, pagination/page) and restored on next Inbox open.*

---

## 5. Migration Path

### Phase 1: Schema — core planned actions
1. Add `customers.is_abandoned BOOLEAN NOT NULL DEFAULT FALSE` and `customers.deleted_at TIMESTAMPTZ` columns.
2. Create `action_status` and `action_target_kind` enums.
3. Create `action_targets` and `planned_actions` tables (`action_target_id` nullable in transition period).
4. Backfill from existing data:
   - One `planned_action` per `revision` with status `upcoming` or `scheduled`.
   - One `planned_action` per `visit` with status `planned`.
   - One `planned_action` per `communication` with `follow_up_date IS NOT NULL AND follow_up_completed = FALSE`.

### Phase 2: Backend — customer-centric inbox (no scoring yet)
5. Rewrite `get_call_queue` to use the new customer-centric query (lifecycle state derivation, rank-first ordering by date — no urgency scoring at this stage).
6. Add handlers for CRUD on `planned_actions` (create task-backed action, snooze, complete, cancel).
7. Add handlers for abandon / un-abandon / GDPR anonymize.
8. Auto-create planned actions when revisions are scheduled or visits are planned.

### Phase 3: Frontend — inbox UI update
9. Update `PlanningInbox` to render the new response shape (customer-first, with optional action details).
10. Add "Schedule callback" action in the inbox candidate detail panel (creates callback task type).
11. Update filter tabs to match new semantics.
12. Implement per-dispatcher inbox state persistence (debounced autosave of sort mode, filters, page).

### Phase 4: Scoring & state persistence
13. Create `scoring_rule_sets`, `scoring_rule_factors`, and `dispatcher_inbox_state` tables.
14. Implement `scoring.compute_customer_urgency` function (or equivalent application-level logic).
15. Add urgency score to inbox query; wire up dispatcher rule-set selection and persisted state.
16. Build admin UI for rule-set CRUD, archival, audit log, and export.

### Phase 5: Cleanup — deprecate legacy fields
17. Deprecate `revisions.snooze_until` / `snooze_reason` in favor of action-level snoozing.
18. Deprecate `communications.follow_up_date` / `follow_up_completed` in favor of `planned_actions`.
19. Remove the `create_initial_revisions_for_user` workaround (migration 027) once planned actions are live.

### Phase 6: Tasks model (when generic tasks replace revisions)
20. Create `task_types` reference table and `tasks` table with `action_targets` canonical linkage.
21. Migrate existing revision rows into `tasks` (task type = revision); drop or replace `revisions` with a view.
22. Migrate planned actions from legacy direct links (`revision_id`, `visit_id`, `device_id`) to `action_target_id` + `task_id` targets; drop legacy columns.
23. Define new import CSV file formats and column definitions for the tasks model.

---

## 6. Resolved Decision Snapshot

Previously open topics are now resolved in this document:

1. **Revisions model**: Superseded by generic `tasks` direction (Phase 6 migration). `planned_actions` stays a scheduling layer with polymorphic `action_target`.
2. **Import behavior**: No automatic action creation on import; imported customers surface as `UNTOUCHED`.
3. **Abandonment behavior**: Never time-based; only explicit dispatcher action.
4. **Deletion/GDPR**: Soft-delete with irreversible anonymization; historical records preserved; devices soft-deleted.
5. **Multi-device handling**: Inbox is one row per customer; customer detail lists all devices by nearest due date; visit can cover multiple tasks/devices.
6. **Scoring/governance**: Company-defined named rule sets with dispatcher selection, per-dispatcher persisted state, audit/export policy, and hybrid score computation strategy.

---

## 7. Glossary

| Term | Definition |
|---|---|
| **Planned action** | A scheduled unit in the dispatcher queue (due date, status, snooze, note), linked to exactly one `action_target`. |
| **Lifecycle state** | Classification of where a customer sits: untouched, needs_action, active, abandoned, deleted. Stored (abandoned, deleted) or computed from communications and planned_actions. |
| **Inbox** | The dispatcher's work queue. Shows customers ordered by urgency, filtered by lifecycle state and action due dates. |
| **Snooze** | Temporarily deferring an action to a future date. The customer/action disappears from the inbox until the snooze date. |
| **Callback** | A planned phone call to the customer, modeled as a lightweight task type (user-definable via `task_types`). |
| **Task** | Generic unit of work (Section 3.3). User-definable types via `task_types` (revision, installation, software update, etc.). Replaces `revisions` after Phase 6. Can be visit-bound or remote. |
| **Action target** | Polymorphic target object referenced by `planned_actions`. Resolves the action to exactly one entity (task, visit, project, or other reference). |
| **Task type** | User-definable category for tasks (e.g., revision, installation, callback). Stored in `task_types` reference table; each task references one type. |
| **Scoring rule set** | Named company-level configuration of urgency factor weights. Multiple sets per company; one is the default. Dispatchers can select a set or opt out. |
| **Urgency score** | Weighted numeric score computed per customer from scoring factors. Used to order customers within lifecycle rank groups in the inbox. |
| **Dispatcher inbox state** | Per-dispatcher persisted configuration (sort mode, active filters, selected scoring rule set, page number/size). Autosaved and restored on inbox open. |
