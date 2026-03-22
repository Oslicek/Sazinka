# Known Bugs

## BUG-1: Plan page — depot and route segment lines not visible

**Reported:** 2026-03-10
**Page:** Plan (`/plan`)
**Steps to reproduce:**
1. Create a route with 3 stops in Inbox.
2. Navigate to the Plan page.
3. Select the route in the route list.

**Expected:** The map shows the depot marker, all stop markers, and route segment lines connecting them.
**Actual:** Stop markers (1, 2, 3) are visible on the map, but the depot marker and all route segment lines are missing.

**Screenshot:** Image 2 — Plan page showing stops without depot or route lines.

---

## BUG-2: Inbox — route segment lines disappear after returning from Plan

**Reported:** 2026-03-10
**Page:** Inbox (`/inbox`)
**Steps to reproduce:**
1. Create a route with 3 stops in Inbox (route lines visible — see Image 1).
2. Navigate to the Plan page.
3. Return to the Inbox page.

**Expected:** The map shows stop markers, depot marker, and route segment lines (same as before navigating away).
**Actual:** Stop markers and depot marker are visible, but route segment lines are missing.

**Screenshot:** Image 3 — Inbox after returning from Plan, showing stops and depot but no route lines.

---

## BUG-3: Plan page — clicking timeline visits does not highlight stops on map

**Reported:** 2026-03-10
**Page:** Plan (`/plan`)
**Steps to reproduce:**
1. Open a route on the Plan page.
2. Click on a visit/stop card in the route timeline.

**Expected:** The corresponding stop marker on the map is highlighted (same behavior as in Inbox).
**Actual:** Nothing happens on the map. The stop is not highlighted.

**Note:** This interaction works correctly on the Inbox page.
