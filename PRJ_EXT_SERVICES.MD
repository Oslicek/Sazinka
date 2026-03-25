# PRJ_EXT_SERVICES — External Services Integration

> **Created:** 2026-02-23
> **Status:** Analysis complete; MVP decisions locked (custom domains, Ariadline fallback, reminder schedule, **site → SES**). Implementation not started in this file.

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
| Resend spike (Cloudflare) | `apps/site/functions/__tests__/resend-spike.workers.test.ts` | Legacy PoC; **site → SES** per §1.9 / Phase 12 |
| SOPS secrets pipeline | `Makefile`, `.sops.yaml`, `infra/secrets/` | Complete — ready to add new secrets |

**Key finding:** The existing `EmailConfig` was designed around Resend (`api_key`, `from_email`, `from_name`).
Switching to SES changes the config shape but preserves the `EmailProcessor` queue and job type architecture.

### 1.3 Two Deployment Contexts

Email needs to be sent from two different runtimes:

| Context | Runtime | Use Cases | Current Plan |
|---------|---------|-----------|--------------|
| **Rust worker** | Tokio on a server/VPS | Revision reminders, appointment confirmations, custom transactional emails | `email_processor.rs` with JetStream queue |
| **Cloudflare Workers** | `workerd` (edge) | Newsletter confirmation, contact form auto-reply | `apps/site/functions/` — **planned: SES** (Sig v4), not Resend |

Both can use the same SES account and verified domain. The integration approach differs:

- **Rust worker:** `aws-sdk-sesv2` crate (official, async, Tokio-native)
- **Cloudflare Workers:** SES v2 REST API with AWS Signature v4 signing (no SDK — Workers runtime doesn't support the full AWS SDK)

This analysis focuses on the **Rust worker** integration first. The Cloudflare Workers
integration is a separate, smaller task documented in section 1.9.

---

### 1.3.1 Locked MVP Decisions (Confirmed)

The following decisions were explicitly confirmed and are now treated as implementation requirements:

1. **SES region:** Use `eu-central-1` for MVP. Design should remain extensible for future multi-region support.
2. **Sender model:** Support one **active** customer domain per user in MVP.
3. **DB strategy:** Keep schema forward-compatible for future multi-domain expansion (multiple rows + active flag model).
4. **Identity type:** Domain identities only. Per-email identity fallback is out of scope.
5. **Fallback sender:** Use shared platform address `noreply@ariadline.cz`.
6. **Fallback display name:** `"<User business name> via Ariadline"`.
7. **Fallback reply handling:** If customer domain is not verified, send from Ariadline domain and set `Reply-To` to user's business email.
8. **Verification lifecycle:** Implement full SES identity lifecycle in-app for MVP: `CreateEmailIdentity`, `GetEmailIdentity`, `DeleteEmailIdentity`.
9. **Verification checks:** Support both background polling and manual "Check now".
10. **Rate limiting strategy:** Rely on SES throttling + JetStream retries in MVP.
11. **UI scope:** Simple verification UI only (`pending` / `verified` / `failed`) plus manual "Check now" action.
12. **Reminder send schedule:** One **per-company** send time (`users.email_reminder_send_time`, UI: “Čas automatického odeslání”) — user-configurable; **may** restrict the picker to **full hours** only. The worker still runs a **minimum hourly** scheduler tick; each tick evaluates which companies’ configured time matches the **current local wall-clock** slot and only then enqueues reminders for those users (not “once per day globally”).
13. **Cloudflare site (`apps/site`):** Use **Amazon SES** for transactional mail (newsletter opt-in, contact form, etc.), not Resend. Implement **SES v2 HTTP API** from Workers with **AWS Signature Version 4** (e.g. `aws4fetch` or equivalent). Same **`eu-central-1`** region and AWS account as the Rust worker unless explicitly split for IAM reasons.

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
with `rustls`, there is no TLS stack conflict — `aws-sdk-*` brings its own HTTP client.

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
    /// Platform fallback sender email (shared sender for users without verified domain)
    pub ses_from_email: Option<String>,
    /// Platform brand name used in fallback sender formatting
    pub ses_from_name: Option<String>,
}
```

AWS credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are read automatically
by `aws-config` from the environment — no need to store them in `Config`.

The `Option<String>` pattern matches the existing approach: if `ses_region` is `None`,
the email processor starts but logs a warning and skips sending (graceful degradation).

In MVP, `ses_from_email` is the shared Ariadline sender (`noreply@ariadline.cz`) and **not**
the primary sender for all users. The effective `From` address is selected dynamically per user:
- verified custom domain → use customer's domain sender,
- no/failed/pending custom domain → use Ariadline fallback sender.

**File:** `worker/src/services/email_processor.rs`

Replace `EmailConfig` entirely:

```rust
pub struct EmailProcessor {
    client: async_nats::Client,
    js: JsContext,
    ses_client: Option<aws_sdk_sesv2::Client>,
    fallback_from_email: String, // shared: noreply@ariadline.cz
    fallback_from_name: String,  // Ariadline
    configuration_set: Option<String>,
    pool: PgPool,
}
```

The `ses_client` is `None` when SES is not configured (dev mode without AWS credentials).
`fallback_from_*` is used only when user domain is not verified.

#### 1.4.3 SES Client Initialization

**File:** `worker/src/services/email_processor.rs`

```rust
impl EmailProcessor {
    pub async fn new(
        nats_client: async_nats::Client,
        pool: PgPool,
        ses_region: Option<&str>,
        fallback_from_email: &str,
        fallback_from_name: &str,
        configuration_set: Option<String>,
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

        Ok(Self {
            client: nats_client,
            js,
            ses_client,
            fallback_from_email: fallback_from_email.to_string(),
            fallback_from_name: fallback_from_name.to_string(),
            configuration_set,
            pool,
        })
    }
}
```

#### 1.4.4 Email Sending Implementation

**File:** `worker/src/services/email_processor.rs` — `process_job` method

Replace the current TODO with actual SES sending:

```rust
async fn send_email(
    &self,
    user_id: Uuid,
    to: &str,
    subject: &str,
    body_html: &str,
    body_text: Option<&str>,
) -> Result<String> {
    let ses = self.ses_client.as_ref()
        .ok_or_else(|| anyhow::anyhow!("SES client not configured"))?;

    // Resolve user's domain status and choose sender dynamically.
    // - verified domain: "Business Name <info@customer-domain>"
    // - fallback:        "Business Name via Ariadline <noreply@ariadline.cz>" + Reply-To user email
    let sender = domain_verification::select_from_address(
        &self.pool,
        user_id,
        &self.fallback_from_email,
        &self.fallback_from_name,
    ).await?;

    let mut req = ses.send_email()
        .from_email_address(&sender.from)
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
        );

    if let Some(reply_to) = sender.reply_to.as_deref() {
        req = req.reply_to_addresses(reply_to);
    }
    if let Some(cs) = self.configuration_set.as_deref() {
        req = req.configuration_set_name(cs);
    }

    let result = req.send().await?;

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

