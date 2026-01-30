# Project Roadmap - Sazinka v1.0 GA

> **Last Updated:** 2026-01-30

## Current State Analysis

**Backend (Rust Worker):**
- Customer handlers: 100% complete
- Device handlers: 100% complete ✅
- Revision handlers: 100% complete ✅
- Route handlers: 100% complete (planning works)

**Frontend (React):**
- Customers/CustomerDetail: Fully functional + Devices section ✅
- Planner: Fully functional + drag/drop + save/load ✅
- Admin: Fully functional + Export UI ✅
- Settings: Fully functional (work, business, email, depots) ✅
- Dashboard: Real stats from revision.stats ✅
- Calendar: Fully functional with real data ✅

**Database:** Schema complete for all 7 tables + communications table exists.

---

## Roadmap Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 1: Core Flow ✅ COMPLETE                       │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │ Device CRUD  │    │ Revision CRUD│    │  Dashboard   │                 │
│   │  Backend +   │    │  Backend +   │    │   Stats      │                 │
│   │  Frontend ✅ │    │  Frontend ✅ │    │      ✅      │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 2: Smart Planning ✅ COMPLETE                     │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │  Functional  │    │ Smart Plan   │    │ Planner UX   │                 │
│   │  Calendar ✅ │    │ Suggest. ✅  │    │ + Persist ✅ │                 │
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
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            PHASE 4: CRM Evidence                             │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │ Communication│    │   Visits     │    │  Customer    │                 │
│   │    Log       │    │  Tracking    │    │  Timeline    │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Flow (Devices, Revisions, Dashboard) ✅ COMPLETE

> **Completed:** 2026-01-30

### 1.1 Device Handlers ✅

**Files created:**
- `worker/src/handlers/device.rs` ✅
- `worker/src/db/queries/device.rs` ✅
- `worker/src/types/device.rs` ✅

**NATS subjects (all implemented):**
- `sazinka.device.create` ✅
- `sazinka.device.list` ✅
- `sazinka.device.get` ✅
- `sazinka.device.update` ✅
- `sazinka.device.delete` ✅

### 1.2 Revision Handlers ✅

**Files created:**
- `worker/src/handlers/revision.rs` ✅
- `worker/src/db/queries/revision.rs` ✅
- `worker/src/types/revision.rs` ✅

**NATS subjects (all implemented):**
- `sazinka.revision.create` ✅
- `sazinka.revision.list` ✅
- `sazinka.revision.get` ✅
- `sazinka.revision.update` ✅
- `sazinka.revision.complete` ✅
- `sazinka.revision.upcoming` ✅
- `sazinka.revision.stats` ✅

### 1.3 Device Management UI ✅

**Files created:**
- `apps/web/src/services/deviceService.ts` ✅ (with TDD tests)
- `apps/web/src/components/devices/DeviceList.tsx` ✅
- `apps/web/src/components/devices/DeviceForm.tsx` ✅
- `apps/web/src/pages/CustomerDetail.tsx` - Devices section added ✅

### 1.4 Revision Management UI ✅

**Files created:**
- `apps/web/src/services/revisionService.ts` ✅ (with TDD tests)
- `apps/web/src/components/revisions/RevisionList.tsx` ✅
- `apps/web/src/components/revisions/RevisionForm.tsx` ✅
- `apps/web/src/components/revisions/CompleteRevisionDialog.tsx` ✅

### 1.5 Dashboard with Real Data ✅

**Stats displayed:**
- Overdue revisions count (red) ✅
- Due this week count (yellow) ✅
- Scheduled today count (green) ✅
- Completed this month count ✅

---

## Phase 2: Smart Planning (Calendar, Intelligent Suggestions) ✅ COMPLETE

> **Completed:** 2026-01-30

### 2.1 Functional Calendar ✅

**Files created:**
- `apps/web/src/pages/Calendar.tsx` - Complete rewrite ✅
- `apps/web/src/components/calendar/CalendarGrid.tsx` ✅
- `apps/web/src/components/calendar/DayCell.tsx` ✅
- `apps/web/src/utils/calendarUtils.ts` ✅ (18 TDD tests)

**Features implemented:**
- Month navigation ✅
- Display scheduled revisions per day ✅
- Color coding by revision count/status ✅
- Click day to see details or navigate to planner ✅

