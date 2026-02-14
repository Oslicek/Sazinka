# Podpora více uživatelů – Analýza a implementační plán

> **Vytvořeno:** 2026-02-04
> **Poslední aktualizace:** 2026-02-07
> **Status:** ✅ Implementováno (Fáze 1–4)

---

## 1. Současný stav

Aplikace je **architektonicky připravena na více uživatelů**, ale autentizace není implementována. Všude se používá hardcoded `TEMP_USER_ID = '00000000-0000-0000-0000-000000000001'`.

### Co už existuje

| Oblast | Stav | Detail |
|--------|------|--------|
| DB schéma | ✅ Připraveno | Všechny tabulky mají `user_id` s FK na `users`, kaskádové mazání |
| Tabulka `users` | ✅ Existuje | `email`, `password_hash`, `name`, nastavení, adresa |
| DB dotazy pro uživatele | ✅ Existují | `get_user(id)`, `get_user_by_email(email)` |
| Typ `User` / `UserPublic` | ✅ Existuje | `worker/src/types/user.rs` |
| NATS `Request<T>` | ✅ Obsahuje `userId` | `packages/shared-types/src/messages.ts`, `worker/src/types/messages.rs` |
| Backend handlery | ✅ Validují `user_id` | Vrací `UNAUTHORIZED` pokud chybí |
| SQL dotazy | ✅ Filtrují podle `user_id` | Data izolována |
| Job status subscriptions | ✅ User-scoped | `sazinka.user.${userId}.jobs.>` |

### Co bylo implementováno

| Oblast | Stav |
|--------|------|
| Auth handler na backendu (register, login, verify) | ✅ `worker/src/handlers/auth.rs` |
| Login / registrační stránka | ✅ `apps/web/src/pages/Login.tsx`, `Register.tsx` |
| JWT generování a validace | ✅ `worker/src/auth.rs` (jsonwebtoken + argon2) |
| Auth store ve frontendu (Zustand) | ✅ `apps/web/src/stores/authStore.ts` |
| Protected routes + role guards | ✅ `ProtectedRoute` component, updated `routes/index.tsx` |
| Hashování hesel (Argon2) | ✅ `worker/src/auth.rs` |
| Rate limiting (in-memory) | ✅ `worker/src/handlers/auth.rs` (RateLimiter) |
| Sloupec `role` a `owner_id` v `users` | ✅ `worker/migrations/002_add_auth_fields.sql` |
| Všechny handlery → `extract_auth()` | ✅ 13 handler souborů aktualizováno |
| Odstranění TEMP_USER_ID (22 souborů) | ✅ Všechny nahrazeny `getToken()` |
| Worker management (backend + frontend) | ✅ Backend + Settings tab "Pracovníci" |
| Admin hardening (role check) | ✅ Admin handler vyžaduje `role == "admin"` |
| Settings page role guard | ✅ Pouze customer/admin |

### Rozsah hardcoded `TEMP_USER_ID` (22 souborů)

**Stránky (11):** `Dashboard`, `Calendar`, `Customers`, `CustomerDetail`, `CustomerSummary`, `RevisionDetail`, `Settings`, `Planner`, `PlanningInbox`, `Admin`, `CallQueue`

**Služby (7):** `jobService`, `geometryService`, `routeService`, `exportService`, `visitService`, `communicationService`, `crewService`

**Komponenty (2):** `CustomerPreviewPanel`, `ImportModal`

**Import (2):** `ImportCustomersModal`, `importBatchService`

**Backend (1):** `admin.rs` – `handle_db_reset()`

---

## 2. Rozhodnutí (MVP)

| Otázka | Rozhodnutí |
|--------|-----------|
| Token storage | `localStorage` (JS) – NATS.ws nemá HTTP headers |
| NATS subjects | Neměnit. `user_id` se odvozuje z JWT na backendu |
| Job subjects | Ponechat `sazinka.user.${userId}.jobs.>` – userId z auth store |
| Rate limiting | Jednoduchý in-memory limiter v auth handleru |
| Password reset | Zatím neimplementovat |
| Email confirmation | Zatím neimplementovat |

---

## 3. Role-based access (RBAC)

| Role | Kód | Přístup | Kdo vytváří |
|------|-----|---------|-------------|
| **Admin** | `admin` | Celý systém včetně stránky Admin | Systém / seed |
| **Customer** | `customer` | Svá data + Settings + Workers | Registrace |
| **Worker** | `worker` | Všechny stránky kromě Admin a Settings | Customer |

### Matice přístupu ke stránkám

