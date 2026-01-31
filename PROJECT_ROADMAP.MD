# Project Roadmap - Sazinka v1.0 GA

> **Last Updated:** 2026-01-30 (added Phase 5: Production Readiness)

## Current State Analysis

**Backend (Rust Worker):**
- Customer handlers: 100% complete
- Device handlers: 100% complete ✅
- Revision handlers: 100% complete ✅
- Route handlers: 100% complete (planning works)

**Frontend (React):**
- Customers/CustomerDetail: Fully functional + Devices + Timeline ✅
- Planner: Fully functional + drag/drop + save/load ✅
- Admin: Fully functional + Export UI ✅
- Settings: Fully functional (work, business, email, depots) ✅
- Dashboard: Real stats from revision.stats ✅
- Calendar: Fully functional with real data ✅

**Database:** Schema complete for all tables including communications and visits ✅

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
│                     PHASE 3: Users & Communication ✅ COMPLETE               │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │    User      │    │  Settings    │    │   Export +   │                 │
│   │  (mocked) ✅ │    │   UI ✅      │    │   CSV ✅     │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PHASE 4: CRM Evidence ✅ COMPLETE                      │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │ Communication│    │   Visits     │    │  Customer    │                 │
│   │    Log ✅    │    │  Tracking ✅ │    │  Timeline ✅ │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 5: Production Readiness 📋 PLANNED                   │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │ 5A: Auth +   │    │ 5B: Billing  │    │ 5C: 2FA +    │                 │
│   │ Security 🔴  │───▶│ + RLS  🟡    │───▶│ GDPR   🟢    │                 │
│   │  (MUST)      │    │  (SHOULD)    │    │  (NICE)      │                 │
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

## Phase 4: CRM Evidence (Communication & Visits) ✅ COMPLETE

> **Completed:** 2026-01-30

### 4.1 Database Migration ✅

**File:** `worker/migrations/20260130_000001_crm_enhancements.sql`
- Extended communications table with user_id, contact fields, follow-up tracking ✅
- Created visits table with scheduling, status, and result tracking ✅

### 4.2 Communication Handlers ✅

**Files created:**
- `worker/src/types/communication.rs` ✅
- `worker/src/handlers/communication.rs` ✅
- `worker/src/db/queries/communication.rs` ✅
- `packages/shared-types/src/communication.ts` ✅
- `apps/web/src/services/communicationService.ts` ✅

**NATS subjects implemented:**
- `sazinka.communication.create` ✅
- `sazinka.communication.list` ✅
- `sazinka.communication.update` ✅
- `sazinka.communication.delete` ✅

### 4.3 Visit Handlers ✅

**Files created:**
- `worker/src/types/visit.rs` ✅
- `worker/src/handlers/visit.rs` ✅
- `worker/src/db/queries/visit.rs` ✅
- `packages/shared-types/src/visit.ts` ✅
- `apps/web/src/services/visitService.ts` ✅

**NATS subjects implemented:**
- `sazinka.visit.create` ✅
- `sazinka.visit.list` ✅
- `sazinka.visit.update` ✅
- `sazinka.visit.complete` ✅
- `sazinka.visit.delete` ✅

**Visit types (`visit_type`):**
| Type | Description |
|------|-------------|
| `revision` | Regular revision (links to revisions table) |
| `service` | Service call |
| `sales` | Sales meeting |
| `complaint` | Complaint handling |
| `consultation` | Consultation |
| `other` | Other |

### 4.4 Communication UI ✅

**Files created:**
- `apps/web/src/services/communicationService.ts` ✅
- Communication forms integrated into CustomerTimeline ✅

### 4.5 Visit UI ✅

**Files created:**
- `apps/web/src/services/visitService.ts` ✅
- Visit forms integrated into CustomerTimeline ✅

### 4.6 Customer Timeline ✅

**Files created:**
- `apps/web/src/components/timeline/CustomerTimeline.tsx` ✅
- `apps/web/src/components/timeline/CustomerTimeline.module.css` ✅
- `apps/web/src/components/timeline/index.ts` ✅