### 2.2 Smart Plan Suggestion ✅

**Files created/modified:**
- `worker/src/handlers/revision.rs` - Added handle_suggest ✅
- `worker/src/db/queries/revision.rs` - Added get_revision_suggestions ✅
- `worker/src/types/revision.rs` - Added suggestion types ✅
- `apps/web/src/services/revisionService.ts` - Added getSuggestedRevisions (+4 TDD tests) ✅
- `apps/web/src/pages/Planner.tsx` - Replaced random selection ✅

**NATS subject:**
- `sazinka.revision.suggest` ✅

**Priority scoring implemented:**
| Priority | Score | Criteria |
|----------|-------|----------|
| Overdue | 100 | due_date < today |
| Due this week | 80 | due_date <= today + 7 days |
| Due soon | 60 | due_date <= today + 14 days |
| Due this month | 40 | due_date <= today + 30 days |
| Upcoming | 20 | due_date > today + 30 days |

### 2.3 Planner UX Improvements ✅

**Files created/modified:**
- `apps/web/src/components/planner/SortableStopItem.tsx` ✅
- `apps/web/src/components/planner/SortableStopItem.module.css` ✅
- `apps/web/src/pages/Planner.tsx` - Added DndContext ✅

**Features implemented:**
- Drag and drop reordering with @dnd-kit ✅
- Lock/unlock individual stops ✅
- Visual feedback during drag ✅
- "Manually reordered" indicator ✅

### 2.4 Route Persistence ✅

**Files created/modified:**
- `worker/src/handlers/route.rs` - Added handle_save, handle_get ✅
- `worker/src/db/queries/route.rs` - Added route_stops queries ✅
- `apps/web/src/services/routeService.ts` ✅

**NATS subjects:**
- `sazinka.route.save` - Save planned route ✅
- `sazinka.route.get` - Load route for date ✅

**Features implemented:**
- Save current route with stops to database ✅
- Load saved route for selected date ✅
- "Load" button appears when saved route exists ✅
- Last saved timestamp display ✅

---

## Phase 3: Users, Settings, Communication 🔄 IN PROGRESS

### 3.1 User Authentication (Skipped - using mock user)

**Status:** Deferred - using TEMP_USER_ID for now

### 3.2 User Settings UI ✅

**Files created:**
- `apps/web/src/pages/Settings.tsx` ✅
- `apps/web/src/pages/Settings.module.css` ✅

**Features implemented:**
- Tab-based settings UI ✅
- Work constraints form (hours, max revisions, service duration) ✅
- Business info form (name, contact, billing) ✅
- Email templates form ✅
- Depots manager (list, add, edit, delete, set primary) ✅

### 3.3 Export CSV ✅

**Files created:**
- `apps/web/src/services/exportService.ts` ✅

**Export types implemented:**
- Customers export (CSV format matching import) ✅
- Revisions export with date range and status filters ✅
- Export UI in Admin page ✅

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

## Phase 4: CRM Evidence (Communication & Visits)

### 4.1 Database Migration

**File:** `worker/migrations/20260130_000001_crm_enhancements.sql`