The `EmailProcessor` needs to be created (with `SesEmailConfig` + `PgPool`) and its
`start_processing` task spawned alongside the existing handler setup.

See **Phase 8** (§1.10) for the authoritative initialization snippet using the
`SesEmailConfig` struct pattern (`region`, `from_email`, `from_name`,
`configuration_set`) and `pool.clone()`.

---

### 1.5 Changes Required — Secrets & Infrastructure

#### 1.5.1 New Environment Variables

| Variable | Required | Example | Where Used |
|----------|----------|---------|------------|
| `AWS_ACCESS_KEY_ID` | Yes (for SES) | `AKIA...` | `aws-config` auto-reads |
| `AWS_SECRET_ACCESS_KEY` | Yes (for SES) | `wJal...` | `aws-config` auto-reads |
| `SES_REGION` | Yes | `eu-central-1` | `Config::from_env()` (locked MVP region) |
| `SES_FROM_EMAIL` | Yes | `noreply@ariadline.cz` | Shared fallback sender |
| `SES_FROM_NAME` | Yes | `Ariadline` | Base fallback branding |
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

Create an IAM user `sazinka-ses-sender` with permissions for:
- sending from shared Ariadline fallback sender (`noreply@ariadline.cz`)
- managing SES domain identities for customer domain onboarding

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SendFromAriadlineFallback",
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "arn:aws:ses:eu-central-1:ACCOUNT_ID:identity/ariadline.cz"
    },
    {
      "Sid": "ManageCustomerDomainIdentities",
      "Effect": "Allow",
      "Action": [
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:DeleteEmailIdentity",
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "arn:aws:ses:eu-central-1:ACCOUNT_ID:identity/*"
    }
  ]
}
```

This is the minimum practical policy for the locked MVP scope:
domain onboarding is handled in-app, per-email identity onboarding is intentionally out of scope.

#### 1.5.4 Domain Verification (One-Time Setup)

Before SES can send email from `@ariadline.cz`, the domain must be verified in the AWS console:

1. **DKIM:** Add 3 CNAME records provided by SES to the domain's DNS
2. **SPF:** Add `include:amazonses.com` to the existing SPF record (or create one)
3. **DMARC:** Add a `_dmarc` TXT record: `v=DMARC1; p=quarantine; rua=mailto:dmarc@ariadline.cz`
4. **Return-Path:** SES sets a custom return-path for bounce handling

SES starts in **sandbox mode** — sending is limited to verified email addresses only.
Request production access once the domain is verified and a few test emails are confirmed.

For customer-owned domains, verification is handled in-app through Phase 3:
- create identity via SES API,
- show DKIM records in settings,
- customer adds DNS records,
- poll/manual check updates verification status.

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

### 1.7 Delivery Status Tracking (Future Phase 11)

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

### 1.9 Cloudflare Workers (apps/site) — SES (locked)

**Decision (locked):** The marketing site sends mail via **Amazon SES** in **`eu-central-1`**, same provider as the Rust worker (§1.3.1 #13). **Resend is not** the target architecture for `apps/site`.

**Use cases:**
- Newsletter double-opt-in confirmation
- Contact form auto-reply (future)

**Implementation approach:**
- Call **SES v2** `SendEmail` over HTTPS; sign requests with **AWS Signature Version 4** (common pattern: [`aws4fetch`](https://github.com/mhart/aws4fetch) or maintained fork, or minimal custom signer).
- **Secrets** in Cloudflare (Wrangler / dashboard): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_REGION` (`eu-central-1`), plus fixed `From` / configuration set for the site (verified identity in SES — typically the same platform domain as the worker).
- **IAM:** Either reuse the worker IAM user (simplest ops) or a **dedicated** IAM user scoped to `ses:SendEmail` (and optionally `SendRawEmail`) on the site’s verified identities only — document in the DevOps runbook.
- **Not used:** Routing site email through the Rust worker/NATS for MVP (optional future simplification if you want a single HTTP ingress).

**Tests:** Unit-test the signer + request shape where pure; integration tests against SES sandbox as needed (consistent with low volume).

See **Phase 12** in the implementation plan below.

---

### 1.10 Implementation Plan — Detailed TDD Steps

> **Dependency order:** Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Phases 10, 11, and 12 are independent follow-ups (12 can run in parallel with worker phases after SES account setup).
>
> Each step follows the project TDD cycle: Red → Green → Refactor → Update PROJECT_CONTEXT → Commit.
> The goal for implementation is near-100% coverage on all new pure logic and service orchestration paths,
> including corner cases (fallback sender, verification states, retry semantics, and template rendering edge cases).

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
    fallback_from_email: String,
    fallback_from_name: String,
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

    let (ses_client, fallback_from_email, fallback_from_name, configuration_set) = match ses_config {
        Some(cfg) => {
            let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
                .region(aws_config::Region::new(cfg.region))
                .load()
                .await;
            (
                Some(aws_sdk_sesv2::Client::new(&aws_config)),
                cfg.from_email, // shared Ariadline fallback sender
                cfg.from_name,  // Ariadline brand
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
        fallback_from_email,
        fallback_from_name,
        configuration_set,
        pool,
    })
}
```

No unit test for SES client creation (requires AWS credentials). Tested via
the `ses_client.is_none()` path in `process_job`.

---

#### Phase 3 — Domain Identity Management (NEW)

This phase implements sender identity lifecycle for customer-owned domains while preserving
shared Ariadline fallback sending.

**MVP constraints (locked):**
- One active customer domain per user.
- DB model is forward-compatible for future multi-domain support.
- Domain identities only (no per-email identity fallback in MVP).
- Verification state updates via background poller + manual "Check now".

**Step 3.1 — Create forward-compatible domain table**

**File:** new `worker/migrations/040_user_email_domains.sql`

```sql
CREATE TABLE user_email_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain TEXT NOT NULL,
    from_email TEXT NOT NULL,
    from_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    dkim_tokens TEXT[] NOT NULL DEFAULT '{}',
    dkim_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    verified_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_email_domains_user ON user_email_domains(user_id);
