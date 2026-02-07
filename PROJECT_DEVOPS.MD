# PROJECT_DEVOPS.MD - Instalace a provoz systému Sazinka

Tento dokument je kompletní návod k rozběhnutí systému Sazinka na novém serveru.
Obsahuje popis celé infrastruktury, technologického stacku, konfiguraci všech služeb
a krok-za-krokem instalační postup.

---

## 1. Přehled architektury

```
┌────────────────────────────────────────────────────────────────────┐
│                        KLIENTI (Browser)                          │
│                      React 19 + TypeScript                        │
│                     MapLibre GL (mapy)                             │
│                   Zustand (state management)                      │
└───────────────────────┬────────────────────────────────────────────┘
                        │ WebSocket (:8222)
                        ▼
┌────────────────────────────────────────────────────────────────────┐
│                     NATS Server (Alpine)                          │
│              :4222 native  │  :8222 websocket  │  :8223 monitoring│
│                     JetStream (perzistentní zprávy)               │
└──────────┬────────────────────────────────┬───────────────────────┘
           │ :4222 native                   │
           ▼                                │
┌──────────────────────────┐                │
│    Rust Worker            │                │
│    (sazinka-worker)       │                │
│    - NATS message handler │                │
│    - Business logic       │                │
│    - DB migrace           │                │
│    - VRP solver           │                │
│    - Geocoding orchestrace│                │
└───┬──────┬──────┬────────┘                │
    │      │      │                          │
    ▼      ▼      ▼                          │
┌──────┐ ┌────────┐ ┌──────────┐            │
│Postgres│ │Nominatim│ │Valhalla │            │
│ :5432  │ │ :8080   │ │ :8002   │            │
│        │ │geocoding│ │ routing │            │
└────────┘ └─────────┘ └─────────┘            │
```

**Komunikační model**: Frontend komunikuje s backendem výhradně přes NATS WebSocket.
Worker nemá žádný HTTP server. Všechny požadavky (CRUD, geocoding, routing, VRP)
jdou jako NATS zprávy. Asynchronní úlohy (geocoding, Valhalla geometrie) běží přes
JetStream pro garantované doručení.

---

## 2. Technologický stack

### 2.1 Frontend

| Technologie | Verze | Účel |
|---|---|---|
| Node.js | >= 22.0.0 | Runtime |
| pnpm | 9.15.0 | Package manager |
| React | 19 | UI framework |
| TypeScript | 5.x | Typový systém |
| Vite | 6 | Build tool & dev server |
| TanStack Router | ^1.93.0 | Routing |
| TanStack React Query | ^5.62.0 | Data fetching |
| Zustand | ^5.0.0 | State management |
| nats.ws | ^1.29.0 | NATS WebSocket klient |
| MapLibre GL | ^4.7.0 | Mapové zobrazení |
| Vitest | 3.x | Testovací framework |
| Turbo | ^2.3.0 | Monorepo orchestrace |

### 2.2 Backend (Worker)

| Technologie | Verze | Účel |
|---|---|---|
| Rust | stable (edition 2021) | Jazyk |
| Tokio | 1.43 | Async runtime |
| async-nats | 0.38 | NATS klient |
| SQLx | 0.8 | PostgreSQL driver + migrace |
| reqwest | 0.12 | HTTP klient (Nominatim, Valhalla) |
| vrp-pragmatic | 1.25 | VRP solver (optimalizace tras) |
| argon2 | 0.5 | Hashování hesel |
| jsonwebtoken | 9 | JWT autentizace |
| tracing | 0.1 | Strukturovaný logging |
| tracing-appender | 0.2 | Denní rotace logů |

### 2.3 Infrastruktura (Docker)

| Služba | Image | Účel |
|---|---|---|
| PostgreSQL | postgres:16-alpine | Hlavní databáze |
| NATS | nats:2.10-alpine | Message broker + JetStream |
| Nominatim | mediagis/nominatim:4.4 | Geocoding (OSM data ČR) |
| Valhalla | ghcr.io/gis-ops/docker-valhalla/valhalla:latest | Routing engine |

---

## 3. Porty a síťová mapa

