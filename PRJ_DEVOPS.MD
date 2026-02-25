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

**Problém**: Na Linuxu Docker manipuluje s iptables a může obejít UFW/firewalld.
Porty publikované jako `ports: - "5432:5432"` jsou dostupné z internetu i při
zapnutém firewallu.

**Řešení**: Nepublikovat interní porty, nebo bindnout na `127.0.0.1`.
Služby komunikují přes interní Docker síť.

```yaml
# infra/docker-compose.prod.yml
services:
  caddy:
    image: caddy:2-alpine
    container_name: sazinka-caddy
    restart: unless-stopped
    ports:
      - "80:80"          # ACME challenge (Let's Encrypt)
      - "443:443"        # Jediný veřejný port
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - sazinka_net
    depends_on:
      - nats

  nats:
    image: nats:2.10-alpine
    container_name: sazinka-nats
    # ŽÁDNÉ ports: ... (přístup jen přes caddy a docker net)
    command: >
      --config /etc/nats/nats-server.conf
      --jetstream
      --log /logs/nats.log
    volumes:
      - ./nats-server.prod.conf:/etc/nats/nats-server.conf:ro
      - ../logs:/logs
      - nats_jetstream:/data/jetstream
    networks:
      - sazinka_net
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: sazinka-postgres
    # Volitelně pro lokální správu:
    # ports:
    #   - "127.0.0.1:5432:5432"
    environment:
      POSTGRES_USER: sazinka
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}    # Z .env.prod souboru
      POSTGRES_DB: sazinka
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    networks:
      - sazinka_net
    restart: unless-stopped

  nominatim:
    image: mediagis/nominatim:4.4
    container_name: sazinka-nominatim
    # ŽÁDNÉ ports: ... (přístup jen přes docker net)
    environment:
      PBF_URL: https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf
      NOMINATIM_PASSWORD: ${NOMINATIM_PASSWORD}
      FREEZE: "true"
    volumes:
      - nominatim_data:/var/lib/postgresql/14/main
    shm_size: 1g
    deploy:
      resources:
        limits:
          memory: 4G
    networks:
      - sazinka_net
    restart: unless-stopped

  valhalla:
    image: ghcr.io/gis-ops/docker-valhalla/valhalla:3.5.1   # PIN verzi!
    container_name: sazinka-valhalla
    # ŽÁDNÉ ports: ... (přístup jen přes docker net)
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
    networks:
      - sazinka_net
    restart: unless-stopped

networks:
  sazinka_net:
    driver: bridge

volumes:
  postgres_data:
  nats_jetstream:
  nominatim_data:
  valhalla_tiles:
  caddy_data:
  caddy_config:
```

Klíčové rozdíly oproti dev konfiguraci:
- **Caddy** je jediná služba s publikovanými porty (80, 443)
- **Postgres, Nominatim, Valhalla** nemají publikované porty
- **NATS** nemá publikované porty (Caddy proxuje WS, worker jde přes docker net)
- Hesla jsou v `${PROMĚNNÁ}` čtená z `.env.prod` (mimo Git)
- Valhalla má **pinovanou verzi** (ne `:latest`)

### 16.5 Reverse proxy: Caddy konfigurace

Caddy automaticky zajistí Let's Encrypt certifikát. Konfigurace pro Site + App:

```
# infra/Caddyfile

# Veřejná marketingová část (Site)
sazinka.cz {
    # Statické soubory (build z apps/site)
    root * /var/www/site
    file_server
    
    # SPA fallback pro client-side routing
    try_files {path} /index.html
    
    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}

# Aplikační část (App) - vyžaduje přihlášení
app.sazinka.cz {
    # Statické soubory (build z apps/web)
    root * /var/www/app
    
    # NATS WebSocket proxy (wss:// → ws://)
    handle /nats/* {
        uri strip_prefix /nats
        reverse_proxy nats:8222
    }
    
    # Statické soubory aplikace
    handle {
        file_server
        try_files {path} /index.html
    }
    
    # Security headers
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
        # CSP: povolíme WebSocket jen na app.sazinka.cz
        Content-Security-Policy "default-src 'self'; connect-src 'self' wss://app.sazinka.cz; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
    }
}

# Volitelné: NATS monitoring (zaheslované, přístup jen pro admin)
monitor.sazinka.cz {
    basicauth {
        admin $2a$14$... # bcrypt hash hesla, viz: caddy hash-password
    }
    reverse_proxy nats:8223
}
```

**Struktura souborů na serveru**:

```
/var/www/
├── site/              # Build z apps/site (marketingová část)
│   ├── index.html
│   ├── assets/
│   └── ...
└── app/               # Build z apps/web (aplikační část)
    ├── index.html
    ├── assets/
    └── ...
```

**Environment proměnné**:

```env
# apps/site/.env.production (Site - marketingová část)
# Žádné NATS, žádné WebSockety

# apps/web/.env.production (App - aplikační část)
VITE_NATS_WS_URL=wss://app.sazinka.cz/nats
```

**Poznámky**:
- **Site** (`sazinka.cz`) nemá přístup k NATS WebSocket → nemůže být zneužit k DoS.
- **App** (`app.sazinka.cz`) má NATS WebSocket na `/nats` → přístup jen po přihlášení.
- HTTPS frontend se nemůže připojit k `ws://` (Mixed Content) → `wss://` je nutnost.
- CSP header v App části omezuje WebSocket připojení jen na `app.sazinka.cz`.

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

### 16.13 Worker jako systemd service (Linux)

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
EnvironmentFile=/opt/sazinka/worker/.env.prod
ExecStart=/opt/sazinka/worker/target/release/sazinka-worker
Restart=always
RestartSec=5
# Hardening:
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/sazinka/logs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable sazinka-worker
sudo systemctl start sazinka-worker
sudo systemctl status sazinka-worker
```

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

> **Cíl**: Vývojové prostředí funguje na Windows i Linuxu. Produkce běží výhradně
> na Linuxu. Stávající Windows skripty a tooling zůstávají zachovány.

### 19.1 Inventář Windows-specifických závislostí

#### A) Skripty (PowerShell / Batch)

| Soubor | Windows-specifické prvky |
|---|---|
| `start.ps1` | Visual Studio detekce + `vcvars64.bat`, `.exe` cesty, `Start-Process`, `Get-Process`, `$env:TEMP` |
| `stop.ps1` | `Get-Process -Name`, `Stop-Process`, `Get-NetTCPConnection` (WMI) |
| `start.bat` | Wrapper → `powershell -ExecutionPolicy Bypass` |
| `stop.bat` | Wrapper → `powershell -ExecutionPolicy Bypass` |
| `infra/manage.ps1` | `Read-Host` (interaktivní potvrzení), PowerShell `switch` |

**Plán**: Vytvořit ekvivalentní Bash skripty (`start.sh`, `stop.sh`, `infra/manage.sh`)
se stejnými parametry a chováním. PowerShell verze zůstanou pro Windows vývojáře.

#### B) Rust toolchain a C linker

| Aspekt | Windows (aktuální) | Linux (cíl) |
|---|---|---|
| Rust target | `stable-x86_64-pc-windows-msvc` | `stable-x86_64-unknown-linux-gnu` |
| C linker | MSVC (`link.exe` z Visual Studio) | GCC (`cc`) nebo Clang |
| C runtime | Windows CRT (MSVC) | glibc |
| Setup | Visual Studio + "Desktop development with C++" workload | `sudo apt install build-essential` (Ubuntu/Debian) |
| Env setup | `vcvars64.bat` — nastaví PATH, LIB, INCLUDE pro MSVC | Není potřeba — `cc` je v PATH po instalaci |

**Plán**: Na Linuxu stačí `build-essential` (GCC, make, libc headers). Žádné
`vcvars64.bat`, žádné Visual Studio. `rustup` nainstaluje správný target
automaticky podle OS. `cargo build` funguje bez dalšího nastavení.

#### C) TLS backend v reqwest

| Aspekt | `native-tls` (aktuální) | `rustls` (alternativa) |
|---|---|---|
| Windows | Schannel (systémový) — funguje out of the box | Pure Rust — funguje |
| Linux | OpenSSL — vyžaduje `libssl-dev` (apt) nebo `openssl-devel` (dnf) | Pure Rust — žádná systémová závislost |
| Kompilace | Rychlá (systémová knihovna, jen FFI) | Pomalejší (kompiluje z Rust zdrojáků) |
| Certifikáty | Systémové cert store | `webpki-roots` (bundled Mozilla CA) |
| FIPS compliance | Ano (přes systémový backend) | Ne |

**Doporučení**: Přejít na `rustls` v `Cargo.toml`. Důvody:
- Odstraní závislost na `libssl-dev` na Linuxu (jedna systémová dependency méně).
- Komentář v Cargo.toml říká "using native-tls to avoid ring compilation" — toto
  již není problém, `ring` crate kompiluje na obou platformách bez potíží.
- Zjednoduší CI pipeline (žádná systémová OpenSSL).
- Zjednodušší Docker image pro produkci (menší base image).

Změna v `worker/Cargo.toml`:
```toml
# BYLO:
reqwest = { version = "0.12", default-features = false, features = ["json", "native-tls"] }

# BUDE:
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

#### D) Tranzitivní Windows crates v Cargo.lock

