# Business Processes & Customer Lifecycle

> **Status**: Phases 1-6, Phase 4A and Phase 4B complete.  
> **Last-Modified**: 2026-03-11

| Phase | Status | Notes |
|---|---|---|
| Phase 1: Schema | ✅ Complete | Migrations 028-032, Rust types, shared TS types |
| Phase 2: Backend | ✅ Complete | DB queries, NATS handlers for planned_action + inbox + customer lifecycle |
| Phase 3: Frontend | ✅ Complete | inboxService, useInbox hook, CandidateDetail callback/abandon actions |
| Phase 4: Scoring | ✅ Complete | scoring_rule_sets/factors/dispatcher_inbox_state tables, Rust scoring service, NATS handlers |
| **Phase 4A: Scoring activation & UI** | ✅ Complete | compute_urgency wired into inbox query; set_default handler; shared TS types; scoringService; i18n (en/cs/sk); ScoringRuleSetsManager Settings tab; inbox rule-set selector dropdown; DB-backed inbox state persistence |
| **Phase 4B: Default scoring profile** | ✅ Complete | New factors (lifecycle_rank, days_until_due, customer_age_days); `is_system` column; seed default profile on onboarding; backfill existing; block delete + restore defaults; remove hardcoded sort; auto-select default in inbox |
| Phase 5: Cleanup | ✅ Complete | Dual-write: revision snooze → planned_action, communication follow_up → planned_action; migration 034 (guarded drop) |
| Phase 6: Tasks model | ✅ Complete | task_types/tasks tables (035), backfill from revisions (036), Rust Task/TaskType types+queries, NATS handlers, shared TS types; migrations 037 (guarded drop) |

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

## 7. TDD Implementation Plan

This section breaks each migration phase into concrete implementation tickets. Each ticket follows the Red-Green-Refactor TDD cycle: write a failing test first, implement the minimum code to pass, then refactor. Tickets are ordered by dependency — later tickets may depend on earlier ones within the same phase.

> **Notation**: `[R]` = Rust worker, `[F]` = Frontend (React/TS), `[DB]` = SQL migration, `[S]` = Shared types.
> Test type suffixes: `(unit)`, `(integration)`, `(component)`.

---

### Phase 1: Schema — core planned actions

#### P1-01 `[DB]` Migration: add `is_abandoned` and `deleted_at` to `customers`

**File**: `worker/migrations/028_add_customer_lifecycle_fields.sql`

Schema changes:
- `ALTER TABLE customers ADD COLUMN is_abandoned BOOLEAN NOT NULL DEFAULT FALSE;`
- `ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMPTZ;`
- `CREATE INDEX idx_customers_abandoned ON customers(user_id) WHERE is_abandoned = TRUE;`

**TDD**:
1. RED: Rust integration test — query `SELECT is_abandoned, deleted_at FROM customers WHERE id = $1` on a test customer → should return `(false, NULL)`.
2. GREEN: Run migration.
3. REFACTOR: Verify index exists via `pg_indexes`.

---

#### P1-02 `[DB]` Migration: create `action_status` and `action_target_kind` enums

**File**: `worker/migrations/029_create_action_enums.sql`

Schema changes:
- `CREATE TYPE action_status AS ENUM ('open','completed','cancelled','snoozed');`
- `CREATE TYPE action_target_kind AS ENUM ('task','visit','project','other');`

**TDD**:
1. RED: Query `SELECT 'open'::action_status` → should succeed after migration.
2. GREEN: Run migration.

---

#### P1-03 `[DB]` Migration: create `action_targets` table

**File**: `worker/migrations/030_create_action_targets.sql`

Schema: as defined in Section 3.1 including the `CHECK` constraint that enforces `target_kind` matches exactly one non-NULL target FK.

**TDD**:
1. RED: Insert an `action_target` with `target_kind = 'visit'` and `visit_id = <valid UUID>` → should succeed.
2. RED: Insert with `target_kind = 'visit'` and `task_id = <UUID>` (wrong FK) → should fail constraint.
3. GREEN: Run migration.

---

#### P1-04 `[DB]` Migration: create `planned_actions` table

**File**: `worker/migrations/031_create_planned_actions.sql`

Schema: as defined in Section 3.1 including indexes `idx_planned_actions_queue` and `idx_planned_actions_customer`.

**TDD**:
1. RED: Insert a `planned_action` with `status = 'open'`, `due_date`, `customer_id`, `user_id` → should succeed.
2. RED: Verify partial index `idx_planned_actions_queue` covers `status IN ('open','snoozed')`.
3. GREEN: Run migration.

---

#### P1-05 `[R]` Types: `PlannedAction`, `ActionTarget`, `ActionStatus`, `ActionTargetKind`

**Files**:
- `worker/src/types/planned_action.rs` — `PlannedAction`, `CreatePlannedActionRequest`, `UpdatePlannedActionRequest`, `ListPlannedActionsRequest`, `ActionStatus` enum, `ActionTargetKind` enum.
- `worker/src/types/action_target.rs` — `ActionTarget`, `CreateActionTargetRequest`.

**TDD** (unit):
1. RED: `ActionStatus::from_str("open")` → `Ok(ActionStatus::Open)`.
2. RED: `ActionStatus::from_str("invalid")` → `Err(...)`.
3. RED: Serialize `PlannedAction` → verify JSON field names are camelCase.
4. GREEN: Implement structs and enums with `#[derive(Serialize, Deserialize, sqlx::Type)]`.
5. REFACTOR: Derive `Clone`, `Debug` consistently.

---

#### P1-06 `[S]` Shared types: `PlannedAction`, `ActionStatus`, `InboxCandidate` (new shape)

**Files**:
- `packages/shared-types/src/plannedAction.ts` — `PlannedAction`, `ActionStatus`, `CreatePlannedActionRequest`.
- `packages/shared-types/src/inbox.ts` — `InboxCandidate` (customer-centric), `LifecycleState`, `InboxResponse`.

**TDD** (unit):
1. RED: TypeScript type check — `InboxCandidate` must have `lifecycleState`, `lifecycleRank`, `nextActionDue`, `nextActionNote`, `totalCommunications`, `lastContactAt`. Compile fails until types are defined.
2. GREEN: Define types.
3. REFACTOR: Re-export from `index.ts`.

---

#### P1-07 `[DB]` Backfill script: seed `planned_actions` from existing data

**File**: `worker/migrations/032_backfill_planned_actions.sql`

Logic:
- One `planned_action` per revision with `status IN ('upcoming','scheduled')` → action status `open`, `due_date = revisions.due_date`, link `revision_id`.
- One `planned_action` per visit with `status = 'planned'` → action status `open`, `due_date = visits.scheduled_date`, link `visit_id`.
- One `planned_action` per communication with `follow_up_date IS NOT NULL AND follow_up_completed = FALSE` → action status `open`, `due_date = communications.follow_up_date`.

**TDD** (integration):
1. RED: Insert test revision (status=upcoming, due_date=tomorrow) → run migration → `SELECT COUNT(*) FROM planned_actions WHERE revision_id = $1` should return 1.
2. RED: Insert test completed revision (status=completed) → run migration → should NOT create a planned_action.
3. GREEN: Run backfill.
4. REFACTOR: Verify row counts match: `COUNT(planned_actions)` ≈ `COUNT(revisions WHERE status IN ('upcoming','scheduled'))` + `COUNT(visits WHERE status = 'planned')` + `COUNT(communications WHERE follow_up_date IS NOT NULL AND NOT follow_up_completed)`.

