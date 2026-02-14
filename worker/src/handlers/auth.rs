//! Authentication handlers: register, login, verify

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use parking_lot::Mutex;
use sqlx::PgPool;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::auth;
use crate::db::queries;
use crate::types::{
    ErrorResponse, Request, SuccessResponse,
    user::{AuthResponse, UserPublic},
};

// =============================================================================
// Auth request/response types
// =============================================================================

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    pub business_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    pub token: String,
}

// =============================================================================
// Rate limiting
// =============================================================================

/// Simple in-memory rate limiter for login attempts
pub struct RateLimiter {
    /// Map of email -> list of attempt timestamps
    attempts: Mutex<HashMap<String, Vec<Instant>>>,
    /// Maximum attempts per window
    max_attempts: usize,
    /// Window duration in seconds
    window_secs: u64,
}

impl RateLimiter {
    pub fn new(max_attempts: usize, window_secs: u64) -> Self {
        Self {
            attempts: Mutex::new(HashMap::new()),
            max_attempts,
            window_secs,
        }
    }

    /// Check if the given key is rate limited. Returns true if allowed, false if rate limited.
    pub fn check_and_record(&self, key: &str) -> bool {
        let mut attempts = self.attempts.lock();
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.window_secs);

        let entry = attempts.entry(key.to_string()).or_default();
        
        // Remove expired entries
        entry.retain(|t| now.duration_since(*t) < window);
        
        if entry.len() >= self.max_attempts {
            return false;
        }

        entry.push(now);
        true
    }

    /// Clean up old entries (call periodically)
    pub fn cleanup(&self) {
        let mut attempts = self.attempts.lock();
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.window_secs);
        
        attempts.retain(|_, entries| {
            entries.retain(|t| now.duration_since(*t) < window);
            !entries.is_empty()
        });
    }
}

// =============================================================================
// Handlers
// =============================================================================

