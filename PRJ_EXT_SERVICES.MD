# PRJ_EXT_SERVICES — External Services Integration

> **Created:** 2026-02-23
> **Status:** Analysis complete, implementation plan ready — no code changes yet

---

## Context

Sazinka currently runs entirely on self-hosted infrastructure:

| Service    | Purpose                  | Hosting          |
|------------|--------------------------|------------------|
| NATS       | Message bus              | Docker (local)   |
| PostgreSQL | Data storage             | Docker (local)   |
| Nominatim  | Geocoding                | Docker (local)   |
| Valhalla   | Route matrix / geometry  | Docker (local)   |

Amazon SES is the first external (cloud-managed) service the project will integrate.
This document establishes patterns for external service integration and provides
a detailed implementation plan for SES.

---

## 1. Amazon SES — Email Delivery

### 1.1 Why SES

- **Cost:** $0.10 per 1,000 emails — negligible for a small-business CRM
- **Deliverability:** Dedicated IPs optional; shared pool has good reputation with proper DKIM/SPF/DMARC
- **No infrastructure to host:** Managed service, no SMTP relay to maintain
- **Event tracking:** Built-in open/click/bounce/complaint notifications via SNS or event destinations
- **Czech locale:** No geo restrictions; EU region `eu-central-1` (Frankfurt) available for GDPR data residency
- **Rust SDK:** Official `aws-sdk-sesv2` crate maintained by AWS

### 1.2 What Already Exists

The codebase already has substantial scaffolding for email:

| Component | File | Status |
|-----------|------|--------|
| Email processor (JetStream queue) | `worker/src/services/email_processor.rs` | Skeleton — job queue works, sending is a TODO |
| Email job types | `worker/src/types/notification_job.rs` | Complete — `RevisionReminder`, `AppointmentConfirmation`, `Custom` |
| Email config struct | `email_processor.rs` → `EmailConfig` | Reads `RESEND_API_KEY` — needs replacing with SES config |
| Email templates (i18n) | `worker/src/types/settings.rs` | Complete — CS/EN/SK defaults, user-customizable, `{{placeholder}}` syntax |
| Email template settings UI | Settings page | Complete — subject/body per template type, company locale |
| Communication CRM tracking | `worker/src/types/communication.rs` | Complete — `EmailStatus` enum (sent/delivered/opened/bounced/failed) |
| Communication DB queries | `worker/src/db/queries/communication.rs` | Complete |
| Resend spike (Cloudflare) | `apps/site/functions/__tests__/resend-spike.workers.test.ts` | Proof of concept for Workers runtime |
| SOPS secrets pipeline | `Makefile`, `.sops.yaml`, `infra/secrets/` | Complete — ready to add new secrets |

**Key finding:** The existing `EmailConfig` was designed around Resend (`api_key`, `from_email`, `from_name`).
Switching to SES changes the config shape but preserves the `EmailProcessor` queue and job type architecture.

### 1.3 Two Deployment Contexts

Email needs to be sent from two different runtimes:

| Context | Runtime | Use Cases | Current Plan |
|---------|---------|-----------|--------------|
| **Rust worker** | Tokio on a server/VPS | Revision reminders, appointment confirmations, custom transactional emails | `email_processor.rs` with JetStream queue |
| **Cloudflare Workers** | `workerd` (edge) | Newsletter confirmation, contact form auto-reply | `apps/site/functions/` — currently no sending |

Both can use the same SES account and verified domain. The integration approach differs:

- **Rust worker:** `aws-sdk-sesv2` crate (official, async, Tokio-native)
- **Cloudflare Workers:** SES v2 REST API with AWS Signature v4 signing (no SDK — Workers runtime doesn't support the full AWS SDK)

This analysis focuses on the **Rust worker** integration first. The Cloudflare Workers
integration is a separate, smaller task documented in section 1.9.

---

### 1.4 Changes Required — Rust Worker

#### 1.4.1 New Dependency

**File:** `worker/Cargo.toml`

```toml
# AWS SES v2 SDK
aws-config = { version = "1", features = ["behavior-version-latest"] }
aws-sdk-sesv2 = "1"
```

The `aws-config` crate handles credential resolution (env vars, profiles, IMDSv2 for EC2/ECS).
`aws-sdk-sesv2` provides the `SendEmail` API.

Both crates use `hyper` + `rustls` under the hood. Since the worker already uses `reqwest`
with `native-tls`, there is no TLS stack conflict — `aws-sdk-*` brings its own HTTP client.

**Compilation impact:** The AWS SDK is modular (each service is a separate crate), so only
SES + config are pulled in. Expect ~20-30s added to debug builds, ~1-2 min to release.

#### 1.4.2 Config Changes

**File:** `worker/src/config.rs`

Replace the Resend-oriented `EmailConfig` in `email_processor.rs` with SES-specific fields
on the main `Config` struct (or keep it as a separate struct — both patterns work):

```rust
pub struct Config {
    // ... existing fields ...

    /// AWS region for SES (e.g. "eu-central-1")
    pub ses_region: Option<String>,
    /// Verified sender email address
    pub ses_from_email: Option<String>,
    /// Sender display name
    pub ses_from_name: Option<String>,
}
```

AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are read automatically
by `aws-config` from the environment — no need to store them in `Config`.

The `Option<String>` pattern matches the existing approach: if `ses_region` is `None`,
the email processor starts but logs a warning and skips sending (graceful degradation).

**File:** `worker/src/services/email_processor.rs`

Replace `EmailConfig` entirely:

```rust
pub struct EmailProcessor {
    client: async_nats::Client,
    js: JsContext,
    ses_client: Option<aws_sdk_sesv2::Client>,
    from_email: String,
    from_name: String,
}
```

The `ses_client` is `None` when SES is not configured (dev mode without AWS credentials).

#### 1.4.3 SES Client Initialization

**File:** `worker/src/services/email_processor.rs`

```rust
impl EmailProcessor {
    pub async fn new(
        nats_client: async_nats::Client,
        ses_region: Option<&str>,
        from_email: &str,
        from_name: &str,
    ) -> Result<Self> {
        // ... existing JetStream stream setup ...

        let ses_client = if let Some(region) = ses_region {
            let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region(aws_config::Region::new(region.to_string()))
                .load()
                .await;
            Some(aws_sdk_sesv2::Client::new(&config))
        } else {
            warn!("SES not configured — emails will not be sent");
            None
        };

        Ok(Self { /* ... */ })
    }
}
```

#### 1.4.4 Email Sending Implementation

**File:** `worker/src/services/email_processor.rs` — `process_job` method

Replace the current TODO with actual SES sending:

```rust
async fn send_email(
    &self,
    to: &str,
    subject: &str,
    body_html: &str,
    body_text: Option<&str>,
) -> Result<String> {
    let ses = self.ses_client.as_ref()
        .ok_or_else(|| anyhow::anyhow!("SES client not configured"))?;

    let from = format!("{} <{}>", self.from_name, self.from_email);

    let result = ses.send_email()
        .from_email_address(&from)
        .destination(
            aws_sdk_sesv2::types::Destination::builder()
                .to_addresses(to)
                .build()
        )
        .content(
            aws_sdk_sesv2::types::EmailContent::builder()
                .simple(
                    aws_sdk_sesv2::types::Message::builder()
                        .subject(
                            aws_sdk_sesv2::types::Content::builder()
                                .data(subject)
                                .charset("UTF-8")
                                .build()?
                        )
                        .body(/* html + text */)
                        .build()
                )
                .build()
        )
        .send()
        .await?;

    Ok(result.message_id().unwrap_or("unknown").to_string())
}
```

Error handling needs to distinguish between:
- **Transient errors** (throttling, service unavailable) → NATS will redeliver (up to `max_deliver: 5`)
- **Permanent errors** (invalid address, account suspended) → ack the message, mark job as `Failed`

#### 1.4.5 Template Rendering

The existing templates use `{{placeholder}}` syntax (e.g. `{{customerName}}`, `{{date}}`, `{{companyName}}`).

Two approaches:

| Approach | Pros | Cons |
|----------|------|------|
| **Local rendering** (string replace in Rust) | Simple, no SES dependency, templates in DB as-is | Must implement placeholder engine |
| **SES Templates** (store templates in SES, pass params at send time) | AWS-managed, no Rust code for rendering | Templates must be synced to SES, less flexible for user edits, lock-in |

**Recommendation: Local rendering.** The templates are already user-customizable and stored in
PostgreSQL. SES Templates would require syncing them to AWS on every edit. A simple
`str::replace` loop is sufficient:

```rust
fn render_template(template: &str, vars: &HashMap<&str, &str>) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{{{}}}}}", key), value);
    }
    result
}
```

This is a pure function, easy to test, and already aligns with the existing `{{placeholder}}`
convention in `settings.rs`.

#### 1.4.6 Wiring Into Main

**File:** `worker/src/main.rs`

The `EmailProcessor` needs to be created and its `start_processing` task spawned alongside
the existing handler setup:

```rust
// In run_server(), after NATS connection:
let email_processor = Arc::new(
    services::email_processor::EmailProcessor::new(
        nats_client.clone(),
        config.ses_region.as_deref(),
        config.ses_from_email.as_deref().unwrap_or("noreply@example.com"),
        config.ses_from_name.as_deref().unwrap_or("Sazinka"),
    ).await?
);

// Spawn email processor alongside handlers
let email_handle = {
    let processor = Arc::clone(&email_processor);
    tokio::spawn(async move {
        if let Err(e) = processor.start_processing().await {
            error!("Email processor error: {}", e);
        }
    })
};
```

The `email_processor` Arc also needs to be passed to handlers that submit email jobs
(e.g. a future "send confirmation email" button in the UI).

---

### 1.5 Changes Required — Secrets & Infrastructure

#### 1.5.1 New Environment Variables

| Variable | Required | Example | Where Used |
|----------|----------|---------|------------|
| `AWS_ACCESS_KEY_ID` | Yes (for SES) | `AKIA...` | `aws-config` auto-reads |
| `AWS_SECRET_ACCESS_KEY` | Yes (for SES) | `wJal...` | `aws-config` auto-reads |
| `AWS_REGION` or `SES_REGION` | Yes | `eu-central-1` | `Config::from_env()` |
| `SES_FROM_EMAIL` | Yes | `noreply@ariadline.cz` | `Config::from_env()` |
| `SES_FROM_NAME` | Yes | `Ariadline` | `Config::from_env()` |
| `SES_CONFIGURATION_SET` | Optional | `sazinka-tracking` | For open/click/bounce tracking |

#### 1.5.2 SOPS Integration

**File:** `infra/secrets/.env.{dev,staging,production}.enc`

Add the new variables to each environment's encrypted file:

```
# Amazon SES
AWS_ACCESS_KEY_ID=change-me
AWS_SECRET_ACCESS_KEY=change-me
SES_REGION=eu-central-1
SES_FROM_EMAIL=noreply@ariadline.cz
SES_FROM_NAME=Ariadline
```

**File:** `Makefile` — update `worker-env` target to pass the new vars:

```makefile
worker-env: secrets
    # ... existing ...
    @grep -E '^(DATABASE_URL|JWT_SECRET|NATS_URL|NOMINATIM_URL|VALHALLA_URL|GEOCODER_BACKEND|RUST_LOG|LOGS_DIR|ADMIN_EMAIL|ADMIN_PASSWORD_HASH|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|SES_REGION|SES_FROM_EMAIL|SES_FROM_NAME|SES_CONFIGURATION_SET)=' \
        "$(DEC_FILE)" >> worker/.env 2>/dev/null || true
```

**File:** `worker/.env.example` — add placeholders:

```
# Amazon SES (optional — emails disabled if not set)
# SES_REGION=eu-central-1
# SES_FROM_EMAIL=noreply@yourdomain.com
# SES_FROM_NAME=Your Business
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key
```

#### 1.5.3 AWS IAM Policy

Create an IAM user `sazinka-ses-sender` with the minimum required permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "arn:aws:ses:eu-central-1:ACCOUNT_ID:identity/ariadline.cz"
    }
  ]
}
```

This restricts the credentials to sending email from the verified domain only — no
ability to create/delete identities, read account settings, or manage SES configuration.

#### 1.5.4 Domain Verification (One-Time Setup)

Before SES can send email from `@ariadline.cz`, the domain must be verified in the AWS console:

1. **DKIM:** Add 3 CNAME records provided by SES to the domain's DNS
2. **SPF:** Add `include:amazonses.com` to the existing SPF record (or create one)
3. **DMARC:** Add a `_dmarc` TXT record: `v=DMARC1; p=quarantine; rua=mailto:dmarc@ariadline.cz`
4. **Return-Path:** SES sets a custom return-path for bounce handling

SES starts in **sandbox mode** — sending is limited to verified email addresses only.
Request production access once the domain is verified and a few test emails are confirmed.

---

### 1.6 Changes Required — Communication CRM Integration

When an email is sent, the system should log it in the `communications` table for CRM history.

**Flow:**

```
EmailProcessor.process_job()
    → send via SES
    → on success: INSERT INTO communications (
        user_id, customer_id, revision_id,
        comm_type='email_sent', direction='outbound',
        subject, content, email_status='sent'
      )
    → on failure: INSERT INTO communications (
        ..., email_status='failed'
      )
