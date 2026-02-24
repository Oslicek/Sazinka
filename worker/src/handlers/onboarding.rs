
//! Onboarding wizard handlers (Phase 10).
//!
//! Handlers exposed:
//!   - `handle_register_start`       — `sazinka.auth.register.start`
//!   - `handle_verify_email`         — `sazinka.auth.email.verify`
//!   - `handle_resend_verification`  — `sazinka.auth.email.resend`
//!   - `handle_waitlist_join`        — `sazinka.waitlist.join`

use std::sync::Arc;

use anyhow::Result;
use async_nats::{Client, Subscriber};
use chrono::Utc;
use futures::StreamExt;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

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
                        Ok(Some((Some(hash), Some(exp)))) => {
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