| Služba | Port | Protokol | Popis |
|---|---|---|---|
| Frontend (dev) | 5173 | HTTP | Vite dev server |
| NATS native | 4222 | TCP | Worker ↔ NATS |
| NATS WebSocket | 8222 | WS | Browser ↔ NATS |
| NATS monitoring | 8223 | HTTP | Health check endpoint |
| PostgreSQL | 5432 | TCP | Databáze |
| Nominatim | 8080 | HTTP | Geocoding API |
| Valhalla | 8002 | HTTP | Routing API |

---

## 4. Prerekvizity

### 4.1 Software

```
- Docker Desktop (nebo Docker Engine + Docker Compose v2)
- Node.js >= 22.0.0
- pnpm 9.15.0 (npm install -g pnpm@9.15.0)
- Rust toolchain (stable) - https://rustup.rs
- Visual Studio 2022/2026 s workloadem "Desktop development with C++"
  (nutné pro kompilaci Rust nativních závislostí na Windows)
- Git
```

### 4.2 Hardware (minimální požadavky)

```
- CPU:  4 jádra (Nominatim import je CPU-intenzivní)
- RAM:  16 GB (Valhalla potřebuje až 10 GB pro tiles ČR)
- Disk: 30 GB volného místa
  - Nominatim data:  ~2 GB
  - Valhalla tiles:  ~8 GB (CZ region)
  - PostgreSQL:      ~1 GB (roste s daty)
  - JetStream:       ~4 GB (konfigurovatelný limit)
```

### 4.3 Časové nároky prvního spuštění

```
- Docker pull images:              ~5 minut
- PostgreSQL inicializace:         ~10 sekund
- NATS:                            ~2 sekundy
- Nominatim import (CZ):           ~1-2 hodiny (PBF download + indexace)
- Valhalla tile build (CZ):        ~5-15 minut
- Rust worker kompilace (první):   ~3-5 minut
- Frontend npm install:            ~1 minuta
```

---

## 5. Struktura projektu

```
Sazinka/
├── apps/
│   └── web/                      # React frontend (Vite)
│       ├── src/
│       │   ├── components/       # UI komponenty
│       │   ├── pages/            # Stránky aplikace
│       │   ├── services/         # NATS komunikační služby
│       │   ├── stores/           # Zustand stores
│       │   ├── utils/            # Utilitní funkce
│       │   └── routes/           # TanStack Router definice
│       ├── package.json
│       ├── vite.config.ts
│       ├── .env                  # VITE_NATS_WS_URL
│       └── .env.example
│
├── packages/
│   └── shared-types/             # Sdílené TypeScript typy
│       └── src/
│           ├── customer.ts
│           ├── device.ts
│           ├── revision.ts
│           ├── route.ts
│           ├── settings.ts
│           └── index.ts
│
├── worker/                       # Rust backend worker
│   ├── src/
│   │   ├── main.rs               # Vstupní bod, inicializace
│   │   ├── config.rs             # Konfigurace z env vars
│   │   ├── handlers/             # NATS message handlery
│   │   │   ├── mod.rs
│   │   │   ├── customer.rs
│   │   │   ├── revision.rs
│   │   │   ├── route.rs
│   │   │   ├── geocode.rs
│   │   │   └── ...
│   │   ├── services/             # Business logika
│   │   │   ├── geocoding.rs
│   │   │   ├── nominatim.rs
│   │   │   ├── routing/          # Valhalla integrace
│   │   │   └── vrp/              # Vehicle Routing Problem solver
│   │   ├── db/                   # Databázové dotazy
│   │   │   └── queries/
│   │   └── types/                # Rust typy (job.rs, messages.rs)
│   ├── migrations/               # SQLx migrace
│   │   ├── 001_initial_schema.sql
│   │   └── 002_add_auth_fields.sql
│   ├── Cargo.toml
│   ├── .env                      # Viz sekce 6
│   └── .env.example
│
├── infra/                        # Docker infrastruktura
│   ├── docker-compose.yml
│   ├── nats-server.conf
│   ├── init-db.sql               # Inicializační SQL (extensions)
│   ├── seed-dev.sql              # Testovací data (dev)
│   └── manage.ps1                # Správa infrastruktury
│
├── logs/                         # Aplikační logy (auto-generované)
│   └── worker.log.YYYY-MM-DD    # Denní rotace
│
├── start.ps1                     # Spuštění celého stacku
├── stop.ps1                      # Zastavení celého stacku
├── package.json                  # Root package.json (monorepo)
├── pnpm-workspace.yaml           # pnpm workspace konfigurace
├── turbo.json                    # Turbo monorepo konfigurace
│
├── PROJECT_CONTEXT.MD            # Architektura a kontext systému
├── PROJECT_DATA.MD               # Datový model
├── PROJECT_UX.MD                 # UX specifikace a workflow
├── PROJECT_ROADMAP.MD            # Roadmapa vývoje
├── PROJECT_IMPORT.MD             # Specifikace CSV importu
└── PROJECT_DEVOPS.MD             # ← Tento soubor
```