`Cargo.lock` obsahuje: `windows-sys`, `windows-core`, `windows-targets`,
`find-msvc-tools`, `windows_x86_64_msvc`. Tyto crates se stahují jen jako
podmíněné (`[target.'cfg(windows)'.dependencies]`) a na Linuxu se **nekompilují**.
Cargo je automaticky vyřeší podle target platformy — není potřeba žádná akce.

#### E) Docker Compose

Docker Compose (`infra/docker-compose.yml`) je plně cross-platform:
- Relativní cesty (`./nats-server.conf`, `../logs`) fungují na obou OS.
- Volume mounty jsou Linux-style (`/var/lib/postgresql/data`).
- Na Windows jde přes Docker Desktop (WSL2 backend), na Linuxu nativně.

Příkaz `docker-compose` (V1, hyphen) vs `docker compose` (V2, space):
- Windows s Docker Desktop: obě verze dostupné.
- Linux: obvykle jen `docker compose` (V2 plugin). V1 je deprecated.

**Plán**: Bash skripty budou používat `docker compose` (V2). PowerShell skripty
zůstávají s `docker-compose` (V1) kvůli zpětné kompatibilitě, ale přidat
fallback na `docker compose` pokud V1 není dostupný.

#### F) Frontend (Node.js / pnpm)

Frontend stack je plně cross-platform:
- `pnpm`, `vite`, `vitest` — fungují identicky na Windows i Linuxu.
- `package.json` skripty neobsahují žádné platform-specifické příkazy.
- `rimraf` (v root `package.json`) je cross-platform alternativa k `rm -rf`.

Žádná akce potřeba.

#### G) `.cursorrules` — heredoc poznámka

Řádek: *"Do not use heredoc syntax — this project runs on Windows/PowerShell"*

**Plán**: Aktualizovat na: *"Prefer PowerShell-compatible syntax on Windows.
On Linux, standard Bash including heredoc is fine."*

### 19.2 Nové soubory k vytvoření

| Soubor | Účel | Priorita |
|---|---|---|
| `start.sh` | Bash ekvivalent `start.ps1` | Vysoká |
| `stop.sh` | Bash ekvivalent `stop.ps1` | Vysoká |
| `infra/manage.sh` | Bash ekvivalent `infra/manage.ps1` | Střední |

#### `start.sh` — klíčové rozdíly oproti `start.ps1`

```
start.ps1 (Windows)                    start.sh (Linux)
─────────────────────────────────────  ─────────────────────────────────────
Visual Studio detection + vcvars64.bat  Nepotřeba — cc/gcc je v PATH
$env:VCINSTALLDIR / $env:VSINSTALLDIR  Nepotřeba
cmd /c temp.bat (cargo build)           cargo build (přímo)
Start-Process powershell (nové okno)    Nové terminálové okno nebo background &
sazinka-worker.exe                      sazinka-worker (bez .exe)
Get-Content .env + $env:VAR = val       source worker/.env nebo export
docker-compose                          docker compose (V2)
```

#### `stop.sh` — klíčové rozdíly oproti `stop.ps1`

```
stop.ps1 (Windows)                     stop.sh (Linux)
─────────────────────────────────────  ─────────────────────────────────────
Get-Process -Name "sazinka-worker"      pkill -f sazinka-worker / killall
Get-NetTCPConnection -LocalPort 5173    lsof -ti :5173 | xargs kill
Stop-Process -Force                     kill -9
docker-compose down                     docker compose down
```

### 19.3 Prerekvizity na Linuxu

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y build-essential pkg-config curl git

# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
# Target se nastaví automaticky: stable-x86_64-unknown-linux-gnu

# Pokud zůstane native-tls (než se přejde na rustls):
sudo apt install -y libssl-dev

# Node.js + pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g pnpm@9.15.0

# Docker
# (viz https://docs.docker.com/engine/install/ubuntu/)
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker $USER
```

### 19.4 Pořadí implementace

```
Krok  Úkon                                          Riziko     Rozsah
─── ─────────────────────────────────────────────── ────────── ──────────────
 1   Cargo.toml: native-tls → rustls                Nízké      1 řádek
 2   Vytvořit start.sh + stop.sh                    Nízké      2 nové soubory
 3   Vytvořit infra/manage.sh                       Nízké      1 nový soubor
 4   .cursorrules: aktualizovat heredoc poznámku     Žádné      1 řádek
 5   PRJ_CONTEXT.MD: přidat Linux setup instrukce    Žádné      dokumentace
 6   Otestovat cargo build + cargo run na Linuxu     Střední    ověření
 7   Otestovat start.sh end-to-end na Linuxu         Střední    ověření
```

### 19.5 Co se nemění

- `start.ps1`, `stop.ps1`, `start.bat`, `stop.bat` — zůstávají pro Windows.
- `infra/manage.ps1` — zůstává pro Windows.
- `infra/docker-compose.yml` — cross-platform, beze změn.
- `worker/Cargo.toml` — `[dependencies]` jsou cross-platform (kromě TLS backendu).
- Frontend stack — plně cross-platform, beze změn.
- SQL migrace — cross-platform (`.gitattributes` zajišťuje LF).

---

## 16. Deployment Ariadline Marketing Site (Cloudflare Pages)

Tento dokument pokrývá nasazení Ariadline marketing webu na Cloudflare Pages.

### 16.1 Předpoklady

- Cloudflare účet
- Doména `ariadline.com` nakonfigurovaná v Cloudflare
- Přístup k GitHub repozitáři
- Resend účet pro transakční e-maily

### 16.2 Cloudflare Pages Setup

#### Vytvoření Pages projektu

1. Přejděte do Cloudflare Dashboard → Pages
2. Klikněte na "Create a project"
3. Připojte GitHub repozitář
4. Nakonfigurujte build nastavení:
   - **Project name**: `ariadline-site`
   - **Production branch**: `master`
   - **Build command**: `cd apps/site && pnpm build`
   - **Build output directory**: `apps/site/dist`
   - **Root directory**: `/` (monorepo root)

#### Build nastavení

```yaml
Build command: cd apps/site && pnpm build
Build output directory: apps/site/dist
Node version: 22
Package manager: pnpm
```

### 16.3 Environment Variables

Nakonfigurujte v Cloudflare Pages → Settings → Environment variables:

#### Production

| Variable | Value | Poznámky |
|----------|-------|----------|
| `RESEND_API_KEY` | `re_xxxxx` | Z Resend dashboardu |
| `TURNSTILE_SECRET_KEY` | `0x4xxxxx` | Z Cloudflare Turnstile |
| `NODE_VERSION` | `22` | Vyžadováno pro build |

#### Preview (volitelné)

Použijte testovací API klíče pro preview deploymenty.

### 16.4 D1 Database Setup

#### Vytvoření databáze

```bash
cd apps/site
wrangler d1 create ariadline-site-db
```

Zkopírujte `database_id` z výstupu.

#### Aktualizace wrangler.toml

```toml
[[d1_databases]]
binding = "DB"
database_name = "ariadline-site-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

#### Spuštění migrací

```bash
# Production
wrangler d1 migrations apply ariadline-site-db --remote

# Lokální vývoj
wrangler d1 migrations apply ariadline-site-db --local
```

#### Ověření databáze

```bash
wrangler d1 execute ariadline-site-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Očekávaný výstup:
- `contacts`
- `newsletter_subscribers`

### 16.5 Custom Domain

#### Konfigurace DNS

1. Přejděte do Cloudflare Dashboard → DNS
2. Přidejte CNAME záznam:
   - **Name**: `@` (nebo `www`)
   - **Target**: `ariadline-site.pages.dev`
   - **Proxy status**: Proxied (oranžový mrak)

#### Přidání Custom Domain do Pages

1. Přejděte do Pages → ariadline-site → Custom domains
2. Klikněte na "Set up a custom domain"
3. Zadejte `ariadline.com`
4. Cloudflare automaticky nakonfiguruje SSL

### 16.6 Resend Email Setup

#### Ověření domény

1. Přejděte do Resend Dashboard → Domains
2. Přidejte doménu: `ariadline.com`
3. Přidejte DNS záznamy do Cloudflare:
   - **SPF**: `v=spf1 include:_spf.resend.com ~all`
   - **DKIM**: (poskytne Resend)
   - **DMARC**: `v=DMARC1; p=none; rua=mailto:admin@ariadline.com`

#### Vytvoření API klíče

1. Přejděte do Resend Dashboard → API Keys
2. Vytvořte nový klíč s "Sending access"
3. Přidejte do Cloudflare Pages environment variables

### 16.7 Cloudflare Turnstile

#### Vytvoření site

1. Přejděte do Cloudflare Dashboard → Turnstile
2. Klikněte na "Add site"
3. Nakonfigurujte:
   - **Site name**: Ariadline Marketing Site
   - **Domain**: `ariadline.com`
   - **Widget mode**: Managed (Invisible)

#### Získání klíčů

- **Site key**: Přidejte do `ContactForm.tsx` a `NewsletterForm.tsx`
- **Secret key**: Přidejte do Cloudflare Pages environment variables

### 16.8 Umami Analytics

#### Setup

1. Zaregistrujte se na [Umami Cloud](https://cloud.umami.is)
2. Přidejte website: `ariadline.com`
3. Zkopírujte tracking script URL

#### Konfigurace v Layout.astro

```astro
<script
  defer
  src="https://[region].umami.is/script.js"
  data-website-id="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  is:inline
