# Business Processes & Customer Lifecycle

> **Status**: All phases complete (1-7, 4A, 4B).
> **Last-Modified**: 2026-03-11

| Phase | Status | Notes |
|---|---|---|
| Phase 1: Schema | ✅ Complete | Migrations 028-032, Rust types, shared TS types |
| Phase 2: Backend | ✅ Complete | DB queries, NATS handlers for planned_action + inbox + customer lifecycle |
| Phase 3: Frontend | ✅ Complete | inboxService, useInbox hook, CandidateDetail callback/abandon actions |
| Phase 4: Scoring | ✅ Complete | scoring_rule_sets/factors/dispatcher_inbox_state tables, Rust scoring service, NATS handlers |
| Phase 4A: Scoring activation & UI | ✅ Complete | compute_urgency wired into inbox query; shared TS types; scoringService; ScoringRuleSetsManager Settings tab; inbox rule-set selector; DB-backed inbox state persistence |
| Phase 4B: Default scoring profile | ✅ Complete | New factors (lifecycle_rank, days_until_due, customer_age_days); `is_system` column; seed on onboarding; backfill existing; block delete + restore defaults; unified score-based sort |
| Phase 5: Cleanup | ✅ Complete | Dual-write: revision snooze → planned_action, communication follow_up → planned_action; migration 034 (guarded drop) |
| Phase 6: Tasks model | ✅ Complete | task_types/tasks tables (035), backfill from revisions (036), Rust Task/TaskType types+queries, NATS handlers; migrations 037 (guarded drop) |
| Phase 7: Unschedule visit | ✅ Complete | Cancel a scheduled visit; revision reverts to `upcoming`; customer returns to inbox |

---

## 1. Customer Lifecycle

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

### 1.1. State Definitions

| State | Condition | Inbox visibility |
|---|---|---|
| **UNTOUCHED** | Zero rows in `communications` for this customer. No planned actions. | Always visible — highest priority group. |
| **NEEDS_ACTION** | Has some history but no open/snoozed planned action. Fallback state for non-deleted, non-abandoned customers that are neither untouched nor active. | Visible — rank 3 (lowest among non-abandoned). |
| **ACTIVE** | Has at least one open planned action: a scheduled visit, a pending callback, or an upcoming task. | Visible. Rank 1 (overdue) or 2 (upcoming). |
| **ABANDONED** | Explicitly marked by the dispatcher. Never automatic. Stored as `is_abandoned` flag. | Excluded from Planning Inbox. Visible only on Customers page with filter. |
| **DELETED** | PII irrecoverably anonymized. `is_anonymized = TRUE`, `deleted_at` set. Devices soft-deleted. | Never visible. Historical records preserved. |

### 1.2. State Derivation

`ABANDONED` and `DELETED` are **stored states** (explicit dispatcher actions). The remaining states are **computed at query time**:

```sql
CASE
  WHEN c.is_anonymized = TRUE THEN 'deleted'
  WHEN c.is_abandoned = TRUE THEN 'abandoned'
  WHEN NOT EXISTS (SELECT 1 FROM communications WHERE customer_id = c.id)
       AND NOT EXISTS (SELECT 1 FROM planned_actions WHERE customer_id = c.id)
    THEN 'untouched'
  WHEN EXISTS (SELECT 1 FROM planned_actions WHERE customer_id = c.id AND status IN ('open', 'snoozed'))
    THEN 'active'
  ELSE 'needs_action'
END AS lifecycle_state
```

---

## 2. Planned Actions Architecture

### 2.1. Schema

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│  customers   │──1:N──│  planned_actions  │──N:1──│ action_targets  │
└──────────────┘       └──────────────────┘       └──────┬──────────┘
                                                          │
                                                          ├──► task (via task_id)
                                                          ├──► visit (via visit_id)
                                                          ├──► project (future)
                                                          └──► other_ref (future-safe)