CREATE UNIQUE INDEX idx_user_email_domains_user_active
    ON user_email_domains(user_id) WHERE is_active = true;
```

**File:** new `worker/src/services/domain_verification.rs`

**Step 3.2 — RED: `select_from_address` tests (pure sender-selection logic)**

The `select_from_address` function is the core business rule for dynamic sender selection.
It can be tested as a pure function (takes domain row + fallback config, returns `SenderInfo`).

```rust
pub struct SenderInfo {
    pub from: String,       // "Display Name <email>"
    pub reply_to: Option<String>,
}
```

Tests:

```rust
#[test]
fn select_from_verified_domain_uses_domain_sender() {
    // user has verified active domain with from_email="info@firma.cz", from_name="Firma"
    // → SenderInfo { from: "Firma <info@firma.cz>", reply_to: None }
}

#[test]
fn select_from_pending_domain_uses_fallback_with_reply_to() {
    // user has pending active domain, business_email="jan@firma.cz", business_name="Firma"
    // → SenderInfo { from: "Firma via Ariadline <noreply@ariadline.cz>", reply_to: Some("jan@firma.cz") }
}

#[test]
fn select_from_failed_domain_uses_fallback_with_reply_to() {
    // same as pending — failed domain falls back identically
}

#[test]
fn select_from_no_domain_at_all_uses_fallback_with_reply_to() {
    // user has zero rows in user_email_domains
    // → fallback + Reply-To to business email
}

#[test]
fn select_from_inactive_verified_domain_uses_fallback() {
    // user has a verified domain but is_active=false → fallback
}

#[test]
fn fallback_display_name_includes_business_name_via_ariadline() {
    // business_name="Revize Praha" → from: "Revize Praha via Ariadline <noreply@ariadline.cz>"
}

#[test]
fn fallback_display_name_empty_business_name() {
    // business_name="" → from: "Ariadline <noreply@ariadline.cz>" (no "via" prefix)
}

#[test]
fn fallback_display_name_special_chars_escaped() {
    // business_name='Novák "Elektro" s.r.o.' → quotes in display name are safe (RFC 5322)
}

#[test]
fn verified_domain_reply_to_is_none() {
    // When sending from verified domain, reply_to must be None (replies go to from_email directly)
}

#[test]
fn fallback_reply_to_is_user_business_email() {
    // When falling back to Ariadline, reply_to = user's business email so customer replies reach user
}
```

**Step 3.3 — RED: Domain input validation tests**

```rust
#[test]
fn validate_domain_accepts_valid_domain() {
    assert!(validate_domain("firma.cz").is_ok());
    assert!(validate_domain("sub.firma.cz").is_ok());
}

#[test]
fn validate_domain_rejects_empty() {
    assert!(validate_domain("").is_err());
}

#[test]
fn validate_domain_rejects_spaces() {
    assert!(validate_domain("firma .cz").is_err());
}

#[test]
fn validate_domain_rejects_leading_trailing_dots() {
    assert!(validate_domain(".firma.cz").is_err());
    assert!(validate_domain("firma.cz.").is_err());
}

#[test]
fn validate_domain_rejects_protocol_prefix() {
    assert!(validate_domain("https://firma.cz").is_err());
}

#[test]
fn validate_from_email_must_be_on_domain() {
    assert!(validate_from_email("info@firma.cz", "firma.cz").is_ok());
    assert!(validate_from_email("info@other.cz", "firma.cz").is_err());
}

#[test]
fn validate_from_email_rejects_invalid_email() {
    assert!(validate_from_email("not-an-email", "firma.cz").is_err());
}
```

**Step 3.4 — RED: Verification status transition tests**

```rust
#[test]
fn status_pending_to_verified_when_ses_confirms() {
    // SES GetEmailIdentity returns VerificationStatus::Success
    // → update row: verification_status="verified", verified_at=now, last_checked_at=now
}

#[test]
fn status_pending_stays_pending_when_ses_still_pending() {
    // SES returns VerificationStatus::Pending
    // → update last_checked_at only
}

#[test]
fn status_pending_to_failed_when_ses_reports_failed() {
    // SES returns VerificationStatus::Failed
    // → update row: verification_status="failed", last_checked_at=now, verified_at stays NULL
}

#[test]
fn status_verified_stays_verified_on_recheck() {
    // Already verified, SES still says Success → no-op (idempotent)
}

#[test]
fn status_failed_to_verified_when_user_fixes_dns() {
    // Previously failed, user fixes DNS records, SES now returns Success
    // → update row: verification_status="verified", verified_at=now
}

#[test]
fn check_updates_last_checked_at_regardless_of_outcome() {
    // Every check — pending, verified, or failed — always sets last_checked_at
}
```

**Step 3.5 — RED: One-active-domain constraint tests**

```rust
#[test]
fn setup_new_domain_deactivates_previous_active_domain() {
    // User had active verified domain for "old.cz"
    // Setup new domain "new.cz" → old.cz row becomes is_active=false
}

#[test]
fn delete_active_domain_leaves_user_with_no_active_domain() {
    // After deletion, select_from_address falls back to Ariadline
}

#[test]
fn cannot_have_two_active_domains_simultaneously() {
    // Enforced by the partial unique index; setup logic must deactivate before insert
}
```

**Step 3.6 — GREEN: Implement identity lifecycle and sender selection**

Core operations:
1. `create_identity(...)` → `ses:CreateEmailIdentity` (domain only)
2. `check_identity(...)` → `ses:GetEmailIdentity`
3. `delete_identity(...)` → `ses:DeleteEmailIdentity`
4. `select_from_address(...)` → returns either:
   - verified domain sender, or
   - fallback sender + `Reply-To` to business email

**Step 3.7 — Add settings-facing NATS subjects**

**NATS subjects (settings domain flow):**
- `sazinka.settings.domain.setup`
- `sazinka.settings.domain.check`
- `sazinka.settings.domain.delete`
- `sazinka.settings.domain.get`

**Step 3.8 — Add both verification update paths**

**Verification checks:**
- Poller every 10-15 minutes updates pending identities.
- Manual "Check now" triggers an immediate one-off check.
- UI state for MVP: `pending`, `verified`, `failed`.

---

#### Phase 4 — Email Data Resolution

The `process_job` method needs to load customer, revision, device, and user settings
from the database to build template variables. This is a new internal module.

**File:** new `worker/src/services/email_data.rs`

**Step 4.1 — RED: Data resolution helper tests**

The SQL queries themselves are integration-tested (SQLx), but the data formatting helpers
that post-process query results are pure and fully testable.

```rust
// --- Address formatting ---

