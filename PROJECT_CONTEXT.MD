# Project Context

> **Last Updated:** 2026-01-26 (v0.3.0)

## Overview

**Sazinka** is a CRM and route planning application for tradespeople (plumbers, chimney sweeps, HVAC technicians) who perform regular annual inspections of their customers' equipment. The application combines customer relationship management with intelligent route optimization.

**Repository:** https://github.com/Oslicek/Sazinka

**Core Value Proposition:**
1. **CRM** - Track customers, devices, and revision schedules
2. **Reminders** - Automatically notify when revisions are due, send customer emails
3. **Route Optimization** - Plan efficient daily routes considering time windows

**Target Scale:** 1,000 tradespeople, each with ~500 customers, performing ~8 inspections/day

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | | |
| Framework | React 19 | User interface |
| Language | TypeScript (strict mode) | Type-safe development |
| Build Tool | Vite 6 | Fast development, HMR |
| Styling | CSS Modules | Scoped styles |
| State Management | Zustand | Global state |
| Server State | TanStack Query | Async state management |
| Routing | TanStack Router | Type-safe routing |
| Maps | MapLibre GL JS | Map rendering |
| Map Data | OpenStreetMap | Map tiles (public servers for MVP) |
| **Backend** | | |
| Language | Rust | Performance, safety |
| Async Runtime | Tokio | Async I/O |
| Message Broker | NATS | Frontend ↔ Worker communication |
| Database | PostgreSQL | Data persistence |
| ORM | SQLx | Compile-time checked queries |
| Geocoding | Nominatim API | Address → coordinates (public API for MVP) |
| **Infrastructure** | | |
| Frontend Hosting | Cloudflare Pages | Static site hosting |
| Backend Hosting | VPS (Hetzner) | NATS + Rust worker |
| File Storage | Cloudflare R2 | Map tiles, attachments |
| CI/CD | GitHub Actions | Automated testing and deployment |

## Architecture

**Pattern:** Message-Driven Application with NATS

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Cloudflare Edge                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ Cloudflare Pages (Static)                                             │  │
│   │ ├─ React 19 + TypeScript                                              │  │
│   │ ├─ MapLibre GL JS                                                     │  │
│   │ └─ NATS WebSocket client                                              │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ Cloudflare R2                                                         │  │
│   │ └─ Map tiles, file attachments (future)                               │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (:8222)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         VPS (Hetzner)                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────┐         ┌──────────────────────────────────────┐    │
│   │ NATS Server      │◀───────▶│ Rust Worker                          │    │
│   │ :4222 (native)   │         │                                      │    │
│   │ :8222 (websocket)│         │ ├─ Auth Handler                      │    │
│   └──────────────────┘         │ ├─ Customer Handler                  │    │
│                                 │ ├─ Device Handler                    │    │
│                                 │ ├─ Revision Handler                  │    │
│                                 │ ├─ Route Handler (VRPTW solver)      │    │
│                                 │ └─ Email Handler (future)            │    │
│                                 └──────────────────────────────────────┘    │
│                                           │                                  │
│                                           ▼                                  │
│                                 ┌──────────────────┐                        │
│                                 │ PostgreSQL       │                        │
│                                 │ (local or Neon)  │                        │
│                                 └──────────────────┘                        │
│                                                                              │
│   ┌──────────────────┐         ┌──────────────────┐                        │
│   │ OSRM (future)    │         │ Nominatim        │                        │
│   │ Routing engine   │         │ (future, self-   │                        │
│   │                  │         │  hosted)         │                        │
│   └──────────────────┘         └──────────────────┘                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Message Flow

```
Frontend                    NATS                    Rust Worker
   │                         │                           │
   │  sazinka.customer.list  │                           │
   │─────────────────────────▶                           │
   │                         │ sazinka.customer.list     │
   │                         │──────────────────────────▶│
   │                         │                           │ Query PostgreSQL
   │                         │  (reply)                  │
   │◀────────────────────────│◀──────────────────────────│
   │                         │                           │
```

## NATS Subjects

