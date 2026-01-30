//! Settings and Depot types

use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Depot (starting/ending point for routes)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Depot {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub lat: f64,
    pub lng: f64,
    pub is_primary: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Create depot request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDepotRequest {
    pub name: String,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub lat: f64,
    pub lng: f64,
    pub is_primary: Option<bool>,
}

/// Update depot request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDepotRequest {
    pub id: Uuid,
    pub name: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub is_primary: Option<bool>,
}

/// Delete depot request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteDepotRequest {
    pub id: Uuid,
}

/// List depots response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDepotsResponse {
    pub depots: Vec<Depot>,
}

/// Work constraints settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkConstraints {
    pub working_hours_start: String, // "08:00"
    pub working_hours_end: String,   // "17:00"
    pub max_revisions_per_day: i32,
    pub default_service_duration_minutes: i32,
    pub default_revision_interval_months: i32,
    pub reminder_days_before: Vec<i32>,
}

/// Business/Personal info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessInfo {
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub business_name: Option<String>,
    pub ico: Option<String>,
    pub dic: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
}

/// Email template settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailTemplateSettings {
    pub email_subject_template: String,
    pub email_body_template: String,
}

/// Combined user settings response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    pub work_constraints: WorkConstraints,
    pub business_info: BusinessInfo,
    pub email_templates: EmailTemplateSettings,
    pub depots: Vec<Depot>,
}

/// Update work constraints request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkConstraintsRequest {
    pub working_hours_start: Option<String>,
    pub working_hours_end: Option<String>,
    pub max_revisions_per_day: Option<i32>,
    pub default_service_duration_minutes: Option<i32>,
    pub default_revision_interval_months: Option<i32>,
    pub reminder_days_before: Option<Vec<i32>>,
}

/// Update business info request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBusinessInfoRequest {
    pub name: Option<String>,
    pub phone: Option<String>,
    pub business_name: Option<String>,
    pub ico: Option<String>,
    pub dic: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
}

/// Update email templates request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEmailTemplatesRequest {
    pub email_subject_template: Option<String>,
    pub email_body_template: Option<String>,
}

/// Extended user with all settings fields (for DB queries)
#[derive(Debug, Clone, FromRow)]
pub struct UserWithSettings {
    pub id: Uuid,
    pub email: String,
    pub password_hash: String,
    pub name: String,
    pub phone: Option<String>,
    pub business_name: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub default_revision_interval_months: i32,
    pub working_hours_start: NaiveTime,
    pub working_hours_end: NaiveTime,
    pub max_revisions_per_day: i32,
    pub default_service_duration_minutes: i32,
    pub reminder_days_before: Vec<i32>,
    pub ico: Option<String>,
    pub dic: Option<String>,
    pub email_subject_template: Option<String>,
    pub email_body_template: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl UserWithSettings {
    /// Convert to work constraints
    pub fn to_work_constraints(&self) -> WorkConstraints {
        WorkConstraints {
            working_hours_start: self.working_hours_start.format("%H:%M").to_string(),
            working_hours_end: self.working_hours_end.format("%H:%M").to_string(),
            max_revisions_per_day: self.max_revisions_per_day,
            default_service_duration_minutes: self.default_service_duration_minutes,
            default_revision_interval_months: self.default_revision_interval_months,
            reminder_days_before: self.reminder_days_before.clone(),
        }
    }

    /// Convert to business info
    pub fn to_business_info(&self) -> BusinessInfo {
        BusinessInfo {
            name: self.name.clone(),
            email: self.email.clone(),
            phone: self.phone.clone(),
            business_name: self.business_name.clone(),
            ico: self.ico.clone(),
            dic: self.dic.clone(),
            street: self.street.clone(),
            city: self.city.clone(),
            postal_code: self.postal_code.clone(),
            country: self.country.clone(),
        }
    }

    /// Convert to email template settings
    pub fn to_email_templates(&self) -> EmailTemplateSettings {
        EmailTemplateSettings {
            email_subject_template: self.email_subject_template.clone()
                .unwrap_or_else(|| "Připomínka revize - {{device_type}}".to_string()),
            email_body_template: self.email_body_template.clone()
                .unwrap_or_else(|| DEFAULT_EMAIL_TEMPLATE.to_string()),
        }
    }
}

/// Default email template
pub const DEFAULT_EMAIL_TEMPLATE: &str = r#"Dobrý den,

dovolujeme si Vás upozornit, že se blíží termín pravidelné revize Vašeho zařízení {{device_type}}.

Plánovaný termín: {{due_date}}

V případě zájmu nás prosím kontaktujte pro domluvení termínu.

S pozdravem,
{{business_name}}
{{phone}}
{{email}}"#;