| Stránka | Admin | Customer | Worker |
|---------|-------|----------|--------|
| Dashboard | ✅ | ✅ | ✅ |
| Zákazníci | ✅ | ✅ | ✅ |
| Detail zákazníka | ✅ | ✅ | ✅ |
| Kalendář | ✅ | ✅ | ✅ |
| Fronta | ✅ | ✅ | ✅ |
| Plán dne | ✅ | ✅ | ✅ |
| Úlohy | ✅ | ✅ | ✅ |
| **Nastavení** | ✅ | ✅ | ❌ |
| **Admin** | ✅ | ❌ | ❌ |
| Login / Register | 🔓 | 🔓 | 🔓 |

### Matice přístupu k backend akcím

| Akce | Admin | Customer | Worker |
|------|-------|----------|--------|
| CRUD zákazníků, zařízení, revizí | ✅ | ✅ | ✅ |
| Plánování tras | ✅ | ✅ | ✅ |
| Import / Export CSV | ✅ | ✅ | ❌ |
| Správa posádek, dep | ✅ | ✅ | ❌ |
| Změna nastavení firmy | ✅ | ✅ | ❌ |
| DB reset, systémové úlohy | ✅ | ❌ | ❌ |
| Správa Workers | ❌ | ✅ | ❌ |

### Datová izolace

- **Customer** vidí jen svá data (filtr `user_id`).
- **Worker** patří ke Customeru – vidí data svého Customera.
- **Admin** vidí vše (bez filtru `user_id`, nebo přes speciální query).

**Důsledek pro DB:**
- Přidat sloupec `role` do tabulky `users`: `VARCHAR(20) NOT NULL DEFAULT 'customer'`
- Pro Workers: přidat sloupec `owner_id UUID REFERENCES users(id)` – FK na Customer, který Workera vytvořil
- Worker dědí `user_id` svého ownera pro datové dotazy (vidí stejná data jako jeho Customer)

---

## 4. Implementační plán

### Fáze 1: DB migrace + backend auth

**Cíl:** Backend podporuje register/login, vrací JWT s rolí, validuje tokeny ve všech handlerech.

#### 1.1 DB migrace

**Soubor:** `worker/migrations/NNN_add_auth_fields.sql`

```sql
-- Role a owner (pro Workers)
ALTER TABLE users ADD COLUMN role VARCHAR(20) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN owner_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_owner ON users(owner_id);

-- Aktualizovat existujícího dev uživatele
UPDATE users SET role = 'admin' WHERE id = '00000000-0000-0000-0000-000000000001';
```

#### 1.2 Nové Rust crates

**Soubor:** `worker/Cargo.toml` – přidat:

```toml
argon2 = "0.5"
jsonwebtoken = "9"
```

#### 1.3 JWT modul

**Nový soubor:** `worker/src/auth.rs`

```
- struct Claims { sub: Uuid, email: String, role: String, exp: usize, iat: usize }
- fn generate_token(user_id, email, role, secret) -> Result<String>
- fn validate_token(token, secret) -> Result<Claims>
- fn hash_password(password) -> Result<String>
- fn verify_password(password, hash) -> Result<bool>
```

`JWT_SECRET` se načte v `Config` z env var.

#### 1.4 Auth handler

**Nový soubor:** `worker/src/handlers/auth.rs`

| NATS subject | Funkce | Vstup | Výstup | Auth? |
|-------------|--------|-------|--------|-------|
| `sazinka.auth.register` | `handle_register` | email, password, name, business_name | JWT + UserPublic | NE |
| `sazinka.auth.login` | `handle_login` | email, password | JWT + UserPublic | NE |
| `sazinka.auth.verify` | `handle_verify` | token | UserPublic | ANO (token) |

**Rate limiting:**
- In-memory `HashMap<String, Vec<Instant>>` (klíč = email nebo IP-like identifikátor)
- Max 5 neúspěšných login pokusů / 5 minut / email
- Po překročení: `ErrorResponse` s kódem `RATE_LIMITED`
- Cleanup starých záznamů periodicky

#### 1.5 Rozšíření `Request<T>`

**Soubor:** `worker/src/types/messages.rs`

```rust
pub struct Request<T> {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub user_id: Option<Uuid>,   // DEPRECATED – ignorovat na backendu
    pub token: Option<String>,   // NOVÉ – JWT access token
    pub payload: T,
}
```

**Soubor:** `packages/shared-types/src/messages.ts`

```typescript
export interface Request<T> {
  id: string;
  timestamp: string;
  userId?: string;    // DEPRECATED
  token?: string;     // NOVÉ
  payload: T;
}
```

#### 1.6 Helper pro extrakci user_id z tokenu

**Soubor:** `worker/src/auth.rs` (rozšíření)