#[test]
fn format_address_street_and_city() {
    assert_eq!(format_address("Korunní 15", "Praha"), "Korunní 15, Praha");
}

#[test]
fn format_address_street_only() {
    assert_eq!(format_address("Korunní 15", ""), "Korunní 15");
}

#[test]
fn format_address_city_only() {
    assert_eq!(format_address("", "Praha"), "Praha");
}

#[test]
fn format_address_both_empty() {
    assert_eq!(format_address("", ""), "");
}

// --- Time window formatting ---

#[test]
fn format_time_window_both_times() {
    // start=08:00, end=10:00 → "08:00–10:00"
    assert_eq!(
        format_time_window(Some(NaiveTime::from_hms(8, 0, 0)), Some(NaiveTime::from_hms(10, 0, 0))),
        Some("08:00–10:00".to_string())
    );
}

#[test]
fn format_time_window_start_only() {
    assert_eq!(
        format_time_window(Some(NaiveTime::from_hms(8, 0, 0)), None),
        Some("08:00".to_string())
    );
}

#[test]
fn format_time_window_neither() {
    assert_eq!(format_time_window(None, None), None);
}

// --- Template selection (custom vs locale defaults) ---

#[test]
fn template_selection_uses_custom_when_edited() {
    // email_confirmation_edited_at is Some → use user's custom templates
    let (subj, body) = select_templates(
        Some("Custom subject"), Some("Custom body"),
        Some(Utc::now()), "cs",
    );
    assert_eq!(subj, "Custom subject");
}

#[test]
fn template_selection_uses_locale_defaults_when_never_edited() {
    // email_confirmation_edited_at is None → generate defaults from company_locale
    let (subj, body) = select_templates(None, None, None, "cs");
    assert!(subj.contains("Potvrzení")); // Czech default
}

#[test]
fn template_selection_uses_locale_defaults_when_templates_null_but_edited() {
    // Edge: edited_at is Some but template columns are NULL → still use defaults
    let (subj, _) = select_templates(None, None, Some(Utc::now()), "cs");
    assert!(subj.contains("Potvrzení"));
}

#[test]
fn template_selection_en_locale_defaults() {
    let (subj, _) = select_templates(None, None, None, "en");
    assert!(subj.contains("Confirmation")); // English default
}

#[test]
fn template_selection_sk_locale_defaults() {
    let (subj, _) = select_templates(None, None, None, "sk");
    assert!(subj.contains("Potvrdenie")); // Slovak default
}

#[test]
fn template_selection_unknown_locale_falls_back_to_en() {
    let (subj, _) = select_templates(None, None, None, "de");
    assert!(subj.contains("Confirmation")); // fallback to English
}
```

**Step 4.2 — GREEN: `resolve_confirmation_data` query**

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

The SQL query itself is tested via integration tests or manual QA (consistent with project
conventions: "What NOT to Test — Third-party libraries (SQLx)"). The helpers it calls
(`format_address`, `format_time_window`, `select_templates`) are unit-tested above.

**Step 4.3 — GREEN: `resolve_reminder_data` query**

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

**Step 4.4 — RED/GREEN: Guard — skip if no recipient email**

```rust
#[test]
fn resolve_returns_none_when_customer_has_no_email() {
    // customer.email IS NULL → return None (caller handles as NoRecipient)
}

#[test]
fn resolve_returns_none_when_customer_email_is_empty_string() {
    // customer.email = "" → treat as no email, return None
}

#[test]
fn resolve_returns_none_when_revision_not_found() {
    // revision_id doesn't exist or belongs to different user → None
}

#[test]
fn resolve_returns_none_when_customer_not_found() {
    // customer_id doesn't exist or belongs to different user → None
}
```

Both resolve functions return `None` if `customer.email IS NULL` or empty — the caller
logs a warning and marks the job as failed with `"Customer has no email address"`.

**Step 4.5 — Register module**

**File:** `worker/src/services/mod.rs` — add `pub mod email_data;`

---

#### Phase 5 — SES Send Function

**File:** `worker/src/services/email_processor.rs`

**Step 5.1 — RED: `EmailSendError` enum tests**

```rust
#[test]
fn email_send_error_display_not_configured() {
    assert_eq!(EmailSendError::NotConfigured.to_string(), "SES not configured");
}

#[test]
fn email_send_error_display_no_recipient() {
    assert_eq!(EmailSendError::NoRecipient.to_string(), "Recipient has no email address");
}

#[test]
fn email_send_error_display_permanent() {
    let e = EmailSendError::Permanent("bad address".to_string());
    assert_eq!(e.to_string(), "Permanent SES error: bad address");
}

#[test]
fn email_send_error_display_transient() {
    let e = EmailSendError::Transient("throttled".to_string());
    assert_eq!(e.to_string(), "Transient SES error: throttled");
}
```

**Step 5.2 — RED: SES error classification tests**

Classifying AWS SDK errors into transient vs permanent is critical for retry semantics.
Extract a `classify_ses_error(err) -> EmailSendError` pure function.

```rust
#[test]
fn classify_throttling_exception_as_transient() {
    // SES ThrottlingException → EmailSendError::Transient
}

#[test]
fn classify_service_unavailable_as_transient() {
    // SES returns 503 or InternalServiceError → Transient
}

#[test]
fn classify_too_many_requests_as_transient() {
    // SES TooManyRequestsException → Transient
}

#[test]
fn classify_message_rejected_as_permanent() {
    // SES MessageRejected → Permanent
}

#[test]
fn classify_mail_from_domain_not_verified_as_permanent() {
    // SES MailFromDomainNotVerifiedException → Permanent
}

#[test]
fn classify_account_suspended_as_permanent() {
    // SES AccountSendingPausedException → Permanent
}

#[test]
fn classify_invalid_parameter_as_permanent() {
    // SES InvalidParameterValue (bad email format etc.) → Permanent
}