**Features implemented:**
- Unified chronological view with communications and visits ✅
- Add communication form (notes, calls, emails, SMS) ✅
- Add visit form with scheduling ✅
- Status badges for visit states ✅
- Icons for communication types ✅

### 4.7 Dashboard Enhancements

(Stretch goal - deferred)
- Pending follow-ups count + list
- Today's visits count + list
- This week's visits count

---

## Phase 5: Production Readiness (Public SaaS) 📋 PLANNED

> **Status:** Planning phase - required before public launch

### Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PHASE 5: Production Readiness                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 5A: Pre-Launch (MUST HAVE)                                           │  │
│   │  ├─ Authentication (JWT)                                             │  │
│   │  ├─ TLS on WebSocket                                                 │  │
│   │  ├─ Rate limiting                                                    │  │
│   │  ├─ Health checks                                                    │  │
│   │  ├─ Managed PostgreSQL                                               │  │
│   │  └─ Error tracking (Sentry)                                          │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 5B: Launch (SHOULD HAVE)                                             │  │
│   │  ├─ Row Level Security                                               │  │
│   │  ├─ Billing integration (Stripe)                                     │  │
│   │  ├─ Usage metering                                                   │  │
│   │  ├─ Uptime monitoring                                                │  │
│   │  └─ Terms of Service + Privacy Policy                                │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 5C: Post-Launch (NICE TO HAVE)                                       │  │
│   │  ├─ 2FA/MFA                                                          │  │
│   │  ├─ OAuth providers                                                  │  │
│   │  ├─ Full observability stack                                         │  │
│   │  ├─ GDPR compliance tools                                            │  │
│   │  └─ Advanced audit logging                                           │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 5A: Pre-Launch (MUST HAVE) 🔴

#### 5A.1 Authentication & Authorization

**Current state:** Hardcoded `TEMP_USER_ID`, no login flow

**Files to create/modify:**
- `worker/src/handlers/auth.rs` - JWT login/logout/verify
- `worker/src/middleware/auth.rs` - JWT validation middleware
- `apps/web/src/pages/Login.tsx` - Login form
- `apps/web/src/stores/authStore.ts` - Implement JWT storage

**Features:**
| Feature | Priority | Description |
|---------|----------|-------------|
| JWT login | MUST | Email + password → JWT token |
| JWT refresh | MUST | Refresh token rotation |
| Password hashing | MUST | bcrypt or argon2 |
| Password reset | MUST | Email-based reset flow |
| Session invalidation | MUST | Logout clears tokens |

**NATS subjects:**
- `sazinka.auth.login` - Returns JWT + refresh token
- `sazinka.auth.logout` - Invalidates session
- `sazinka.auth.verify` - Validates JWT
- `sazinka.auth.refresh` - Rotates tokens
- `sazinka.auth.reset-password` - Initiates reset
- `sazinka.auth.set-password` - Completes reset

#### 5A.2 TLS on WebSocket

**Current state:** NATS WebSocket without encryption (warning in logs)

**Solution options:**
1. **Cloudflare Tunnel** (recommended) - Zero-config TLS termination
2. **nginx reverse proxy** - `proxy_pass` to NATS with SSL cert
3. **Native NATS TLS** - Configure certs in `nats-server.conf`

**Files to modify:**
- `infra/docker-compose.yml` - Add nginx or configure NATS TLS
- `infra/nginx.conf` - NEW (if using nginx)

#### 5A.3 Rate Limiting

**Current state:** Only geocoding has rate limiting

**Implementation:**
- Per-handler rate limits in Rust (token bucket algorithm)
- Or: nginx `limit_req_zone` directive

**Limits to implement:**
| Endpoint | Limit | Window |
|----------|-------|--------|
| `auth.login` | 5 | 1 min |
| `customer.*` | 100 | 1 min |
| `route.plan` | 10 | 1 min |
| `geocode.*` | 20 | 1 min |

#### 5A.4 Health Checks

**Current state:** Only `sazinka.ping` handler exists

**Endpoints to add:**
- `GET /health` - Basic liveness (HTTP, not NATS)
- `GET /ready` - Readiness (DB connected, services up)

**Files to create:**
- `worker/src/http_server.rs` - Minimal HTTP server for health checks