---

## 6. Konfigurace prostředí

### 6.1 Worker (`worker/.env`)

```env
# NATS server URL
NATS_URL=nats://localhost:4222

# PostgreSQL connection string
DATABASE_URL=postgres://sazinka:sazinka_dev@localhost:5432/sazinka

# Geocoding backend: "mock" nebo "nominatim"
GEOCODER_BACKEND=nominatim

# Nominatim API URL (lokální instance)
NOMINATIM_URL=http://localhost:8080

# Valhalla routing engine URL (volitelné, fallback na mock)
VALHALLA_URL=http://localhost:8002

# Adresář pro logy (relativně k worker binárce)
LOGS_DIR=../logs

# Úroveň logování
RUST_LOG=info,sazinka_worker=debug
```

Poznámka: `GEOCODER_BACKEND=mock` je určené pouze pro lokální vývoj/testy.
V produkci používejte `nominatim`.

### 6.2 Frontend (`apps/web/.env`)

```env
# NATS WebSocket URL pro browser
VITE_NATS_WS_URL=ws://localhost:8222
```

Poznámka: v `apps/web/.env.example` je aktuálně řádek `VITE_NATS_WS_URL` duplicitně.
Stačí ponechat pouze jeden.

### 6.3 PostgreSQL (v `docker-compose.yml`)

```env
POSTGRES_USER=sazinka
POSTGRES_PASSWORD=sazinka_dev        # ZMĚNIT v produkci!
POSTGRES_DB=sazinka
JWT_SECRET=dev-secret-change-in-production-min-32-bytes!!  # ZMĚNIT v produkci!
```

Poznámka: `JWT_SECRET` musí být nastaven i pro worker (např. v `worker/.env` nebo
environment serveru), jinak se používá výchozí dev hodnota.

### 6.4 NATS (`infra/nats-server.conf`)

```conf
server_name: sazinka-nats-1
port: 4222                           # Nativní klient

websocket {
  port: 8222                         # WebSocket pro browser
  no_tls: true                       # V produkci zapnout TLS (WSS)!
}

jetstream {
  store_dir: "/data/jetstream"
  max_memory_store: 512MB
  max_file_store: 4GB
}

max_payload: 8MB
max_connections: 1000
http_port: 8223                      # Monitoring
```

---

## 7. Docker Compose - kompletní konfigurace

```yaml
# infra/docker-compose.yml
services:
  nats:
    image: nats:2.10-alpine
    container_name: sazinka-nats
    ports:
      - "4222:4222"     # Nativní klient
      - "8222:8222"     # WebSocket
    command: >
      --config /etc/nats/nats-server.conf
      --jetstream
      --log /logs/nats.log
    volumes:
      - ./nats-server.conf:/etc/nats/nats-server.conf:ro
      - ../logs:/logs
      - nats_jetstream:/data/jetstream
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: sazinka-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: sazinka
      POSTGRES_PASSWORD: sazinka_dev
      POSTGRES_DB: sazinka
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    restart: unless-stopped

  nominatim:
    image: mediagis/nominatim:4.4
    container_name: sazinka-nominatim
    ports:
      - "8080:8080"
    environment:
      PBF_URL: https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf
      NOMINATIM_PASSWORD: nominatim_dev
      FREEZE: "true"
    volumes:
      - nominatim_data:/var/lib/postgresql/14/main
    shm_size: 1g
    deploy:
      resources:
        limits:
          memory: 4G
    restart: unless-stopped

  valhalla:
    image: ghcr.io/gis-ops/docker-valhalla/valhalla:latest
    container_name: sazinka-valhalla
    ports:
      - "8002:8002"
    volumes:
      - valhalla_tiles:/custom_files
    environment:
      - tile_urls=https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf
      - serve_tiles=True
      - build_elevation=False
      - build_admins=False
      - build_time_zones=False
      - use_tiles_ignore_pbf=True
    deploy:
      resources:
        limits:
          memory: 10G
    restart: unless-stopped

volumes:
  postgres_data:
  nats_jetstream:
  nominatim_data:       # CHRÁNĚNÝ - rebuild trvá ~2 hodiny!
  valhalla_tiles:       # ~8 GB, rebuild ~5-15 minut
```

