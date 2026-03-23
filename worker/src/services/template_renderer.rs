//! Email template rendering engine.
//!
//! Provides `{{placeholder}}` substitution for user-customisable email templates.
//! Plain-text and HTML-safe variants are both supported.

use std::collections::HashMap;

// ============================================================================
// Public types
// ============================================================================

/// Variable map used for template substitution.
/// Keys are placeholder names (without braces), values are the substitution strings.
pub type TemplateVars<'a> = HashMap<&'a str, String>;

// ============================================================================
// Core rendering
// ============================================================================

/// Replace `{{key}}` placeholders in `template` with values from `vars`.
/// Unknown placeholders are left intact. Values are inserted verbatim (no escaping).
pub fn render_template(template: &str, vars: &TemplateVars<'_>) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{{{}}}}}", key), value);
    }
    result
}

/// Same as [`render_template`] but HTML-escapes each value before substitution.
/// Use this for the HTML body part of an email.
pub fn render_template_html(template: &str, vars: &TemplateVars<'_>) -> String {
    let escaped: TemplateVars<'_> = vars
        .iter()
        .map(|(&k, v)| (k, html_escape(v)))
        .collect();
    render_template(template, &escaped)
}

/// Escape the five XML/HTML special characters in `s`.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// ============================================================================
// Variable builders
// ============================================================================

/// Build the variable map for an appointment-confirmation email.
pub fn build_confirmation_vars<'a>(
    customer_name: &'a str,
    address: &'a str,
    date: &'a str,
    time_window: Option<&'a str>,
    company_name: &'a str,
    company_phone: &'a str,
    company_email: &'a str,
) -> TemplateVars<'a> {
    let mut vars: TemplateVars<'a> = HashMap::new();
    vars.insert("customerName", customer_name.to_string());
    vars.insert("address", address.to_string());
    vars.insert("date", date.to_string());
    vars.insert("time", time_window.unwrap_or("").to_string());
    vars.insert("companyName", company_name.to_string());
    vars.insert("business_name", company_name.to_string());
    vars.insert("phone", company_phone.to_string());
    vars.insert("email", company_email.to_string());
    vars
}