---

### Phase 2: Backend — customer-centric inbox

#### P2-01 `[R]` DB query: `create_planned_action`

**File**: `worker/src/db/queries/planned_action.rs`

**TDD** (unit + integration):
1. RED: Call `create_planned_action(pool, user_id, &req)` with valid input → should return `PlannedAction` with status `open` and matching `due_date`.
2. RED: Call with missing `customer_id` → should return error.
3. GREEN: Implement INSERT query.
4. REFACTOR: Extract column list constant.

---

#### P2-02 `[R]` DB query: `get_planned_action`, `list_planned_actions`

**File**: `worker/src/db/queries/planned_action.rs`

**TDD**:
1. RED: Create two planned actions for same customer → `list_planned_actions(pool, user_id, customer_id)` returns both, ordered by `due_date ASC`.
2. RED: `get_planned_action(pool, user_id, action_id)` with wrong `user_id` → returns `None`.
3. GREEN: Implement SELECT queries.

---

#### P2-03 `[R]` DB query: `update_planned_action` (status transitions, snooze)

**File**: `worker/src/db/queries/planned_action.rs`

**TDD**:
1. RED: Update status from `open` → `completed` → should set `completed_at` to now.
2. RED: Update status to `snoozed` with `snooze_until` date → should persist both fields.
3. RED: Update status from `completed` → `open` → should clear `completed_at`.
4. GREEN: Implement UPDATE query.

---

#### P2-04 `[R]` DB query: `cancel_planned_action`

**TDD**:
1. RED: Cancel an open action → status becomes `cancelled`.
2. RED: Cancel an already-completed action → should return error (or succeed with no-op — decide).
3. GREEN: Implement.

---

#### P2-05 `[R]` DB queries: `abandon_customer`, `unaban_customer`

**File**: `worker/src/db/queries/customer.rs` (extend existing)

**TDD**:
1. RED: `abandon_customer(pool, user_id, customer_id)` → `SELECT is_abandoned FROM customers` returns `TRUE`.
2. RED: `unabandon_customer(pool, user_id, customer_id)` → `is_abandoned` returns `FALSE`.
3. RED: Abandon then unabandon → customer visible in inbox again (integration with lifecycle query).
4. GREEN: Implement `UPDATE customers SET is_abandoned = ...`.

---

#### P2-06 `[R]` DB query: `anonymize_customer` (GDPR — extend existing)

**File**: `worker/src/db/queries/customer.rs` (extend existing `anonymize_customer`)

Current `anonymize_customer` sets `is_anonymized = TRUE` and scrubs PII. Extend to also:
- Set `deleted_at = NOW()`.
- Delete open planned actions (`DELETE FROM planned_actions WHERE customer_id = $1 AND status IN ('open','snoozed')`).
- Soft-delete devices (existing behavior, verify).

**TDD**:
1. RED: Anonymize customer with 2 open planned actions → `SELECT COUNT(*) FROM planned_actions WHERE customer_id = $1 AND status = 'open'` returns 0.
2. RED: Anonymize customer → `deleted_at IS NOT NULL`.
3. RED: Completed planned actions survive: `SELECT COUNT(*) FROM planned_actions WHERE customer_id = $1 AND status = 'completed'` unchanged.
4. GREEN: Extend existing function.

---

#### P2-07 `[R]` DB query: `get_customer_inbox` (Phase 2 query — no scoring)

**File**: `worker/src/db/queries/planned_action.rs`

Implements the Phase 2 query from Section 4.1. This is the core inbox query replacing `get_call_queue`.

**TDD** (unit — SQL builder tests):
1. RED: Default request → WHERE clause contains `c.is_anonymized = FALSE AND c.is_abandoned = FALSE`.
2. RED: WHERE clause does NOT contain revision-specific filters (`r.status`, `r.due_date BETWEEN`).

**TDD** (integration — requires test DB with seeded data):
3. RED: Customer with no communications and no planned actions → `lifecycle_state = 'untouched'`, `lifecycle_rank = 0`.
4. RED: Customer with one open planned action (due tomorrow) → `lifecycle_state = 'active'`, `lifecycle_rank = 2`.
5. RED: Customer with one open planned action (due yesterday) → `lifecycle_state = 'active'`, `lifecycle_rank = 1` (overdue).
6. RED: Customer with one completed planned action and no open ones → `lifecycle_state = 'needs_action'`, `lifecycle_rank = 3`.
7. RED: Abandoned customer → excluded from results.
8. RED: Anonymized customer → excluded from results.
9. RED: Ordering — untouched before overdue before upcoming before needs_action.
10. RED: Within overdue group — oldest overdue first.
11. GREEN: Implement query.
12. REFACTOR: Extract lifecycle CASE into a reusable SQL fragment or Rust builder function.

---

#### P2-08 `[R]` Types: `InboxRequest`, `InboxResponse`, `InboxItem`

**File**: `worker/src/types/inbox.rs`

**TDD** (unit):
1. RED: Deserialize `InboxRequest` from JSON with `limit`, `offset` → succeeds.
2. RED: Serialize `InboxItem` → JSON has `lifecycleState`, `lifecycleRank`, `nextActionDue`, `nextActionNote`, `totalCommunications`, `lastContactAt`.
3. GREEN: Define structs.

---

#### P2-09 `[R]` Handler: `sazinka.planned_action.{create,list,get,update,cancel}`

**File**: `worker/src/handlers/planned_action.rs`

**TDD** (unit — mock pool):
1. RED: Handle `sazinka.planned_action.create` with valid payload → returns `SuccessResponse<PlannedAction>`.
2. RED: Handle with missing required field → returns `ErrorResponse`.
3. RED: Handle `sazinka.planned_action.cancel` for non-existent ID → returns error.
4. GREEN: Implement handlers, register subscriptions in `main.rs`.

---

#### P2-10 `[R]` Handler: `sazinka.customer.abandon`, `sazinka.customer.unabandon`

**File**: `worker/src/handlers/customer.rs` (extend)

**TDD**:
1. RED: Handle `sazinka.customer.abandon` → customer's `is_abandoned = TRUE`.
2. RED: Handle `sazinka.customer.unabandon` → `is_abandoned = FALSE`.
3. GREEN: Add handler functions, register subscriptions.

---

#### P2-11 `[R]` Handler: `sazinka.inbox.query` (replaces `sazinka.revision.queue`)

**File**: `worker/src/handlers/inbox.rs`

**TDD**:
1. RED: Handle `sazinka.inbox.query` with default request → returns `InboxResponse` with `items` array.
2. RED: Response items have `lifecycle_state` field (not `priority`).
3. GREEN: Implement handler calling `get_customer_inbox`.
4. NOTE: Keep `sazinka.revision.queue` working during transition (deprecate in Phase 5).

---

#### P2-12 `[R]` Auto-create planned actions on revision schedule / visit plan

**Files**: `worker/src/handlers/revision.rs`, `worker/src/handlers/visit.rs` (extend)