```
# Authentication
sazinka.auth.login              # Login request → JWT token
sazinka.auth.logout             # Logout / invalidate
sazinka.auth.verify             # Verify JWT token

# Customers
sazinka.customer.create         # Create new customer
sazinka.customer.update         # Update customer
sazinka.customer.delete         # Delete customer
sazinka.customer.get            # Get single customer by ID
sazinka.customer.list           # List customers (with filters)
sazinka.customer.geocode        # Geocode customer address

# Devices
sazinka.device.create           # Add device to customer
sazinka.device.update           # Update device
sazinka.device.delete           # Delete device
sazinka.device.list             # List devices for customer

# Revisions
sazinka.revision.create         # Schedule revision
sazinka.revision.update         # Update revision
sazinka.revision.complete       # Mark as completed
sazinka.revision.list           # List revisions (with filters)
sazinka.revision.upcoming       # Get upcoming revisions for calendar

# Routes
sazinka.route.plan              # Request route optimization
sazinka.route.save              # Save planned route
sazinka.route.update            # Update route (reorder, status)
sazinka.route.list              # List routes for date range

# Email (future)
sazinka.email.send              # Send email immediately
sazinka.email.schedule          # Schedule reminder email
```

## Project Structure

```
sazinka/
├── apps/
│   └── web/                        # React frontend
│       ├── public/
│       ├── src/
│       │   ├── components/
│       │   │   ├── map/            # MapLibre components
│       │   │   ├── calendar/       # Calendar components
│       │   │   ├── customers/      # Customer list/detail
│       │   │   ├── routes/         # Route planner
│       │   │   └── ui/             # Generic UI components
│       │   ├── hooks/
│       │   │   ├── useNats.ts      # NATS connection hook
│       │   │   └── ...
│       │   ├── stores/
│       │   │   ├── authStore.ts
│       │   │   ├── natsStore.ts
│       │   │   └── uiStore.ts
│       │   ├── services/
│       │   │   ├── nats.ts         # NATS WebSocket client
│       │   │   └── nominatim.ts    # Geocoding service
│       │   ├── routes/             # TanStack Router pages
│       │   │   ├── index.tsx       # Dashboard
│       │   │   ├── customers.tsx
│       │   │   ├── calendar.tsx
│       │   │   └── planner.tsx     # Route planner
│       │   ├── lib/
│       │   │   └── geo.ts          # Geo utilities
│       │   └── types/
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
│
├── worker/                         # Rust backend
│   ├── src/
│   │   ├── main.rs                 # Entry point
│   │   ├── config.rs               # Configuration
│   │   ├── handlers/
│   │   │   ├── mod.rs
│   │   │   ├── auth.rs
│   │   │   ├── customer.rs
│   │   │   ├── device.rs
│   │   │   ├── revision.rs
│   │   │   └── route.rs
│   │   ├── services/
│   │   │   ├── mod.rs
│   │   │   ├── vrptw.rs            # Route optimization
│   │   │   ├── geo.rs              # Haversine, distance matrix
│   │   │   └── nominatim.rs        # Geocoding client
│   │   ├── db/
│   │   │   ├── mod.rs
│   │   │   └── queries/            # SQL queries
│   │   └── types/
│   │       ├── mod.rs
│   │       ├── customer.rs
│   │       ├── device.rs
│   │       ├── revision.rs
│   │       └── route.rs
│   ├── migrations/                 # SQLx migrations
│   ├── Cargo.toml
│   └── Cargo.lock
│
├── packages/
│   └── shared-types/               # Shared TypeScript types
│       ├── src/
│       │   ├── customer.ts
│       │   ├── device.ts
│       │   ├── revision.ts
│       │   ├── route.ts
│       │   ├── messages.ts         # NATS message types
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── infra/
│   ├── docker-compose.yml          # Local dev (NATS + PostgreSQL)
│   ├── nats-server.conf            # NATS configuration
│   └── scripts/
│       ├── dev.ps1                 # Start all services
│       └── seed-db.ps1             # Seed sample data
│
├── data/
│   └── sample/                     # Sample data for development
│       ├── customers.json
│       ├── devices.json
│       └── revisions.json
│
├── package.json                    # Workspace root
├── pnpm-workspace.yaml
├── turbo.json                      # Turborepo config
├── PROJECT_CONTEXT.MD
└── PROJECT_RULES.MD
```

## Data Models

### User (Tradesperson)