#[test]
fn classify_unknown_sdk_error_as_transient() {
    // Unrecognized error code → default to Transient (safer: will retry)
}
```

**Step 5.3 — RED: `send_email` behaviour tests (mock SES client)**

These tests use a mock/trait-based SES client to verify request construction
without calling AWS.

```rust
#[tokio::test]
async fn send_email_returns_not_configured_when_no_ses_client() {
    // ses_client = None → EmailSendError::NotConfigured
}

#[tokio::test]
async fn send_email_with_verified_domain_sets_from_without_reply_to() {
    // select_from_address returns verified domain sender
    // → SES request has From="Firma <info@firma.cz>", no ReplyTo
}

#[tokio::test]
async fn send_email_with_fallback_sets_from_and_reply_to() {
    // select_from_address returns fallback sender
    // → SES request has From="Firma via Ariadline <noreply@ariadline.cz>",
    //   ReplyTo=["jan@firma.cz"]
}

#[tokio::test]
async fn send_email_attaches_configuration_set_when_present() {
    // configuration_set = Some("sazinka-tracking")
    // → SES request includes ConfigurationSetName
}

#[tokio::test]
async fn send_email_omits_configuration_set_when_none() {
    // configuration_set = None → SES request has no ConfigurationSetName
}

#[tokio::test]
async fn send_email_returns_message_id_from_ses_response() {
    // SES mock returns message_id="abc-123"
    // → Ok("abc-123")
}

#[tokio::test]
async fn send_email_returns_unknown_when_ses_has_no_message_id() {
    // SES mock returns None for message_id
    // → Ok("unknown")
}

#[tokio::test]
async fn send_email_sets_utf8_charset_on_subject_and_body() {
    // Verify charset="UTF-8" on subject, html body, and text body
}

#[tokio::test]
async fn send_email_includes_both_html_and_text_body() {
    // Verify both Body.Html and Body.Text are set in the SES request
}
```

**Step 5.4 — GREEN: `send_email` method (domain-aware)**

```rust
async fn send_email(
    &self,
    user_id: Uuid,
    to: &str,
    subject: &str,
    body_html: &str,
    body_text: &str,
) -> Result<String, EmailSendError> {
    let ses = self.ses_client.as_ref()
        .ok_or(EmailSendError::NotConfigured)?;

    // Dynamic sender: verified custom domain → user's domain sender;
    // otherwise → "Business Name via Ariadline <noreply@ariadline.cz>" + Reply-To
    let sender = domain_verification::select_from_address(
        &self.pool,
        user_id,
        &self.fallback_from_email,
        &self.fallback_from_name,
    ).await.map_err(|e| EmailSendError::Permanent(e.to_string()))?;

    let mut req = ses.send_email()
        .from_email_address(&sender.from)
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

    if let Some(reply_to) = sender.reply_to.as_deref() {
        req = req.reply_to_addresses(reply_to);
    }
    if let Some(ref cs) = self.configuration_set {
        req = req.configuration_set_name(cs);
    }

    let output = req.send().await?;
    Ok(output.message_id().unwrap_or("unknown").to_string())
}
```

**Step 5.5 — GREEN: `EmailSendError` enum + `classify_ses_error`**

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

The `process_job` method uses this to decide:
- `Transient` → do NOT ack the message (JetStream redelivers, up to `max_deliver: 5`)
- `Permanent` / `NotConfigured` / `NoRecipient` → ack + mark job `Failed`

---

#### Phase 6 — Wire `process_job` End-to-End

**File:** `worker/src/services/email_processor.rs`

**Step 6.0 — RED: `process_job` orchestration tests**

These tests verify the full job-processing pipeline using mocked SES and DB.
Each test follows one path through the `process_job` state machine.

```rust
// --- Cancellation ---

#[tokio::test]
async fn process_job_cancelled_job_is_acked_and_skipped() {
    // Job ID is in CANCELLATION set → ack immediately, no SES call,
    // no status published (or publish Cancelled), CANCELLATION.remove() called
}

// --- SES not configured ---

#[tokio::test]
async fn process_job_ses_not_configured_publishes_failed_and_acks() {
    // ses_client=None → publish Failed("Email service not configured") + ack
    // No SES call, no DB call
}

// --- Confirmation path (happy) ---

#[tokio::test]
async fn process_job_confirmation_happy_path() {
    // 1. Publishes Sending status
    // 2. resolve_confirmation_data returns valid data
    // 3. Template rendered with correct vars
    // 4. send_email called with correct (user_id, to, subject, html, text)
    // 5. log_communication called
    // 6. Publishes Sent(message_id, recipient)
    // 7. Message acked
}

// --- Reminder path (happy) ---

#[tokio::test]
async fn process_job_reminder_happy_path() {
    // Same as confirmation but uses resolve_reminder_data + build_reminder_vars
}

// --- Custom path (happy) ---

#[tokio::test]
async fn process_job_custom_happy_path() {
    // No DB lookup — uses fields from CustomEmailRequest directly
    // send_email called, Sent status published, message acked
}

#[tokio::test]
async fn process_job_custom_uses_body_text_when_provided() {
    // req.body_text = Some("plain text") → passed as body_text to send_email
}

#[tokio::test]
async fn process_job_custom_falls_back_to_body_html_for_text() {
    // req.body_text = None → body_html used as body_text fallback
}

// --- NoRecipient errors ---

#[tokio::test]
async fn process_job_confirmation_no_email_publishes_failed_and_acks() {
    // resolve_confirmation_data returns None (customer has no email)
    // → publish Failed("Recipient has no email address") + ack
}

#[tokio::test]
async fn process_job_reminder_no_email_publishes_failed_and_acks() {
    // resolve_reminder_data returns None → same as above
}

// --- DB errors ---

#[tokio::test]
async fn process_job_confirmation_db_error_publishes_failed_and_acks() {
    // resolve_confirmation_data returns Err (DB connection issue)
    // → Permanent error → publish Failed + ack
}

// --- Transient SES errors ---

#[tokio::test]
async fn process_job_transient_ses_error_does_not_ack() {
    // send_email returns Transient("throttled")
    // → message NOT acked (JetStream will redeliver up to max_deliver)
    // → no Sent status published
}

// --- Permanent SES errors ---

#[tokio::test]
async fn process_job_permanent_ses_error_publishes_failed_and_acks() {
    // send_email returns Permanent("MessageRejected")
    // → publish Failed + ack (do not retry)
}

// --- Invalid payload ---

#[tokio::test]
async fn process_job_invalid_json_payload_returns_error() {
    // msg.payload is not valid QueuedEmailJob JSON → deserialization error
}

