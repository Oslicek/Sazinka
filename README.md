# Sazinka

CRM and route planning for tradespeople.

## Local development

### Prerequisites
- Node.js 22+
- pnpm 9+
- Rust toolchain (stable)
- Docker Desktop (for PostgreSQL + NATS)

### Setup
1. Install dependencies:
   ```powershell
   pnpm install
   ```

2. Start local infrastructure:
   ```powershell
   docker compose -f infra/docker-compose.yml up -d
   ```

3. Prepare worker env:
   ```powershell
   Copy-Item worker\.env.example worker\.env
   ```

4. Run the Rust worker:
   ```powershell
   cd worker
   cargo run
   ```

5. Run the frontend:
   ```powershell
   cd apps\web
   pnpm dev
   ```

Frontend runs at: http://localhost:5173  
NATS WebSocket: ws://localhost:8222

### Notes
- NATS and PostgreSQL run via Docker Compose.
- The worker uses PostgreSQL for persistence.
- Geocoding uses public Nominatim (limited to 1 req/sec).