When a revision is scheduled (`sazinka.revision.schedule`) or a visit is created (`sazinka.visit.create`), auto-create a corresponding `planned_action`.

**TDD**:
1. RED: Schedule a revision → `SELECT COUNT(*) FROM planned_actions WHERE revision_id = $1` returns 1.
2. RED: Create a visit → `SELECT COUNT(*) FROM planned_actions WHERE visit_id = $1` returns 1.
3. RED: Complete a visit → corresponding planned action status becomes `completed`.
4. GREEN: Add auto-creation logic after existing handler logic.

---

### Phase 3: Frontend — inbox UI update

#### P3-01 `[F]` Service: `inboxService.ts` (replaces revision queue calls)

**File**: `apps/web/src/services/inboxService.ts`

**TDD** (unit):
1. RED: `getInbox({ limit: 25, offset: 0 })` calls NATS with subject `sazinka.inbox.query` and correct payload shape.
2. RED: Response is parsed into `InboxCandidate[]` with `lifecycleState` field.
3. RED: `createPlannedAction(req)` calls NATS with subject `sazinka.planned_action.create`.
4. RED: `abandonCustomer(customerId)` calls NATS with subject `sazinka.customer.abandon`.
5. GREEN: Implement service functions.

---

#### P3-02 `[F]` Hook: `useInbox.ts`

**File**: `apps/web/src/hooks/useInbox.ts`

**TDD** (unit):
1. RED: `useInbox()` returns `{ items, total, isLoading, error, refetch }`.
2. RED: On mount, calls `getInbox` and populates `items`.
3. RED: `refetch()` triggers a new call and updates items.
4. GREEN: Implement hook using existing NATS request pattern.

---

#### P3-03 `[F]` Component: updated `PlanningInbox` page

**File**: `apps/web/src/pages/PlanningInbox.tsx` (refactor)

**TDD** (component):
1. RED: Render PlanningInbox → should call `useInbox` (not `getCallQueue`).
2. RED: Items display `lifecycleState` badge (untouched / active / needs_action).
3. RED: Untouched customers appear before overdue before upcoming before needs_action.
4. GREEN: Refactor component to use new hook and types.
5. REFACTOR: Remove `getCallQueue` import once verified.

---

#### P3-04 `[F]` Component: updated filter tabs

**File**: `apps/web/src/pages/PlanningInbox.tsx` or extracted component

Map to new semantics from Section 4.5:

**TDD** (component):
1. RED: "Vše" tab shows all non-abandoned, non-deleted customers.
2. RED: "Akutní" tab filters to overdue + untouched.
3. RED: "Problémové" tab includes customers with `geocodeStatus = 'failed'`.
4. GREEN: Implement filter logic.

---

#### P3-05 `[F]` Component: "Schedule callback" action in candidate detail

**File**: `apps/web/src/components/planner/CandidateDetail.tsx` (extend)

**TDD** (component):
1. RED: Render CandidateDetail → should show "Schedule callback" button.
2. RED: Clicking button opens a form with date picker and note field.
3. RED: Submitting form calls `createPlannedAction` with correct payload.
4. GREEN: Implement UI.

---

#### P3-06 `[F]` Component: "Abandon" / "Unabandon" actions

**Files**: `apps/web/src/components/planner/CandidateDetail.tsx`, `apps/web/src/components/customers/CustomerHeader.tsx`

**TDD** (component):
1. RED: CandidateDetail shows "Abandon" button.
2. RED: Clicking "Abandon" calls `abandonCustomer` and removes customer from list.
3. RED: CustomerHeader for abandoned customer shows "Remove abandoned status" button.
4. GREEN: Implement.

---

#### P3-07 `[F]` Inbox state persistence (debounced autosave to `sessionStorage` as interim)

**File**: `apps/web/src/hooks/useInboxState.ts`

Phase 3 interim: persist to `sessionStorage` (DB persistence comes in Phase 4). The hook interface is designed for easy swap to DB later.

**TDD** (unit):
1. RED: `useInboxState()` returns `{ state, setSortMode, setFilter, setPage }`.
2. RED: Changing sort mode triggers debounced save to `sessionStorage`.
3. RED: On remount, state is restored from `sessionStorage`.
4. GREEN: Implement using `useAutoSave` pattern (already exists in codebase).

---

### Phase 4: Scoring & state persistence

#### P4-01 `[DB]` Migration: create scoring tables

**File**: `worker/migrations/033_create_scoring_tables.sql`

Schema: `scoring_rule_sets`, `scoring_rule_factors`, `dispatcher_inbox_state` as defined in Section 3.4.

**TDD**:
1. RED: Insert a rule set → succeeds.
2. RED: Insert two rule sets with same name (case-insensitive) for same company → unique constraint violation.
3. RED: Insert factor with `weight = 150` → fails CHECK constraint (`-100..100`).
4. RED: Insert dispatcher_inbox_state → succeeds.
5. GREEN: Run migration.

---

#### P4-02 `[R]` Types: `ScoringRuleSet`, `ScoringRuleFactor`, `DispatcherInboxState`

**File**: `worker/src/types/scoring.rs`, `worker/src/types/inbox.rs` (extend)

**TDD** (unit):
1. RED: Serialize `ScoringRuleSet` → JSON has `isDefault`, `isArchived`, `createdByUserId`.
2. RED: `DispatcherInboxState` deserializes `activeFiltersJson` as `serde_json::Value`.
3. GREEN: Implement structs.

---

#### P4-03 `[R]` DB queries: `scoring_rule_set` CRUD

**File**: `worker/src/db/queries/scoring.rs`

**TDD**:
1. RED: `create_rule_set(pool, company_id, &req)` → returns `ScoringRuleSet` with `is_default = false`.
2. RED: `list_rule_sets(pool, company_id)` → returns only non-archived sets by default.
3. RED: `list_rule_sets(pool, company_id, include_archived=true)` → returns all.
4. RED: `set_default(pool, rule_set_id)` → clears `is_default` on others for same company, sets on target.
5. RED: `archive_rule_set(pool, rule_set_id)` → sets `is_archived = TRUE`.
6. RED: Delete the current default → another rule set auto-promoted (alphabetical).
7. GREEN: Implement queries.

---

#### P4-04 `[R]` DB queries: `scoring_rule_factor` CRUD

**File**: `worker/src/db/queries/scoring.rs`

**TDD**:
1. RED: `upsert_factors(pool, rule_set_id, &factors)` → inserts/updates factor weights.
2. RED: Setting weight to `0` → factor row kept (weight = 0, effectively disabled).
3. RED: Weight outside `-100..100` → DB constraint error.
4. GREEN: Implement.

---

#### P4-05 `[R]` DB queries: `dispatcher_inbox_state` CRUD

**File**: `worker/src/db/queries/inbox_state.rs`

**TDD**:
1. RED: `save_inbox_state(pool, user_id, &state)` → upsert (INSERT ON CONFLICT UPDATE).
2. RED: `get_inbox_state(pool, user_id)` → returns saved state.
3. RED: `get_inbox_state` for user with no saved state → returns `None`.
4. RED: Save state with `selected_rule_set_id` pointing to archived rule set → on read, fallback to company default.
5. GREEN: Implement.

