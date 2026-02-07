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
