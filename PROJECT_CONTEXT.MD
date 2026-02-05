# Project Context

> **Last Updated:** 2026-02-05 (v0.15.1 - Import processor reliability fixes)

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
| Routing Engine | Valhalla | Distance/time matrices (self-hosted) |
| VRP Solver | vrp-pragmatic + vrp-core | VRP optimization (pure Rust) |
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
│   │ Valhalla         │         │ Nominatim        │                        │
│   │ Routing engine   │         │ Geocoding        │                        │
│   │ :8002            │         │ :8080            │                        │
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

# Admin
sazinka.admin.db.status         # Get database status (connected, size, tables)
sazinka.admin.db.reset          # Truncate all tables and create default user
sazinka.admin.valhalla.status   # Check Valhalla routing service status
sazinka.admin.nominatim.status  # Check Nominatim geocoding service status
sazinka.admin.jetstream.status  # Check JetStream job queue status
sazinka.admin.logs              # Get recent logs from all sources

# Job Queue (JetStream)
sazinka.geocode.submit                # Submit geocoding job to queue
sazinka.route.submit                  # Submit route planning job to queue
sazinka.import.customer.submit        # Submit customer import job
sazinka.import.device.submit          # Submit device import job
sazinka.import.revision.submit        # Submit revision import job
sazinka.import.communication.submit   # Submit communication import job
sazinka.import.visit.submit           # Submit visit import job
sazinka.import.zip.submit             # Submit ZIP multi-file import job
sazinka.job.geocode.status.<job_id>   # Geocoding job status updates (pub/sub)
sazinka.job.route.status.<job_id>     # Route job status updates (pub/sub)
sazinka.job.import.customer.status.<job_id>      # Customer import status
sazinka.job.import.device.status.<job_id>        # Device import status
sazinka.job.import.revision.status.<job_id>      # Revision import status
sazinka.job.import.communication.status.<job_id> # Communication import status
sazinka.job.import.visit.status.<job_id>         # Visit import status
sazinka.job.import.zip.status.<job_id>           # ZIP import status

# Settings
sazinka.settings.get            # Get all user settings including depots
sazinka.settings.work.update    # Update work constraints (hours, limits)
sazinka.settings.business.update # Update business info
sazinka.settings.email.update   # Update email templates

# Depots
sazinka.depot.list              # List all depots for user
sazinka.depot.create            # Create new depot
sazinka.depot.update            # Update depot
sazinka.depot.delete            # Delete depot
sazinka.depot.geocode           # Geocode depot address
```

## Project Structure

```
sazinka/
├── apps/
│   └── web/                        # React frontend
│       ├── public/
│       ├── src/
│       │   ├── components/
│       │   │   ├── common/         # Reusable components
│       │   │   │   └── JobStatusTimeline.tsx
│       │   │   ├── map/            # MapLibre components
│       │   │   ├── calendar/       # Calendar components
│       │   │   ├── customers/      # Customer list/detail
│       │   │   ├── routes/         # Route planner
│       │   │   └── ui/             # Generic UI components
│       │   ├── hooks/
│       │   │   ├── useNats.ts      # NATS connection hook
│       │   │   ├── useJobStatus.ts # Job status subscription hook
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
│       │   │   ├── admin.tsx       # Admin panel
│       │   │   ├── customers.tsx
│       │   │   ├── calendar.tsx
│       │   │   └── planner.tsx     # Route planner
│       │   ├── lib/
│       │   │   └── geo.ts          # Geo utilities
│       │   └── types/
│       │       ├── jobStatus.ts    # Generic job status types
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
│   │   │   ├── admin.rs
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
| `useJobStatus` | apps/web/src/hooks/useJobStatus.ts | Job status subscription hook |
| `JobStatusTimeline` | apps/web/src/components/common/JobStatusTimeline.tsx | Visual job progress timeline |
| `MapView` | apps/web/src/components/map/ | MapLibre map rendering |
| `RoutePlanner` | apps/web/src/components/routes/ | Route planning UI |
| `Calendar` | apps/web/src/components/calendar/ | Monthly revision calendar |
| `Settings` | apps/web/src/pages/Settings.tsx | User settings page (depots, work, business) |
| `settingsService` | apps/web/src/services/settingsService.ts | Settings and depot API |
| `jobService` | apps/web/src/services/jobService.ts | Generic job submission and status |
| **Backend** | | |
| `CustomerHandler` | worker/src/handlers/customer.rs | Customer CRUD |
| `SettingsHandler` | worker/src/handlers/settings.rs | Settings and depot CRUD |
| `RevisionHandler` | worker/src/handlers/revision.rs | Revision management |
| `RouteHandler` | worker/src/handlers/route.rs | Route optimization |
| `VrptwSolver` | worker/src/services/vrptw.rs | VRPTW algorithm |
| `GeoService` | worker/src/services/geo.rs | Distance calculations |
| `Geocoder` | worker/src/services/geocoding.rs | Address → coordinates abstraction |
| `MockGeocoder` | worker/src/services/geocoding.rs | Deterministic fake geocoder for tests |
| `RateLimiter` | worker/src/services/geocoding.rs | Rate limiting for API calls |
| `CircuitBreaker` | worker/src/services/geocoding.rs | Failure protection |
| `AdminHandler` | worker/src/handlers/admin.rs | DB status, reset, Valhalla health |

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

## Geocoding Safety Architecture

> **Status:** Updated for JetStream-based async flow

All geocoding requests are submitted to **JetStream** and processed asynchronously.
This provides built-in backpressure and avoids request bursts.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    GEOCODER ABSTRACTION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐   ┌─────────────────────────────────────┐    │
│   │ MockGeocoder│   │ NominatimGeocoder                   │    │
│   │ (tests/dev) │   │ (local instance)                    │    │
│   │             │   │  └─ CircuitBreaker (temporary)      │    │
│   └─────────────┘   └─────────────────────────────────────┘    │
│                                                                 │
│   Selection via: GEOCODER_BACKEND env variable                  │
│   - "mock"      → MockGeocoder (deterministic fake coords)      │
│   - "nominatim" → NominatimGeocoder                             │
└─────────────────────────────────────────────────────────────────┘
```

### Safety Layers

| Layer | Protection |
|-------|------------|
| **JetStream queue** | Backpressure and sequential processing |
| **Environment variable** | Tests and dev NEVER use production geocoder |
| **MockGeocoder** | Zero network requests for tests (deterministic) |
| **CircuitBreaker** | Temporary fallback; may be removed once JetStream is stable |

### MockGeocoder

For tests and development - generates **deterministic** coordinates from address hash:
- Same input always produces same output (reproducible tests)
- Coordinates are always within **inner** Czech Republic bounds (49.0-50.5°N, 13.0-17.5°E) to ensure Valhalla can snap all points
- High confidence score (0.95)
- Zero latency, zero network calls

### Configuration

```bash
# .env.test / .env.development
GEOCODER_BACKEND=mock