---

#### P4-06 `[R]` Scoring computation: `compute_customer_urgency`

**File**: `worker/src/services/scoring.rs`

Application-level urgency score computation (not a PG function — keeps logic testable in Rust).

**TDD** (unit):
1. RED: Customer with overdue action (10 days late), `overdue_days` factor weight = 5 → score includes `50`.
2. RED: Customer with failed geocode, `geocode_failed` factor weight = 20 → score includes `20`.
3. RED: All weights zero → score = `0`.
4. RED: Negative weight → score decreases.
5. RED: No rule set (NULL) → score = `0`.
6. GREEN: Implement `compute_urgency(customer_data: &CustomerScoringInput, factors: &[ScoringRuleFactor]) -> f64`.

---

#### P4-07 `[R]` DB query: `get_customer_inbox` v2 (with scoring)

**File**: `worker/src/db/queries/planned_action.rs` (extend P2-07)

Implements Phase 4 query from Section 4.2. Adds `action_targets` join, urgency scoring, sort-mode parameter.

**TDD** (integration):
1. RED: Request with `sort_mode = 'rank_first'` and `selected_rule_set_id = <valid>` → results ordered by rank, then urgency score DESC within group.
2. RED: Request with `sort_mode = 'due_date'` → results ordered by `next_action_due ASC`.
3. RED: Request with `selected_rule_set_id = NULL` → `urgency_score = 0` for all, ordering falls back to rank/date.
4. RED: `InboxItem` now includes `nextActionKind`, `nextActionLabelKey`, `nextActionLabelFallback`, `urgencyScore`.
5. GREEN: Extend query with lateral scoring and action_targets join.

---

#### P4-08 `[R]` Handlers: `sazinka.scoring.{ruleset.create,ruleset.list,ruleset.get,ruleset.update,ruleset.delete,ruleset.archive,ruleset.unarchive,ruleset.set_default}`

**File**: `worker/src/handlers/scoring.rs`

**TDD**:
1. RED: Create rule set → returns `ScoringRuleSet`.
2. RED: Archive rule set that is a dispatcher's selection → dispatcher's next load falls back to default.
3. GREEN: Implement handlers.

---

#### P4-09 `[R]` Handler: `sazinka.inbox.state.{save,get}`

**File**: `worker/src/handlers/inbox.rs` (extend P2-11)

**TDD**:
1. RED: `sazinka.inbox.state.save` with valid state → persists.
2. RED: `sazinka.inbox.state.get` → returns last saved state.
3. RED: `sazinka.inbox.state.get` with no saved state → returns defaults (rank_first, no filters, page 1, size 25).
4. GREEN: Implement.

---

#### P4-10 `[F]` Hook: `useInboxState.ts` v2 — DB-backed persistence

**File**: `apps/web/src/hooks/useInboxState.ts` (replace P3-07 interim)

**TDD** (unit):
1. RED: On mount, calls `sazinka.inbox.state.get` to restore state.
2. RED: Changing sort mode triggers debounced call to `sazinka.inbox.state.save`.
3. RED: Failed save shows subtle unsynced indicator (no toast).
4. RED: Failed save retries after delay.
5. GREEN: Implement, replacing `sessionStorage` persistence.

---

#### P4-11 `[F]` Component: rule-set selector in Inbox toolbar

**File**: `apps/web/src/components/planner/InboxToolbar.tsx` (new or extracted)

**TDD** (component):
1. RED: Toolbar renders a dropdown listing available rule sets + "None".
2. RED: Selecting a rule set updates inbox state and re-fetches inbox.
3. RED: Selecting "None" disables scoring.
4. GREEN: Implement.

---

#### P4-12 `[F]` Page: Scoring admin (rule-set CRUD)

**File**: `apps/web/src/pages/ScoringAdmin.tsx`

**TDD** (component):
1. RED: Page lists all rule sets for the company (active + archived, separated).
2. RED: Create form validates name uniqueness (case-insensitive).
3. RED: Factor weight input rejects values outside `-100..100`.
4. RED: Archive/unarchive toggle works.
5. RED: Delete with confirmation dialog.
6. GREEN: Implement.

---

### Phase 4A: Scoring activation & UI

Phase 4 built the backend infrastructure (tables, Rust types, queries, NATS handlers, scoring service). However, the scoring computation is not wired into the inbox query (`urgency_score` is hardcoded to `0.0`), no shared TS types exist for scoring, no frontend UI exists for managing rule sets or selecting them in the inbox, and inbox state is persisted only in `sessionStorage` rather than the DB.

Phase 4A closes these gaps in 8 TDD tickets.

**What exists (Phase 4):**
- DB tables: `scoring_rule_sets`, `scoring_rule_factors`, `dispatcher_inbox_state` (migration 033)
- Rust types: `ScoringRuleSet`, `ScoringRuleFactor`, `DispatcherInboxState`, `CustomerScoringInput`, `FactorInput`, request/response types
- Rust queries: rule-set CRUD, factor upsert, inbox-state get/save
- Rust handlers: `sazinka.scoring.rule_set.{create,list,update,archive}`, `sazinka.inbox_state.{get,save}`
- Rust service: `compute_urgency()` with 5 factor keys (`overdue_days`, `geocode_failed`, `total_communications`, `days_since_last_contact`, `no_open_action`)

**What's missing (Phase 4A):**
1. Inbox query ignores `selected_rule_set_id` and hardcodes `urgency_score = 0.0`
2. No shared TS types for scoring (`ScoringRuleSet`, `ScoringRuleFactor`, etc.)
3. No frontend scoring service (NATS calls for rule-set CRUD)
4. No Settings tab for scoring rule-set management
5. No inbox toolbar selector for rule sets
6. No inbox state DB persistence (still `sessionStorage`)
7. No `set_default` NATS handler (DB query exists but no handler)
8. Inbox sort doesn't use `urgency_score` in ordering

---

#### P4A-01 `[R]` Wire scoring into inbox query

**Files**: `worker/src/db/queries/planned_action.rs`

Extend `get_customer_inbox` to:
- Accept `selected_rule_set_id` from `InboxRequest` (already in the struct but unused)
- Accept `sort_mode` from `InboxRequest` (already in the struct but unused)
- Load factors for the selected rule set
- Compute `urgency_score` per customer using `scoring::compute_urgency()`
- Order by `urgency_score DESC` within lifecycle rank groups (rank-first mode), or by `next_action_due ASC` (due-date mode)

**TDD**:
1. RED: Request with `selected_rule_set_id = <valid>` → items have non-zero `urgency_score` for customers with overdue actions.
2. RED: Request with `selected_rule_set_id = None` → all items have `urgency_score = 0.0`.
3. RED: Request with `sort_mode = 'due_date'` → items ordered by `next_action_due ASC`.
4. RED: Two customers in same rank group, one with higher urgency score → higher score appears first.
5. GREEN: Implement scoring integration. Compute scores in Rust (not SQL lateral) per the existing `compute_urgency` function.

---

#### P4A-02 `[R]` Handler: `sazinka.scoring.rule_set.set_default`

**File**: `worker/src/handlers/scoring.rs`

The `set_default_rule_set` DB query exists but has no NATS handler. Add one.