```

- Each customer can have 0..N planned actions.
- Each planned action references one `action_target`.
- `action_target` points to exactly one entity via `target_kind` enum (`task`, `visit`, `project`, `other`).
- Display type is derived from the resolved target metadata (`task_types`, visit attributes).

Key tables: `planned_actions`, `action_targets`, `tasks`, `task_types` (see migrations 029-037 for DDL).

### 2.2. Generic Task Model

| Concept | Role |
|---------|------|
| **Task** | Generic unit of work. Has `task_type`. Can be visit-bound or remote. |
| **Revision** | One task type — device inspection. |
| **Visit** | Physical presence. Groups 0..N tasks. |
| **planned_action** | Scheduling layer. Links to one `action_target`. |

---

## 3. Design Decisions

Numbered decisions that govern the system. Grouped by domain.

### A. Task Model
1. Single `tasks` table. Task types are user-specifiable via `task_types` reference table.
2. Tasks can be standalone (remote) or visit-bound.
3. Revisions migrated into `tasks` (Phase 6). `revisions` table replaced.
4. Callbacks/follow-ups modeled as task types.

### B. Planned Actions & Targets
5. Polymorphic target linkage via `action_targets`.
6. No hardcoded business type on `planned_actions` — derived from target metadata.
7. `action_targets.target_kind` is a system enum (not user-configurable).

### C. Inbox Display & Localization
8. Inbox returns both `next_action_kind` (stable value) and `next_action_label` (human-readable).
9. Backend returns `next_action_label_key` + `next_action_label_fallback`; frontend resolves translation.

### D. Inbox State Persistence
10. Persisted per dispatcher in DB. Configuration (selected scoring rule set, filters, pagination) restored on inbox open.
11. Single auto-saved last state only (no named saved views).
12. Debounced autosave with background persistence.
13. Silent retry + subtle indicator on failure.
14. Per dispatcher account (shared across devices).
15. Best-effort migration on schema changes (keep valid parts, drop invalid).
16. Always automatic restore on inbox open.
17. Default page size: 25.

### E. Ordering & Urgency Scoring
18. All inbox ordering is via `urgency_score DESC` (computed in Rust). No separate hardcoded sort path.
19. The default "Standard" system profile encodes lifecycle-rank ordering via factor weights.
20. Compute-on-query strategy (load all, score in Rust, sort, page).
21. Score breakdown available on-demand in customer detail (factor-by-factor table).

### F. Scoring Rule Sets
22. Named rule sets per company. One set marked as default.
23. Each rule set has a required unique name (case-insensitive per company) and optional description.
24. Updates apply immediately.
25. Edit permissions controlled by company role settings.
26. Inbox can select; create/edit/delete in Settings.
27. All dispatchers can select a rule set in inbox.

### G. Scoring Factors & Weights
28. All factors optional (weight = 0 disables). Weight bounds: −10000..+10000.
29. All-zero configuration allowed (ordering falls back to `customer_created_at`).
30. Eight factor keys available:

| Factor key | Raw value | Default weight | Notes |
|---|---|---|---|
| `lifecycle_rank` | `(3 − rank)` where rank 0=untouched, 1=overdue, 2=active, 3=needs_action | +1000 | Inverted formula: untouched → 3×w, needs_action → 0×w |
| `days_until_due` | `due_date − today` (negative = overdue) | −5 | More overdue = higher score |
| `customer_age_days` | `today − customer_created_at` | +0.01 | Tiebreaker: older customers first |
| `overdue_days` | Days past due date | 0 | |
| `geocode_failed` | 1 if geocoding failed, else 0 | 0 | |
| `total_communications` | Count of communications | 0 | |
| `days_since_last_contact` | Days since last communication | 0 | |
| `no_open_action` | 1 if no open planned action, else 0 | 0 | |

### H. System Scoring Profiles
31. A "Standard" system profile (`is_system = TRUE`) is seeded automatically on onboarding.
32. System profiles: fully editable (name, weights) but **cannot be deleted**. "Restore defaults" resets to factory values.
33. `is_system` flag is immutable via API.
34. If no `selected_rule_set_id` in inbox request, the user's default rule set is auto-selected.

### I. Rule-Set Archival
35. Archival supported (retained for history, not actively used).
36. Archived selection falls back to company default.
37. Unarchive restores to active state immediately.

### J. Materialized Scoring Path (future)
38. Automatic suggestion + manual confirmation based on thresholds.
39. Two-tier refresh (incremental + periodic full recompute).
40. Immediate fallback to compute-on-query on failure.

### K. Audit Logging & Export (future)
41. Audit log for rule-set changes (who, when).
42. Export in CSV/JSON, async job, short TTL.

---

## 4. Inbox Query Behavior

### 4.1. Sort Priority

All sorting is driven by `urgency_score DESC`, then `customer_created_at ASC` as tiebreaker. The default "Standard" scoring profile reproduces lifecycle-rank ordering:

| Lifecycle state | Rank | Inverted value | Score contribution (weight=1000) |
|---|---|---|---|
| Untouched | 0 | 3 | +3000 |
| Overdue | 1 | 2 | +2000 |
| Active (upcoming) | 2 | 1 | +1000 |
| Needs action | 3 | 0 | 0 |

Within each effective group, `days_until_due` (weight −5) pushes overdue items higher and `customer_age_days` (weight +0.01) serves as a tiebreaker.

### 4.2. Filter Tabs

| Tab | Meaning |
|---|---|
| **Vše** (All) | All customers except abandoned and deleted. Default. |
| **Akutní** (Urgent) | Overdue actions + untouched customers. |
| **Do 7 dnů** | Actions due within 7 days. |
| **Do 30 dnů** | Actions due within 30 days. |
| **Má termín** (Has date) | Active customers with a scheduled action. |
| **Problémové** (Problems) | Overdue > 30 days, failed visits, failed geocoding. |

Abandoned customers excluded from inbox. Visible on Customers page with dedicated filter.

Inbox UI state is persisted per dispatcher in DB and restored on next open.

---

## 5. Unschedule Visit

### 5.1. Semantics

The *revision* (obligation to inspect a device) still exists — the *visit appointment* is being removed. The revision reverts from `scheduled`/`confirmed` to `upcoming` with scheduling fields cleared. The customer reappears in the inbox.

**State transition**: `scheduled`/`confirmed` → `upcoming` (clears `scheduled_date`, `scheduled_time_start`, `scheduled_time_end`, `assigned_crew_id`).

**Idempotency**: Calling unschedule on an `upcoming` revision is a success (no-op). Calling on `completed`/`cancelled` is rejected.

### 5.2. Revision ID Resolution (Inbox)

1. If customer is in route and stop has `revisionId`, use that.
2. Else use `latestScheduledRevisionId` only when `scheduledRevisionCount === 1`.
3. If `scheduledRevisionCount > 1`, block and direct dispatcher to revision detail.

### 5.3. Side Effects

- Route: auto-removes the customer stop and triggers recalculation.
- `planned_action` remains `open` — customer stays in inbox.
- Detached panels sync via `SCHEDULE_SNAPSHOT` signal (full `scheduledCustomerIds` set replacement, no accumulate logic).

---

## 6. Glossary

| Term | Definition |
|---|---|
| **Planned action** | A scheduled unit in the dispatcher queue (due date, status, snooze, note), linked to one `action_target`. |
| **Lifecycle state** | Classification: untouched, needs_action, active, abandoned, deleted. Stored (abandoned, deleted) or computed from communications and planned_actions. |
| **Inbox** | The dispatcher's work queue. Customers ordered by `urgency_score DESC`. |
| **Snooze** | Temporarily deferring an action to a future date. Hidden from inbox until snooze date. |
| **Task** | Generic unit of work. User-definable types via `task_types`. Can be visit-bound or remote. |
| **Action target** | Polymorphic target referenced by `planned_actions`. Resolves to task, visit, project, or other. |
| **Task type** | User-definable category (revision, installation, callback, etc.) stored in `task_types`. |
| **Scoring rule set** | Named company-level urgency factor weights. A "Standard" system profile is seeded automatically — editable but not deletable. |
| **Urgency score** | Weighted numeric score per customer. Sole determinant of inbox ordering. |
| **Unschedule** | Reverting a scheduled/confirmed revision to `upcoming` by clearing scheduling fields. The obligation persists; only the appointment is removed. |
| **Dispatcher inbox state** | Per-dispatcher persisted configuration (selected rule set, filters, page). Autosaved and restored on inbox open. |