```rust
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub name: String,
    pub phone: Option<String>,
    pub business_name: Option<String>,
    pub business_address: Address,
    pub settings: UserSettings,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct UserSettings {
    pub default_revision_interval_months: i32,  // Default: 12
    pub reminder_days_before: Vec<i32>,         // [30, 14, 7]
    pub working_hours_start: NaiveTime,         // 08:00
    pub working_hours_end: NaiveTime,           // 17:00
    pub max_revisions_per_day: i32,             // 12
}
```

### Customer

```rust
pub struct Customer {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address: Address,
    pub coordinates: Option<Coordinates>,
    pub notes: Option<String>,
    pub preferred_time_windows: Vec<TimeWindowPreference>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct Address {
    pub street: String,
    pub city: String,
    pub postal_code: String,
    pub country: String,  // Default: "CZ"
}

pub struct Coordinates {
    pub lat: f64,
    pub lng: f64,
}
```

### Device

```rust
pub struct Device {
    pub id: Uuid,
    pub customer_id: Uuid,
    pub device_type: DeviceType,
    pub manufacturer: Option<String>,
    pub model: Option<String>,
    pub serial_number: Option<String>,
    pub installation_date: Option<NaiveDate>,
    pub revision_interval_months: i32,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub enum DeviceType {
    GasBoiler,
    GasWaterHeater,
    Chimney,
    Fireplace,
    GasStove,
    Other,
}
```

### Revision

```rust
pub struct Revision {
    pub id: Uuid,
    pub device_id: Uuid,
    pub customer_id: Uuid,
    pub user_id: Uuid,
    pub status: RevisionStatus,
    pub due_date: NaiveDate,
    pub scheduled_date: Option<NaiveDate>,
    pub scheduled_time_window: Option<TimeWindow>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
    pub result: Option<RevisionResult>,
    pub findings: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub enum RevisionStatus {
    Upcoming,
    DueSoon,
    Overdue,
    Scheduled,
    Confirmed,
    Completed,
    Cancelled,
}

pub enum RevisionResult {
    Passed,
    Failed,
    Conditional,
}
```

### Route

```rust
pub struct Route {
    pub id: Uuid,
    pub user_id: Uuid,
    pub date: NaiveDate,
    pub status: RouteStatus,
    pub stops: Vec<RouteStop>,
    pub total_distance_km: Option<f64>,
    pub total_duration_minutes: Option<i32>,
    pub optimization_score: Option<i32>,  // 0-100
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct RouteStop {
    pub order: i32,
    pub revision_id: Uuid,
    pub customer_id: Uuid,
    pub estimated_arrival: NaiveTime,
    pub estimated_departure: NaiveTime,
    pub time_window: TimeWindow,
    pub distance_from_previous_km: Option<f64>,
    pub duration_from_previous_minutes: Option<i32>,
    pub status: StopStatus,
    pub actual_arrival: Option<DateTime<Utc>>,
    pub actual_departure: Option<DateTime<Utc>>,
}
```

## Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Frontend** | | |
| `NatsService` | apps/web/src/services/nats.ts | NATS WebSocket connection |
| `useNatsStore` | apps/web/src/stores/natsStore.ts | Connection state |
| `MapView` | apps/web/src/components/map/ | MapLibre map rendering |
| `RoutePlanner` | apps/web/src/components/routes/ | Route planning UI |
| `Calendar` | apps/web/src/components/calendar/ | Monthly revision calendar |
| **Backend** | | |
| `CustomerHandler` | worker/src/handlers/customer.rs | Customer CRUD |
| `RevisionHandler` | worker/src/handlers/revision.rs | Revision management |
| `RouteHandler` | worker/src/handlers/route.rs | Route optimization |
| `VrptwSolver` | worker/src/services/vrptw.rs | VRPTW algorithm |
| `GeoService` | worker/src/services/geo.rs | Distance calculations |

## Route Optimization Algorithm

**Vehicle Routing Problem with Time Windows (VRPTW)**

For MVP, we use Haversine distance × 1.3 coefficient for road distance estimation.