# .env.production
GEOCODER_BACKEND=nominatim
```

### Future Plans

1. **Phase 1 (current):** MockGeocoder for dev, public Nominatim for production
2. **Phase 2:** Consider HERE API free tier (250k requests/month) for better accuracy
3. **Phase 3:** Self-hosted Photon for Czech Republic if scale requires

## Route Optimization Architecture

> **Status:** Implementation (v0.7.1)

The route optimization system uses a two-component architecture for maximum performance and accuracy:

1. **Valhalla** - Open source routing engine for real road distances and travel times
2. **vrp-pragmatic + vrp-core** - Pure Rust VRP solver (pragmatic JSON adapter + core metaheuristics)

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
│  React + MapLibre GL JS                                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│   ┌─────────────────┐                                                       │
│   │ Planner Page    │  1. Select customers for day                          │
│   │                 │  2. Set parameters (start, time, windows)             │
│   │                 │  3. Display optimized route                           │
│   └────────┬────────┘                                                       │
│            │ sazinka.route.plan                                             │
└────────────│────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RUST WORKER                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐    │
│   │ Route Handler   │─────▶│ RoutingService  │─────▶│ VrpSolver       │    │
│   │                 │      │ (Valhalla HTTP) │      │ (vrp-pragmatic) │    │
│   └─────────────────┘      └────────┬────────┘      └─────────────────┘    │
│                                     │                                       │
│                                     │ HTTP                                  │
│                                     ▼                                       │
│                            ┌────────────────┐                               │
│                            │ Valhalla       │                               │
│                            │ :8002          │                               │
│                            └────────────────┘                               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **Valhalla** | Calculate real road distances and travel times between all points (distance/time matrix) |
| **vrp-pragmatic + vrp-core** | Solve VRP using pragmatic JSON + metaheuristics |
| **RoutingService** | HTTP client for Valhalla API |
| **VrpSolver** | Wrapper around vrp-pragmatic with fallback heuristic |

### Data Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Route Planning Request                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  INPUT:                                                                   │
│  {                                                                        │
│    "startLocation": { "lat": 50.08, "lng": 14.42 },  // Technician home  │
│    "customerIds": ["uuid1", "uuid2", ...],           // Max 10-15        │
│    "date": "2026-01-28",                                                 │
│    "workingHours": { "start": "08:00", "end": "17:00" }                  │
│  }                                                                        │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  STEP 1: Load customers from DB                                          │
│  → Get coordinates, time windows, service durations                      │
│  → Build points array: [depot, customer1, customer2, ...]                │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  STEP 2: Valhalla - Get matrices                                         │
│  POST http://valhalla:8002/sources_to_targets                            │
│  → distance_matrix[N×N] (meters)                                         │
│  → time_matrix[N×N] (seconds)                                            │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  STEP 3: VRP Solver - Optimize                                           │
│  vrp-pragmatic (JSON adapter) + vrp-core metaheuristics                  │
│  → route_order: [3, 1, 4, 2, 0]  // optimal order                        │
│  → arrival_times: [08:45, 10:15, ...]                                    │
│  → total_distance: 45.2 km                                               │
│  → total_duration: 8h                                                    │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  STEP 4: Valhalla - Get route geometry (optional)                        │
│  POST http://valhalla:8002/route                                         │
│  → GeoJSON LineString for map display                                    │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  OUTPUT:                                                                  │
│  {                                                                        │
│    "stops": [                                                            │
│      { "customerId": "uuid3", "order": 1, "eta": "08:45", ... },         │
│      { "customerId": "uuid1", "order": 2, "eta": "10:15", ... },         │
│      ...                                                                  │
│    ],                                                                     │
│    "totalDistanceKm": 45.2,                                              │
│    "totalDurationMinutes": 480,                                          │
│    "geometry": { "type": "LineString", "coordinates": [...] },           │
│    "optimizationScore": 95,                                              │
│    "warnings": []                                                         │
│  }                                                                        │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Valhalla Configuration

Self-hosted Valhalla with Czech Republic map data:

```yaml
# infra/docker-compose.yml
services:
  valhalla:
    image: ghcr.io/gis-ops/docker-valhalla/valhalla:latest
    ports:
      - "8002:8002"
    environment:
      - tile_urls=https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf
      - serve_tiles=True
      - build_elevation=False
    deploy:
      resources:
        limits:
          memory: 10G  # ~8GB needed for CZ tiles
```

**API Endpoints Used:**
- `POST /sources_to_targets` - Distance/time matrix calculation
- `POST /route` - Detailed route geometry for map display

### VRP Solver (vrp-pragmatic + vrp-core)

Pure Rust implementation inspired by Google OR-Tools:

```toml
# worker/Cargo.toml
[dependencies]
vrp-pragmatic = "1.25"   # High-level JSON API
vrp-core = "1.25"        # Core solver algorithms
```

**Features:**
- VRP (with time windows supported via pragmatic format)
- Guided local search metaheuristic
- Hard and soft time window constraints
- Service duration per stop
- Single vehicle (tradesperson) model

**Performance:**
- 10 stops: ~50ms solve time
- 50 stops: ~500ms solve time
- Memory: ~10MB per request

### Fallback Strategy

The system has two levels of fallback for resilience:

1. **VRP Solver Fallback:** If vrp-pragmatic fails, falls back to nearest-neighbor heuristic
2. **Routing Service Fallback:** If Valhalla is unavailable (not configured or health check fails), automatically falls back to MockRoutingService

```rust
// Automatic Valhalla detection with fallback
pub async fn create_routing_service_with_fallback(valhalla_url: Option<String>) -> Box<dyn RoutingService> {
    if let Some(url) = valhalla_url {
        // Try Valhalla health check
        if check_valhalla_health(&url).await.is_ok() {
            return Box::new(ValhallaClient::new(config));
        }
    }
    // Fallback: Haversine × 1.3 coefficient, 40 km/h average
    Box::new(MockRoutingService::new())
}
```

**Configuration:**
```bash
# .env - set VALHALLA_URL to enable real routing
VALHALLA_URL=http://localhost:8002
```

### Module Structure

```
worker/src/services/
├── routing/
│   ├── mod.rs              # RoutingService (Valhalla client)
│   ├── valhalla.rs         # Valhalla API types and client
│   └── mock.rs             # Mock routing for tests
├── vrp/
│   ├── mod.rs              # VrpSolver wrapper
│   ├── adapter.rs          # Pragmatic problem/matrix builder
│   ├── pragmatic.rs        # vrp-pragmatic solver integration
│   ├── problem.rs          # Domain problem types
│   ├── solution.rs         # Domain solution types
│   └── config.rs           # Solver configuration
└── geo.rs                  # Haversine (fallback)
```

### Testing Strategy

| Component | Test Approach |
|-----------|---------------|
| RoutingService | Mock HTTP responses, integration tests with real Valhalla |
| VrpSolver | Unit tests with known optimal solutions |
| Problem builder | Snapshot tests for JSON generation |
| Route handler | End-to-end tests with mock services |

### Current Planner UX (MVP)

- Single button: **"Naplánovat trasu"**
- Backend selects **10 random customers** with coordinates
- Route is solved in Rust worker and rendered in the Planner map

## Logging Architecture

> **Status:** Implementation (v0.8.1)

Centralized logging system for all components with file-based persistence.

### Current Implementation

```
sazinka/
└── logs/                              # Centralized log directory
    ├── worker.log.YYYY-MM-DD          # Rust worker (daily rotation)
    └── nats.log                       # NATS server
