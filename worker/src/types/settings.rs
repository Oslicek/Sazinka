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
    /// Company-level locale for emails and external communication (e.g. "en", "cs").
    pub company_locale: String,
}

/// Email template settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailTemplateSettings {
    pub confirmation_subject_template: String,
    pub confirmation_body_template: String,
    pub reminder_subject_template: String,
    pub reminder_body_template: String,
    pub reminder_send_time: String, // "HH:MM"
    pub third_subject_template: String,
    pub third_body_template: String,
}

/// User preferences
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferences {
    pub default_crew_id: Option<Uuid>,
    pub default_depot_id: Option<Uuid>,
    pub locale: String,
}

/// Break/pause settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakSettings {
    pub break_enabled: bool,
    pub break_duration_minutes: i32,
    pub break_earliest_time: String,  // "HH:MM"
    pub break_latest_time: String,    // "HH:MM"
    pub break_min_km: f64,
    pub break_max_km: f64,
}

/// Combined user settings response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSettings {
    pub work_constraints: WorkConstraints,
    pub business_info: BusinessInfo,
    pub email_templates: EmailTemplateSettings,
    pub depots: Vec<Depot>,
    pub preferences: UserPreferences,
    pub break_settings: BreakSettings,
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
    /// Company-level locale for emails and external communication (e.g. "en", "cs").
    pub company_locale: Option<String>,
}

/// Update email templates request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEmailTemplatesRequest {
    pub confirmation_subject_template: Option<String>,
    pub confirmation_body_template: Option<String>,
    pub reminder_subject_template: Option<String>,
    pub reminder_body_template: Option<String>,
    pub reminder_send_time: Option<String>,
    pub third_subject_template: Option<String>,
    pub third_body_template: Option<String>,
}

/// Update user preferences request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePreferencesRequest {
    pub default_crew_id: Option<Uuid>,
    pub default_depot_id: Option<Uuid>,
    pub locale: String,
}

/// Update break settings request
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBreakSettingsRequest {
    pub break_enabled: Option<bool>,
    pub break_duration_minutes: Option<i32>,
    pub break_earliest_time: Option<String>,
    pub break_latest_time: Option<String>,
    pub break_min_km: Option<f64>,
    pub break_max_km: Option<f64>,
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
    pub email_confirmation_subject_template: Option<String>,
    pub email_confirmation_body_template: Option<String>,
    pub email_reminder_subject_template: Option<String>,
    pub email_reminder_body_template: Option<String>,
    pub email_reminder_send_time: Option<NaiveTime>,
    pub email_third_subject_template: Option<String>,
    pub email_third_body_template: Option<String>,
    pub default_crew_id: Option<Uuid>,
    pub default_depot_id: Option<Uuid>,
    pub break_enabled: bool,
    pub break_duration_minutes: i32,
    pub break_earliest_time: NaiveTime,
    pub break_latest_time: NaiveTime,
    pub break_min_km: f64,
    pub break_max_km: f64,
    /// BCP-47 locale code (e.g. "en", "cs", "en-GB"). Default: "en".
    pub locale: String,
    /// Company-level locale for emails and external communication. Default: "cs".
    pub company_locale: String,
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
            company_locale: self.company_locale.clone(),
        }
    }

    /// Convert to email template settings (uses company_locale for external communication)
    pub fn to_email_templates(&self) -> EmailTemplateSettings {
        let locale = &self.company_locale;
        let reminder_subject = self.email_reminder_subject_template.clone()
            .or_else(|| self.email_subject_template.clone())
            .unwrap_or_else(|| default_reminder_subject(locale));
        let reminder_body = self.email_reminder_body_template.clone()
            .or_else(|| self.email_body_template.clone())
            .unwrap_or_else(|| default_reminder_template(locale).to_string());

        EmailTemplateSettings {
            confirmation_subject_template: self.email_confirmation_subject_template.clone()
                .unwrap_or_else(|| default_confirmation_subject(locale)),
            confirmation_body_template: self.email_confirmation_body_template.clone()
                .unwrap_or_else(|| default_confirmation_template(locale).to_string()),
            reminder_subject_template: reminder_subject,
            reminder_body_template: reminder_body,
            reminder_send_time: self.email_reminder_send_time
                .unwrap_or_else(|| NaiveTime::from_hms_opt(9, 0, 0).expect("valid default time"))
                .format("%H:%M")
                .to_string(),
            third_subject_template: self.email_third_subject_template.clone()
                .unwrap_or_else(|| "".to_string()),
            third_body_template: self.email_third_body_template.clone()
                .unwrap_or_else(|| "".to_string()),
        }
    }

    /// Convert to user preferences
    pub fn to_preferences(&self) -> UserPreferences {
        UserPreferences {
            default_crew_id: self.default_crew_id,
            default_depot_id: self.default_depot_id,
            locale: self.locale.clone(),
        }
    }

    /// Convert to break settings
    pub fn to_break_settings(&self) -> BreakSettings {
        BreakSettings {
            break_enabled: self.break_enabled,
            break_duration_minutes: self.break_duration_minutes,
            break_earliest_time: self.break_earliest_time.format("%H:%M").to_string(),
            break_latest_time: self.break_latest_time.format("%H:%M").to_string(),
            break_min_km: self.break_min_km,
            break_max_km: self.break_max_km,
        }
    }
}