></script>
```

### 16.9 GitHub Actions Secrets

Přidejte do repository settings → Secrets and variables → Actions:

| Secret | Value | Účel |
|--------|-------|------|
| `CLOUDFLARE_API_TOKEN` | Token s Pages write permissions | Deploy do Pages |
| `CLOUDFLARE_ACCOUNT_ID` | Vaše account ID | Deploy do Pages |

#### Vytvoření API tokenu

1. Přejděte do Cloudflare Dashboard → My Profile → API Tokens
2. Klikněte na "Create Token"
3. Použijte "Edit Cloudflare Workers" template
4. Scope: Account → Cloudflare Pages → Edit
5. Zkopírujte token a přidejte do GitHub secrets

### 16.10 Deployment Workflow

#### Automatický deployment

- **Push do `master`**: Nasadí do production (`ariadline.com`)
- **Pull requesty**: Vytvoří preview deployment (`pr-123.ariadline-site.pages.dev`)

#### Manuální deployment

```bash
cd apps/site
pnpm build
wrangler pages deploy dist --project-name=ariadline-site
```

### 16.11 Post-Deployment Verification

#### Checklist

- [ ] Web se načte na `https://ariadline.com`
- [ ] Všechny 3 jazyky fungují (`/en/`, `/cs/`, `/sk/`)
- [ ] Root `/` správně přesměruje
- [ ] Kontaktní formulář se úspěšně odešle
- [ ] Newsletter subscription funguje (zkontrolujte email)
- [ ] Newsletter confirmation link funguje
- [ ] D1 databáze ukládá odeslané formuláře
- [ ] Resend odesílá e-maily
- [ ] Turnstile brání spamu
- [ ] Umami trackuje page views
- [ ] Lighthouse skóre >= 95 ve všech kategoriích

#### Testování formulářů

1. Odešlete kontaktní formulář → Zkontrolujte D1 záznam → Zkontrolujte email
2. Přihlaste se k newsletteru → Zkontrolujte D1 status=pending → Klikněte na confirmation link → Zkontrolujte D1 status=confirmed

#### Kontrola D1 dat

```bash
# Zobrazit kontakty
wrangler d1 execute ariadline-site-db --remote --command "SELECT * FROM contacts ORDER BY created_at DESC LIMIT 5"

# Zobrazit newsletter subscribers
wrangler d1 execute ariadline-site-db --remote --command "SELECT * FROM newsletter_subscribers ORDER BY created_at DESC LIMIT 5"
```

### 16.12 Monitoring

#### Cloudflare Analytics

- Pages → ariadline-site → Analytics
- Monitorujte: Requests, Bandwidth, Errors

#### Umami Analytics

- Sledujte: Page views, Referrers, Devices, Countries

#### Error Logging

Pages Functions chyby se zobrazují v:
- Cloudflare Dashboard → Workers & Pages → ariadline-site → Logs

### 16.13 Rollback

Pokud deployment selže:

1. Přejděte do Pages → ariadline-site → Deployments
2. Najděte poslední úspěšný deployment
3. Klikněte na "..." → "Rollback to this deployment"

### 16.14 Troubleshooting

#### Build selhává

- Zkontrolujte, že Node verze je 22
- Ověřte, že pnpm je nainstalován
- Zkontrolujte build logy v Pages dashboardu

#### Formuláře se neodesílají

- Ověřte, že `RESEND_API_KEY` je nastavený
- Zkontrolujte, že D1 databáze je navázaná v `wrangler.toml`
- Zkontrolujte Functions logy pro chyby

#### E-maily se neodesílají

- Ověřte, že Resend doména je ověřená
- Zkontrolujte SPF/DKIM/DMARC záznamy
- Zkontrolujte Resend dashboard pro delivery logy

#### Turnstile nefunguje

- Ověřte, že site key odpovídá doméně
- Zkontrolujte secret key v environment variables
- Ujistěte se, že widget je viditelný (zkontrolujte CSS)

### 16.15 Podpora

Pro problémy kontaktujte: admin@ariadline.com

---

## 20. Containerizace Rust Workeru — Plán

> **Stav**: PLÁN — dosud neimplementováno.
> **Cíl**: Worker běží jako Docker kontejner vedle ostatních služeb. Na VPS není
> potřeba Rust toolchain. Image se builduje v CI (GitHub Actions) a nasazuje
> přes `docker compose pull && docker compose up -d`.
> **Rozhodnutí**: GHCR image je **private**, nasazení používá **pouze immutable tag**
> (`<git-sha>`, bez `latest` v produkci).

### 20.1 Motivace

Aktuální stav (sekce 16.13): Worker běží jako systemd service, binárka se kompiluje
na serveru přes `cargo build --release` (~10+ minut, vyžaduje Rust toolchain + 2 GB).

Problémy:
- Rust toolchain na produkčním serveru je zbytečná závislost a útočná plocha.
- Release build na VPS zabírá čas a RAM (LTO + codegen-units=1).
- Worker je jediná služba mimo Docker → dvě různé správy (compose + systemd).
- Rollback vyžaduje rekompilaci nebo uchování starých binárek.

Řešení: Multi-stage Docker image buildovaný v CI, produkční image obsahuje
pouze binárku (~30-50 MB) na minimálním base image.

### 20.2 Cílová architektura (3 tiers)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE                                      │
│                                                                         │
│  ┌─────────────────────────┐    ┌──────────────────────────────────┐   │
│  │ Cloudflare Pages        │    │ Cloudflare Pages                 │   │
│  │ "sazinka-site"          │    │ "sazinka-app"                    │   │
│  │                         │    │                                  │   │
│  │ sazinka.cz              │    │ app.sazinka.cz                   │   │
│  │ www.sazinka.cz          │    │                                  │   │
│  │                         │    │ Build env:                       │   │
│  │ Build: apps/site        │    │   VITE_NATS_WS_URL=             │   │
│  │ Čistě statický          │    │   wss://api.sazinka.cz/nats     │   │
│  │ Žádné WebSockety        │    │                                  │   │
│  └─────────────────────────┘    └──────────────────────────────────┘   │
│                                                                         │
│  CDN edge caching, Brotli, HTTP/3, automatic SSL                       │
└─────────────────────────────────────────────────────────────────────────┘
                                         │
                                         │ wss://api.sazinka.cz/nats
                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    HETZNER VPS (api.sazinka.cz)                         │
│                    Ubuntu 22.04+, 4 CPU / 16 GB RAM / 60 GB SSD        │
│                                                                         │
│  Firewall: jen 22 (SSH) + 80 (ACME) + 443 (HTTPS)                     │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                    docker compose                              │    │
│  │                    (docker-compose.prod.yml)                   │    │
│  │                                                                │    │
│  │  ┌──────────┐   :443 ┌──────────────────────────────────┐    │    │
│  │  │  Caddy   │◄──────│  Internet (port 80 + 443)        │    │    │
│  │  │  reverse │        └──────────────────────────────────┘    │    │
│  │  │  proxy   │                                                │    │
│  │  └──┬───┬───┘                                                │    │
│  │     │   │                                                    │    │
│  │     │   │ /nats → ws://nats:8222                             │    │
│  │     │   ▼                                                    │    │
│  │     │  ┌────────────┐  :4222  ┌───────────────────┐         │    │
│  │     │  │   NATS     │◄───────│   Rust Worker     │         │    │
│  │     │  │   :8222    │────────►│   (sazinka-worker)│         │    │
│  │     │  │   :8223    │         │                   │         │    │
│  │     │  └────────────┘         │   Žádné porty     │         │    │
│  │     │                         │   Jen NATS klient │         │    │
│  │     │                         └──┬──────┬─────┬───┘         │    │
│  │     │                            │      │     │              │    │
│  │     │                            ▼      ▼     ▼              │    │
│  │     │                 ┌────────┐ ┌────────┐ ┌──────────┐   │    │
│  │     │                 │Postgres│ │Nominat.│ │Valhalla  │   │    │
│  │     │                 │ :5432  │ │ :8080  │ │ :8002    │   │    │
│  │     │                 └────────┘ └────────┘ └──────────┘   │    │
│  │     │                                                       │    │
│  │     │ /monitor → nats:8223 (basic auth)                     │    │
│  │     ▼                                                       │    │
│  │  ┌──────────────┐                                          │    │
│  │  │ Uptime Kuma  │  (volitelné)                             │    │
│  │  │ :3001        │                                          │    │
│  │  └──────────────┘                                          │    │
│  │                                                             │    │
│  │  sazinka_net (bridge)                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

Klíčový rozdíl oproti sekci 16.2: **Worker je uvnitř Docker Compose**, ne jako
systemd service. Vše komunikuje přes interní Docker síť `sazinka_net`.

### 20.3 Prerekvizit: native-tls → rustls

Před vytvořením Dockerfile přepnout TLS backend v `worker/Cargo.toml`:

```toml
# BYLO:
reqwest = { version = "0.12", default-features = false, features = ["json", "native-tls"] }

# BUDE:
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

Důvod: S `native-tls` runtime image potřebuje `libssl3` (~5 MB + závislosti).
S `rustls` stačí jen `ca-certificates` (~200 KB). Menší image, méně závislostí,
žádná systémová OpenSSL.

Tato změna je již doporučena v sekci 19.1 (bod C).

### 20.4 Dockerfile (multi-stage build s cargo-chef)

Soubor: `worker/Dockerfile`

**Build context**: monorepo root `.` — spouštět z root monorepa: `docker build -f worker/Dockerfile .`

Worker embeduje `packages/countries/countries.json` přes `include_str!()`, proto
kontext musí zahrnout jak `worker/` tak `packages/`. `.dockerignore` v rootu
vylučuje `apps/`, `infra/`, `logs/`, `worker/target/` atd. pro rychlý přenos contextu.
Výstupní binárka je v `/app/worker/target/release/sazinka-worker`.

Kompilace Rustu v Dockeru vyžaduje optimalizaci, jinak se při každé změně zdrojového
kódu znovu kompilují i všechny závislosti (což trvá ~10+ minut). Použijeme
nástroj `cargo-chef`, který přípravu závislostí oddělí do vlastní vrstvy (cache layer).

```dockerfile
# ============================================================
# Stage 1: Planner — analýza závislostí
# ============================================================
FROM rust:1-slim-bookworm AS planner
WORKDIR /app
RUN cargo install cargo-chef
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

# ============================================================
# Stage 2: Builder — kompilace s využitím vrstev Dockeru
# ============================================================
FROM rust:1-slim-bookworm AS builder
WORKDIR /app
RUN cargo install cargo-chef