// --- CRM logging non-fatal ---

#[tokio::test]
async fn process_job_crm_log_failure_still_reports_sent() {
    // send_email succeeds, log_communication fails (DB error)
    // → Sent status is still published, message is still acked
    // (log_communication failure is non-fatal)
}

// --- Status publishing ---

#[tokio::test]
async fn process_job_publishes_sending_before_processing() {
    // Before any DB/SES call, Sending status is published to NATS
}
```

**Step 6.1 — RED: `process_confirmation` integration tests**

```rust
#[tokio::test]
async fn process_confirmation_renders_subject_and_body_with_correct_vars() {
    // Given: confirmation data with customer "Jan Novák", date "15.3.2026"
    // When: process_confirmation called
    // Then: rendered subject contains "Jan Novák", rendered body contains "15.3.2026"
}

#[tokio::test]
async fn process_confirmation_uses_html_escaping_for_body() {
    // Customer name contains <script> tag → HTML body escapes it,
    // plaintext body does not escape
}

#[tokio::test]
async fn process_confirmation_sends_to_customer_email() {
    // send_email.to = customer's email from resolve_confirmation_data
}
```

**Step 6.2 — GREEN: `process_job` implementation**

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
            self.process_custom(job.user_id, req).await
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

**Step 6.3 — GREEN: `process_confirmation` method**

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
        user_id, &data.recipient_email, &subject, &body_html, &body_text
    ).await?;

    // 5. Log to CRM
    self.log_communication(
        user_id, req.customer_id, Some(req.revision_id),
        &subject, &body_html, &data.recipient_email, &message_id,
    ).await;

    Ok((message_id, data.recipient_email))
}
```

**Step 6.4 — GREEN: `process_reminder` method**

Same pattern as `process_confirmation` but uses `resolve_reminder_data` and
`build_reminder_vars`.

**Step 6.5 — GREEN: `process_custom` method**

The `Custom` variant already carries `to`, `subject`, `body_html`, `body_text` —
no DB lookup needed. Just send directly.

```rust
async fn process_custom(
    &self,
    user_id: Uuid,
    req: &CustomEmailRequest,
) -> Result<(String, String), EmailSendError> {
    let message_id = self.send_email(
        user_id, &req.to, &req.subject, &req.body_html,
        req.body_text.as_deref().unwrap_or(&req.body_html),
    ).await?;

    Ok((message_id, req.to.clone()))
}
```

---

#### Phase 7 — CRM Communication Logging

**File:** `worker/src/services/email_processor.rs`

**Step 7.1 — RED: `log_communication` tests**

```rust
#[tokio::test]
async fn log_communication_creates_record_with_correct_fields() {
    // Verify: comm_type="email_sent", direction="outbound",
    // subject and content passed, customer_id and user_id bound
}

#[tokio::test]
async fn log_communication_passes_revision_id_when_present() {
    // Confirmation/reminder emails have revision_id=Some(uuid)
    // → create_communication receives it
}

#[tokio::test]
async fn log_communication_passes_none_revision_for_custom_email() {
    // Custom emails may not have a revision_id → passed as None
}

#[tokio::test]
async fn log_communication_db_error_does_not_propagate() {
    // create_communication returns Err → log_communication logs the error
    // but does NOT return Err or panic (non-fatal)
}

#[tokio::test]
async fn log_communication_db_error_does_not_affect_job_status() {
    // Even when logging fails, the calling process_* method still returns Ok
    // (the email was already sent successfully)
}
```

**Step 7.2 — GREEN: `log_communication` helper**

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
    ).await {
        error!("Failed to log email communication: {}", e);
    }
}
```

This reuses the existing `create_communication` query. The `email_status` column
defaults to `NULL` in the DB; a future migration could set it to `'sent'` on insert
(or we update the query to accept `email_status`).

---

#### Phase 8 — Wire EmailProcessor into main.rs

**File:** `worker/src/main.rs`

**Step 8.1 — Initialize and spawn**

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

**Step 8.2 — Pass `email_processor` to handlers (optional)**

If any NATS handler needs to submit email jobs directly (e.g. a "Send confirmation"
button handler), pass `Arc<EmailProcessor>` to `start_handlers`. This is deferred
until a frontend trigger exists.

For now, the `email_processor.submit_job()` API is available for future callers.

---

#### Phase 9 — Secrets & Infrastructure

Non-code changes. No TDD tests — these are operational steps.

**Step 9.1 — Update `worker/.env.example`**

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

**Step 9.2 — Update Makefile `worker-env` target**

**File:** `Makefile`

Add the new env var names to the grep pattern:

```
AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|SES_REGION|SES_FROM_EMAIL|SES_FROM_NAME|SES_CONFIGURATION_SET
```

**Step 9.3 — Add secrets to SOPS**

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

**Step 9.4 — AWS account setup (manual, one-time)**

1. Create IAM user `sazinka-ses-sender` with the policy from section 1.5.3
2. Generate access key pair
3. In SES console (`eu-central-1`): verify domain `ariadline.cz`
4. Add DNS records: 3 DKIM CNAMEs + SPF `include:amazonses.com` + DMARC TXT
5. Wait for verification (usually < 1 hour)
6. Send test email from sandbox to a verified address
7. Request production access when ready

---

#### Phase 10 — Reminder Scheduler (Future)

Runs as a background `tokio::spawn` task. Wakes **at least hourly**; on each tick,
determines which users’ **local** send-time slot matches `email_reminder_send_time`
(optional MVP: **full hours** only to simplify matching), then for those users only
finds revisions approaching due date and submits `RevisionReminder` email jobs.

**Scheduling rule (locked):** Per-company single time from settings (`email_reminder_send_time`);
hourly checking is required so the worker can fire near the configured hour without
sub-minute polling. Timezone for “local wall clock” must be defined in implementation
(e.g. explicit `user` timezone field when added, or a single default region for MVP).

**File:** new `worker/src/services/reminder_scheduler.rs`

**Step 10.1 — RED: `users_in_reminder_send_window` tests**

```rust
#[test]
fn user_with_matching_send_time_is_included() {
    // send_time=09:00, current local hour=09 → user_id in result
}

#[test]
fn user_with_non_matching_send_time_is_excluded() {
    // send_time=09:00, current local hour=14 → user_id NOT in result
}

#[test]
fn user_with_null_send_time_is_excluded() {
    // email_reminder_send_time is NULL → excluded (no reminders configured)
}