```rust
/// Extrahuje user_id z requestu:
/// 1. Pokud je token → validovat → user_id z claims
/// 2. Pokud je jen user_id (legacy dev) → použít přímo (jen v dev mode)
/// 3. Jinak → UNAUTHORIZED
pub fn extract_user_id(request: &Request<T>, jwt_secret: &str) -> Result<(Uuid, String)>
// Vrací (user_id, role)
```

#### 1.7 Aktualizace handlerů

Každý handler aktuálně dělá:
```rust
let user_id = match request.user_id {
    Some(id) => id,
    None => { /* UNAUTHORIZED */ }
};
```

Nahradit za:
```rust
let (user_id, role) = match auth::extract_user_id(&request, &jwt_secret) {
    Ok(result) => result,
    Err(_) => { /* UNAUTHORIZED */ }
};
```

Handlery, které vyžadují specifickou roli (settings, admin, import), přidají kontrolu:
```rust
if role != "admin" && role != "customer" {
    /* FORBIDDEN */
}
```

**Pozn.:** `jwt_secret` se musí předat jako `Arc<String>` do každého handleru. To vyžaduje úpravu signatur všech `handle_*` funkcí a `start_handlers`.

#### 1.8 Rust typy pro User

**Soubor:** `worker/src/types/user.rs` – rozšíření:

```rust
pub struct User {
    // ... existující pole ...
    pub role: String,
    pub owner_id: Option<Uuid>,
}

pub struct UserPublic {
    // ... existující pole ...
    pub role: String,
}
```

#### 1.9 DB query pro registraci

**Soubor:** `worker/src/db/queries/user.rs` – přidat:

```rust
pub async fn create_user(pool, email, password_hash, name, business_name, role) -> Result<User>
```

#### 1.10 Worker user_id resolution

Když se přihlásí Worker, jeho reálné `user_id` pro datové dotazy je `owner_id` (Customer, který ho vytvořil). Helper:

```rust
pub async fn resolve_data_user_id(pool, user_id, role, owner_id) -> Uuid {
    if role == "worker" { owner_id.unwrap() } else { user_id }
}
```

#### 1.11 Testy (TDD)

**Soubory:**
- `worker/src/auth.rs` – unit testy pro `generate_token`, `validate_token`, `hash_password`, `verify_password`
- `worker/src/handlers/auth.rs` – testy pro register, login, verify, rate limiting

---

### Fáze 2: Frontend auth flow

**Cíl:** Login stránka, auth store, protected routes, role-based navigace.

#### 2.1 Shared types

**Soubor:** `packages/shared-types/src/auth.ts` (nový)

```typescript
export interface LoginRequest { email: string; password: string; }
export interface RegisterRequest { email: string; password: string; name: string; businessName?: string; }
export interface AuthResponse { token: string; user: UserPublic; }
export interface UserPublic { id: string; email: string; name: string; role: string; phone?: string; businessName?: string; }
```

#### 2.2 Auth store

**Nový soubor:** `apps/web/src/stores/authStore.ts`

```typescript
interface AuthState {
  user: UserPublic | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  verify: () => Promise<void>;     // ověřit token z localStorage při startu
  getToken: () => string | null;
  getUserId: () => string;          // pro NATS subscriptions
  getRole: () => string;
}
```

Persistence: `localStorage.setItem('sazinka_token', token)`

#### 2.3 Rozšíření `createRequest`

**Soubor:** `packages/shared-types/src/messages.ts`

```typescript
export function createRequest<T>(token: string | undefined, payload: T): Request<T> {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    token,      // JWT token místo userId
    payload,
  };
}
```

#### 2.4 Auth helper

**Nový soubor:** `apps/web/src/utils/auth.ts`

```typescript
import { useAuthStore } from '@/stores/authStore';

/** Vrátí aktuální token pro NATS requesty */
export function getToken(): string {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  return token;
}

/** Vrátí userId pro NATS subscriptions (job status) */
export function getUserId(): string {
  const user = useAuthStore.getState().user;
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

/** Kontrola role */
export function hasRole(...roles: string[]): boolean {
  const role = useAuthStore.getState().user?.role;
  return role ? roles.includes(role) : false;
}
```

#### 2.5 Login stránka

**Nové soubory:** `apps/web/src/pages/Login.tsx` + `Login.module.css`

- Formulář: email + heslo
- Volá `authStore.login()` → `sazinka.auth.login`
- Redirect na `/` po úspěšném přihlášení
- Zobrazení chybové hlášky (špatné heslo, rate limited)
- Odkaz na registraci

#### 2.6 Registrační stránka