```

### Components

| Component | Log File | Method | Status |
|-----------|----------|--------|--------|
| **Worker** | `worker.log.YYYY-MM-DD` | `tracing-appender` (daily rotation) | ✅ Implemented |
| **NATS** | `nats.log` | `--log` flag in docker-compose | ✅ Implemented |
| **PostgreSQL** | `postgres.log` | `logging_collector` config | 🔮 Planned |
| **Valhalla** | `valhalla.log` | stderr redirect | 🔮 Planned |

### Worker Logging

Uses `tracing-appender` with non-blocking file writer:

```rust
// Cargo.toml
tracing-appender = "0.2"

// main.rs
let file_appender = RollingFileAppender::new(
    Rotation::DAILY,
    &logs_dir,
    "worker.log",
);
let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

tracing_subscriber::registry()
    .with(fmt::layer())                                    // stdout
    .with(fmt::layer().with_writer(non_blocking))          // file
    .init();
```

### Configuration

```bash
# Environment variable (optional)
LOGS_DIR=../logs    # Default: ../logs relative to worker binary
```

### Admin UI Integration

The Admin page (`/admin`) displays aggregated logs from all sources:
- Reads all `.log` files from `logs/` directory
- Parses both tracing-subscriber and NATS log formats
- Supports level filtering (error, warn, info, debug)
- Auto-refresh option (5s interval)

### Log Formats

**Worker (tracing-subscriber):**
```
2026-01-29T16:29:21.250643Z  INFO sazinka_worker: Starting Sazinka Worker...
2026-01-29T16:29:21.419848Z DEBUG sazinka_worker::handlers: Processing request
```

**NATS:**
```
[1] 2026/01/29 16:11:43.853519 [INF] Starting nats-server
[1] 2026/01/29 16:11:43.956539 [WRN] Websocket not configured with TLS
```

### Future Enhancements

| Phase | Enhancement | Description |
|-------|-------------|-------------|
| **Phase 1** | PostgreSQL logs | Configure `logging_collector` to write to shared volume |
| **Phase 2** | Valhalla logs | Redirect stderr to file via docker-compose |
| **Phase 3** | Log streaming | WebSocket-based real-time log streaming to Admin UI |
| **Phase 4** | Professional stack | Integrate Vector/Fluent Bit for log aggregation |
| **Phase 5** | Observability | OpenTelemetry for traces, metrics, and logs correlation |

### Professional Stack (Future)

For production deployment, consider:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Log Aggregation Pipeline                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐│
│   │ Worker      │───▶│ Vector/     │───▶│ Loki / Elasticsearch    ││
│   │ NATS        │    │ Fluent Bit  │    │ ClickHouse              ││
│   │ PostgreSQL  │    │             │    └───────────┬─────────────┘│
│   │ Valhalla    │    └─────────────┘                │              │
│   └─────────────┘                                   ▼              │
│                                          ┌─────────────────────────┐│
│                                          │ Grafana                 ││
│                                          │ - Log visualization     ││
│                                          │ - Alerting              ││
│                                          └─────────────────────────┘│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Job Queue (JetStream)

> **Status:** Implementation (v0.9.0) - Expanding in Phase 7

NATS JetStream provides persistent job queuing for ALL external service communication. This ensures backpressure, automatic retry, and horizontal scalability.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           JetStream Job Queue                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Frontend                         NATS JetStream                  Worker   │
│   ┌─────────┐    submit job    ┌─────────────────┐   pull        ┌───────┐ │
│   │   UI    │─────────────────▶│  Stream Pool    │◀──────────────│Process│ │
│   │         │                  │  (WorkQueue)    │               │or Pool│ │
│   │         │◀─────────────────│                 │───────────────│       │ │
│   └─────────┘  status updates  └─────────────────┘   process     └───────┘ │
│                                                                              │
│   Streams:                                                                   │
│   ├─ SAZINKA_GEOCODE_JOBS        (Nominatim) ✅ Implemented                 │
│   ├─ SAZINKA_GEOCODE_ADDRESS_JOBS (Nominatim) ✅ Implemented                │
│   ├─ SAZINKA_REVERSE_GEOCODE_JOBS (Nominatim) ✅ Implemented                │
│   ├─ SAZINKA_CUSTOMER_IMPORT_JOBS (DB imports) ✅ Implemented               │
│   ├─ SAZINKA_DEVICE_IMPORT_JOBS   (DB imports) ✅ Implemented               │
│   ├─ SAZINKA_REVISION_IMPORT_JOBS (DB imports) ✅ Implemented               │
│   ├─ SAZINKA_COMMUNICATION_IMPORT_JOBS (DB imports) ✅ Implemented          │
│   ├─ SAZINKA_VISIT_IMPORT_JOBS    (DB imports) ✅ Implemented               │
│   ├─ SAZINKA_ZIP_IMPORT_JOBS      (ZIP multi-CSV) ✅ Implemented            │
│   ├─ SAZINKA_ROUTING_MATRIX_JOBS  (Valhalla) 📋 Phase 7                    │
│   ├─ SAZINKA_ROUTING_GEOMETRY_JOBS (Valhalla) 📋 Phase 7                   │
│   ├─ SAZINKA_EXPORT_JOBS          (CSV exports) 📋 Phase 7                 │
│   ├─ SAZINKA_EMAIL_JOBS           (Resend API) 📋 Phase 7                  │
│   └─ SAZINKA_SMS_JOBS             (Twilio) 📋 Phase 7                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### JetStream Streams Overview

| Stream | Subject | External Service | Status |
|--------|---------|------------------|--------|
| `SAZINKA_GEOCODE_JOBS` | `sazinka.jobs.geocode` | Nominatim | ✅ Implemented |
| `SAZINKA_GEOCODE_ADDRESS_JOBS` | `sazinka.jobs.geocode.address` | Nominatim | ✅ Implemented |
| `SAZINKA_REVERSE_GEOCODE_JOBS` | `sazinka.jobs.geocode.reverse` | Nominatim | ✅ Implemented |
| `SAZINKA_CUSTOMER_IMPORT_JOBS` | `sazinka.jobs.import.customer` | PostgreSQL | ✅ Implemented |
| `SAZINKA_DEVICE_IMPORT_JOBS` | `sazinka.jobs.import.device` | PostgreSQL | ✅ Implemented |
| `SAZINKA_REVISION_IMPORT_JOBS` | `sazinka.jobs.import.revision` | PostgreSQL | ✅ Implemented |
| `SAZINKA_COMMUNICATION_IMPORT_JOBS` | `sazinka.jobs.import.communication` | PostgreSQL | ✅ Implemented |
| `SAZINKA_VISIT_IMPORT_JOBS` | `sazinka.jobs.import.visit` | PostgreSQL | ✅ Implemented |
| `SAZINKA_ZIP_IMPORT_JOBS` | `sazinka.jobs.import.zip` | PostgreSQL | ✅ Implemented |
| `SAZINKA_ROUTING_MATRIX_JOBS` | `sazinka.jobs.valhalla.matrix` | Valhalla | 📋 Phase 7A |
| `SAZINKA_ROUTING_GEOMETRY_JOBS` | `sazinka.jobs.valhalla.geometry` | Valhalla | 📋 Phase 7A |
| `SAZINKA_EXPORT_JOBS` | `sazinka.jobs.export.*` | PostgreSQL | 📋 Phase 7B |
| `SAZINKA_EMAIL_JOBS` | `sazinka.jobs.email.*` | Resend API | 📋 Phase 7C |
| `SAZINKA_SMS_JOBS` | `sazinka.jobs.sms.*` | Twilio | 📋 Phase 7C |

### Configuration

```yaml
# infra/nats-server.conf
jetstream {
  store_dir: "/data/jetstream"
  max_memory_store: 256MB
  max_file_store: 10GB
}
```

### Job Status Types

| Status | Fields | Description |
|--------|--------|-------------|
| `queued` | position, estimatedWaitSeconds | Job waiting in queue |
| `processing` | progress (0-100), message | Job being processed |
| `completed` | result (varies by job type) | Job finished successfully |
| `failed` | error | Job failed with error message |

### Stream Configuration Pattern

```rust
// Standard configuration for all job streams
jetstream::stream::Config {
    name: "SAZINKA_*_JOBS",
    subjects: vec!["sazinka.jobs.*"],
    max_messages: 1_000,
    max_bytes: 50 * 1024 * 1024, // 50 MB
    retention: RetentionPolicy::WorkQueue,
    ..Default::default()
}