#### 5A.5 Managed PostgreSQL

**Current state:** Local Docker PostgreSQL

**Recommended providers:**
| Provider | Free tier | Backups | Notes |
|----------|-----------|---------|-------|
| **Neon** | 0.5 GB | Daily | Serverless, auto-scaling |
| **Supabase** | 500 MB | Daily | Includes auth (alternative) |
| **Railway** | $5 credit | Manual | Simple setup |

**Migration steps:**
1. Export schema and data
2. Update `DATABASE_URL` in production
3. Test connection from VPS

#### 5A.6 Error Tracking

**Current state:** File-based logging only

**Solution:** Sentry (free tier: 5K errors/month)

**Files to modify:**
- `worker/Cargo.toml` - Add `sentry` crate
- `worker/src/main.rs` - Initialize Sentry
- `apps/web/package.json` - Add `@sentry/react`
- `apps/web/src/main.tsx` - Initialize Sentry

---

### 5B: Launch (SHOULD HAVE) 🟡

#### 5B.1 Row Level Security (RLS)

**Purpose:** Database-level tenant isolation

**Migration:**
```sql
-- Enable RLS on all tenant tables
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE revisions ENABLE ROW LEVEL SECURITY;
-- etc.

-- Create policies
CREATE POLICY tenant_isolation ON customers
    USING (user_id = current_setting('app.current_user_id')::uuid);
```

**Worker modification:**
```rust
// Set user context before each query
sqlx::query("SET app.current_user_id = $1")
    .bind(user_id)
    .execute(&pool)
    .await?;
```

#### 5B.2 Billing Integration

**Provider:** Stripe (recommended for simplicity)

**Database tables:**
```sql
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    plan_id VARCHAR(50) NOT NULL, -- 'free', 'basic', 'pro'
    status VARCHAR(20) NOT NULL,  -- 'active', 'canceled', 'past_due'
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE usage_records (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    metric VARCHAR(50) NOT NULL, -- 'customers', 'geocoding', 'routes'
    count INTEGER NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL
);
```

**Plan limits:**
| Plan | Customers | Routes/day | Geocoding/month |
|------|-----------|------------|-----------------|
| Free | 50 | 5 | 100 |
| Basic | 500 | 20 | 1,000 |
| Pro | Unlimited | Unlimited | 10,000 |

#### 5B.3 Usage Metering

**Metrics to track:**
- `customers_count` - Total customers per user
- `routes_planned` - Routes planned per day
- `geocoding_requests` - Geocoding API calls per month
- `storage_bytes` - Future: attachments storage

**Implementation:**
- Increment counters in handlers
- Check limits before operations
- Return `LIMIT_EXCEEDED` error when over quota

#### 5B.4 Uptime Monitoring

**Services:**
- **UptimeRobot** (free: 50 monitors) - HTTP health checks
- **Better Stack** (free tier) - Incident management

**Monitors to create:**
- Frontend availability
- NATS WebSocket connectivity
- Health endpoint response time

#### 5B.5 Legal Documents

**Required documents:**
- Terms of Service (ToS)
- Privacy Policy
- Cookie Policy (if using cookies)
- Data Processing Agreement (DPA) for B2B

**Implementation:**
- Static pages in frontend
- Consent checkbox on signup

---

### 5C: Post-Launch (NICE TO HAVE) 🟢

#### 5C.1 Two-Factor Authentication (2FA)

**Options:**
- TOTP (Google Authenticator, Authy)
- SMS (via Twilio)
- Email OTP

**Files to create:**
- `worker/src/services/totp.rs` - TOTP generation/verification
- `apps/web/src/components/auth/TwoFactorSetup.tsx`

#### 5C.2 OAuth Providers

**Providers to consider:**
- Google (most common)
- Microsoft (for B2B)
- Apple (for future mobile app)

**Library:** `oauth2` crate for Rust

#### 5C.3 Full Observability Stack