```

The existing `Communication` entity and `EmailStatus` enum already support this.
The `EmailProcessor` needs access to the `PgPool` (currently it only has the NATS client).

**Change:** Add `pool: PgPool` to `EmailProcessor` and use it after sending.

---

### 1.7 Delivery Status Tracking (Phase 2)

SES can report delivery events (delivered, opened, bounced, complained) via:
- **SNS notifications** → an HTTP endpoint on the worker
- **Event destinations** → SNS, CloudWatch, Kinesis, or S3

Since the worker communicates via NATS (not HTTP), the cleanest approach is:

1. SES → SNS topic → **SQS queue** (durable)
2. A periodic task in the worker polls SQS and updates `communication.email_status`

Alternatively, SES → SNS → a Lambda that publishes to NATS (more complex, more infra).

**This is not needed for initial launch.** The `email_status` will be set to `sent` on
successful API call. Delivery/open/bounce tracking can be added later without schema changes
(the `email_status` column and `EmailStatus` enum already exist).

---

### 1.8 Email Types and When They're Sent

| Email Type | Trigger | Template Source | Priority |
|------------|---------|-----------------|----------|
| **Appointment confirmation** | Dispatcher confirms a visit time slot with customer | `confirmation_subject_template` + `confirmation_body_template` from user settings | High — first to implement |
| **Revision reminder** | Scheduled: N days before `due_date` (configurable via `reminder_days_before`) | `reminder_subject_template` + `reminder_body_template` from user settings | High — core business value |
| **Custom email** | Manual: user composes an email to a customer from the CRM | User-provided subject + body | Medium |
| **Third template** | User-defined: available as a third template slot | `third_subject_template` + `third_body_template` from user settings | Low — future flexibility |

The first two types are the ones that deliver direct business value. Custom email
is useful but not critical for MVP.

---

### 1.9 Cloudflare Workers (apps/site) — Separate Integration

The `apps/site` needs email for:
- Newsletter double-opt-in confirmation
- Contact form auto-reply (future)

**Options:**

| Option | Effort | Notes |
|--------|--------|-------|
| **SES REST API + AWS Sig v4** | Medium | Must implement Sig v4 signing in Workers runtime. Libraries exist (`aws4fetch`) but add complexity. |
| **Keep Resend for site only** | Small | Resend SDK works in Workers (proven by spike test). Separate provider for a separate deployment. |
| **Route through Rust worker** | Small | Site POSTs to a Cloudflare Worker → Worker publishes to the Rust worker's email queue (via NATS or HTTP). Single email provider. |

**Recommendation:** Keep the Cloudflare site integration as a separate decision. The volume
is tiny (newsletter confirmations) and the runtime constraints are different. Using SES from
Workers requires `aws4fetch` for Sig v4 signing — doable but adds a dependency and complexity
for a few emails per week. Resend remains a viable option here, or the site could route
email requests to the main worker.

---

### 1.10 Implementation Plan — Detailed TDD Steps

> **Dependency order:** Phase 1 → 2 → 3 → 4 → 5 → 6 → 7. Phases 8 and 9 are independent follow-ups.
>
> Each step follows the project TDD cycle: Red → Green → Refactor → Update PROJECT_CONTEXT → Commit.

---

#### Phase 1 — Template Rendering Engine

Pure functions, zero dependencies beyond `std`. Start here because it's the most testable
piece and everything else builds on it.

**File:** new `worker/src/services/template_renderer.rs`

**Step 1.1 — Basic `{{placeholder}}` replacement**

Test: `render_replaces_known_placeholders`

```rust
#[test]
fn render_replaces_known_placeholders() {
    let template = "Dear {{customerName}}, your appointment is on {{date}}.";
    let mut vars = HashMap::new();
    vars.insert("customerName", "Jan Novák");
    vars.insert("date", "2026-03-15");

    let result = render_template(template, &vars);

    assert_eq!(result, "Dear Jan Novák, your appointment is on 2026-03-15.");
}
```

Implementation: simple `str::replace` loop over `vars`.

```rust
pub fn render_template(template: &str, vars: &HashMap<&str, &str>) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{{{}}}}}", key), value);
    }
    result
}
```

**Step 1.2 — Unknown placeholders pass through**

Test: `render_leaves_unknown_placeholders_intact`

```rust
#[test]
fn render_leaves_unknown_placeholders_intact() {
    let template = "Hello {{customerName}}, see you at {{time}}.";
    let mut vars = HashMap::new();
    vars.insert("customerName", "Jana");

    let result = render_template(template, &vars);

    assert_eq!(result, "Hello Jana, see you at {{time}}.");
}
```

No code change needed — the existing loop naturally skips unknown keys.

**Step 1.3 — Empty template**

Test: `render_empty_template_returns_empty`

```rust
#[test]
fn render_empty_template_returns_empty() {
    let vars = HashMap::new();
    assert_eq!(render_template("", &vars), "");
}
```

**Step 1.4 — HTML-safe escaping**

Test: `render_escapes_html_in_values`

```rust
#[test]
fn render_escapes_html_in_values() {
    let template = "Name: {{name}}";
    let mut vars = HashMap::new();
    vars.insert("name", "<script>alert('xss')</script>");

    let result = render_template_html(template, &vars);

    assert!(result.contains("&lt;script&gt;"));
    assert!(!result.contains("<script>"));
}
```

Implementation: a second function `render_template_html` that escapes `<`, `>`, `&`, `"`, `'`
in values before substitution. The plaintext version (`render_template`) does not escape.

