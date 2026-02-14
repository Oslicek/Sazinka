//! Authentication utilities: JWT token management and password hashing

use anyhow::{anyhow, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::types::Request;

/// JWT claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// Subject (user ID)
    pub sub: String,
    /// User email
    pub email: String,
    /// User role (admin, customer, worker)
    pub role: String,
    /// Owner ID (for workers - the customer who created them)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// BCP-47 locale code (e.g. "en", "cs"). Available immediately on login.
    #[serde(default = "default_locale")]
    pub locale: String,
    /// Issued at (unix timestamp)
    pub iat: usize,
    /// Expiration (unix timestamp)
    pub exp: usize,
}

fn default_locale() -> String {
    "en".to_string()
}

/// Authentication result from extract_auth
#[derive(Debug, Clone)]
pub struct AuthInfo {
    pub user_id: Uuid,
    pub role: String,
    /// For workers, the customer's user_id (used for data queries)
    pub owner_id: Option<Uuid>,
}

impl AuthInfo {
    /// Returns the user_id to use for data queries.
    /// Workers use their owner's user_id so they see the same data as their customer.
    pub fn data_user_id(&self) -> Uuid {
        if self.role == "worker" {
            self.owner_id.unwrap_or(self.user_id)
        } else {
            self.user_id
        }
    }
}

/// Generate a JWT access token
pub fn generate_token(
    user_id: Uuid,
    email: &str,
    role: &str,
    owner_id: Option<Uuid>,
    permissions: &[String],
    locale: &str,
    secret: &str,
) -> Result<String> {
    let now = chrono::Utc::now().timestamp() as usize;
    let exp = now + 8 * 60 * 60; // 8 hours (working day)

    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        role: role.to_string(),
        owner_id: owner_id.map(|id| id.to_string()),
        permissions: permissions.to_vec(),
        locale: locale.to_string(),
        iat: now,
        exp,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?;

    Ok(token)
}

/// Validate a JWT token and return claims
pub fn validate_token(token: &str, secret: &str) -> Result<Claims> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| anyhow!("Invalid token: {}", e))?;

    Ok(token_data.claims)
}

/// Hash a password using Argon2
pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow!("Failed to hash password: {}", e))?;
    Ok(hash.to_string())
}