**TDD**:
1. RED: Calling `sazinka.scoring.rule_set.set_default` with a valid rule set ID → sets it as default, clears others.
2. RED: Setting default on archived rule set → returns error.
3. GREEN: Implement handler.

---

#### P4A-03 `[F]` Shared TS types for scoring

**File**: `packages/shared-types/src/scoring.ts` (new)

Define TypeScript interfaces matching the Rust types:
- `ScoringRuleSet` (id, name, description, isDefault, isArchived, factors, timestamps)
- `ScoringRuleFactor` (ruleSetId, factorKey, weight)
- `CreateScoringRuleSetRequest`, `UpdateScoringRuleSetRequest`
- `ScoringRuleSetListResponse`
- `DispatcherInboxState`, `SaveInboxStateRequest`
- `FACTOR_KEYS` constant object

**TDD**:
1. RED: TS compiles with new types imported.
2. GREEN: Create type definitions.

---

#### P4A-04 `[F]` Frontend service: `scoringService.ts`

**File**: `apps/web/src/services/scoringService.ts` (new)

NATS client functions wrapping the scoring handlers:
- `listRuleSets()` → calls `sazinka.scoring.rule_set.list`
- `createRuleSet(req)` → calls `sazinka.scoring.rule_set.create`
- `updateRuleSet(req)` → calls `sazinka.scoring.rule_set.update`
- `archiveRuleSet(id)` → calls `sazinka.scoring.rule_set.archive`
- `setDefaultRuleSet(id)` → calls `sazinka.scoring.rule_set.set_default`
- `getInboxState()` → calls `sazinka.inbox_state.get`
- `saveInboxState(req)` → calls `sazinka.inbox_state.save`

**TDD**:
1. RED: `listRuleSets()` with mock NATS → returns `ScoringRuleSet[]`.
2. RED: `createRuleSet({ name, factors })` → returns created rule set.
3. RED: `getInboxState()` → returns `DispatcherInboxState | null`.
4. GREEN: Implement service functions following `inboxService.ts` pattern.

---

#### P4A-05 `[F]` Settings tab: Scoring rule-set management

**File**: `apps/web/src/components/settings/ScoringRuleSetsManager.tsx` (new)

New Settings tab "Scoring" (permission: `settings:scoring`) that provides:
- List of rule sets (active section + archived section)
- Default badge on the current default rule set
- Create form: name (required, unique), description (optional), factor weights (slider/input for each known factor key, range -100..100, default 0)
- Edit form: same as create, inline or modal
- "Set as default" action (with confirmation)
- "Archive" / "Unarchive" toggle
- Subtle info hint when all weights in a set are zero ("Scoring disabled — ordering falls back to date-based ranking")
- Factor key display names (i18n keys: `scoring.factor.overdue_days`, etc.)

**TDD** (component):
1. RED: Renders list of rule sets from mock data, separated into active and archived.
2. RED: Create form validates name is non-empty.
3. RED: Factor weight input rejects values outside -100..100.
4. RED: "Set as default" calls `setDefaultRuleSet` and refreshes list.
5. RED: Archive toggle calls `archiveRuleSet` and moves item to archived section.
6. RED: All-zero weights show info hint.
7. GREEN: Implement component.

**Settings.tsx integration**: Add `'scoring'` to `SettingsTab` union. Add tab entry `{ id: 'scoring', label: t('tab_scoring'), permission: 'settings:scoring' }`. Render `<ScoringRuleSetsManager>` when active.

---

#### P4A-06 `[F]` Inbox toolbar: rule-set selector dropdown

**File**: `apps/web/src/pages/PlanningInbox.tsx` (extend)

Add a dropdown in the inbox toolbar (near the filter tabs) that:
- Lists active (non-archived) rule sets from `scoringService.listRuleSets()`
- Includes a "None (no scoring)" option
- Shows the company default with a subtle marker
- On selection change: updates `selectedRuleSetId` in inbox state, re-fetches inbox with the new rule set ID via `getInbox({ selectedRuleSetId, limit: 100 })`
- Persists selection via inbox state (P4A-07)
- Loads initial selection from persisted inbox state on mount

**TDD** (component):
1. RED: Dropdown renders available rule sets + "None" option.
2. RED: Selecting a rule set triggers `loadCandidates` with `selectedRuleSetId`.
3. RED: Selecting "None" passes `selectedRuleSetId: null`.
4. GREEN: Implement.

---

#### P4A-07 `[F]` Inbox state DB persistence

**File**: `apps/web/src/hooks/useInboxState.ts` (new or replace P3-07 interim)

Replace `sessionStorage`-based inbox state with DB-backed persistence:
- On mount: call `scoringService.getInboxState()` to restore last state (sort mode, selected rule set, filters, page)
- On state change: debounced (500ms) call to `scoringService.saveInboxState()`
- Failed save: silent retry (3 attempts with exponential backoff), subtle unsaved indicator icon
- Fallback: if DB call fails on mount, use defaults (rank_first, no rule set, page 1, size 25)

**TDD**:
1. RED: On mount, calls `getInboxState` and applies returned state.
2. RED: Changing sort mode triggers debounced `saveInboxState`.
3. RED: Changing selected rule set triggers debounced `saveInboxState`.
4. RED: Failed save retries after delay.
5. RED: Mount with no saved state → uses defaults.
6. GREEN: Implement hook.

---

#### P4A-08 `[F]` i18n keys for scoring

**Files**: `apps/web/public/locales/{en,cs,sk}/settings.json`, `apps/web/public/locales/{en,cs,sk}/inbox.json`

Add translation keys:
- Settings: `tab_scoring`, `scoring_title`, `scoring_description`, `scoring_create`, `scoring_name`, `scoring_description_field`, `scoring_factors`, `scoring_set_default`, `scoring_archive`, `scoring_unarchive`, `scoring_all_zero_hint`, `scoring_confirm_default`, `scoring_no_rule_sets`
- Factor labels: `scoring.factor.overdue_days`, `scoring.factor.geocode_failed`, `scoring.factor.total_communications`, `scoring.factor.days_since_last_contact`, `scoring.factor.no_open_action`
- Inbox: `inbox_scoring_selector`, `inbox_scoring_none`, `inbox_scoring_default_marker`

**TDD**:
1. RED: All new i18n keys resolve in `en`, `cs`, `sk` without fallback warnings.
2. GREEN: Add translations.

---

### Summary: Phase 4A ticket count

| Ticket | Layer | Scope |
|--------|-------|-------|
| P4A-01 | Backend | Wire scoring computation into inbox query |
| P4A-02 | Backend | `set_default` NATS handler |
| P4A-03 | Frontend | Shared TS types for scoring |
| P4A-04 | Frontend | `scoringService.ts` |
| P4A-05 | Frontend | Settings tab: ScoringRuleSetsManager |
| P4A-06 | Frontend | Inbox toolbar rule-set selector |
| P4A-07 | Frontend | Inbox state DB persistence |
| P4A-08 | Frontend | i18n keys |
| **Total** | | **8 tickets** |

**Suggested implementation order**: P4A-01 → P4A-02 → P4A-03 → P4A-04 → P4A-08 → P4A-05 → P4A-06 → P4A-07