**Step 1.5 — Build template variables from domain data**

Test: `build_confirmation_vars_from_customer_and_revision`

```rust
#[test]
fn build_confirmation_vars_from_customer_and_revision() {
    let vars = build_confirmation_vars(
        "Jan Novák",              // customer name
        "Korunní 15, Praha",      // address
        "2026-03-15",             // date
        Some("08:00-10:00"),      // time window
        "Ariadline",              // company name
        "+420 123 456 789",       // phone
        "info@ariadline.cz",      // email
    );

    assert_eq!(vars.get("customerName"), Some(&"Jan Novák"));
    assert_eq!(vars.get("date"), Some(&"2026-03-15"));
    assert_eq!(vars.get("time"), Some(&"08:00-10:00"));
    assert_eq!(vars.get("companyName"), Some(&"Ariadline"));
    assert_eq!(vars.get("address"), Some(&"Korunní 15, Praha"));
}
```

Implementation: functions `build_confirmation_vars(...)`, `build_reminder_vars(...)` that
return `HashMap<&str, String>`. These map domain fields to the `{{placeholder}}` names
used in the default templates (`settings.rs`).

**Placeholder inventory** (matches existing templates in `settings.rs`):

| Placeholder | Source | Used in |
|-------------|--------|---------|
| `{{customerName}}` | `customer.name` or `customer.contact_person` | Confirmation, Reminder |
| `{{date}}` | `revision.scheduled_date` formatted | Confirmation, Reminder |
| `{{time}}` | `revision.scheduled_time_start – scheduled_time_end` | Confirmation |
| `{{due_date}}` | `revision.due_date` formatted | Reminder |
| `{{device_type}}` | `device.device_type` | Reminder (CS/SK templates) |
| `{{address}}` | `customer.street, city` | Confirmation |
| `{{companyName}}` | `settings.business_info.business_name` | Confirmation, Reminder |
| `{{business_name}}` | `settings.business_info.business_name` | Reminder (CS/SK templates) |
| `{{phone}}` | `settings.business_info.phone` | Reminder (CS/SK templates) |
| `{{email}}` | `settings.business_info.email` | Reminder (CS/SK templates) |

**Step 1.6 — Register module**

**File:** `worker/src/services/mod.rs` — add `pub mod template_renderer;`

---

#### Phase 2 — Replace EmailConfig with SES Config

**Step 2.1 — Add AWS SDK dependencies**

**File:** `worker/Cargo.toml`

```toml
# AWS SES v2 SDK
aws-config = { version = "1", features = ["behavior-version-latest"] }
aws-sdk-sesv2 = "1"
```

Verify: `cargo check` succeeds (no code changes yet, just dependency resolution).

**Step 2.2 — Add SES fields to `Config`**

**File:** `worker/src/config.rs`

Test: `test_config_ses_region_none_when_not_set`

```rust
#[test]
#[ignore]
fn test_config_ses_region_none_when_not_set() {
    std::env::remove_var("SES_REGION");
    std::env::set_var("DATABASE_URL", "postgres://test");
    std::env::set_var("JWT_SECRET", "test-secret-that-is-at-least-32-bytes!!");
    let config = Config::from_env().unwrap();
    assert!(config.ses_region.is_none());
}
```

Test: `test_config_ses_region_some_when_set`

```rust
#[test]
fn test_config_ses_region_some_when_set() {
    std::env::set_var("SES_REGION", "eu-central-1");
    std::env::set_var("SES_FROM_EMAIL", "test@example.com");
    std::env::set_var("SES_FROM_NAME", "Test");
    std::env::set_var("DATABASE_URL", "postgres://test");
    std::env::set_var("JWT_SECRET", "test-secret-that-is-at-least-32-bytes!!");
    let config = Config::from_env().unwrap();
    assert_eq!(config.ses_region, Some("eu-central-1".to_string()));
    assert_eq!(config.ses_from_email, Some("test@example.com".to_string()));
}
```

Implementation — add to `Config` struct and `from_env()`:

```rust
pub struct Config {
    // ... existing ...
    pub ses_region: Option<String>,
    pub ses_from_email: Option<String>,
    pub ses_from_name: Option<String>,
    pub ses_configuration_set: Option<String>,
}

// In from_env():
let ses_region = std::env::var("SES_REGION").ok();
let ses_from_email = std::env::var("SES_FROM_EMAIL").ok();
let ses_from_name = std::env::var("SES_FROM_NAME").ok();
let ses_configuration_set = std::env::var("SES_CONFIGURATION_SET").ok();
```

**Step 2.3 — Replace `EmailConfig` with `SesEmailConfig`**

**File:** `worker/src/services/email_processor.rs`

Remove the Resend-oriented `EmailConfig` struct and `from_env()`. Replace with:

```rust
pub struct SesEmailConfig {
    pub region: String,
    pub from_email: String,
    pub from_name: String,
    pub configuration_set: Option<String>,
}
```

Update `EmailProcessor`:

```rust
pub struct EmailProcessor {
    nats_client: Client,
    js: JsContext,
    ses_client: Option<aws_sdk_sesv2::Client>,
    from_email: String,
    from_name: String,
    configuration_set: Option<String>,
    pool: PgPool,
}
```

Test: `test_ses_config_creation`

```rust
#[test]
fn test_ses_config_creation() {
    let config = SesEmailConfig {
        region: "eu-central-1".to_string(),
        from_email: "test@example.com".to_string(),
        from_name: "Test".to_string(),
        configuration_set: None,
    };
    assert_eq!(config.region, "eu-central-1");
}
```

Update the existing `test_email_config_creation` test to use the new struct.

**Step 2.4 — SES client initialization in `EmailProcessor::new`**

Update `new()` signature to accept `Option<SesEmailConfig>` + `PgPool`:

```rust
pub async fn new(
    nats_client: Client,
    pool: PgPool,
    ses_config: Option<SesEmailConfig>,
) -> Result<Self> {
    // ... existing JetStream stream setup ...

    let (ses_client, from_email, from_name, configuration_set) = match ses_config {
        Some(cfg) => {
            let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region(aws_config::Region::new(cfg.region))
                .load()
                .await;
            (
                Some(aws_sdk_sesv2::Client::new(&aws_config)),
                cfg.from_email,
                cfg.from_name,
                cfg.configuration_set,
            )
        }
        None => {
            warn!("SES not configured — emails will not be sent");
            (None, String::new(), String::new(), None)
        }
    };

    Ok(Self {
        nats_client,
        js,
        ses_client,
        from_email,
        from_name,
        configuration_set,
        pool,
    })
}
```

No unit test for SES client creation (requires AWS credentials). Tested via
the `ses_client.is_none()` path in `process_job`.

---

#### Phase 3 — Email Data Resolution

The `process_job` method needs to load customer, revision, device, and user settings
from the database to build template variables. This is a new internal module.

**File:** new `worker/src/services/email_data.rs`

**Step 3.1 — `resolve_confirmation_data` query**

A single SQL query that joins `revisions`, `customers`, `devices`, and `users` to
load everything the confirmation template needs:

```rust
pub struct ConfirmationData {
    pub recipient_email: String,
    pub customer_name: String,
    pub address: String,
    pub scheduled_date: String,
    pub time_window: Option<String>,
    pub company_name: String,
    pub company_phone: String,
    pub company_email: String,
    pub company_locale: String,
    // Template pair
    pub subject_template: String,
    pub body_template: String,
}

pub async fn resolve_confirmation_data(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    revision_id: Uuid,
) -> Result<Option<ConfirmationData>> {
    // JOIN revisions r ON r.id = $3 AND r.user_id = $1
    // JOIN customers c ON c.id = $2 AND c.user_id = $1
    // JOIN users u ON u.id = $1
    // SELECT c.email, c.name, c.street, c.city,
    //        r.scheduled_date, r.scheduled_time_start, r.scheduled_time_end,
    //        u.business_name, u.phone, u.email,
    //        u.email_confirmation_subject_template, u.email_confirmation_body_template,
    //        u.company_locale, u.email_confirmation_edited_at
}
```

Test: this is a DB query — tested via integration tests or manual QA (consistent with project
testing conventions: "What NOT to Test — Third-party libraries (SQLx)"). The struct itself
is tested via deserialization.

**Step 3.2 — `resolve_reminder_data` query**

Same pattern for reminders. Additionally loads `device.device_type` for the `{{device_type}}`
placeholder and `revision.due_date` for `{{due_date}}`.

```rust
pub struct ReminderData {
    pub recipient_email: String,
    pub customer_name: String,
    pub device_type: String,
    pub due_date: String,
    pub company_name: String,
    pub company_phone: String,
    pub company_email: String,
    pub company_locale: String,
    pub subject_template: String,
    pub body_template: String,
}

pub async fn resolve_reminder_data(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    revision_id: Uuid,
) -> Result<Option<ReminderData>> { /* ... */ }
```

**Step 3.3 — Guard: skip if no recipient email**

Test: `resolve_returns_none_when_customer_has_no_email`

Both resolve functions return `None` if `customer.email IS NULL` — the caller logs a warning
and marks the job as failed with `"Customer has no email address"`.

**Step 3.4 — Register module**

**File:** `worker/src/services/mod.rs` — add `pub mod email_data;`

---

#### Phase 4 — SES Send Function

**File:** `worker/src/services/email_processor.rs`

**Step 4.1 — `send_email` method**

```rust
async fn send_email(
    &self,
    to: &str,
    subject: &str,
    body_html: &str,
    body_text: &str,
) -> Result<String, EmailSendError> {
    let ses = self.ses_client.as_ref()
        .ok_or(EmailSendError::NotConfigured)?;

    let from = format!("{} <{}>", self.from_name, self.from_email);

    let mut req = ses.send_email()
        .from_email_address(&from)
        .destination(
            Destination::builder().to_addresses(to).build()
        )
        .content(
            EmailContent::builder()
                .simple(
                    Message::builder()
                        .subject(Content::builder().data(subject).charset("UTF-8").build()?)
                        .body(
                            Body::builder()
                                .html(Content::builder().data(body_html).charset("UTF-8").build()?)
                                .text(Content::builder().data(body_text).charset("UTF-8").build()?)
                                .build()
                        )
                        .build()
                )
                .build()
        );

    if let Some(ref cs) = self.configuration_set {
        req = req.configuration_set_name(cs);
    }

    let output = req.send().await?;
    Ok(output.message_id().unwrap_or("unknown").to_string())
}
```

**Step 4.2 — Error classification**

**File:** `worker/src/services/email_processor.rs`

Define `EmailSendError` to distinguish transient vs permanent failures:

```rust
#[derive(Debug, thiserror::Error)]
pub enum EmailSendError {
    #[error("SES not configured")]
    NotConfigured,

    #[error("Recipient has no email address")]
    NoRecipient,

    #[error("Permanent SES error: {0}")]
    Permanent(String),

    #[error("Transient SES error: {0}")]
    Transient(String),
}
```

Test: `test_email_send_error_display`

```rust
#[test]
fn test_email_send_error_display() {
    let e = EmailSendError::NotConfigured;
    assert_eq!(e.to_string(), "SES not configured");
}
```

The `process_job` method uses this to decide:
- `Transient` → do NOT ack the message (JetStream redelivers, up to `max_deliver: 5`)
- `Permanent` / `NotConfigured` / `NoRecipient` → ack + mark job `Failed`

---

#### Phase 5 — Wire `process_job` End-to-End

**File:** `worker/src/services/email_processor.rs`

Replace the current TODO stub in `process_job` with the full pipeline:

```rust
async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
    let job: QueuedEmailJob = serde_json::from_slice(&msg.payload)?;
    let job_id = job.id;

    // Cancellation check (existing)
    if crate::services::cancellation::CANCELLATION.is_cancelled(&job_id) {
        msg.ack().await.ok();
        crate::services::cancellation::CANCELLATION.remove(&job_id);
        return Ok(());
    }

    info!("Processing email job {} ({})", job_id, job.request.type_name());
    self.publish_status(job_id, EmailJobStatus::Sending).await?;

    // Check SES configuration
    if self.ses_client.is_none() {
        warn!("Email job {} skipped — SES not configured", job_id);
        self.publish_status(job_id, EmailJobStatus::Failed {
            error: "Email service not configured".to_string(),
            retries: 0,
        }).await?;
        msg.ack().await.ok();
        return Ok(());
    }

    let result = match &job.request {
        EmailJobRequest::AppointmentConfirmation(req) => {
            self.process_confirmation(job.user_id, req).await
        }
        EmailJobRequest::RevisionReminder(req) => {
            self.process_reminder(job.user_id, req).await
        }
        EmailJobRequest::Custom(req) => {
            self.process_custom(req).await
        }
    };

    match result {
        Ok((message_id, recipient)) => {
            self.publish_status(job_id, EmailJobStatus::Sent {
                message_id,
                recipient,
            }).await?;
            msg.ack().await.ok();
        }
        Err(EmailSendError::Transient(e)) => {
            error!("Transient email error for job {}: {}", job_id, e);
            // Do NOT ack — JetStream will redeliver
        }
        Err(e) => {
            error!("Permanent email error for job {}: {}", job_id, e);
            self.publish_status(job_id, EmailJobStatus::Failed {
                error: e.to_string(),
                retries: 0,
            }).await?;
            msg.ack().await.ok();
        }
    }

    Ok(())
}
```

**Step 5.1 — `process_confirmation` method**

```rust
async fn process_confirmation(
    &self,
    user_id: Uuid,
    req: &AppointmentConfirmationRequest,
) -> Result<(String, String), EmailSendError> {
    // 1. Load data
    let data = email_data::resolve_confirmation_data(
        &self.pool, user_id, req.customer_id, req.revision_id
    ).await
        .map_err(|e| EmailSendError::Permanent(e.to_string()))?
        .ok_or(EmailSendError::NoRecipient)?;

    // 2. Build template variables
    let vars = template_renderer::build_confirmation_vars(/* ... from data ... */);

    // 3. Render
    let subject = template_renderer::render_template(&data.subject_template, &vars);
    let body_html = template_renderer::render_template_html(&data.body_template, &vars);
    let body_text = template_renderer::render_template(&data.body_template, &vars);

    // 4. Send
    let message_id = self.send_email(
        &data.recipient_email, &subject, &body_html, &body_text
    ).await?;

    // 5. Log to CRM
    self.log_communication(
        user_id, req.customer_id, Some(req.revision_id),
        &subject, &body_html, &data.recipient_email, &message_id,
    ).await;

    Ok((message_id, data.recipient_email))
}
```

**Step 5.2 — `process_reminder` method**

Same pattern as `process_confirmation` but uses `resolve_reminder_data` and
`build_reminder_vars`.

**Step 5.3 — `process_custom` method**

The `Custom` variant already carries `to`, `subject`, `body_html`, `body_text` —
no DB lookup needed. Just send directly.

```rust
async fn process_custom(
    &self,
    req: &CustomEmailRequest,
) -> Result<(String, String), EmailSendError> {
    let message_id = self.send_email(
        &req.to, &req.subject, &req.body_html,
        req.body_text.as_deref().unwrap_or(&req.body_html),
    ).await?;

    Ok((message_id, req.to.clone()))
}
```

---

#### Phase 6 — CRM Communication Logging

**File:** `worker/src/services/email_processor.rs`

**Step 6.1 — `log_communication` helper**

```rust
async fn log_communication(
    &self,
    user_id: Uuid,
    customer_id: Uuid,
    revision_id: Option<Uuid>,
    subject: &str,
    content: &str,
    recipient: &str,
    message_id: &str,
) {
    if let Err(e) = crate::db::queries::communication::create_communication(
        &self.pool,
        user_id,
        customer_id,
        revision_id,
        "email_sent",     // comm_type
        "outbound",       // direction
        Some(subject),
        content,
        None,             // contact_name
        None,             // contact_phone
        None,             // duration_minutes
        None,             // follow_up_date
    ).await {
        error!("Failed to log email communication: {}", e);
        // Non-fatal: the email was already sent successfully
    }
}
```

This reuses the existing `create_communication` query. The `email_status` column
defaults to `NULL` in the DB; a future migration could set it to `'sent'` on insert
(or we update the query to accept `email_status`).

---

#### Phase 7 — Wire EmailProcessor into main.rs

**File:** `worker/src/main.rs`

**Step 7.1 — Initialize and spawn**

In `run_server()`, after NATS connection and before `start_handlers`:

```rust
// Initialize email processor
let ses_config = if let (Some(region), Some(from_email)) =
    (&config.ses_region, &config.ses_from_email)
{
    Some(services::email_processor::SesEmailConfig {
        region: region.clone(),
        from_email: from_email.clone(),
        from_name: config.ses_from_name.clone().unwrap_or_else(|| "Sazinka".to_string()),
        configuration_set: config.ses_configuration_set.clone(),
    })
} else {
    None
};

let email_processor = Arc::new(
    services::email_processor::EmailProcessor::new(
        nats_client.clone(),
        pool.clone(),
        ses_config,
    ).await?
);

// Spawn email processor
let email_handle = {
    let p = Arc::clone(&email_processor);
    tokio::spawn(async move {
        if let Err(e) = p.start_processing().await {
            error!("Email processor error: {}", e);
        }
    })
};
```

**Step 7.2 — Pass `email_processor` to handlers (optional)**

If any NATS handler needs to submit email jobs directly (e.g. a "Send confirmation"
button handler), pass `Arc<EmailProcessor>` to `start_handlers`. This is deferred
until a frontend trigger exists.

For now, the `email_processor.submit_job()` API is available for future callers.

---

#### Phase 8 — Secrets & Infrastructure

Non-code changes. No TDD tests — these are operational steps.

**Step 8.1 — Update `worker/.env.example`**

Add commented-out SES variables:

```
# Amazon SES (optional — emails disabled if not set)
# SES_REGION=eu-central-1
# SES_FROM_EMAIL=noreply@yourdomain.com
# SES_FROM_NAME=Your Business
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key
# SES_CONFIGURATION_SET=sazinka-tracking
```