#[test]
fn multiple_users_only_matching_ones_returned() {
    // user A: 09:00 (match), user B: 14:00 (no match), user C: 09:00 (match)
    // current hour=09 → [A, C]
}

#[test]
fn send_window_uses_full_hour_comparison() {
    // send_time=09:30 with full-hours-only restriction → matches hour 09
    // (or: if we restrict to full hours, 09:30 is rounded/truncated to 09:00)
}

#[test]
fn send_window_midnight_boundary() {
    // send_time=00:00, current hour=00 → included
    // send_time=23:00, current hour=23 → included
}
```

**Step 10.2 — RED: `find_revisions_needing_reminder` tests**

```rust
#[tokio::test]
async fn finds_revision_due_tomorrow_with_one_day_reminder() {
    // reminder_days_before=[1], due_date=tomorrow, today=today → found
}

#[tokio::test]
async fn finds_revision_due_in_3_days_with_matching_reminder() {
    // reminder_days_before=[1,3,7], due_date=today+3 → found (matches 3)
}

#[tokio::test]
async fn skips_revision_due_today() {
    // reminder_days_before=[1], due_date=today → NOT found (0 days ≠ 1 day)
}

#[tokio::test]
async fn skips_revision_already_reminded_today() {
    // communication exists with comm_type='email_sent' and created_at::date = today
    // → NOT EXISTS prevents duplicate
}

#[tokio::test]
async fn allows_reminder_if_last_reminder_was_yesterday() {
    // communication exists but created_at::date = yesterday → NOT a duplicate, found
}

#[tokio::test]
async fn skips_completed_revisions() {
    // revision.status = 'completed' → NOT found (WHERE status IN ('upcoming','scheduled'))
}

#[tokio::test]
async fn skips_cancelled_revisions() {
    // revision.status = 'cancelled' → NOT found
}

#[tokio::test]
async fn includes_upcoming_revisions() {
    // revision.status = 'upcoming' → found
}

#[tokio::test]
async fn includes_scheduled_revisions() {
    // revision.status = 'scheduled' → found
}

#[tokio::test]
async fn skips_users_not_in_send_window() {
    // user_ids_in_send_window = [user_A] but revision belongs to user_B → NOT found
}

#[tokio::test]
async fn empty_user_ids_returns_empty_vec() {
    // user_ids_in_send_window = [] → no results regardless of data
}

#[tokio::test]
async fn multiple_reminder_days_before_fires_each_matching_day() {
    // reminder_days_before=[1,3,7], due_date=today+7 → found for the 7-day rule
    // due_date=today+3 → found for the 3-day rule
    // due_date=today+5 → NOT found (no matching rule)
}