**Components:**
```
┌─────────────────────────────────────────────────────────────────────┐
│                     Observability Stack                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐│
│   │ Worker      │───▶│ Vector      │───▶│ Loki (logs)             ││
│   │ NATS        │    │             │    │ Prometheus (metrics)    ││
│   │ PostgreSQL  │    │             │    │ Tempo (traces)          ││
│   └─────────────┘    └─────────────┘    └───────────┬─────────────┘│
│                                                     │              │
│                                          ┌──────────▼──────────┐   │
│                                          │ Grafana             │   │
│                                          │ - Dashboards        │   │
│                                          │ - Alerting          │   │
│                                          └─────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Rust crates:**
- `tracing-opentelemetry` - Distributed tracing
- `metrics` + `metrics-exporter-prometheus` - Metrics export

#### 5C.4 GDPR Compliance

**Features to implement:**
- **Data export** - Full user data in JSON/ZIP
- **Data deletion** - "Right to be forgotten"
- **Consent management** - Track what user agreed to
- **Audit trail** - Who accessed what when

**Database tables:**
```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY,
    user_id UUID,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    old_value JSONB,
    new_value JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_consents (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    consent_type VARCHAR(50) NOT NULL,
    granted BOOLEAN NOT NULL,
    granted_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);
```

---

### Production Architecture Target

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Production Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────┐                                                      │
│   │ Cloudflare       │  - CDN for static assets                             │
│   │ (Edge)           │  - TLS termination                                   │
│   │                  │  - DDoS protection                                   │
│   │                  │  - WAF rules                                         │
│   └────────┬─────────┘                                                      │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────┐      ┌──────────────────┐                           │
│   │ NATS Cluster     │◀────▶│ Worker Cluster   │                           │
│   │ (2+ nodes)       │      │ (2+ instances)   │                           │
│   │ + JetStream      │      │ + Health checks  │                           │
│   └──────────────────┘      └────────┬─────────┘                           │
│                                      │                                      │
│                                      ▼                                      │
│                            ┌──────────────────┐                             │
│                            │ Managed PostgreSQL│                            │
│                            │ (Neon/Supabase)  │                             │
│                            │ + Auto backups   │                             │
│                            │ + RLS enabled    │                             │
│                            └──────────────────┘                             │
│                                                                              │
│   ┌──────────────────┐      ┌──────────────────┐                           │
│   │ Valhalla         │      │ Nominatim        │                           │
│   │ (self-hosted)    │      │ (self-hosted)    │                           │
│   └──────────────────┘      └──────────────────┘                           │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │ External Services                                                     │ │
│   │  ├─ Stripe (billing)                                                 │ │
│   │  ├─ Sentry (error tracking)                                          │ │
│   │  ├─ Resend (emails)                                                  │ │
│   │  └─ UptimeRobot (monitoring)                                         │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

---

## Phase 6: UX Workflow (Call Queue, Smart Scheduling) 🚧 IN PROGRESS

> **Status:** Phase 6A-6B complete, 6C partially complete
> **Reference:** See `PROJECT_UX.MD` for full wireframes and concepts

### Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 6: UX Workflow                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 6A: Call Queue (MVP)                                                 │  │
│   │  ├─ Fronta k obvolání (revize v okně 11-12 měsíců)                  │  │
│   │  ├─ Filtry: oblast, typ služby, priorita                            │  │
│   │  ├─ Quick actions: Zavolat, Odložit, Domluvit                       │  │
│   │  └─ snooze_until pole pro odložení                                   │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 6B: Schedule Dialog (MVP)                                            │  │
│   │  ├─ Výběr dne + časového okna                                       │  │
│   │  ├─ Přiřazení vozidla/technika                                      │  │
│   │  ├─ Délka úkonu (default z device type)                             │  │
│   │  └─ Uložení do Revision (scheduled_date, time_window)               │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 6C: Enhanced Day Planner (MVP)                                       │  │
│   │  ├─ Seznam zastávek s časovými okny                                 │  │
│   │  ├─ Varování konfliktů (červené/žluté)                              │  │
│   │  ├─ Vehicle tabs (multi-car)                                         │  │
│   │  └─ Day load indicator                                               │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 6D: Technician View (MVP)                                            │  │
│   │  ├─ Můj dnešní plán (mobile-friendly)                               │  │
│   │  ├─ Per-stop: Navigovat, Volat, Hotovo, Nezastižen                  │  │
│   │  └─ Export: segmented Google Maps + PDF                              │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 6E: Smart Slots (V2)                                                 │  │
│   │  ├─ Insertion heuristic algoritmus                                   │  │
│   │  ├─ Valhalla matrix cache per den/vozidlo                           │  │
│   │  ├─ 3-5 doporučených slotů při domluvě                              │  │
│   │  └─ Vizualizace dopadu na trasu (+X min)                            │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 6A: Call Queue (Fronta k obvolání)

**Database changes:**
```sql
ALTER TABLE revisions ADD COLUMN snooze_until DATE;
ALTER TABLE revisions ADD COLUMN snooze_reason VARCHAR(255);
```

**NATS subjects:**
- `sazinka.revision.queue` - List revisions in due window
- `sazinka.revision.snooze` - Postpone revision

**Files to create:**
- [x] `worker/src/db/queries/revision.rs` - Add queue query ✅
- [x] `apps/web/src/pages/CallQueue.tsx` - NEW ✅
- [x] `apps/web/src/pages/CallQueue.module.css` - NEW ✅
- [x] Queue item inline in CallQueue.tsx (no separate component needed)

**Query logic:**
```sql
SELECT r.*, c.*, d.*
FROM revisions r
JOIN customers c ON r.customer_id = c.id
JOIN devices d ON r.device_id = d.id
WHERE r.user_id = $1
  AND r.status IN ('upcoming', 'scheduled')
  AND r.scheduled_date IS NULL  -- not yet scheduled
  AND (r.snooze_until IS NULL OR r.snooze_until <= CURRENT_DATE)
  AND r.due_date BETWEEN CURRENT_DATE - INTERVAL '30 days' 
                     AND CURRENT_DATE + INTERVAL '60 days'
