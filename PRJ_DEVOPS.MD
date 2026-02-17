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

### 16.7 Secrets management

**Zásada**: Žádná hesla ani secret hodnoty nesmí být v Git repozitáři.

```bash
# Na serveru vytvořit .env.prod (NENÍ v Gitu):
cat > /opt/sazinka/infra/.env.prod << 'EOF'
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
NOMINATIM_PASSWORD=$(openssl rand -hex 16)
WORKER_NATS_PASSWORD=$(openssl rand -hex 16)
BROWSER_NATS_PASSWORD=$(openssl rand -hex 16)
EOF

# Omezit přístupová práva:
chmod 600 /opt/sazinka/infra/.env.prod
chown sazinka:sazinka /opt/sazinka/infra/.env.prod
```

Spuštění Docker Compose s `.env.prod`:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

Worker `.env` na serveru:

```env
NATS_URL=nats://worker:${WORKER_NATS_PASSWORD}@nats:4222
DATABASE_URL=postgres://sazinka:${POSTGRES_PASSWORD}@postgres:5432/sazinka
JWT_SECRET=${JWT_SECRET}
GEOCODER_BACKEND=nominatim
NOMINATIM_URL=http://nominatim:8080
VALHALLA_URL=http://valhalla:8002
LOGS_DIR=/opt/sazinka/logs
RUST_LOG=info,sazinka_worker=info
```

**Rotace JWT secret**:
1. Vygenerovat nový secret
2. Aktualizovat `.env.prod` a worker `.env`
3. Restartovat worker (`systemctl restart sazinka-worker`)
4. Všechny stávající JWT tokeny se invalidují → uživatelé se musí přihlásit znovu

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

### 17.9 Worker selhává s "migration 1 was previously applied but has been modified"

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