// Consumer configuration
jetstream::consumer::pull::Config {
    durable_name: Some("*_workers"),
    ack_policy: AckPolicy::Explicit,
    max_deliver: 3, // Retry up to 3 times
    ..Default::default()
}
```

### Early ACK Pattern (v0.15.1)

**Problem:** Default `ack_wait` is 30 seconds. Long-running jobs (e.g., importing 1000+ customers) 
cause JetStream to redeliver the message, resulting in duplicate processing.

**Solution:** ACK immediately after parsing the job payload, before starting processing:

```rust
async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
    let job: QueuedImportJob = serde_json::from_slice(&msg.payload)?;
    
    // ACK immediately to prevent redelivery during long processing
    // Import jobs should not be retried automatically - failures are reported via status
    if let Err(e) = msg.ack().await {
        error!("Failed to ack job {}: {:?}", job.id, e);
    }
    
    // Now process the job (can take minutes for large imports)
    // Status updates inform UI of progress/completion/failure
    ...
}
```

**Trade-off:** If processing fails after ACK, the job won't be automatically retried. 
This is acceptable for imports because:
1. Failures are reported via status updates to the UI
2. Duplicate imports would create data inconsistencies
3. User can retry manually with corrected data

### Module Structure

```
worker/src/
├── types/
│   ├── job.rs                    # Generic JobStatus, QueuedJob
│   ├── valhalla_job.rs           # MatrixJob, GeometryJob (Phase 7A)
│   ├── import_job.rs             # ImportJob types (Phase 7B)
│   ├── export_job.rs             # ExportJob types (Phase 7B)
│   ├── email_job.rs              # EmailJob types (Phase 7C)
│   └── sms_job.rs                # SMSJob types (Phase 7C)
├── services/
│   ├── valhalla_processor.rs     # Valhalla JetStream wrapper (Phase 7A)
│   ├── import_processor.rs       # Import job processor (Phase 7B)
│   ├── export_processor.rs       # Export job processor (Phase 7B)
│   ├── email_processor.rs        # Email job processor (Phase 7C)
│   └── sms_processor.rs          # SMS job processor (Phase 7C)
└── handlers/
    ├── jobs.rs                   # Generic job handlers
    └── geocode.rs                # Geocode processor (implemented)
```

### Benefits of JetStream for External Services

| Benefit | Description |
|---------|-------------|
| **Backpressure** | Queue limits prevent external service overload |
| **Automatic retry** | Failed jobs retry up to 3 times |
| **Persistence** | Jobs survive worker restart |
| **Horizontal scaling** | Multiple workers can process from same queue |
| **Observability** | Real-time status updates, unified monitoring |
| **Consistency** | Same pattern for all external services |

## Job Status System (Reusable)

> **Status:** Implementation (v0.13.0)

Unified job status tracking system for all async operations (geocoding, route optimization, import).
Provides natural backpressure and horizontal scaling through JetStream message queue.

### NATS JetStream Message Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    JetStream Message Lifecycle                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Producer                    Stream                     Consumer        │
│   ────────                    ──────                     ────────        │
│                                                                          │
│   publish() ──────────────► [PENDING]                                   │
│                                │                                         │
│                                │  fetch/push                             │
│                                ▼                                         │
│                            [DELIVERED] ──────────────► received          │
│                                │                            │            │
│                                │                            │            │
│              ┌─────────────────┼─────────────────┐          │            │
│              │                 │                 │          │            │
│              ▼                 ▼                 ▼          │            │
│         [ACKED]          [IN_PROGRESS]      [NACKED]        │            │
│         (+ACK)              (+WPI)           (-NAK)         │            │
│            │                   │                │           │            │
│            │                   │                │           │            │
│            ▼                   │                ▼           │            │
│         removed           reset timer      redelivery       │            │
│         from stream           │             attempt         │            │
│                               │                             │            │
│                               ▼                             │            │
│                         [TERMINATED]                        │            │
│                            (+TERM)                          │            │
│                               │                             │            │
│                               ▼                             │            │
│                         abandoned                           │            │
│                         (dead letter)                       │            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### JetStream Acknowledgment Types

| Ack Type | Code | Description |
|----------|------|-------------|
| **Ack** | `+ACK` | Successfully processed, remove from stream |
| **Nak** | `-NAK` | Failed, redeliver (with optional delay) |
| **In Progress** | `+WPI` | Still processing, reset ack timeout |
| **Term** | `+TERM` | Give up, move to dead letter queue |

### UI Timeline States

Mapping from JetStream states to user-facing timeline:

| JetStream State | UI State | Czech Label | Description |
|-----------------|----------|-------------|-------------|
| PENDING | `queued` | Fronta | Job waiting in queue |
| DELIVERED + WPI | `processing` | Zpracování | Job being processed |
| ACKED | `completed` | Hotovo | Job finished successfully |
| NACKED (max retries) | `failed` | Selhalo | Job failed after retries |
| TERM | `failed` | Selhalo | Job abandoned |

### Generic Job Status Types

```typescript
// apps/web/src/types/jobStatus.ts

