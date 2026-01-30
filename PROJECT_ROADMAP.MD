# Project Roadmap - Sazinka v1.0 GA

> **Last Updated:** 2026-01-29

## Current State Analysis

**Backend (Rust Worker):**
- Customer handlers: 100% complete
- Device handlers: 0% (file missing, 2/5 DB queries exist)
- Revision handlers: 0% (file missing, 2/8 DB queries exist)
- Route handlers: 100% complete (planning works)

**Frontend (React):**
- Customers/CustomerDetail: Fully functional
- Planner: Fully functional
- Admin: Fully functional
- Dashboard: Placeholder (hardcoded zeros)
- Calendar: Placeholder (static, non-functional)

**Database:** Schema complete for all 7 tables, queries partially implemented.

---

## Roadmap Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PHASE 1: Core Flow                              │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │ Device CRUD  │    │ Revision CRUD│    │  Dashboard   │                 │
│   │  Backend +   │    │  Backend +   │    │   Stats      │                 │
│   │  Frontend    │    │  Frontend    │    │              │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 2: Smart Planning                            │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │  Functional  │    │ Smart Plan   │    │ Planner UX   │                 │
│   │  Calendar    │    │ Suggestions  │    │ Improvements │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 3: Users & Communication                        │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │    User      │    │  Settings    │    │   Export +   │                 │
│   │    Auth      │    │     UI       │    │    Email     │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Flow (Devices, Revisions, Dashboard)

### 1.1 Device Handlers

**Files to create/modify:**
- `worker/src/handlers/device.rs` - NEW
- `worker/src/db/queries/device.rs` - Add missing queries
- `worker/src/types/device.rs` - Add `UpdateDeviceRequest`
- `worker/src/handlers/mod.rs` - Register handlers

**NATS subjects:**
- `sazinka.device.create`
- `sazinka.device.list`
- `sazinka.device.get`
- `sazinka.device.update`
- `sazinka.device.delete`

### 1.2 Revision Handlers

**Files to create/modify:**
- `worker/src/handlers/revision.rs` - NEW
- `worker/src/db/queries/revision.rs` - Add CRUD queries
- `worker/src/types/revision.rs` - Add request types

**NATS subjects:**
- `sazinka.revision.create`
- `sazinka.revision.list` (with filters: status, date range, customer_id)
- `sazinka.revision.get`
- `sazinka.revision.update`
- `sazinka.revision.complete`
- `sazinka.revision.upcoming` (overdue + due soon)
- `sazinka.revision.stats` (for dashboard)

### 1.3 Device Management UI

**Files to create:**
- `apps/web/src/services/deviceService.ts` - NEW
- `apps/web/src/components/devices/DeviceList.tsx` - NEW
- `apps/web/src/components/devices/DeviceForm.tsx` - NEW
- `apps/web/src/pages/CustomerDetail.tsx` - Add devices section

**Features:**
- List devices for customer
- Add new device form
- Edit/delete device
- Show revision history per device

### 1.4 Revision Management UI

**Files to create:**
- `apps/web/src/services/revisionService.ts` - NEW
- `apps/web/src/components/revisions/RevisionList.tsx` - NEW
- `apps/web/src/components/revisions/RevisionForm.tsx` - NEW

**Features:**
- List revisions with status badges
- Create new revision for device
- Change revision status
- Complete revision with result/findings

### 1.5 Dashboard with Real Data

**Files to modify:**
- `apps/web/src/pages/Dashboard.tsx`

**Stats to display:**
- Overdue revisions count (red)
- Due this week count (yellow)
- Scheduled today count (green)
- Completed this month count

---

## Phase 2: Smart Planning (Calendar, Intelligent Suggestions)

### 2.1 Functional Calendar

**Files to modify:**
- `apps/web/src/pages/Calendar.tsx` - Complete rewrite
- `apps/web/src/components/calendar/CalendarGrid.tsx` - NEW
- `apps/web/src/components/calendar/DayCell.tsx` - NEW

**Features:**
- Month navigation (working)
- Display scheduled revisions per day
- Color coding by revision count/status
- Click day to see details or navigate to planner

### 2.2 Smart Plan Suggestion

**Files to modify:**
- `worker/src/handlers/route.rs` - Add selection logic
- `apps/web/src/pages/Planner.tsx` - Replace random selection

**New NATS subject:**
- `sazinka.revision.suggest` - Get best candidates for a date

**Selection algorithm (priority scoring):**
1. Overdue revisions (highest priority)
2. Due within 7 days
3. Due within 30 days
4. Geographic clustering (nearby customers)
5. Time window compatibility

### 2.3 Planner UX Improvements

**Features to add:**
- Drag and drop reordering (dnd-kit)
- Lock/unlock individual stops
- Manual add/remove stops from plan
- Stability indicator (green/yellow/red)

### 2.4 Route Persistence

**NATS subjects:**
- `sazinka.route.save` - Save planned route
- `sazinka.route.get` - Load route for date
- `sazinka.route.update` - Update stop status

---

## Phase 3: Users, Settings, Communication

### 3.1 User Authentication

**Files to create:**
- `worker/src/handlers/auth.rs` - NEW
- `apps/web/src/pages/Login.tsx` - NEW
- `apps/web/src/stores/authStore.ts` - Implement

**NATS subjects:**
- `sazinka.auth.login`
- `sazinka.auth.logout`
- `sazinka.auth.verify`

### 3.2 User Settings UI

**Files to create:**
- `apps/web/src/pages/Settings.tsx` - NEW
- `apps/web/src/components/settings/SettingsForm.tsx` - NEW

**Settings:**
- Working hours (start, end)
- Default revision interval
- Max revisions per day
- Start address (with geocoding)

### 3.3 Export CSV

**Files to create:**
- `apps/web/src/services/exportService.ts` - NEW

**Export types:**
- Customers export (same format as import)
- Revisions export (date range filter)

### 3.4 Basic Email Reminders (Stretch Goal)

**Files to create:**
- `worker/src/services/email.rs` - NEW
- `worker/src/handlers/email.rs` - NEW

**Features:**
- Email templates (Handlebars)
- Resend API integration
- Manual send button per revision
- Communications log

---

## Out of Scope for v1.0

Explicitly excluded:
- Mobile app
- Multi-tenant/team features
- Invoice generation
- Document attachments
- Incoming email processing
- Advanced reporting/analytics
- Multi-region support

---

## Implementation Order

```
Phase 1 (Core Flow):
  1.1 Device handlers + queries
  1.2 Revision handlers + queries
  1.3 Device UI in CustomerDetail
  1.4 Revision UI components
  1.5 Dashboard stats

Phase 2 (Smart Planning):
  2.1 Calendar with real data
  2.2 Smart plan suggestion algorithm
  2.3 Drag/drop + lock/unlock
  2.4 Route persistence

Phase 3 (Users & Comms):
  3.1 Authentication
  3.2 Settings UI
  3.3 CSV export
  3.4 Email reminders (stretch goal)
```