**Nové soubory:** `apps/web/src/pages/Register.tsx` + `Register.module.css`

- Formulář: jméno, email, heslo, název firmy
- Validace (unikátní email, min délka hesla)
- Auto-login po registraci
- Odkaz na login

#### 2.7 Protected routes

**Soubor:** `apps/web/src/routes/index.tsx`

```typescript
// Nové routes
const loginRoute = createRoute({ path: '/login', component: Login });
const registerRoute = createRoute({ path: '/register', component: Register });

// beforeLoad guard na rootRoute:
const rootRoute = createRootRoute({
  beforeLoad: () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated && location.pathname !== '/login' && location.pathname !== '/register') {
      throw redirect({ to: '/login' });
    }
  },
  component: () => <Layout><Outlet /></Layout>,
});

// Role guards:
const adminRoute = createRoute({
  path: '/admin',
  beforeLoad: () => {
    if (!hasRole('admin')) throw redirect({ to: '/' });
  },
  component: Admin,
});

const settingsRoute = createRoute({
  path: '/settings',
  beforeLoad: () => {
    if (!hasRole('admin', 'customer')) throw redirect({ to: '/' });
  },
  component: Settings,
});
```

#### 2.8 Layout – uživatelské menu

**Soubor:** `apps/web/src/components/Layout.tsx`

- Zobrazit jméno přihlášeného uživatele + roli
- Skrýt navigační položky podle role (Admin, Nastavení)
- Přidat tlačítko Odhlásit se
- Po odhlášení redirect na `/login`

#### 2.9 Testy

- `apps/web/src/stores/authStore.test.ts` – login, logout, verify, persistence
- `apps/web/src/pages/Login.test.tsx` – render, submit, error states
- `apps/web/src/routes/guards.test.ts` – protected routes, role redirects

---

### Fáze 3: Odstranění TEMP_USER_ID

**Cíl:** Žádný hardcoded UUID v kódu. Všechny requesty posílají JWT token.

#### 3.1 Refaktor služeb (services)

Všechny služby aktuálně přijímají `userId` jako první parametr:
```typescript
export async function listCustomersExtended(userId: string, options: ...) { ... }
```

**Změna:** Služby budou interně volat `getToken()`:
```typescript
export async function listCustomersExtended(options: ...) {
  const req = createRequest(getToken(), options);
  // ...
}
```

**Alternativa (jednodušší, doporučená):** Ponechat `userId` parametr, ale stránky ho budou brát z `getUserId()` místo konstanty. To minimalizuje diff.

#### 3.2 Úprava 22 souborů

V každém souboru:
1. Smazat `const TEMP_USER_ID = '...'` / `const USER_ID = '...'`
2. Importovat `getToken` / `getUserId` z `@/utils/auth`
3. Nahradit `TEMP_USER_ID` za `getUserId()` v callech
4. Pro `createRequest` volání: předat `getToken()` místo `userId`

#### 3.3 Ověření úplnosti

```bash
rg "TEMP_USER_ID|00000000-0000-0000-0000-000000000001" apps/ packages/
# Musí vrátit 0 výsledků (kromě testů a seed souborů)
```

#### 3.4 Aktualizace testů

Stávající testy (např. `Customers.test.tsx`) mockují `TEMP_USER_ID`. Aktualizovat na mock auth store:

```typescript
vi.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'test-user-id', role: 'customer' }, token: 'test-jwt' }) },
}));
```

#### 3.5 Dev seed aktualizace

**Soubor:** `infra/seed-dev.sql`
- Změnit `password_hash` na reálný argon2 hash pro dev heslo (např. `password123`)
- Přidat `role = 'admin'`

---

### Fáze 4: Worker management (Customer vytváří Workers)

**Cíl:** Customer může ve Settings vytvořit Workers, kteří vidí jeho data.

#### 4.1 Backend

- `sazinka.auth.create_worker` – Customer vytvoří Worker účet (email, heslo, jméno)
  - Backend nastaví `role = 'worker'`, `owner_id = customer.user_id`
- `sazinka.auth.list_workers` – Customer vidí své Workers
- `sazinka.auth.delete_worker` – Customer smaže svého Workera

#### 4.2 Frontend – Settings tab

- Nový tab „Pracovníci" v Settings (viditelný jen pro Customer)
- CRUD: seznam, přidat, smazat Worker
- Formulář: jméno, email, heslo

#### 4.3 Data resolution

Worker přihlášení → backend resolvuje `owner_id` → všechny dotazy filtrují podle `owner_id` místo `user_id`.

---

## 5. Soubory k úpravě – kompletní seznam

### Nové soubory