Poznámka: NATS monitoring port `8223` není v `docker-compose.yml` publikovaný na hosta.
Pro lokální monitoring použijte `docker exec` nebo přidejte mapování portu
`- \"8223:8223\"` do služby `nats`.

---

## 8. Instalace krok za krokem

### 8.1 Klonování repozitáře

```powershell
git clone <repository-url> Sazinka
cd Sazinka
```

### 8.2 Spuštění Docker služeb

```powershell
cd infra
docker-compose up -d
cd ..
```

Ověření stavu:

```powershell
docker-compose -f infra/docker-compose.yml ps
```

Čekání na PostgreSQL:

```powershell
docker exec sazinka-postgres pg_isready -U sazinka
# Mělo by vypsat: "accepting connections"
```

**Pozor**: Nominatim potřebuje 1-2 hodiny na první import (stahuje a indexuje
OSM data České republiky). Valhalla potřebuje ~5-15 minut na build tiles.
Sledujte průběh:

```powershell
docker logs -f sazinka-nominatim    # Sledování importu Nominatim
docker logs -f sazinka-valhalla     # Sledování buildu Valhalla
```

### 8.3 Příprava Worker prostředí

```powershell
cd worker
copy .env.example .env              # Zkopírovat šablonu env
```

Upravte `worker/.env` pokud jsou odlišné adresy/porty.

### 8.4 Kompilace Worker (debug build)

```powershell
cd worker
cargo build                         # Debug build (~3-5 minut poprvé)
```

Na Windows je třeba mít nastavené Visual Studio prostředí. Buď:
- Spustit z **Developer Command Prompt for VS**
- Nebo použít `start.ps1` (automaticky nastaví VS prostředí)

### 8.5 Spuštění Worker

```powershell
cd worker
$env:RUST_LOG="info,sazinka_worker=debug"
.\target\debug\sazinka-worker.exe
```

Worker při startu:
1. Připojí se k PostgreSQL
2. Automaticky spustí migrace (`worker/migrations/`)
3. Připojí se k NATS
4. Vytvoří JetStream streamy
5. Začne zpracovávat zprávy

### 8.6 Instalace frontend závislostí

```powershell
# Z root adresáře projektu
pnpm install
```

### 8.7 Příprava frontend prostředí

```powershell
cd apps/web
copy .env.example .env              # Zkopírovat šablonu env
```

### 8.8 Spuštění frontend dev serveru

```powershell
cd apps/web
pnpm dev                            # → http://localhost:5173
```

### 8.9 (Volitelné) Seed testovacích dat

```powershell
docker exec -i sazinka-postgres psql -U sazinka -d sazinka < infra/seed-dev.sql
```

Vytvoří testovacího admin uživatele:
- Email: `test@example.com`
- Heslo: seed skript ukládá pouze placeholder hash. Skutečné heslo je potřeba
  nastavit přes registraci nebo ho worker doplní při prvním přihlášení v legacy
  režimu (v `seed-dev.sql` je uvedeno `password123` jako dev výchozí).

### 8.10 Rychlý start (vše najednou)

```powershell
.\start.ps1                         # Spustí vše: Docker + Worker + Frontend
```

Poznámka: `start.ps1` aktuálně spouští `target/release/sazinka-worker.exe`.
Pokud máte jen debug build, spusťte `cargo build --release` nebo upravte skript,
aby používal `target/debug`.