#[tokio::test]
async fn idempotent_on_double_run() {
    // Run scheduler twice in same hour → second run finds nothing
    // (first run created communications, NOT EXISTS blocks second)
}
```

**Step 10.3 — GREEN: Reminder query**

```rust
pub async fn find_revisions_needing_reminder(
    pool: &PgPool,
    today: NaiveDate,
    user_ids_in_send_window: &[Uuid], // users whose local time matches reminder_send_time this hour
) -> Result<Vec<ReminderCandidate>> {
    // SELECT r.id, r.customer_id, r.user_id, r.due_date,
    //        u.reminder_days_before
    // FROM revisions r
    // JOIN users u ON u.id = r.user_id
    // WHERE u.id = ANY($user_ids)  -- only companies in the current send window
    //   AND r.status IN ('upcoming', 'scheduled')
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

**Step 10.4 — GREEN: Scheduler loop**

```rust
pub async fn run_reminder_scheduler(
    pool: PgPool,
    email_processor: Arc<EmailProcessor>,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(3600)); // minimum: hourly
    loop {
        interval.tick().await;
        let user_ids = users_in_reminder_send_window(&pool).await?; // local HH:MM matches email_reminder_send_time
        let today = Utc::now().date_naive();
        match find_revisions_needing_reminder(&pool, today, &user_ids).await {
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

**Step 10.5 — Spawn in main.rs**

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

#### Phase 11 — Delivery Status Tracking (Optional, Future)

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

#### Phase 12 — `apps/site` SES from Cloudflare Workers

Implements §1.9: replace Resend-oriented code paths with SES v2 + Sig v4. Can proceed in **parallel** with worker phases once SES identities and IAM exist; does not require NATS.

| Step | File(s) | Description |
|------|---------|-------------|
| 1 | `apps/site/` | Add SES send helper (Sig v4 + `SendEmail` JSON body); `From` uses verified platform identity |
| 2 | Wrangler / env docs | Document `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_REGION`, `SES_FROM_*`, optional `SES_CONFIGURATION_SET` for site |
| 3 | Newsletter / contact handlers | Call SES helper instead of Resend; remove `RESEND_API_KEY` usage |
| 4 | Tests | Update/remove `resend-spike` tests; add tests for signer payload shape or mocked fetch |

---

### 1.10.1 Implementation Checklist

| # | Task | Phase | Status |
|---|------|-------|--------|
| 1 | `render_template` + tests | 1 | ✅ |
| 2 | `render_template_html` (HTML-safe) + tests | 1 | ✅ |
| 3 | `build_confirmation_vars` + `build_reminder_vars` + tests | 1 | ✅ |
| 4 | Add `aws-config`, `aws-sdk-sesv2` to Cargo.toml | 2 | ✅ |
| 5 | Add SES fields to `Config` + tests | 2 | ✅ |
| 6 | Replace `EmailConfig` with `SesEmailConfig` | 2 | ✅ |
| 7 | SES client init in `EmailProcessor::new` | 2 | ✅ |
| 8 | Add `user_email_domains` migration (`is_active`, status, DKIM records) | 3 | ✅ |
| 9 | Add domain verification service (sender selection, validation, status) | 3 | ✅ |
| 10 | Add NATS domain settings handlers (`setup/check/delete/get`) | 3 | ☐ |
| 11 | Add verification poller + manual check flow | 3 | ☐ |
| 12 | `resolve_confirmation_data` query | 4 | ✅ |
| 13 | `resolve_reminder_data` query | 4 | ✅ |
| 14 | `EmailSendError` enum + `send_email` method | 5 | ✅ |
| 15 | Dynamic sender selection (`verified domain` vs `Ariadline fallback`) | 5 | ✅ |
| 16 | Wire `process_job` — confirmation path | 6 | ✅ |
| 17 | Wire `process_job` — reminder path | 6 | ✅ |
| 18 | Wire `process_job` — custom path | 6 | ✅ |
| 19 | `log_communication` helper | 7 | ✅ |
| 20 | Initialize + spawn `EmailProcessor` in main.rs | 8 | ✅ |
| 21 | Update `.env.example` | 9 | ✅ |
| 22 | Update Makefile `worker-env` | 9 | ☐ |
| 23 | Add secrets to SOPS | 9 | ☐ |
| 24 | AWS IAM + domain verification | 9 | ☐ |
| 25 | Reminder scheduler | 10 | ☐ |
| 26 | SQS delivery status polling | 11 | ☐ |
| 27 | `apps/site`: SES + Sig v4 from Workers; remove Resend | 12 | ☐ |

---

### 1.11 Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **SES sandbox mode** limits sending to verified addresses only | Cannot send to real customers until production access is granted | Request production access early; use sandbox for dev/test |
| **AWS credential leak** | Attacker can send email as the business and manage identities | IAM policy is scoped to SES only (send + identity lifecycle), credentials in SOPS, rotate immediately on suspicion |
| **Bounce rate too high** → SES suspends account | No emails go out | Validate customer email format before sending; handle bounces via delivery event tracking (Phase 11); monitor SES reputation dashboard |
| **Template rendering XSS** | If email body is rendered as HTML, injected content could be unsafe | Sanitize/escape user-provided placeholder values before insertion; use plaintext alternative |
| **`aws-sdk-sesv2` compile time** | Slows debug builds | The SDK is modular; only SES crate is pulled. Expected impact: +20-30s. Acceptable. |
| **Cloudflare Workers can't use the Rust SDK** | Need Sig v4 + HTTPS to SES for `apps/site` | Use `aws4fetch` (or equivalent) per §1.9 / Phase 12; scope IAM for site-only send if desired |

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
| **Amazon SES (worker)** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_REGION`, `SES_FROM_EMAIL`, `SES_FROM_NAME`, `SES_CONFIGURATION_SET` | To add (SOPS) |
| **Amazon SES (site)** | Same AWS/SES vars as above (or dedicated IAM user) | To add (Wrangler secrets) |
| **Cloudflare (site)** | `TURNSTILE_SECRET_KEY` | In SOPS (Cloudflare env) |
| **Twilio SMS** (future) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Not yet |

---

## 3. File Change Inventory

| File | Change | Phase |
|------|--------|-------|
| New: `worker/src/services/template_renderer.rs` | `render_template`, `render_template_html`, `build_*_vars` functions + tests | 1 |
| `worker/src/services/mod.rs` | Add `pub mod template_renderer;`, `pub mod domain_verification;`, and `pub mod email_data;` | 1, 3, 4 |
| `worker/Cargo.toml` | Add `aws-config`, `aws-sdk-sesv2` | 2 |
| `worker/src/config.rs` | Add `ses_region`, `ses_from_email`, `ses_from_name`, `ses_configuration_set` fields + tests | 2 |
| New: `worker/migrations/040_user_email_domains.sql` | Add customer-domain identity storage with forward-compatible active flag model | 3 |
| New: `worker/src/services/domain_verification.rs` | Domain identity lifecycle (`create/get/delete`) + sender selection (`verified domain` vs fallback) | 3 |
| New: `worker/src/db/queries/user_email_domain.rs` | CRUD + active-domain selection queries | 3 |
| New: `worker/src/handlers/domain.rs` | NATS handlers for domain setup/check/delete/get | 3 |
| `worker/src/services/email_processor.rs` | Replace `EmailConfig` with `SesEmailConfig`; add `PgPool`; dynamic sender selection; `EmailSendError`; rewrite `process_job()`; add `log_communication()` | 2–7 |
| New: `worker/src/services/email_data.rs` | `resolve_confirmation_data`, `resolve_reminder_data` DB queries | 4 |
| `worker/src/main.rs` | Initialize `SesEmailConfig`, create + spawn `EmailProcessor`, spawn verification poller | 8 |
| `worker/.env.example` | Add SES placeholder variables | 9 |
| `Makefile` | Add SES vars to `worker-env` grep pattern | 9 |
| `infra/secrets/.env.{dev,staging,production}.enc` | Add AWS/SES credentials | 9 |
| New: `worker/src/services/reminder_scheduler.rs` | `find_revisions_needing_reminder` query + scheduler loop | 10 |
| New: `worker/src/services/ses_events.rs` | SQS polling for delivery status | 11 |
| `worker/Cargo.toml` | Add `aws-sdk-sqs` | 11 |
| `worker/src/db/queries/communication.rs` | Add `update_email_status` query | 11 |
| `apps/site/functions/**` (handlers) | Replace Resend with SES v2 + Sig v4 | 12 |
| `apps/site/wrangler.toml` / env example | SES + AWS credentials; drop `RESEND_API_KEY` | 12 |

---

## 4. Resolved Decisions and Remaining Questions

### 4.1 Resolved MVP Decisions

1. **Region:** Use `eu-central-1`.
2. **Domain scope:** One active customer domain per user in MVP.
3. **Schema strategy:** Forward-compatible schema now; future multi-domain expansion later.
4. **Identity type:** Domain identities only (no per-email identity fallback).
5. **Fallback sender:** Shared `noreply@ariadline.cz`.
6. **Fallback display name:** `"<User business name> via Ariadline"`.
7. **Reply handling:** On fallback sends, set `Reply-To` to user's business email.
8. **Verification lifecycle:** Full in-app lifecycle (`CreateEmailIdentity`, `GetEmailIdentity`, `DeleteEmailIdentity`).
9. **Verification checks:** Both poller and manual "Check now".
10. **Rate limiting:** Rely on SES throttling + JetStream retries in MVP.
11. **Verification UI:** Simple status (`pending`/`verified`/`failed`) + manual check.
12. **Reminder scheduling:** Per-user/company `email_reminder_send_time` from settings (single time per company); UI may restrict to **full hours**. Worker uses a **minimum hourly** tick and only enqueues for users whose **local** time matches that slot on the relevant calendar day (see Phase 10).
13. **Cloudflare site email:** Use **Amazon SES** from Workers (SES v2 + Sig v4, e.g. `aws4fetch`), **`eu-central-1`**, not Resend (§1.9, Phase 12).

### 4.2 Remaining Questions

None — open product questions for this document are resolved for MVP.