| Soubor | Fáze | Účel |
|--------|------|------|
| `worker/migrations/NNN_add_auth_fields.sql` | 1 | Přidat `role`, `owner_id` do `users` |
| `worker/src/auth.rs` | 1 | JWT + password hashing |
| `worker/src/handlers/auth.rs` | 1 | Register, login, verify handlers |
| `packages/shared-types/src/auth.ts` | 2 | Auth typy |
| `apps/web/src/stores/authStore.ts` | 2 | Auth store (Zustand) |
| `apps/web/src/utils/auth.ts` | 2 | Helpers: `getToken()`, `getUserId()`, `hasRole()` |
| `apps/web/src/pages/Login.tsx` | 2 | Login stránka |
| `apps/web/src/pages/Login.module.css` | 2 | Login styly |
| `apps/web/src/pages/Register.tsx` | 2 | Registrace |
| `apps/web/src/pages/Register.module.css` | 2 | Registrace styly |

### Existující soubory k úpravě

| Soubor | Fáze | Změna |
|--------|------|-------|
| `worker/Cargo.toml` | 1 | Přidat `argon2`, `jsonwebtoken` |
| `worker/src/main.rs` | 1 | Přidat `mod auth`, načíst `JWT_SECRET` |
| `worker/src/config.rs` | 1 | Přidat `jwt_secret: String` |
| `worker/src/types/messages.rs` | 1 | Přidat `token: Option<String>` do `Request<T>` |
| `worker/src/types/user.rs` | 1 | Přidat `role`, `owner_id` |
| `worker/src/db/queries/user.rs` | 1 | Přidat `create_user`, upravit `get_user` |
| `worker/src/handlers/mod.rs` | 1 | Registrovat auth handler, předat `jwt_secret` |
| **Všechny handlery** (~15 souborů) | 1 | `extract_user_id` místo `request.user_id` |
| `packages/shared-types/src/messages.ts` | 2 | Přidat `token`, upravit `createRequest` |
| `apps/web/src/routes/index.tsx` | 2 | Login/register routes, guards |
| `apps/web/src/components/Layout.tsx` | 2 | User menu, role-based nav, logout |
| **22 frontend souborů** | 3 | Nahradit `TEMP_USER_ID` |
| `infra/seed-dev.sql` | 3 | Reálný hash, `role = 'admin'` |
| `infra/docker-compose.yml` | 1 | Env var `JWT_SECRET` |

### Dokumentace

| Soubor | Změna |
|--------|-------|
| `PROJECT_CONTEXT.MD` | Auth sekce, NATS subjects |
| `PROJECT_ROADMAP.MD` | Phase 3.1 → implementováno |
| `PROJECT_UX.MD` | Login/register flow, role-based UI |

---

## 6. Bezpečnostní požadavky před ostrým provozem

| # | Požadavek | Popis |
|---|-----------|-------|
| 1 | **TLS všude** | NATS s TLS + credentials, HTTPS pro web |
| 2 | **JWT secret management** | `JWT_SECRET` mimo repo, rotace klíčů, min 256 bitů |
| 3 | **Edge rate limiting** | Reverse proxy (Cloudflare / Nginx / Traefik), IP throttling, bot protection |
| 4 | **Audit log** | Logovat login pokusy, změny nastavení, importy/exporty |
| 5 | **Admin endpoint hardening** | `handle_db_reset` pouze pro roli Admin, chráněno tokeny |
| 6 | **Password policy** | Argon2 hash, min 8 znaků, brute-force ochrana (rate limit) |
| 7 | **Secrets** | Secrets v `.env` / vault, nikdy v Gitu |
| 8 | **DB backup** | Pravidelné zálohy, test obnovy |
| 9 | **Monitoring** | Error rate, auth failures, job queue backlogs |
| 10 | **CORS** | Omezit povolené origins pro NATS.ws |

---

## 7. Odhad složitosti

| Fáze | Popis | Rozsah | Riziko |
|------|-------|--------|--------|
| 1 | DB + backend auth | Střední (~15 souborů) | Nízké – přímočará logika |
| 2 | Frontend auth flow | Střední (~8 souborů) | Nízké – standardní pattern |
| 3 | Odstranění TEMP_USER_ID | Velké (22 souborů) | **Střední** – mechanické, ale vynechání = bezp. díra |
| 4 | Worker management | Malé (~5 souborů) | Nízké |

**Pořadí implementace je důležité:** Fáze 1 → 2 → 3 → 4 (každá závisí na předchozí).

Největší riziko: **Fáze 3** – při nahrazování `TEMP_USER_ID` nesmí zůstat žádný hardcoded UUID. Doporučuji TDD + grep kontrolu po dokončení.