Parametry:
- `-NoBuild` — přeskočit kompilaci workeru
- `-NoDocker` — přeskočit start Docker služeb
- `-NoFrontend` — přeskočit start frontend serveru

Zastavení:

```powershell
.\stop.ps1                          # Zastaví vše
.\stop.ps1 -KeepDocker              # Zastaví worker+frontend, Docker ponechá
```

---

## 9. Správa infrastruktury

### 9.1 Skript `infra/manage.ps1`

```powershell
cd infra

.\manage.ps1 status                 # Stav všech služeb
.\manage.ps1 start                  # Spustit služby
.\manage.ps1 stop                   # Zastavit (data zachována)
.\manage.ps1 restart                # Restart
.\manage.ps1 logs                   # Sledovat logy (Ctrl+C pro ukončení)

# NEBEZPEČNÉ operace (vyžadují potvrzení):
.\manage.ps1 reset-db               # Smazat PostgreSQL (Nominatim zůstane!)
.\manage.ps1 reset-all              # Smazat VŠECHNA data včetně Nominatim
```

### 9.2 Docker volume management

```powershell
# Zobrazení volumes
docker volume ls --filter "name=sazinka"

# POZOR: Nominatim volume zabírá ~2 GB a rebuild trvá ~2 hodiny!
# Nikdy nemazat pokud to není nutné.

# Volumes:
#   sazinka_postgres_data    - Databáze (lze resetovat za sekundy)
#   sazinka_nats_jetstream   - JetStream persistence
#   sazinka_nominatim_data   - OSM data ČR (2 hodiny rebuild!)
#   sazinka_valhalla_tiles   - Routing tiles (~8 GB, ~15 min rebuild)
```

---

## 10. Databáze

### 10.1 Připojení

```powershell
# psql přes Docker
docker exec -it sazinka-postgres psql -U sazinka -d sazinka

# Connection string
postgres://sazinka:sazinka_dev@localhost:5432/sazinka
```

### 10.2 Migrace

Migrace se spouštějí automaticky při startu workeru (SQLx). Soubory jsou v
`worker/migrations/` a pojmenovány s číselným prefixem:

```
001_initial_schema.sql    - Kompletní schéma (tabulky, indexy, triggery)
002_add_auth_fields.sql   - Autentizační pole (role, owner_id)
```

### 10.3 Schéma databáze

```
┌───────────┐     ┌──────────┐     ┌──────────┐
│   users   │────<│ customers│────<│ devices  │
│  (admin)  │     │          │     │          │
└───────────┘     └────┬─────┘     └────┬─────┘
     │                 │                │
     │            ┌────┴─────┐    ┌────┴──────┐
     │            │ communic.│    │ revisions │
     │            └──────────┘    └────┬──────┘
     │                                 │
     │            ┌──────────┐    ┌────┴──────┐
     ├───────────<│  routes  │───<│route_stops│
     │            └──────────┘    └───────────┘
     │            ┌──────────┐    ┌───────────────┐
     ├───────────<│  visits  │───<│visit_work_items│
     │            └──────────┘    └───────────────┘
     │            ┌──────────┐
     ├───────────<│  depots  │
     │            ┌──────────┐
     └───────────<│  crews   │
```

**Hlavní tabulky**:

| Tabulka | Popis |
|---|---|
| `users` | Uživatelské účty (admin/customer/worker) |
| `customers` | Zákazníci s adresou a geocode stavem |
| `devices` | Plynová zařízení vyžadující revize |
| `revisions` | Revizní povinnosti (plánování, stav, výsledek) |
| `visits` | Fyzické návštěvy u zákazníků |
| `visit_work_items` | Práce vykonaná při návštěvě |
| `routes` | Denní plány tras |
| `route_stops` | Zastávky v trase |
| `communications` | Historie komunikace (hovory, emaily, poznámky) |
| `depots` | Depa (výchozí body tras) |
| `crews` | Posádky / pracovní týmy |

### 10.4 Záloha a obnova

```powershell
# Záloha
docker exec sazinka-postgres pg_dump -U sazinka -d sazinka > backup.sql

# Obnova
docker exec -i sazinka-postgres psql -U sazinka -d sazinka < backup.sql

# Záloha komprimovaná (custom format)
docker exec sazinka-postgres pg_dump -U sazinka -Fc -d sazinka > backup.dump
docker exec -i sazinka-postgres pg_restore -U sazinka -d sazinka < backup.dump
```

