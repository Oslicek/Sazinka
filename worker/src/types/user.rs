#![allow(dead_code)]
//! User types

use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// User (tradesperson) entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub name: String,
    pub phone: Option<String>,
    pub business_name: Option<String>,
    
    // Address
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    
    // Business identifiers
    pub ico: Option<String>,
    pub dic: Option<String>,
    
    // Settings
    pub default_revision_interval_months: i32,
    #[sqlx(default)]
    pub default_service_duration_minutes: Option<i32>,
    pub working_hours_start: NaiveTime,
    pub working_hours_end: NaiveTime,
    pub max_revisions_per_day: i32,
    
    // Auth
    pub role: String,
    pub owner_id: Option<Uuid>,
    
    // Email verification (Phase 10)
    pub email_verified: bool,
    pub verification_token_hash: Option<String>,
    pub verification_expires: Option<DateTime<Utc>>,
    pub tos_accepted_at: Option<DateTime<Utc>>,
    
    // Onboarding progress (Phase 10)
    pub onboarding_completed_at: Option<DateTime<Utc>>,
    pub onboarding_step: i16,
    
    // i18n
    /// BCP-47 locale code (e.g. "en", "cs", "en-GB"). Default: "en".
    pub locale: String,
    
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// User without sensitive data (for API responses)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPublic {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
    pub phone: Option<String>,
    pub business_name: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// BCP-47 locale code (e.g. "en", "cs", "en-GB"). Default: "en".
    pub locale: String,
    pub email_verified: bool,
    pub onboarding_completed_at: Option<DateTime<Utc>>,
    pub onboarding_step: i16,
}

impl From<User> for UserPublic {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            phone: user.phone,
            business_name: user.business_name,
            permissions: Vec::new(),
            locale: user.locale,
            email_verified: user.email_verified,
            onboarding_completed_at: user.onboarding_completed_at,
            onboarding_step: user.onboarding_step,
        }
    }
}

/// Auth response returned after login/register
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub token: String,
    pub user: UserPublic,
}