ORDER BY 
  CASE WHEN r.due_date < CURRENT_DATE THEN 0 ELSE 1 END,  -- overdue first
  r.due_date ASC
```

---

### 6B: Schedule Dialog

**Database changes:**
```sql
ALTER TABLE revisions ADD COLUMN assigned_vehicle_id UUID;
ALTER TABLE revisions ADD COLUMN route_order INTEGER;

CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  home_depot_id UUID REFERENCES depots(id),
  preferred_areas TEXT[],
  working_hours_start TIME DEFAULT '08:00',
  working_hours_end TIME DEFAULT '17:00',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**NATS subjects:**
- `sazinka.vehicle.create` - Create vehicle
- `sazinka.vehicle.list` - List vehicles
- `sazinka.vehicle.update` - Update vehicle
- `sazinka.vehicle.delete` - Delete vehicle

**Files to create:**
- [x] `worker/src/types/vehicle.rs` - NEW ✅
- [x] `worker/src/handlers/vehicle.rs` - NEW ✅
- [x] `worker/src/db/queries/vehicle.rs` - NEW ✅
- [ ] `apps/web/src/services/vehicleService.ts` - NEW (pending)
- [x] Schedule dialog inline in CallQueue.tsx ✅

---

### 6C: Enhanced Day Planner

