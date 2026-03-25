//! Email data resolution — loads all data needed to render and send an email.
//!
//! The SQL queries themselves are integration-tested. All pure helper functions
//! (address formatting, time-window formatting, template selection) are unit-tested.

use anyhow::Result;
use chrono::{DateTime, NaiveTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::settings::{
    default_confirmation_subject, default_confirmation_template, default_reminder_subject,
    default_reminder_template,
};

// ============================================================================
// Output structs
// ============================================================================

/// All data needed to send an appointment-confirmation email.
#[derive(Debug, Clone)]
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

/// All data needed to send a revision-reminder email.
#[derive(Debug, Clone)]
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

// ============================================================================
// Pure helper functions (unit-tested)
// ============================================================================

/// Format a customer address from street + city components.
pub fn format_address(street: &str, city: &str) -> String {
    match (street.trim().is_empty(), city.trim().is_empty()) {
        (false, false) => format!("{}, {}", street.trim(), city.trim()),
        (false, true) => street.trim().to_string(),
        (true, false) => city.trim().to_string(),
        (true, true) => String::new(),
    }
}

/// Format a time window from optional start and end times.
pub fn format_time_window(start: Option<NaiveTime>, end: Option<NaiveTime>) -> Option<String> {
    match (start, end) {
        (Some(s), Some(e)) => Some(format!("{}–{}", s.format("%H:%M"), e.format("%H:%M"))),
        (Some(s), None) => Some(s.format("%H:%M").to_string()),
        _ => None,
    }
}

/// Select the subject and body templates for a confirmation email.
/// Uses custom templates when the user has edited them; otherwise locale defaults.
pub fn select_confirmation_templates(
    subject: Option<&str>,
    body: Option<&str>,
    edited_at: Option<DateTime<Utc>>,
    locale: &str,
) -> (String, String) {
    fn non_empty(s: Option<&str>) -> Option<&str> {
        s.filter(|v| !v.trim().is_empty())
    }
    if edited_at.is_some() {
        (
            non_empty(subject)
                .map(str::to_string)
                .unwrap_or_else(|| default_confirmation_subject(locale)),
            non_empty(body)
                .map(str::to_string)
                .unwrap_or_else(|| default_confirmation_template(locale).to_string()),
        )
    } else {
        (
            default_confirmation_subject(locale),
            default_confirmation_template(locale).to_string(),
        )
    }
}

/// Select the subject and body templates for a reminder email.
pub fn select_reminder_templates(
    subject: Option<&str>,
    body: Option<&str>,
    edited_at: Option<DateTime<Utc>>,
    locale: &str,
) -> (String, String) {
    fn non_empty(s: Option<&str>) -> Option<&str> {
        s.filter(|v| !v.trim().is_empty())
    }
    if edited_at.is_some() {
        (
            non_empty(subject)
                .map(str::to_string)
                .unwrap_or_else(|| default_reminder_subject(locale)),
            non_empty(body)
                .map(str::to_string)
                .unwrap_or_else(|| default_reminder_template(locale).to_string()),
        )
    } else {
        (
            default_reminder_subject(locale),
            default_reminder_template(locale).to_string(),
        )
    }
}

// ============================================================================
// DB queries
// ============================================================================

/// Raw row returned by the confirmation data query.
#[derive(Debug, sqlx::FromRow)]
struct ConfirmationRow {
    recipient_email: Option<String>,
    customer_name: Option<String>,
    street: Option<String>,
    city: Option<String>,
    scheduled_date: Option<String>,
    scheduled_time_start: Option<NaiveTime>,
    scheduled_time_end: Option<NaiveTime>,
    business_name: Option<String>,
    phone: Option<String>,
    user_email: Option<String>,
    company_locale: Option<String>,
    subject_template: Option<String>,
    body_template: Option<String>,
    edited_at: Option<DateTime<Utc>>,
}

/// Load all data needed for an appointment-confirmation email.
/// Returns `None` if the customer has no email address, or if the
/// revision/customer does not exist for this user.
pub async fn resolve_confirmation_data(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    revision_id: Uuid,
) -> Result<Option<ConfirmationData>> {
    let row = sqlx::query_as!(
        ConfirmationRow,
        r#"
        SELECT
            c.email                                    AS recipient_email,
            COALESCE(c.contact_person, c.name)         AS customer_name,
            c.street,
            c.city,
            TO_CHAR(r.scheduled_date, 'DD.MM.YYYY')    AS scheduled_date,
            r.scheduled_time_start,
            r.scheduled_time_end,
            u.business_name,
            u.phone,
            u.email                                    AS user_email,
            u.company_locale,
            u.email_confirmation_subject_template      AS subject_template,
            u.email_confirmation_body_template         AS body_template,
            u.email_confirmation_edited_at             AS edited_at
        FROM revisions r
        JOIN customers c ON c.id = $2 AND c.user_id = $1
        JOIN users u     ON u.id = $1
        WHERE r.id = $3 AND r.user_id = $1
        "#,
        user_id,
        customer_id,
        revision_id,
    )
    .fetch_optional(pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    let recipient_email = match row
        .recipient_email
        .filter(|e: &String| !e.trim().is_empty())
    {
        Some(e) => e,
        None => return Ok(None),
    };

    let locale = row.company_locale.as_deref().unwrap_or("en");
    let (subject_template, body_template) = select_confirmation_templates(
        row.subject_template.as_deref(),
        row.body_template.as_deref(),
        row.edited_at,
        locale,
    );

    Ok(Some(ConfirmationData {
        recipient_email,
        customer_name: row.customer_name.unwrap_or_default(),
        address: format_address(
            row.street.as_deref().unwrap_or(""),
            row.city.as_deref().unwrap_or(""),
        ),
        scheduled_date: row.scheduled_date.unwrap_or_default(),
        time_window: format_time_window(row.scheduled_time_start, row.scheduled_time_end),
        company_name: row.business_name.unwrap_or_default(),
        company_phone: row.phone.unwrap_or_default(),
        company_email: row.user_email.unwrap_or_default(),
        company_locale: locale.to_string(),
        subject_template,
        body_template,
    }))
}

/// Raw row returned by the reminder data query.
#[derive(Debug, sqlx::FromRow)]
struct ReminderRow {
    recipient_email: Option<String>,
    customer_name: Option<String>,
    device_type: Option<String>,
    due_date: Option<String>,
    business_name: Option<String>,
    phone: Option<String>,
    user_email: Option<String>,
    company_locale: Option<String>,
    subject_template: Option<String>,
    body_template: Option<String>,
    edited_at: Option<DateTime<Utc>>,
}

/// Load all data needed for a revision-reminder email.
/// Returns `None` if the customer has no email address, or if the
/// revision/customer does not exist for this user.
pub async fn resolve_reminder_data(
    pool: &PgPool,
    user_id: Uuid,
    customer_id: Uuid,
    revision_id: Uuid,
) -> Result<Option<ReminderData>> {
    let row = sqlx::query_as!(
        ReminderRow,
        r#"
        SELECT
            c.email                                 AS recipient_email,
            COALESCE(c.contact_person, c.name)      AS customer_name,
            d.device_type::text                     AS device_type,
            TO_CHAR(r.due_date, 'DD.MM.YYYY')       AS due_date,
            u.business_name,
            u.phone,
            u.email                                 AS user_email,
            u.company_locale,
            u.email_reminder_subject_template       AS subject_template,
            u.email_reminder_body_template          AS body_template,
            u.email_reminder_edited_at              AS edited_at
        FROM revisions r
        JOIN customers c ON c.id = $2 AND c.user_id = $1
        JOIN users u     ON u.id = $1
        LEFT JOIN devices d ON d.id = r.device_id AND d.user_id = $1
        WHERE r.id = $3 AND r.user_id = $1
        "#,
        user_id,
        customer_id,
        revision_id,
    )
    .fetch_optional(pool)
    .await?;

    let row = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    let recipient_email = match row
        .recipient_email
        .filter(|e: &String| !e.trim().is_empty())
    {
        Some(e) => e,
        None => return Ok(None),
    };

    let locale = row.company_locale.as_deref().unwrap_or("en");
    let (subject_template, body_template) = select_reminder_templates(
        row.subject_template.as_deref(),
        row.body_template.as_deref(),
        row.edited_at,
        locale,
    );

    Ok(Some(ReminderData {
        recipient_email,
        customer_name: row.customer_name.unwrap_or_default(),
        device_type: row.device_type.unwrap_or_default(),
        due_date: row.due_date.unwrap_or_default(),
        company_name: row.business_name.unwrap_or_default(),
        company_phone: row.phone.unwrap_or_default(),
        company_email: row.user_email.unwrap_or_default(),
        company_locale: locale.to_string(),
        subject_template,
        body_template,
    }))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- format_address ----

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

    #[test]
    fn format_address_trims_whitespace() {
        assert_eq!(
            format_address("  Korunní 15  ", "  Praha  "),
            "Korunní 15, Praha"
        );
    }

    #[test]
    fn format_address_whitespace_only_street_treated_as_empty() {
        assert_eq!(format_address("   ", "Praha"), "Praha");
    }

    // ---- format_time_window ----

    #[test]
    fn format_time_window_both_times() {
        let start = NaiveTime::from_hms_opt(8, 0, 0).unwrap();
        let end = NaiveTime::from_hms_opt(10, 0, 0).unwrap();
        assert_eq!(
            format_time_window(Some(start), Some(end)),
            Some("08:00–10:00".to_string())
        );
    }

    #[test]
    fn format_time_window_start_only() {
        let start = NaiveTime::from_hms_opt(8, 0, 0).unwrap();
        assert_eq!(
            format_time_window(Some(start), None),
            Some("08:00".to_string())
        );
    }

    #[test]
    fn format_time_window_neither() {
        assert_eq!(format_time_window(None, None), None);
    }

    #[test]
    fn format_time_window_end_only_returns_none() {
        let end = NaiveTime::from_hms_opt(10, 0, 0).unwrap();
        assert_eq!(format_time_window(None, Some(end)), None);
    }

    #[test]
    fn format_time_window_midnight_boundary() {
        let start = NaiveTime::from_hms_opt(0, 0, 0).unwrap();
        let end = NaiveTime::from_hms_opt(23, 59, 0).unwrap();
        assert_eq!(
            format_time_window(Some(start), Some(end)),
            Some("00:00–23:59".to_string())
        );
    }

    // ---- select_confirmation_templates ----

    #[test]
    fn confirmation_templates_uses_custom_when_edited() {
        let (subj, body) = select_confirmation_templates(
            Some("Vlastní předmět"),
            Some("Vlastní tělo"),
            Some(Utc::now()),
            "cs",
        );
        assert_eq!(subj, "Vlastní předmět");
        assert_eq!(body, "Vlastní tělo");
    }

    #[test]
    fn confirmation_templates_uses_locale_default_when_not_edited() {
        let (subj, _) = select_confirmation_templates(None, None, None, "cs");
        assert!(
            subj.contains("Potvrzení"),
            "Expected Czech default, got: {}",
            subj
        );
    }

    #[test]
    fn confirmation_templates_uses_default_when_edited_but_null() {
        let (subj, _) = select_confirmation_templates(None, None, Some(Utc::now()), "cs");
        assert!(subj.contains("Potvrzení"));
    }

    #[test]
    fn confirmation_templates_uses_default_when_edited_but_empty() {
        let (subj, _) = select_confirmation_templates(Some(""), Some(""), Some(Utc::now()), "cs");
        assert!(subj.contains("Potvrzení"));
    }

    #[test]
    fn confirmation_templates_en_locale_default() {
        let (subj, _) = select_confirmation_templates(None, None, None, "en");
        assert!(subj.contains("confirmation") || subj.contains("Confirmation"));
    }

    #[test]
    fn confirmation_templates_sk_locale_default() {
        let (subj, _) = select_confirmation_templates(None, None, None, "sk");
        assert!(
            subj.contains("Potvrdenie"),
            "Expected Slovak default, got: {}",
            subj
        );
    }

    #[test]
    fn confirmation_templates_unknown_locale_falls_back_to_en() {
        let (subj, _) = select_confirmation_templates(None, None, None, "de");
        assert!(subj.contains("confirmation") || subj.contains("Confirmation"));
    }

    // ---- select_reminder_templates ----

    #[test]
    fn reminder_templates_uses_custom_when_edited() {
        let (subj, body) = select_reminder_templates(
            Some("Vlastní připomínka"),
            Some("Vlastní tělo"),
            Some(Utc::now()),
            "cs",
        );
        assert_eq!(subj, "Vlastní připomínka");
        assert_eq!(body, "Vlastní tělo");
    }

    #[test]
    fn reminder_templates_uses_locale_default_when_not_edited() {
        let (subj, _) = select_reminder_templates(None, None, None, "cs");
        assert!(
            subj.contains("Připomínka"),
            "Expected Czech default, got: {}",
            subj
        );
    }

    #[test]
    fn reminder_templates_sk_locale_default() {
        let (subj, _) = select_reminder_templates(None, None, None, "sk");
        assert!(
            subj.contains("Pripomienka"),
            "Expected Slovak default, got: {}",
            subj
        );
    }

    #[test]
    fn reminder_templates_en_locale_default() {
        let (subj, _) = select_reminder_templates(None, None, None, "en");
        assert!(subj.contains("reminder") || subj.contains("Reminder"));
    }

    #[test]
    fn reminder_templates_uses_default_when_edited_but_empty() {
        let (subj, _) = select_reminder_templates(Some(""), Some(""), Some(Utc::now()), "cs");
        assert!(subj.contains("Připomínka"));
    }
}
