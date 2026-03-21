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
│   ├── site/                     # Marketingová část (Site)
│   │   ├── src/
│   │   │   ├── components/       # UI komponenty (hero, pricing, features...)
│   │   │   ├── pages/            # Veřejné stránky (home, pricing, docs...)
│   │   │   └── assets/           # Obrázky, ikony
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   └── .env.production       # Žádné WebSockety, čistě statický
│   │
│   └── web/                      # Aplikační část (App)
│       ├── src/
│       │   ├── components/       # UI komponenty
│       │   ├── pages/            # Stránky aplikace (po přihlášení)
│       │   ├── services/         # NATS komunikační služby
│       │   ├── stores/           # Zustand stores
│       │   ├── utils/            # Utilitní funkce
│       │   └── routes/           # TanStack Router definice
│       ├── package.json
│       ├── vite.config.ts
│       ├── .env                  # VITE_NATS_WS_URL (dev)
│       ├── .env.example
│       └── .env.production       # VITE_NATS_WS_URL=wss://app.sazinka.cz/nats
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
│   ├── docker-compose.prod.yml   # Produkční konfigurace
│   ├── nats-server.conf
│   ├── nats-server.prod.conf     # Produkční konfigurace s ACL
│   ├── Caddyfile                 # Reverse proxy konfigurace
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

**Poznámka**: Aplikace má dvě oddělené části:
- **Site** (`apps/site`): Veřejná marketingová část bez WebSocketů.
- **App** (`apps/web`): Aplikační část s NATS WebSocket (po přihlášení).

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

Poznámka: `start.ps1` automaticky hledá debug i release binárku a spouští tu,
která existuje (debug má přednost). Skript také načítá `worker/.env` a předává
proměnné prostředí workeru v novém okně.

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

**Aplikační část** (`apps/web`):

```powershell
cd apps/web
pnpm build                             # → dist/
```

Produkční build generuje statické soubory do `apps/web/dist/` které lze
nasadit na Cloudflare Pages, nginx, S3, atd.

**Marketingová část** (`apps/site`):

```powershell
cd apps/site
pnpm build                             # → dist/
```

Marketingová část je čistě statická (žádný NATS WebSocket). Build je optimalizovaný
pro rychlost:
- Lazy loading komponent
- Code splitting
- Optimalizované obrázky
- Tree shaking

### 15.4 Monorepo build

```powershell
# Z root adresáře
pnpm build                             # Turbo builduje vše
pnpm test                              # Spustí všechny testy
pnpm typecheck                         # TypeScript kontrola
pnpm lint                              # Linting
```

---

## 16. Bezpečnost a produkční nasazení

> **POZOR**: Tato sekce je zásadní pro jakékoliv nasazení mimo localhost.
> Frontend komunikuje přímo s NATS přes WebSocket, takže NATS se stává
> de facto veřejným API. Bez níže popsaných opatření je systém triviálně
> zneužitelný.

### 16.1 Analýza rizik: proč je výchozí konfigurace nebezpečná

Vývojová konfigurace má tyto vlastnosti, které jsou na localhost v pořádku,
ale na veřejném serveru představují kritická rizika:

```
RIZIKO                              DOPAD                              PRIORITA
─────────────────────────────────── ─────────────────────────────────── ────────
NATS WS bez TLS a bez autentizace  MITM, odposlech, spam subjectů     KRITICKÁ
Docker porty publikované na 0.0.0.0 Přímý přístup k DB, geocodingu    KRITICKÁ
Dev hesla a JWT secret v repozitáři Plný přístup k DB a sessions      KRITICKÁ
Žádné NATS ACL (permissions)        Čtení cizích dat, DoS workeru     VYSOKÁ
Žádný rate limiting na WS           DoS, job explosion                VYSOKÁ
Chybí CORS (allowed_origins)        Cross-site útoky přes browser     STŘEDNÍ
Valhalla image :latest              Supply-chain riziko               STŘEDNÍ
Žádný audit log                     Útok se pozná pozdě/nikdy        STŘEDNÍ
```

### 16.2 Cílová architektura pro veřejný server

> **⚠ AKTUALIZOVÁNO**: Viz sekce 20.2 pro aktuální architekturu.
> Worker nyní běží jako Docker kontejner místo systemd service.
> Caddy obsluhuje pouze `api.sazinka.cz` a `monitor.sazinka.cz`.

Aplikace má dvě oddělené části:

1. **Site** (marketingová část): Veřejná home page, demos, pricing, dokumentace.
   - Statický React/Vite build, žádné WebSockety.
   - Processing pouze na klientovi → nemůže dojít k přetížení serveru.
   - Nasazeno na Cloudflare Pages nebo jako statické soubory přes Caddy.

2. **App** (aplikační část): CRM, plánování tras, správa zákazníků.
   - React/Vite s NATS WebSocket komunikací.
   - Přístup pouze po přihlášení.
   - Vyžaduje autentizaci a autorizaci.

```
                         Internet
                            │
                     ┌──────┴──────┐
                     │  Firewall   │
                     │ jen 22+443  │
                     └──────┬──────┘
                            │ :443
                     ┌──────┴──────────────────────────┐
                     │         Caddy                   │
                     │    reverse proxy + TLS          │
                     └──┬────────┬─────────┬───────────┘
                        │        │         │
            ┌───────────┘        │         └──────────┐
            │                    │                    │
            ▼                    ▼                    ▼
     ┌─────────────┐    ┌──────────────┐    ┌───────────────┐
     │ Site        │    │ App          │    │ NATS :8223    │
     │ (statické)  │    │ (statické)   │    │ monitoring    │
     │ /           │    │ /app         │    │ (basic auth)  │
     │ /pricing    │    │ + wss→ws     │    └───────────────┘
     │ /docs       │    │ /app/nats    │
     └─────────────┘    └──────┬───────┘
                               │ wss→ws
                               ▼
                        ┌──────────────┐
                        │ NATS :8222   │
                        │ (interní)    │
                        │ + Auth/ACL   │
                        └──────┬───────┘
                               │ :4222 (docker net)
                               ▼
                        ┌──────────────┐
                        │ Rust Worker  │
                        └──┬──────┬──┬─┘
                           │      │  │   vše přes docker network
                           ▼      ▼  ▼
                        Postgres  Nominatim  Valhalla
                        :5432     :8080      :8002
```

**Klíčové principy**:
- Z internetu je vidět POUZE port 443 (Caddy).
- **Site** je čistě statický, žádné WebSockety → nemůže být přetížen.
- **App** vyžaduje přihlášení, teprve pak se otevře WebSocket.
- NATS WebSocket je dostupný jen přes `/app/nats` (ne z veřejné části).
- Vše ostatní komunikuje uvnitř Docker sítě.

### 16.3 Bezpečnostní checklist (před nasazením)

```
KRITICKÉ (musí být splněno před prvním veřejným přístupem):
[ ] Firewall: povolit jen porty 22 (SSH) a 443 (HTTPS), vše ostatní DROP
[ ] Docker porty: bindnout na 127.0.0.1 nebo nepublikovat vůbec
[ ] Reverse proxy (Caddy/nginx) s TLS před NATS WebSocket → wss://
[ ] NATS autentizace: browser klient musí prokázat identitu
[ ] NATS ACL: browser klient nemá volný přístup ke všem subjectům
[ ] Změnit POSTGRES_PASSWORD (openssl rand -hex 24)
[ ] Změnit JWT_SECRET (openssl rand -hex 32, min. 32 bytů)
[ ] Odstranit všechny dev fallback hodnoty z worker kódu
[ ] CORS: nastavit allowed_origins na doménu frontendu

VYSOKÉ (nasadit co nejdříve):
[ ] Rate limiting na reverse proxy (per IP, per connection)
[ ] Worker throttling: ignorovat flood od jednoho user_id
[ ] NATS limity per user: max_payload, max_subscriptions
[ ] JetStream limity: per-user job quota, TTL na status subjecty
[ ] Pinovat Docker image verze (zejména Valhalla :latest → konkrétní digest)
[ ] SSH: jen klíče, zakázat password login, Fail2ban

STŘEDNÍ (pro stabilní provoz):
[ ] Audit logging: login úspěch/neúspěch, admin akce, job creation, auth chyby
[ ] Monitoring: CPU/RAM/disk, WS připojení, JetStream storage, DB connections
[ ] Watchdog: Uptime Kuma nebo Prometheus + alerting
[ ] Automatické security updates na VPS
[ ] Kontejnery: non-root user, read-only FS, minimální capabilities
[ ] Zálohovací strategie pro PostgreSQL
[ ] Log rotation a archivace
[ ] Plán rotace JWT secret (výměna + invalidace sessions)
```

### 16.4 Síťová izolace: Docker Compose pro produkci

> Viz `infra/docker-compose.prod.yml`.

**Problém**: Na Linuxu Docker manipuluje s iptables a může obejít UFW/firewalld.
Porty publikované jako `ports: - "5432:5432"` jsou dostupné z internetu i při
zapnutém firewallu.

**Řešení**: Nepublikovat interní porty, nebo bindnout na `127.0.0.1`.
Služby komunikují přes interní Docker síť.

Klíčové rozdíly oproti dev konfiguraci:
- **Caddy** je jediná služba s publikovanými porty (80, 443)
- **Postgres, Nominatim, Valhalla** nemají publikované porty
- **NATS** nemá publikované porty (Caddy proxuje WS, worker jde přes docker net)
- Hesla jsou v `${PROMĚNNÁ}` čtená z `.env.prod` (mimo Git)
- Valhalla má **pinovanou verzi** (ne `:latest`)

### 16.5 Reverse proxy: Caddy konfigurace