/// Build the variable map for a revision-reminder email.
pub fn build_reminder_vars<'a>(
    customer_name: &'a str,
    device_type: &'a str,
    due_date: &'a str,
    company_name: &'a str,
    company_phone: &'a str,
    company_email: &'a str,
) -> TemplateVars<'a> {
    let mut vars: TemplateVars<'a> = HashMap::new();
    vars.insert("customerName", customer_name.to_string());
    vars.insert("device_type", device_type.to_string());
    vars.insert("due_date", due_date.to_string());
    vars.insert("date", due_date.to_string());
    vars.insert("companyName", company_name.to_string());
    vars.insert("business_name", company_name.to_string());
    vars.insert("phone", company_phone.to_string());
    vars.insert("email", company_email.to_string());
    vars
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ---- render_template ----

    #[test]
    fn render_replaces_known_placeholders() {
        let template = "Dear {{customerName}}, your appointment is on {{date}}.";
        let mut vars = TemplateVars::new();
        vars.insert("customerName", "Jan Novák".to_string());
        vars.insert("date", "2026-03-15".to_string());

        let result = render_template(template, &vars);

        assert_eq!(result, "Dear Jan Novák, your appointment is on 2026-03-15.");
    }

    #[test]
    fn render_leaves_unknown_placeholders_intact() {
        let template = "Hello {{customerName}}, see you at {{time}}.";
        let mut vars = TemplateVars::new();
        vars.insert("customerName", "Jana".to_string());

        let result = render_template(template, &vars);

        assert_eq!(result, "Hello Jana, see you at {{time}}.");
    }

    #[test]
    fn render_empty_template_returns_empty() {
        let vars = TemplateVars::new();
        assert_eq!(render_template("", &vars), "");
    }

    #[test]
    fn render_empty_vars_leaves_template_unchanged() {
        let template = "Hello {{name}}!";
        let vars = TemplateVars::new();
        assert_eq!(render_template(template, &vars), "Hello {{name}}!");
    }

    #[test]
    fn render_replaces_multiple_occurrences_of_same_placeholder() {
        let template = "{{name}} is {{name}}.";
        let mut vars = TemplateVars::new();
        vars.insert("name", "Alice".to_string());
        assert_eq!(render_template(template, &vars), "Alice is Alice.");
    }

    #[test]
    fn render_placeholder_with_empty_value_removes_it() {
        let template = "Hello {{name}}!";
        let mut vars = TemplateVars::new();
        vars.insert("name", String::new());
        assert_eq!(render_template(template, &vars), "Hello !");
    }

    #[test]
    fn render_all_placeholders_replaced() {
        let template = "{{a}} {{b}} {{c}}";
        let mut vars = TemplateVars::new();
        vars.insert("a", "1".to_string());
        vars.insert("b", "2".to_string());
        vars.insert("c", "3".to_string());
        assert_eq!(render_template(template, &vars), "1 2 3");
    }

    #[test]
    fn render_template_with_no_placeholders_returns_unchanged() {
        let template = "No placeholders here.";
        let mut vars = TemplateVars::new();
        vars.insert("name", "Alice".to_string());
        assert_eq!(render_template(template, &vars), "No placeholders here.");
    }

    #[test]
    fn render_does_not_escape_html_in_plain_variant() {
        let template = "{{name}}";
        let mut vars = TemplateVars::new();
        vars.insert("name", "<b>bold</b>".to_string());
        assert_eq!(render_template(template, &vars), "<b>bold</b>");
    }

    #[test]
    fn render_unicode_values_pass_through() {
        let template = "{{name}}";
        let mut vars = TemplateVars::new();
        vars.insert("name", "Ján Novák 🎉".to_string());
        assert_eq!(render_template(template, &vars), "Ján Novák 🎉");
    }

    // ---- render_template_html ----

    #[test]
    fn render_html_escapes_lt_gt() {
        let template = "Name: {{name}}";
        let mut vars = TemplateVars::new();
        vars.insert("name", "<script>alert('xss')</script>".to_string());

        let result = render_template_html(template, &vars);

        assert!(result.contains("&lt;script&gt;"));
        assert!(!result.contains("<script>"));
    }

    #[test]
    fn render_html_escapes_ampersand() {
        let template = "{{name}}";
        let mut vars = TemplateVars::new();
        vars.insert("name", "A & B".to_string());
        assert_eq!(render_template_html(template, &vars), "A &amp; B");
    }

    #[test]
    fn render_html_escapes_double_quote() {
        let template = "{{name}}";
        let mut vars = TemplateVars::new();
        vars.insert("name", r#"say "hello""#.to_string());
        assert_eq!(render_template_html(template, &vars), "say &quot;hello&quot;");
    }

    #[test]
    fn render_html_escapes_single_quote() {
        let template = "{{name}}";
        let mut vars = TemplateVars::new();
        vars.insert("name", "it's".to_string());
        assert_eq!(render_template_html(template, &vars), "it&#39;s");
    }

    #[test]
    fn render_html_escapes_all_five_special_chars() {
        let template = "{{v}}";
        let mut vars = TemplateVars::new();
        vars.insert("v", r#"<>&"'"#.to_string());
        let result = render_template_html(template, &vars);
        assert_eq!(result, "&lt;&gt;&amp;&quot;&#39;");
    }

    #[test]
    fn render_html_leaves_unknown_placeholders_intact() {
        let template = "{{known}} {{unknown}}";
        let mut vars = TemplateVars::new();
        vars.insert("known", "ok".to_string());
        assert_eq!(render_template_html(template, &vars), "ok {{unknown}}");
    }

    #[test]
    fn render_html_safe_value_passes_through_unchanged() {
        let template = "{{name}}";
        let mut vars = TemplateVars::new();
        vars.insert("name", "Jan Novák".to_string());
        assert_eq!(render_template_html(template, &vars), "Jan Novák");
    }

    // ---- build_confirmation_vars ----

    #[test]
    fn build_confirmation_vars_all_fields_present() {
        let vars = build_confirmation_vars(
            "Jan Novák",
            "Korunní 15, Praha",
            "2026-03-15",
            Some("08:00-10:00"),
            "Ariadline",
            "+420 123 456 789",
            "info@ariadline.cz",
        );

        assert_eq!(vars.get("customerName").map(|s| s.as_str()), Some("Jan Novák"));
        assert_eq!(vars.get("address").map(|s| s.as_str()), Some("Korunní 15, Praha"));
        assert_eq!(vars.get("date").map(|s| s.as_str()), Some("2026-03-15"));
        assert_eq!(vars.get("time").map(|s| s.as_str()), Some("08:00-10:00"));
        assert_eq!(vars.get("companyName").map(|s| s.as_str()), Some("Ariadline"));
        assert_eq!(vars.get("business_name").map(|s| s.as_str()), Some("Ariadline"));
        assert_eq!(vars.get("phone").map(|s| s.as_str()), Some("+420 123 456 789"));
        assert_eq!(vars.get("email").map(|s| s.as_str()), Some("info@ariadline.cz"));
    }

    #[test]
    fn build_confirmation_vars_no_time_window_gives_empty_time() {
        let vars = build_confirmation_vars(
            "Jana", "", "2026-03-15", None, "Firma", "", "",
        );
        assert_eq!(vars.get("time").map(|s| s.as_str()), Some(""));
    }

    #[test]
    fn build_confirmation_vars_company_name_in_both_keys() {
        let vars = build_confirmation_vars(
            "X", "", "", None, "My Company", "", "",
        );
        assert_eq!(vars.get("companyName"), vars.get("business_name"));
    }

    #[test]
    fn build_confirmation_vars_renders_into_template() {
        let vars = build_confirmation_vars(
            "Jana Nováková",
            "Hlavní 1, Brno",
            "15.3.2026",
            Some("09:00-11:00"),
            "Revize s.r.o.",
            "+420 999 888 777",
            "info@revize.cz",
        );
        let template = "Dobrý den {{customerName}}, Váš termín je {{date}} ({{time}}) na adrese {{address}}.";
        let result = render_template(template, &vars);
        assert!(result.contains("Jana Nováková"));
        assert!(result.contains("15.3.2026"));
        assert!(result.contains("09:00-11:00"));
        assert!(result.contains("Hlavní 1, Brno"));
    }

    // ---- build_reminder_vars ----

    #[test]
    fn build_reminder_vars_all_fields_present() {
        let vars = build_reminder_vars(
            "Jan Novák",
            "Plynový kotel",
            "2026-04-01",
            "Revize Praha",
            "+420 111 222 333",
            "info@revize-praha.cz",
        );

        assert_eq!(vars.get("customerName").map(|s| s.as_str()), Some("Jan Novák"));
        assert_eq!(vars.get("device_type").map(|s| s.as_str()), Some("Plynový kotel"));
        assert_eq!(vars.get("due_date").map(|s| s.as_str()), Some("2026-04-01"));
        assert_eq!(vars.get("date").map(|s| s.as_str()), Some("2026-04-01"));
        assert_eq!(vars.get("companyName").map(|s| s.as_str()), Some("Revize Praha"));
        assert_eq!(vars.get("business_name").map(|s| s.as_str()), Some("Revize Praha"));
        assert_eq!(vars.get("phone").map(|s| s.as_str()), Some("+420 111 222 333"));
        assert_eq!(vars.get("email").map(|s| s.as_str()), Some("info@revize-praha.cz"));
    }

    #[test]
    fn build_reminder_vars_due_date_aliased_as_date() {
        let vars = build_reminder_vars("X", "Y", "2026-05-01", "Z", "", "");
        assert_eq!(vars.get("due_date"), vars.get("date"));
    }

    #[test]
    fn build_reminder_vars_company_name_in_both_keys() {
        let vars = build_reminder_vars("X", "Y", "2026-05-01", "My Firm", "", "");
        assert_eq!(vars.get("companyName"), vars.get("business_name"));
    }

    #[test]
    fn build_reminder_vars_renders_into_template() {
        let vars = build_reminder_vars(
            "Jana Nováková",
            "Plynový kotel",
            "1.4.2026",
            "Revize s.r.o.",
            "+420 999",
            "info@r.cz",
        );
        let template = "Vážený zákazníku {{customerName}}, Vaše zařízení {{device_type}} má termín revize {{due_date}}.";
        let result = render_template(template, &vars);
        assert!(result.contains("Jana Nováková"));
        assert!(result.contains("Plynový kotel"));
        assert!(result.contains("1.4.2026"));
    }

    // ---- html_escape (via render_template_html) ----

    #[test]
    fn html_escape_multiple_special_chars_in_one_value() {
        let template = "{{v}}";
        let mut vars = TemplateVars::new();
        vars.insert("v", "A < B & C > D".to_string());
        let result = render_template_html(template, &vars);
        assert_eq!(result, "A &lt; B &amp; C &gt; D");
    }

    #[test]
    fn html_escape_empty_value_stays_empty() {
        let template = "{{v}}";
        let mut vars = TemplateVars::new();
        vars.insert("v", String::new());
        assert_eq!(render_template_html(template, &vars), "");
    }
}