```sql
-- Extend communications table
ALTER TABLE communications
    ADD COLUMN user_id UUID NOT NULL REFERENCES users(id),
    ADD COLUMN contact_name VARCHAR(255),
    ADD COLUMN contact_phone VARCHAR(50),
    ADD COLUMN duration_minutes INTEGER,
    ADD COLUMN follow_up_date DATE,
    ADD COLUMN follow_up_done BOOLEAN DEFAULT FALSE;

-- New visits table
CREATE TABLE visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision_id UUID REFERENCES revisions(id) ON DELETE SET NULL,
    visit_type VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'planned',
    scheduled_date DATE NOT NULL,
    scheduled_time TIME,
    actual_date DATE,
    actual_time TIME,
    duration_minutes INTEGER,
    result VARCHAR(30),
    summary TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 Communication Handlers

**Files to create:**
- `worker/src/types/communication.rs` - NEW
- `worker/src/handlers/communication.rs` - NEW
- `worker/src/db/queries/communication.rs` - NEW

**NATS subjects:**
- `sazinka.communication.create` - Add record (call, email, note)
- `sazinka.communication.list` - List for customer (with filters)
- `sazinka.communication.get` - Get single record
- `sazinka.communication.update` - Update record
- `sazinka.communication.delete` - Delete record
- `sazinka.communication.follow_ups` - List pending follow-ups

**Communication types (`comm_type`):**
| Type | Description |
|------|-------------|
| `call_outbound` | Outgoing call |
| `call_inbound` | Incoming call |
| `email_sent` | Sent email |
| `email_received` | Received email |
| `sms_sent` | Sent SMS |
| `note` | Internal note |

### 4.3 Visit Handlers

**Files to create:**
- `worker/src/types/visit.rs` - NEW
- `worker/src/handlers/visit.rs` - NEW
- `worker/src/db/queries/visit.rs` - NEW

**NATS subjects:**
- `sazinka.visit.create` - Schedule visit
- `sazinka.visit.list` - List visits (filters: customer_id, date_range, status)
- `sazinka.visit.get` - Get visit details
- `sazinka.visit.update` - Update visit
- `sazinka.visit.complete` - Complete visit (with result)
- `sazinka.visit.cancel` - Cancel visit
- `sazinka.visit.upcoming` - Upcoming visits (for dashboard)

**Visit types (`visit_type`):**
| Type | Description |
|------|-------------|
| `revision` | Regular revision (links to revisions table) |
| `service` | Service call |
| `sales` | Sales meeting |
| `complaint` | Complaint handling |
| `consultation` | Consultation |
| `other` | Other |

### 4.4 Communication UI

**Files to create:**
```
apps/web/src/services/communicationService.ts (TDD)
apps/web/src/components/communications/
├── CommunicationList.tsx      -- Timeline view
├── CommunicationForm.tsx      -- Add record form
├── CommunicationItem.tsx      -- Single timeline item
├── QuickCallForm.tsx          -- Quick call entry
├── QuickNoteForm.tsx          -- Quick note entry
└── index.ts
```

### 4.5 Visit UI

**Files to create:**
```
apps/web/src/services/visitService.ts (TDD)
apps/web/src/components/visits/
├── VisitList.tsx              -- Visit list
├── VisitForm.tsx              -- Schedule visit form
├── VisitCard.tsx              -- Visit card component
├── CompleteVisitDialog.tsx    -- Complete visit dialog
└── index.ts
```

### 4.6 Customer Timeline

**File:** `apps/web/src/components/customer/CustomerTimeline.tsx`

Unified chronological view showing:
- Communications (calls, emails, notes)
- Visits
- Revisions

```
┌─────────────────────────────────────────────────────────────────┐
│  Timeline: ABC s.r.o.                              [+ Add ▼]    │
├─────────────────────────────────────────────────────────────────┤
│  📞 30.1.2026 10:15  Outgoing call (5 min)                      │
│     "Scheduled visit for next week"                             │
│                                                                 │
│  🔧 28.1.2026        Visit - Service (completed)                │
│     Filter replacement, all OK                                  │
│                                                                 │
│  📝 25.1.2026 14:30  Note                                       │
│     "Customer prefers morning appointments"                     │
│                                                                 │
│  ✅ 15.1.2026        Gas boiler revision (passed)               │
│     No defects found                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 4.7 Dashboard Enhancements

Add to Dashboard:
- **Pending follow-ups** count + list
- **Today's visits** count + list
- **This week's visits** count

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
Phase 1 (Core Flow): ✅ COMPLETE
  1.1 Device handlers + queries ✅
  1.2 Revision handlers + queries ✅
  1.3 Device UI in CustomerDetail ✅
  1.4 Revision UI components ✅
  1.5 Dashboard stats ✅

Phase 2 (Smart Planning): 🔄 IN PROGRESS
  2.1 Calendar with real data ✅
  2.2 Smart plan suggestion algorithm ✅
  2.3 Drag/drop + lock/unlock
  2.4 Route persistence

Phase 3 (Users & Comms):
  3.1 Authentication
  3.2 Settings UI (partially done)
  3.3 CSV export
  3.4 Email reminders (stretch goal)

Phase 4 (CRM Evidence):
  4.1 Database migration (communications + visits)
  4.2 Communication handlers (TDD)
  4.3 Visit handlers (TDD)
  4.4 Communication UI components
  4.5 Visit UI components
  4.6 Customer Timeline
  4.7 Dashboard enhancements
```