> Viz `infra/Caddyfile`.

Aktuální konfigurace obsluhuje:
- `api.ariadline.com` — NATS WebSocket proxy (wss → ws na portu 8222)
- `monitor.ariadline.com` — NATS monitoring (basic auth, port 8223)

Statické soubory (ariadline.com, app.ariadline.com) jsou na Cloudflare Pages.
Caddy automaticky zajistí Let's Encrypt certifikát.

**Klíčové principy**:
- Z internetu je vidět POUZE port 443 (Caddy).
- HTTPS frontend se nemůže připojit k `ws://` (Mixed Content) → `wss://` je nutnost.
- CSP header omezuje WebSocket připojení jen na `app.ariadline.com`.

### 16.6 NATS autentizace a autorizace (ACL)

**Proč je to kritické**: Bez autentizace se kdokoliv může připojit k NATS WS a:
- `sub >` — poslouchat veškerou komunikaci všech uživatelů,
- `pub sazinka.jobs.geocode` — zahltit worker falešnými joby (DoS),
- `pub sazinka.customer.create` — vytvářet falešná data,
- injektovat falešné odpovědi frontendům.

**Cílový stav**: NATS Accounts + Permissions.

```conf
# infra/nats-server.prod.conf

server_name: sazinka-prod-1
port: 4222

websocket {
  port: 8222
  no_tls: true                  # TLS řeší Caddy (terminace na proxy)
  allowed_origins:
    - "https://sazinka.pages.dev"
    - "https://app.sazinka.cz"
}

jetstream {
  store_dir: "/data/jetstream"
  max_memory_store: 512MB
  max_file_store: 4GB
}

max_payload: 8MB
max_connections: 1000
http_port: 8223

# --- Autentizace a autorizace ---

accounts {
  # Backend worker: plný přístup
  WORKER {
    users: [
      { user: "worker", password: "$WORKER_NATS_PASSWORD" }
    ]
    jetstream: enabled
  }

  # Frontend klienti: omezený přístup
  FRONTEND {
    users: [
      { user: "browser", password: "$BROWSER_NATS_PASSWORD" }
    ]
    permissions: {
      # Smí publikovat jen request subjecty
      publish: {
        allow: [
          "sazinka.customer.*"
          "sazinka.revision.*"
          "sazinka.route.*"
          "sazinka.settings.*"
          "sazinka.crew.*"
          "sazinka.depot.*"
          "sazinka.device.*"
          "sazinka.jobs.*"
          "sazinka.auth.*"
          "_INBOX.>"                  # Reply subjecty pro request-reply
        ]
        deny: [
          ">"                         # Explicitní deny wildcard
        ]
      }
      # Smí subscribovat na vlastní odpovědi a job statusy
      subscribe: {
        allow: [
          "_INBOX.>"
          "sazinka.job.*.status.>"     # Status updates pro joby
        ]
        deny: [
          ">"
        ]
      }
    }
  }
}
```

**Implementační kroky**:
1. Worker se připojuje s credentials `worker`/heslo → plný přístup
2. Frontend se připojuje s credentials `browser`/heslo → omezený přístup
3. Postupně zpřesnit permissions per user (ne per role) pomocí NATS JWT/NKeys
4. Ideálně: worker ověřuje aplikační JWT v každé zprávě a vrací 401 při
   neplatném/expirovaném tokenu

**Poznámka k allowed_origins**: Nastavení `allowed_origins` v NATS WebSocket
bloku zabrání připojení z cizích domén (ochrana proti CSRF/cross-site útokům).
Povolte pouze domény vašeho frontendu.

### 16.7 Secrets management — SOPS + age

**Zásada**: Všechny secrets jsou šifrovány pomocí SOPS + age a uloženy v Gitu.
Žádná hesla se v plaintextu v repozitáři nenacházejí.