# Systémové závislosti pro kompilaci (s rustls není potřeba libssl-dev)
RUN apt-get update && \
    apt-get install -y --no-install-recommends pkg-config && \
    rm -rf /var/lib/apt/lists/*

# Krok 2a: kompilace závislostí (Tato vrstva se cachuje, dokud se nezmění Cargo.toml/lock)
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Krok 2b: kompilace samotné aplikace (Tato vrstva se spustí při každé změně zdrojáků)
COPY . .
RUN touch src/main.rs && cargo build --release

# ============================================================
# Stage 3: Runtime — minimální image s binárkou
# ============================================================
FROM debian:bookworm-slim
WORKDIR /opt/sazinka

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates procps && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r sazinka && useradd -r -g sazinka -d /opt/sazinka sazinka
RUN mkdir -p /opt/sazinka/logs && chown -R sazinka:sazinka /opt/sazinka

# Zkopírovat binárku z builderu (kontext worker/ → target je v /app/target/)
COPY --from=builder /app/target/release/sazinka-worker /usr/local/bin/sazinka-worker

USER sazinka

# Výchozí spuštění aplikace (lze přepsat pro CLI commandy, např. --migrate-only)
CMD ["sazinka-worker"]
```

Výsledný image bude mít ~50-80 MB (binárka ~30-40 MB + debian-slim ~25 MB + ca-certs).
`procps` je přidán pro health check s `pgrep`.

### 20.5 Aktualizace docker-compose.prod.yml

Produkční konfigurace: samostatný soubor `infra/docker-compose.prod.yml` (bez extendu
nad dev souborem), aby byly jasně odděleny porty, env a služby. Dev používá
`docker-compose.yml`, prod používá `docker-compose.prod.yml` s `.env.prod`.

Přidat worker jako službu do `infra/docker-compose.prod.yml`:

```yaml
services:
  # ... (caddy, nats, postgres, nominatim, valhalla — beze změn)

  worker:
    image: ghcr.io/<org>/sazinka-worker:${WORKER_VERSION:?Set WORKER_VERSION}
    container_name: sazinka-worker
    environment:
      NATS_URL: nats://worker:${NATS_WORKER_PASSWORD}@nats:4222
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-sazinka}
      GEOCODER_BACKEND: nominatim
      NOMINATIM_URL: http://nominatim:8080
      VALHALLA_URL: http://valhalla:8002
      JWT_SECRET: ${JWT_SECRET}
      RUST_LOG: ${RUST_LOG:-info,sazinka_worker=debug}
      LOGS_DIR: /opt/sazinka/logs
    volumes:
      - ../logs:/opt/sazinka/logs
    networks:
      - sazinka_net
    depends_on:
      postgres:
        condition: service_healthy
      nats:
        condition: service_healthy
    mem_limit: 2g
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped
```

Klíčové body:
- **Žádné publikované porty** — worker nemá HTTP server.
- **Adresy služeb**: hostname kontejnerů (`nats`, `postgres`, `nominatim`,
  `valhalla`) místo `localhost`.
- **depends_on** s health check podmínkami — worker čeká na Postgres a NATS.
- **WORKER_VERSION** — umožňuje pinovat verzi image při deploymentu.

### 20.6 Environment proměnné — změna adres

Worker v kontejneru musí adresovat služby přes Docker DNS (hostname kontejneru),
ne přes `localhost`. Dotčené proměnné:

```
PROMĚNNÁ              DEV (localhost)              PROD (Docker network)
───────────────────── ─────────────────────────── ───────────────────────────
NATS_URL              nats://localhost:4222        nats://worker:PASS@nats:4222
DATABASE_URL          postgres://...@localhost:5432 postgres://...@postgres:5432
NOMINATIM_URL         http://localhost:8080        http://nominatim:8080
VALHALLA_URL          http://localhost:8002        http://valhalla:8002
```

Worker kód (`config.rs`) tyto URL čte z env proměnných — žádná změna v kódu
není potřeba, jen jiné hodnoty v prostředí.

### 20.7 Migrace databáze — Option B (samostatný CI job)

Pro produkci je zvolená varianta **Option B**: migrace neběží při startu workeru,
ale jako samostatný krok v CI/CD pipeline **před nasazením nové verze workeru**.

**Důvody**:
- Vyšší bezpečnost: runtime worker účet má minimální DB oprávnění (bez DDL).
- Lepší škálování: při více replikách nehrozí souběžné spouštění migrací.
- Predikovatelný deploy: když migrace selže, deploy se zastaví před rolloutem.

**Provozní pravidla**:
- Krok migrace bude řešen spuštěním samotného kontejneru s CLI flagem (např. `sazinka-worker --migrate-only`). Worker provede migrace a okamžitě se ukončí s `exit(0)`. Pro toto bude potřeba doimplementovat jednoduché CLI parsování (pomocí `clap`, který je už v závislostech) v Rustu.
- CI job `db-migrate` běží jako první krok deploymentu backendu (přes SSH spustí migrační příkaz na VPS).
- Migrační kontejner používá `MIGRATION_DATABASE_URL` (nebo `DATABASE_URL` s přihlašovacími údaji uživatele `sazinka_admin`). Runtime worker používá `DATABASE_URL` s uživatelem `sazinka_app`.
- Pipeline pořadí: `build image` → `run migrations` → `deploy worker`.

**PostgreSQL role (nutné vytvořit při prvním setupu)**:
- `sazinka_admin` — DDL práva (CREATE, ALTER, DROP), používá se pouze pro migrační job.
- `sazinka_app` — DML práva (SELECT, INSERT, UPDATE, DELETE), žádné schema změny. Používá runtime worker.

Poznámka: `sqlx::migrate!` je compile-time makro; po přidání/odebrání migrací je
nutný nový image build.

### 20.8 Logování

Dvě možnosti:

**A) Volume mount (doporučeno pro začátek):**
```yaml
volumes:
  - ../logs:/opt/sazinka/logs
```
Worker zapisuje do `/opt/sazinka/logs/worker.log.YYYY-MM-DD` jako dnes.
Logy jsou přístupné na hostu v `logs/`.

**B) Docker logging driver (budoucí optimalizace):**
Worker zapisuje na stdout/stderr, Docker řeší rotaci:
```yaml
logging:
  driver: json-file
  options:
    max-size: "50m"
    max-file: "7"
```
Vyžaduje úpravu `tracing-subscriber` inicializace v `main.rs` — detekovat
prostředí a přepnout mezi file appender a stdout.

### 20.9 Health check workeru

Worker nemá HTTP endpoint. Možnosti:

**A) Process-based (jednoduchý):**
```yaml
healthcheck:
  test: ["CMD", "pgrep", "-f", "sazinka-worker"]
  interval: 10s
  timeout: 3s
  retries: 3
```
Ověřuje jen že proces běží, ne že je funkční.

**B) NATS ping subject (robustní, vyžaduje implementaci):**
Worker naslouchá na `sazinka.health.ping` a odpovídá `pong`.
Health check skript publikuje zprávu a čeká na odpověď.
```yaml
healthcheck:
  test: ["CMD", "nats", "req", "sazinka.health.ping", "ping", "--timeout=2s"]
  interval: 30s
  timeout: 5s
  retries: 3
```
Vyžaduje: (1) handler v workeru, (2) `nats` CLI v image nebo sidecar.

**Doporučení**: Začít s A, implementovat B jako follow-up.

### 20.10 CI/CD pipeline (GitHub Actions) — plně automatická

Soubor: `.github/workflows/deploy-worker.yml`

Jeden společný workflow pro backend i frontend. Použijí se podmíněné kroky (path filters
nebo `if:` podle změněných souborů), aby se nepřespalovalo — např. při změně jen
`apps/site/**` se nebuduje worker image ani nespouštějí migrace.

```
Trigger: push to main (path filters: worker/**, apps/site/**, apps/web/**)

Kroky:
1. Checkout
2. Set up Docker Buildx
3. Login to GHCR (ghcr.io) s privátním tokenem
4. Build & push Docker image (private registry)
   - Tag: ghcr.io/<org>/sazinka-worker:<git-sha>   # immutable production tag
   - Cache: GitHub Actions cache (nebo registry cache)
5. Spustit DB migrace (samostatný job, Option B)
6. Automatický deploy na VPS (SSH z CI):
   - docker compose pull worker
   - docker compose up -d worker
7. Deploy Cloudflare Pages:
   - apps/site → sazinka-site
   - apps/web  → sazinka-app
8. Post-deploy health checks + rollback při failu

Odhadovaný čas:
- První build: ~15 minut (kompilace všech závislostí)
- Následné buildy: ~3-5 minut (cargo-chef cache)
```

**Image tagging strategie:**
- `<git-sha>` — jediný produkční deploy tag (immutable)
- `v1.2.3` — volitelný release alias pro milníky

**Registry policy:**
- GHCR repository je **private**
- VPS má read-only token pouze pro pull image (GitHub PAT / Deploy token)
- CI má write token pro push image
- **Automatický cleanup**: v GHCR bude nastavena retention policy (např. pomocí GitHub Action
  `delete-package-versions`), která automaticky maže image starší než např. 30 dní
  (nebo ponechá jen posledních 30), aby se zamezilo nekonečnému růstu storage a nákladům.

### 20.11 Deployment flow na Hetzner VPS

```
AKTUÁLNÍ POSTUP (sekce 16.14, krok 9):
  1. SSH na server
  2. git pull
  3. cargo build --release (~10+ minut)
  4. systemctl restart sazinka-worker

NOVÝ POSTUP:
  1. Push do main → GitHub Actions spustí plně automatický pipeline
  2. CI:
     - buildne worker image s immutable tagem (<git-sha>)
     - spustí DB migrace (Option B)
     - nasadí worker na VPS
     - nasadí `apps/site` + `apps/web` na Cloudflare Pages
  3. Deploy krok na VPS (spuštěný z CI):
     cd /opt/sazinka/infra
     docker compose pull worker              # ~30 sekund
     docker compose up -d worker             # ~2 sekundy
  4. Hotovo. Rollback:
     WORKER_VERSION=<older-git-sha> docker compose up -d --no-deps worker
```

Zero-downtime restart: Worker zpracovává NATS zprávy. Při restartu se
odpojí od NATS, přestane dostávat zprávy, nový kontejner se připojí
a začne zpracovávat. JetStream garantuje at-least-once delivery pro
asynchronní joby — nic se neztratí.

**Ošetření frontendu (UX)**:
Jelikož WebSocket spojení směrem na NATS proxy (Caddy/NATS) zůstane i při restartu
workeru aktivní, uživateli spojení "nespadne". Nicméně případný request/reply call
(odeslání formuláře) zůstane krátce bez odezvy (~2 vteřiny), než naběhne nový worker kontejner
a začne zprávy obsluhovat.

**Cíl pro UX**: Ve frontend aplikaci (React/Zustand) budeme globálně zachytávat krátké
timeouty na NATS req/replies a vypisovat non-intrusive toast s uklidňující zprávou.
Doporučení: kanonický text toastu uložit do `PRJ_UX.MD` (sekce hlášení při nedostupnosti),
DevOps plán odkazuje na ni. UX copy tak zůstává v jednom místě.

### 20.12 Co se odstraní / změní

```
ODSTRANÍ SE                                  NAHRADÍ SE
─────────────────────────────────────────── ────────────────────────────────────
/etc/systemd/system/sazinka-worker.service   Docker Compose service (worker)
Rust toolchain na VPS                        (nepotřeba — build v CI)
cargo build --release na VPS                 docker compose pull
worker/.env.prod na VPS                      environment v compose + .env.prod
Sekce 16.13 (systemd service)               Tato sekce (20.x)
Sekce 16.14 krok 9 (compile + start)        docker compose pull + up
Manuální deploy backend/frontend             CI/CD pipeline bez manuálních kroků

ZMĚNÍ SE
─────────────────────────────────────────── ────────────────────────────────────
worker/Cargo.toml: native-tls → rustls      Menší image, žádná libssl
docker-compose.prod.yml                      + worker service
Sekce 16.2 architektura diagram             Worker uvnitř Docker Compose
GHCR policy                                  private registry + immutable tags
infra/Caddyfile                              Jen api.sazinka.cz (NATS proxy) +
                                             monitor.sazinka.cz; statické soubory
                                             nyní na Cloudflare Pages
```

### 20.13 Pořadí implementace

```
Krok  Úkon                                              Riziko    Rozsah
───── ─────────────────────────────────────────────────  ───────── ──────────────
 1    Cargo.toml: native-tls → rustls                   Nízké     1 řádek
      Otestovat: cargo build + cargo test lokálně

 2    Vytvořit worker/Dockerfile (multi-stage)           Nízké     1 nový soubor
      Build context: docker build -f worker/Dockerfile worker
      Otestovat: docker run s lokálními službami

 3    Vytvořit worker/.dockerignore                      Žádné     1 nový soubor
      (target/, .env, .git)

 4    Implementovat CLI flag --migrate-only (clap)       Nízké     worker/src/main.rs
      Spustí migrace a okamžitě exit(0)

 5    Aktualizovat / vytvořit infra/docker-compose.prod.yml  Střední  1 soubor
      Přidat worker service, ověřit depends_on, mem_limit

 6    Aktualizovat infra/Caddyfile pro novou architekturu  Nízké    1 soubor
      Odstranit sazinka.cz a app.sazinka.cz bloky (nyní Cloudflare Pages)
      Ponechat jen api.sazinka.cz (/nats proxy) + monitor.sazinka.cz

 7    Vytvořit .github/workflows/deploy-worker.yml       Střední   1 nový soubor
      Jediný workflow s podmíněnými kroky (path filters)

 8    Vytvořit Postgres role: sazinka_admin, sazinka_app  Střední  init/migration
      Oprávnění viz 20.7

 9    Otestovat end-to-end na staging/lokálně             Střední   ověření
      docker compose -f infra/docker-compose.prod.yml up -d
      Ověřit: worker, migrace, NATS, Postgres, Caddy

10    Nasadit na Hetzner VPS                              Střední   provoz
      Pull image, spustit, ověřit funkčnost

11    Odstranit systemd service z dokumentace             Žádné     dokumentace
      Aktualizovat sekce 16.13, 16.14, 16.5 (Caddyfile)
```

### 20.14 Rizika a mitigace

```
RIZIKO                                    MITIGACE
───────────────────────────────────────── ──────────────────────────────────────
Build v CI trvá příliš dlouho             cargo-chef pro cache závislostí;
(vrp-pragmatic je velký crate)            GitHub Actions larger runners

Docker Hub / GHCR rate limit              Self-hosted registry jako fallback;
                                          nebo build přímo na VPS jako nouzový plán

Worker crash loop v kontejneru            restart: unless-stopped + health check;
                                          docker compose logs pro diagnostiku

Migrace selžou v CI jobu                  Deploy se zastaví před rolloutem workeru;
                                          bezpečný fail-fast + rollback bez změny runtime

rustls nekompatibilita s Nominatim/       Velmi nepravděpodobné (standardní HTTPS);
Valhalla self-signed cert                 v Docker síti je komunikace přes HTTP
                                          (ne HTTPS) → TLS backend se nepoužívá

Ztráta zpráv při restartu workeru         JetStream at-least-once delivery;
                                          request-reply: klient retry po timeout
```

### 20.15 Stavové služby: Postgres, Nominatim, Valhalla

Provozní pravidlo: všechny kontejnery kromě datových služeb jsou stateless.

- **Postgres**: stateful (trvalý volume), jediný zdroj business dat.
- **Nominatim**: stateful (trvalý volume), geodata cache; rebuild je časově drahý.
- **Valhalla**: stateful (trvalý volume), routing tiles; rebuild je časově drahý.
- **NATS**: semi-stateful (trvalý volume `nats_jetstream`). JetStream uchovává nevyřízené
  asynchronní joby (geocoding, Valhalla, VRP). Ztráta volume = ztráta rozpracovaných jobů.
- **Worker, Caddy**: stateless kontejnery (stav mimo kontejner).

Nominatim/Valhalla nejsou primární business data, ale kvůli dlouhému buildu
se provozně chovají jako stateful služby a jejich volumes jsou **chráněné**.

### 20.16 Ochrana volumes pro Nominatim, Valhalla a NATS JetStream

**Chráněné volumes:**
- `sazinka_nominatim_data` — geodata ČR (~2 GB, rebuild ~2 hodiny)
- `sazinka_valhalla_tiles` — routing tiles (~8 GB, rebuild ~15 minut)
- `sazinka_nats_jetstream` — nevyřízené async joby (geocoding, VRP, Valhalla geometry)

**Zakázané operace v běžném deployi:**
- `docker compose down -v`
- `docker volume rm sazinka_nominatim_data`
- `docker volume rm sazinka_valhalla_tiles`
- `docker volume rm sazinka_nats_jetstream`
- `docker system prune --volumes`

**Povolené operace v CI/CD deployi:**
- `docker compose pull`
- `docker compose up -d`
- restart konkrétních služeb bez mazání volumes

**Refresh geodat (samostatný maintenance workflow, ne běžný deploy):**
1. explicitní schválení změny
2. snapshot/záloha volume
3. řízený rebuild Nominatim/Valhalla
4. health check po rebuild
5. rollback ze snapshotu při problému

Tím je zachována plná automatizace CI/CD bez rizika nechtěného smazání
časově náročně buildovaných geodat.

---

## 21. TDD implementační plán — Containerizace Workeru

> **Stav**: IMPLEMENTACE PROBÍHÁ
> Tento plán pokrývá kroky ze sekce 20.13 rozepsané do TDD cyklů
> (Red → Green → Refactor → Verify). Každá fáze je atomická a commitovatelná.
>
> **Legenda stavu**: ✅ Hotovo | 🔄 Probíhá | ⏳ Čeká

### 21.1 Fáze 1: native-tls → rustls ✅

**Cíl**: Odstranit závislost na systémovém OpenSSL. Prerekvizit pro minimální Docker image.

**Existující stav**:
- `worker/Cargo.toml` řádek 54: `reqwest = { ... features = ["json", "native-tls"] }`
- Worker komunikuje s Nominatim (`http://`) a Valhalla (`http://`) — vše HTTP, ne HTTPS.
- V Docker síti se TLS backend nepoužívá.

**RED** — Ověřit že stávající testy procházejí:
```
cd worker
cargo test
```
Poznamenat si výstup (baseline).

**GREEN** — Změna jednoho řádku:
```
Soubor: worker/Cargo.toml
Změna:  "native-tls" → "rustls-tls"
```

**REFACTOR** — Odstranit komentář `// using native-tls to avoid ring compilation`
(už neplatí).

**VERIFY**:
```
cargo build                          # Kompilace bez chyb
cargo test                           # Všechny testy stále zelené
```

**Commit**: `chore: switch reqwest from native-tls to rustls-tls`

---

### 21.2 Fáze 2: CLI flag --migrate-only ✅

**Cíl**: Worker binárka podporuje `sazinka-worker migrate` — spustí DB migrace a ukončí se
s exit code 0 (úspěch) nebo 1 (chyba). Prerekvizit pro Option B migraci v CI.

**Existující stav**:
- `worker/src/cli.rs`: `Cli` struct s `Option<Command>`, varianty `Serve` a `CreateAdmin`.
- `worker/src/main.rs`: match na `cli.command`, `run_migrations()` se volá v `CreateAdmin`
  i v `run_server()`.
- `worker/src/db/mod.rs`: `run_migrations(pool)` — hotová funkce.

#### Krok 2a: Přidat `Migrate` variantu do CLI

**RED** — Napsat unit test v `worker/src/cli.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn test_cli_migrate_command_parses() {
        let cli = Cli::parse_from(["sazinka-worker", "migrate"]);
        assert!(matches!(cli.command, Some(Command::Migrate)));
    }

    #[test]
    fn test_cli_no_command_defaults_to_none() {
        let cli = Cli::parse_from(["sazinka-worker"]);
        assert!(cli.command.is_none());
    }

    #[test]
    fn test_cli_serve_command_parses() {
        let cli = Cli::parse_from(["sazinka-worker", "serve"]);
        assert!(matches!(cli.command, Some(Command::Serve)));
    }
}
```
Test `test_cli_migrate_command_parses` SELŽE — varianta `Migrate` neexistuje.

**GREEN** — Přidat variantu do `worker/src/cli.rs`:
```rust
#[derive(Subcommand)]
pub enum Command {
    /// Start the worker server (default if no subcommand given)
    Serve,
    /// Run database migrations and exit
    Migrate,
    /// Create or update an admin user interactively
    CreateAdmin {
        #[arg(long)]
        email: String,
    },
}
```

**VERIFY**: `cargo test` — všechny 3 CLI testy zelené.

#### Krok 2b: Zapojit `Migrate` do main.rs

**RED** — Compile check: `cargo build` projde, ale `Migrate` varianta není v match armu
(compiler warning o non-exhaustive pattern, nebo `_` wildcard pokud existuje).
Aktuálně match arm je:
```rust
match cli.command {
    Some(cli::Command::CreateAdmin { email }) => { ... }
    Some(cli::Command::Serve) | None => run_server(config, pool).await,
}
```
Přidání `Migrate` do `Command` enum způsobí compiler error (non-exhaustive patterns)
protože `Some(Command::Migrate)` není pokryt. To je náš "RED" stav.

**GREEN** — Přidat arm do match v `worker/src/main.rs`:
```rust
match cli.command {
    Some(cli::Command::Migrate) => {
        db::run_migrations(&pool).await?;
        info!("Migrations complete, exiting.");
        Ok(())
    }
    Some(cli::Command::CreateAdmin { email }) => {
        db::run_migrations(&pool).await?;
        admin::create_admin_interactive(&pool, &email).await
    }
    Some(cli::Command::Serve) | None => run_server(config, pool).await,
}
```

Poznámka: `Migrate` arm nevolá `run_server()`, neinicializuje tracing appender
(logy jdou jen na stdout přes default subscriber), nepřipojuje se k NATS.
Pouze: connect DB → run migrations → exit.

**REFACTOR** — Zvážit přesun inicializace tracing do `run_server()` místo
před match (aby `migrate` nepotřeboval LOGS_DIR). Aktuálně tracing se inicializuje
uvnitř `run_server()`, takže refactor není nutný.

**VERIFY**:
```
cargo build
cargo test
# Manuální test (vyžaduje běžící PostgreSQL):
cargo run -- migrate          # Mělo by vypsat "Migrations complete, exiting." a skončit
echo $?                       # Mělo by být 0
```

**Commit**: `feat: add 'migrate' CLI subcommand for CI/CD pipeline migrations`

---

### 21.3 Fáze 3: Dockerfile ✅

**Cíl**: Multi-stage Dockerfile s cargo-chef. Build context = monorepo root `.`
(worker/ byl původní plán, ale worker embeduje `packages/countries/countries.json`
via `include_str!`, takže kontext musí zahrnovat oba adresáře).

**Existující stav**: Žádný `worker/Dockerfile`.

**RED** — Ověřit že build selže (soubor neexistuje):
```
docker build -f worker/Dockerfile worker
# → ERROR: failed to solve: failed to read dockerfile
```

**GREEN** — Vytvořit `worker/Dockerfile` dle specifikace v sekci 20.4.

**VERIFY** (postupně):
```
# 1. Image se builduje bez chyb
docker build -t sazinka-worker:test -f worker/Dockerfile worker

# 2. Image obsahuje binárku
docker run --rm sazinka-worker:test sazinka-worker --help
# → Mělo by vypsat clap help text

# 3. Image běží pod non-root userem
docker run --rm sazinka-worker:test whoami
# → "sazinka"

# 4. Image size je rozumná
docker images sazinka-worker:test --format "{{.Size}}"
# → Očekáváno ~50-80 MB

# 5. Migrate command funguje (vyžaduje přístup k DB)
docker run --rm --network host \
  -e DATABASE_URL=postgres://sazinka:sazinka_dev@localhost:5432/sazinka \
  sazinka-worker:test sazinka-worker migrate
# → "Migrations complete, exiting." + exit code 0
```

**Commit**: `feat: add multi-stage Dockerfile with cargo-chef`

---

### 21.4 Fáze 4: .dockerignore ✅

**Cíl**: Zmenšit build context, zabránit leaku secrets do image.
Soubor je v root monorepa (`.dockerignore`), ne v `worker/`, protože build context je root.

**RED** — Ověřit velikost build contextu bez ignore:
```
docker build -f worker/Dockerfile worker 2>&1 | grep "transferring context"
# → Veliký context (stovky MB kvůli target/)
```

**GREEN** — Vytvořit `worker/.dockerignore`:
```
target/
.env
.env.*
.git/
*.log
```

**VERIFY**:
```
docker build -f worker/Dockerfile worker 2>&1 | grep "transferring context"
# → Malý context (~pár MB)

# Ověřit že .env není v image
docker run --rm sazinka-worker:test ls -la /app/.env 2>&1
# → "No such file" nebo permission denied
```

**Commit**: `chore: add worker/.dockerignore`

---

### 21.5 Fáze 5: docker-compose.prod.yml

**Cíl**: Produkční compose soubor se worker service. Caddy, NATS, Postgres,
Nominatim, Valhalla + nový worker container.

**Existující stav**:
- `infra/docker-compose.yml` — dev konfigurace (porty na localhost, dev hesla).
- `infra/docker-compose.prod.yml` — neexistuje (popsán v sekci 16.4, nikdy nevytvořen).

**RED** — Ověřit že prod compose neexistuje:
```
docker compose -f infra/docker-compose.prod.yml config
# → ERROR: file not found
```

**GREEN** — Vytvořit `infra/docker-compose.prod.yml` dle specifikace v sekci 16.4 + 20.5.
Klíčové rozdíly oproti dev:
- Žádné publikované porty kromě Caddy (80, 443).
- Worker service s `${WORKER_VERSION:?}`.
- Hesla přes `${PROMĚNNÁ:?}` (vyžadují .env.prod).
- `sazinka_net` bridge síť.
- `mem_limit` místo `deploy.resources`.

**VERIFY** (syntax check — bez skutečného startu):
```
# Vytvořit minimální .env.prod pro validaci
cat > /tmp/test.env <<EOF
WORKER_VERSION=test
POSTGRES_USER=sazinka
POSTGRES_PASSWORD=test
POSTGRES_DB=sazinka
JWT_SECRET=test-secret-at-least-32-bytes-long!!!
NATS_WORKER_PASSWORD=test
NATS_BROWSER_PASSWORD=test
NOMINATIM_PASSWORD=test
EOF

docker compose --env-file /tmp/test.env -f infra/docker-compose.prod.yml config
# → Validní YAML, žádné chyby

# Ověřit že worker service existuje v konfiguraci
docker compose --env-file /tmp/test.env -f infra/docker-compose.prod.yml config \
  --services | grep worker
# → "worker"
```

**Commit**: `feat: add production docker-compose with worker service`

---

### 21.6 Fáze 6: Caddyfile pro novou architekturu

**Cíl**: Caddy na VPS obsluhuje pouze `api.sazinka.cz` (NATS WebSocket proxy)
a volitelně `monitor.sazinka.cz` (NATS monitoring s basic auth).
Statické soubory pro `sazinka.cz` a `app.sazinka.cz` jsou na Cloudflare Pages.

**Existující stav**: `infra/Caddyfile` neexistuje jako soubor (byl popsán
v sekci 16.5, ale nikdy nevytvořen).

**RED** — Caddy kontejner nemá konfiguraci:
```
ls infra/Caddyfile
# → No such file
```

**GREEN** — Vytvořit `infra/Caddyfile`:
```
# api.sazinka.cz — NATS WebSocket proxy
api.sazinka.cz {
    # NATS WebSocket proxy (wss:// → ws://)
    handle /nats/* {
        uri strip_prefix /nats
        reverse_proxy nats:8222
    }

    # Deny everything else
    handle {
        respond "Not Found" 404
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}

# monitor.sazinka.cz — NATS monitoring (basic auth)
monitor.sazinka.cz {
    basicauth {
        admin {$MONITOR_PASSWORD_HASH}
    }
    reverse_proxy nats:8223
}
```

**VERIFY**:
```
# Validace Caddyfile syntaxe (vyžaduje caddy binárku nebo Docker)
docker run --rm -v $(pwd)/infra/Caddyfile:/etc/caddy/Caddyfile:ro \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
# → "Valid configuration"
```

**Commit**: `feat: add production Caddyfile for api.sazinka.cz`

---

### 21.7 Fáze 7: PostgreSQL role (sazinka_admin, sazinka_app)

**Cíl**: Dva DB uživatelé — `sazinka_admin` (DDL pro migrace) a `sazinka_app`
(DML pro runtime worker). Princip nejmenších oprávnění.

**Existující stav**:
- `infra/init-db.sql` — jen UUID extension + health check funkce.
- Jediný DB user `sazinka` (superuser-like, vytvořen Postgres kontejnerem).

**RED** — Ověřit že role neexistují:
```
docker exec sazinka-postgres psql -U sazinka -d sazinka \
  -c "SELECT rolname FROM pg_roles WHERE rolname IN ('sazinka_admin','sazinka_app');"
# → 0 rows
```

**GREEN** — Vytvořit migraci `worker/migrations/026_add_db_roles.sql`:
```sql
-- Create migration role (DDL rights for CI migration job)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sazinka_admin') THEN
    CREATE ROLE sazinka_admin LOGIN PASSWORD 'PLACEHOLDER_CHANGE_VIA_ENV';
  END IF;
END $$;

GRANT CONNECT ON DATABASE sazinka TO sazinka_admin;
GRANT ALL PRIVILEGES ON SCHEMA public TO sazinka_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO sazinka_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO sazinka_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO sazinka_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO sazinka_admin;

-- Create runtime role (DML only — no schema changes)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sazinka_app') THEN
    CREATE ROLE sazinka_app LOGIN PASSWORD 'PLACEHOLDER_CHANGE_VIA_ENV';
  END IF;
END $$;

GRANT CONNECT ON DATABASE sazinka TO sazinka_app;
GRANT USAGE ON SCHEMA public TO sazinka_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sazinka_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sazinka_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sazinka_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sazinka_app;
```

Poznámka: Hesla `PLACEHOLDER_CHANGE_VIA_ENV` budou po migraci přepsána
přes `ALTER ROLE ... PASSWORD ...` v rámci VPS setupu (SOPS secrets).

**VERIFY**:
```
# Spustit migrace
cd worker && cargo run -- migrate

# Ověřit role existují
docker exec sazinka-postgres psql -U sazinka -d sazinka \
  -c "SELECT rolname FROM pg_roles WHERE rolname IN ('sazinka_admin','sazinka_app');"
# → 2 rows

# Ověřit sazinka_app NEMÁ DDL práva
docker exec sazinka-postgres psql -U sazinka_app -d sazinka \
  -c "CREATE TABLE _test_ddl_denied (id int);" 2>&1
# → ERROR: permission denied

# Ověřit sazinka_app MÁ DML práva (příklad)
docker exec sazinka-postgres psql -U sazinka_app -d sazinka \
  -c "SELECT COUNT(*) FROM users;"
# → 0 nebo N rows, bez chyby

# Ověřit sazinka_admin MÁ DDL práva
docker exec sazinka-postgres psql -U sazinka_admin -d sazinka \
  -c "CREATE TABLE _test_ddl_allowed (id int); DROP TABLE _test_ddl_allowed;"
# → CREATE TABLE + DROP TABLE bez chyb
```

**Commit**: `feat: add sazinka_admin and sazinka_app Postgres roles`

---

### 21.8 Fáze 8: GitHub Actions workflow

**Cíl**: Jediný workflow pro celý deploy. Podmíněné kroky podle změněných souborů.
Plně automatický: build → migrate → deploy VPS → deploy Cloudflare.

**Existující stav**: Žádný `.github/workflows/` adresář.

**RED** — Push do main nespustí žádný workflow:
```
gh run list --limit 5
# → Žádné runs, nebo jen existující runs
```

**GREEN** — Vytvořit `.github/workflows/deploy.yml`:

```yaml
# Struktura workflow (pseudokód):
name: Deploy
on:
  push:
    branches: [main]
    paths:
      - 'worker/**'
      - 'apps/site/**'
      - 'apps/web/**'
      - 'packages/**'

jobs:
  changes:
    # Detekce změněných souborů (dorny/paths-filter nebo custom)
    # Výstup: worker_changed, site_changed, app_changed

  build-worker:
    needs: changes
    if: needs.changes.outputs.worker_changed == 'true'
    # 1. Checkout
    # 2. Docker Buildx
    # 3. Login to GHCR (private)
    # 4. Build + push: ghcr.io/<org>/sazinka-worker:<git-sha>
    # Cache: GitHub Actions cache

  migrate-db:
    needs: build-worker
    if: needs.changes.outputs.worker_changed == 'true'
    # 1. SSH do VPS
    # 2. docker pull ghcr.io/<org>/sazinka-worker:<git-sha>
    # 3. docker run --rm --network sazinka_net \
    #      -e DATABASE_URL=postgres://sazinka_admin:...@postgres:5432/sazinka \
    #      ghcr.io/<org>/sazinka-worker:<git-sha> migrate
    # 4. Pokud exit != 0 → fail pipeline

  deploy-worker:
    needs: migrate-db
    if: needs.changes.outputs.worker_changed == 'true'
    # 1. SSH do VPS
    # 2. Aktualizovat WORKER_VERSION v .env.prod
    # 3. docker compose pull worker
    # 4. docker compose up -d worker
    # 5. Health check: docker ps --filter name=sazinka-worker --format "{{.Status}}"

  deploy-site:
    needs: changes
    if: needs.changes.outputs.site_changed == 'true'
    # Cloudflare Pages deploy (wrangler pages deploy)
    # Project: sazinka-site
    # Build: cd apps/site && pnpm install && pnpm build
    # Output: apps/site/dist

  deploy-app:
    needs: changes
    if: needs.changes.outputs.app_changed == 'true'
    # Cloudflare Pages deploy (wrangler pages deploy)
    # Project: sazinka-app
    # Build: cd apps/web && pnpm install && pnpm build
    # Output: apps/web/dist
    # Env: VITE_NATS_WS_URL=wss://api.sazinka.cz/nats
```

**GitHub Secrets (nutné nastavit)**:
```
GHCR_TOKEN          — GitHub PAT s packages:write (pro push image)
VPS_SSH_KEY         — Privátní SSH klíč pro deploy user na Hetzner
VPS_HOST            — IP adresa Hetzner VPS
VPS_USER            — Deploy user (sazinka)
CF_API_TOKEN        — Cloudflare API token s Pages:write
CF_ACCOUNT_ID       — Cloudflare account ID
MIGRATION_DB_URL    — postgres://sazinka_admin:PASS@postgres:5432/sazinka
```

**VERIFY**:
```
# Syntax check workflow
gh workflow list
# → "Deploy" workflow se zobrazí

# Dry run (push do feature branch + PR)
git checkout -b test/ci-workflow
git add .github/workflows/deploy.yml
git commit -m "test: add deploy workflow"
git push -u origin test/ci-workflow
gh pr create --title "Test CI workflow" --body "Testing deploy workflow"
# → PR vytvoří preview run (pokud paths match)

# Ověřit job graph v GitHub Actions UI
```

**Commit**: `feat: add unified deploy workflow (GitHub Actions)`

---

### 21.9 Fáze 9: End-to-end test lokálně

**Cíl**: Celý produkční stack běží lokálně přes docker-compose.prod.yml.
Worker se připojí k NATS + Postgres, migrace proběhnou, WebSocket proxy funguje.

**Prerekvizity**: Fáze 1-7 dokončeny. Lokálně buildnutý worker image.

**RED** — Stack se nespustí (ještě nebyl testován jako celek):
```
docker compose --env-file infra/.env.test -f infra/docker-compose.prod.yml up -d
docker compose -f infra/docker-compose.prod.yml ps
# → Některé služby nemusí být healthy
```

**GREEN** — Krok za krokem:

```
# 1. Vytvořit testovací .env
cat > infra/.env.test <<EOF
WORKER_VERSION=test
POSTGRES_USER=sazinka
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_DB=sazinka
JWT_SECRET=$(openssl rand -base64 48)
NATS_WORKER_PASSWORD=$(openssl rand -hex 12)
NATS_BROWSER_PASSWORD=$(openssl rand -hex 12)
NOMINATIM_PASSWORD=$(openssl rand -hex 12)
RUST_LOG=info,sazinka_worker=debug
EOF

# 2. Build lokální worker image s tagem "test"
docker build -t ghcr.io/<org>/sazinka-worker:test -f worker/Dockerfile worker

# 3. Spustit stack
docker compose --env-file infra/.env.test -f infra/docker-compose.prod.yml up -d

# 4. Počkat na health checks
sleep 30
docker compose -f infra/docker-compose.prod.yml ps
```

**VERIFY checklist**:
```
# A) Postgres healthy
docker exec sazinka-postgres pg_isready -U sazinka
# → "accepting connections"

# B) NATS healthy
docker exec sazinka-nats wget -q --spider http://localhost:8223/healthz
# → exit 0

# C) Worker running a připojený
docker logs sazinka-worker 2>&1 | grep "Connected to NATS"
docker logs sazinka-worker 2>&1 | grep "Migrations complete"
# → Obě hlášky přítomny

# D) Worker health check
docker inspect sazinka-worker --format='{{.State.Health.Status}}'
# → "healthy"

# E) Migrace proběhly přes migrate command
docker run --rm --network sazinka_net \
  -e DATABASE_URL=postgres://sazinka:PASS@postgres:5432/sazinka \
  ghcr.io/<org>/sazinka-worker:test migrate
# → "Migrations complete, exiting." + exit 0

# F) Caddy proxy (pokud Caddy je v compose)
# Nelze testovat TLS lokálně bez DNS,
# ale ověřit že Caddy kontejner běží:
docker logs sazinka-caddy 2>&1 | head -5
```

**Teardown**:
```
docker compose --env-file infra/.env.test -f infra/docker-compose.prod.yml down
rm infra/.env.test
```

**Commit**: žádný (testovací fáze)

---

### 21.10 Fáze 10: Nasazení na Hetzner VPS

**Cíl**: Produkční stack běží na Hetzner VPS. CI/CD pipeline úspěšně nasadí
worker image a Cloudflare Pages.

**Prerekvizity**: Fáze 1-9 dokončeny. VPS provisioned (sekce 16.9, 16.14).

**Krok 10a: VPS příprava (jednorázově)**:
```
# SSH na VPS jako deploy user
ssh sazinka@api.sazinka.cz

# Klonovat repo (nebo aktualizovat)
git clone <repo-url> /opt/sazinka
cd /opt/sazinka

# Nainstalovat SOPS + age (sekce 16.7)
# Dešifrovat secrets
export SOPS_AGE_KEY_FILE=/etc/sazinka/age-key.txt
sops -d infra/secrets/.env.production.enc > infra/.env.prod

# Přihlásit se do GHCR (read-only PAT)
echo $GHCR_READ_TOKEN | docker login ghcr.io -u <org> --password-stdin

# Spustit infrastrukturu (bez workeru — ten přijde z CI)
docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d

# Počkat na Nominatim import (~2 hodiny při prvním spuštění)
docker logs -f sazinka-nominatim

# Počkat na Valhalla tile build (~15 minut)
docker logs -f sazinka-valhalla
```

**Krok 10b: DNS nastavení**:
```
api.sazinka.cz      → A record   → IP adresa VPS
sazinka.cz          → CNAME      → sazinka-site.pages.dev (Cloudflare Pages)
www.sazinka.cz      → CNAME      → sazinka-site.pages.dev
app.sazinka.cz      → CNAME      → sazinka-app.pages.dev (Cloudflare Pages)
monitor.sazinka.cz  → A record   → IP adresa VPS
```

**Krok 10c: Ověření CI/CD pipeline**:
```
# Push změnu do main (např. minor worker change)
git checkout main
# ... commit ...
git push origin main

# Sledovat GitHub Actions
gh run watch

# Ověřit deployment
curl -I https://sazinka.cz                    # → 200 (Cloudflare Pages)
curl -I https://app.sazinka.cz                # → 200 (Cloudflare Pages)
curl -I https://api.sazinka.cz/nats           # → 101 Switching Protocols (WS upgrade)
curl -u admin:PASS https://monitor.sazinka.cz/healthz  # → OK
```

**VERIFY checklist**:
```
[ ] https://sazinka.cz se načte (Cloudflare Pages, marketing)
[ ] https://app.sazinka.cz se načte (Cloudflare Pages, login stránka)
[ ] WebSocket připojení z app.sazinka.cz na api.sazinka.cz/nats funguje
[ ] Přihlášení funguje (NATS req/reply přes worker)
[ ] GitHub Actions workflow proběhl bez chyb
[ ] Worker image v GHCR je private a tagged s git-sha
[ ] docker ps na VPS ukazuje všechny služby healthy
[ ] Nominatim geocoding funguje (test adresa)
[ ] Valhalla routing funguje (test route)
```

**Commit**: žádný (operační fáze)

---

### 21.11 Fáze 11: Dokumentace cleanup

**Cíl**: Aktualizovat PRJ_DEVOPS.MD — odstranit/označit zastaralé sekce,
přidat cross-reference na novou architekturu.

**Změny**:
- Sekce 16.2: Poznámka "NAHRAZENO sekcí 20.2" (nová architektura s worker v Dockeru).
- Sekce 16.4: Poznámka "Produkční compose vytvořen v rámci sekce 20.5".
- Sekce 16.5: Poznámka "Caddyfile aktualizován v rámci sekce 21.6" (jen api + monitor).
- Sekce 16.13: Poznámka "NAHRAZENO — worker nyní běží jako Docker kontejner (sekce 20)".
- Sekce 16.14 krok 9: Poznámka "NAHRAZENO — deploy přes CI/CD pipeline (sekce 20.11)".
- Sekce 20: Stav změněn z "PLÁN" na "IMPLEMENTOVÁNO".
- Sekce 21: Stav změněn z "PLÁN" na "IMPLEMENTOVÁNO".
- PRJ_UX.MD: Přidat sekci "Hlášení při krátkém výpadku backendu" s kanonickým textem
  toastu pro 2-vteřinovou nedostupnost při restartu workeru.

**Commit**: `docs: update PRJ_DEVOPS.MD for containerized worker architecture`

---

### 21.12 Souhrn fází a závislostí

```
Fáze  Název                          Typ         Závisí na   Soubory
───── ────────────────────────────── ─────────── ─────────── ────────────────────────
 1    native-tls → rustls            Rust change  —          worker/Cargo.toml
 2    CLI flag --migrate-only        Rust change  —          worker/src/cli.rs
                                                              worker/src/main.rs
 3    Dockerfile                     Infra        1          worker/Dockerfile
 4    .dockerignore                  Infra        —          worker/.dockerignore
 5    docker-compose.prod.yml        Infra        3          infra/docker-compose.prod.yml
 6    Caddyfile                      Infra        —          infra/Caddyfile
 7    PostgreSQL role                DB change    2          worker/migrations/026_*.sql
 8    GitHub Actions workflow        CI/CD        3,5,6,7    .github/workflows/deploy.yml
 9    End-to-end test                Ověření      1-7        (žádný nový soubor)
10    Nasazení na VPS                Provoz       8,9        (konfigurace na serveru)
11    Dokumentace cleanup            Docs         10         PRJ_DEVOPS.MD, PRJ_UX.MD
```

Fáze 1, 2, 4, 6 jsou nezávislé — lze je implementovat paralelně.
Fáze 3 závisí na 1 (rustls musí být v Cargo.toml před Docker buildem).
Fáze 5 závisí na 3 (compose odkazuje worker image).
Fáze 7 závisí na 2 (migrace se spouštějí přes `migrate` command).
Fáze 8 závisí na 3, 5, 6, 7 (workflow musí mít všechny komponenty).
Fáze 9 je validace před produkcí.
Fáze 10 je live deployment.
Fáze 11 je úklid.
