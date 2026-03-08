# Project Roadmap - Sazinka v1.0 GA

> **Last Updated:** 2026-03-08 (v0.20.0 - CI/CD Pipeline)

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

**Recent delivery (Export+):**
- Async Export+ processing on worker via JetStream (`SAZINKA_EXPORT_JOBS`) ✅
- Export status streaming into `Úlohy` (`sazinka.job.export.status.*`) ✅
- Manual download action in Jobs history (`Stáhnout export`) for completed export jobs ✅
- Export ZIP filename standardized to `export-YYYYMMDD-HHMMSS-XX.zip` with user timezone applied ✅

---

## Roadmap Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PHASE 1: Core Flow ✅ COMPLETE                       │
│   Device CRUD + Revision CRUD + Dashboard Stats                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PHASE 2: Smart Planning ✅ COMPLETE                     │
│   Functional Calendar + Smart Plan Suggestions + Planner UX + Persistence  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PHASE 3: Users & Communication ✅ COMPLETE               │
│   User (mocked) + Settings UI + Export CSV                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PHASE 4: CRM Evidence ✅ COMPLETE                      │
│   Communication Log + Visits Tracking + Customer Timeline                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   PHASE 5: Production Readiness 📋 PLANNED                   │
│   5A: Auth + Security (MUST) → 5B: Billing + RLS (SHOULD) → 5C: 2FA (NICE) │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PHASE 6: UX Workflow ✅ COMPLETE                       │
│   Call Queue + Schedule Dialog + Day Planner + Smart Slots + Workflow UI   │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               PHASE 7: JetStream External Services ✅ COMPLETE               │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │ 7A: Valhalla │    │ 7B: Import/  │    │ 7C: Email/   │                 │
│   │  JetStream   │───▶│   Export     │───▶│   SMS Jobs   │                 │
│   │  (routing)   │    │   Jobs       │    │   (future)   │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                              │                                              │
│                              ▼                                              │
│                    ┌──────────────────┐                                    │
│                    │ 7D: Jobs Dashboard│                                   │
│                    │   (monitoring UI) │                                   │
│                    └──────────────────┘                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│           PHASE 8: UX/UI Redesign (Route-Aware Planning) ✅ COMPLETED         │
│                                                                              │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                 │
│   │ 8A: Inbox    │    │ 8B: Route-   │    │ 8C: Route-   │                 │
│   │  Layout +    │───▶│   Aware per  │───▶│   Aware for  │                 │
│   │  Context     │    │   Candidate  │    │   Full List  │                 │
│   └──────────────┘    └──────────────┘    └──────────────┘                 │
│                                                  │                          │
│                                                  ▼                          │
│                                        ┌──────────────────┐                │
│                                        │ 8D: Multi-Crew   │                │
│                                        │   + Draft Mode   │                │
│                                        └──────────────────┘                │
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

## Phase 3: Users, Settings, Communication ✅ COMPLETE

### 3.1 User Authentication & Multi-user Support ✅

**Status:** Implemented — see `PROJECT_MULTIUSER.MD` for full details

**Implementation completed (4 phases):**

1. **DB migration + backend auth** ✅ — migration (`role`, `owner_id`), JWT (`argon2` + `jsonwebtoken`), auth handler (`register`, `login`, `verify`), rate limiting, `extract_auth` in all 15 handler files
2. **Frontend auth flow** ✅ — auth store (Zustand), Login/Register pages, protected routes with role guards, role-based nav
3. **Removed TEMP_USER_ID** ✅ — replaced hardcoded UUID in 22+ frontend files with `getToken()` from auth utility, updated all tests
4. **Worker management** ✅ — Customer creates Worker accounts in Settings "Pracovníci" tab

**Roles:** `admin` (system), `customer` (business owner), `worker` (employee)

**Key decisions:**
- JWT token stored in `localStorage` (NATS.ws has no HTTP headers)
- NATS CRUD subjects unchanged; `user_id` derived from JWT on backend via `extract_auth`
- In-memory rate limiting in auth handler (5 attempts / 5 min)
- No password reset / email confirmation in MVP

**Files created:**
- `worker/src/auth.rs` — JWT token generation/validation, password hashing (argon2), `extract_auth` helper ✅
- `worker/src/handlers/auth.rs` — register, login, verify + worker CRUD handlers ✅
- `worker/src/db/queries/user.rs` — user queries (get, get_by_email, create, list_workers, delete_worker) ✅
- `worker/src/types/user.rs` — User, UserPublic, AuthResponse types ✅
- `worker/migrations/002_add_auth_fields.sql` — role + owner_id columns ✅
- `packages/shared-types/src/auth.ts` — LoginRequest, RegisterRequest, UserPublic, AuthResponse ✅
- `apps/web/src/stores/authStore.ts` — Zustand auth state (login, register, logout, verify) ✅
- `apps/web/src/utils/auth.ts` — getToken, getUserId, hasRole helpers ✅
- `apps/web/src/pages/Login.tsx` + `Login.module.css` ✅
- `apps/web/src/pages/Register.tsx` ✅
- `apps/web/src/components/ProtectedRoute.tsx` — role-based route guard ✅
- `apps/web/src/services/workerService.ts` — worker CRUD frontend service ✅

**NATS subjects added:**
- `sazinka.auth.register` ✅
- `sazinka.auth.login` ✅
- `sazinka.auth.verify` ✅
- `sazinka.auth.worker.create` ✅
- `sazinka.auth.worker.list` ✅
- `sazinka.auth.worker.delete` ✅

**Before production (security checklist):**
- [ ] TLS everywhere (NATS + HTTPS)
- [ ] JWT secret in secure storage, min 256-bit, rotation plan
- [ ] Edge rate limiting (Cloudflare / Nginx / Traefik)
- [ ] Audit logs for auth and privileged actions
- [x] Admin-only endpoint hardening (all admin handlers check role) ✅
- [x] Password policy (min 8 chars, argon2 hash) ✅
- [ ] CORS restriction for NATS.ws origins
- [ ] DB backups + recovery testing
- [ ] Monitoring & alerting (auth failures, error rates)
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

#### 5A.1 Authentication & Authorization ✅ IMPLEMENTED

**Current state:** JWT-based auth with login/register/verify, role-based access control, TEMP_USER_ID removed

**Files created (see Phase 3.1 for full list):**
- `worker/src/auth.rs` — JWT + argon2 password hashing ✅
- `worker/src/handlers/auth.rs` — auth handlers + rate limiting ✅
- `apps/web/src/pages/Login.tsx` — Login form ✅
- `apps/web/src/pages/Register.tsx` — Registration form ✅
- `apps/web/src/stores/authStore.ts` — JWT storage in localStorage ✅

**Implemented features:**
| Feature | Status | Description |
|---------|--------|-------------|
| JWT login | ✅ | Email + password → JWT token (15 min expiry) |
| Registration | ✅ | Self-service customer registration |
| Token verification | ✅ | Verify stored token on page load |
| Password hashing | ✅ | argon2 |
| Rate limiting | ✅ | In-memory, 5 attempts / 5 min per email |
| Role-based access | ✅ | admin, customer, worker roles |
| Admin hardening | ✅ | All admin endpoints check role |
| Worker management | ✅ | Customer creates/deletes worker accounts |
| Session invalidation | ✅ | Logout clears localStorage token |