**Nástroje**:
- [SOPS](https://github.com/getsops/sops) — šifruje/dešifruje `.env` soubory
- [age](https://github.com/FiloSottile/age) — kryptografické klíče (místo GPG)

**Struktura**:
```
infra/secrets/
├── .gitignore              # *.dec nikdy do gitu
├── .env.dev.enc            # šifrované dev secrets (v gitu)
├── .env.staging.enc        # šifrované staging secrets (v gitu)
└── .env.production.enc     # šifrované production secrets (v gitu)

~/.config/sops/age/keys.txt # privátní klíč (NIKDY v gitu)
.sops.yaml                  # konfigurace — kdo smí co dešifrovat
```

**Denní workflow**:
```bash
# Dešifrovat secrets a spustit stack
make up ENV=dev

# Editovat secrets (otevře v $EDITOR, zašifruje při uložení)
make secrets-edit ENV=staging

# Po editaci commitnout šifrovaný soubor
git add infra/secrets/.env.staging.enc
git commit -m "rotate staging JWT_SECRET"

# Pouze dešifrovat (bez startu)
make secrets ENV=production

# Vyčistit dešifrované soubory
make secrets-clean
```

**Setup nového vývojáře**:
```bash
# 1. Nainstalovat nástroje
# Ubuntu: apt install age; stáhnout sops z GitHub releases
# macOS: brew install sops age

# 2. Vygenerovat klíčový pár
age-keygen -o ~/.config/sops/age/keys.txt
# Zaslat VEŘEJNÝ klíč (age1xxx...) vedoucímu projektu

# 3. Vedoucí přidá klíč do .sops.yaml a re-šifruje
sops updatekeys infra/secrets/.env.dev.enc
```

**Setup serveru (staging/production)**:
```bash
# 1. Nainstalovat age + sops na server
# 2. Vygenerovat klíč serveru
age-keygen -o /etc/sazinka/age-key.txt
chmod 400 /etc/sazinka/age-key.txt

# 3. Přidat veřejný klíč serveru do .sops.yaml (v repo)
# 4. Re-šifrovat: sops updatekeys infra/secrets/.env.production.enc

# 5. Na serveru při deploymentu:
export SOPS_AGE_KEY_FILE=/etc/sazinka/age-key.txt
make up ENV=production
```

**Rotace secrets**:
```bash
# 1. Editovat šifrovaný soubor
make secrets-edit ENV=production

# 2. Commitnout + pushnout
git add infra/secrets/.env.production.enc
git commit -m "security: rotate production secrets"
git push

# 3. Na serveru
git pull && make up ENV=production
# Worker se restartuje s novými secrets
```

**Odebírání přístupu**:
1. Odstranit veřejný klíč z `.sops.yaml`
2. `sops updatekeys` na všechny dotčené soubory
3. **Rotovat všechny secrets** ke kterým měl přístup
4. Commitnout + nasadit

### 16.8 Rate limiting a ochrana proti floodu

**Vrstva 1: Caddy reverse proxy**

```
# V Caddyfile přidat rate limiting
api.sazinka.cz {
    # Rate limit: max 100 požadavků/minutu per IP
    rate_limit {
        zone ws_limit {
            key {remote_host}
            events 100
            window 1m
        }
    }
    # ... zbytek konfigurace
}
```

**Vrstva 2: NATS limity per user**

```conf
# V nats-server.prod.conf, v accounts.FRONTEND:
permissions: {
  # ... publish/subscribe jak výše
}
# Limity:
max_payload: 1MB          # Browser nepotřebuje 8MB
max_subscriptions: 50     # Max otevřených subscriptions
```

**Vrstva 3: Worker throttling**

Worker by měl implementovat:
- Per-user rate limit na požadavky (max N požadavků/minutu per user_id)
- Job queue limits (max N aktivních geocoding jobů per user)
- Timeout na zpracování zprávy
- Ignorace duplicitních jobů (deduplikace)

### 16.9 VPS hardening

```bash
# --- SSH ---
# Zakázat password login, jen klíče:
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Fail2ban:
sudo apt install fail2ban
sudo systemctl enable fail2ban

# --- Firewall ---
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 443/tcp    # HTTPS (Caddy)
sudo ufw allow 80/tcp     # HTTP (ACME / redirect)
sudo ufw enable

# POZOR: Docker obchází UFW! Řešení:
# V /etc/docker/daemon.json:
{
  "iptables": false
}
# Nebo použít DOCKER-USER chain pro explicitní pravidla.

# --- Automatické security updates ---
sudo apt install unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# --- Deploy user ---
sudo useradd -m -s /bin/bash sazinka
sudo usermod -aG docker sazinka
```

### 16.10 Docker hardening

```yaml
# Doporučení pro docker-compose.prod.yml:

services:
  postgres:
    # Spouštět jako non-root (postgres image to dělá automaticky)
    security_opt:
      - no-new-privileges:true
    read_only: false            # Postgres potřebuje zápis

  nats:
    user: "1000:1000"           # Non-root
    security_opt:
      - no-new-privileges:true

  nominatim:
    security_opt:
      - no-new-privileges:true

  valhalla:
    # Pinovat image na konkrétní verzi!
    image: ghcr.io/gis-ops/docker-valhalla/valhalla:3.5.1
    security_opt:
      - no-new-privileges:true
```

### 16.11 Audit logging

Worker by měl logovat tyto security-relevantní události:

```
UDÁLOST                          LOG LEVEL    DETAIL
──────────────────────────────── ──────────── ──────────────────────
Login úspěšný                   INFO         user_id, IP, timestamp
Login neúspěšný                 WARN         email, IP, důvod
Token refresh                   INFO         user_id
Neplatný/expirovaný token       WARN         subject, IP
Admin akce                      INFO         user_id, akce, cíl
Vytvoření jobu                  DEBUG        user_id, job_type, job_id
Rate limit překročen            WARN         user_id/IP, subject
Neznámý/zakázaný subject        WARN         subject, IP
DB connection pool vyčerpán     ERROR        pool_size, waiting
```

### 16.12 Monitoring a alerting

Minimum pro testovací server:

```
METRIKA                          ALERT PŘI               NÁSTROJ
──────────────────────────────── ─────────────────────── ─────────────
HTTP/WSS dostupnost              downtime > 30s          Uptime Kuma
CPU usage                        > 90% po 5 min          node_exporter
RAM usage                        > 85%                   node_exporter
Disk usage                       > 80%                   node_exporter
NATS WS connections              > 500 nebo spike        NATS /connz
JetStream storage                > 3 GB (limit 4)        NATS /jsz
PostgreSQL connections           > 8 (pool max 10)       pg_stat_activity
Worker process running           not running             systemd watchdog
Nominatim status                 != 200                  Uptime Kuma
Valhalla status                  != 200                  Uptime Kuma
```

**Uptime Kuma** (self-hosted, doporučeno pro prototyp):

```yaml
# Přidat do docker-compose.prod.yml:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: sazinka-uptime
    volumes:
      - uptime_data:/app/data
    ports:
      - "127.0.0.1:3001:3001"   # Přístup jen lokálně / přes Caddy
    networks:
      - sazinka_net
    restart: unless-stopped
```

### 16.13 Worker jako systemd service (Linux) ~~NAHRAZENO~~

> **NAHRAZENO**: Worker nyní běží jako Docker kontejner.
> Viz §20 a `infra/docker-compose.prod.yml`.

### 16.14 Úplné schéma nasazení krok za krokem

```
1. Provisioning VPS (Hetzner/DigitalOcean/...)
   └─ Ubuntu 22.04+, min. 4 CPU / 16 GB RAM / 60 GB SSD

2. Základní hardening
   ├─ SSH klíče, zakázat password
   ├─ Fail2ban
   ├─ UFW (22 + 80 + 443)
   ├─ Automatické security updates
   └─ Deploy user (sazinka)

3. Instalace Docker + Docker Compose
   └─ Konfigurace iptables (viz sekce 16.9)

4. Klonování repozitáře
   └─ git clone → /opt/sazinka

5. Vytvoření .env.prod (mimo Git!)
   └─ Silná hesla, JWT secret, NATS credentials

6. Konfigurace produkčních souborů
   ├─ infra/docker-compose.prod.yml
   ├─ infra/nats-server.prod.conf
   └─ infra/Caddyfile

7. Start Docker služeb
   └─ docker compose --env-file .env.prod -f docker-compose.prod.yml up -d

8. Čekání na inicializaci
   ├─ PostgreSQL: ~10 sekund
   ├─ Nominatim: ~1-2 hodiny (první import)
   └─ Valhalla: ~5-15 minut (tile build)

9. Kompilace a start worker (release build)
   ├─ cargo build --release
   └─ systemctl start sazinka-worker

10. Seed dat (volitelně)
    └─ psql < seed-dev.sql (nebo produkční seed)

11. DNS nastavení
    ├─ api.sazinka.cz → IP serveru (backend API)
    ├─ sazinka.cz → CNAME na Cloudflare Pages (marketing)
    ├─ www.sazinka.cz → CNAME na Cloudflare Pages (marketing redirect)
    └─ app.sazinka.cz → CNAME na Cloudflare Pages (aplikace)

12. Nasazení marketingové části (Cloudflare Pages)
    ├─ Vytvořit projekt v Cloudflare Pages: "sazinka-site"
    ├─ Propojit s Git repozitářem (GitHub/GitLab)
    ├─ Build settings:
    │   ├─ Framework preset: Vite
    │   ├─ Build command: cd apps/site && pnpm install && pnpm build
    │   ├─ Build output directory: apps/site/dist
    │   └─ Root directory: / (monorepo)
    ├─ Environment variables: žádné (čistě statický)
    ├─ Custom domain: sazinka.cz + www.sazinka.cz
    └─ Optimalizace:
        ├─ Automatické minifikace (Cloudflare)
        ├─ Brotli komprese
        ├─ HTTP/3 + QUIC
        └─ Edge caching (CDN)

13. Nasazení aplikační části (Cloudflare Pages)
    ├─ Vytvořit projekt v Cloudflare Pages: "sazinka-app"
    ├─ Propojit s Git repozitářem
    ├─ Build settings:
    │   ├─ Framework preset: Vite
    │   ├─ Build command: cd apps/web && pnpm install && pnpm build
    │   ├─ Build output directory: apps/web/dist
    │   └─ Root directory: / (monorepo)
    ├─ Environment variables:
    │   └─ VITE_NATS_WS_URL=wss://api.sazinka.cz/nats
    └─ Custom domain: app.sazinka.cz

14. Ověření
    ├─ https://sazinka.cz
    │   ├─ Rychlost načtení (< 1s)
    │   ├─ Lighthouse score (> 90)
    │   └─ SEO meta tags
    ├─ https://app.sazinka.cz
    │   ├─ Login stránka se zobrazí
    │   ├─ WebSocket připojení (DevTools → Network → WS)
    │   └─ Funkční přihlášení
    ├─ https://api.sazinka.cz/monitor/healthz (s basic auth)
    └─ Monitoring check (Uptime Kuma)
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

### 17.8 NATS healthcheck selhává (unhealthy)

**Symptom:** `docker ps` ukazuje NATS jako `(unhealthy)`, Worker se nemůže připojit, frontend hlásí "Server is unavailable".

**Příčina:** NATS monitoring endpoint byl svázán na `127.0.0.1:8223`, což znemožňuje healthcheck z Docker containeru (musí být přístupný z `localhost` uvnitř containeru).

**Oprava:**
```bash
# infra/nats-server.conf — změnit řádek:
# BYLO: http: 127.0.0.1:8223
# JE:   http: 8223

# Restart NATS
docker restart sazinka-nats

# Ověřit healthcheck
docker ps --filter "name=sazinka-nats"  # mělo by zobrazit (healthy)
```

**Automatická oprava:** `start.ps1` nyní čeká na NATS healthcheck před spuštěním Workeru (podobně jako čeká na PostgreSQL).

### 17.9 `start.ps1` se zasekne nebo tiše spadne

**Symptom:** Skript vypíše Docker Compose výstup a pak se buď zasekne (zdánlivě
bez aktivity), nebo se tiše vrátí na prompt bez dokončení kroků 2–4.

**Příčina (opraveno 2026-02-18):** Kombinace tří bugů:

1. **`$ErrorActionPreference = "Stop"` + Docker Compose v2 stderr.** Docker
   Compose v2 zapisuje veškerý výstup (včetně varování typu
   `"No services to build"`) na stderr. PowerShell s `ErrorActionPreference`
   nastaveným na `Stop` konvertuje stderr na terminating error. Blok
   `try/finally` bez `catch` error přehodí po vykonání `finally` → skript spadne.

2. **ANSI escape kódy z Docker Compose** přepisují předchozí řádky terminálu,
   takže hlášky `[1/4] Spoustim Docker services...` a `Cekam na PostgreSQL...`
   zmizí z výstupu.

3. **Worker binárka natvrdo `target\release`** — i když build produkuje `target\debug`,
   řádek pro `Start-Process` používal hardkódovanou cestu `target\release`, takže worker
   se nespustil. Navíc se nenačítal `worker/.env`, worker padal bez DB připojení.

**Oprava:**
- `$ErrorActionPreference` změněn na `Continue`.
- Docker Compose se volá s `--progress plain 2>&1 | Write-Host` (potlačí ANSI kódy,
  sloučí stderr do stdout).
- Přidán `catch` blok.
- Worker se spouští z `$workerPath` (dynamicky debug/release) a před spuštěním se
  načte celý `worker/.env`.
- Health check smyčky vypisují tečky jako indikátor průběhu.

### 17.10 Worker selhává s "migration 1 was previously applied but has been modified"

**Symptom:** Worker crashuje při startu s chybou:
```
Error: migration 1 was previously applied but has been modified
```

**Příčina:** Git s `core.autocrlf=true` (Windows) konvertuje LF na CRLF při checkoutu. SQLx počítá checksumu z obsahu souboru na disku, takže:
- Migrace byla původně aplikována s LF line endings (checksum A)
- Po `git clone` na Windows má soubor CRLF (checksum B)
- Cargo build embeduje checksum B do binárky
- Binárka se snaží spustit migraci, ale DB má uložen checksum A → mismatch → crash

**Oprava (provedena 2026-02-17):**

1. **`.gitattributes`** — vynutí LF pro všechny `*.sql` soubory, bez ohledu na platformu nebo `git autocrlf`:
```
*.sql text eol=lf
```

2. **`worker/src/db/mod.rs`** — před spuštěním migrací automaticky opraví stored checksumy, pokud se liší:
```rust
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    let migrator = sqlx::migrate!("./migrations");
    fix_migration_checksums(pool, &migrator).await?;  // Auto-fix checksum mismatches
    migrator.run(pool).await?;
    Ok(())
}
```

Funkce `fix_migration_checksums()` porovná embedované checksumy (z aktuální binárky) s uloženými checksumy v DB. Pokud se liší (typicky kvůli CRLF/LF rozdílu), automaticky updatuje DB na správnou hodnotu a loguje warning.

**Výsledek:** Worker se nyní spustí bez chyby, i když byla migrace původně aplikována s jinými line endings než má aktuální soubor na disku.

### 17.11 Worker selhává s "migration N was previously applied but is missing in the resolved migrations"

**Symptom:** Worker crashuje při startu s chybou:
```
Error: migration 12 was previously applied but is missing in the resolved migrations
```

**Příčina:** Tabulka `_sqlx_migrations` v PostgreSQL obsahuje záznamy o migracích,
jejichž soubory byly mezitím smazány (sloučeny do `001_initial_schema.sql`). Macro
`sqlx::migrate!` embeduje seznam migračních souborů do binárky za kompilace. Pokud
se soubory na disku neshodují s tím, co je v DB, migrátor odmítne pokračovat.

**Oprava (2026-02-18):**

`worker/src/db/mod.rs` → `run_migrations()` před voláním `migrator.run()`:
1. Loguje zkompilované verze a DB verze (diagnostika).
2. `remove_orphaned_migrations()` smaže z `_sqlx_migrations` řádky, jejichž
   version není v seznamu zkompilovaných migrací.
3. `fix_migration_checksums()` opraví checksumové neshody (CRLF/LF).

```
Compiled migration versions: [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 15, ...]
DB applied migration versions: [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 15, ...]
```

**Důležité:** Po přidání/odebrání migračních souborů je nutné udělat `cargo clean -p sazinka-worker && cargo build`, aby se `sqlx::migrate!` macro přegenerovalo. Samotný `cargo build` může použít cache a nový soubor se do binárky nedostane.

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

---

## 19. Cross-platform vývoj: Windows + Linux

> **Stav**: Produkce běží výhradně na Linuxu (Docker). Windows slouží jen pro lokální vývoj.

### Platformní souhrn

| Aspekt | Windows | Linux |
|---|---|---|
| Skripty | `start.ps1`, `stop.ps1`, `start.bat`, `stop.bat` | `start.sh`, `stop.sh` (plánováno) |
| Rust target | `stable-x86_64-pc-windows-msvc` | `stable-x86_64-unknown-linux-gnu` |
| C linker | MSVC (Visual Studio) | GCC (`build-essential`) |
| TLS backend | `rustls` (pure Rust) | `rustls` (pure Rust) |
| Docker Compose | `docker-compose` (V1, Docker Desktop) | `docker compose` (V2 plugin) |
| Frontend | pnpm + Vite — cross-platform | totéž |

### Linux prerekvizity

```bash
sudo apt install -y build-essential pkg-config curl git
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Node.js + pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs && npm install -g pnpm
# Docker
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

### Co se nemění

- `infra/docker-compose.yml` — cross-platform, beze změn
- `worker/Cargo.toml` dependencies — cross-platform
- Frontend stack — plně cross-platform
- SQL migrace — cross-platform (`.gitattributes` zajišťuje LF)

---

## 16. Deployment Ariadline Marketing Site (Cloudflare Pages)

> Marketing web `ariadline.com` je nasazený na Cloudflare Pages jako statický Astro site.

### Konfigurace

| Aspekt | Hodnota |
|---|---|
| **CF Pages projekt** | `ariadline-site` |
| **Build command** | `cd apps/site && pnpm build` |
| **Build output** | `apps/site/dist` |
| **Production branch** | `master` |
| **Custom domain** | `ariadline.com`, `www.ariadline.com` |
| **D1 Database** | `ariadline-site-db` (contacts, newsletter_subscribers) |

### Environment Variables (Production)

| Variable | Účel |
|---|---|
| `RESEND_API_KEY` | Transakční e-maily (Resend) |
| `TURNSTILE_SECRET_KEY` | Spam ochrana (Cloudflare Turnstile) |
| `NODE_VERSION` | `22` |

### Služby třetích stran

- **Resend**: Transakční e-maily (kontaktní formulář, newsletter confirmation). DNS: SPF + DKIM + DMARC.
- **Cloudflare Turnstile**: CAPTCHA pro formuláře (Managed/Invisible widget).
- **Umami**: Privacy-first analytics (page views, referrers, devices, countries).

### GitHub Actions Secrets

| Secret | Účel |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Deploy do Pages |
| `CLOUDFLARE_ACCOUNT_ID` | Deploy do Pages |
| `NATS_BROWSER_PASSWORD` | Vite zapéká do SPA bundlu |

### Post-Deployment Checklist

- [ ] Web se načte na `https://ariadline.com`
- [ ] Všechny 3 jazyky fungují (`/en/`, `/cs/`, `/sk/`)
- [ ] Root `/` vrací 302 redirect (edge function)
- [ ] Kontaktní formulář + newsletter fungují
- [ ] D1 databáze ukládá data
- [ ] Resend odesílá e-maily
- [ ] Turnstile brání spamu
- [ ] Umami trackuje page views

### Troubleshooting

- **Build selhává**: Zkontrolovat Node verze (22) + pnpm + build logy v Pages dashboardu.
- **Formuláře nefungují**: Ověřit `RESEND_API_KEY`, D1 binding v `wrangler.toml`, Functions logy.
- **E-maily se neodesílají**: Ověřit Resend doménu + SPF/DKIM/DMARC záznamy.
- **Rollback**: Pages → ariadline-site → Deployments → "Rollback to this deployment".

---

## 20. Containerizace Rust Workeru ✅ IMPLEMENTOVÁNO

> Worker běží jako Docker kontejner. Image se builduje v CI (GitHub Actions) a nasazuje
> přes `docker compose pull && docker compose up -d`. Na VPS není potřeba Rust toolchain.
> GHCR image je **private**, nasazení používá **immutable tag** (`<git-sha>`).

### 20.1 Cílová architektura (3 tiers)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE                                      │
│                                                                         │
│  ┌─────────────────────────┐    ┌──────────────────────────────────┐   │
│  │ Cloudflare Pages        │    │ Cloudflare Pages                 │   │
│  │ "ariadline-site"        │    │ "ariadline-app"                  │   │
│  │                         │    │                                  │   │
│  │ ariadline.com           │    │ app.ariadline.com                │   │
│  │ www.ariadline.com       │    │                                  │   │
│  │                         │    │ Build env:                       │   │
│  │ Build: apps/site        │    │   VITE_NATS_WS_URL=             │   │
│  │ Čistě statický          │    │   wss://api.ariadline.com/nats  │   │
│  │ Žádné WebSockety        │    │                                  │   │
│  └─────────────────────────┘    └──────────────────────────────────┘   │
│                                                                         │
│  CDN edge caching, Brotli, HTTP/3, automatic SSL                       │
└─────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ wss://api.ariadline.com/nats
                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    HETZNER VPS (api.ariadline.com)                       │
│                    Ubuntu 24.04, 8 vCPU / 16 GB RAM                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Docker Compose (infra/docker-compose.prod.yml)                 │   │
│  │                                                                 │   │
│  │  ┌───────┐ ┌──────────────┐ ┌──────────┐ ┌─────────────────┐  │   │
│  │  │ Caddy │ │    NATS      │ │ Postgres │ │   Worker        │  │   │
│  │  │:80/443│ │ :4222 native │ │  :5432   │ │ sazinka-worker  │  │   │
│  │  │       │ │ :8222 ws     │ │          │ │ (GHCR image)    │  │   │
│  │  │       │ │ :8223 mon    │ │          │ │                 │  │   │
│  │  └───────┘ └──────────────┘ └──────────┘ └─────────────────┘  │   │
│  │  ┌─────────────┐ ┌────────────────────┐                       │   │
│  │  │  Nominatim  │ │     Valhalla       │                       │   │
│  │  │   :8080     │ │      :8002         │                       │   │
│  │  │  geocoding  │ │     routing        │                       │   │
│  │  └─────────────┘ └────────────────────┘                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Tailscale (WireGuard mesh VPN) — SSH management, CI/CD deploy          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 20.2 Klíčové soubory

| Soubor | Účel |
|---|---|
| `worker/Dockerfile` | Multi-stage build (planner → builder → runtime) |
| `infra/docker-compose.prod.yml` | Produkční compose se všemi službami |
| `infra/Caddyfile` | Reverse proxy (NATS WS + monitoring) |
| `.github/workflows/ci.yml` | CI: testy + audit + GHCR build |
| `.github/workflows/deploy.yml` | Manuální deploy (workflow_dispatch) |

### 20.3 Deployment flow

```
Push do master → GitHub Actions CI:
  1. Testy (cargo test, clippy, pnpm typecheck)
  2. Security audit (cargo-audit, trivy, gitleaks)
  3. Build + push worker image → GHCR (tag: <git-sha>)
  → STOP (žádný automatický deploy)

Manuální deploy (workflow_dispatch):
  1. migrate-db: Docker run worker:migrate via Tailscale SSH
  2. deploy-worker: pull + up -d via Tailscale SSH
  3. deploy-site/app: npx wrangler pages deploy
  4. smoke-test: curl health checks
```

Zero-downtime restart: JetStream garantuje at-least-once delivery.
Rollback: `WORKER_VERSION=<older-sha> docker compose up -d --no-deps worker`.

### 20.4 Stavové služby a ochrana volumes

**Stateful** (trvalý volume, chráněné):
- **Postgres** (`postgres_data`) — business data
- **Nominatim** (`nominatim_data`) — geodata ČR (~2 GB, rebuild ~2 hodiny)
- **Valhalla** (`valhalla_tiles`) — routing tiles (~8 GB, rebuild ~15 minut)
- **NATS JetStream** (`nats_jetstream`) — nevyřízené async joby

**Stateless** (bez trvalého stavu): Worker, Caddy

**Zakázané operace v běžném deployi:**
- `docker compose down -v`, `docker volume rm`, `docker system prune --volumes`

**Refresh geodat** (maintenance, ne deploy): explicitní schválení → snapshot →
rebuild → health check → rollback při problému.

---

## 21. TDD implementační plán — Containerizace Workeru ✅ IMPLEMENTOVÁNO

> Všech 11 fází dokončeno (rustls, CLI --migrate, Dockerfile, .dockerignore,
> docker-compose.prod.yml, Caddyfile, PG role, GitHub Actions, e2e test,
> VPS deploy, dokumentace cleanup). Detaily viz git historie.

---

## 22. Docker Deployment Rules — Checklist

Source: [Docker Best Practices for Production](https://www.youtube.com/watch?v=ueTe-VQaD7c&t=5s)

Pravidla pro všechny Dockerfiles a docker-compose soubory v projektu.
Viz také `PRJ_RULES.MD` sekce "Docker / Deployment".

| # | Pravidlo | Stav | Poznámka k implementaci |
|---|----------|------|-------------------------|
| 1 | Minimal base images | ✅ | `debian:bookworm-slim` v runtime stage |
| 2 | Multi-stage builds | ✅ | 3 stages: planner → builder → runtime |
| 3 | Derive version from project | ✅ | Git SHA tag z CI (`${{ github.sha }}`), OCI labels z `docker/metadata-action` |
| 4 | Cache Docker layers | ✅ | `cargo-chef`: deps compiled separately, cached until Cargo.toml changes |
| 5 | Combine/chain RUN, clean caches | ✅ | Single RUN: apt-get + rm lists + groupadd + useradd + mkdir |
| 6 | Explicit COPY of specific files | ✅ | Only `worker/` and `packages/`; `.dockerignore` excludes rest |
| 7 | Production dependencies only | ✅ | `--release` build; no dev deps in runtime |
| 8 | Non-root user | ✅ | `USER sazinka` (UID 999) |
| 9 | Pin image versions | ✅ | `rust:1.93-slim-bookworm` (ARG); Valhalla pinned by SHA digest |
| 10 | Official images only | ✅ | `rust`, `debian`, `postgres`, `nats`, `caddy` all official |
| 11 | No secrets in image | ✅ | `.dockerignore` excludes `.env`; secrets via env vars at runtime |
| 12 | No sudo | ✅ | Not installed |
| 13 | Minimal packages | ✅ | Only `ca-certificates` in runtime (required for rustls CA bundle) |
| 14 | COPY over ADD | ✅ | All COPY, zero ADD |
| 15 | No debugging tools | ✅ | No procps/curl/vim; healthcheck uses `/proc/1/status` |
| 16 | Executables owned by root | ✅ | `COPY --chown=root:root` for binary; `USER sazinka` for execution |
| 17 | Sort arguments alphabetically | ✅ | Single package (`ca-certificates`) — trivially sorted |
| 18 | Use WORKDIR | ✅ | `/app/worker` for build, `/opt/sazinka` for runtime |
| 19 | Exec form for CMD | ✅ | `CMD ["sazinka-worker"]` |
| 20 | Comment non-obvious decisions | ✅ | SQLX_OFFLINE, build context, ca-certificates purpose documented |
| 21 | OCI labels | ✅ | `LABEL org.opencontainers.image.*` in Dockerfile + CI metadata-action |

---

## 23. Manual Deployment Runbook — First-Time Setup

> **Kdy použít**: Poprvé nasazujeme na čistý server. Po tomto setupu se vše
> spravuje přes CI/CD pipeline (sekce 24). Tento dokument slouží i jako
> disaster recovery playbook.

### 23.1 Přehled cílové infrastruktury

```
┌─────────────────────────────────────────────────────────┐
│  Cloudflare                                             │
│  ┌───────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ariadline.com  │  │app.ariadline.com│  │ DNS + Proxy │ │
│  │ Pages (site)  │  │  Pages (app)    │  │ for api.*   │ │
│  └───────────────┘  └─────────────────┘  └──────┬──────┘ │
└───────────────────────────────────────────────┬────────┘
                                                │ HTTPS
┌───────────────────────────────────────────────▼────────┐
│  Hetzner VPS (ariadline-prod)                          │
│  ┌───────┐ ┌──────┐ ┌────────┐ ┌─────────┐ ┌───────┐ │
│  │ Caddy │ │ NATS │ │Postgres│ │Valhalla │ │Nomin. │ │
│  │:80/443│ │:4222 │ │ :5432  │ │ :8002   │ │ :8080 │ │
│  └───┬───┘ └──┬───┘ └───┬────┘ └────┬────┘ └───┬───┘ │
│      │        │         │           │          │      │
│  ┌───▼────────▼─────────▼───────────▼──────────▼────┐ │
│  │           sazinka_net (Docker bridge)             │ │
│  │  ┌───────────────────┐  ┌───────────────────────┐  │ │
│  │  │ prod: worker, etc.│  │ staging: worker, etc. │  │ │
│  │  └───────────────────┘  └───────────────────────┘  │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  Tailscale (WireGuard mesh VPN)                 │  │
│  │  SSH management + CI/CD deploy (no public :22)  │  │
│  └─────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────┘

GitHub Actions CI ── tailscale/github-action ──▶ VPS (Tailscale SSH)
Your machine   ──── Tailscale client ──────────▶ VPS (Tailscale SSH)
```

### 23.2 Prerekvizity

Před zahájením potřebujete:
- [ ] Hetzner Cloud účet s platební metodou
- [ ] Cloudflare účet (free tier stačí)
- [ ] Domény `ariadline.cz` a `ariadline.com` s nameservery nastavenými na Cloudflare
- [ ] GitHub účet s přístupem k repozitáři `Oslicek/Sazinka`
- [ ] Tailscale účet (stejný tailnet jako dev server na Hostingeru)
- [ ] Tailscale OAuth client pro CI/CD (viz krok 10)
- [ ] SSH klíč (ed25519) pro **iniciální** setup — `ssh-keygen -t ed25519 -C "setup@ariadline"`
  - Po instalaci Tailscale (krok 2) se SSH klíč přestane používat
- [ ] Lokálně nainstalovaný `sops` + `age` pro správu secrets

### 23.3 Krok 1: Vytvoření VPS na Hetzner

1. Přihlásit se do [Hetzner Cloud Console](https://console.hetzner.cloud/)
2. Vytvořit nový projekt "Ariadline"
3. Vytvořit server:
   - **Location**: Falkenstein (eu-central, nejblíže k CZ)
   - **Image**: Ubuntu 24.04
   - **Type**: CPX41 (8 vCPU, 16 GB RAM) — Nominatim+Valhalla+NoMachine/Cursor
   - **Networking**: přidat IPv4 + IPv6
   - **SSH key**: nahrát deploy klíč
   - **Name**: `ariadline-prod`
4. Poznamenat si IP adresu serveru → `VPS_HOST`

### 23.3a Krok 1a: Hetzner Cloud Firewall

Firewall na úrovni hypervisoru — traffic je zahozen dříve, než dorazí na VPS.
Funguje jako první vrstva obrany společně s UFW uvnitř OS (defense in depth).

1. V Hetzner Cloud Console → **Firewalls** → **Create Firewall**
2. Název: `ariadline-prod-fw`
3. **Inbound Rules**:

| Popis | Protokol | Port | Zdroj |
|---|---|---|---|
| HTTP | TCP | 80 | Any IPv4, Any IPv6 |
| HTTPS | TCP | 443 | Any IPv4, Any IPv6 |
| HTTP/3 | UDP | 443 | Any IPv4, Any IPv6 |
| NATS WebSocket | TCP | 8222 | Any IPv4, Any IPv6 |
| Tailscale | UDP | 41641 | Any IPv4, Any IPv6 |
| Ping | ICMP | — | Any IPv4, Any IPv6 |

4. **Outbound Rules**: žádné (vše povoleno implicitně). Smazat prázdné pravidlo, pokud ho UI vytvoří.
5. **Apply to**: `ariadline-prod`
6. Vytvořit firewall

> **Důležité**: Port 22 (SSH) NENÍ povolen — veškerý SSH přístup jde přes Tailscale (UDP 41641).
> Po vytvoření ověřit, že Tailscale SSH stále funguje: `ssh sazinka@ariadline-prod`.

### 23.4 Krok 2: Základní zabezpečení VPS

```bash
# Připojit se jako root (iniciální přístup přes veřejnou IP)
ssh root@<VPS_HOST>

# --- Aktualizace systému ---
apt update && apt upgrade -y

# --- Vytvořit deploy uživatele (BEZ sudo) ---
adduser --disabled-password --gecos "" sazinka
# Žádný sudo — snižuje blast radius při kompromitaci CI nebo Tailscale SSH.

# --- Nainstalovat Tailscale ---
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh --hostname ariadline-prod
# Autorizovat node v Tailscale admin console nebo přes zobrazený URL.
# --ssh flag zapne Tailscale SSH (žádné SSH klíče, autentizace přes Tailscale identity).

# Ověřit připojení — poznamenat si Tailscale IP → VPS_TAILSCALE_IP
tailscale ip -4

# --- Firewall (UFW) ---
# Port 22 NENÍ otevřen — veškerý SSH jde přes Tailscale (UDP 41641).
ufw default deny incoming
ufw default allow outgoing
ufw allow 80/tcp        # HTTP (Caddy redirect)
ufw allow 443/tcp       # HTTPS (Caddy)
ufw allow 443/udp       # HTTP/3
ufw allow 8222/tcp      # NATS WebSocket (browser)
# Důležité: nepovolovat celé tailscale0. Povolit jen konkrétní management port.
ufw allow in on tailscale0 to any port 22 proto tcp   # Tailscale SSH only
ufw enable

# --- Zakázat veřejný SSH úplně ---
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
# SSH na veřejné IP je blokovaný UFW, ale pro jistotu zamkneme i sshd.
systemctl restart sshd

# *** OD TEĎTO SE PŘIPOJOVAT JEN PŘES TAILSCALE: ***
# ssh sazinka@ariadline-prod   (Tailscale hostname)
# ssh sazinka@<VPS_TAILSCALE_IP>

# --- Nainstalovat Docker ---
apt install -y docker.io docker-compose-plugin
usermod -aG docker sazinka

# --- Fail2ban ---
apt install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# --- Automatické bezpečnostní aktualizace ---
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

> **Tailscale SSH**: Díky `--ssh` flagu Tailscale zpřístupní SSH přes svůj
> WireGuard tunel. Přístup se řídí Tailscale ACLs — žádné SSH klíče na serveru.
> Stejný model jako dev server na Hostingeru.

### 23.4a NoMachine + Cursor IDE na serveru

Plán: připojit se přes NoMachine (remote desktop) via Tailscale a spouštět Cursor IDE přímo na VPS.

**Doporučení**:
- **NoMachine přes Tailscale** — v pořádku. Latence a bandwidth jsou obvykle dostačující.
- **Cursor na 16 GB VPS** — v pořádku. Nominatim, Valhalla a Postgres zůstávají pod 10 GB; Cursor (1–2 GB) má dostatek místa.
- **Bezpečnostní riziko** — Cursor odesílá kód do AI. Při otevření `.env.prod`, `MIGRATION_DB_URL` či dalších secrets hrozí jejich odeslání do modelu. **Nepoužívat Cursor na citlivých souborech** (`.env.*`, DB dumpy). Lepší: Cursor na lokálním stroji + Remote-SSH/remote edit, nebo oddělit adresáře (např. `/opt/sazinka` jen pro čtení v Cursoru).
- **Alternativa** — pro rychlé úpravy konfigurace stačí NoMachine + obyčejný editor (vim, nano) nebo VS Code (lehčí než Cursor). Pro AI asistované editace preferovat lokální Cursor s Remote-SSH.

### 23.5 Krok 3: Deploy repozitáře na VPS

```bash
# Přepnout na deploy uživatele
su - sazinka

# Klonovat repozitář
git clone git@github.com:Oslicek/Sazinka.git ~/sazinka
cd ~/sazinka

# Vytvořit .env.prod (nové produkční secrets!)
# NIKDY nekopírovat dev secrets do produkce!
cat > .env.prod << 'ENVEOF'
WORKER_VERSION=<GIT_SHA_PRVNÍHO_BUILDU>
POSTGRES_USER=sazinka
POSTGRES_PASSWORD=<openssl rand -base64 32>
POSTGRES_DB=sazinka
JWT_SECRET=<openssl rand -base64 48>
NATS_WORKER_PASSWORD=<openssl rand -base64 24>
NATS_BROWSER_PASSWORD=<openssl rand -base64 24>
NOMINATIM_PASSWORD=<openssl rand -base64 24>
MONITOR_PASSWORD_HASH=<viz krok níže>
ADMIN_EMAIL=vas@email.cz
ADMIN_PASSWORD_HASH=<viz krok níže>
RUST_LOG=info,sazinka_worker=info
ENVEOF

# Vygenerovat monitor heslo (zapamatovat si plaintext pro přihlášení)
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'VašeMonitorHeslo'
# Výstup ($2a$14$...) vložit do .env.prod jako MONITOR_PASSWORD_HASH
# POZOR: $ znaky v .env.prod escapovat jako $$

# Vygenerovat admin heslo (Argon2)
apt install -y argon2
echo -n "VaseAdminHeslo123!" | argon2 "$(openssl rand -base64 16)" -id -e
# Výstup vložit do .env.prod jako ADMIN_PASSWORD_HASH
# POZOR: $ znaky v .env.prod escapovat jako $$

chmod 600 .env.prod
```

### 23.6 Krok 4: Upravit volumes pro čistý server

Na čistém serveru neexistují `infra_*` volumes. Upravit
`infra/docker-compose.prod.yml` — odebrat `external: true` a `name:`
u volumes `postgres_data`, `nats_jetstream`, `valhalla_tiles`, `nominatim_data`.

Alternativně vytvořit volumes ručně:
```bash
docker volume create infra_postgres_data
docker volume create infra_nats_jetstream
docker volume create infra_valhalla_tiles
docker volume create infra_nominatim_data
```

### 23.7 Krok 5: Build a první spuštění worker image

```bash
cd ~/sazinka

# Build worker image lokálně na VPS (první build, CI ještě neběží)
docker build -t ghcr.io/oslicek/sazinka-worker:initial -f worker/Dockerfile .

# Aktualizovat .env.prod
sed -i 's/^WORKER_VERSION=.*/WORKER_VERSION=initial/' .env.prod

# Spustit celý stack
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d

# Sledovat start (Nominatim: ~2 hodiny, Valhalla: ~30 minut)
docker compose -f infra/docker-compose.prod.yml logs -f
```

### 23.8 Krok 6: Ověření zdraví stacku

```bash
# Všechny služby healthy?
docker ps --format 'table {{.Names}}\t{{.Status}}'

# Worker: migrace proběhly?
docker logs sazinka-worker 2>&1 | grep "Migrations complete"

# Worker: připojení k NATS?
docker logs sazinka-worker 2>&1 | grep "Connected to NATS"

# Postgres: role existují?
docker exec sazinka-postgres psql -U sazinka -d sazinka \
  -c "SELECT rolname FROM pg_roles WHERE rolname IN ('sazinka_admin','sazinka_app');"

# Caddy: TLS certifikáty získány?
docker logs sazinka-caddy 2>&1 | grep "certificate obtained"
```

### 23.8a Krok 6a: Staging stack na stejném serveru

Staging běží na stejném VPS jako produkce. Sdílí Postgres instanci (jiná databáze),
NATS, Nominatim a Valhalla. Samostatný worker a Caddy vhosty.

```bash
# Jako root nebo sazinka (docker group)
cd ~/sazinka

# Vytvořit .env.staging (oddělené secrets!)
cp .env.prod .env.staging
# Upravit: WORKER_VERSION, POSTGRES_DB=sazinka_staging, jiné hesla, RUST_LOG=debug

# Vytvořit staging DB
docker exec sazinka-postgres psql -U sazinka -c "CREATE DATABASE sazinka_staging;"

# Spustit staging stack (jiný project name)
docker compose -p ariadline-staging --env-file .env.staging \
  -f infra/docker-compose.staging.yml up -d
```

Potřebný `infra/docker-compose.staging.yml` — odvozený od prod, ale:
- jiný project/container prefix (`ariadline-staging`)
- `POSTGRES_DB=sazinka_staging`
- Caddy route pro `api-staging.ariadline.cz`, `app-staging.ariadline.cz`
- NATS: sdílený nebo oddělené credentials podle potřeby

DNS (Cloudflare): přidat `api-staging.ariadline.cz` → `<VPS_HOST>` (Proxy OFF).

### 23.9 Krok 7: Cloudflare Pages — ariadline.com (marketing site)

1. Přihlásit se do [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
   - Pozor: vybrat záložku **Pages**, ne Workers. Workers setup ukazuje "Deploy command: npx wrangler deploy" a "API token" — to je špatná volba.
3. Nastavení:
   - **Repository**: `Oslicek/Sazinka`
   - **Project name**: `ariadline-site`
   - **Production branch**: `master`
   - **Build command**: `pnpm install --frozen-lockfile && pnpm --filter @ariadline/site build`
   - **Build output directory**: `apps/site/dist`
   - **Root directory**: `/` (monorepo root — pnpm workspace)
   - **Framework preset**: Astro
4. **Environment variables**:
   - nic speciálního (site je statický)
5. Kliknout **Save and Deploy**
6. Po dokončení buildu — **Custom domains** → přidat `ariadline.com` a `www.ariadline.com`
   - `ariadline.cz` a `www.ariadline.cz` budou přesměrovávat na `.com` (viz krok 9)

#### Omezení přístupu před spuštěním (Cloudflare Access)

Dokud není site připraven pro veřejnost, omezit přístup přes Cloudflare Zero Trust:

1. **Zero Trust** → **Access** → **Applications** → **Add an application**
2. Typ: **Self-hosted**
3. Přidat **dva** doménové záznamy (oba jsou nutné):
   - `ariadline-site.pages.dev` (hlavní produkční URL)
   - `*.ariadline-site.pages.dev` (preview deploymenty)
   - **Důležité**: wildcard `*` nepokrývá bare doménu — je nutné přidat obě varianty.
4. Vytvořit policy (např. "Ariadline Testing"):
   - **Action**: Allow
   - **Session duration**: 24 hours
   - **Include** → Selector: Emails → přidat povolené e-maily
5. Po připojení custom domény (`ariadline.com`) přidat i tu do Application domains.
6. Až bude site připraven pro veřejnost — smazat Access application.

> **Manuální deploy**: Výchozí nastavení CF Pages builduje na každý push na production branch.
> Pro manuální deploy: vypněte "Build on push" nebo používejte výhradně API pro spuštění buildu
> z deploy workflow. Viz sekce 24.10.

### 23.10 Krok 8: Cloudflare Pages — app.ariadline.com (SPA)

1. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Nastavení:
   - **Repository**: `Oslicek/Sazinka`
   - **Project name**: `ariadline-app`
   - **Production branch**: `master`
   - **Build command**: `pnpm install --frozen-lockfile && cd apps/web && npx vite build` (používáme přímo vite build, abychom přeskočili tsc check, který by mohl selhat na type errorec)
   - **Build output directory**: `apps/web/dist`
   - **Root directory**: `/`
   - **Framework preset**: None (Vite)
3. **Environment variables** (Production):
   - `VITE_NATS_WS_URL` = `wss://api.ariadline.com/nats`
   - `VITE_NATS_USER` = `browser`
   - `VITE_NATS_PASS` = `<NATS_BROWSER_PASSWORD z .env.prod>`
   - *Poznámka: Proměnné musí být nastaveny před prvním buildem, Vite je zapéká do kódu.*
4. Kliknout **Save and Deploy**
5. **Custom domains** → přidat `app.ariadline.com`

#### Vytvoření prvního Admin uživatele

Jelikož v produkci nefunguje lokální seed skript a maily zatím nechodí, je potřeba admina založit takto:

1. Vygenerovat Argon2 hash hesla na serveru:
   ```bash
   apt install -y argon2
   echo -n "VaseHeslo123!" | argon2 "$(openssl rand -base64 16)" -id -e
   ```
2. Přidat do `.env.prod`:
   ```env
   ADMIN_EMAIL=vas@email.cz
   ADMIN_PASSWORD_HASH=$$argon2id$$... (pozor: všechny $ znaky v hashi musí být zdvojené na $$ kvůli Docker Compose!)
   ```
3. Restartovat worker: `docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d worker`
4. Přihlásit se do aplikace a projít onboardingem (založení firmy).
5. Pokud onboarding selže kvůli chybějícímu ověření e-mailu, ověřit ho ručně v DB:
   ```bash
   docker exec sazinka-postgres psql -U sazinka -d sazinka -c "UPDATE users SET email_verified = true WHERE email = 'vas@email.cz';"
   ```

**Staging app** (volitelné, pro manuální deploy):
- Projekt `ariadline-app-staging`, build z branch `staging` nebo `master`
- Custom domain: `app-staging.ariadline.com`
- `VITE_NATS_WS_URL` = `wss://api-staging.ariadline.com/nats`

### 23.11 Krok 9: Cloudflare DNS pro VPS

1. **DNS** → **Records** → přidat (na doméně `ariadline.com`):
   - `api.ariadline.com` → A record → `<VPS_HOST>` → Proxy: OFF (grey cloud)
   - `monitor.ariadline.com` → A record → `<VPS_HOST>` → Proxy: OFF
   - `api-staging.ariadline.com` → A record → `<VPS_HOST>` → Proxy: OFF (staging)
   - Proxy OFF protože Caddy řeší TLS sám přes Let's Encrypt

> **Důležité**: Pro `api.*`, `api-staging.*` a `monitor.*` proxy vypnout (grey cloud),
> aby Caddy mohl získat Let's Encrypt certifikáty.
> Pro `ariadline.com` a `app.ariadline.com` proxy zapnout (orange cloud) — to
> řeší Cloudflare Pages automaticky.
> `ariadline.cz` bude přesměrovávat na `ariadline.com` (Cloudflare Redirect Rules).

### 23.12 Krok 10: Tailscale OAuth client pro CI/CD

1. Přihlásit se do [Tailscale Admin Console](https://login.tailscale.com/admin/settings/oauth)
2. **Settings** → **OAuth clients** → **Generate OAuth client**
3. Nastavení:
   - **Description**: `GitHub Actions CI/CD`
   - **Scopes**: `devices:write` (pro vytváření ephemeral nodes)
   - **Tags**: `tag:ci` (musí být definovaný v ACLs — viz níže)
4. Zkopírovat **Client Secret** → `TAILSCALE_OAUTH_CLIENT_SECRET`

**Tailscale ACL pravidla** (přidat do ACL editoru v admin console):

```jsonc
{
  "tagOwners": {
    "tag:ci": ["autogroup:admin"]
  },
  "acls": [
    // CI runner může SSH na prod server
    { "action": "accept", "src": ["tag:ci"], "dst": ["ariadline-prod:22"] }
  ],
  "ssh": [
    // CI runner se připojuje jako user "sazinka" na prod
    {
      "action": "accept",
      "src": ["tag:ci"],
      "dst": ["ariadline-prod"],
      "users": ["sazinka"]
    }
  ]
}
```

### 23.13 Krok 11: GitHub Secrets pro CI/CD

V repozitáři `Settings` → `Secrets and variables` → `Actions` → přidat:

| Secret | Hodnota | Popis |
|--------|---------|-------|
| `TAILSCALE_OAUTH_CLIENT_ID` | OAuth client ID z kroku 10 | Spárování s OAuth secret |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | OAuth client secret z kroku 10 | Tailscale auth pro CI runner |
| `VPS_TAILSCALE_IP` | Tailscale IP VPS (100.x.y.z) | Cíl pro SSH deploy |
| `VPS_SSH_KNOWN_HOSTS` | SSH host key z `ssh-keyscan` | Ochrana proti MITM při CI SSH |
| `GHCR_TOKEN` | GitHub PAT (packages:write) | Pro push/pull Docker image |
| `MIGRATION_DB_URL` | `postgres://sazinka_admin:<heslo>@postgres:5432/sazinka` | DB URL pro migrační kontejner |
| `CF_API_TOKEN` | Cloudflare API token | S oprávněním: Pages:Edit |
| `CF_ACCOUNT_ID` | Cloudflare Account ID | Na stránce Overview |

> **Oproti klasickému SSH**: Žádné `VPS_SSH_KEY` — Tailscale řeší autentizaci.
> Žádná veřejná IP jako secret — server je dostupný jen přes Tailscale.
> `VPS_SSH_KNOWN_HOSTS` ale ponechat — je to obrana proti man-in-the-middle útoku.

Naplnění `VPS_SSH_KNOWN_HOSTS` (spustit z důvěryhodného stroje připojeného do tailnetu):
```bash
ssh-keyscan -H <VPS_TAILSCALE_IP>
```
Výstup vložit 1:1 do GitHub secretu `VPS_SSH_KNOWN_HOSTS`.

Pozn.: Heslo pro `sazinka_admin` nastavit na VPS:
```bash
docker exec sazinka-postgres psql -U sazinka -d sazinka \
  -c "ALTER ROLE sazinka_admin PASSWORD '<nové heslo>';"
```

### 23.14 Krok 12: Ověření E2E

Po kompletním setupu:
```bash
# Z lokálního stroje:
# 1. Marketing site
curl -sI https://ariadline.cz | head -5
# → HTTP/2 200

# 2. App
curl -sI https://app.ariadline.cz | head -5
# → HTTP/2 200

# 3. API (NATS WebSocket)
curl -sI https://api.ariadline.cz/nats
# → HTTP/1.1 400 (očekáváno — není WebSocket upgrade)

# 4. Monitor (vyžaduje přihlášení)
curl -sI https://monitor.ariadline.cz
# → HTTP/1.1 401 (basic auth)

# 5. Test CI/CD — push malou změnu do master a sledovat GitHub Actions
```

### 23.15 Disaster Recovery

V případě ztráty VPS:
1. Vytvořit nový server (krok 1)
2. Zabezpečit + nainstalovat Tailscale (krok 2) — node se automaticky připojí do tailnetu
3. Klonovat repo + obnovit `.env.prod` ze SOPS (krok 3)
4. Vytvořit volumes (krok 4) — **DATA BUDOU ZTRACENA** (Postgres, Nominatim, Valhalla)
5. Spustit stack (krok 5) — Nominatim a Valhalla se znovu importují (~2.5 hodiny)
6. Obnovit Postgres backup (pokud existuje — viz sekce o backup strategii)
7. DNS záznamy aktualizovat na novou IP
8. Aktualizovat `VPS_TAILSCALE_IP` a `VPS_SSH_KNOWN_HOSTS` v GitHub Secrets (nový server = nový host key)

> **TODO**: Automatizovat Postgres backup (pg_dump) přes cron job
> do Hetzner Object Storage nebo S3. Plánováno do Q2 2026.

---

## 24. CI/CD Pipeline — Test on push, manuální deploy

> **Klíčové pravidlo**: Pushes na master **nevyvolávají deploy**. Spustí se pouze
> testy, audit a build worker image do GHCR. Deploy (Hetzner + Cloudflare) probíhá
> **jen manuálně** přes `workflow_dispatch`.
>
> **Zdrojové soubory**: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`,
> `.github/workflows/site.yml`

### 24.1 Přehled pipeline

**Na každý push** (testy + build, bez deploye):
```
push to master → changes → test-worker, test-site, test-app
       → audit → build worker image → GHCR
       → STOP (žádný deploy)
```

**Manuální deploy** (workflow_dispatch):
```
Actions → Deploy workflow → Run
Inputs: target (staging | production), components (worker | site | app | all)

→ migrate-db (jen když worker + target)
→ deploy-worker na Hetzner (jen když worker)
→ CF Pages API: trigger build (jen když site/app)
→ smoke-test
```

### 24.2 CI Jobs (`ci.yml`)

| Job | Trigger | Co dělá |
|---|---|---|
| `test-worker` | `worker/**`, `packages/**` | Clippy (zero warnings) + cargo test. Postgres service pro SQLx. |
| `test-frontend` | `apps/web/**`, `apps/site/**` | pnpm typecheck + vitest |
| `security-audit` | každý push | cargo-audit, pnpm audit, Gitleaks (secret detection) |
| `build-worker` | po úspěšných testech | Docker build → GHCR push (tag: `<sha>` + `latest`), image size gate (150 MB), Trivy scan |

### 24.3 Deploy Jobs (`deploy.yml`)

| Job | Co dělá |
|---|---|
| `prepare` | Resolve worker image tag (SHA → fallback `latest`) |
| `migrate-db` | Docker run worker:migrate via Tailscale SSH |
| `deploy-worker` | `docker compose pull worker && up -d` via Tailscale SSH |
| `deploy-site` | `npx wrangler pages deploy` (ariadline-site) |
| `deploy-app` | `npx wrangler pages deploy` (ariadline-app) |
| `smoke-test` | curl health checks (API, site, app) |

Deploy rozlišuje `target` (staging/production) — jiný `.env` soubor, compose file, container name.

### 24.4 Pipeline — rozhodovací body

| Situace | Chování |
|---|---|
| `cargo test` / `clippy` selhání | Pipeline STOP, žádný deploy |
| `cargo audit` CRITICAL | Pipeline STOP |
| `trivy` CRITICAL CVE | Pipeline STOP |
| Image > 150 MB | Pipeline STOP |
| Gitleaks nalezení | Pipeline STOP |
| Migration selhání | Deploy STOP, worker zůstane na staré verzi |
| Worker health check fail | Rollback s předchozí verzí |
| Smoke test fail | Pipeline failed, ale deploy proběhl |

### 24.5 Minimalizace kontejnerů

| Technika | Efekt |
|---|---|
| Multi-stage build (3 stages) | Builder ~2 GB → Runtime 108 MB |
| `debian:slim` base | ~75 MB (vs ~125 MB full) |
| `cargo-chef` layer cache | Rebuild ~2 min (vs ~15 min) |
| `--release` + LTO | Binárka ~35 MB |
| `.dockerignore` | Build context ~5 MB (vs ~500 MB) |
| CI image size gate | Hard limit 150 MB |

### 24.6 GitHub Secrets

| Secret | Stav |
|---|---|
| `TAILSCALE_OAUTH_CLIENT_ID` | ✅ Nastaveno |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | ✅ Nastaveno |
| `VPS_TAILSCALE_IP` | ✅ Nastaveno |
| `VPS_SSH_KNOWN_HOSTS` | ✅ Nastaveno |
| `GHCR_TOKEN` | ✅ Nastaveno (PAT s `read:packages` + `write:packages`) |
| `MIGRATION_DB_URL` | ✅ Nastaveno |
| `MIGRATION_DB_URL_STAGING` | ⏳ Čeká na staging setup |
| `CF_API_TOKEN` | ✅ Nastaveno |
| `CF_ACCOUNT_ID` | ✅ Nastaveno |

`GITHUB_TOKEN` je automatický. Tailscale OAuth: scopes `devices:core`,
`auth_keys` (read **& write**), tags: `tag:ci`.

### 24.7 Security hardening

| Priorita | Bod |
|---|---|
| **KRITICKÁ** | SSH host key pinning v CI (MITM ochrana) — implementováno |
| **VYSOKÁ** | Tailscale ACL least privilege (`tag:ci` jen na `ariadline-prod:22`) |
| **VYSOKÁ** | Manuální deploy jen přes workflow_dispatch — implementováno |
| **STŘEDNÍ** | Rotace credentials minimálně kvartálně |
| **STŘEDNÍ** | DB migration safety gates (snapshot + expand/contract) |

### 24.8 Problémy vyřešené při implementaci CI/CD

1. **SQLx compile-time checks**: Přidán `cargo sqlx migrate run` do CI před Clippy.
2. **Clippy pre-existing warnings**: `-D warnings` + `-A` allow list pro existující kategorie.
3. **cargo audit CVE**: `bytes` 1.11.0, `time` 0.3.46 opraveny update. `rsa` RUSTSEC-2023-0071
   ignorováno (nepoužívaný `sqlx-mysql` dep).
4. **pnpm/action-setup**: Odstraněn `version` parametr, čte se z `package.json`.
5. **Lighthouse CI**: `serve` + správná cesta k `dist/`. Assertions zatím `continue-on-error: true`.
6. **Gitleaks false positives**: `.gitleaks.toml` s path allowlistem.
7. **Trivy zlib1g CVE-2023-45853**: `.trivyignore` (will_not_fix v Debian 12).
8. **Worker image not found při deployi**: CI pushuje `latest` tag + deploy fallback na `latest`.
9. **Wrangler-action v pnpm workspace**: Nahrazeno `npx wrangler` (obejití `ERR_PNPM_ADDING_TO_ROOT`).
10. **DB migrace auth failed**: `trust` auth na localhost obchází heslo → testovat z externího kontejneru.
11. **DB migrace — password reset**: Test hesla nutné provádět z jiného kontejneru na Docker síti,
    ne z `docker exec` uvnitř Postgres kontejneru.

**Konfigurační soubory pro CI**: `.gitleaks.toml`, `.trivyignore`, `worker/.cargo/audit.toml`.

---

## 25. CLI Deploy Script

> `scripts/deploy.sh` — push + CI + deploy z příkazové řádky.

### 25.1 Přehled

Většina pushů spouští jen CI (testy + build). Deploy do produkce je volitelný
a vyžaduje explicitní flag `--deploy`.

### 25.2 Použití

```bash
# Jen push (CI běží automaticky, žádný deploy)
git push

# Push + čekat na CI + deploy vše do produkce
./scripts/deploy.sh --deploy

# Push + deploy jen konkrétní komponentu
./scripts/deploy.sh --deploy app
./scripts/deploy.sh --deploy site
./scripts/deploy.sh --deploy worker

# Přes pnpm
pnpm deploy           # = --deploy (all)
pnpm deploy:app       # = --deploy app
pnpm deploy:site      # = --deploy site
pnpm deploy:worker    # = --deploy worker
```

### 25.3 Co skript dělá

1. `git push origin HEAD:master`
2. Čeká na CI run pro daný commit (polling GitHub API, max 30 minut)
3. Pokud CI projde — spustí Deploy workflow přes `workflow_dispatch`
4. Pokud CI selže — zastaví se a vypíše URL na selhání
5. Pokud žádný CI run neběží (např. změna jen v docs) — pokračuje s deployem

### 25.4 Prerekvizity

GitHub PAT s oprávněními `repo` + `workflow`:

```bash
# Varianta A: env proměnná
export GITHUB_TOKEN=ghp_...

# Varianta B: soubor (přetrvává mezi sessions)
mkdir -p ~/.config
echo 'ghp_...' > ~/.config/deploy-token
chmod 600 ~/.config/deploy-token
```

### 25.5 Flags

| Flag | Popis |
|------|-------|
| `--deploy` | Spustit deploy po CI (default: `all` komponenty) |
| `--deploy app` | Deploy jen frontend app |
| `--deploy site` | Deploy jen marketing site |
| `--deploy worker` | Deploy jen worker na VPS |
| `--staging` | Deploy do staging místo produkce |
| `--help` | Zobrazit nápovědu |

---

## 26. Build Info a Version Tracking

### 26.1 Build-time metadata

Vite config (`apps/web/vite.config.ts`) injektuje při buildu dvě globální konstanty:

| Konstanta | Zdroj | Fallback |
|-----------|-------|----------|
| `__BUILD_SHA__` | `VITE_BUILD_SHA` env var | `"dev"` |
| `__BUILD_TIME__` | `new Date().toISOString()` při buildu | — |

Deploy workflow nastavuje `VITE_BUILD_SHA=${{ needs.prepare.outputs.sha }}` při buildu app.

TypeScript deklarace v `src/vite-env.d.ts`:
```typescript
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
```

### 26.2 version.json

Vite plugin `generate-version-json` (v `vite.config.ts`) generuje při buildu soubor
`dist/version.json`:

```json
{
  "sha": "8836a3f...",
  "built": "2026-03-09T15:30:00.000Z"
}
```

Přístupný na `https://app.ariadline.com/version.json` **bez přihlášení**.
Lze použít pro monitoring a automatické kontroly verze.

### 26.3 Admin UI

Na stránce **Admin → Services** (tab "Služby") je ve spodní části sekce
"Build Info" zobrazující:
- **Commit** — git SHA (monospace font)
- **Built** — datum a čas buildu (lokalizovaný formát)

i18n klíče:
- `admin_build_info`: EN "Build Info", CS "Informace o buildu"

---

## 27. Stav produkčního nasazení (2026-03-09)

### 27.1 Živé URL

| Služba | URL | Platforma |
|--------|-----|-----------|
| Marketing site | `https://ariadline.com` | Cloudflare Pages (`ariadline-site`) |
| Aplikace (SPA) | `https://app.ariadline.com` | Cloudflare Pages (`ariadline-app`) |
| API (NATS WS) | `wss://api.ariadline.com/nats` | Caddy → NATS na Hetzner VPS |
| NATS monitoring | `https://monitor.ariadline.com` | Caddy → NATS (basic auth) |
| Version check | `https://app.ariadline.com/version.json` | Statický soubor v app buildu |

### 27.2 Stav komponent

| Komponenta | Verze/SHA | Stav |
|------------|-----------|------|
| Worker | `0.2.1` (`bb93556`) | ✅ Běží na VPS |
| Frontend app | `897a4b0` | ✅ Deploynut na CF Pages |
| Marketing site | `897a4b0` | ✅ Deploynut na CF Pages |
| CI pipeline | `ci.yml` | ✅ Zelený (testy + audit + GHCR build) |
| Deploy pipeline | `deploy.yml` | ✅ Funkční (workflow_dispatch) |
| Deploy script | `scripts/deploy.sh` | ✅ Implementováno |

### 27.3 Cloudflare Access

Obě CF Pages aplikace jsou chráněny Cloudflare Access (email OTP) dokud
nebudou připraveny pro veřejnost. Po spuštění — smazat Access applications.

### 27.4 Co zbývá

- [ ] Staging environment (DB, worker, CF Pages projekt, DNS)
- [ ] Postgres backup (pg_dump → Hetzner Object Storage)
- [ ] Monitoring a alerting (failed deploy, cert expiry, disk space)
- [ ] Credential rotation schedule (TAILSCALE_OAUTH, GHCR_TOKEN, DB passwords)
- [ ] Lighthouse quality fixes (color-contrast, errors-in-console)
- [ ] Odstranit Cloudflare Access po veřejném spuštění