**Enhancements to existing Planner:**
- ~~Vehicle tabs (select which vehicle's route to view/edit)~~ (pending)
- ~~Time window display per stop~~ (pending)
- ~~Conflict warnings (time window violations)~~ (pending)
- ~~Day load indicator (total service time + travel time)~~ (pending)
- [x] View tabs: "Doporučené" / "Naplánované" ✅
- [x] Load scheduled revisions for selected date ✅

**Files modified:**
- [x] `apps/web/src/pages/Planner.tsx` - Added view tabs, scheduled revisions ✅
- [x] `apps/web/src/pages/Planner.module.css` - Tab styles ✅

**Calendar enhancements:**
- [x] View mode toggle: "Termíny" (due_date) / "Naplánované" (scheduled_date) ✅
- [x] `apps/web/src/pages/Calendar.tsx` - Added view toggle ✅
- [x] `apps/web/src/utils/calendarUtils.ts` - groupRevisionsByDay with dateField param ✅

---

### 6D: Technician View

**Files to create:**
- [ ] `apps/web/src/pages/TechnicianDay.tsx` - NEW (mobile-friendly)
- [ ] `apps/web/src/pages/TechnicianDay.module.css` - NEW
- [ ] `apps/web/src/services/exportService.ts` - Add Google Maps + PDF

**Export features:**
- Segmented Google Maps links (8-10 stops per link)
- PDF with addresses, phones, time windows, notes
- "Navigate to next" single-stop links

---

### 6E: Smart Slots (V2)

**NATS subject:**
- `sazinka.slots.suggest` - Get best slots for new appointment

**Algorithm (insertion heuristic):**
1. Load existing route for day + vehicle
2. For each possible time slot (e.g., 08-10, 10-12, 12-14...):
   - Try inserting new stop at each position
   - Calculate delta travel time using Valhalla
   - Check feasibility (time windows)
   - Score: 60% delta time + 25% slack + 15% area coherence
3. Return top 3-5 slots with impact visualization

**Files to create:**
- [ ] `worker/src/services/slot_suggester.rs` - NEW
- [ ] `worker/src/handlers/slots.rs` - NEW
- [ ] `apps/web/src/services/slotService.ts` - NEW

---

## Out of Scope for v1.0

Explicitly excluded:
- Mobile app
- Multi-tenant/team features (multiple users per account)
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

Phase 2 (Smart Planning): ✅ COMPLETE
  2.1 Calendar with real data ✅
  2.2 Smart plan suggestion algorithm ✅
  2.3 Drag/drop + lock/unlock ✅
  2.4 Route persistence ✅

Phase 3 (Users & Comms): ✅ COMPLETE
  3.1 Authentication (mocked) ✅
  3.2 Settings UI ✅
  3.3 CSV export ✅
  3.4 Email reminders (stretch goal - deferred)

Phase 4 (CRM Evidence): ✅ COMPLETE
  4.1 Database migration (communications + visits) ✅
  4.2 Communication handlers (TDD) ✅
  4.3 Visit handlers (TDD) ✅
  4.4 Communication UI components ✅
  4.5 Visit UI components ✅
  4.6 Customer Timeline ✅
  4.7 Dashboard enhancements (deferred)

Phase 5 (Production Readiness): 📋 PLANNED
  5A: Pre-Launch (MUST HAVE) 🔴
    5A.1 JWT Authentication
    5A.2 TLS on WebSocket
    5A.3 Rate limiting
    5A.4 Health checks
    5A.5 Managed PostgreSQL
    5A.6 Error tracking (Sentry)
  
  5B: Launch (SHOULD HAVE) 🟡
    5B.1 Row Level Security
    5B.2 Billing (Stripe)
    5B.3 Usage metering
    5B.4 Uptime monitoring
    5B.5 Legal documents (ToS, Privacy)
  
  5C: Post-Launch (NICE TO HAVE) 🟢
    5C.1 Two-Factor Authentication
    5C.2 OAuth providers
    5C.3 Full observability stack
    5C.4 GDPR compliance tools

Phase 6 (UX Workflow): 🔄 IN PROGRESS
  6A: Call Queue (MVP)
    6A.1 DB migration (snooze_until, snooze_reason) 🔄
    6A.2 revision.queue endpoint (TDD)
    6A.3 revision.snooze endpoint (TDD)
    6A.4 CallQueue page UI
  
  6B: Schedule Dialog (MVP)
    6B.1 DB migration (vehicles table, assigned_vehicle_id)
    6B.2 Vehicle CRUD handlers (TDD)
    6B.3 ScheduleRevisionDialog component
  
  6C: Enhanced Day Planner (MVP)
    6C.1 Vehicle selector tabs
    6C.2 Time window display
    6C.3 Conflict warnings
  
  6D: Technician View (MVP)
    6D.1 TechnicianDay page
    6D.2 Google Maps export (segmented)
    6D.3 PDF export
  
  6E: Smart Slots (V2)
    6E.1 Insertion heuristic algorithm
    6E.2 Valhalla matrix cache
    6E.3 slots.suggest endpoint
    6E.4 UI integration
```