---

## 11. NATS a JetStream

### 11.1 Subjekty (NATS Subjects)

Konvence: `sazinka.{entita}.{akce}`

```
# Synchronní request-reply:
sazinka.customer.list              # Seznam zákazníků
sazinka.customer.get               # Detail zákazníka
sazinka.customer.create            # Vytvoření zákazníka
sazinka.customer.update            # Aktualizace zákazníka
sazinka.revision.list              # Seznam revizí
sazinka.route.save                 # Uložení trasy
sazinka.settings.get               # Nastavení
...

# Asynchronní joby (JetStream):
sazinka.jobs.geocode               # Geocoding job
sazinka.jobs.geocode.reverse       # Reverzní geocoding job
sazinka.jobs.valhalla.geometry     # Valhalla route geometry job
sazinka.jobs.vrp.optimize          # VRP optimalizace trasy

# Status updates (publish/subscribe):
sazinka.job.geocode.status.{jobId}              # Stav geocoding jobu
sazinka.job.valhalla.geometry.status.{jobId}    # Stav Valhalla jobu
```

### 11.2 JetStream streamy

Worker při startu automaticky vytváří JetStream streamy pro perzistentní
zpracování úloh. Fronty zaručují at-least-once delivery.

### 11.3 Monitoring

```powershell
# NATS monitoring endpoint
curl http://localhost:8223/healthz          # Health check
curl http://localhost:8223/varz             # Server statistiky
curl http://localhost:8223/connz            # Aktivní připojení
curl http://localhost:8223/jsz              # JetStream statistiky
```

---

## 12. Geocoding (Nominatim)

### 12.1 Lokální instance

Aplikace provozuje vlastní instanci Nominatim s daty České republiky.
PBF soubor se stahuje automaticky z Geofabrik při prvním spuštění.

```
URL: http://localhost:8080
Data: Czech Republic (download.geofabrik.de)
Import: ~1-2 hodiny (jednorázově)
Disk: ~2 GB
RAM: ~4 GB limit
```

### 12.2 Testování

```powershell
# Forward geocoding (adresa → souřadnice)
curl "http://localhost:8080/search?q=Vinohradská+12,+Praha&format=json"

# Reverse geocoding (souřadnice → adresa)
curl "http://localhost:8080/reverse?lat=50.075&lon=14.437&format=json"

# Status
curl "http://localhost:8080/status"
```

### 12.3 Architektura geocodingu

Veškerý geocoding probíhá asynchronně přes JetStream:

```
Frontend → NATS (sazinka.jobs.geocode) → Worker → Nominatim API
                                              ↓
Frontend ← NATS (sazinka.job.geocode.status.{id}) ← Worker
```

Worker obsahuje circuit breaker pro případ výpadku Nominatim.

---

## 13. Routing (Valhalla)

### 13.1 Lokální instance

Self-hosted Valhalla s tiles pro Českou republiku.

```
URL: http://localhost:8002
Data: Czech Republic (download.geofabrik.de)
Build: ~5-15 minut (jednorázově)
Disk: ~8 GB (tiles)
RAM: ~10 GB limit
```

### 13.2 Testování

```powershell
# Route request
curl -X POST http://localhost:8002/route -H "Content-Type: application/json" -d '{
  "locations": [
    {"lat": 50.075, "lon": 14.437},
    {"lat": 50.080, "lon": 14.450}
  ],
  "costing": "auto"
}'

# Status
curl http://localhost:8002/status
```

### 13.3 Využití v aplikaci

- **Planner**: Optimalizace denních tras (VRP solver + Valhalla geometrie)
- **Inbox**: Plánování tras s vizualizací na mapě
- **Route geometry**: Segmentované polyline s interaktivním zvýrazněním

---

## 14. Logování

### 14.1 Worker logy

```
Umístění: logs/worker.log.YYYY-MM-DD
Rotace:   Denní (automatická)
Formát:   Textový s timestamp
Úroveň:   Konfigurovatelná přes RUST_LOG
```

Příklady `RUST_LOG`:

```env
RUST_LOG=info                          # Pouze info+
RUST_LOG=info,sazinka_worker=debug     # Debug pro worker, info pro ostatní
RUST_LOG=debug                         # Vše debug (verbose)
RUST_LOG=info,sqlx=warn                # Potlačit SQL debug výpisy
```

### 14.2 Docker logy

```powershell
docker logs sazinka-nats               # NATS logy
docker logs sazinka-postgres           # PostgreSQL logy
docker logs sazinka-nominatim          # Nominatim logy
docker logs sazinka-valhalla           # Valhalla logy

# Sledování v reálném čase
docker logs -f sazinka-nats
```

### 14.3 NATS logy

NATS zapisuje logy do `logs/nats.log` (mapováno z Docker volume).

---

## 15. Build a nasazení

### 15.1 Worker - debug build (vývoj)

```powershell
cd worker
cargo build                            # → target/debug/sazinka-worker.exe
```

### 15.2 Worker - release build (produkce)

```powershell
cd worker
cargo build --release                  # → target/release/sazinka-worker.exe
```

Release build má povolené LTO a `codegen-units = 1` pro maximální optimalizaci.
Kompilace trvá déle (~10+ minut) ale výsledný binární soubor je výrazně rychlejší.

### 15.3 Frontend - produkční build

```powershell
cd apps/web
pnpm build                             # → dist/
```

Produkční build generuje statické soubory do `apps/web/dist/` které lze
nasadit na libovolný statický hosting (Cloudflare Pages, nginx, S3, ...).

### 15.4 Monorepo build

```powershell
# Z root adresáře
pnpm build                             # Turbo builduje vše
pnpm test                              # Spustí všechny testy
pnpm typecheck                         # TypeScript kontrola
pnpm lint                              # Linting
```

---

## 16. Produkční nasazení

### 16.1 Plánovaná architektura

```
- Frontend:    Cloudflare Pages (statický hosting)
- Worker:      VPS (Hetzner) - systemd service
- PostgreSQL:  VPS nebo managed (Neon)
- NATS:        VPS (Docker)
- Nominatim:   VPS (Docker)
- Valhalla:    VPS (Docker)
```

### 16.2 Bezpečnostní checklist pro produkci

```
[ ] Změnit POSTGRES_PASSWORD (silné heslo)
[ ] Změnit JWT_SECRET (min. 32 znaků, náhodný řetězec)
[ ] Zapnout TLS na NATS WebSocket
    - Buď přes nginx/Caddy reverse proxy
    - Nebo nativní NATS TLS s certifikáty
[ ] Nastavit firewall (povolit jen potřebné porty)
[ ] Nasadit frontend přes HTTPS
[ ] Zamezit přímému přístupu na porty 4222, 5432, 8080, 8002 z internetu
[ ] Nastavit zálohovací strategii pro PostgreSQL
[ ] Konfigurovat monitoring a alerting
[ ] Nastavit log rotation a archivaci
```

### 16.3 NATS TLS (pro produkci)

Varianta A - Reverse proxy (doporučeno):

```nginx
# nginx konfigurace
server {
    listen 443 ssl;
    server_name nats.example.com;

    ssl_certificate /etc/letsencrypt/live/nats.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nats.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8222;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Varianta B - Nativní NATS TLS:

```conf
# nats-server.conf
websocket {
  port: 8222
  tls {
    cert_file: "/etc/nats/cert.pem"
    key_file: "/etc/nats/key.pem"
  }
}
```

Frontend `.env` pro produkci:

```env
VITE_NATS_WS_URL=wss://nats.example.com
```

### 16.4 Systemd service (Linux)

```ini
# /etc/systemd/system/sazinka-worker.service
[Unit]
Description=Sazinka Worker
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=sazinka
WorkingDirectory=/opt/sazinka/worker
EnvironmentFile=/opt/sazinka/worker/.env
ExecStart=/opt/sazinka/worker/target/release/sazinka-worker
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable sazinka-worker
sudo systemctl start sazinka-worker
sudo systemctl status sazinka-worker
```

---

## 17. Troubleshooting

### 17.1 Worker se nepřipojí k NATS

```
Symptom: "connection refused" při startu workeru
Řešení:
  1. Ověřit: docker ps | grep nats
  2. Ověřit port: curl http://localhost:8223/healthz
  3. Zkontrolovat NATS_URL v worker/.env