**Step 8.2 — Update Makefile `worker-env` target**

**File:** `Makefile`

Add the new env var names to the grep pattern:

```
AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|SES_REGION|SES_FROM_EMAIL|SES_FROM_NAME|SES_CONFIGURATION_SET
```

**Step 8.3 — Add secrets to SOPS**

```bash
make secrets-edit ENV=dev
# Add:
# AWS_ACCESS_KEY_ID=change-me
# AWS_SECRET_ACCESS_KEY=change-me
# SES_REGION=eu-central-1
# SES_FROM_EMAIL=noreply@ariadline.cz
# SES_FROM_NAME=Ariadline
```

Repeat for staging and production with real credentials.

**Step 8.4 — AWS account setup (manual, one-time)**

1. Create IAM user `sazinka-ses-sender` with the policy from section 1.5.3
2. Generate access key pair
3. In SES console (`eu-central-1`): verify domain `ariadline.cz`
4. Add DNS records: 3 DKIM CNAMEs + SPF `include:amazonses.com` + DMARC TXT
5. Wait for verification (usually < 1 hour)
6. Send test email from sandbox to a verified address
7. Request production access when ready

---

#### Phase 9 — Reminder Scheduler (Future)

Runs as a background `tokio::spawn` task. Checks once daily for revisions
approaching their due date and submits `RevisionReminder` email jobs.

**File:** new `worker/src/services/reminder_scheduler.rs`

**Step 9.1 — Reminder query**

Test: `test_reminder_query_finds_due_revisions` (integration test, requires DB)

```rust
pub async fn find_revisions_needing_reminder(
    pool: &PgPool,
    today: NaiveDate,
) -> Result<Vec<ReminderCandidate>> {
    // SELECT r.id, r.customer_id, r.user_id, r.due_date,
    //        u.reminder_days_before
    // FROM revisions r
    // JOIN users u ON u.id = r.user_id
    // WHERE r.status IN ('upcoming', 'scheduled')
    //   AND r.due_date - ANY(u.reminder_days_before) * INTERVAL '1 day' = $1
    //   AND NOT EXISTS (
    //       SELECT 1 FROM communications c
    //       WHERE c.revision_id = r.id
    //         AND c.comm_type = 'email_sent'
    //         AND c.created_at::date = $1
    //   )
}
```

The `NOT EXISTS` subquery prevents sending duplicate reminders on the same day
(idempotency — safe to replay if the scheduler runs multiple times).

**Step 9.2 — Scheduler loop**

```rust
pub async fn run_reminder_scheduler(
    pool: PgPool,
    email_processor: Arc<EmailProcessor>,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(3600)); // hourly
    loop {
        interval.tick().await;
        let today = Utc::now().date_naive();
        match find_revisions_needing_reminder(&pool, today).await {
            Ok(candidates) => {
                for c in candidates {
                    let req = EmailJobRequest::RevisionReminder(RevisionReminderRequest {
                        revision_id: c.revision_id,
                        customer_id: c.customer_id,
                        days_until_due: (c.due_date - today).num_days() as i32,
                    });
                    if let Err(e) = email_processor.submit_job(c.user_id, req).await {
                        error!("Failed to submit reminder job: {}", e);
                    }
                }
            }
            Err(e) => error!("Reminder scheduler query failed: {}", e),
        }
    }
}
```

**Step 9.3 — Spawn in main.rs**

```rust
let reminder_handle = {
    let pool = pool.clone();
    let ep = Arc::clone(&email_processor);
    tokio::spawn(async move {
        services::reminder_scheduler::run_reminder_scheduler(pool, ep).await;
    })
};
```

---

#### Phase 10 — Delivery Status Tracking (Optional, Future)

Not needed for initial launch. Documented for completeness.

| Step | File(s) | Description |
|------|---------|-------------|
| 1 | AWS Console | Create SES configuration set → SNS topic → SQS queue |
| 2 | `Cargo.toml` | Add `aws-sdk-sqs` |
| 3 | New: `worker/src/services/ses_events.rs` | Poll SQS for bounce/complaint/delivery events |
| 4 | `db/queries/communication.rs` | Add `update_email_status(id, status)` query |
| 5 | `main.rs` | Spawn SQS poller alongside other tasks |

The `communications.email_status` column already exists with the right enum values.

---

### 1.10.1 Implementation Checklist

| # | Task | Phase | Status |
|---|------|-------|--------|
| 1 | `render_template` + tests | 1 | ☐ |
| 2 | `render_template_html` (HTML-safe) + tests | 1 | ☐ |
| 3 | `build_confirmation_vars` + `build_reminder_vars` + tests | 1 | ☐ |
| 4 | Add `aws-config`, `aws-sdk-sesv2` to Cargo.toml | 2 | ☐ |
| 5 | Add SES fields to `Config` + tests | 2 | ☐ |
| 6 | Replace `EmailConfig` with `SesEmailConfig` | 2 | ☐ |
| 7 | SES client init in `EmailProcessor::new` | 2 | ☐ |
| 8 | `resolve_confirmation_data` query | 3 | ☐ |
| 9 | `resolve_reminder_data` query | 3 | ☐ |
| 10 | `EmailSendError` enum + `send_email` method | 4 | ☐ |
| 11 | Wire `process_job` — confirmation path | 5 | ☐ |
| 12 | Wire `process_job` — reminder path | 5 | ☐ |
| 13 | Wire `process_job` — custom path | 5 | ☐ |
| 14 | `log_communication` helper | 6 | ☐ |
| 15 | Initialize + spawn `EmailProcessor` in main.rs | 7 | ☐ |
| 16 | Update `.env.example` | 8 | ☐ |
| 17 | Update Makefile `worker-env` | 8 | ☐ |
| 18 | Add secrets to SOPS | 8 | ☐ |
| 19 | AWS IAM + domain verification | 8 | ☐ |
| 20 | Reminder scheduler | 9 | ☐ |
| 21 | SQS delivery status polling | 10 | ☐ |

---