/// Verify a password against a hash
pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| anyhow!("Invalid password hash: {}", e))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Extract authentication info from a NATS request.
///
/// Priority:
/// 1. If `token` is present → validate JWT → extract user_id, role, owner_id
/// 2. If only `user_id` is present (legacy dev mode) → use it directly with role "customer"
/// 3. Otherwise → error (UNAUTHORIZED)
pub fn extract_auth<T>(request: &Request<T>, jwt_secret: &str) -> Result<AuthInfo> {
    // Try JWT token first
    if let Some(ref token) = request.token {
        let claims = validate_token(token, jwt_secret)?;
        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|e| anyhow!("Invalid user_id in token: {}", e))?;
        let owner_id = claims
            .owner_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|e| anyhow!("Invalid owner_id in token: {}", e))?;
        return Ok(AuthInfo {
            user_id,
            role: claims.role,
            owner_id,
        });
    }

    Err(anyhow!("No authentication provided — JWT token is required"))
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Request;
    use chrono::Utc;

    const TEST_SECRET: &str = "test-secret-key-for-jwt-at-least-32-bytes-long";

    // ---- Password hashing tests ----

    #[test]
    fn test_hash_password_produces_valid_hash() {
        let hash = hash_password("my-secure-password").unwrap();
        assert!(hash.starts_with("$argon2"));
        assert!(hash.len() > 50);
    }

    #[test]
    fn test_hash_password_different_each_time() {
        let hash1 = hash_password("same-password").unwrap();
        let hash2 = hash_password("same-password").unwrap();
        assert_ne!(hash1, hash2, "Hashes should differ due to random salt");
    }

    #[test]
    fn test_verify_password_correct() {
        let hash = hash_password("correct-password").unwrap();
        assert!(verify_password("correct-password", &hash).unwrap());
    }

    #[test]
    fn test_verify_password_incorrect() {
        let hash = hash_password("correct-password").unwrap();
        assert!(!verify_password("wrong-password", &hash).unwrap());
    }

    #[test]
    fn test_verify_password_invalid_hash() {
        let result = verify_password("any-password", "not-a-valid-hash");
        assert!(result.is_err());
    }

    // ---- JWT token tests ----

    #[test]
    fn test_generate_and_validate_token() {
        let user_id = Uuid::new_v4();
        let token = generate_token(user_id, "test@example.com", "customer", None, &["*".to_string()], "en", TEST_SECRET).unwrap();

        let claims = validate_token(&token, TEST_SECRET).unwrap();
        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.email, "test@example.com");
        assert_eq!(claims.role, "customer");
        assert!(claims.owner_id.is_none());
        assert_eq!(claims.locale, "en");
    }

    #[test]
    fn test_generate_token_with_owner_id() {
        let user_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();
        let token = generate_token(user_id, "worker@example.com", "worker", Some(owner_id), &["page:inbox".to_string()], "cs", TEST_SECRET).unwrap();

        let claims = validate_token(&token, TEST_SECRET).unwrap();
        assert_eq!(claims.sub, user_id.to_string());
        assert_eq!(claims.role, "worker");
        assert_eq!(claims.owner_id.unwrap(), owner_id.to_string());
        assert_eq!(claims.locale, "cs");
    }

    #[test]
    fn test_validate_token_wrong_secret() {
        let user_id = Uuid::new_v4();
        let token = generate_token(user_id, "test@example.com", "customer", None, &["*".to_string()], "en", TEST_SECRET).unwrap();

        let result = validate_token(&token, "wrong-secret");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_token_malformed() {
        let result = validate_token("not.a.valid.token", TEST_SECRET);
        assert!(result.is_err());
    }

    #[test]
    fn test_token_contains_correct_role() {
        let user_id = Uuid::new_v4();
        
        for role in &["admin", "customer", "worker"] {
            let token = generate_token(user_id, "test@example.com", role, None, &["*".to_string()], "en", TEST_SECRET).unwrap();
            let claims = validate_token(&token, TEST_SECRET).unwrap();
            assert_eq!(claims.role, *role);
        }
    }

    // ---- extract_auth tests ----

    fn make_request_with_token<T: Default>(token: Option<String>) -> Request<T> {
        Request {
            id: Uuid::new_v4(),
            timestamp: Utc::now(),
            token,
            payload: T::default(),
        }
    }

    #[test]
    fn test_extract_auth_with_valid_token() {
        let user_id = Uuid::new_v4();
        let token = generate_token(user_id, "test@example.com", "admin", None, &["*".to_string()], "en", TEST_SECRET).unwrap();
        
        let request = make_request_with_token::<serde_json::Value>(Some(token));
        let auth = extract_auth(&request, TEST_SECRET).unwrap();
        
        assert_eq!(auth.user_id, user_id);
        assert_eq!(auth.role, "admin");
        assert!(auth.owner_id.is_none());
    }

    #[test]
    fn test_extract_auth_with_worker_token() {
        let user_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();
        let token = generate_token(user_id, "worker@example.com", "worker", Some(owner_id), &["page:planner".to_string()], "en", TEST_SECRET).unwrap();
        
        let request = make_request_with_token::<serde_json::Value>(Some(token));
        let auth = extract_auth(&request, TEST_SECRET).unwrap();
        
        assert_eq!(auth.user_id, user_id);
        assert_eq!(auth.role, "worker");
        assert_eq!(auth.owner_id.unwrap(), owner_id);
        // data_user_id should return owner_id for workers
        assert_eq!(auth.data_user_id(), owner_id);
    }

    #[test]
    fn test_extract_auth_data_user_id_for_customer() {
        let user_id = Uuid::new_v4();
        let token = generate_token(user_id, "customer@example.com", "customer", None, &["*".to_string()], "en", TEST_SECRET).unwrap();
        
        let request = make_request_with_token::<serde_json::Value>(Some(token));
        let auth = extract_auth(&request, TEST_SECRET).unwrap();
        
        // data_user_id should return own user_id for non-workers
        assert_eq!(auth.data_user_id(), user_id);
    }

    #[test]
    fn test_extract_auth_no_token_fails() {
        // Without legacy user_id fallback, no token means UNAUTHORIZED
        let request = make_request_with_token::<serde_json::Value>(None);
        let result = extract_auth(&request, TEST_SECRET);
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_auth_invalid_token_fails() {
        let request = make_request_with_token::<serde_json::Value>(Some("bad-token".to_string()));
        let result = extract_auth(&request, TEST_SECRET);
        assert!(result.is_err());
    }
}