Rationale: backend first (01-02), then shared types (03) that frontend depends on, then frontend service (04), then i18n keys (08) needed by components, then UI components (05-07) that consume everything above.

---

### Phase 4B: Default scoring profile & unified score-based sorting

#### Problem

When no scoring profile exists (fresh company), the inbox falls back to a hardcoded
Rust sort: `lifecycle_rank` → `due_date` → `created_at`. This means:

- The "Urgency score" column is always `0.0` — confusing for the user.
- The hardcoded sort logic is a parallel code path that can drift from score-based sorting.
- New companies see an empty scoring selector with no guidance.

#### Goal

1. Express the current default sort order **as a scoring profile** with well-chosen factor weights.
2. **Seed this profile automatically** when a company completes onboarding.
3. **Backfill** the profile for existing companies that have no scoring rule set.
4. **Remove the hardcoded `RankFirst` sort** — all sorting goes through `compute_urgency` + score DESC.
5. **Auto-select the default profile** in the inbox when no `dispatcher_inbox_state` exists yet.
6. The default profile is **fully editable** (name, weights) like any other profile, but **cannot be deleted**. A "Restore defaults" action resets its weights to the factory values.

#### New scoring factors needed

The current 5 factors (`overdue_days`, `geocode_failed`, `total_communications`,
`days_since_last_contact`, `no_open_action`) cannot reproduce the lifecycle-rank
ordering. We need:

| Factor key | Type | Raw value | Purpose |
|---|---|---|---|
| `lifecycle_rank` | integer 0-3 | `lifecycle_rank` from SQL CASE | Primary sort bucket. Weight should be large negative (e.g. −1000) so rank 0 scores highest, rank 3 lowest. |
| `days_until_due` | signed integer | `due_date − today` (negative = overdue) | Within a rank, overdue items score higher. Weight negative (e.g. −5) so more-overdue = higher score. |
| `customer_age_days` | integer ≥ 0 | `today − customer_created_at` | Tiebreaker: older customers first. Small positive weight (e.g. 0.01). |

These join the existing 5 factors — all 8 are available in every profile. The
default "Standard" profile uses only the 3 new ones; users can add/adjust the
other 5 to taste.

#### Default profile definition

| Factor | Weight | Effect |
|---|---|---|
| `lifecycle_rank` | −1000 | Rank 0 (untouched) → +0; Rank 1 (overdue) → −1000; Rank 2 (active) → −2000; Rank 3 (needs_action) → −3000. Lower rank = higher score. |
| `days_until_due` | −5 | Overdue by 10 days → +50; due in 10 days → −50. Overdue items float up within their rank. |
| `customer_age_days` | 0.01 | 365-day-old customer → +3.65. Tiny tiebreaker so older customers appear first. |
| *(all other factors)* | 0 | Inactive by default. Users can enable them in Settings. |

Profile name (localized):
- en: "Standard"
- cs: "Standardní"
- sk: "Štandardný"

#### System profile behavior

The seeded profile has `is_system = TRUE` on the `scoring_rule_sets` row.

| Action | System profile | User-created profile |
|---|---|---|
| Edit name | ✅ Allowed | ✅ Allowed |
| Edit description | ✅ Allowed | ✅ Allowed |
| Edit factor weights | ✅ Allowed | ✅ Allowed |
| Set as default | ✅ Allowed | ✅ Allowed |
| Archive | ✅ Allowed | ✅ Allowed |
| **Delete** | ❌ Blocked (backend returns error) | ✅ Allowed |
| **Restore defaults** | ✅ Resets name + factors to factory values | N/A (button not shown) |

The `is_system` flag is immutable — it cannot be set or cleared via the API.
The "Restore defaults" NATS subject: `sazinka.scoring.rule_set.restore_defaults`.

#### Inbox query changes

Once every company has a default profile, the inbox query can be simplified:

1. If `selected_rule_set_id` is `None` in the request, **look up the user's default
   rule set** (`is_default = TRUE`) and use it automatically.
2. Remove the `InboxSortMode` enum and the `match sort_mode { ... }` block —
   sorting is always by `urgency_score DESC`, then `customer_created_at ASC`.
3. The `lifecycle_rank` column stays in the SQL (the scoring function reads it),
   but it no longer drives a separate sort path.

#### TDD tickets

##### P4B-01 `[R]` New scoring factors in Rust

**RED**:
1. Unit test: `compute_urgency` with `lifecycle_rank` factor, weight −1000, input rank=2 → contribution = −2000.
2. Unit test: `compute_urgency` with `days_until_due` factor, weight −5, input due in −10 (overdue 10) → contribution = +50.
3. Unit test: `compute_urgency` with `customer_age_days` factor, weight 0.01, input 365 → contribution = 3.65.

**GREEN**:
1. Add `LIFECYCLE_RANK`, `DAYS_UNTIL_DUE`, `CUSTOMER_AGE_DAYS` to `scoring::factor_keys`.
2. Add `lifecycle_rank: Option<i32>`, `days_until_due: Option<i64>`, `customer_age_days: Option<i64>` to `CustomerScoringInput`.
3. Add match arms in `compute_urgency` for the 3 new keys.

**REFACTOR**: Ensure all 8 factor keys are tested in isolation and in combination.

---

##### P4B-02 `[R]` Seed default profile on onboarding complete

**RED**:
1. Unit test: after `onboarding.complete`, a `scoring_rule_sets` row exists for the user with `is_default = TRUE`, `is_system = TRUE`, and name = localized "Standard".
2. Unit test: the rule set has exactly 3 factors with the expected weights.

**GREEN**:
1. Create a helper `create_default_scoring_profile(pool, user_id, locale)` in `db::queries::scoring`. Sets `is_system = TRUE`.
2. Call it from `handle_onboarding_complete` after the user update, passing the user's locale.

**REFACTOR**: Extract the factor definitions into a constant (`DEFAULT_FACTORS`) so they're reusable for backfill and restore-defaults.

---

##### P4B-03 `[R]` Schema migration + backfill for existing companies

**RED**:
1. Test: migration 038 adds `is_system BOOLEAN NOT NULL DEFAULT FALSE` to `scoring_rule_sets`.
2. Test: migration 038 creates a default scoring rule set for every user that has `role = 'admin'` or `role = 'customer'` AND has zero rows in `scoring_rule_sets`, with `is_system = TRUE` and `is_default = TRUE`.

**GREEN**:
1. Write migration `038_seed_default_scoring_profiles.sql`:
   - `ALTER TABLE scoring_rule_sets ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE;`
   - For each qualifying user, INSERT a rule set with `is_default = TRUE`, `is_system = TRUE`, name = 'Standard'.
   - INSERT the 3 default factors for each new rule set.