```

### 17.2 Worker se nepřipojí k PostgreSQL

```
Symptom: "connection refused" nebo "authentication failed"
Řešení:
  1. Ověřit: docker exec sazinka-postgres pg_isready -U sazinka
  2. Zkontrolovat DATABASE_URL v worker/.env
  3. Pokud nový server: počkat na dokončení inicializace (init-db.sql)
```

### 17.3 Geocoding nefunguje

```
Symptom: Geocoding joby skončí s chybou
Řešení:
  1. Ověřit stav Nominatim: curl http://localhost:8080/status
  2. Pokud nový server: Nominatim může stále importovat (~2 hodiny)
  3. Zkontrolovat NOMINATIM_URL v worker/.env
  4. Zkontrolovat logy: docker logs sazinka-nominatim
```

### 17.4 Valhalla nefunguje

```
Symptom: Routing/geometrie joby selhávají
Řešení:
  1. Ověřit stav: curl http://localhost:8002/status
  2. Pokud nový server: Valhalla může stále buildovat tiles (~15 min)
  3. Zkontrolovat VALHALLA_URL v worker/.env
  4. Zkontrolovat logy: docker logs sazinka-valhalla
  5. Ověřit RAM: Valhalla potřebuje ~10 GB
```

### 17.5 Frontend se nepřipojí

```
Symptom: "Server není dostupný" na login stránce
Řešení:
  1. Ověřit NATS WebSocket: wscat -c ws://localhost:8222
  2. Zkontrolovat VITE_NATS_WS_URL v apps/web/.env
  3. Zkontrolovat browser console pro WebSocket chyby
  4. Zkontrolovat že NATS běží: docker ps | grep nats
```

### 17.6 Kompilace workeru selhává (Windows)

```
Symptom: "link.exe not found" nebo podobné chyby
Řešení:
  1. Nainstalovat Visual Studio s workloadem "Desktop development with C++"
  2. Spustit z Developer Command Prompt for VS
  3. Nebo použít start.ps1 (automaticky nastaví VS prostředí)
  4. Ověřit: where.exe cl.exe
```

### 17.7 Port je obsazený

```powershell
# Zjistit co poslouchá na daném portu (Windows)
netstat -ano | findstr :5432
Get-NetTCPConnection -LocalPort 5432

# Zjistit proces podle PID
Get-Process -Id <PID>
```

---

## 18. Údržba

### 18.1 Aktualizace OSM dat

Nominatim i Valhalla používají statické OSM snapshoty. Pro aktualizaci:

```powershell
# Nominatim - smazat volume a nechat reimportovat (~2 hodiny!)
docker-compose -f infra/docker-compose.yml stop nominatim
docker volume rm sazinka_nominatim_data
docker-compose -f infra/docker-compose.yml up -d nominatim

# Valhalla - smazat tiles a nechat přebudovat (~15 minut)
docker-compose -f infra/docker-compose.yml stop valhalla
docker volume rm sazinka_valhalla_tiles
docker-compose -f infra/docker-compose.yml up -d valhalla
```

### 18.2 Pravidelné zálohy

```powershell
# Denní záloha databáze (doporučeno automatizovat cron/scheduled task)
$date = Get-Date -Format "yyyy-MM-dd"
docker exec sazinka-postgres pg_dump -U sazinka -Fc -d sazinka > "backup-$date.dump"
```

### 18.3 Monitoring health checků

```powershell
# Jednoduchý health check skript
$services = @{
    "PostgreSQL" = { docker exec sazinka-postgres pg_isready -U sazinka 2>$null; $LASTEXITCODE -eq 0 }
    "NATS"       = { (Invoke-WebRequest -Uri http://localhost:8223/healthz -UseBasicParsing).StatusCode -eq 200 }
    "Nominatim"  = { (Invoke-WebRequest -Uri http://localhost:8080/status -UseBasicParsing).StatusCode -eq 200 }
    "Valhalla"   = { (Invoke-WebRequest -Uri http://localhost:8002/status -UseBasicParsing).StatusCode -eq 200 }
}
```
