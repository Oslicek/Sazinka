
//! Onboarding wizard handlers (Phase 10).
//!
//! Handlers exposed:
//!   - `handle_register_start`       — `sazinka.auth.register.start`
//!   - `handle_verify_email`         — `sazinka.auth.email.verify`
//!   - `handle_resend_verification`  — `sazinka.auth.email.resend`
//!   - `handle_waitlist_join`        — `sazinka.waitlist.join`
//!   - `handle_onboarding_profile`   — `sazinka.onboarding.profile`
//!   - `handle_onboarding_devices`   — `sazinka.onboarding.devices`
//!   - `handle_onboarding_complete`  — `sazinka.onboarding.complete`

use std::sync::Arc;

use anyhow::Result;
use async_nats::{Client, Subscriber};
use chrono::Utc;
use futures::StreamExt;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::db::queries;
use crate::services::email_sender::EmailSender;
use crate::services::email_templates::{AlreadyRegisteredEmail, VerificationEmail};
use crate::services::rate_limiter::MultiRateLimiter;
use crate::types::{ErrorResponse, Request, SuccessResponse};

// =============================================================================
// Request / response types
// =============================================================================

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterStartRequest {
    pub email: String,
    pub password: String,
    /// BCP-47 locale code (e.g. "en", "cs", "sk"). Defaults to "en".
    pub locale: Option<String>,
    /// Two-letter ISO 3166-1 country code (e.g. "CZ", "SK").
    pub country: Option<String>,
    /// `true` if the user checked the ToS / Privacy Policy checkbox.
    pub tos_accepted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterStartResponse {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyEmailRequest {
    pub token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyEmailResponse {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResendVerificationRequest {
    pub email: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResendVerificationResponse {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitlistJoinRequest {
    pub email: String,
    pub country: String,
    pub locale: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitlistJoinResponse {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingProfileRequest {
    pub email: String,
    pub name: String,
    pub business_name: Option<String>,
    pub phone: Option<String>,
    pub ico: Option<String>,
    pub locale: String,
    pub country: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedBuiltin {
    pub device_type_key: String,
    pub default_revision_duration_minutes: i32,
    pub default_revision_interval_months: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomDeviceType {
    pub label: String,
    pub duration: i32,
    pub interval: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingDevicesRequest {
    pub email: String,
    pub selected_builtins: Vec<SelectedBuiltin>,
    pub custom_types: Vec<CustomDeviceType>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepotPayload {
    pub name: String,
    pub street: String,
    pub city: String,
    pub postal_code: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingCompleteRequest {
    pub email: String,
    pub depot: DepotPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingOkResponse {
    pub ok: bool,
}

// =============================================================================
// Helpers
// =============================================================================

/// Validate password: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit.
fn validate_password(password: &str) -> bool {
    if password.len() < 8 {
        return false;
    }
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    has_upper && has_lower && has_digit
}

/// Generate a cryptographically random URL-safe token and its SHA-256 hash.
/// Returns `(plain_token, hex_hash)`.
fn generate_token() -> (String, String) {
    let random_bytes: [u8; 32] = rand::random();
    let token = hex::encode(random_bytes);
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    (token, hash)
}

/// Hash a plain token with SHA-256 → hex string.
fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Build the verification URL for a given base URL and token.
fn build_verify_url(app_base_url: &str, token: &str) -> String {
    format!("{}/verify?token={}", app_base_url.trim_end_matches('/'), token)
}

/// Build the login URL.
fn build_login_url(app_base_url: &str) -> String {
    format!("{}/login", app_base_url.trim_end_matches('/'))
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

// =============================================================================
// B1: handle_register_start
// =============================================================================

pub async fn handle_register_start(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    email_sender: Arc<dyn EmailSender>,
    rate_limiter: Arc<MultiRateLimiter>,
    app_base_url: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<RegisterStartRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let email = normalize_email(&request.payload.email);
        let locale = request.payload.locale.as_deref().unwrap_or("en").to_string();

        // --- Rate limit by email ---
        if !rate_limiter.check_and_record("register.start", &email) {
            warn!("register.start rate limited: {}", email);
            let err = ErrorResponse::new(request.id, "RATE_LIMITED", "Too many requests. Please try again later.");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        // --- Input validation ---
        if !request.payload.tos_accepted {
            let err = ErrorResponse::new(request.id, "TOS_NOT_ACCEPTED", "You must accept the Terms of Service.");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        if !validate_password(&request.payload.password) {
            let err = ErrorResponse::new(
                request.id,
                "WEAK_PASSWORD",
                "Password must be at least 8 characters with at least one uppercase letter, one lowercase letter, and one digit.",
            );
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        // --- Check for existing user ---
        let existing = sqlx::query_as::<_, (bool, bool)>(
            "SELECT email_verified, verification_expires > now() FROM users WHERE email = $1",
        )
        .bind(&email)
        .fetch_optional(&pool)
        .await;

        match existing {
            Err(e) => {
                error!("register.start DB error: {}", e);
                let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error. Please try again.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
            Ok(Some((true, _))) => {
                // Email is verified → send anti-enumeration "already registered" email
                let login_url = build_login_url(&app_base_url);
                let email_msg = AlreadyRegisteredEmail {
                    to: &email,
                    login_url: &login_url,
                    locale: &locale,
                }
                .render();
                if let Err(e) = email_sender.send(email_msg).await {
                    error!("Failed to send already-registered email to {}: {}", email, e);
                }
                // Respond generically — anti-enumeration
                let resp = SuccessResponse::new(
                    request.id,
                    RegisterStartResponse {
                        ok: true,
                        message: "If this email is not registered, a verification link has been sent.".into(),
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
                continue;
            }
            Ok(Some((false, token_still_valid))) => {
                // Email exists but is unverified — resend (or reuse) the verification token
                let (token, token_hash, expires) = if token_still_valid {
                    // Reuse existing unexpired token — fetch it from DB
                    let row = sqlx::query_as::<_, (Option<String>, Option<chrono::DateTime<Utc>>)>(
                        "SELECT verification_token_hash, verification_expires FROM users WHERE email = $1",
                    )
                    .bind(&email)
                    .fetch_optional(&pool)
                    .await;

                    match row {
                        Ok(Some((Some(_hash), Some(exp)))) => {
                            // We stored the hash, not the plain token — we cannot reconstruct
                            // the original token. Issue a fresh one instead and overwrite.
                            let (pt, ph) = generate_token();
                            let new_exp = Utc::now() + chrono::Duration::hours(24);
                            if new_exp > exp {
                                (pt, ph, new_exp)
                            } else {
                                (pt, ph, exp)
                            }
                        }
                        _ => {
                            let (pt, ph) = generate_token();
                            (pt, ph, Utc::now() + chrono::Duration::hours(24))
                        }
                    }
                } else {
                    let (pt, ph) = generate_token();
                    (pt, ph, Utc::now() + chrono::Duration::hours(24))
                };

                if let Err(e) = sqlx::query(
                    "UPDATE users SET verification_token_hash = $1, verification_expires = $2 WHERE email = $3",
                )
                .bind(&token_hash)
                .bind(expires)
                .bind(&email)
                .execute(&pool)
                .await
                {
                    error!("Failed to update verification token: {}", e);
                }

                let verify_url = build_verify_url(&app_base_url, &token);
                let email_msg = VerificationEmail {
                    to: &email,
                    verify_url: &verify_url,
                    locale: &locale,
                }
                .render();
                if let Err(e) = email_sender.send(email_msg).await {
                    error!("Failed to send re-verification email to {}: {}", email, e);
                }

                let resp = SuccessResponse::new(
                    request.id,
                    RegisterStartResponse {
                        ok: true,
                        message: "If this email is not registered, a verification link has been sent.".into(),
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
                continue;
            }
            Ok(None) => {
                // New user — hash password and insert
                let password_hash = match crate::auth::hash_password(&request.payload.password) {
                    Ok(h) => h,
                    Err(e) => {
                        error!("argon2 hash error: {}", e);
                        let err = ErrorResponse::new(request.id, "INTERNAL_ERROR", "Internal error.");
                        let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                        continue;
                    }
                };

                let (token, token_hash) = generate_token();
                let expires = Utc::now() + chrono::Duration::hours(24);
                let tos_at = if request.payload.tos_accepted { Some(Utc::now()) } else { None };

                let insert_result = sqlx::query(
                    r#"INSERT INTO users
                        (email, password_hash, name, locale, country,
                         email_verified, verification_token_hash, verification_expires, tos_accepted_at,
                         onboarding_step)
                       VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, 0)"#,
                )
                .bind(&email)
                .bind(&password_hash)
                .bind(&email) // name placeholder — set during onboarding profile step
                .bind(&locale)
                .bind(&request.payload.country)
                .bind(&token_hash)
                .bind(expires)
                .bind(tos_at)
                .execute(&pool)
                .await;

                if let Err(e) = insert_result {
                    error!("register.start insert error: {}", e);
                    let err = ErrorResponse::new(request.id, "DB_ERROR", "Could not create account.");
                    let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                    continue;
                }

                let verify_url = build_verify_url(&app_base_url, &token);
                let email_msg = VerificationEmail {
                    to: &email,
                    verify_url: &verify_url,
                    locale: &locale,
                }
                .render();
                if let Err(e) = email_sender.send(email_msg).await {
                    error!("Failed to send verification email to {}: {}", email, e);
                }

                info!("New user registered: {} ({})", email, locale);

                let resp = SuccessResponse::new(
                    request.id,
                    RegisterStartResponse {
                        ok: true,
                        message: "If this email is not registered, a verification link has been sent.".into(),
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
        }
    }
    Ok(())
}

// =============================================================================
// B2: handle_verify_email
// =============================================================================

pub async fn handle_verify_email(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    rate_limiter: Arc<MultiRateLimiter>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<VerifyEmailRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let token = request.payload.token.trim().to_string();

        // Rate limit by raw token (prevents brute-force of short tokens)
        // Use first 8 chars as a bucket so the full token isn't logged
        let bucket = token.chars().take(8).collect::<String>();
        if !rate_limiter.check_and_record("email.verify", &bucket) {
            let err = ErrorResponse::new(request.id, "RATE_LIMITED", "Too many requests.");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        let token_hash = hash_token(&token);

        let result = sqlx::query(
            r#"UPDATE users
               SET email_verified = true,
                   verification_token_hash = NULL,
                   verification_expires = NULL,
                   onboarding_step = CASE WHEN onboarding_step = 0 THEN 2 ELSE onboarding_step END
               WHERE verification_token_hash = $1
                 AND verification_expires > now()
                 AND email_verified = false"#,
        )
        .bind(&token_hash)
        .execute(&pool)
        .await;

        match result {
            Err(e) => {
                error!("verify_email DB error: {}", e);
                let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Ok(r) if r.rows_affected() == 0 => {
                // Token not found or expired — generic error (no info leakage)
                let err = ErrorResponse::new(
                    request.id,
                    "INVALID_OR_EXPIRED_TOKEN",
                    "The verification link is invalid or has expired. Please request a new one.",
                );
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Ok(_) => {
                info!("Email verified for token_hash {}", &token_hash[..8]);
                let resp = SuccessResponse::new(
                    request.id,
                    VerifyEmailResponse {
                        ok: true,
                        message: "Email verified. You can now continue setting up your account.".into(),
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
        }
    }
    Ok(())
}

// =============================================================================
// B3: handle_resend_verification
// =============================================================================

pub async fn handle_resend_verification(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    email_sender: Arc<dyn EmailSender>,
    rate_limiter: Arc<MultiRateLimiter>,
    app_base_url: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<ResendVerificationRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let email = normalize_email(&request.payload.email);

        // Rate limit by email
        if !rate_limiter.check_and_record("email.resend", &email) {
            warn!("email.resend rate limited: {}", email);
            let err = ErrorResponse::new(request.id, "RATE_LIMITED", "Too many requests. Please try again later.");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        // Generic success response regardless of whether email exists (anti-enumeration)
        let generic_ok = SuccessResponse::new(
            request.id,
            ResendVerificationResponse {
                ok: true,
                message: "If this address has a pending verification, a new email has been sent.".into(),
            },
        );

        let row = sqlx::query_as::<_, (bool, String, Option<String>)>(
            "SELECT email_verified, locale, verification_token_hash FROM users WHERE email = $1",
        )
        .bind(&email)
        .fetch_optional(&pool)
        .await;

        match row {
            Err(e) => {
                error!("resend_verification DB error: {}", e);
                // Respond generically
                let _ = client.publish(reply, serde_json::to_vec(&generic_ok)?.into()).await;
            }
            Ok(None) | Ok(Some((true, _, _))) => {
                // No user, or already verified — respond generically
                let _ = client.publish(reply, serde_json::to_vec(&generic_ok)?.into()).await;
            }
            Ok(Some((false, locale, _existing_hash))) => {
                // Issue a fresh token
                let (token, token_hash) = generate_token();
                let expires = Utc::now() + chrono::Duration::hours(24);

                if let Err(e) = sqlx::query(
                    "UPDATE users SET verification_token_hash = $1, verification_expires = $2 WHERE email = $3",
                )
                .bind(&token_hash)
                .bind(expires)
                .bind(&email)
                .execute(&pool)
                .await
                {
                    error!("resend_verification token update error: {}", e);
                }

                let verify_url = build_verify_url(&app_base_url, &token);
                let email_msg = VerificationEmail {
                    to: &email,
                    verify_url: &verify_url,
                    locale: &locale,
                }
                .render();
                if let Err(e) = email_sender.send(email_msg).await {
                    error!("Failed to resend verification email to {}: {}", email, e);
                }

                info!("Verification email resent to {}", email);
                let _ = client.publish(reply, serde_json::to_vec(&generic_ok)?.into()).await;
            }
        }
    }
    Ok(())
}

// =============================================================================
// B7: handle_waitlist_join
// =============================================================================

pub async fn handle_waitlist_join(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    rate_limiter: Arc<MultiRateLimiter>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<WaitlistJoinRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let email = normalize_email(&request.payload.email);
        let country = request.payload.country.to_uppercase();
        let locale = request.payload.locale.clone();

        if !rate_limiter.check_and_record("waitlist.join", &email) {
            let err = ErrorResponse::new(request.id, "RATE_LIMITED", "Too many requests.");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        if country.len() != 2 {
            let err = ErrorResponse::new(request.id, "INVALID_COUNTRY", "Country must be a two-letter ISO code.");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        // Upsert — duplicate (email, country) is silently ignored
        let result = sqlx::query(
            r#"INSERT INTO country_waitlist (email, country, locale)
               VALUES ($1, $2, $3)
               ON CONFLICT (email, country) DO NOTHING"#,
        )
        .bind(&email)
        .bind(&country)
        .bind(&locale)
        .execute(&pool)
        .await;

        match result {
            Err(e) => {
                error!("waitlist.join DB error: {}", e);
                let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Ok(_) => {
                info!("Waitlist join: {} for {}", email, country);
                let resp = SuccessResponse::new(
                    request.id,
                    WaitlistJoinResponse {
                        ok: true,
                        message: "You have been added to the waitlist. We will notify you when Sazinka launches in your country.".into(),
                    },
                );
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
        }
    }
    Ok(())
}

// =============================================================================
// DEV ONLY: handle_dev_verify  — `sazinka.auth.dev.verify`
// Instantly marks an email as verified (skips the email flow).
// Only active in non-release builds.
// =============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevVerifyRequest {
    pub email: String,
}

pub async fn handle_dev_verify(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<DevVerifyRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let email = normalize_email(&request.payload.email);
        warn!("[DEV] Force-verifying email: {}", email);

        let _ = sqlx::query(
            r#"UPDATE users
               SET email_verified = true,
                   verification_token_hash = NULL,
                   verification_expires = NULL,
                   onboarding_step = GREATEST(onboarding_step, 2)
               WHERE email = $1 AND email_verified = false"#,
        )
        .bind(&email)
        .execute(&pool)
        .await;

        let resp = SuccessResponse::new(request.id, OnboardingOkResponse { ok: true });
        let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
    }
    Ok(())
}

// =============================================================================
// B4: handle_onboarding_profile  — `sazinka.onboarding.profile`
// =============================================================================

pub async fn handle_onboarding_profile(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<OnboardingProfileRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let p = &request.payload;
        let email = normalize_email(&p.email);

        if p.name.trim().is_empty() {
            let err = ErrorResponse::new(request.id, "VALIDATION_ERROR", "Name is required.");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        let result = sqlx::query(
            r#"UPDATE users
               SET name = $1,
                   business_name = $2,
                   phone = $3,
                   ico = $4,
                   locale = $5,
                   country = $6,
                   onboarding_step = GREATEST(onboarding_step, 3)
               WHERE email = $7 AND email_verified = true"#,
        )
        .bind(p.name.trim())
        .bind(&p.business_name)
        .bind(&p.phone)
        .bind(&p.ico)
        .bind(&p.locale)
        .bind(&p.country)
        .bind(&email)
        .execute(&pool)
        .await;

        match result {
            Err(e) => {
                error!("onboarding.profile DB error: {}", e);
                let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Ok(r) if r.rows_affected() == 0 => {
                let err = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User not found or email not verified.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            }
            Ok(_) => {
                info!("Onboarding profile saved for {}", email);
                let resp = SuccessResponse::new(request.id, OnboardingOkResponse { ok: true });
                let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
            }
        }
    }
    Ok(())
}

// =============================================================================
// B5: handle_onboarding_devices  — `sazinka.onboarding.devices`
// =============================================================================

pub async fn handle_onboarding_devices(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<OnboardingDevicesRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let p = &request.payload;
        let email = normalize_email(&p.email);

        if p.selected_builtins.is_empty() && p.custom_types.is_empty() {
            let err = ErrorResponse::new(request.id, "VALIDATION_ERROR", "Select at least one device type.");
            let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
            continue;
        }

        let user_row = sqlx::query_as::<_, (Uuid,)>(
            "SELECT id FROM users WHERE email = $1 AND email_verified = true",
        )
        .bind(&email)
        .fetch_optional(&pool)
        .await;

        let user_id = match user_row {
            Err(e) => {
                error!("onboarding.devices user lookup error: {}", e);
                let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
            Ok(None) => {
                let err = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User not found.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
            Ok(Some((uid,))) => uid,
        };

        let tenant_row = sqlx::query_as::<_, (Uuid,)>(
            "SELECT tenant_id FROM user_tenants WHERE user_id = $1 LIMIT 1",
        )
        .bind(user_id)
        .fetch_optional(&pool)
        .await;

        let tenant_id = match tenant_row {
            Err(e) => {
                error!("onboarding.devices tenant lookup error: {}", e);
                let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
            Ok(None) => {
                // Auto-create tenant for this user (first time through onboarding)
                let business = sqlx::query_as::<_, (String, Option<String>)>(
                    "SELECT name, business_name FROM users WHERE id = $1",
                )
                .bind(user_id)
                .fetch_one(&pool)
                .await;

                match business {
                    Err(e) => {
                        error!("onboarding.devices tenant create error: {}", e);
                        let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error.");
                        let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                        continue;
                    }
                    Ok((name, biz)) => {
                        let tenant_name = biz.unwrap_or(name);
                        let tid = sqlx::query_as::<_, (Uuid,)>(
                            "INSERT INTO tenants (name) VALUES ($1) RETURNING id",
                        )
                        .bind(&tenant_name)
                        .fetch_one(&pool)
                        .await;

                        match tid {
                            Err(e) => {
                                error!("onboarding.devices tenant insert error: {}", e);
                                let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error.");
                                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                                continue;
                            }
                            Ok((new_tid,)) => {
                                let _ = sqlx::query(
                                    "INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, 'owner')",
                                )
                                .bind(user_id)
                                .bind(new_tid)
                                .execute(&pool)
                                .await;
                                new_tid
                            }
                        }
                    }
                }
            }
            Ok(Some((tid,))) => tid,
        };

        // Update durations/intervals for selected builtins
        for bt in &p.selected_builtins {
            let _ = sqlx::query(
                r#"UPDATE device_type_configs
                   SET default_revision_duration_minutes = $1,
                       default_revision_interval_months = $2,
                       is_active = true
                   WHERE tenant_id = $3 AND device_type_key = $4"#,
            )
            .bind(bt.default_revision_duration_minutes)
            .bind(bt.default_revision_interval_months)
            .bind(tenant_id)
            .bind(&bt.device_type_key)
            .execute(&pool)
            .await;
        }

        // Deactivate builtins not selected
        let selected_keys: Vec<String> = p.selected_builtins.iter().map(|b| b.device_type_key.clone()).collect();
        let _ = sqlx::query(
            r#"UPDATE device_type_configs
               SET is_active = false
               WHERE tenant_id = $1 AND is_builtin = true AND NOT (device_type_key = ANY($2))"#,
        )
        .bind(tenant_id)
        .bind(&selected_keys)
        .execute(&pool)
        .await;

        // Insert custom types
        for (i, ct) in p.custom_types.iter().enumerate() {
            let key = format!("custom_{}", Uuid::new_v4().simple());
            let _ = sqlx::query(
                r#"INSERT INTO device_type_configs
                   (tenant_id, device_type_key, label, is_builtin,
                    default_revision_duration_minutes, default_revision_interval_months, sort_order)
                   VALUES ($1, $2, $3, false, $4, $5, $6)
                   ON CONFLICT (tenant_id, device_type_key) DO NOTHING"#,
            )
            .bind(tenant_id)
            .bind(&key)
            .bind(&ct.label)
            .bind(ct.duration)
            .bind(ct.interval)
            .bind((100 + i) as i32)
            .execute(&pool)
            .await;
        }

        // Advance onboarding step
        let _ = sqlx::query(
            "UPDATE users SET onboarding_step = GREATEST(onboarding_step, 4) WHERE id = $1",
        )
        .bind(user_id)
        .execute(&pool)
        .await;

        info!("Onboarding devices saved for {} ({} builtin, {} custom)", email, p.selected_builtins.len(), p.custom_types.len());
        let resp = SuccessResponse::new(request.id, OnboardingOkResponse { ok: true });
        let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
    }
    Ok(())
}

// =============================================================================
// B8: handle_onboarding_complete  — `sazinka.onboarding.complete`
// Geocoding is fire-and-forget via JetStream; the wizard never blocks on it.
// =============================================================================

pub async fn handle_onboarding_complete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<OnboardingCompleteRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(r) => r,
            Err(e) => {
                let err = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
        };

        let p = &request.payload;
        let email = normalize_email(&p.email);
        let d = &p.depot;

        let user_row = sqlx::query_as::<_, (Uuid, String)>(
            "SELECT id, COALESCE(locale, 'en') FROM users WHERE email = $1 AND email_verified = true",
        )
        .bind(&email)
        .fetch_optional(&pool)
        .await;

        let (user_id, user_locale) = match user_row {
            Err(e) => {
                error!("onboarding.complete user lookup error: {}", e);
                let err = ErrorResponse::new(request.id, "DB_ERROR", "Internal error.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
            Ok(None) => {
                let err = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User not found.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
            Ok(Some(row)) => row,
        };

        // Delete any existing primary depot, then insert with lat/lng = 0 (pending geocode)
        let _ = sqlx::query("DELETE FROM depots WHERE user_id = $1 AND is_primary = true")
            .bind(user_id)
            .execute(&pool)
            .await;

        let depot_result = sqlx::query_as::<_, (Uuid,)>(
            r#"INSERT INTO depots (user_id, name, street, city, postal_code, lat, lng, is_primary)
               VALUES ($1, $2, $3, $4, $5, 0, 0, true)
               RETURNING id"#,
        )
        .bind(user_id)
        .bind(&d.name)
        .bind(&d.street)
        .bind(&d.city)
        .bind(&d.postal_code)
        .fetch_one(&pool)
        .await;

        let depot_id = match depot_result {
            Err(e) => {
                error!("onboarding.complete depot insert error: {}", e);
                let err = ErrorResponse::new(request.id, "DB_ERROR", "Failed to save depot.");
                let _ = client.publish(reply, serde_json::to_vec(&err)?.into()).await;
                continue;
            }
            Ok((id,)) => id,
        };

        // Fire async geocode job via NATS (fire-and-forget)
        let geocode_payload = serde_json::json!({
            "depot_id": depot_id.to_string(),
            "user_id": user_id.to_string(),
            "street": d.street,
            "city": d.city,
            "postal_code": d.postal_code,
        });
        let subject: async_nats::Subject = "sazinka.geocode.address.submit".into();
        if let Err(e) = client
            .publish(subject, serde_json::to_vec(&geocode_payload).unwrap_or_default().into())
            .await
        {
            warn!("Failed to publish depot geocode job: {}", e);
        }

        // Create default crew linked to the depot, name localized
        let crew_name = match user_locale.as_str() {
            "cs" => "Posádka 1",
            "sk" => "Posádka 1",
            _ => "Crew 1",
        };

        let crew_exists = sqlx::query_as::<_, (bool,)>(
            "SELECT EXISTS(SELECT 1 FROM crews WHERE user_id = $1)",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap_or((false,));

        if !crew_exists.0 {
            let _ = sqlx::query(
                r#"INSERT INTO crews (user_id, name, home_depot_id)
                   VALUES ($1, $2, $3)"#,
            )
            .bind(user_id)
            .bind(crew_name)
            .bind(depot_id)
            .execute(&pool)
            .await;
        }

        // Mark onboarding complete; address stored on user for quick access
        let _ = sqlx::query(
            r#"UPDATE users
               SET onboarding_step = 6,
                   onboarding_completed_at = NOW(),
                   street = $1, city = $2, postal_code = $3
               WHERE id = $4"#,
        )
        .bind(&d.street)
        .bind(&d.city)
        .bind(&d.postal_code)
        .bind(user_id)
        .execute(&pool)
        .await;

        // Seed the default "Balanced" system scoring profile for the new company
        if let Err(e) = queries::scoring::create_default_scoring_profile(&pool, user_id, &user_locale).await {
            warn!("Failed to seed default scoring profile for user {}: {}", user_id, e);
        }

        info!("Onboarding complete for {} (user_id={}), depot geocode queued", email, user_id);
        let resp = SuccessResponse::new(request.id, OnboardingOkResponse { ok: true });
        let _ = client.publish(reply, serde_json::to_vec(&resp)?.into()).await;
    }
    Ok(())
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- validate_password ---

    #[test]
    fn password_too_short_rejected() {
        assert!(!validate_password("Ab1"));
    }

    #[test]
    fn password_no_uppercase_rejected() {
        assert!(!validate_password("abcd1234"));
    }

    #[test]
    fn password_no_lowercase_rejected() {
        assert!(!validate_password("ABCD1234"));
    }

    #[test]
    fn password_no_digit_rejected() {
        assert!(!validate_password("Abcdefgh"));
    }

    #[test]
    fn valid_password_accepted() {
        assert!(validate_password("Sazinka1"));
        assert!(validate_password("MyPass99!"));
        assert!(validate_password("Aa000000"));
    }

    // --- generate_token ---

    #[test]
    fn generate_token_produces_unique_pairs() {
        let (t1, h1) = generate_token();
        let (t2, h2) = generate_token();
        assert_ne!(t1, t2);
        assert_ne!(h1, h2);
        // Hash is deterministic
        assert_eq!(h1, hash_token(&t1));
        assert_eq!(h2, hash_token(&t2));
    }

    #[test]
    fn hash_token_is_deterministic() {
        let token = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";
        let h1 = hash_token(token);
        let h2 = hash_token(token);
        assert_eq!(h1, h2);
    }

    // --- build_verify_url ---

    #[test]
    fn verify_url_does_not_double_slash() {
        let url = build_verify_url("https://app.sazinka.cz/", "mytoken123");
        assert_eq!(url, "https://app.sazinka.cz/verify?token=mytoken123");
    }

    #[test]
    fn verify_url_without_trailing_slash() {
        let url = build_verify_url("https://app.sazinka.cz", "mytoken123");
        assert_eq!(url, "https://app.sazinka.cz/verify?token=mytoken123");
    }

    // --- normalize_email ---

    #[test]
    fn email_normalised_to_lowercase_trimmed() {
        assert_eq!(normalize_email("  User@Example.COM  "), "user@example.com");
    }
}