**REFACTOR**: Verify idempotency (re-running doesn't duplicate). Update `ScoringRuleSet` Rust struct and TS interface to include `isSystem: boolean`.

---

##### P4B-04 `[R]` System profile guards: block delete + restore defaults handler

**RED**:
1. Unit test: `archive_rule_set` on a system profile succeeds (archiving is allowed).
2. Unit test: a new `delete_rule_set` function returns an error when `is_system = TRUE`.
3. Unit test: `restore_defaults` resets the system profile's name (to locale-appropriate "Standard") and replaces all factors with the 3 factory defaults.
4. Unit test: `restore_defaults` on a non-system profile returns an error.

**GREEN**:
1. Add `delete_rule_set` to `db::queries::scoring` — hard-deletes the row but returns error if `is_system = TRUE`.
2. Add `restore_rule_set_defaults(pool, user_id, rule_set_id, locale)` to `db::queries::scoring` — resets name + factors using `DEFAULT_FACTORS` constant. Only works when `is_system = TRUE`.
3. Wire NATS handler `sazinka.scoring.rule_set.restore_defaults` in `handlers/scoring.rs` and `handlers/mod.rs`.

**REFACTOR**: Ensure `archive_rule_set` auto-promotes the next profile as default if the archived one was default.

---

##### P4B-05 `[R]` Auto-select default profile in inbox query

**RED**:
1. Unit test: `get_customer_inbox` with `selected_rule_set_id = None` loads the user's default rule set and applies scoring.
2. Unit test: inbox items are sorted by `urgency_score DESC` (no separate rank-based sort).

**GREEN**:
1. In `get_customer_inbox`: if `selected_rule_set_id` is `None`, query `scoring_rule_sets WHERE user_id = $1 AND is_default = TRUE` and use its ID.
2. Populate the 3 new `CustomerScoringInput` fields from the SQL result (`lifecycle_rank`, computed `days_until_due`, computed `customer_age_days`).
3. Replace the `match sort_mode { ... }` block with a single sort: `urgency_score DESC`, then `customer_created_at ASC`.
4. Remove `InboxSortMode` enum (or keep for backward compat but ignore).

**REFACTOR**: Remove dead `RankFirst`/`DueDate` match arms. Clean up `InboxRequest.sort_mode`.

---

##### P4B-06 `[F]` Update shared TS types & FACTOR_KEYS

**RED**:
1. TS compile check: `FACTOR_KEYS` includes `LIFECYCLE_RANK`, `DAYS_UNTIL_DUE`, `CUSTOMER_AGE_DAYS`.
2. TS compile check: `ScoringRuleSet` includes `isSystem: boolean`.

**GREEN**:
1. Add the 3 new keys to `packages/shared-types/src/scoring.ts` `FACTOR_KEYS`.
2. Add `isSystem: boolean` to `ScoringRuleSet` interface.
3. Remove `InboxSortMode` references from `packages/shared-types/src/inbox.ts` if exported.
4. Add `restoreDefaults(ruleSetId)` to `scoringService.ts`.

**REFACTOR**: Ensure no dead imports.

---

##### P4B-07 `[F]` Frontend: remove sort-mode selector, auto-select default profile

**RED**:
1. Inbox loads with the default profile pre-selected (no "None" option visible when a default exists).
2. Sort-mode dropdown is removed from the inbox toolbar.

**GREEN**:
1. In `PlanningInbox.tsx`: on initial load, if `getInboxState` returns no `selectedRuleSetId`, find the rule set with `isDefault === true` from the fetched list and select it.
2. Remove the sort-mode selector UI (if any) and the `sortMode` field from `saveInboxState` calls.
3. Remove the "None" option from the scoring selector dropdown.

**REFACTOR**: Clean up unused sort-mode i18n keys and CSS.

---

##### P4B-08 `[F]` i18n & Settings UI: new factors, system profile UX

**RED**:
1. Settings → Scoring tab shows labels for all 8 factors including the 3 new ones.
2. System profile card shows no "Delete" option in the context menu.
3. System profile card shows a "Restore defaults" button.
4. Clicking "Restore defaults" resets the profile and refreshes the card.

**GREEN**:
1. Add i18n keys for `scoring_factor_lifecycle_rank`, `scoring_factor_days_until_due`, `scoring_factor_customer_age_days` in `en`, `cs`, `sk` settings.json.
2. Add i18n keys for `scoring_restore_defaults`, `scoring_restore_defaults_confirm`, `scoring_restore_defaults_success` in `en`, `cs`, `sk`.
3. `ScoringRuleSetsManager`: hide "Delete" action when `ruleSet.isSystem === true`.
4. `ScoringRuleSetsManager`: show "Restore defaults" button for system profiles, calling `scoringService.restoreDefaults(id)`.
5. `ScoringRuleSetsManager`: render sliders for all 8 factors, grouped into "Sorting" and "Urgency" sections.

**REFACTOR**: Factor grouping is visual only (no backend concept of groups).

---

#### Summary: Phase 4B ticket count

| Ticket | Layer | Scope |
|--------|-------|-------|
| P4B-01 | Backend | New scoring factors in `compute_urgency` |
| P4B-02 | Backend | Seed default profile on onboarding complete (`is_system = TRUE`) |
| P4B-03 | Backend | Schema migration (`is_system` column) + backfill existing companies |
| P4B-04 | Backend | System profile guards: block delete + restore defaults handler |
| P4B-05 | Backend | Auto-select default profile in inbox query; remove hardcoded sort |
| P4B-06 | Frontend | Update shared TS types, FACTOR_KEYS, `isSystem`, `restoreDefaults` |
| P4B-07 | Frontend | Remove sort-mode selector; auto-select default profile in inbox |
| P4B-08 | Frontend | i18n keys, new factor labels, system profile UX (no delete, restore defaults) |
| **Total** | | **8 tickets** |

**Suggested implementation order**: P4B-01 → P4B-02 → P4B-03 → P4B-04 → P4B-05 → P4B-06 → P4B-07 → P4B-08

Rationale: new factors first (01), then seeding logic (02) and schema+backfill (03) so every company has a system profile, then guards and restore handler (04), then inbox query simplification (05) that depends on profiles existing, then frontend types (06) and UI (07-08).

---

### Phase 5: Cleanup — deprecate legacy fields

#### P5-01 `[R]` Remove snooze from revisions, use planned_action snooze

**TDD**:
1. RED: `sazinka.revision.snooze` handler now creates/updates a `planned_action` snooze instead of setting `revisions.snooze_until`.
2. RED: Inbox query no longer reads `revisions.snooze_until`.
3. GREEN: Refactor handler and query.

---

#### P5-02 `[R]` Remove `communications.follow_up_date` usage

**TDD**:
1. RED: Creating a communication with `follow_up_date` now auto-creates a `planned_action` instead of setting the column.
2. RED: Inbox query no longer reads `communications.follow_up_date`.
3. GREEN: Refactor.

---

#### P5-03 `[DB]` Migration: drop deprecated columns (guarded)

**File**: `worker/migrations/034_drop_legacy_snooze_followup.sql`

Only drop columns after verifying no code references them:
- `revisions.snooze_until`, `revisions.snooze_reason`
- `communications.follow_up_date`, `communications.follow_up_completed`

**TDD**:
1. RED: `cargo build` succeeds without referencing dropped columns.
2. RED: All existing tests pass.
3. GREEN: Run migration.

---

#### P5-04 `[R]` Remove `create_initial_revisions_for_user` workaround

**TDD**:
1. RED: New user import flow works without migration 027 workaround.
2. GREEN: Remove the workaround code; imported customers surface as `UNTOUCHED` via planned actions.

---

#### P5-05 `[F]` Remove `getCallQueue` and `CallQueueItem` references

**TDD**:
1. RED: `grep -r "getCallQueue\|CallQueueItem\|revision.queue" apps/web/src/` returns zero matches.
2. GREEN: Remove dead code, update imports.

---

### Phase 6: Tasks model

#### P6-01 `[DB]` Migration: create `task_types` and `tasks` tables

**File**: `worker/migrations/035_create_tasks.sql`

Schema:
```sql
CREATE TABLE task_types (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(120) NOT NULL,
    label_key       VARCHAR(120),
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    payload_schema  JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_type_id    UUID NOT NULL REFERENCES task_types(id) ON DELETE RESTRICT,
    customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    visit_id        UUID REFERENCES visits(id) ON DELETE SET NULL,
    device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
    status          VARCHAR(30) NOT NULL DEFAULT 'pending',
    payload         JSONB,
    due_date        DATE,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Also add FK from `action_targets.task_id` to `tasks.id`.

**TDD**:
1. RED: Insert `task_type` "revision" → succeeds.
2. RED: Insert `task` with `task_type_id` → succeeds.
3. RED: `action_targets.task_id` now has FK to `tasks.id`.
4. GREEN: Run migration.

---

#### P6-02 `[DB]` Migration: backfill tasks from revisions

**File**: `worker/migrations/036_migrate_revisions_to_tasks.sql`

**TDD**:
1. RED: Pre-migration revision count = post-migration task count (for task_type = revision).
2. RED: Each migrated task preserves `device_id`, `customer_id`, `due_date`, `status` mapping.
3. RED: `action_targets` entries created for migrated tasks.
4. RED: `planned_actions` updated from `revision_id` to `action_target_id` → `task_id`.
5. GREEN: Run migration.

---

#### P6-03 `[R]` Types and DB queries: `Task`, `TaskType` CRUD

**Files**: `worker/src/types/task.rs`, `worker/src/db/queries/task.rs`

**TDD**:
1. RED: `create_task_type(pool, user_id, &req)` → returns `TaskType`.
2. RED: `create_task(pool, user_id, &req)` → returns `Task`.
3. RED: `list_tasks(pool, user_id, customer_id)` → returns tasks for customer.
4. RED: `complete_task(pool, task_id)` → sets `completed_at`, updates status.
5. GREEN: Implement.

---

#### P6-04 `[R]` Handlers: `sazinka.task.{create,list,get,update,complete}`, `sazinka.task_type.{create,list,update}`

**File**: `worker/src/handlers/task.rs`

**TDD**:
1. RED: Create task → returns `Task`.
2. RED: Complete task → also completes linked planned_action.
3. GREEN: Implement and register.

---

#### P6-05 `[R]` Update inbox query to use tasks instead of revisions

**File**: `worker/src/db/queries/planned_action.rs`

Replace `LEFT JOIN revisions r` / `LEFT JOIN devices d` with `LEFT JOIN tasks t` / `LEFT JOIN task_types tt` via `action_targets.task_id`. Derive label from `task_types.name` / `task_types.label_key`.

**TDD**:
1. RED: Inbox item for a task-backed action → `nextActionKind = 'task'`, `nextActionLabelFallback = task_type.name`.
2. RED: Inbox item for a visit-backed action → `nextActionKind = 'visit'`.
3. RED: Legacy revision columns no longer in SELECT.
4. GREEN: Update query.

---

#### P6-06 `[DB]` Migration: drop legacy `planned_actions` columns

**File**: `worker/migrations/037_drop_planned_action_legacy_columns.sql`

Drop `planned_actions.revision_id`, `planned_actions.visit_id`, `planned_actions.device_id`.

**TDD**:
1. RED: `cargo build` succeeds.
2. RED: All tests pass.
3. GREEN: Run migration.

---

#### P6-07 `[F]` Update `InboxCandidate` and components for task-based model

**Files**: `apps/web/src/types/inboxCandidate.ts`, `CandidateDetail.tsx`, `CandidateRow.tsx`

**TDD** (component):
1. RED: `InboxCandidate` has `nextActionKind`, `nextActionLabelKey`, `nextActionLabelFallback` instead of `deviceType`.
2. RED: CandidateRow renders action kind badge from label.
3. RED: CandidateDetail shows task details (type, status, payload).
4. GREEN: Update types and components.

---

#### P6-08 `[F]` Import flow: new CSV formats for tasks

**TDD**:
1. RED: Import service accepts new task CSV format.
2. RED: Import maps CSV rows to `create_task` calls with correct `task_type_id`.
3. GREEN: Implement.

---

### Cross-cutting: test infrastructure setup

These tickets are prerequisites executed before Phase 2 integration tests.

#### T-01 `[R]` Test utilities: seeded test database helper

**File**: `worker/src/test_utils.rs` (or `worker/tests/common/mod.rs`)

Provide a helper that:
- Creates a temporary test database (or uses a transaction that rolls back).
- Runs all migrations.
- Seeds baseline data (user, customer, device, revision).
- Returns `(PgPool, TestData)`.

**TDD**: The helper itself is tested by verifying seeded data is queryable.

---

#### T-02 `[F]` Test utilities: mock inbox service

**File**: `apps/web/src/services/__mocks__/inboxService.ts`

Provide mock implementations of `getInbox`, `createPlannedAction`, `abandonCustomer`, etc., returning predictable test data.

---

### Summary: ticket count per phase

| Phase | Tickets | Scope |
|-------|---------|-------|
| Phase 1 | P1-01 to P1-07 | 7 tickets — schema + types + backfill |
| Phase 2 | P2-01 to P2-12 | 12 tickets — backend queries + handlers |
| Phase 3 | P3-01 to P3-07 | 7 tickets — frontend services + components |
| Phase 4 | P4-01 to P4-12 | 12 tickets — scoring infra (tables, Rust types, queries, handlers, service) |
| **Phase 4A** | **P4A-01 to P4A-08** | **8 tickets — scoring activation & UI (wire into inbox, shared types, frontend service, Settings tab, inbox selector, state persistence, i18n)** |
| **Phase 4B** | **P4B-01 to P4B-08** | **8 tickets — default scoring profile (new factors, seed on onboarding, backfill, is_system guard, restore defaults, remove hardcoded sort, auto-select, frontend cleanup)** |
| Phase 5 | P5-01 to P5-05 | 5 tickets — legacy cleanup |
| Phase 6 | P6-01 to P6-08 | 8 tickets — tasks model |
| Cross-cutting | T-01, T-02 | 2 tickets — test infrastructure |
| **Total** | **69 tickets** | |

---

## 8. Glossary

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
| **Scoring rule set** | Named company-level configuration of urgency factor weights. Multiple sets per company; one is the default. A "Standard" system profile (`is_system = TRUE`) is seeded automatically for every new company — it is fully editable but cannot be deleted, and has a "Restore defaults" action. Dispatchers can select a set in the inbox toolbar. |
| **Urgency score** | Weighted numeric score computed per customer from scoring factors. The sole determinant of inbox ordering (score DESC). The default "Standard" profile reproduces the legacy lifecycle-rank → due-date → age ordering via factor weights. |
| **Dispatcher inbox state** | Per-dispatcher persisted configuration (sort mode, active filters, selected scoring rule set, page number/size). Autosaved and restored on inbox open. |