/// Default reminder email template - Czech
pub const DEFAULT_REMINDER_EMAIL_TEMPLATE_CS: &str = r#"Dobrý den,

dovolujeme si Vás upozornit, že se blíží termín pravidelné revize Vašeho zařízení {{device_type}}.

Plánovaný termín: {{due_date}}

V případě zájmu nás prosím kontaktujte pro domluvení termínu.

S pozdravem,
{{business_name}}
{{phone}}
{{email}}"#;

/// Default reminder email template - English
pub const DEFAULT_REMINDER_EMAIL_TEMPLATE_EN: &str = r#"Dear {{customerName}},

we would like to remind you of your upcoming appointment on {{date}} at {{time}}.

If you need to reschedule, please contact us.

Thank you,
{{companyName}}"#;

/// Default reminder email template - Slovak
pub const DEFAULT_REMINDER_EMAIL_TEMPLATE_SK: &str = r#"Dobrý deň,

radi by sme Vám pripomenuli blížiaci sa termín pravidelnej revízie Vášho zariadenia {{device_type}}.

Plánovaný termín: {{due_date}}

V prípade záujmu nás prosím kontaktujte pre dohodnutie termínu.

S pozdravom,
{{business_name}}
{{phone}}
{{email}}"#;

/// Default confirmation email template - Czech
pub const DEFAULT_CONFIRMATION_EMAIL_TEMPLATE_CS: &str = r#"Dobrý den,

potvrzujeme dohodnutý termín návštěvy.

Termín: {{due_date}}

Těšíme se na spolupráci.

S pozdravem,
{{business_name}}
{{phone}}
{{email}}"#;

/// Default confirmation email template - English
pub const DEFAULT_CONFIRMATION_EMAIL_TEMPLATE_EN: &str = r#"Dear {{customerName}},

we confirm your appointment on {{date}} at {{time}}.

Address: {{address}}.

If you need to change the appointment, please contact us.

Thank you,
{{companyName}}"#;

/// Default confirmation email template - Slovak
pub const DEFAULT_CONFIRMATION_EMAIL_TEMPLATE_SK: &str = r#"Dobrý deň,

potvrdzujeme dohodnutý termín návštevy.

Termín: {{due_date}}

Tešíme sa na spoluprácu.

S pozdravom,
{{business_name}}
{{phone}}
{{email}}"#;

/// Return the default reminder email template for the given locale.
pub fn default_reminder_template(locale: &str) -> &'static str {
    let lang = locale.split('-').next().unwrap_or(locale);
    match lang {
        "cs" => DEFAULT_REMINDER_EMAIL_TEMPLATE_CS,
        "sk" => DEFAULT_REMINDER_EMAIL_TEMPLATE_SK,
        _ => DEFAULT_REMINDER_EMAIL_TEMPLATE_EN,
    }
}

/// Return the default confirmation email template for the given locale.
pub fn default_confirmation_template(locale: &str) -> &'static str {
    let lang = locale.split('-').next().unwrap_or(locale);
    match lang {
        "cs" => DEFAULT_CONFIRMATION_EMAIL_TEMPLATE_CS,
        "sk" => DEFAULT_CONFIRMATION_EMAIL_TEMPLATE_SK,
        _ => DEFAULT_CONFIRMATION_EMAIL_TEMPLATE_EN,
    }
}

/// Return the default reminder subject line for the given locale.
pub fn default_reminder_subject(locale: &str) -> String {
    let lang = locale.split('-').next().unwrap_or(locale);
    match lang {
        "cs" => "Připomínka termínu - {{customerName}}".to_string(),
        "sk" => "Pripomienka termínu - {{customerName}}".to_string(),
        _ => "Appointment reminder - {{customerName}}".to_string(),
    }
}

/// Return the default confirmation subject line for the given locale.
pub fn default_confirmation_subject(locale: &str) -> String {
    let lang = locale.split('-').next().unwrap_or(locale);
    match lang {
        "cs" => "Potvrzení termínu - {{customerName}}".to_string(),
        "sk" => "Potvrdenie termínu - {{customerName}}".to_string(),
        _ => "Appointment confirmation - {{customerName}}".to_string(),
    }
}