**Not in MVP (deferred):**
- JWT refresh token rotation
- Password reset (email-based)
- Email confirmation

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
- **Data deletion** - "Right to be forgotten" (partial implementation: customer anonymization flow for soft delete + PII anonymization in linked records)
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

## Phase 6: UX Workflow (Call Queue, Smart Scheduling) ✅ COMPLETE

> **Status:** All MVP phases complete (6A-6F)
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
│   │  ├─ Přiřazení posádky/technika                                      │  │
│   │  ├─ Délka úkonu (default z device type)                             │  │
│   │  └─ Uložení do Revision (scheduled_date, time_window)               │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 6C: Enhanced Day Planner (MVP)                                       │  │
│   │  ├─ Seznam zastávek s časovými okny                                 │  │
│   │  ├─ Varování konfliktů (červené/žluté)                              │  │
│   │  ├─ Crew tabs (multi-crew)                                           │  │
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
│   │  ├─ Valhalla matrix cache per den/posádka                           │  │
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
ALTER TABLE revisions ADD COLUMN assigned_crew_id UUID;
ALTER TABLE revisions ADD COLUMN route_order INTEGER;

CREATE TABLE crews (
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
- `sazinka.crew.create` - Create crew
- `sazinka.crew.list` - List crews
- `sazinka.crew.update` - Update crew
- `sazinka.crew.delete` - Delete crew

**Files to create:**
- [x] `worker/src/types/crew.rs` - NEW ✅
- [x] `worker/src/handlers/crew.rs` - NEW ✅
- [x] `worker/src/db/queries/crew.rs` - NEW ✅
- [x] `apps/web/src/services/crewService.ts` - NEW ✅
- [x] Schedule dialog inline in CallQueue.tsx ✅

---

### 6C: Enhanced Day Planner

**Enhancements to existing Planner:**
- ~~Crew tabs (select which crew's route to view/edit)~~ (pending)
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

### 6D: Technician View ✅ (MERGED INTO PLANNER)

**Status:** TechnicianDay functionality merged into unified Planner page (`/planner`)

**Files removed:**
- `apps/web/src/pages/TechnicianDay.tsx` - ❌ Deleted (merged into Planner)
- `apps/web/src/pages/TechnicianDay.module.css` - ❌ Deleted
- Route `/today` now redirects to `/planner`
- Navigation link "Můj den" removed, "Plánování" renamed to "Plán dne"

**Features now in Planner:**
- [x] Segmented Google Maps links (8 stops per segment) ✅
- [x] Print/PDF with addresses, phones, time windows ✅
- [x] Single-stop navigation buttons ✅
- [x] Mark as done action per stop ✅
- [x] Call customer action per stop ✅
- [x] Progress tracking (X/Y done) ✅

**Backend enhancements:**
- [x] `Revision` type extended with customer info fields ✅
- [x] `list_revisions` query joins customer table ✅

---

### 6E: Smart Slots (V2) ✅

**NATS subject:**
- [x] `sazinka.slots.suggest` - Get best slots for new appointment ✅

**Algorithm (insertion heuristic) - TDD implemented:**
1. [x] Load existing scheduled revisions for day ✅
2. [x] Try inserting at each position in route ✅
3. [x] Calculate delta travel time (Euclidean estimate) ✅
4. [x] Check feasibility (work hours) ✅
5. [x] Score: 60% delta time + 25% preferred time + 15% slack ✅
6. [x] Return top N slots sorted by score ✅

**Files created:**
- [x] `worker/src/services/slot_suggester.rs` - Algorithm with 8 unit tests ✅
- [x] `worker/src/handlers/slots.rs` - NATS handler ✅
- [x] `apps/web/src/services/slotService.ts` - Frontend service ✅
- [x] CallQueue.tsx - Smart slot suggestions in schedule modal ✅

---

### 6F: Workflow UI Integration (MVP) ✅

**Goal:** Connect isolated pages into a single end-to-end flow.

**Completed UI tasks:**
- [x] Dashboard CTA: "Fronta k obvolání" as primary entry ✅
- [x] Clickable stats on Dashboard → prefiltered Call Queue or Calendar ✅
- [x] Call Queue: after scheduling, jump to Planner on that date ✅
- [x] Call Queue: add links to Customer detail + Revision detail ✅
- [x] Calendar day panel: link each revision to Revision detail ✅
- [x] Planner: merged with TechnicianDay into unified "Plán dne" ✅
- [x] Planner: show customer + address + time window + actions ✅
- [x] Planner: call queue preview section ✅
- [x] RevisionDetail page created as workflow hub ✅

**New UI surfaces created:**
- [x] `RevisionDetail` page (`/revisions/:id`) - context hub for workflow actions ✅
- [x] Unified `Planner` page with TechnicianDay features ✅

**Files created/modified:**
- [x] `apps/web/src/pages/RevisionDetail.tsx` ✅
- [x] `apps/web/src/pages/RevisionDetail.module.css` ✅
- [x] `apps/web/src/pages/Planner.tsx` - merged with TechnicianDay ✅
- [x] `apps/web/src/components/planner/SortableStopItem.tsx` - added actions ✅
- [x] `apps/web/src/routes/index.tsx` - updated routing ✅
- [x] `apps/web/src/components/Layout.tsx` - updated navigation ✅

---

## Phase 7: JetStream External Services 📋 PLANNED

> **Status:** Planning - independent of Phase 5, high priority for scalability
> **Goal:** Serialize ALL external service communication through NATS JetStream

### Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                  PHASE 7: JetStream External Services                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 7A: Valhalla JetStream (Routing)                                     │  │
│   │  ├─ SAZINKA_ROUTING_MATRIX_JOBS - distance/time matrices            │  │
│   │  ├─ SAZINKA_ROUTING_GEOMETRY_JOBS - route polylines                 │  │
│   │  └─ Automatic retry on Valhalla timeout (max_deliver: 3)            │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 7B: Import/Export Jobs                                               │  │
│   │  ├─ SAZINKA_IMPORT_JOBS - async CSV imports (device, revision, etc) │  │
│   │  ├─ SAZINKA_EXPORT_JOBS - async CSV exports with progress           │  │
│   │  └─ Real-time progress updates via status subjects                  │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 7C: Email/SMS Jobs (Future)                                          │  │
│   │  ├─ SAZINKA_EMAIL_JOBS - revision reminders, notifications          │  │
│   │  ├─ SAZINKA_SMS_JOBS - SMS notifications                            │  │
│   │  └─ Prepared skeleton for Resend API / Twilio integration           │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 7D: Unified Jobs Dashboard                                           │  │
│   │  ├─ Admin UI for monitoring all active jobs                         │  │
│   │  ├─ Cancel/retry actions                                            │  │
│   │  └─ Queue statistics and health                                     │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Motivation

**Current state:**
- Nominatim - already uses JetStream (3 streams) ✅
- Valhalla - direct HTTP calls (synchronous) ❌
- Imports - synchronous request/response ❌
- Exports - synchronous CSV generation ❌

**Problems with synchronous approach:**
- No backpressure under load → external services overloaded
- No automatic retry on temporary failures
- Cannot horizontally scale workers
- Job loss on worker restart

---

### 7A: Valhalla JetStream (Routing)

**JetStream Streams:**

| Stream | Subject | Consumer | Purpose |
|--------|---------|----------|---------|
| `SAZINKA_ROUTING_MATRIX_JOBS` | `sazinka.jobs.valhalla.matrix` | `matrix_workers` | Distance/time matrices |
| `SAZINKA_ROUTING_GEOMETRY_JOBS` | `sazinka.jobs.valhalla.geometry` | `geometry_workers` | Route polylines |

**Stream Configuration:**
```rust
jetstream::stream::Config {
    name: "SAZINKA_ROUTING_MATRIX_JOBS",
    subjects: vec!["sazinka.jobs.valhalla.matrix"],
    max_messages: 1_000,
    max_bytes: 50 * 1024 * 1024, // 50 MB
    retention: RetentionPolicy::WorkQueue,
    max_deliver: 3, // Retry up to 3 times
}
```

**Files to create:**
- [ ] `worker/src/services/valhalla_processor.rs` - JetStream wrapper for Valhalla
- [ ] `worker/src/types/valhalla_job.rs` - Job types (MatrixJob, GeometryJob)

**Files to modify:**
- [ ] `worker/src/handlers/route.rs` - Use ValhallaProcessor instead of direct calls
- [ ] `worker/src/handlers/mod.rs` - Initialize new processor

**Status subjects:**
- `sazinka.job.valhalla.matrix.status.{job_id}` - Matrix job progress
- `sazinka.job.valhalla.geometry.status.{job_id}` - Geometry job progress

---

### 7B: Import/Export Jobs

**JetStream Streams:**

| Stream | Subject | Consumer | Purpose |
|--------|---------|----------|---------|
| `SAZINKA_IMPORT_JOBS` | `sazinka.jobs.import.*` | `import_workers` | All CSV imports |
| `SAZINKA_EXPORT_JOBS` | `sazinka.jobs.export.*` | `export_workers` | All CSV exports |

**Import job types:**
- `sazinka.jobs.import.device` - Device batch import
- `sazinka.jobs.import.revision` - Revision batch import
- `sazinka.jobs.import.communication` - Communication batch import
- `sazinka.jobs.import.visit` - Visit batch import
- `sazinka.jobs.import.customer` - Customer batch import (new)

**Export job types:**
- `sazinka.jobs.export.customers` - Customer CSV export
- `sazinka.jobs.export.revisions` - Revision CSV export
- `sazinka.jobs.export.report` - Report generation

**Files to create:**
- [ ] `worker/src/services/import_processor.rs` - Async import processor
- [ ] `worker/src/services/export_processor.rs` - Async export processor
- [ ] `worker/src/types/import_job.rs` - Import job types
- [ ] `worker/src/types/export_job.rs` - Export job types

**Files to modify:**
- [ ] `worker/src/handlers/import.rs` - Refactor to async pattern
- [ ] `apps/web/src/services/import/importBatchService.ts` - Use job status subscription

---

### 7C: Email/SMS Jobs (Future)

**JetStream Streams:**

| Stream | Subject | Consumer | Purpose |
|--------|---------|----------|---------|
| `SAZINKA_EMAIL_JOBS` | `sazinka.jobs.email.*` | `email_workers` | Outgoing emails |
| `SAZINKA_SMS_JOBS` | `sazinka.jobs.sms.*` | `sms_workers` | Outgoing SMS |

**Email job types:**
- `sazinka.jobs.email.reminder` - Revision reminder
- `sazinka.jobs.email.confirmation` - Appointment confirmation
- `sazinka.jobs.email.notification` - General notification

**SMS job types:**
- `sazinka.jobs.sms.reminder` - SMS reminder
- `sazinka.jobs.sms.confirmation` - SMS confirmation

**Files to create:**
- [ ] `worker/src/services/email_processor.rs` - Email job processor (Resend API)
- [ ] `worker/src/services/sms_processor.rs` - SMS job processor (Twilio)
- [ ] `worker/src/types/email_job.rs` - Email job types
- [ ] `worker/src/types/sms_job.rs` - SMS job types

---

### 7D: Unified Jobs Dashboard

**Admin UI for job monitoring:**

| Feature | Description |
|---------|-------------|
| Active jobs list | All jobs across all streams |
| Job details | Status, progress, errors |
| Cancel action | Terminate stuck jobs |
| Retry action | Re-queue failed jobs |
| Queue stats | Pending, processing, completed counts |

**NATS subjects:**
- `sazinka.admin.jobs.list` - List all active jobs
- `sazinka.admin.jobs.cancel` - Cancel a job
- `sazinka.admin.jobs.retry` - Retry a failed job
- `sazinka.admin.jobs.stats` - Queue statistics

**Files to create:**
- [ ] `apps/web/src/pages/JobsDashboard.tsx` - Jobs overview page
- [ ] `apps/web/src/components/jobs/JobStatusCard.tsx` - Job status card
- [ ] `apps/web/src/components/jobs/JobQueue.tsx` - Queue list component
- [ ] `apps/web/src/services/jobsAdminService.ts` - Admin service

---

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    JetStream External Services Architecture                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Frontend                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  UI Component                                                        │   │
│   │  ┌─────────────┐                                                    │   │
│   │  │ useJobStatus│ ◀──────── subscribe to status.{job_id}            │   │
│   │  └─────────────┘                                                    │   │
│   │        │                                                             │   │
│   │        │ submit job                                                  │   │
│   │        ▼                                                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│            │                                                                 │
│            │ NATS request                                                    │
│            ▼                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  NATS JetStream                                                      │   │
│   │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │   │
│   │  │ ROUTING_MATRIX   │  │ ROUTING_GEOMETRY │  │ GEOCODE_JOBS     │  │   │
│   │  │ _JOBS            │  │ _JOBS            │  │ (existing)       │  │   │
│   │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │   │
│   │           │                     │                     │            │   │
│   │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │   │
│   │  │ IMPORT_JOBS      │  │ EXPORT_JOBS      │  │ EMAIL/SMS_JOBS   │  │   │
│   │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │   │
│   │           │                     │                     │            │   │
│   └───────────┼─────────────────────┼─────────────────────┼────────────┘   │
│               │                     │                     │                 │
│               ▼                     ▼                     ▼                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Worker Pool (horizontally scalable)                                │   │
│   │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │   │
│   │  │ ValhallaProcessor│  │ ImportProcessor  │  │ EmailProcessor   │  │   │
│   │  │ GeocodeProcessor │  │ ExportProcessor  │  │ SMSProcessor     │  │   │
│   │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  │   │
│   │           │                     │                     │            │   │
│   └───────────┼─────────────────────┼─────────────────────┼────────────┘   │
│               │                     │                     │                 │
│               ▼                     ▼                     ▼                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  External Services                                                   │   │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │   │
│   │  │ Valhalla     │  │ Nominatim    │  │ Resend API / Twilio      │  │   │
│   │  │ :8002        │  │ :8080        │  │ (external)               │  │   │
│   │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Benefits

| Benefit | Description |
|---------|-------------|
| **Backpressure** | JetStream queue limits prevent external service overload |
| **Automatic retry** | Failed jobs retry up to 3 times with exponential backoff |
| **Persistence** | Jobs survive worker restart |
| **Horizontal scaling** | Multiple workers can process from the same queue |
| **Observability** | Real-time status updates, unified monitoring |
| **Consistency** | Same pattern for all external services |

---

## Phase 8: UX/UI Redesign (Route-Aware Planning) ✅ COMPLETED

> **Status:** Completed - all components integrated
> **Goal:** "Domluvit návštěvu" = jedna činnost: vložit zakázku do trasy s minimem Δkm/Δmin
> **Reference:** See `PROJECT_UX.MD` Phase 8 section for full wireframes and component catalog

### Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              PHASE 8: Route-Aware Planning Redesign                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Klíčová změna:                                                            │
│   "Domluvit termín" již není oddělené od plánování trasy.                   │
│   Je to JEDNA činnost: vložit zakázku do denní trasy s minimem Δkm/Δmin.   │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 8A: Nový Inbox Layout + Route Context                                │  │
│   │  ├─ RouteContextHeader komponenta (den/posádka/depo + metriky)      │  │
│   │  ├─ 3-panel layout (desktop), stack layout (mobil)                  │  │
│   │  ├─ Mapa s trasou dne                                               │  │
│   │  └─ Metriky kapacity (km, čas, load, slack)                         │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 8B: Route-Aware pro vybraného kandidáta                              │  │
│   │  ├─ Δkm/Δmin výpočet při výběru kandidáta                           │  │
│   │  ├─ SlotSuggestions komponenta s dopady                             │  │
│   │  ├─ InsertionPreview na mapě                                        │  │
│   │  └─ Valhalla 1×K + K×1 matrix strategie                             │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 8C: Route-Aware pro celý list                                        │  │
│   │  ├─ Lazy loading pro viditelné řádky                                │  │
│   │  ├─ Cache výsledků (klíč: den+posádka+kandidát+verze_trasy)         │  │
│   │  ├─ "Problémy" segment (nelze geo, chybí tel)                       │  │
│   │  └─ Pre-ranking dle vzdálenosti k trase                             │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 8D: Multi-Crew + Draft Mode + Polish                                 │  │
│   │  ├─ Tipy "Posádka 2 je lepší o 10 min"                               │  │
│   │  ├─ Draft mode pro plán dne                                         │  │
│   │  ├─ Optimistic UI                                                   │  │
│   │  └─ Klávesové zkratky pro dispečerku                                │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 8A: Nový Inbox Layout + Route Context

**Cíl:** Dispečerka vidí "plánování s mapou a kapacitou" od začátku.

**Komponenty k vytvoření:**

| Komponenta | Popis | Umístění |
|------------|-------|----------|
| `RouteContextHeader` | Sticky header: Den/Posádka/Depo + metriky | `components/planner/` |
| `SplitView` | 3-panel layout pro desktop | `components/common/` |
| `CapacityMetrics` | Zobrazení km/čas/load/slack | `components/planner/` |
| `RouteMapPanel` | Mapa s trasou dne | `components/planner/` |

**Files to create:**
- [ ] `apps/web/src/components/planner/RouteContextHeader.tsx`
- [ ] `apps/web/src/components/planner/RouteContextHeader.module.css`
- [ ] `apps/web/src/components/common/SplitView.tsx`
- [ ] `apps/web/src/components/planner/CapacityMetrics.tsx`
- [ ] `apps/web/src/pages/PlanningInbox.tsx` - New unified inbox page
- [ ] `apps/web/src/pages/PlanningInbox.module.css`

**Files to modify:**
- [ ] `apps/web/src/routes/index.tsx` - Add `/inbox` route
- [ ] `apps/web/src/components/Layout.tsx` - Update navigation

**Metriky v headeru:**
```
51 km • jízda 1h16 • servis 5h30 • vytížení 92% ⚠ • rezerva 18 min ⚠
```

**ASCII wireframe (desktop):**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Plánovací inbox  Den[St 5.3] Posádka[1] Depo[Brno]  Route-aware[ON]     │
│ 51 km • jízda 1h16 • vytížení 92%⚠ • rezerva 18m⚠                        │
│ [Po termínu(12)] [Týden(18)] [30 dní(43)] [Vše] [Odložené] [Problémy]   │
├───────────────┬───────────────────────────────────────────┬─────────────┤
│ INBOX LIST    │ MAPA + TRASA DNE                           │ DETAIL      │
│ (kandidáti)   │ (polyline + piny)                          │ (sloty+CTA) │
└───────────────┴───────────────────────────────────────────┴─────────────┘
```

---

### 8B: Route-Aware pro vybraného kandidáta

**Cíl:** Po kliknutí na kandidáta ukázat Δkm/Δmin a doporučené sloty.

**Komponenty k vytvoření:**

| Komponenta | Popis | Umístění |
|------------|-------|----------|
| `CandidateRow` | Řádek v inboxu s metrikami | `components/planner/` |
| `CandidateDetail` | Detail panel s akcemi | `components/planner/` |
| `SlotSuggestions` | 3-5 doporučených slotů | `components/planner/` |
| `InsertionPreview` | "Vloží se mezi 3→4" | `components/planner/` |

**Backend changes:**

| Endpoint | Popis |
|----------|-------|
| `sazinka.slots.suggest.route` | Rozšířit o Δkm/Δmin výpočet |
| `sazinka.route.insertion.preview` | Nový endpoint pro insertion preview |

**Matrix strategie (1×K + K×1):**
```rust
// Místo K×K matice, pouze:
// - t(Si, X) pro všechna Si (many-to-one)
// - t(X, Si) pro všechna Si (one-to-many)
// = 2K výpočtů místo K²
```

**Files to create:**
- [ ] `apps/web/src/components/planner/CandidateRow.tsx`
- [ ] `apps/web/src/components/planner/CandidateDetail.tsx`
- [ ] `apps/web/src/components/planner/SlotSuggestions.tsx`
- [ ] `apps/web/src/components/planner/InsertionPreview.tsx`
- [ ] `apps/web/src/services/insertionService.ts`

**Files to modify:**
- [ ] `worker/src/services/slot_suggester.rs` - Add Δkm/Δmin calculation
- [ ] `worker/src/handlers/slots.rs` - Return insertion metrics

---

### 8C: Route-Aware pro celý list

**Cíl:** Celý inbox seřazený dle "best insertion" s lazy loading.

**Strategie:**
1. **Levný pre-ranking** pro celý list (vzdálenost k trase)
2. **Přesný výpočet** jen pro viditelné řádky + prefetch
3. **Cache** výsledků s invalidací při změně trasy

**Komponenty k vytvoření:**

| Komponenta | Popis |
|------------|-------|
| `VirtualizedInboxList` | react-virtuoso pro 500+ řádků |
| `ProblemsSegment` | Kandidáti s problémy (geo, tel) |

**Cache implementace:**
```typescript
interface RouteCacheKey {
  date: string;
  crewId: string;
  candidateId: string;
  routeVersion: number;
}
```

**Files to create:**
- [ ] `apps/web/src/components/planner/VirtualizedInboxList.tsx`
- [ ] `apps/web/src/components/planner/ProblemsSegment.tsx`
- [ ] `apps/web/src/stores/routeCacheStore.ts`

**Files to modify:**
- [ ] `apps/web/src/pages/PlanningInbox.tsx` - Integrate virtualization
- [ ] `worker/src/db/queries/revision.rs` - Add pre-ranking query

---

### 8D: Multi-Crew + Draft Mode + Polish

**Cíl:** Finální polish pro GA release.

**Multi-crew tipy:**
```
Podmínky pro zobrazení:
- Rozdíl > 10 min NEBO > 5 km
- Jen pro vybraného kandidáta
- Max 2 alternativní posádky

UI: "Tip: Posádka 2 (+2 min)" - ne spam
```

**Draft mode pro plán dne:**
```
┌────────────────────────────────────────┐
│ ⚠ Neuložené změny                      │
│ [Zahodit změny]  [Uložit]              │
└────────────────────────────────────────┘
```

**Klávesové zkratky:**

| Zkratka | Akce |
|---------|------|
| `/` | Focus search |
| `↑↓` | Navigace v listu |
| `1-5` | Výběr slotu |
| `D` | Domluvit |
| `O` | Odložit |
| `E` | Opravit adresu |
| `Esc` | Zavřít panel |

**Files to create:**
- [ ] `apps/web/src/components/planner/MultiCrewTip.tsx`
- [ ] `apps/web/src/components/planner/DraftModeBar.tsx`
- [ ] `apps/web/src/hooks/useKeyboardShortcuts.ts`

**Files to modify:**
- [ ] `apps/web/src/pages/Planner.tsx` - Add draft mode
- [ ] `apps/web/src/pages/PlanningInbox.tsx` - Add keyboard shortcuts

---

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Route-Aware Planning Architecture                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Frontend                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  PlanningInbox                                                       │   │
│   │  ├─ RouteContextHeader (den/posádka/depo + metriky)                 │   │
│   │  ├─ VirtualizedInboxList (kandidáti s Δkm/Δmin)                     │   │
│   │  ├─ RouteMapPanel (polyline + piny + insertion preview)             │   │
│   │  └─ CandidateDetail (sloty + CTA)                                   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│            │                                                                 │
│            │ NATS                                                            │
│            ▼                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Worker                                                              │   │
│   │  ├─ SlotSuggester (Δkm/Δmin calculation)                            │   │
│   │  │   └─ 1×K + K×1 matrix strategy                                   │   │
│   │  ├─ InsertionPreview (route recalc)                                 │   │
│   │  └─ RouteCache (invalidation on change)                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│            │                                                                 │
│            ▼                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  Valhalla                                                            │   │
│   │  └─ sources_to_targets (1×K + K×1, ne K×K)                          │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Performance Targets

| Operace | Cílová latence | Poznámka |
|---------|----------------|----------|
| UI highlight kandidáta | ≤150ms | Jen UI, bez API |
| Slot suggestions | 400-700ms | Se skeleton loading |
| Full route recalc | ≤1200ms | Progressive loading |
| Pre-ranking (50 items) | ≤100ms | Lokální výpočet |

---

### Dependencies

| Knihovna | Účel | Status |
|----------|------|--------|
| `react-virtuoso` | Virtualizace seznamu | Installed |
| `@dnd-kit/core` | Drag & drop | Installed |
| `zustand` | State management | Installed |
| `date-fns` | Date utilities | Installed |

---

## Phase 9: Planner UI Redesign ✅ COMPLETED

> **Status:** Completed
> **Goal:** Přepis stránky `/planner` na přehled cest s filtrováním, detailní timeline a uživatelskými preferencemi

### Overview

Kompletní přepis Planner stránky z "Plán dne" (DnD, queue preview, inbox drawer) na "Přehled cest" s filtry, seznamem tras a detailní timeline.

### 9.1: DB migrace + Backend preferences ✅

- Migration `003_add_user_preferences.sql`: `default_crew_id` a `default_depot_id` do `users` tabulky
- Rozšíření `UserWithSettings` a `UserPreferences` typů
- Handler `sazinka.settings.preferences.update` pro ukládání preferencí
- Frontend: `updatePreferences()` v `settingsService.ts`

### 9.2: Backend route filtering ✅

- Nový SQL dotaz `list_routes` s filtry (`date_from`, `date_to`, `crew_id`, `depot_id`)
- Handler `sazinka.route.list` + registrace v `mod.rs`
- Frontend: `listRoutes()` v `routeService.ts`

### 9.3: Settings - Moje nastavení ✅

- Nová záložka "Moje nastavení" na Settings stránce
- `PreferencesForm` s výběrem defaultní posádky a depa
- Hodnoty se ukládají do DB a používají jako výchozí filtry v Planneru

### 9.4: Frontend komponenty ✅

- `RouteListPanel` — seznam tras s kartami (datum, posádka, zastávky, vzdálenost, čas)
- `RouteListPanel.test.tsx` — 7 testů
- `RouteDetailTimeline` — vertikální timeline: depo → segment → zastávka → ... → depo
- `RouteDetailTimeline.test.tsx` — 7 testů

### 9.5: Kompletní přepis Planner.tsx ✅

- Filtry: datum (s rozsahem), posádka, depo
- Uživatelské preference jako výchozí filtry
- `RouteListPanel` v horní části sidebaru
- `RouteDetailTimeline` v dolní části sidebaru
- Mapa s maplibre-gl (piny, segmenty, highlight)
- Kliknutí na zastávku/segment → fly-to na mapě
- Přepis `Planner.module.css` pro nový layout
- Žádné linter chyby, všechny nové testy procházejí

**Files created:**
- `worker/migrations/003_add_user_preferences.sql`
- `apps/web/src/components/planner/RouteListPanel.tsx`
- `apps/web/src/components/planner/RouteListPanel.module.css`
- `apps/web/src/components/planner/RouteListPanel.test.tsx`
- `apps/web/src/components/planner/RouteDetailTimeline.tsx`
- `apps/web/src/components/planner/RouteDetailTimeline.module.css`
- `apps/web/src/components/planner/RouteDetailTimeline.test.tsx`

**Files modified:**
- `apps/web/src/pages/Planner.tsx` — kompletní přepis
- `apps/web/src/pages/Planner.module.css` — nový layout
- `apps/web/src/pages/Settings.tsx` — "Moje nastavení" záložka
- `apps/web/src/pages/Settings.module.css` — styly pro preferences
- `apps/web/src/services/routeService.ts` — `listRoutes()`, `updatePreferences()`
- `apps/web/src/services/settingsService.ts` — `updatePreferences()`
- `apps/web/src/components/planner/index.ts` — export nových komponent
- `worker/src/types/settings.rs` — `UserWithSettings` rozšíření
- `worker/src/db/queries/settings.rs` — preference queries
- `worker/src/db/queries/route.rs` — `list_routes` query
- `worker/src/handlers/settings.rs` — `handle_update_preferences`
- `worker/src/handlers/route.rs` — `handle_list`
- `worker/src/handlers/mod.rs` — registrace nových subscriptions
- `packages/shared-types/src/settings.ts` — `UserPreferences` typ

---

## Post-Phase 9: Unified Route Components + VRP Robustness ✅ COMPLETED

> **Status:** Completed (2026-02-09)
> **Goal:** Sjednocení komponent pro zobrazení trasy (Inbox + Planner) a oprava zaseknuté optimalizace

### Frontend: Unified Route Components ✅

- `RouteDetailTimeline` — sdílená vertikální timeline pro Inbox i Planner
  - Props pro editing (onRemoveStop, onOptimize, onDeleteRoute) volitelné
  - Status badges (Potvrzeno/Nepotvrzeno), dohodnuté vs. vypočítané časy, warning ikony
  - Segmenty mezi zastávkami (km, min)
  - Bidirectional highlight s mapou (highlightedSegment, onStopClick, onSegmentClick)
- `RouteMapPanel` — sdílená mapa pro Inbox i Planner
  - Vstupní typ sjednocen na `SavedRouteStop[]` (odstraněn `MapStop`)
  - Inbox-only props: `selectedCandidate`, `insertionPreview`
  - Fix: MapLibre "Style is not done loading" — map init `useEffect` dependency changed to `[]`
  - Fix: `continue` → `return` in `forEach` callback
- `RouteStopList` — ODSTRANĚN (nahrazen `RouteDetailTimeline`)
- `Planner.tsx` — inline MapLibre kód (~250 řádků) nahrazen `<RouteMapPanel />`
- `PlanningInbox.tsx` — `insertionPreview` prop nyní správně předáván do `RouteMapPanel`
- **Inbox/Planner parity hardening (post-unification):**
  - `RouteDetailTimeline` akce sjednoceny na obou stránkách: `Optimalizovat`, `Přidat pauzu`, `Smazat trasu`
  - Segmenty v timeline zobrazují konzistentně `čas od–do`, `km`, `trvání`
  - Metriky planneru pro uložené trasy sjednoceny s Inboxem použitím persisted route totals
  - Informační blok doplněn o sekundární údaj `z toho jízda`

### Backend: VRP Solver Timeout ✅

- `VrpSolver::solve()` je nyní `async`
  - CPU-bound `solve_pragmatic` zabalena do `tokio::task::spawn_blocking`
  - Hard timeout: `tokio::time::timeout(config.max_time_seconds + 10s)`
  - Fallback na nearest-neighbor heuristiku při timeout/panic/error
  - `SOLVER_FALLBACK` warning přidán do solution při fallbacku
- `VrpProblem`, `DistanceTimeMatrices`, `SolverConfig` implementují `Clone`
- `PlannedRouteStop` má pole `stop_index`
- Časová okna z revizí (`scheduled_time_start`/`scheduled_time_end`) se nyní správně předávají do VRP solveru
- Duplicitní `tokio::time::timeout` wrapper odstraněn z `handlers/route.rs`
- Opraven formát break payloadu pro `vrp-pragmatic` (`required break`: `time + duration`), odstraněn parser fail `VehicleBreak` a nechtěný fallback na heuristiku v běžném scénáři s pauzou

**Files modified:**
- `apps/web/src/components/planner/RouteDetailTimeline.tsx` + `.module.css`
- `apps/web/src/components/planner/RouteMapPanel.tsx`
- `apps/web/src/components/planner/index.ts`
- `apps/web/src/pages/PlanningInbox.tsx`
- `apps/web/src/pages/Planner.tsx`
- `worker/src/services/vrp/mod.rs`
- `worker/src/handlers/route.rs`
- `worker/src/handlers/jobs.rs`

**Files deleted:**
- `apps/web/src/components/planner/RouteStopList.tsx`
- `apps/web/src/components/planner/RouteStopList.module.css`

---

## Post-Phase 9b: VRP Time Window Mapping + Timeline Rendering Fix ✅ COMPLETED

> **Status:** Completed (2026-02-10)
> **Goal:** Opravit mapování časových oken pro VRP solver a UI rendering bug v RouteDetailTimeline

### Backend: VRP Point Time Window Mapping ✅

- Zákaznická návštěva `scheduled_time_start`/`scheduled_time_end` se nyní mapuje jako **pracovní slot**, nikoliv rozsah příjezdu
- VRP solver dostává **bodové časové okno** `[start, start]` — posádka musí přijet přesně na začátek slotu
- `service_duration_minutes` se počítá jako `end - start` (skutečná délka slotu), ne fixní default
- `apply_arrival_buffer` přeskakuje bodová okna (`start == end`), aby nedošlo k nežádoucímu posunu
- Solver odjíždí z depa co nejpozději, přijíždí ke každému zákazníku na začátek jeho slotu
- Přidány unit testy:
  - `build_pragmatic_problem_with_point_time_window_is_valid`
  - `apply_arrival_buffer_noop_for_point_window`
  - `solve_pragmatic_with_point_time_window_assigns_stop`

### Frontend: RouteDetailTimeline Rendering Fix ✅

- Opravena React "falsy zero" chyba v `RouteDetailTimeline.tsx`
- Výraz `(timeDiffStart && timeDiffStart > 15)` vracel číslo `0` místo `false`, když `timeDiffStart === 0`
- React vykresloval `0` jako text vedle "Dohodnuto" časů (černý ovál s nulou)
- Fix: nahrazeno `timeDiffStart != null && timeDiffStart > 15` pro explicitní boolean kontrolu

**Files modified:**
- `worker/src/handlers/route.rs` — VRP point time window mapping
- `worker/src/handlers/jobs.rs` — VRP point time window mapping
- `worker/src/services/vrp/adapter.rs` — `apply_arrival_buffer` skip for point windows + tests
- `worker/src/services/vrp/pragmatic.rs` — solver integration test
- `apps/web/src/components/planner/RouteDetailTimeline.tsx` — falsy zero rendering fix

---

## Post-Phase 9c: VRP Automatic Break Restoration ✅ COMPLETED

> **Status:** Completed (2026-02-10)
> **Goal:** Obnovit automatické vkládání pauz do optimalizovaných tras

### Bug 1: Break stops dropped in jobs handler ✅

- `worker/src/handlers/jobs.rs` při zpracování řešení od VRP solveru ignoroval break zastávky
- Loop `for stop in &solution.stops` měl jen `if let Some(customer) = ...` větev
- Break stop s `customer_id.is_nil()` nebyl matchován a tiše se zahodil
- **Fix:** Přidána `else if stop.customer_id.is_nil()` větev pro break zastávky (analogie s `route.rs`)

### Bug 2: Break activity timing from stop-level schedule ✅

- `pragmatic.rs::map_solution` používal stop-level `schedule.arrival`/`departure` pro break aktivity
- Pokud break sdílel stop s jiným jobem, přiřadil se čas příjezdu na lokaci, ne čas samotné pauzy
- Příklad: vozidlo přijelo v 09:15, break měl být 11:30–12:15, ale v DB se uložilo 09:15
- **Fix:** Break nyní používá `activity.time` (Interval s `start`/`end`) pro přesné časování

### Test: Solver verifikace ✅

- `solve_pragmatic_with_break_config_includes_break_stop` — ověřuje, že solver vrací break zastávku (nil UUID) a break padne do konfigurovaného okna (11:30–13:00)

**Files modified:**
- `worker/src/handlers/jobs.rs` — break stop handling
- `worker/src/services/vrp/pragmatic.rs` — activity-level break timing + test

---

## Phase 10: Záznam práce (v2+) - Backlog

> **Status:** Planned backlog (post-v1)
> **Goal:** Rozšířit stránku `Záznam práce` z rychlého denního logu na plnohodnotný podklad pro vykazování a fakturaci, bez zpomalení terénního flow.

### UX + Filtrace

- Pokročilé filtry (`stav`, `typ návštěvy`, fulltext zákazník/adresa/poznámka)
- Alternativní pohledy: kalendář/timeline, agregace podle zákazníka
- Uložitelné pohledy a rychlé přepínání "Dnes / Tento týden / Vše otevřené"

### Záznam práce + Produktivita

- Šablony textů "Co se dělalo" a doporučené předvyplnění podle poslední návštěvy
- Hromadné akce (dokončit, změna stavu, přiřazení posádky)
- Připomínky na konci dne pro návštěvy bez záznamu

### Mobilní terénní režim

- Offline-first zápis s frontou na synchronizaci po připojení
- Mobilní quick actions (swipe dokončit/duplikovat) a diktování
- Lepší práce s fotkami v terénu (Před/Po/Detail)

### Reporting + Export

- Souhrny práce za období (čas, počet zásahů, úspěšnost)
- Export záznamů práce (CSV/XLSX/PDF) pro zákazníka, posádku a depo
- Přímé napojení na podklady pro fakturaci (čas + materiál + doprava)

### Rozšíření doménového modelu (po V1)

- Materiálové položky na návštěvu (`název`, `množství`, `jednotka`, později cena/DPH)
- Strukturované časové vykazování (`start/stop`, ruční délka, audit změn)
- Potvrzení zákazníka/podpis a sdílená rekapitulace po dokončení

---

## Out of Scope for v1.0

Explicitly excluded:
- Mobile app
- Multi-tenant/team features (multiple users per account)
- Invoice generation
- Document attachments
- Incoming email processing
- Advanced reporting/analytics
- ~~Multi-region support~~ → Internationalization (i18n) is now **in scope** — see `PRJ_I18N.MD`
- RTL languages (Arabic, Hebrew)
- Currency conversion
- Per-tenant locale overrides

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
  3.1 Authentication (JWT + roles + worker mgmt) ✅
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

Phase 5 (Production Readiness): 🔄 IN PROGRESS
  5A: Pre-Launch (MUST HAVE) 🔄
    5A.1 JWT Authentication ✅
    5A.2 TLS on WebSocket
    5A.3 Rate limiting
    5A.4 Health checks
    5A.5 Managed PostgreSQL
    5A.6 Error tracking (Sentry)
    5A.7 Lazy loading of UI pages
  
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

Phase 6 (UX Workflow): ✅ COMPLETE
  6A: Call Queue (MVP) ✅
    6A.1 DB migration (snooze_until, snooze_reason) ✅
    6A.2 revision.queue endpoint (TDD) ✅
    6A.3 revision.snooze endpoint (TDD) ✅
    6A.4 CallQueue page UI ✅
  
  6B: Schedule Dialog (MVP) ✅
    6B.1 DB migration (crews table, assigned_crew_id) ✅
    6B.2 Crew CRUD handlers (TDD) ✅
    6B.3 ScheduleRevisionDialog component ✅
  
  6C: Enhanced Day Planner (MVP) ✅
    6C.1 View tabs: Doporučené/Naplánované ✅
    6C.2 Time window display ✅
    6C.3 Scheduled revisions view ✅
  
  6D: Technician View (MVP) ✅ → MERGED INTO PLANNER
    6D.1 Merged into unified Planner page ✅
    6D.2 Google Maps export (segmented) ✅
    6D.3 PDF/Print export ✅
  
  6E: Smart Slots (V2) ✅
    6E.1 Insertion heuristic algorithm ✅
    6E.2 Euclidean distance estimation ✅
    6E.3 slots.suggest endpoint ✅
    6E.4 UI integration ✅
    
  6F: Workflow UI Integration (MVP) ✅
    6F.1 Dashboard → Call Queue entry + clickable stats ✅
    6F.2 Call Queue → Planner on scheduled date ✅
    6F.3 Calendar → Revision detail links ✅
    6F.4 Planner + TechnicianDay → unified "Plán dne" ✅
    6F.5 RevisionDetail page (workflow hub) ✅
    6F.6 Call queue preview in Planner ✅

Phase 7 (JetStream External Services): ✅ COMPLETE
  7A: Valhalla JetStream (Routing) ✅
    7A.1 ValhallaProcessor skeleton + stream setup ✅
    7A.2 Matrix job submit/process ✅
    7A.3 Geometry job submit/process ✅
    7A.4 Integration with handlers/mod.rs ✅
  
  7B: Import/Export Jobs ✅
    7B.1 ImportProcessor skeleton ✅
    7B.2 Import job types for device/revision/communication/visit ✅
    7B.3 ExportProcessor skeleton ✅
    7B.4 Export job types with progress tracking ✅
  
  7C: Email/SMS Jobs (Skeleton) ✅
    7C.1 EmailProcessor skeleton (Resend API ready) ✅
    7C.2 SMSProcessor skeleton (Twilio ready) ✅
    7C.3 notification_job.rs types ✅
  
  7D: Unified Jobs Dashboard ✅
    7D.1 Jobs.tsx page with real-time updates ✅
    7D.2 JobStatusTimeline component ✅
    7D.3 Admin actions (cancel, retry) handlers ✅
    7D.4 Jobs route + navigation link ✅
    7D.5 Export download action in history (`Stáhnout export`) ✅

Phase 8 (UX/UI Redesign - Route-Aware Planning): ✅ COMPLETED
  8A: Nový Inbox Layout + Route Context ✅
    8A.1 RouteContextHeader komponenta ✅
    8A.2 SplitView 3-panel layout (desktop) ✅
    8A.3 CapacityMetrics komponenta ✅
    8A.4 RouteMapPanel s trasou dne ✅
    8A.5 PlanningInbox page s integrací ✅
  
  8B: Route-Aware pro vybraného kandidáta ✅
    8B.1 CandidateRow s Δkm/Δmin ✅
    8B.2 CandidateDetail panel ✅
    8B.3 SlotSuggestions s dopady ✅
    8B.4 InsertionPreview na mapě ✅
    8B.5 Backend: 1×K + K×1 matrix strategie ✅
  
  8C: Route-Aware pro celý list ✅
    8C.1 VirtualizedInboxList (react-virtuoso) ✅
    8C.2 ProblemsSegment (nelze geo, chybí tel) ✅
    8C.3 routeCacheStore pro cache výsledků ✅
    8C.4 Pre-ranking query v backendu (client-side) ✅
  
  8D: Multi-Crew + Draft Mode + Polish ✅
    8D.1 MultiCrewTip komponenta ✅
    8D.2 DraftModeBar pro plán dne ✅
    8D.3 useKeyboardShortcuts hook ✅
    8D.4 Optimistic UI pro domluvení ✅

Phase 9 (Planner UI Redesign): ✅ COMPLETED
  9.1 DB migrace + Backend preferences ✅
    9.1.1 Migration 003_add_user_preferences.sql ✅
    9.1.2 UserWithSettings rozšíření ✅
    9.1.3 sazinka.settings.preferences.update handler ✅
  
  9.2 Backend route filtering ✅
    9.2.1 list_routes SQL query s filtry ✅
    9.2.2 sazinka.route.list handler ✅
    9.2.3 Frontend listRoutes() + updatePreferences() ✅
  
  9.3 Settings - Moje nastavení ✅
    9.3.1 PreferencesForm na Settings stránce ✅
  
  9.4 Frontend komponenty ✅
    9.4.1 RouteListPanel + testy ✅
    9.4.2 RouteDetailTimeline + testy ✅
  
  9.5 Kompletní přepis Planner.tsx ✅
    9.5.1 Filtry (datum, posádka, depo) ✅
    9.5.2 RouteListPanel + RouteDetailTimeline integrace ✅
    9.5.3 Mapa s highlight ✅
    9.5.4 Přepis Planner.module.css ✅

Post-Phase 9 (Unified Components + VRP Fix): ✅ COMPLETED
  Frontend: Unified Route Components ✅
    - RouteDetailTimeline sdílená mezi Inbox a Planner ✅
    - RouteMapPanel sdílená mezi Inbox a Planner ✅
    - RouteStopList odstraněn ✅
    - insertionPreview prop opraven v PlanningInbox ✅
    - MapLibre "Style is not done loading" fix ✅
    - Bidirectional highlight (timeline ↔ map) ✅
  
  Backend: VRP Solver Robustness ✅
    - solver.solve() async + spawn_blocking + timeout ✅
    - Nearest-neighbor heuristic fallback ✅
    - Time windows from revisions to VRP solver ✅
    - Redundant timeout wrapper removed from route.rs ✅

Phase 10: Smart Slot Heuristics (v0.19.0): ✅ COMPLETED
  Backend: Multi-Crew Slot Suggestion ✅
    - Shared insertion logic extracted to services/insertion.rs ✅
    - calculate_insertion_positions() shared by route + slots ✅
    - sazinka.slots.suggest.v2 handler (multi-crew, Valhalla) ✅
    - Scoring function (travel 40% + fit 25% + preference 20% + balance 15%) ✅
    - Real customer coordinates from DB (not fake UUID-based) ✅
    - Per-crew depot resolution ✅
    - Scheduled revisions without route included in day stops ✅
  Backend: Slot Validation ✅
    - sazinka.slots.validate endpoint ✅
    - Overlap detection (error) ✅
    - Unreachable time check (error) ✅
    - Outside working hours check (error) ✅
    - No slack warning (<15min) ✅
    - Overloaded day warning (>90%) ✅
    - Break conflict warning ✅
  Backend: Tests ✅
    - 10 insertion logic unit tests ✅
    - 11 scoring + validation function tests ✅
  Frontend: CallQueue UI ✅
    - slotService.ts v2 types + suggestSlotsV2() + validateSlot() ✅
    - Crew selector in schedule modal ✅
    - Slots grouped by crew with load indicator ✅
    - Status badges (OK / Tight / Conflict) ✅
    - Real-time validation on manual time input (debounced 500ms) ✅
    - Warning confirmation before scheduling conflicting slots ✅
    - groupSuggestionsByCrew() + getStatusColor() utilities ✅

Phase 10.5: CI/CD Quality Improvements: 🔲 PLANNED
  → Tracked in PRJ_DEVOPS.MD section 24.15
  → Goal: Remove all temporary suppressions and reach clean CI

  10.5.1 Clippy Cleanup (priority order):
    - items_after_test_module — move `mod tests` to bottom of file (slots.rs, geocoding.rs)
    - unnecessary_unwrap / manual_unwrap_or_default — simple refactors (import.rs, import_processors.rs)
    - if_same_then_else — simplify duplicate branches (sequential_schedule.rs)
    - manual_div_ceil — use .div_ceil() (insertion.rs, slot_suggester.rs)
    - manual_clamp — use .clamp() (slot_suggester.rs)
    - manual_strip — use .strip_prefix() (import.rs, import_processors.rs)
    - derivable_impls — add #[derive(Default)] + #[default] (customer.rs, job.rs)
    - unnecessary_cast / cast_abs_to_unsigned — trivial fixes (vrp/adapter.rs, vrp/mod.rs)
    - extend_with_drain — use .append() (vrp/mod.rs)
    - dead_code — remove or gate behind #[cfg(test)] (email_sender.rs, rate_limiter.rs, etc.)
    - too_many_arguments — introduce param structs (biggest refactor, do last)
    - type_complexity — introduce type aliases for complex tuples (geocode.rs)

  10.5.2 Lighthouse Fixes (priority order):
    - color-contrast — update CSS for text/background pairs on / and /contact pages
    - errors-in-console — investigate and fix JS/SSR errors on all pages
    - unused-javascript — tree-shake or lazy-load contact form bundle
    - render-blocking resources — defer non-critical CSS/JS
    - cache headers — configure long-lived cache for static assets in Cloudflare Pages
    - After fixes: remove `continue-on-error: true` from site.yml Lighthouse step

Phase 11: Internationalization (i18n): 🔲 PLANNED
  → Full design: PRJ_I18N.MD
  → TDD approach: Red → Green → Refactor for every step
  → Estimated ~685 translation keys, ~12 days
  
  11.0 Infrastructure (i18n lib, formatters, DB migration, key parity script)
  11.1 Auth pages (Login, Register — first thing users see)
  11.2 Shell (Navigation, Layout, ErrorBoundary, common components)
  11.3 Core pages (Dashboard, Calendar, Customers, CustomerDetail)
  11.4 Planning (PlanningInbox, Planner, CandidateDetail, RouteDetailTimeline)
  11.5 Secondary pages (Settings, Jobs, Routes, WorkLog, Import/Export)
  11.6 Stores, services, utilities (Zustand stores, service functions)
  11.7 Shared types (label records → key maps, import aliases)
  11.8 Backend key migration (Rust NATS messages → { key, params } shape)
  11.9 Final verification & cleanup (key parity, dead code, visual check)
```