### 1.11 Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **SES sandbox mode** limits sending to verified addresses only | Cannot send to real customers until production access is granted | Request production access early; use sandbox for dev/test |
| **AWS credential leak** | Attacker can send email as the business | IAM policy restricts to `ses:SendEmail` only; credentials in SOPS; never in code |
| **Bounce rate too high** → SES suspends account | No emails go out | Validate customer email format before sending; handle bounces (Phase 4); monitor SES reputation dashboard |
| **Template rendering XSS** | If email body is rendered as HTML, injected content could be unsafe | Sanitize/escape user-provided placeholder values before insertion; use plaintext alternative |
| **`aws-sdk-sesv2` compile time** | Slows debug builds | The SDK is modular; only SES crate is pulled. Expected impact: +20-30s. Acceptable. |
| **Cloudflare Workers can't use the Rust SDK** | Need a separate sending path for `apps/site` | Defer site email to Phase 5 (tiny volume, not urgent) |

---

### 1.12 Cost Estimate

| Item | Cost |
|------|------|
| SES sending (first 62,000/month from EC2) | Free |
| SES sending (beyond free tier) | $0.10 / 1,000 emails |
| SNS notifications for delivery events | $0.50 / 1M notifications (essentially free) |
| SQS for event queue | Free tier covers it |
| **Realistic monthly cost** (< 5,000 emails) | **$0.00 – $0.50** |

---

## 2. External Service Integration Patterns

Since SES is the first external service, this section establishes patterns for future
integrations (e.g. Twilio for SMS, payment providers, etc.).

### 2.1 Configuration Pattern

External services follow the same pattern:

1. **Config fields are `Option<T>`** — the service is disabled if not configured
2. **Credentials come from environment** — resolved by the service's SDK or read manually
3. **All secrets go through SOPS** — encrypted in Git, decrypted at deploy time
4. **`worker/.env.example`** documents all variables with placeholder values
5. **`Makefile` `worker-env` target** extracts the relevant vars from the SOPS source

### 2.2 Graceful Degradation

All external service processors follow this contract:

```
if config is present:
    initialize client → process jobs normally
else:
    log warning at startup
    process jobs by marking them Failed with "service not configured"
    never panic or block other services
```

The worker always starts, even without AWS credentials. Email jobs queue up in JetStream
and fail gracefully until the service is configured.

### 2.3 JetStream Job Queue Pattern

All external service interactions use the existing JetStream job queue:

```
Frontend/Handler → submit_job() → JetStream stream → consumer → process_job() → external API
                                                                      ↓
                                                              publish_status() → NATS subject
```

This pattern provides:
- **Durability:** Jobs survive worker restarts (JetStream persistence)
- **Retries:** `max_deliver` controls automatic redelivery on failure
- **Cancellation:** Pre-cancel check via the cancellation service
- **Status updates:** Real-time status published to NATS for frontend polling
- **Backpressure:** JetStream consumer pull model prevents overloading

### 2.4 Secrets Inventory

| Service | Variables | Status |
|---------|-----------|--------|
| **NATS** | `NATS_WORKER_PASSWORD`, `NATS_BROWSER_PASSWORD` | In SOPS |
| **PostgreSQL** | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL` | In SOPS |
| **JWT** | `JWT_SECRET` | In SOPS |
| **Nominatim** | `NOMINATIM_PASSWORD` | In SOPS |
| **Amazon SES** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | To add |
| **Cloudflare (site)** | `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` | In SOPS (Cloudflare env) |
| **Twilio SMS** (future) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Not yet |

---

## 3. File Change Inventory

| File | Change | Phase |
|------|--------|-------|
| New: `worker/src/services/template_renderer.rs` | `render_template`, `render_template_html`, `build_*_vars` functions + tests | 1 |
| `worker/src/services/mod.rs` | Add `pub mod template_renderer;` and `pub mod email_data;` | 1, 3 |
| `worker/Cargo.toml` | Add `aws-config`, `aws-sdk-sesv2` | 2 |
| `worker/src/config.rs` | Add `ses_region`, `ses_from_email`, `ses_from_name`, `ses_configuration_set` fields + tests | 2 |
| `worker/src/services/email_processor.rs` | Replace `EmailConfig` with `SesEmailConfig`; add `SesClient`, `PgPool`, `send_email()`, `EmailSendError`, rewrite `process_job()`, add `log_communication()` | 2–6 |
| New: `worker/src/services/email_data.rs` | `resolve_confirmation_data`, `resolve_reminder_data` DB queries | 3 |
| `worker/src/main.rs` | Initialize `SesEmailConfig`, create + spawn `EmailProcessor` | 7 |
| `worker/.env.example` | Add SES placeholder variables | 8 |
| `Makefile` | Add SES vars to `worker-env` grep pattern | 8 |
| `infra/secrets/.env.{dev,staging,production}.enc` | Add AWS/SES credentials | 8 |
| New: `worker/src/services/reminder_scheduler.rs` | `find_revisions_needing_reminder` query + scheduler loop | 9 |
| New: `worker/src/services/ses_events.rs` | SQS polling for delivery status | 10 |
| `worker/Cargo.toml` | Add `aws-sdk-sqs` | 10 |
| `worker/src/db/queries/communication.rs` | Add `update_email_status` query | 10 |

---

## 4. Open Questions

1. **EU data residency:** Should we restrict SES to `eu-central-1` (Frankfurt) only, or allow `eu-west-1` (Ireland) as a fallback? Both are GDPR-compliant.

2. **Sender identity:** Is `noreply@ariadline.cz` the production sender, or should each user have their own verified sender address? Per-user addresses require SES identity verification for each.

3. **Reply handling:** If a customer replies to a confirmation email, where should it go? Options: user's business email (set as `Reply-To` header), a shared inbox, or silently dropped (`noreply@`).

4. **Reminder scheduling trigger:** Should reminders run on a fixed daily schedule (e.g. 09:00 every morning), or should the worker check for due reminders on an interval (e.g. every hour)?

5. **Rate limiting:** SES has a sending rate limit (starts at 1 email/second in sandbox, increases in production). Should the email processor enforce its own rate limit, or rely on SES throttling + JetStream redelivery?

6. **Cloudflare site emails:** Use SES (via `aws4fetch` + Sig v4) or keep Resend for the marketing site's tiny email volume?