export type JobStatusType = 'queued' | 'processing' | 'completed' | 'failed';

export interface JobStatusQueued {
  type: 'queued';
  position?: number;
}

export interface JobStatusProcessing {
  type: 'processing';
  progress?: number;      // 0-100
  processed?: number;
  total?: number;
  message?: string;
}

export interface JobStatusCompleted {
  type: 'completed';
  result?: unknown;
}

export interface JobStatusFailed {
  type: 'failed';
  error: string;
  retryable?: boolean;
}

export type JobStatus = 
  | JobStatusQueued 
  | JobStatusProcessing 
  | JobStatusCompleted 
  | JobStatusFailed;

export interface JobStatusUpdate<T extends JobStatus = JobStatus> {
  jobId: string;
  timestamp: string;
  status: T;
}
```

### Reusable Components

#### JobStatusTimeline Component

Visual timeline showing job progress through states:

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│   ●────────────●────────────○                               │
│  Fronta    Zpracování    Hotovo                             │
│   (done)    (active)    (pending)                           │
│                                                              │
│  Optional progress bar:                                      │
│  ████████████░░░░░░░░░░░  45%                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Props:
```typescript
interface JobStatusTimelineProps {
  status: JobStatus | null;
  steps?: TimelineStep[];           // Custom steps or default
  showProgress?: boolean;           // Show progress bar
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Default steps
const DEFAULT_STEPS: TimelineStep[] = [
  { id: 'queued', label: 'Fronta' },
  { id: 'processing', label: 'Zpracování' },
  { id: 'completed', label: 'Hotovo', failedLabel: 'Selhalo' },
];
```

#### useJobStatus Hook

React hook for job status subscription:

```typescript
interface UseJobStatusOptions {
  jobType: string;        // 'geocode' | 'route' | 'import'
  onCompleted?: () => void;
  onFailed?: (error: string) => void;
}

interface UseJobStatusReturn {
  status: JobStatus | null;
  jobId: string | null;
  isActive: boolean;
  submit: (payload: unknown) => Promise<string>;
  cancel: () => void;
}

// Usage
const { status, submit, isActive } = useJobStatus({
  jobType: 'route',
  onCompleted: () => loadOptimizedRoute(),
});
```

### Job Type Subjects

| Job Type | Submit Subject | Status Subject |
|----------|---------------|----------------|
| Geocoding | `sazinka.geocode.submit` | `sazinka.job.geocode.status.{jobId}` |
| Route | `sazinka.route.submit` | `sazinka.job.route.status.{jobId}` |
| Customer Import | `sazinka.import.customer.submit` | `sazinka.job.import.customer.status.{jobId}` |
| Device Import | `sazinka.import.device.submit` | `sazinka.job.import.device.status.{jobId}` |
| Revision Import | `sazinka.import.revision.submit` | `sazinka.job.import.revision.status.{jobId}` |
| Communication Import | `sazinka.import.communication.submit` | `sazinka.job.import.communication.status.{jobId}` |
| Visit Import | `sazinka.import.visit.submit` | `sazinka.job.import.visit.status.{jobId}` |
| ZIP Import | `sazinka.import.zip.submit` | `sazinka.job.import.zip.status.{jobId}` |

### Backend Status Publishing

Worker publishes status updates as job progresses:

```rust
// worker/src/handlers/route.rs

async fn process_route_job(&self, msg: jetstream::Message) -> Result<()> {
    let job: QueuedRouteJob = serde_json::from_slice(&msg.payload)?;
    
    // Stage 1: Loading data
    self.publish_status(job.id, RouteJobStatus::Processing {
        stage: "loading".to_string(),
        progress: 10,
    }).await?;
    
    // Stage 2: Building matrix
    self.publish_status(job.id, RouteJobStatus::Processing {
        stage: "matrix".to_string(),
        progress: 40,
    }).await?;
    
    // Stage 3: Solving VRP
    self.publish_status(job.id, RouteJobStatus::Processing {
        stage: "solving".to_string(),
        progress: 70,
    }).await?;
    
    // Complete
    self.publish_status(job.id, RouteJobStatus::Completed {
        result: route_response,
    }).await?;
    
    msg.ack().await?;
    Ok(())
}
```

### Usage Locations

| Location | Job Type | Custom Steps |
|----------|----------|--------------|
| CustomerForm | geocode | Fronta → Zpracování → Hotovo |
| Planner | route | Fronta → Načítání → Matice → Optimalizace → Hotovo |
| ImportModal | import | Parsování → Odesílání → Geokódování → Hotovo |

### Benefits

1. **Backpressure** - JetStream naturally limits concurrent processing
2. **Scalability** - Multiple workers can consume from same queue
3. **Resilience** - Failed jobs are retried automatically
4. **Visibility** - Real-time status updates to UI
5. **Code Reuse** - Single component/hook for all job types

## Local Geocoding (Nominatim)

> **Status:** Implementation (v0.9.0)

Self-hosted Nominatim instance for geocoding independence from public APIs.

### Container Configuration

```yaml
# infra/docker-compose.yml
nominatim:
  image: mediagis/nominatim:4.4
  ports:
    - "8080:8080"
  environment:
    PBF_URL: https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf
    REPLICATION_URL: https://download.geofabrik.de/europe/czech-republic-updates/
  volumes:
    - nominatim_data:/var/lib/postgresql/14/main
  deploy:
    resources:
      limits:
        memory: 4G
```

### Features

- **Data**: Czech Republic OSM extract (~500MB)
- **Import time**: 30-60 minutes on first run
- **Memory**: 4GB limit (can be adjusted)
- **Rate limiting**: Configurable via `NOMINATIM_RATE_LIMIT_MS` (default 100ms for local)

### Configuration

```bash
# worker/.env
GEOCODER_BACKEND=nominatim
NOMINATIM_URL=http://localhost:8080    # Local instance
NOMINATIM_RATE_LIMIT_MS=100            # Much faster than public API
```

### Fallback Strategy

```rust
// Uses NOMINATIM_URL first, falls back to NOMINATIM_BASE_URL (legacy)
let base_url = std::env::var("NOMINATIM_URL")
    .or_else(|_| std::env::var("NOMINATIM_BASE_URL"))
    .unwrap_or_else(|_| "https://nominatim.openstreetmap.org".to_string());
```

## Current State

**Phase:** Core Development

**Completed:**
- [x] Project architecture design
- [x] Technology stack selection
- [x] Data model design
- [x] NATS message schema design
- [x] Monorepo scaffolding (pnpm workspaces + Turborepo)
- [x] Docker compose for local dev (NATS + PostgreSQL + Valhalla)
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
- [x] Basic page layouts (Dashboard, Customers, Calendar, Planner, Admin)
- [x] **Frontend customer service** (createCustomer, listCustomers, getCustomer)
- [x] **Form validation logic** with TDD (33 unit tests)
- [x] **AddCustomerForm component** with real-time validation
- [x] **Dashboard quick actions** (navigate to customers, planner, calendar)
- [x] **camelCase serialization** between frontend (TypeScript) and backend (Rust)
- [x] Vitest test configuration with jsdom and testing-library
- [x] **Geocoding abstraction layer** with safety features (MockGeocoder, RateLimiter, CircuitBreaker)
- [x] **AddressMap component** (MapLibre GL JS map with marker display)
- [x] **Geocoding in AddCustomerForm** (debounced real-time geocoding preview with map)
- [x] **CustomerDetail page** with address, contact, notes, metadata, and map sections
- [x] **Customer list navigation** (clickable cards linking to detail pages)
- [x] **TanStack Router setup** for customer detail routes (`/customers/:customerId`)
- [x] **Test coverage** for Customers page (9 tests) and CustomerDetail page (15 tests)
- [x] **Customer type support** (person/company with IČO, DIČ, contact person)
- [x] **Customer edit/delete** with confirmation dialog
- [x] **CSV import** with TDD (80 tests) - parsing, normalization, phone E.164, batch processing
- [x] **Valhalla routing integration** with automatic fallback to mock (TDD)
- [x] **vrp-pragmatic solver** with unassigned job reasons in solver log
- [x] **Solver diagnostics in UI** (algorithm, solve time, warnings, unassigned reasons)
- [x] **Admin page** with service health checks (NATS, PostgreSQL, Valhalla, Worker)
- [x] **Database reset** with automatic default user creation
- [x] **MockGeocoder** generates coordinates strictly within Czech Republic (inner bounds: 49.0-50.5°N, 13.0-17.5°E)
- [x] **Valhalla matrix requests** with increased snapping radius for mock coordinates
- [x] **Route geometry visualization** - full route from Valhalla with all legs concatenated
- [x] **Centralized logging** - Worker and NATS logs to `logs/` directory with Admin UI viewer
- [x] **JetStream job queue** - Persistent job queue for route planning with status updates
- [x] **Local Nominatim geocoding** - Self-hosted geocoding with Czech Republic data
- [x] **Admin health checks** - Nominatim and JetStream status in Admin UI
- [x] **Settings page** - Full settings UI with 3 sections (Depots, Work constraints, Business info)
- [x] **Depot management** - Multiple depots per user with map selection, geocoding support
- [x] **Work constraints settings** - Working hours, max revisions, default service duration
- [x] **Email template settings** - Customizable subject and body templates with variables
- [x] **Route planning uses settings** - VRP solver uses working hours and service duration from user settings
- [x] **Phase 1 Complete** - Device and Revision management with TDD:
  - Device service + UI (DeviceList, DeviceForm)
  - Revision service + UI (RevisionList, RevisionForm, CompleteRevisionDialog)
  - Dashboard with real-time statistics from revision.stats
  - 173 frontend tests passing

**In Progress:**
- [ ] Phase 7B: Async import system frontend integration (services, stores, UI updates)

**Pending:**
- [ ] Phase 3: User authentication, CSV export, Email notifications
- [ ] Phase 4: CRM Evidence (Communications, Visits, Timeline)
- [ ] Route optimization conversion to async job queue

**Recently Completed:**
- [x] Phase 7B Backend: Async import processors for all entity types (v0.15.0)
  - CustomerImportProcessor, DeviceImportProcessor, RevisionImportProcessor
  - CommunicationImportProcessor, VisitImportProcessor, ZipImportProcessor
  - All imports now use JetStream job queue with status updates

### Serialization Notes

All NATS messages between frontend and backend use **camelCase** for JSON field names:
- Frontend (TypeScript): `userId`, `postalCode`, `createdAt`
- Backend (Rust): Uses `#[serde(rename_all = "camelCase")]` on all message and entity structs

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

## Related Documentation

- [CSV Import Format](./IMPORT_FORMAT.MD) – Specifikace importu zákazníků z CSV

## Notes

- Development on Windows 11
- Docker Desktop uses WSL2 for Linux containers on Windows 11 Home
- Czech language UI (later)
- MVP focuses on core CRM + route planning
- Email notifications deferred to later phase
- Invoicing/billing architecture prepared but not implemented

## Recent Changes (v0.15.1)

- **Import Processor Reliability** - Fixed issues with JetStream message handling:
  - **Early ACK pattern** - All import processors now ACK messages immediately after parsing
    - Prevents message redelivery when processing takes longer than 30-second timeout
    - Applied to: Customer, Device, Revision, Communication, Visit, ZIP import processors
  - **ZIP import geocoding** - Added automatic geocoding trigger after ZIP import
    - Checks if customers were imported and triggers geocoding for pending addresses
    - Uses same pattern as `CustomerImportProcessor`
  - **Fixed duplicate imports** - ZIP import no longer processes files multiple times

## Recent Changes (v0.15.0)

- **Async Import System** - All entity imports now use JetStream job queue:
  - **CustomerImportProcessor** - Async customer import with status tracking
  - **DeviceImportProcessor** - Async device import with progress updates
  - **RevisionImportProcessor** - Async revision import with error reporting
  - **CommunicationImportProcessor** - Async communication import
  - **VisitImportProcessor** - Async visit import
  - **ZipImportProcessor** - Multi-file ZIP import with automatic file type detection
    - Detects file types from filenames (customers, devices, revisions, communications, visits)
    - Imports files in correct dependency order: Customers → Devices → Revisions → Communications → Visits
  - All processors publish status updates via NATS pub/sub
- **New Shared Types** - TypeScript types for all import job types in `packages/shared-types/src/import.ts`
- **New Rust Types** - Rust equivalents in `worker/src/types/import.rs`
- **Dependencies** - Added `zip` and `base64` crates for ZIP file handling

## Recent Changes (v0.13.0)

- **Job Status System** - Reusable components for async job tracking:
  - **JobStatusTimeline component** - Visual timeline (Fronta → Zpracování → Hotovo/Selhalo)
  - **useJobStatus hook** - NATS subscription management with auto-cleanup
  - **Generic job status types** - Unified types for all job types
  - **JetStream message lifecycle** - Documented NATS acknowledgment types (+ACK, -NAK, +WPI, +TERM)
- **Async everywhere** - Natural backpressure through JetStream queue
- **Route optimization** - Converting to async job queue (like geocoding)
- **Import geocoding** - Using JobStatusTimeline for progress display
- **Planner merged with TechnicianDay** - Single unified "Plán dne" page

## Recent Changes (v0.12.1)

- **Geocoding Status Tracking** - Customers now have explicit geocode status:
  - New `geocode_status` column: `pending`, `success`, `failed`
  - Failed addresses marked as "failed" instead of staying "pending" forever
  - Admin UI shows: `X pending, Y chybných, Z jobs queued`
  - Customer list shows ⚠️ warning for customers with failed geocoding
  - Customer detail shows prominent warning banner for failed addresses
- **Start Script Improvements** - `start.ps1` now includes all services:
  - Added `nominatim` and `valhalla` to docker-compose startup
  - Added service URLs to final output (Nominatim :8080, Valhalla :8002)
  - Added note about warm-up time for geocoding services
- **CSV Import Format** - Extended documentation (IMPORT_FORMAT.MD v2.2.1):
  - Added sections for Devices, Revisions, Communications, Visits
  - Added FAQ section with detailed edge cases
  - Device matching by serial_number, device_name, or device_type

## Recent Changes (v0.12.0)

- **Phase 2.1 Complete** - Functional Calendar:
  - **calendarUtils.ts** - Date utilities with 18 TDD tests
  - **CalendarGrid/DayCell** - Components for month view
  - **Calendar.tsx** - Month navigation, revision display, day details panel
- **Phase 2.2 Complete** - Smart Plan Suggestions:
  - **Backend handler** - sazinka.revision.suggest with priority scoring
  - **Priority algorithm** - Overdue (100) > Due week (80) > Due soon (60) > Month (40) > Later (20)
  - **Planner rewrite** - Shows prioritized suggestions with checkbox selection
  - **revisionService.ts** - Added getSuggestedRevisions (+4 tests, 24 total)
- **195 Frontend Tests** - All tests passing

## Recent Changes (v0.11.0)

- **Phase 1 Complete** - Full Device and Revision management:
  - **Frontend services (TDD)** - deviceService.ts (16 tests), revisionService.ts (20 tests)
  - **Device UI** - DeviceList, DeviceForm components integrated into CustomerDetail
  - **Revision UI** - RevisionList, RevisionForm, CompleteRevisionDialog components
  - **Dashboard stats** - Real-time statistics from revision.stats endpoint
  - **CSS fixes** - Corrected CSS variable names (--color-primary, --color-border, etc.)
- **173 Frontend Tests** - All tests passing

## Recent Changes (v0.10.1)

- **Route Planning Uses User Settings** - VRP solver now uses user's configured settings:
  - **Working hours** - Shift start/end times from Settings page (instead of hardcoded 0:00-23:59)
  - **Service duration** - Default visit duration from Settings (instead of hardcoded 30 min)
  - Falls back to defaults (8:00-17:00, 30 min) if user settings not found
- **New Tests (TDD)** - Added tests for:
  - `build_vrp_problem` with custom service duration and working hours
  - `solve_pragmatic_includes_service_duration_in_total` - verifies service time affects total duration
  - `solve_pragmatic_longer_service_duration_increases_total` - verifies longer service = longer route
- **Improved Logging** - Route handler now logs which settings are being used (info level)

## Recent Changes (v0.10.0)

- **Settings Page** - New UI for user settings with three tabs:
  - Depots management (CRUD with map)
  - Work constraints (working hours, max visits, default intervals)
  - Business info and email templates
- **Device Handlers** - Full CRUD backend for devices (create, list, get, update, delete)
- **Revision Handlers** - Full CRUD backend plus upcoming/stats endpoints
- **Admin Page Improvements** - Better Nominatim status (shows "Importing" during data import)
- **Planner UI Cleanup** - Removed unused queue toggle checkbox
- **Bug Fix** - Fixed `EmptyPayload` deserialization for settings requests

## Route-Aware Planning Architecture

> **Status:** Planning phase (Phase 8)
> **Goal:** "Domluvit návštěvu" = vložit zakázku do trasy s minimem Δkm/Δmin

### Data Model Decisions

#### Entity Mapping (GA Redesign)

| UI Termín | DB Entita | Popis |
|-----------|-----------|-------|
| Zákazník | `Customer` | Osoba nebo firma |
| Zařízení | `Device` | Kotel, komín, plynový spotřebič |
| Zakázka | `Revision` | Co se má udělat (revize/servis) |
| Návštěva | `Visit` | Domluvený termín + časové okno + auto |
| Plán dne | `PlannedRoute` | Trasa pro den a auto |

#### Entity Relationships

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│  Customer   │──1:N─│   Device    │──1:N─│  Revision   │
└─────────────┘      └─────────────┘      └──────┬──────┘
                                                 │
                                              0..1│
                                                 ▼
                                          ┌─────────────┐
                                          │    Visit    │
                                          └─────────────┘
```

**Key decisions:**
- 1 Device → N Revision (periodické zakázky)
- 1 Revision → 0..1 Visit (dokud není domluveno, Visit neexistuje)
- 1 Visit může obsluhovat N Revisions (více zařízení u zákazníka)

#### Snooze Extension

```sql
-- Rozšíření pro odložení
ALTER TABLE revisions ADD COLUMN snooze_reason VARCHAR(255);
ALTER TABLE revisions ADD COLUMN snoozed_by UUID REFERENCES users(id);
ALTER TABLE revisions ADD COLUMN snoozed_at TIMESTAMPTZ;
```

### Performance Requirements

#### Latency Targets

| Operace | Cílová latence | Poznámka |
|---------|----------------|----------|
| UI highlight kandidáta | ≤150ms | Jen UI, bez výpočtů |
| Slot suggestions | 400-700ms | Akceptovatelné se skeletonem |
| Kompletní route recalc | ≤1200ms | S progressive loading |

#### Matrix Calculation Strategy

**Problém:** Pro best-insertion nepotřebujeme kompletní NxN matici.

**Řešení:** Využít Valhalla `sources_to_targets` s 1×K + K×1 namísto K×K.

```
Trasa: S1 → S2 → S3 → ... → Sk
Kandidát: X

Pro výpočet Δ vložení mezi Si → Si+1:
  Δ = t(Si, X) + t(X, Si+1) - t(Si, Si+1)

Potřebujeme dopočítat:
  - vektor t(Si, X) pro všechna Si  (K×1 - many-to-one)
  - vektor t(X, Si) pro všechna Si  (1×K - one-to-many)

Výhody:
  - 2K výpočtů místo K² 
  - Řádově rychlejší
  - Bezpečnější pro Valhalla paměť
```

### Scoring Algorithm

#### Best Insertion Score

```
HARD CONSTRAINTS (filtr - must pass):
├── Časová okna splněna (arrival ≤ window_end)
├── Vejde se do pracovního dne (včetně návratu do depa)
└── Slack ≥ minimum (např. 10 min)

SOFT SCORE (řazení - lower is better):
score = w1 * Δmin 
      + w2 * Δkm 
      + w3 * riskPenalty(slack) 
      + w4 * dueUrgency

Doporučené váhy:
├── w1 = 1.0   (čas je primární)
├── w2 = 0.5   (km sekundární)
├── w3 = 0.3   (penalizace těsných dnů)
└── w4 = 0.2   (zvýhodnění urgentních)
```

#### Due Urgency Bonus

| Stav | Bonus |
|------|-------|
| Overdue (po termínu) | -100 (vyšší priorita) |
| Due this week | -80 |
| Due soon (14 dní) | -60 |
| Due this month | -40 |
| Upcoming | -20 |

### Caching Strategy

#### Cache Key Structure

```typescript
interface RouteCacheKey {
  date: string;           // "2026-02-05"
  vehicleId: string;      // UUID
  candidateId: string;    // UUID
  routeVersion: number;   // Inkrementuje při změně trasy
}
```

#### Cache Invalidation

| Událost | Akce |
|---------|------|
| Přidání/odebrání zastávky | Increment routeVersion |
| Změna pořadí zastávek | Increment routeVersion |
| Změna časového okna | Increment routeVersion |
| Výběr jiného dne/auta | Nový cache key |

### Edge Cases

#### Multiple Devices per Customer

Zákazník má kotel + komín, oba jsou k revizi:

```
Řešení: 1 Visit pro N Revisions

visit.service_duration = sum(revision_durations) + overhead
  - overhead: konfigurovatelný (default 5-10 min)

V UI: Stop má badge "2 zakázky" s rozklikem
```

#### Fixed Appointments

Zákazník říká "jen v pátek 10:00":

```
Reprezentace: Úzké časové okno

time_window_start = 10:00
time_window_end = 10:15   // nebo 10:00 pro "přesně"
is_hard_constraint = true

V UI: Chip "Pevný termín" (nelze přesouvat)
```

#### Lunch Breaks / Pauses

```sql
-- V nastavení vozidla/technika
break_start TIME DEFAULT '12:00',
break_end TIME DEFAULT '12:30'
```

V optimalizaci: Pauza se chová jako blokovaný interval.

#### Depot Return

```
Kapacita dne zahrnuje:
├── Čas jízdy (travel_time)
├── Servisní čas (service_duration)
├── Pauzy (breaks)
└── Návrat do depa (return_to_depot)

V UI: Metriky "včetně návratu do depa"
```

### Route-Aware Inbox Pre-ranking

Pro celý inbox (50+ kandidátů) nepočítat full best insertion hned.

```
Levný pre-ranking (pro celý list):
├── Vzdálenost k nejbližší zastávce v trase
├── Vzdálenost k bounding boxu trasy
└── Shoda města/oblasti

Přesný výpočet (lazy):
├── Viditelné řádky (virtualizace)
├── Prefetch +10 řádků
└── Vybraný kandidát (vždy)
```

### Multi-Vehicle Comparison

```
Nepočítat pro všechny kandidáty × všechna auta.

Strategie:
1. Pro aktuální auto: plné slot suggestions
2. Pro 1-2 další auta: jen "best insertion delta"
3. Ukázat tip jen když rozdíl > práh:
   - >10 min lepší NEBO
   - >5 km lepší

UI: "Tip: Auto 2 (+2 min)" - ne spam pro malé rozdíly
```

### Status Signals (Consistent)

#### Address Status

| Status | Code | Description |
|--------|------|-------------|
| `verified` | ✅ | Má geo, prošla validací |
| `pending` | ⏳ | Geokódování čeká |
| `unlocatable` | ⚠ | Geokód selhal |
| `missing` | ⛔ | Bez adresy |

#### Slot Insertion Status

| Status | Conditions |
|--------|------------|
| `ok` ✅ | Bez konfliktu, load ≤90%, slack ≥20min |
| `tight` ⚠ | Load 90-100% OR slack 10-20min |
| `conflict` ❌ | Window violated OR load >100% |

#### Day Capacity Status

| Status | Conditions |
|--------|------------|
| `ok` ✅ | load <80%, slack >30min |
| `tight` ⚠ | load 80-95% OR slack 15-30min |
| `overloaded` ❌ | load >95% OR slack <15min |

## Future Enhancements

- [x] ~~Self-hosted Nominatim for geocoding~~ (implemented v0.9.0)
- [x] ~~Settings UI for depots and work constraints~~ (implemented v0.10.0)
- [x] ~~Device/Revision backend handlers~~ (implemented v0.10.0)
- [x] ~~Route planning uses user settings~~ (implemented v0.10.1)
- [x] ~~Device/Revision frontend UI in CustomerDetail~~ (implemented v0.11.0)
- [x] ~~Dashboard with real statistics~~ (implemented v0.11.0)
- [x] ~~Functional Calendar page~~ (implemented v0.12.0)
- [x] ~~Smart plan suggestions~~ (implemented v0.12.0)
- [x] ~~Geocoding status tracking~~ (implemented v0.12.1)
- [ ] CRM: Communication log (Phase 4)
- [ ] CRM: Visit tracking (Phase 4)
- [ ] CRM: Customer timeline (Phase 4)
- [ ] Email notifications with Resend
- [ ] Mobile-responsive design
- [ ] Offline support (Service Worker)
- [ ] Invoicing with ISDOC export
- [ ] Multi-user teams
- [ ] Route history and analytics
