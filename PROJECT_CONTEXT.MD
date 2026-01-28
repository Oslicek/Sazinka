# Project Context

> **Last Updated:** 2026-01-28 (v0.7.1)

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
│   │ Routing engine   │         │ (future, self-   │                        │
│   │ :8002            │         │  hosted)         │                        │
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
| `Geocoder` | worker/src/services/geocoding.rs | Address → coordinates abstraction |
| `MockGeocoder` | worker/src/services/geocoding.rs | Deterministic fake geocoder for tests |
| `RateLimiter` | worker/src/services/geocoding.rs | Rate limiting for API calls |
| `CircuitBreaker` | worker/src/services/geocoding.rs | Failure protection |

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

> **Status:** Provisional (may change in future)

The geocoding system is designed with multiple safety layers to **never risk getting blocked** by external services like Nominatim.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    GEOCODER ABSTRACTION                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐   ┌─────────────────────────────────────┐    │
│   │ MockGeocoder│   │ RateLimitedNominatimGeocoder        │    │
│   │ (tests/dev) │   │ (production)                        │    │
│   │             │   │  ├─ RateLimiter (1.5s interval)     │    │
│   │ No network  │   │  └─ CircuitBreaker (3 failures)     │    │
│   └─────────────┘   └─────────────────────────────────────┘    │
│                                                                 │
│   Selection via: GEOCODER_BACKEND env variable                  │
│   - "mock"      → MockGeocoder (deterministic fake coords)      │
│   - "nominatim" → RateLimitedNominatimGeocoder                  │
└─────────────────────────────────────────────────────────────────┘
```

### Safety Layers

| Layer | Protection |
|-------|------------|
| **Environment variable** | Tests and dev NEVER use production geocoder |
| **MockGeocoder** | Zero network requests for tests (deterministic) |
| **RateLimiter** | Max 1 request per 1.5 seconds (Nominatim limit is 1/s) |
| **CircuitBreaker** | After 3 failures, stops requests for 5 minutes |
| **Queue for batch** | Sequential processing with enforced delays |

### MockGeocoder

For tests and development - generates **deterministic** coordinates from address hash:
- Same input always produces same output (reproducible tests)
- Coordinates are always within Czech Republic bounds (48.5-51.1°N, 12.0-18.9°E)
- High confidence score (0.95)
- Zero latency, zero network calls

### Configuration

```bash
# .env.test / .env.development
GEOCODER_BACKEND=mock

# .env.production
GEOCODER_BACKEND=nominatim
NOMINATIM_RATE_LIMIT_MS=1500
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

If vrp-pragmatic fails, the system falls back to a nearest-neighbor heuristic.
If Valhalla is unavailable, the routing service can fall back to Haversine distance estimation:

```rust
// Fallback: Haversine × 1.3 coefficient for road distance
let road_distance = haversine_distance(a, b) * 1.3;
let travel_time_minutes = road_distance / 40.0 * 60.0;  // 40 km/h average
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

**In Progress:**
- [ ] Route optimization with Valhalla + vrp-pragmatic (time windows + routing geometry)
- [ ] Device management UI

**Pending:**
- [ ] Device handlers
- [ ] Revision handlers  
- [ ] Email notifications
- [ ] User authentication

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

## Future Enhancements

- [ ] Self-hosted Nominatim for geocoding
- [ ] Email notifications with Resend
- [ ] Mobile-responsive design
- [ ] Offline support (Service Worker)
- [ ] Invoicing with ISDOC export
- [ ] Multi-user teams
- [ ] Route history and analytics