/// Handle auth.register messages
pub async fn handle_register(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received auth.register message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<RegisterRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse register request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let payload = &request.payload;

        // Validate input
        if payload.email.is_empty() || payload.password.is_empty() || payload.name.is_empty() {
            let error = ErrorResponse::new(request.id, "VALIDATION_ERROR", "Email, password, and name are required");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        if payload.password.len() < 8 {
            let error = ErrorResponse::new(request.id, "VALIDATION_ERROR", "Password must be at least 8 characters");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        // Check if email already exists
        match queries::user::get_user_by_email(&pool, &payload.email).await {
            Ok(Some(_)) => {
                let error = ErrorResponse::new(request.id, "DUPLICATE_EMAIL", "Email is already registered");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
            Ok(None) => {} // Good, email is available
            Err(e) => {
                error!("Database error checking email: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        }

        // Hash password
        let password_hash = match auth::hash_password(&payload.password) {
            Ok(hash) => hash,
            Err(e) => {
                error!("Failed to hash password: {}", e);
                let error = ErrorResponse::new(request.id, "INTERNAL_ERROR", "Failed to process password");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Create user
        match queries::user::create_user(
            &pool,
            &payload.email,
            &password_hash,
            &payload.name,
            payload.business_name.as_deref(),
            "customer",
            None,
        ).await {
            Ok(user) => {
                let permissions = match queries::role::get_user_permissions(&pool, user.id).await {
                    Ok(p) => p,
                    Err(e) => {
                        error!("Failed to load permissions: {}", e);
                        let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                        continue;
                    }
                };
                // Generate JWT
                let token = match auth::generate_token(user.id, &user.email, &user.role, None, &permissions, &user.locale, &jwt_secret) {
                    Ok(t) => t,
                    Err(e) => {
                        error!("Failed to generate token: {}", e);
                        let error = ErrorResponse::new(request.id, "INTERNAL_ERROR", "Failed to generate token");
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                        continue;
                    }
                };

                let mut user_public = UserPublic::from(user);
                user_public.permissions = permissions;
                let auth_response = AuthResponse {
                    token,
                    user: user_public,
                };
                let response = SuccessResponse::new(request.id, auth_response);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Registered user: {}", response.payload.user.email);
            }
            Err(e) => {
                error!("Failed to create user: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle auth.login messages
pub async fn handle_login(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
    rate_limiter: Arc<RateLimiter>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received auth.login message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<LoginRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse login request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let payload = &request.payload;

        // Rate limiting check
        if !rate_limiter.check_and_record(&payload.email) {
            warn!("Rate limited login attempt for: {}", payload.email);
            let error = ErrorResponse::new(request.id, "RATE_LIMITED", "Too many login attempts. Please try again later.");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        // Look up user by email
        let user = match queries::user::get_user_by_email(&pool, &payload.email).await {
            Ok(Some(user)) => user,
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "INVALID_CREDENTIALS", "Invalid email or password");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
            Err(e) => {
                error!("Database error during login: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Verify password
        match auth::verify_password(&payload.password, &user.password_hash) {
            Ok(true) => {} // Password correct
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "INVALID_CREDENTIALS", "Invalid email or password");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
            Err(e) => {
                error!("Password verification error: {}", e);
                let error = ErrorResponse::new(request.id, "INTERNAL_ERROR", "Failed to verify password");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        }

        let permissions = match queries::role::get_user_permissions(&pool, user.id).await {
            Ok(p) => p,
            Err(e) => {
                error!("Failed to load permissions: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Generate JWT
        let token = match auth::generate_token(user.id, &user.email, &user.role, user.owner_id, &permissions, &user.locale, &jwt_secret) {
            Ok(t) => t,
            Err(e) => {
                error!("Failed to generate token: {}", e);
                let error = ErrorResponse::new(request.id, "INTERNAL_ERROR", "Failed to generate token");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let mut user_public = UserPublic::from(user);
        user_public.permissions = permissions;
        let auth_response = AuthResponse {
            token,
            user: user_public,
        };
        let response = SuccessResponse::new(request.id, auth_response);
        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
        debug!("User logged in: {}", response.payload.user.email);
    }

    Ok(())
}

/// Handle auth.verify messages
pub async fn handle_verify(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received auth.verify message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<VerifyRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse verify request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Validate token
        let claims = match auth::validate_token(&request.payload.token, &jwt_secret) {
            Ok(c) => c,
            Err(e) => {
                let error = ErrorResponse::new(request.id, "INVALID_TOKEN", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Look up user to ensure they still exist
        let user_id = match Uuid::parse_str(&claims.sub) {
            Ok(id) => id,
            Err(e) => {
                let error = ErrorResponse::new(request.id, "INVALID_TOKEN", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        match queries::user::get_user(&pool, user_id).await {
            Ok(Some(user)) => {
                let mut user_public = UserPublic::from(user.clone());
                user_public.permissions = queries::role::get_user_permissions(&pool, user.id).await.unwrap_or_default();
                let response = SuccessResponse::new(request.id, user_public);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User no longer exists");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Database error during verify: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle auth.refresh messages — issue a new token with fresh expiration
pub async fn handle_refresh(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received auth.refresh message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<VerifyRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse refresh request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Validate current token
        let claims = match auth::validate_token(&request.payload.token, &jwt_secret) {
            Ok(c) => c,
            Err(e) => {
                let error = ErrorResponse::new(request.id, "INVALID_TOKEN", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let user_id = match Uuid::parse_str(&claims.sub) {
            Ok(id) => id,
            Err(e) => {
                let error = ErrorResponse::new(request.id, "INVALID_TOKEN", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Ensure user still exists
        match queries::user::get_user(&pool, user_id).await {
            Ok(Some(user)) => {
                let permissions = match queries::role::get_user_permissions(&pool, user.id).await {
                    Ok(p) => p,
                    Err(e) => {
                        error!("Failed to load permissions: {}", e);
                        let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                        continue;
                    }
                };
                // Issue a fresh token
                let owner_id = claims.owner_id.as_deref().and_then(|id| Uuid::parse_str(id).ok());
                match auth::generate_token(user_id, &user.email, &claims.role, owner_id, &permissions, &user.locale, &jwt_secret) {
                    Ok(new_token) => {
                        let mut user_public = UserPublic::from(user);
                        user_public.permissions = permissions;
                        let response = SuccessResponse::new(request.id, AuthResponse {
                            token: new_token,
                            user: user_public,
                        });
                        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                    }
                    Err(e) => {
                        error!("Failed to generate refresh token: {}", e);
                        let error = ErrorResponse::new(request.id, "TOKEN_ERROR", e.to_string());
                        let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                    }
                }
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "USER_NOT_FOUND", "User no longer exists");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Database error during refresh: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

// =============================================================================
// Worker management handlers
// =============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorkerRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    pub role_ids: Option<Vec<Uuid>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteWorkerRequest {
    pub id: Uuid,
}

/// Handle auth.worker.create messages (customer creates a worker)
pub async fn handle_create_worker(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received auth.worker.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => continue,
        };

        let request: Request<CreateWorkerRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Authenticate and check role
        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only customers can create workers");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        let payload = &request.payload;

        // Validate
        if payload.email.is_empty() || payload.password.is_empty() || payload.name.is_empty() {
            let error = ErrorResponse::new(request.id, "VALIDATION_ERROR", "Email, password, and name are required");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        if payload.password.len() < 8 {
            let error = ErrorResponse::new(request.id, "VALIDATION_ERROR", "Password must be at least 8 characters");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        // Check email uniqueness
        match queries::user::get_user_by_email(&pool, &payload.email).await {
            Ok(Some(_)) => {
                let error = ErrorResponse::new(request.id, "DUPLICATE_EMAIL", "Email is already registered");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
            Ok(None) => {}
            Err(e) => {
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        }

        // Hash password
        let password_hash = match auth::hash_password(&payload.password) {
            Ok(hash) => hash,
            Err(e) => {
                error!("Failed to hash password: {}", e);
                let error = ErrorResponse::new(request.id, "INTERNAL_ERROR", "Failed to process password");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Create worker with owner_id = the customer's user_id
        match queries::user::create_user(
            &pool,
            &payload.email,
            &password_hash,
            &payload.name,
            None,
            "worker",
            Some(auth_info.user_id),
        ).await {
            Ok(user) => {
                let response = SuccessResponse::new(request.id, UserPublic::from(user));
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to create worker: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle auth.worker.list messages
pub async fn handle_list_workers(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => continue,
        };

        let request: Request<serde_json::Value> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only customers can list workers");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        match queries::user::list_workers(&pool, auth_info.user_id).await {
            Ok(workers) => {
                let public_workers: Vec<UserPublic> = workers.into_iter().map(UserPublic::from).collect();
                let response = SuccessResponse::new(request.id, public_workers);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle auth.worker.delete messages
pub async fn handle_delete_worker(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => continue,
        };

        let request: Request<DeleteWorkerRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        if auth_info.role != "customer" && auth_info.role != "admin" {
            let error = ErrorResponse::new(request.id, "FORBIDDEN", "Only customers can delete workers");
            let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            continue;
        }

        match queries::user::delete_worker(&pool, request.payload.id, auth_info.user_id).await {
            Ok(true) => {
                #[derive(Serialize)]
                struct DeleteResult { deleted: bool }
                let response = SuccessResponse::new(request.id, DeleteResult { deleted: true });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(false) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Worker not found or not owned by you");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
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

    #[test]
    fn test_rate_limiter_allows_within_limit() {
        let limiter = RateLimiter::new(3, 60);
        assert!(limiter.check_and_record("test@example.com"));
        assert!(limiter.check_and_record("test@example.com"));
        assert!(limiter.check_and_record("test@example.com"));
    }

    #[test]
    fn test_rate_limiter_blocks_over_limit() {
        let limiter = RateLimiter::new(3, 60);
        assert!(limiter.check_and_record("test@example.com"));
        assert!(limiter.check_and_record("test@example.com"));
        assert!(limiter.check_and_record("test@example.com"));
        // 4th attempt should be blocked
        assert!(!limiter.check_and_record("test@example.com"));
    }

    #[test]
    fn test_rate_limiter_different_keys_independent() {
        let limiter = RateLimiter::new(2, 60);
        assert!(limiter.check_and_record("user1@example.com"));
        assert!(limiter.check_and_record("user1@example.com"));
        assert!(!limiter.check_and_record("user1@example.com")); // blocked
        
        // Different user should still be allowed
        assert!(limiter.check_and_record("user2@example.com"));
        assert!(limiter.check_and_record("user2@example.com"));
    }

    #[test]
    fn test_rate_limiter_cleanup() {
        let limiter = RateLimiter::new(100, 0); // 0 second window = everything expires
        limiter.check_and_record("test@example.com");
        // After a tiny sleep, entries should be expired
        std::thread::sleep(std::time::Duration::from_millis(10));
        limiter.cleanup();
        // Should be empty now (cleaned up)
        let attempts = limiter.attempts.lock();
        assert!(attempts.is_empty() || attempts.get("test@example.com").map(|v| v.is_empty()).unwrap_or(true));
    }
}
