# Sazinka — Security Audit Report

> **Date:** 2026-02-14
> **Scope:** Full codebase (worker, apps/web, packages, infra)
> **Framework:** OWASP Top 10 (2021 edition)
> **Severity Scale:** CRITICAL / HIGH / MEDIUM / LOW / INFO

---

## Executive Summary

This report documents **31 findings** from a full security audit of the Sazinka codebase, organized by the OWASP Top 10 categories from most to least severe.

| Severity     | Count | Immediate Action Required |
|-------------|-------|---------------------------|
| **CRITICAL** | 5     | Yes — exploitable now      |
| **HIGH**     | 7     | Yes — before production    |
| **MEDIUM**   | 11    | Should fix soon            |
| **LOW**      | 5     | Hardening / best practice  |
| **INFO**     | 3     | Acceptable / informational |

The three most urgent issues are: **(1)** unauthenticated NATS bus allowing any network client to impersonate users, **(2)** a hardcoded JWT secret fallback that ships in source code, and **(3)** Insecure Direct Object Reference (IDOR) vulnerabilities in device and work-item handlers that leak cross-tenant data.

---

## Table of Contents

1. [A01 — Broken Access Control](#a01--broken-access-control)
2. [A02 — Cryptographic Failures](#a02--cryptographic-failures)
3. [A03 — Injection](#a03--injection)
4. [A04 — Insecure Design](#a04--insecure-design)
5. [A05 — Security Misconfiguration](#a05--security-misconfiguration)
6. [A06 — Vulnerable and Outdated Components](#a06--vulnerable-and-outdated-components)
7. [A07 — Identification and Authentication Failures](#a07--identification-and-authentication-failures)
8. [A08 — Software and Data Integrity Failures](#a08--software-and-data-integrity-failures)
9. [A09 — Security Logging and Monitoring Failures](#a09--security-logging-and-monitoring-failures)
10. [A10 — Server-Side Request Forgery (SSRF)](#a10--server-side-request-forgery-ssrf)
11. [Positive Findings](#positive-findings)
12. [Remediation Priority](#remediation-priority)

---

## A01 — Broken Access Control

> *#1 in OWASP Top 10. The most common and serious web application vulnerability.*

### SEC-01 · CRITICAL — NATS Bus Has No Authentication or ACL

**File:** `infra/nats-server.conf`

The NATS server configuration contains **zero authentication** — no `authorization {}` block, no `accounts {}` block, no token-based auth. Any client that can reach port 4222 (TCP) or 8222 (WebSocket) can:

- Subscribe to **all** subjects, including `sazinka.admin.*`
- Publish messages impersonating any user
- Read all JetStream data
- Cancel, retry, or view any user's jobs

The browser WebSocket client has the exact same privileges as the backend worker.

**Recommendation:**
- Add token-based NATS authentication (separate tokens for worker and browser).
- Configure subject-level ACLs: browser clients should only access `sazinka.*.request` subjects.
- For production, consider NKeys or NATS JWT-based auth.

---

### SEC-02 · CRITICAL — Legacy `user_id` Fallback Bypasses JWT Authentication

**File:** `worker/src/auth.rs` (lines ~142–149)

If no JWT `token` is present in a NATS message, `extract_auth` silently falls back to an unsecured `user_id` field and grants full `customer`-role access:

```rust
// Fall back to legacy user_id (dev mode)
if let Some(user_id) = request.user_id {
    return Ok(AuthInfo {
        user_id,
        role: "customer".to_string(),
        owner_id: None,
    });
}
```

Any attacker who can send a NATS message with an arbitrary UUID gains full customer-level access. The frontend code in `packages/shared-types/src/messages.ts` (`createRequest`) still routes between token and userId modes.

**Recommendation:**
- Remove the legacy `user_id` fallback entirely.
- If needed for local dev, gate behind a `DEV_MODE=true` environment variable and log a loud warning.
- Remove the `userId` field from the shared `Request` type.

---

### SEC-03 · CRITICAL — Unauthenticated Handlers (Geocode, Jobs, Valhalla)

**File:** `worker/src/handlers/geocode.rs`, `worker/src/handlers/jobs.rs`, `worker/src/handlers/mod.rs`

Multiple handlers accept requests with **no authentication check at all**:

| Handler                         | File                       |
|---------------------------------|----------------------------|
| `handle_geocode_submit`         | `handlers/geocode.rs`      |
| `handle_geocode_address_submit` | `handlers/geocode.rs`      |
| `handle_reverse_geocode_submit` | `handlers/geocode.rs`      |
| `handle_geocode_pending`        | `handlers/geocode.rs`      |
| `handle_job_history`            | `handlers/jobs.rs`         |
| `handle_job_cancel`             | `handlers/jobs.rs`         |
| `handle_job_retry`              | `handlers/jobs.rs`         |
| `handle_valhalla_matrix_submit` | `handlers/mod.rs`          |
| `handle_valhalla_geometry_submit`| `handlers/mod.rs`         |

These handlers don't receive `jwt_secret` and perform zero authentication. Anyone on the NATS bus can cancel/retry jobs, view all job history, submit geocoding requests, and trigger expensive Valhalla computations (resource exhaustion).

**Recommendation:**
- Add `jwt_secret: Arc<String>` parameter and `extract_auth` calls to all handlers.
- Only `handle_ping` should remain unauthenticated.

---

### SEC-04 · CRITICAL — Device Handler IDOR (Cross-Tenant Data Leak)

**File:** `worker/src/handlers/device.rs`, `worker/src/db/queries/device.rs`

The device handler extracts `user_id` from auth but **never passes it to database queries**. The `_user_id` variable is unused:

```rust
let _user_id = match auth::extract_auth(&request, &jwt_secret) {
    Ok(info) => info.data_user_id(),
    // ...
};
```

All device queries operate solely on `customer_id`, meaning any authenticated user can access any other user's devices by enumerating or guessing `customer_id` UUIDs.

**Recommendation:**
- Pass `user_id` to all device queries and add a `WHERE user_id = $N` clause.
- Apply the same fix to `worker/src/db/queries/device.rs`.

---

### SEC-05 · CRITICAL — WorkItem Handler IDOR (Cross-Tenant Data Leak)

**File:** `worker/src/handlers/work_item.rs`

Same pattern as SEC-04. The `_user_id` is extracted but never used. Work item queries filter only by `visit_id` or `revision_id`, allowing any authenticated user to enumerate cross-tenant work items.

**Recommendation:**
- Thread `user_id` through to all work-item database queries.
- Add ownership verification JOIN or WHERE clause.

---

### SEC-06 · HIGH — `handle_job_submit` Uses Soft Authentication

**File:** `worker/src/handlers/jobs.rs` (lines ~766–779)

Authentication failure is silently discarded with `.ok()`:

```rust
let auth_user_id = crate::auth::extract_auth(&request, &jwt_secret)
    .ok()  // <-- auth failure silently ignored
    .map(|auth| auth.user_id);
```

If JWT validation fails, the handler falls through to the legacy `user_id` bypass or even the caller-supplied `job_request.user_id`, enabling full authentication bypass.

**Recommendation:**
- Treat `extract_auth` failure as a hard error — return `UNAUTHORIZED`.
- Never fall back to payload-supplied `user_id`.

---

### SEC-07 · MEDIUM — Domain Handlers Lack Role-Based Checks

**File:** `worker/src/handlers/customer.rs`, `device.rs`, `revision.rs`, `route.rs`, `settings.rs`, `communication.rs`, `visit.rs`, `crew.rs`, `work_item.rs`

All domain handlers call `extract_auth` but only extract `data_user_id()` — they never check the user's `role` or `permissions`. A worker account with limited permissions (e.g., `page:inbox` only) can still create, update, and delete customers, routes, and settings.

**Recommendation:**
- Check `auth_info.role` and `permissions` in each handler.
- Workers should be restricted to operations matching their permission set.

---

### SEC-08 · MEDIUM — No Token Revocation Mechanism

**File:** `worker/src/auth.rs`

Once a JWT is issued (8-hour expiration), there is no way to revoke it. If a user's account is compromised, disabled, or their role changes, all existing tokens remain valid. The `handle_verify` endpoint queries the DB, but `extract_auth` (used everywhere else) only validates signature + expiration.

**Recommendation:**
- Store a `token_version` on the user record; include it in JWT claims.
- On role/permission changes, bump the version to invalidate old tokens.
- Alternatively, implement a Redis-backed token blacklist.

---

### SEC-09 · MEDIUM — Token Refresh Does Not Invalidate Old Token

**File:** `worker/src/handlers/auth.rs` (line ~466)

The refresh endpoint issues a new token but leaves the old one fully valid until its own 8-hour expiration. Both tokens work simultaneously, doubling attack surface if one is leaked.

**Recommendation:**
- Implement refresh-token rotation with opaque server-side refresh tokens.
- Issue short-lived access tokens (15–30 min) with longer refresh tokens.

---

---

## A02 — Cryptographic Failures

> *Failures related to cryptography that lead to sensitive data exposure.*

### SEC-10 · CRITICAL — Hardcoded JWT Secret Fallback

**File:** `worker/src/config.rs` (lines ~41–42)

```rust
let jwt_secret = std::env::var("JWT_SECRET")
    .unwrap_or_else(|_| "dev-secret-change-in-production-min-32-bytes!!".to_string());
```

If `JWT_SECRET` is not set, the application silently uses a publicly-visible secret hardcoded in the source. The same value appears in `infra/docker-compose.yml`. Any attacker can forge valid JWTs for any user, including admin.

**Recommendation:**
- Remove the fallback. Make `JWT_SECRET` a **required** env var using `.context("JWT_SECRET must be set")`.
- Add a startup assertion: `assert!(jwt_secret.len() >= 32)`.
- Warn at startup if the secret matches the known default.

---

### SEC-11 · HIGH — No JWT Secret Minimum Length Enforcement

**File:** `worker/src/config.rs`

No validation of secret length or entropy. A 1-character secret like `"a"` would be accepted, making all tokens trivially brute-forceable.

**Recommendation:**
- Reject secrets shorter than 32 bytes at startup.
- Consider requiring 64+ bytes for HS256.

---

### SEC-12 · HIGH — WebSocket TLS Explicitly Disabled

**File:** `infra/nats-server.conf` (lines ~10–13)

```
websocket {
  port: 8222
  no_tls: true
}
```

Browser-to-NATS communication, including JWT tokens in every message, is transmitted in plaintext.

**Recommendation:**
- Enable TLS on the WebSocket listener for any non-localhost deployment.
- Use `tls { cert_file, key_file }` in the websocket block.

---

### SEC-13 · HIGH — JWT Token Stored in localStorage (XSS Exfiltration Risk)

**File:** `apps/web/src/stores/authStore.ts` (lines ~61, 92, 163)

```typescript
localStorage.setItem(TOKEN_KEY, token);
```

The JWT is stored in `localStorage`, which is accessible to any JavaScript running in the same origin. A single XSS vulnerability anywhere in the application allows full token exfiltration via `localStorage.getItem('sazinka_token')`.

**Recommendation:**
- Move to `httpOnly` cookies for token storage (requires an API proxy layer).
- If localStorage must be used, enforce strict CSP headers and audit all XSS vectors.

---

### SEC-14 · MEDIUM — Argon2 Using Untuned Default Parameters

**File:** `worker/src/auth.rs` (line ~101)

```rust
let argon2 = Argon2::default();
```

`Argon2::default()` uses the library's defaults, which may not meet OWASP recommendations (19 MiB memory, 2 iterations, 1 parallelism).

**Recommendation:**
- Explicitly configure: `Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::new(19456, 2, 1, None).unwrap())`.
- Benchmark on production hardware and increase memory cost if acceptable.

---

### SEC-15 · MEDIUM — Refresh Token Uses Old JWT's Role (Stale Privileges)

**File:** `worker/src/handlers/auth.rs` (line ~468)

The refresh handler issues a new token using `claims.role` from the old JWT rather than querying the user's current role from the database. A downgraded user keeps elevated privileges until all tokens expire.

**Recommendation:**
- Use `user.role` from the database lookup, not `claims.role`.

---

### SEC-16 · INFO — JWT Uses HS256 (Acceptable)

**File:** `worker/src/auth.rs`

`Header::default()` uses HS256. This is appropriate for a single-service architecture. For defense-in-depth, consider explicitly specifying the algorithm: `Header::new(Algorithm::HS256)`.

---

---

## A03 — Injection

> *SQL injection, XSS, command injection, and similar.*

### SEC-17 · MEDIUM — Reverse Geocode Update Lacks Ownership Verification

**File:** `worker/src/handlers/geocode.rs` (reverse geocode update path)

The reverse geocode handler performs an `UPDATE customers SET ...` using a `customer_id` from the request payload without verifying that the customer belongs to the authenticated user. Combined with the unauthenticated geocode handlers (SEC-03), this allows arbitrary modification of any customer's address data.

**Recommendation:**
- Add `AND user_id = $N` to the UPDATE query.
- Require authentication in the geocode handler.

---

### SEC-18 · LOW — No Input Length Validation on String Fields

**File:** `worker/src/handlers/customer.rs`, `auth.rs`, and others

User-supplied strings (names, emails, addresses, notes) are not validated for length before database insertion. An attacker could submit extremely long strings (megabytes) causing memory pressure and potential DB issues.

**Recommendation:**
- Add maximum length validation for all string inputs (e.g., names ≤ 200, emails ≤ 254, addresses ≤ 500, notes ≤ 5000).

---

### SEC-19 · LOW — LIKE Queries Don't Escape Special Characters

**File:** `worker/src/db/queries/customer.rs` and other search queries

Search queries using SQL `LIKE '%' || $1 || '%'` do not escape `%` and `_` characters in user input, allowing search pattern injection. While not a security vulnerability per se, it can cause unexpected behavior and performance issues with crafted inputs.

**Recommendation:**
- Escape `%` and `_` in user-supplied search terms before passing to LIKE.

---

### SEC-20 · INFO — SQL Queries Use Parameterized Bindings (Positive)

All SQL queries in `worker/src/db/queries/` use proper `$N` parameterized bindings via sqlx. No string interpolation or `format!()` is used to build SQL. This effectively prevents SQL injection.

---

### SEC-21 · INFO — No XSS via dangerouslySetInnerHTML (Positive)

No usage of `dangerouslySetInnerHTML`, `innerHTML`, `eval()`, `Function()`, or `new Function()` was found in the React frontend. React's built-in escaping provides baseline XSS protection.

---

---

## A04 — Insecure Design

> *Missing or ineffective security controls at the design level.*

### SEC-22 · MEDIUM — No Content Security Policy (CSP)

**File:** `apps/web/index.html`

No CSP meta tag or HTTP header is configured. Without CSP, any XSS vulnerability can load arbitrary scripts, exfiltrate data, and steal the localStorage-stored JWT.

**Recommendation:**
- Add a strict CSP header: `default-src 'self'; script-src 'self'; connect-src 'self' ws://localhost:8222; style-src 'self' 'unsafe-inline';`
- Serve via a reverse proxy (nginx/caddy) that sets security headers.

---

### SEC-23 · MEDIUM — `createRequest` Token-Detection Heuristic Is Fragile

**File:** `packages/shared-types/src/messages.ts` (lines ~45–56)

```typescript
const isToken = tokenOrUserId && tokenOrUserId.includes('.');
```

The heuristic `includes('.')` to distinguish JWT tokens from UUIDs is fragile and perpetuates the dual-auth model that enables the legacy bypass (SEC-02).

**Recommendation:**
- Remove dual-mode support. Only accept JWT tokens.

---

### SEC-24 · LOW — Role Values Are Unvalidated Strings

**File:** `worker/src/auth.rs`, `worker/src/handlers/auth.rs`

Roles (`admin`, `customer`, `worker`) are plain `String` values with no enum validation. An unexpected role value (e.g., from a DB bug) would bypass all role checks without being blocked.

**Recommendation:**
- Define a `Role` enum in Rust and validate at deserialization.

---

---

## A05 — Security Misconfiguration

> *Default configs, unnecessary features, overly permissive settings.*

### SEC-25 · HIGH — All Docker Ports Bound to 0.0.0.0

**File:** `infra/docker-compose.yml`

All five services expose ports to all network interfaces:

| Service     | Port | Should Be Internal |
|-------------|------|--------------------|
| NATS TCP    | 4222 | Yes                |
| NATS WS     | 8222 | Proxy only         |
| NATS Monitor| 8223 | Yes                |
| PostgreSQL  | 5432 | Yes                |
| Nominatim   | 8080 | Yes                |
| Valhalla    | 8002 | Yes                |

**Recommendation:**
- Bind internal services to localhost: `"127.0.0.1:5432:5432"`, etc.
- Only expose 8222 through a reverse proxy with TLS.

---

### SEC-26 · HIGH — Dev Admin Password Set Unconditionally at Startup

**File:** `worker/src/db/mod.rs` (lines ~31–69)

```rust
/// Ensure the dev admin user has a valid Argon2 password hash.
/// If the hash is invalid, set it to a hash of "password123".
```

Called from `main.rs` with **no environment check**. If seed data exists in production, this resets an admin account's password to `password123` on every startup.

**Recommendation:**
- Gate behind `if std::env::var("DEV_MODE").is_ok()` or remove entirely.
- Never write known passwords in a production code path.

---

### SEC-27 · HIGH — Database Error Details Leaked to Clients

**File:** `worker/src/handlers/auth.rs` (12+ instances), and other handler files

```rust
let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
```

Raw database error strings are sent directly to clients, potentially exposing table names, column names, SQL constraints, and connection details.

**Recommendation:**
- Log the full error server-side (`error!("{:?}", e)`).
- Return only a generic message to clients: `"An internal error occurred"`.

---

### SEC-28 · MEDIUM — Weak Default Passwords in Git-Tracked Docker Compose

**File:** `infra/docker-compose.yml`

```yaml
POSTGRES_PASSWORD: sazinka_dev
NOMINATIM_PASSWORD: nominatim_dev
JWT_SECRET: dev-secret-change-in-production-min-32-bytes!!
```

Predictable passwords committed to git. Combined with SEC-25 (ports on 0.0.0.0), these are directly exploitable.

**Recommendation:**
- Use env var substitution: `${POSTGRES_PASSWORD:-sazinka_dev}`.
- Document that production must override all secrets.
- Use a gitignored `.env` file for docker-compose.

---

### SEC-29 · MEDIUM — Config and LoginRequest Structs Derive Debug (Leak Secrets in Logs)

**File:** `worker/src/config.rs` (line ~6), `worker/src/handlers/auth.rs` (line ~28)

```rust
#[derive(Debug, Clone)]
pub struct Config {
    pub jwt_secret: String,
    pub database_url: String,  // contains password
    // ...
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoginRequest {
    pub password: String,
    // ...
}
```

Any `debug!("{:?}", config)` or panic backtrace exposes secrets.

**Recommendation:**
- Implement custom `Debug` that redacts sensitive fields.
- Or wrap secrets in a `Secret<String>` newtype.

---

### SEC-30 · MEDIUM — .gitignore Doesn't Cover `.env.production` / `.env.staging`

**File:** `.gitignore`

The pattern `.env.*.local` only matches files like `.env.production.local`. Files named `.env.production` or `.env.staging` would **not** be ignored and could be accidentally committed with real secrets.

**Recommendation:**
- Add: `.env.production`, `.env.staging`, or use a catch-all `.env*` with `!.env.example` exception.

---

### SEC-31 · MEDIUM — NATS Monitoring Endpoint Exposed Without Auth

**File:** `infra/nats-server.conf` (line ~38)

```
http_port: 8223
```

The NATS monitoring HTTP endpoint provides server status, connection info, subscription details — all unauthenticated.

**Recommendation:**
- Bind to localhost only, or disable in production.

---

### SEC-32 · MEDIUM — Valhalla Image Uses `:latest` Tag

**File:** `infra/docker-compose.yml` (line ~96)

```yaml
image: ghcr.io/gis-ops/docker-valhalla/valhalla:latest
```

Non-reproducible builds; a compromised upstream update could affect deployment.

**Recommendation:**
- Pin to a specific version tag.

---

### SEC-33 · MEDIUM — Real Dev Credentials in .env.example

**File:** `worker/.env.example`

```
DATABASE_URL=postgres://sazinka:sazinka_dev@localhost:5432/sazinka
```

The example file contains actual dev credentials instead of placeholders.

**Recommendation:**
- Use: `DATABASE_URL=postgres://user:password@localhost:5432/dbname`.

---

---

## A06 — Vulnerable and Outdated Components

### SEC-34 · LOW — No Automated Dependency Auditing

No `cargo audit` or `npm audit` is configured in CI/CD. Dependency vulnerabilities may go undetected.

**Recommendation:**
- Add `cargo audit` to CI pipeline.
- Add `npm audit --audit-level=high` to CI pipeline.
- Consider Dependabot or Renovate for automated PRs.

---

### SEC-35 · LOW — Missing Resource Limits on PostgreSQL and NATS Containers

**File:** `infra/docker-compose.yml`

Nominatim (4G) and Valhalla (10G) have memory limits, but PostgreSQL and NATS have none. A memory leak or runaway query could consume all host resources.

**Recommendation:**
- Add `deploy.resources.limits.memory` for postgres and nats services.

---

---

## A07 — Identification and Authentication Failures

> *Weaknesses in authentication mechanisms.*

### SEC-36 · MEDIUM — Rate Limiter Is Per-Process In-Memory

**File:** `worker/src/handlers/auth.rs` (lines ~55–62)

```rust
pub struct RateLimiter {
    attempts: Mutex<HashMap<String, Vec<Instant>>>,
    max_attempts: usize,
    window_secs: u64,
}
```

In a horizontally-scaled deployment, each instance tracks attempts independently, effectively multiplying the rate limit by N instances.

**Recommendation:**
- Use a Redis-backed centralized rate limiter.
- Add IP-based rate limiting in addition to email-based.

---

### SEC-37 · MEDIUM — Rate Limiting Only Applied to Login

Rate limiting is only wired to `handle_login`. Registration, refresh, and all data handlers have none. An attacker could brute-force registrations or flood the system.

**Recommendation:**
- Apply rate limiting to `register` and `refresh` endpoints.
- Consider global per-IP rate limiting at the gateway level.

---

### SEC-38 · MEDIUM — Rate Limiter Keyed by Email Enables Account Lockout DoS

**File:** `worker/src/handlers/auth.rs` (line ~263)

The rate limiter is keyed solely by email. An attacker who knows a user's email can intentionally trigger the limit (5 attempts / 5 min) to lock the legitimate user out.

**Recommendation:**
- Combine email + source-IP for rate limit keys.
- Use CAPTCHA after N failures rather than hard lockout.

---

### SEC-39 · LOW — No Email Format Validation on Registration

**File:** `worker/src/handlers/auth.rs` (lines ~140–144)

Registration only checks that email is non-empty. `"not-an-email"` is accepted.

**Recommendation:**
- Validate email format (must contain `@` and a domain part).

---

### SEC-40 · LOW — Password Policy Is Minimal (8 chars, No Complexity)

**File:** `worker/src/handlers/auth.rs` (lines ~146–149)

Passwords only need ≥ 8 characters. `"aaaaaaaa"` passes validation.

**Recommendation:**
- Per NIST SP 800-63B: increase minimum to 10–12 chars and check against breached-password lists (e.g., HaveIBeenPwned k-anonymity API) rather than adding complexity rules.

---

---

## A08 — Software and Data Integrity Failures

### SEC-41 · LOW — No Production Docker Compose

There is no `docker-compose.prod.yml` or production override. This increases the risk of deploying with dev settings.

**Recommendation:**
- Create a production overlay that enforces TLS, strong passwords, and localhost-only ports.

---

---

## A09 — Security Logging and Monitoring Failures

### SEC-42 · LOW — User Emails Logged on Rate-Limited Attempts

**File:** `worker/src/handlers/auth.rs` (line ~264)

```rust
warn!("Rate limited login attempt for: {}", payload.email);
```

PII (email addresses) written to logs may violate data protection requirements.

**Recommendation:**
- Mask emails in logs: `t***@example.com`.

---

### SEC-43 · LOW — Dev Password Logged in Plaintext

**File:** `worker/src/db/mod.rs`

```rust
warn!("Dev admin user has invalid password hash, setting to 'password123'");
info!("Dev admin password set to 'password123'");
```

**Recommendation:**
- Log that the password was reset without including the actual value.

---

---

## A10 — Server-Side Request Forgery (SSRF)

### SEC-44 · INFO — External Service URLs Are Admin-Configured (Low SSRF Risk)

**File:** `worker/src/config.rs`

Nominatim and Valhalla URLs are loaded from environment variables, not from user input. User-supplied addresses are passed as query parameters, not as URL components. SSRF risk is minimal in the current architecture.

---

---

## Positive Findings

These areas demonstrate good security practices:

| Area | Detail |
|------|--------|
| **SQL Injection** | All queries use parameterized `$N` bindings via sqlx. No string interpolation in SQL. |
| **Password Hashing** | Argon2id — industry-standard algorithm. |
| **XSS (React)** | No `dangerouslySetInnerHTML`, `eval()`, or `innerHTML` usage. React's built-in escaping is intact. |
| **Secrets in Git** | `.env` files are properly gitignored and not tracked. |
| **Frontend Logging** | `logger.ts` disables console logging in production. |
| **Frontend Secrets** | No API keys or secrets embedded in frontend source code. |
| **Auth on Domain Handlers** | Customer, revision, route, settings, crew, visit, and communication handlers all require authentication. |

---

## Remediation Priority

### Phase 1 — Immediate (Before Any Production Deploy)

| ID | Finding | Effort |
|----|---------|--------|
| SEC-10 | Make JWT_SECRET required, add length check | Small |
| SEC-02 | Remove legacy `user_id` fallback | Small |
| SEC-26 | Gate dev admin password behind DEV_MODE | Small |
| SEC-25 | Bind internal Docker ports to 127.0.0.1 | Small |
| SEC-06 | Make job-submit auth a hard requirement | Small |
| SEC-04 | Fix device handler IDOR (add user_id to queries) | Small |
| SEC-05 | Fix work-item handler IDOR | Small |
| SEC-03 | Add auth to geocode/jobs/valhalla handlers | Medium |
| SEC-01 | Add NATS authentication and ACLs | Medium |

### Phase 2 — Before Public Access

| ID | Finding | Effort |
|----|---------|--------|
| SEC-11 | Enforce JWT secret minimum length | Small |
| SEC-27 | Stop leaking DB errors to clients | Medium |
| SEC-17 | Add ownership check to reverse geocode update | Small |
| SEC-12 | Enable WebSocket TLS | Medium |
| SEC-22 | Add Content Security Policy headers | Medium |
| SEC-13 | Move JWT to httpOnly cookies or add CSP | Large |
| SEC-07 | Add role-based checks in domain handlers | Medium |

### Phase 3 — Hardening

| ID | Finding | Effort |
|----|---------|--------|
| SEC-08 | Implement token revocation | Large |
| SEC-09 | Implement refresh token rotation | Large |
| SEC-36 | Centralize rate limiting (Redis) | Medium |
| SEC-37 | Extend rate limiting to register/refresh | Small |
| SEC-38 | Fix rate limiter DoS via email key | Small |
| SEC-14 | Tune Argon2 parameters | Small |
| SEC-15 | Use DB role in refresh (not old JWT role) | Small |
| SEC-28 | Use env var substitution in docker-compose | Small |
| SEC-29 | Redact secrets in Debug impls | Small |
| SEC-30 | Expand .gitignore for env files | Small |

### Phase 4 — Best Practices

| ID | Finding | Effort |
|----|---------|--------|
| SEC-34 | Add cargo audit / npm audit to CI | Small |
| SEC-35 | Add container resource limits | Small |
| SEC-39 | Add email format validation | Small |
| SEC-40 | Strengthen password policy | Small |
| SEC-41 | Create production docker-compose overlay | Medium |
| SEC-23 | Remove dual token/userId detection | Small |
| SEC-24 | Convert roles to Rust enum | Small |

---
---

## Detailed Remediation Plan — Phase 1

> **Goal:** Close all critical and exploitable vulnerabilities before any production deployment.
> **Dependency order:** SEC-10 → SEC-02 → then all others can be done in parallel.

---

### PLAN-01 · SEC-10 — Make JWT_SECRET Required + Add Length Check

**Priority:** Do this first — other auth fixes depend on a strong secret.

**File:** `worker/src/config.rs`

**Step 1 — Remove the fallback, make the variable required:**

```rust
// BEFORE (line 41-42):
let jwt_secret = std::env::var("JWT_SECRET")
    .unwrap_or_else(|_| "dev-secret-change-in-production-min-32-bytes!!".to_string());

// AFTER:
let jwt_secret = std::env::var("JWT_SECRET")
    .context("JWT_SECRET must be set — generate one with: openssl rand -base64 48")?;
```

**Step 2 — Add minimum length validation (below the line above):**

```rust
if jwt_secret.len() < 32 {
    anyhow::bail!("JWT_SECRET must be at least 32 bytes (current: {} bytes)", jwt_secret.len());
}

let known_dev_secrets = [
    "dev-secret-change-in-production-min-32-bytes!!",
];
if known_dev_secrets.contains(&jwt_secret.as_str()) {
    tracing::warn!("JWT_SECRET matches a known default — change it for production!");
}
```

**Step 3 — Update `.env.example` to include the variable:**

**File:** `worker/.env.example`

```
# Authentication — REQUIRED. Generate with: openssl rand -base64 48
JWT_SECRET=dev-secret-change-in-production-min-32-bytes!!
```

**Step 4 — Update `infra/docker-compose.yml` to use env var substitution:**

```yaml
# BEFORE (line 29):
JWT_SECRET: dev-secret-change-in-production-min-32-bytes!!

# AFTER:
JWT_SECRET: ${JWT_SECRET:-dev-secret-change-in-production-min-32-bytes!!}
```

**Testing:**
- Start worker without `JWT_SECRET` set → should fail with a clear error message.
- Start worker with `JWT_SECRET=abc` → should fail (too short).
- Start worker with the dev default → should log a warning but start.

---

### PLAN-02 · SEC-02 — Remove Legacy `user_id` Authentication Bypass

**Priority:** Do this second — it removes the most dangerous backdoor.

**Step 1 — Remove the fallback from `extract_auth`:**

**File:** `worker/src/auth.rs` (lines 142–149)

```rust
// BEFORE:
    // Fall back to legacy user_id (dev mode)
    if let Some(user_id) = request.user_id {
        return Ok(AuthInfo {
            user_id,
            role: "customer".to_string(),
            owner_id: None,
        });
    }

    Err(anyhow!("No authentication provided"))

// AFTER:
    Err(anyhow!("No authentication provided — JWT token is required"))
```

**Step 2 — Remove the `user_id` field from the Rust `Request` struct:**

**File:** `worker/src/types/messages.rs` (lines 10–18)

```rust
// BEFORE:
pub struct Request<T> {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    #[serde(default)]
    pub user_id: Option<Uuid>,  // Legacy dev mode fallback
    #[serde(default)]
    pub token: Option<String>,  // JWT access token (preferred)
    pub payload: T,
}

// AFTER:
pub struct Request<T> {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    #[serde(default)]
    pub token: Option<String>,  // JWT access token
    pub payload: T,
}
```

Also remove `user_id` from the `Request::new` constructor and the `Request::with_token` method (keep only `with_token`). Fix any remaining references to `request.user_id` across the codebase — there is at least one in `handlers/jobs.rs` (line 766: `let request_user_id = request.user_id.clone();`).

**Step 3 — Update the TypeScript `Request` interface and `createRequest`:**

**File:** `packages/shared-types/src/messages.ts`

```typescript
// BEFORE:
export interface Request<T> {
  id: string;
  timestamp: string;
  userId?: string;   // Legacy
  token?: string;    // JWT access token (preferred)
  payload: T;
}

export function createRequest<T>(tokenOrUserId: string | undefined, payload: T): Request<T> {
  const isToken = tokenOrUserId && tokenOrUserId.includes('.');
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userId: isToken ? undefined : tokenOrUserId,
    token: isToken ? tokenOrUserId : undefined,
    payload,
  };
}

// AFTER:
export interface Request<T> {
  id: string;
  timestamp: string;
  token?: string;    // JWT access token
  payload: T;
}

export function createRequest<T>(token: string | undefined, payload: T): Request<T> {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    token,
    payload,
  };
}
```

**Step 4 — Search and fix all callers of `createRequest`:**

Run `rg "createRequest" apps/web/src/` and verify every call site passes a JWT token (not a userId). The auth store already provides `getToken()` — ensure all NATS service calls use it.

**Testing:**
- Send a NATS message with `{ "user_id": "...", "payload": {...} }` and no `token` → must get `UNAUTHORIZED`.
- Login via the frontend → all operations should still work through JWT.
- Build the frontend → no TypeScript errors (the `userId` field is removed).

---

### PLAN-03 · SEC-26 — Gate Dev Admin Password Behind DEV_MODE

**File:** `worker/src/db/mod.rs` (lines 31–69)

**Step 1 — Add environment check:**

```rust
// BEFORE (called unconditionally from main.rs):
pub async fn ensure_dev_admin_password(pool: &PgPool) {
    use uuid::Uuid;
    let dev_id = ...

// AFTER:
pub async fn ensure_dev_admin_password(pool: &PgPool) {
    if std::env::var("DEV_MODE").is_err() {
        return;  // Only run in development
    }

    tracing::warn!("DEV_MODE is active — checking dev admin password");
    use uuid::Uuid;
    let dev_id = ...
```

**Step 2 — Redact the password from log messages (lines ~51, ~58):**

```rust
// BEFORE:
warn!("Dev admin user has invalid password hash, setting to 'password123'");
info!("Dev admin password set to 'password123'");

// AFTER:
warn!("Dev admin user has invalid password hash — resetting to dev default");
info!("Dev admin password has been reset");
```

**Step 3 — Add `DEV_MODE=true` to the docker-compose env and `.env.example`:**

**File:** `infra/docker-compose.yml` — add under the worker environment:

```yaml
DEV_MODE: "true"
```

**File:** `worker/.env.example` — add:

```
# Set to "true" to enable dev-only features (dev admin password reset, etc.)
DEV_MODE=true
```

**Testing:**
- Start without `DEV_MODE` → `ensure_dev_admin_password` returns immediately, no log output.
- Start with `DEV_MODE=true` → behaves as before (but logs are redacted).

---

### PLAN-04 · SEC-25 — Bind Internal Docker Ports to 127.0.0.1

**File:** `infra/docker-compose.yml`

Change every port mapping for internal services:

```yaml
# BEFORE:
  nats:
    ports:
      - "4222:4222"   # Client connections
      - "8222:8222"   # WebSocket (for browser)
  postgres:
    ports:
      - "5432:5432"
  nominatim:
    ports:
      - "8080:8080"
  valhalla:
    ports:
      - "8002:8002"

# AFTER:
  nats:
    ports:
      - "127.0.0.1:4222:4222"   # Client connections (local only)
      - "8222:8222"              # WebSocket (browser-facing — proxy with TLS in prod)
  postgres:
    ports:
      - "127.0.0.1:5432:5432"   # Local only
  nominatim:
    ports:
      - "127.0.0.1:8080:8080"   # Local only
  valhalla:
    ports:
      - "127.0.0.1:8002:8002"   # Local only
```

Note: port 8222 (WebSocket) remains open because browsers connect to it. In production, this should go through a reverse proxy with TLS (see Phase 2, PLAN-11).

**Testing:**
- `docker compose up` → all services start.
- From the host machine: `curl http://localhost:5432` → succeeds (it's local).
- From another machine on the network: connection to port 5432 → refused.

---

### PLAN-05 · SEC-06 — Make `handle_job_submit` Auth a Hard Requirement

**File:** `worker/src/handlers/jobs.rs` (lines 765–779)

```rust
// BEFORE:
let request_user_id = request.user_id.clone();
let auth_user_id = crate::auth::extract_auth(&request, &jwt_secret)
    .ok()
    .map(|auth| auth.user_id);

let mut job_request = request.payload;
if job_request.user_id.is_none() {
    if let Some(uid) = auth_user_id {
        job_request.user_id = Some(uid);
    } else {
        job_request.user_id = request_user_id;
    }
}

// AFTER:
let auth = match crate::auth::extract_auth(&request, &jwt_secret) {
    Ok(info) => info,
    Err(_) => {
        let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
        continue;
    }
};

let mut job_request = request.payload;
job_request.user_id = Some(auth.data_user_id());
```

This removes the triple-fallback chain (`auth → request.user_id → payload.user_id`) and enforces a single source of truth.

**Testing:**
- Submit a job with a valid JWT → succeeds, `user_id` is set from the token.
- Submit a job without a token → returns `UNAUTHORIZED`.
- Submit a job with an expired token → returns `UNAUTHORIZED`.

---

### PLAN-06 · SEC-04 — Fix Device Handler IDOR

**Step 1 — Add `user_id` parameter to device query functions:**

**File:** `worker/src/db/queries/device.rs`

For each function (`list_devices`, `get_device`, `update_device`, `delete_device`), add `user_id: Uuid` as the second parameter and add `AND user_id = $N` to the SQL WHERE clause. Follow the pattern already used by `create_device`:

```rust
// BEFORE:
pub async fn list_devices(pool: &PgPool, customer_id: Uuid) -> Result<Vec<Device>> {
    let devices = sqlx::query_as::<_, Device>(
        "SELECT ... FROM devices WHERE customer_id = $1 ORDER BY ..."
    )
    .bind(customer_id)
    .fetch_all(pool)
    .await?;
    Ok(devices)
}

// AFTER:
pub async fn list_devices(pool: &PgPool, user_id: Uuid, customer_id: Uuid) -> Result<Vec<Device>> {
    let devices = sqlx::query_as::<_, Device>(
        "SELECT ... FROM devices WHERE customer_id = $1
         AND customer_id IN (SELECT id FROM customers WHERE user_id = $2)
         ORDER BY ..."
    )
    .bind(customer_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(devices)
}
```

Repeat this pattern for `get_device`, `update_device`, and `delete_device`. The subquery `customer_id IN (SELECT id FROM customers WHERE user_id = $N)` ensures the customer belongs to the authenticated user.

**Step 2 — Pass `user_id` from handlers instead of discarding it:**

**File:** `worker/src/handlers/device.rs`

For `handle_list`, `handle_get`, `handle_update`, `handle_delete`, rename `_user_id` to `user_id` and pass it:

```rust
// BEFORE (e.g., handle_list, line 123):
let _user_id = match auth::extract_auth(&request, &jwt_secret) { ... };
match queries::device::list_devices(&pool, request.payload.customer_id).await {

// AFTER:
let user_id = match auth::extract_auth(&request, &jwt_secret) { ... };
match queries::device::list_devices(&pool, user_id, request.payload.customer_id).await {
```

**Testing:**
- User A creates a customer + device → User A can list/get/update/delete it.
- User B tries to list/get/update/delete User A's device → returns empty or `NOT_FOUND`.
- Worker scoped to Owner A → can access Owner A's devices via `data_user_id()`.

---

### PLAN-07 · SEC-05 — Fix WorkItem Handler IDOR

Same pattern as PLAN-06. The approach differs slightly because work items are linked through `visit → revision → customer` chains.

**Step 1 — Add ownership subqueries to work-item query functions:**

**File:** `worker/src/db/queries/work_item.rs`

```rust
// BEFORE:
pub async fn list_work_items_for_visit(pool: &PgPool, visit_id: Uuid) -> Result<Vec<WorkItem>> {
    // SELECT ... WHERE visit_id = $1

// AFTER:
pub async fn list_work_items_for_visit(pool: &PgPool, user_id: Uuid, visit_id: Uuid) -> Result<Vec<WorkItem>> {
    // SELECT wi.* FROM work_items wi
    //   JOIN visits v ON wi.visit_id = v.id
    //   JOIN revisions r ON v.revision_id = r.id
    //   WHERE wi.visit_id = $1 AND r.user_id = $2
```

Apply the same ownership join to `get_work_item`, `create_work_item`, and `complete_work_item`.

**Step 2 — Pass `user_id` from handlers:**

**File:** `worker/src/handlers/work_item.rs`

Same as PLAN-06: rename all `_user_id` to `user_id` and pass to queries.

**Testing:**
- User A creates a revision → visits → work items. User A can CRUD them.
- User B tries to access User A's work items → denied.

---

### PLAN-08 · SEC-03 — Add Auth to Geocode, Jobs, and Valhalla Handlers

This is the most code-touching change in Phase 1. Nine handlers need auth added.

**Step 1 — Add `jwt_secret: Arc<String>` to handler signatures:**

**File:** `worker/src/handlers/geocode.rs`

For each of the four geocode handlers, add the parameter and auth check:

```rust
// BEFORE (e.g., handle_geocode_submit):
pub async fn handle_geocode_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<GeocodeProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        // ... parse request ...
        // ... no auth check ...

// AFTER:
pub async fn handle_geocode_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<GeocodeProcessor>,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        // ... parse request ...

        let user_id = match crate::auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        // Pass user_id to processor for ownership-scoped operations
```

Repeat for `handle_geocode_address_submit`, `handle_reverse_geocode_submit`, `handle_geocode_pending`.

**File:** `worker/src/handlers/jobs.rs`

For `handle_job_history`, `handle_job_cancel`, `handle_job_retry`:

```rust
// BEFORE:
pub async fn handle_job_history(
    client: Client,
    mut subscriber: async_nats::Subscriber,
) -> Result<()> {

// AFTER:
pub async fn handle_job_history(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    jwt_secret: Arc<String>,
) -> Result<()> {
    // ... inside the loop, after parsing request:
    let user_id = match crate::auth::extract_auth(&request, &jwt_secret) {
        Ok(info) => info.data_user_id(),
        Err(_) => {
            let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
    };
    // Filter job history by user_id
```

Repeat for `handle_job_cancel` and `handle_job_retry`.

**File:** `worker/src/handlers/mod.rs` — Valhalla handlers (lines 44–118):

```rust
// BEFORE:
async fn handle_valhalla_matrix_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<ValhallaProcessor>,
) -> Result<()> {

// AFTER:
async fn handle_valhalla_matrix_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<ValhallaProcessor>,
    jwt_secret: Arc<String>,
) -> Result<()> {
    // ... inside the loop, after parsing:
    let _user_id = match crate::auth::extract_auth(&request, &jwt_secret) {
        Ok(info) => info.data_user_id(),
        Err(_) => {
            let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }
    };
```

Repeat for `handle_valhalla_geometry_submit`.

**Step 2 — Update `start_handlers` to pass `jwt_secret` to all new handlers:**

**File:** `worker/src/handlers/mod.rs` — in `start_handlers`, add `Arc::clone(&jwt_secret)` for each new handler. Follow the existing pattern used by authenticated handlers like `customer::handle_create`.

**Testing:**
- Each handler rejects requests without a valid JWT.
- Each handler accepts requests with a valid JWT.
- Geocode/job/valhalla operations work end-to-end from the frontend.

---

### PLAN-09 · SEC-01 — Add NATS Authentication and ACLs

This is the largest change in Phase 1, involving config, backend, and frontend.

**Step 1 — Generate auth tokens:**

Create two separate tokens — one for the backend worker (full access) and one for browser clients (restricted).

```bash
# Generate random tokens
openssl rand -base64 32  # → NATS_WORKER_TOKEN
openssl rand -base64 32  # → NATS_BROWSER_TOKEN
```

**Step 2 — Configure NATS server authentication:**

**File:** `infra/nats-server.conf`

```conf
# BEFORE:
server_name: sazinka-nats-1
port: 4222

websocket {
  port: 8222
  no_tls: true
}
# ... (no authorization block)

# AFTER:
server_name: sazinka-nats-1
port: 4222

authorization {
  users: [
    # Backend worker — full access
    {
      user: worker
      password: $NATS_WORKER_PASSWORD
      permissions: {
        publish: ">"
        subscribe: ">"
      }
    }
    # Browser clients — restricted to request/response pattern
    {
      user: browser
      password: $NATS_BROWSER_PASSWORD
      permissions: {
        publish: ["sazinka.*.request"]
        subscribe: ["_INBOX.>"]
      }
    }
  ]
}

websocket {
  port: 8222
  no_tls: true  # Will be fixed in Phase 2 (PLAN-11)
}
```

Note: For simplicity, this uses basic user/password auth. For production at scale, migrate to NKeys or NATS JWT accounts.

**Step 3 — Pass worker credentials to the Rust backend:**

**File:** `worker/.env.example`

```
# NATS connection with authentication
NATS_URL=nats://worker:workerpass@localhost:4222
```

The `async_nats` crate supports credentials in the URL. Alternatively, use:

```rust
// In main.rs or config.rs:
let nats_client = async_nats::ConnectOptions::new()
    .user_and_password(
        config.nats_user.clone(),
        config.nats_password.clone(),
    )
    .connect(&config.nats_url)
    .await?;
```

**Step 4 — Pass browser credentials to the frontend:**

**File:** `apps/web/.env.example`

```
VITE_NATS_URL=ws://localhost:8222
VITE_NATS_USER=browser
VITE_NATS_PASSWORD=browserpass
```

Update the NATS connection code in the frontend to pass credentials:

```typescript
// In the NATS connection setup:
const nc = await connect({
  servers: import.meta.env.VITE_NATS_URL,
  user: import.meta.env.VITE_NATS_USER,
  pass: import.meta.env.VITE_NATS_PASSWORD,
});
```

**Step 5 — Update `infra/docker-compose.yml`:**

```yaml
  nats:
    environment:
      - NATS_WORKER_PASSWORD=${NATS_WORKER_PASSWORD:-workerpass}
      - NATS_BROWSER_PASSWORD=${NATS_BROWSER_PASSWORD:-browserpass}
```

**Step 6 — Restrict NATS monitoring port:**

**File:** `infra/nats-server.conf`

```conf
# BEFORE:
http_port: 8223

# AFTER:
http: 127.0.0.1:8223
```

**Testing:**
- Unauthenticated NATS client → connection rejected.
- Browser client → can publish to `sazinka.customer.request` but NOT to `sazinka.admin.*`.
- Worker client → full access to all subjects.
- Frontend operations work end-to-end.

---

## Detailed Remediation Plan — Phase 2

> **Goal:** Harden the application for public access with TLS, error sanitization, CSP, and role-based access.
> **Prerequisite:** Phase 1 must be complete.

---

### PLAN-10 · SEC-11 — Enforce JWT Secret Minimum Length

**File:** `worker/src/config.rs`

If not already done in PLAN-01 Step 2, add the length check. This is a small addition to the Config validation introduced in Phase 1. The check should be:

```rust
if jwt_secret.len() < 32 {
    anyhow::bail!(
        "JWT_SECRET must be at least 32 bytes for HS256 security (current: {} bytes). \
         Generate one with: openssl rand -base64 48",
        jwt_secret.len()
    );
}
```

Should already be done after PLAN-01. Verify it's in place and the error message is helpful.

---

### PLAN-11 · SEC-27 — Stop Leaking Database Errors to Clients

This requires a systematic find-and-replace across all handler files.

**Step 1 — Create a helper function:**

**File:** `worker/src/handlers/mod.rs` (add at the top of the file, after imports)

```rust
/// Sanitize database errors for client responses.
/// Logs the full error server-side and returns a generic message.
fn db_error_message(context: &str, err: &impl std::fmt::Display) -> String {
    tracing::error!("{}: {}", context, err);
    "An internal error occurred. Please try again later.".to_string()
}
```

**Step 2 — Replace all `e.to_string()` in `DATABASE_ERROR` responses:**

Search pattern: `ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string())`

Replace with: `ErrorResponse::new(request.id, "DATABASE_ERROR", db_error_message("context", &e))`

**Files to update** (each has multiple instances):

| File | Approximate count |
|------|-------------------|
| `worker/src/handlers/auth.rs` | 12 instances |
| `worker/src/handlers/customer.rs` | 8 instances |
| `worker/src/handlers/device.rs` | 8 instances |
| `worker/src/handlers/revision.rs` | 8 instances |
| `worker/src/handlers/route.rs` | 8 instances |
| `worker/src/handlers/settings.rs` | 6 instances |
| `worker/src/handlers/visit.rs` | 8 instances |
| `worker/src/handlers/crew.rs` | 8 instances |
| `worker/src/handlers/work_item.rs` | 6 instances |
| `worker/src/handlers/communication.rs` | 6 instances |
| `worker/src/handlers/geocode.rs` | 4 instances |
| `worker/src/handlers/jobs.rs` | 4 instances |

Also replace `INVALID_REQUEST` errors that use `e.to_string()` for parse failures — these can leak serde details:

```rust
// BEFORE:
Err(e) => {
    error!("Failed to parse request: {}", e);
    let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());

// AFTER:
Err(e) => {
    error!("Failed to parse request: {}", e);
    let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", "Invalid request format");
```

**Testing:**
- Trigger a DB error (e.g., invalid UUID format) → client sees "An internal error occurred", server logs show the full error.
- Trigger a parse error → client sees "Invalid request format".

---

### PLAN-12 · SEC-17 — Add Ownership Check to Reverse Geocode Update

**File:** `worker/src/handlers/geocode.rs` (the `process_reverse_job` function, around line 376)

**Step 1 — Add `user_id` parameter to the reverse geocode processor and its SQL:**

```rust
// BEFORE (SQL):
"UPDATE customers SET ... WHERE id = $6"

// AFTER:
"UPDATE customers SET ... WHERE id = $6 AND user_id = $7"
```

Pass the `user_id` (obtained from `extract_auth` in PLAN-08) through to the processor.

**Step 2 — Check affected rows:**

```rust
let result = sqlx::query(/* ... */).execute(pool).await?;
if result.rows_affected() == 0 {
    tracing::warn!("Reverse geocode update: customer {} not found or not owned by user {}", customer_id, user_id);
}
```

**Testing:**
- Reverse geocode for User A's customer → updates successfully.
- Attempt to update User B's customer → 0 rows affected, warning logged.

---

### PLAN-13 · SEC-12 — Enable WebSocket TLS

**Step 1 — Create a TLS certificate directory:**

```
infra/certs/
  server.crt
  server.key
```

For development, generate a self-signed cert:

```bash
openssl req -x509 -newkey rsa:4096 -keyout infra/certs/server.key \
  -out infra/certs/server.crt -days 365 -nodes -subj "/CN=localhost"
```

**Step 2 — Update NATS config:**

**File:** `infra/nats-server.conf`

```conf
# BEFORE:
websocket {
  port: 8222
  no_tls: true
}

# AFTER:
websocket {
  port: 8222
  tls {
    cert_file: "/etc/nats/certs/server.crt"
    key_file: "/etc/nats/certs/server.key"
  }
}
```

**Step 3 — Mount certs in Docker:**

**File:** `infra/docker-compose.yml`

```yaml
  nats:
    volumes:
      - ./nats-server.conf:/etc/nats/nats-server.conf
      - ./certs:/etc/nats/certs:ro   # Add this line
```

**Step 4 — Update frontend connection URL:**

Change `ws://` to `wss://` in the frontend NATS connection config.

**Step 5 — Add certs directory to `.gitignore`:**

```
# TLS certificates
infra/certs/
*.pem
*.key
*.crt
```

**Testing:**
- Browser connects via `wss://` → connection succeeds.
- Browser tries plain `ws://` → connection refused (TLS required).
- Wireshark/network inspector → traffic is encrypted.

---

### PLAN-14 · SEC-22 — Add Content Security Policy Headers

Since the app communicates directly via NATS WebSocket (no HTTP API server to set headers), CSP must be set via one of these approaches:

**Option A — Meta tag in `index.html` (quick, no infra changes):**

**File:** `apps/web/index.html`

```html
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'self';
             script-src 'self';
             style-src 'self' 'unsafe-inline';
             img-src 'self' data: blob:;
             font-src 'self';
             connect-src 'self' wss://localhost:8222 ws://localhost:8222;
             frame-ancestors 'none';
             form-action 'self';
             base-uri 'self';" />
  <!-- ... -->
</head>
```

Adjust `connect-src` for production (replace `localhost:8222` with the production NATS WebSocket URL).

**Option B — Reverse proxy headers (recommended for production):**

Create a Caddy or nginx config that serves the frontend and sets security headers:

```
# Caddyfile
:443 {
  root * /srv/web
  file_server
  header {
    Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self' wss://nats.example.com:8222; frame-ancestors 'none'"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=()"
  }
  reverse_proxy /ws nats:8222
}
```

**Recommendation:** Implement Option A now for immediate protection. Plan Option B as part of the production infrastructure setup.

**Testing:**
- Open browser DevTools → Console → no CSP violation warnings during normal use.
- Inject `<script src="https://evil.com/steal.js">` via DOM → blocked by CSP.

---

### PLAN-15 · SEC-13 — Mitigate localStorage Token Exposure

Full migration to `httpOnly` cookies requires an HTTP API proxy layer, which is a significant architectural change. For now, mitigate with defense-in-depth:

**Step 1 — Reduce token lifetime from 8 hours to 30 minutes:**

**File:** `worker/src/auth.rs` (line 65)

```rust
// BEFORE:
let exp = now + 8 * 60 * 60; // 8 hours (working day)

// AFTER:
let exp = now + 30 * 60; // 30 minutes — short-lived access token
```

**Step 2 — Implement proactive token refresh in the frontend:**

**File:** `apps/web/src/stores/authStore.ts`

Add a refresh timer that runs every 20 minutes (before the 30-minute expiry):

```typescript
// In the auth store, after successful login/verify:
private startRefreshTimer() {
  if (this.refreshTimer) clearInterval(this.refreshTimer);
  this.refreshTimer = setInterval(() => {
    this.refreshToken();
  }, 20 * 60 * 1000); // Refresh 10 min before expiry
}
```

**Step 3 — CSP (PLAN-14) blocks inline script injection.**

**Step 4 — Long-term: plan HTTP API proxy architecture.**

This is a future architectural decision — add a lightweight HTTP server (e.g., Axum/Actix) that:
- Serves the frontend
- Proxies NATS requests
- Sets `httpOnly`, `Secure`, `SameSite=Strict` cookies
- Sets CSP and other security headers

Document this in `PRJ_ROADMAP.MD` as a future milestone.

**Testing:**
- Login → token works for 30 minutes.
- After 20 minutes → frontend auto-refreshes → new token, no user disruption.
- After 30 minutes without refresh → token expires → user redirected to login.

---

### PLAN-16 · SEC-07 — Add Role-Based Checks in Domain Handlers

**Step 1 — Extend `AuthInfo` with a permissions check method:**

**File:** `worker/src/auth.rs`

```rust
impl AuthInfo {
    // ... existing methods ...

    /// Check if the user has a specific permission.
    /// Admins and customers have all permissions.
    /// Workers are restricted to their granted permissions.
    pub fn has_permission(&self, permission: &str) -> bool {
        match self.role.as_str() {
            "admin" | "customer" => true,
            "worker" => self.permissions.contains(&permission.to_string()),
            _ => false,
        }
    }
}
```

Note: `AuthInfo` needs a `permissions: Vec<String>` field added, populated from `claims.permissions` during `extract_auth`.

**Step 2 — Update `extract_auth` to include permissions:**

```rust
// In extract_auth, when building AuthInfo from JWT:
return Ok(AuthInfo {
    user_id,
    role: claims.role,
    owner_id,
    permissions: claims.permissions,  // Add this field
});
```

**Step 3 — Add permission checks to handlers:**

Map each handler group to a permission:

| Handler group | Required permission |
|---------------|-------------------|
| `customer.*` | `data:customers` |
| `device.*` | `data:devices` |
| `revision.*` | `data:revisions` |
| `route.*` | `data:routes` |
| `settings.*` | `settings:manage` |
| `communication.*` | `data:communications` |
| `visit.*` | `data:visits` |
| `crew.*` | `data:crews` |
| `work_item.*` | `data:work_items` |
| `import.*` | `import:manage` |

In each handler, add after `extract_auth`:

```rust
let auth = match auth::extract_auth(&request, &jwt_secret) {
    Ok(info) => info,
    Err(_) => { /* ... UNAUTHORIZED ... */ }
};

if !auth.has_permission("data:customers") {
    let error = ErrorResponse::new(request.id, "FORBIDDEN", "Insufficient permissions");
    let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
    continue;
}

let user_id = auth.data_user_id();
```

**Testing:**
- Admin user → all operations succeed.
- Customer user → all operations succeed.
- Worker with `data:customers` permission → customer operations succeed.
- Worker without `data:customers` permission → returns `FORBIDDEN`.

---

## Phase 1+2 Completion Checklist

| # | Task | Status |
|---|------|--------|
| PLAN-01 | JWT_SECRET required + length check | ☑ Done (config.rs validates ≥32 bytes, warns on known defaults) |
| PLAN-02 | Legacy `user_id` bypass removed | ☐ |
| PLAN-03 | Dev admin password gated behind DEV_MODE | ☑ Done (replaced entirely — see Secrets Hardening below) |
| PLAN-04 | Docker ports bound to 127.0.0.1 | ☑ Done (all internal ports on 127.0.0.1) |
| PLAN-05 | Job submit hard auth | ☐ |
| PLAN-06 | Device IDOR fixed | ☐ |
| PLAN-07 | WorkItem IDOR fixed | ☐ |
| PLAN-08 | All handlers require auth | ☐ |
| PLAN-09 | NATS authentication + ACLs | ☑ Done (user/password auth + subject ACLs) |
| PLAN-10 | JWT secret length enforced | ☑ Done (same as PLAN-01) |
| PLAN-11 | DB error messages sanitized | ☐ |
| PLAN-12 | Reverse geocode ownership check | ☐ |
| PLAN-13 | WebSocket TLS enabled | ☐ |
| PLAN-14 | Content Security Policy added | ☐ |
| PLAN-15 | Token lifetime reduced + auto-refresh | ☐ |
| PLAN-16 | Role-based permission checks | ☐ |

---
---

## Secrets Hardening — Implementation Record

> **Date:** 2026-02-23
> **Commit:** `73752d4` — `security: harden secrets management for production deployment`
> **Scope:** Full stack (worker, frontend, infra, NATS, Docker, Makefile)

### Overview

All secrets are now managed through a single pipeline: **SOPS + age** encrypted
files in Git, decrypted at deploy time, and distributed to each component via
Makefile targets. No plaintext secrets exist in any tracked file.

### Architecture

```
Git Repository (safe to push)
├── .sops.yaml                         ← key policy: which age keys can decrypt which env
├── infra/secrets/
│   ├── .env.dev.enc                   ← encrypted dev secrets
│   ├── .env.staging.enc              ← encrypted staging secrets
│   ├── .env.production.enc           ← encrypted production secrets
│   └── .gitignore                    ← blocks *.dec, *.plain
├── infra/nats-server.conf            ← passwords via $ENV vars (no hardcoded values)
├── infra/docker-compose.yml          ← all secrets via ${VAR:?error} (no defaults)
├── worker/.env.example               ← placeholders only
└── apps/web/.env.example             ← placeholders only

Developer Machine / Server (never committed)
├── ~/.config/sops/age/keys.txt       ← private age key
├── infra/secrets/.env.{env}.dec      ← decrypted (ephemeral, gitignored)
├── worker/.env                        ← generated by `make worker-env`
└── apps/web/.env                      ← generated by `make web-env`
```

### What Was Changed

#### 1. NATS server config — environment variable substitution

**File:** `infra/nats-server.conf`

Hardcoded passwords `workerpass` and `browserpass` replaced with NATS-native
environment variable references:

```
password: $NATS_WORKER_PASSWORD    # was: workerpass
password: $NATS_BROWSER_PASSWORD   # was: browserpass
```

These variables are injected by Docker Compose from the SOPS-decrypted env file.

**Resolves:** SEC-01 (NATS authentication), SEC-28 (weak defaults in Docker Compose)

#### 2. Docker Compose — no hardcoded secrets

**File:** `infra/docker-compose.yml`

All sensitive environment variables now use the required-variable syntax with no
fallback defaults:

```yaml
POSTGRES_USER: "${POSTGRES_USER:?Set POSTGRES_USER}"
POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}"
JWT_SECRET: "${JWT_SECRET:?Set JWT_SECRET}"
NATS_WORKER_PASSWORD: "${NATS_WORKER_PASSWORD:?Set NATS_WORKER_PASSWORD}"
NATS_BROWSER_PASSWORD: "${NATS_BROWSER_PASSWORD:?Set NATS_BROWSER_PASSWORD}"
NOMINATIM_PASSWORD: "${NOMINATIM_PASSWORD:?Set NOMINATIM_PASSWORD}"
```

Docker Compose will refuse to start if any variable is missing, printing a clear
error message.

**Resolves:** SEC-28 (weak default passwords in Docker Compose)

#### 3. Admin account — CLI subcommand + SOPS fallback

**Files:** `worker/src/cli.rs` (new), `worker/src/admin.rs` (new), `worker/src/main.rs`

The `DEV_MODE` / `DEV_ADMIN_PASSWORD` backdoor has been completely removed.
Replaced with two secure mechanisms:

**Interactive CLI (primary):**

```bash
cargo run -- create-admin --email admin@example.com
# Prompts for password (hidden input, double confirmation)
# Validates: ≥12 chars, upper+lower+digit
# Hashes with Argon2, upserts directly to PostgreSQL
# Password never touches any file or environment variable
```

**SOPS fallback (automated deployments):**

On startup, if `ADMIN_PASSWORD_HASH` is set in the environment (a pre-computed
Argon2 hash — never a plaintext password), the worker checks whether an admin
account exists and applies the hash if needed. This is the path for CI/CD.

**Removed:**
- `ensure_dev_admin_password()` from `worker/src/db/mod.rs`
- `DEV_MODE` environment variable
- `DEV_ADMIN_PASSWORD` environment variable
- Hardcoded admin UUID (`00000000-0000-0000-0000-000000000001`)
- Password `password123` from all files

**Resolves:** SEC-26 (dev admin password set unconditionally at startup)

#### 4. Makefile — single source of truth distribution

**File:** `Makefile`

New targets generate component-specific `.env` files from the SOPS-decrypted
source, eliminating manual secret copying:

| Target | Description |
|--------|-------------|
| `make secrets` | Decrypt SOPS file for ENV |
| `make worker-env` | Generate `worker/.env` from SOPS (DATABASE_URL, JWT_SECRET, NATS, etc.) |
| `make web-env` | Generate `apps/web/.env` from SOPS (VITE_NATS_* vars) |
| `make dev` | Full dev start: decrypt + generate envs + start Docker |
| `make secrets-edit` | Edit secrets in $EDITOR (re-encrypts on save) |
| `make secrets-rotate` | Re-encrypt after key changes |
| `make secrets-clean` | Remove all decrypted + generated files |

#### 5. Example files — placeholders only

**Files:** `worker/.env.example`, `apps/web/.env.example`

All real secret values replaced with placeholders (`change-me`,
`generate-a-strong-secret-at-least-32-bytes`). These files serve as
documentation only.

**Resolves:** SEC-33 (real dev credentials in .env.example)

#### 6. Frontend — no hardcoded fallbacks

**File:** `apps/web/src/stores/natsStore.ts`

Removed hardcoded fallback credentials:

```typescript
// BEFORE:
user: import.meta.env.VITE_NATS_USER || 'browser',
pass: import.meta.env.VITE_NATS_PASS || 'browserpass',

// AFTER:
user: import.meta.env.VITE_NATS_USER,
pass: import.meta.env.VITE_NATS_PASS,
```

If the env vars are missing, the connection will fail explicitly rather than
silently using insecure defaults.

#### 7. Seed file — password reference removed

**File:** `infra/seed-dev.sql`

Removed the comment documenting `password123`. Now points users to the CLI:

```sql
-- To set the admin password use: cargo run -- create-admin --email test@example.com
```

#### 8. Strong secret regeneration

All three SOPS environments (dev, staging, production) were regenerated with
cryptographically strong random passwords:

- `POSTGRES_PASSWORD` — 32 bytes, base64
- `JWT_SECRET` — 48 bytes, base64
- `NATS_WORKER_PASSWORD` — 32 bytes, base64
- `NATS_BROWSER_PASSWORD` — 32 bytes, base64
- `NOMINATIM_PASSWORD` — 32 bytes, base64
- `DATABASE_URL` — updated to match new POSTGRES_PASSWORD

Each environment has unique, independent secrets.

#### 9. .gitignore coverage

Verified coverage for all generated/decrypted files:

| Pattern | Covers |
|---------|--------|
| `.env` | `worker/.env`, `apps/web/.env` |
| `*.dec` | `infra/secrets/*.dec` |
| `*.plain` | `infra/secrets/*.plain` |
| `.env.production` | Root-level env files |
| `.env.staging` | Root-level env files |
| `infra/secrets/*.dec` | Explicit for secrets dir |

### Resolved Findings Summary

| ID | Finding | Resolution |
|----|---------|------------|
| SEC-01 | NATS has no authentication | User/password auth + subject ACLs added |
| SEC-10 | Hardcoded JWT secret fallback | Fallback removed; JWT_SECRET required with ≥32 byte validation |
| SEC-25 | Docker ports on 0.0.0.0 | Internal ports bound to 127.0.0.1 |
| SEC-26 | Dev admin password set unconditionally | `ensure_dev_admin_password` removed; replaced with CLI + SOPS hash |
| SEC-28 | Weak defaults in Docker Compose | All secrets require env vars, no fallback defaults |
| SEC-30 | .gitignore incomplete for env files | Coverage verified for .dec, .plain, .env.production, .env.staging |
| SEC-33 | Real credentials in .env.example | Replaced with placeholders |

### Operational Procedures

**First-time setup:**

```bash
make dev                                          # decrypt + generate envs + start Docker
cd worker && cargo run -- create-admin --email you@example.com   # set admin password
```

**Daily development:**

```bash
make dev                                          # one command: everything starts
```

**Rotating secrets:**

```bash
make secrets-edit ENV=production                  # edit in $EDITOR, auto re-encrypts
make down && make up ENV=production               # restart with new secrets
```

**Adding a new developer:**

1. Generate their age key: `age-keygen`
2. Add their public key to `.sops.yaml` under the appropriate rules
3. Run `make secrets-rotate ENV=dev` (and staging/production if they need access)
4. Commit the updated `.sops.yaml` and re-encrypted files

**Server provisioning:**

1. Install `sops` and `age` on the server
2. Copy the server's age private key to `~/.config/sops/age/keys.txt`
3. Clone the repo
4. Run `make up ENV=production`
5. Run `cargo run -- create-admin --email admin@company.com`