```rust
// Simplified VRPTW approach for 5-12 stops

pub fn optimize_route(stops: Vec<Stop>, start: Coordinates) -> OptimizedRoute {
    // 1. Calculate distance matrix (Haversine × 1.3)
    let matrix = calculate_distance_matrix(&stops, &start);
    
    // 2. Classify time windows
    //    - HARD: exact time (±15 min tolerance)
    //    - SOFT: range (e.g., 9:00-12:00)
    //    - OPEN: anytime
    
    // 3. Initial solution: Nearest neighbor with time window priority
    let mut route = nearest_neighbor_with_time_windows(&stops, &matrix);
    
    // 4. Local optimization: 2-opt, Or-opt swaps
    route = local_search_improvement(route, &matrix);
    
    // 5. Feasibility check and warnings
    let (route, warnings) = check_feasibility(route);
    
    OptimizedRoute { stops: route, warnings, score: calculate_score(&route) }
}
```

## Current State

**Phase:** Core Development

**Completed:**
- [x] Project architecture design
- [x] Technology stack selection
- [x] Data model design
- [x] NATS message schema design
- [x] Monorepo scaffolding (pnpm workspaces + Turborepo)
- [x] Docker compose for local dev (NATS + PostgreSQL)
- [x] Rust worker skeleton with handlers structure
- [x] React frontend skeleton with routing
- [x] Database migrations (initial schema)
- [x] Shared TypeScript types package
- [x] NATS store and connection setup
- [x] Customer handler (create, list, get)
- [x] Ping handler for health checks
- [x] VRPTW route optimization algorithm (basic implementation)
- [x] Geo service (Haversine distance, road coefficient)
- [x] Nominatim geocoding client
- [x] Basic page layouts (Dashboard, Customers, Calendar, Planner)

**In Progress:**
- [ ] Full CRUD for all entities
- [ ] Frontend-backend integration testing
- [ ] Map component integration

**Pending:**
- [ ] Device handlers
- [ ] Revision handlers  
- [ ] Route handlers
- [ ] Email notifications
- [ ] User authentication

## Development Setup

### Prerequisites

```powershell
# Node.js 22+
winget install OpenJS.NodeJS.LTS

# pnpm
npm install -g pnpm

# Rust (with MSVC target)
winget install Rustlang.Rustup
rustup default stable-x86_64-pc-windows-msvc

# Visual Studio Build Tools (required for Rust compilation)
# Install via Visual Studio Installer - select "Desktop development with C++"

# Docker Desktop (for NATS + PostgreSQL)
winget install Docker.DockerDesktop

# WSL2 (required for Docker on Windows 11 Home)
wsl --install
# Restart required after WSL installation
```

### Running Locally

```powershell
# Terminal 1: Install dependencies
pnpm install

# Terminal 2: Start infrastructure (NATS + PostgreSQL)
pnpm db:up
# or: docker compose -f infra/docker-compose.yml up -d

# Terminal 3: Start Rust worker (requires VS Developer Command Prompt for MSVC)
cd worker
cargo run

# Terminal 4: Start frontend
cd apps/web
pnpm dev

# Frontend: http://localhost:5173
# NATS WebSocket: ws://localhost:8222
# NATS Native: nats://localhost:4222
# PostgreSQL: postgres://sazinka:sazinka_dev@localhost:5432/sazinka
```

### Environment Files

Copy example files and adjust as needed:

```powershell
# Worker configuration
Copy-Item worker/.env.example worker/.env

# Web app configuration  
Copy-Item apps/web/.env.example apps/web/.env
```

### Running Tests

```powershell
# TypeScript tests
pnpm test

# Rust tests
cd worker
cargo test
```

## Testing Strategy

**TDD Focus Areas:**
- VRPTW algorithm
- Distance calculations (Haversine)
- Time window validation
- NATS message handlers

**Test Coverage Goals:**
- Rust worker: 90%+
- TypeScript utilities: 100%
- React components: Critical paths

## Notes

- Development on Windows 11
- Czech language UI (later)
- MVP focuses on core CRM + route planning
- Email notifications deferred to later phase
- Invoicing/billing architecture prepared but not implemented

## Future Enhancements

- [ ] Self-hosted OSRM for accurate routing
- [ ] Self-hosted Nominatim for geocoding
- [ ] Email notifications with Resend
- [ ] Mobile-responsive design
- [ ] Offline support (Service Worker)
- [ ] Invoicing with ISDOC export
- [ ] Multi-user teams
