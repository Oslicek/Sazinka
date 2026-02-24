
//! Transactional email templates for the onboarding wizard (Phase 10).
//!
//! Supported templates:
//!   - `VerificationEmail`   — sent on initial registration and resend
//!   - `AlreadyRegistered`   — anti-enumeration: sent when a verified email re-registers
//!
//! Each template is rendered per-locale (en, cs, sk).
//! The `render()` method returns an `EmailMessage` ready to pass to `EmailSender::send`.

use crate::services::email_sender::EmailMessage;

// =============================================================================
// Verification email
// =============================================================================

pub struct VerificationEmail<'a> {
    pub to: &'a str,
    pub verify_url: &'a str,
    pub locale: &'a str,
}

impl<'a> VerificationEmail<'a> {
    pub fn render(&self) -> EmailMessage {
        let (subject, body_html, body_text) = match self.locale {
            "cs" => (
                "Ověřte svůj e-mail – Sazinka",
                format!(
                    r#"<p>Dobrý den,</p>
<p>Kliknutím na odkaz níže ověříte svůj e-mail a aktivujete svůj účet Sazinka:</p>
<p><a href="{url}">{url}</a></p>
<p>Odkaz platí 24 hodin.</p>
<p>Pokud jste si účet nezaložili, tento e-mail ignorujte.</p>"#,
                    url = self.verify_url
                ),
                format!(
                    "Dobrý den,\n\nOvěřte svůj e-mail kliknutím na: {}\n\nOdkaz platí 24 hodin.",
                    self.verify_url
                ),
            ),
            "sk" => (
                "Overte svoj e-mail – Sazinka",
                format!(
                    r#"<p>Dobrý deň,</p>
<p>Kliknutím na odkaz nižšie overíte svoj e-mail a aktivujete váš účet Sazinka:</p>
<p><a href="{url}">{url}</a></p>
<p>Odkaz platí 24 hodín.</p>
<p>Ak ste si účet nezaložili, tento e-mail ignorujte.</p>"#,
                    url = self.verify_url
                ),
                format!(
                    "Dobrý deň,\n\nOverte svoj e-mail kliknutím na: {}\n\nOdkaz platí 24 hodín.",
                    self.verify_url
                ),
            ),
            _ => (
                "Verify your email – Sazinka",
                format!(
                    r#"<p>Hello,</p>
<p>Click the link below to verify your email and activate your Sazinka account:</p>
<p><a href="{url}">{url}</a></p>
<p>This link is valid for 24 hours.</p>
<p>If you did not create an account, please ignore this email.</p>"#,
                    url = self.verify_url
                ),
                format!(
                    "Hello,\n\nVerify your email by clicking: {}\n\nThis link is valid for 24 hours.",
                    self.verify_url
                ),
            ),
        };

        EmailMessage {
            to: self.to.to_string(),
            subject: subject.to_string(),
            html: body_html,
            text: body_text,
        }
    }
}

// =============================================================================
// Already-registered email (anti-enumeration)
// =============================================================================

pub struct AlreadyRegisteredEmail<'a> {
    pub to: &'a str,
    pub login_url: &'a str,
    pub locale: &'a str,
}

impl<'a> AlreadyRegisteredEmail<'a> {
    pub fn render(&self) -> EmailMessage {
        let (subject, body_html, body_text) = match self.locale {
            "cs" => (
                "Tento e-mail je již registrován – Sazinka",
                format!(
                    r#"<p>Dobrý den,</p>
<p>Přijali jsme žádost o registraci pro tento e-mail. Ten je ale u nás již zaregistrován.</p>
<p>Přihlaste se zde: <a href="{url}">{url}</a></p>
<p>Pokud jste zapomněli heslo, použijte funkci „Zapomenuté heslo" na přihlašovací stránce.</p>
<p>Pokud jste si účet nezaložili, tento e-mail ignorujte.</p>"#,
                    url = self.login_url
                ),
                format!(
                    "Dobrý den,\n\nTento e-mail je již registrován. Přihlaste se: {}\n\nPokud jste si účet nezaložili, ignorujte tento e-mail.",
                    self.login_url
                ),
            ),
            "sk" => (
                "Tento e-mail je už zaregistrovaný – Sazinka",
                format!(
                    r#"<p>Dobrý deň,</p>
<p>Prijali sme žiadosť o registráciu pre tento e-mail. Ten je však u nás už zaregistrovaný.</p>
<p>Prihláste sa tu: <a href="{url}">{url}</a></p>
<p>Ak ste zabudli heslo, použite funkciu „Zabudnuté heslo" na prihlasovacej stránke.</p>
<p>Ak ste si účet nezaložili, tento e-mail ignorujte.</p>"#,
                    url = self.login_url
                ),
                format!(
                    "Dobrý deň,\n\nTento e-mail je už zaregistrovaný. Prihláste sa: {}\n\nAk ste si účet nezaložili, ignorujte tento e-mail.",
                    self.login_url
                ),
            ),
            _ => (
                "This email is already registered – Sazinka",
                format!(
                    r#"<p>Hello,</p>
<p>We received a registration request for this email address, but it is already registered with us.</p>
<p>Log in here: <a href="{url}">{url}</a></p>
<p>If you've forgotten your password, use the "Forgot password" option on the login page.</p>
<p>If you did not make this request, you can safely ignore this email.</p>"#,
                    url = self.login_url
                ),
                format!(
                    "Hello,\n\nThis email is already registered. Log in: {}\n\nIf you did not make this request, ignore this email.",
                    self.login_url
                ),
            ),
        };

        EmailMessage {
            to: self.to.to_string(),
            subject: subject.to_string(),
            html: body_html,
            text: body_text,
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- VerificationEmail ---

    #[test]
    fn verification_email_en() {
        let email = VerificationEmail {
            to: "user@example.com",
            verify_url: "https://app.sazinka.cz/verify?token=abc123",
            locale: "en",
        }
        .render();
        assert_eq!(email.to, "user@example.com");
        assert!(email.subject.contains("Verify"));
        assert!(email.html.contains("https://app.sazinka.cz/verify?token=abc123"));
        assert!(email.text.contains("https://app.sazinka.cz/verify?token=abc123"));
    }

    #[test]
    fn verification_email_cs() {
        let email = VerificationEmail {
            to: "user@example.com",
            verify_url: "https://app.sazinka.cz/verify?token=abc123",
            locale: "cs",
        }
        .render();
        assert!(email.subject.contains("Ověřte"));
        assert!(email.html.contains("ověříte"));
    }

    #[test]
    fn verification_email_sk() {
        let email = VerificationEmail {
            to: "user@example.com",
            verify_url: "https://app.sazinka.cz/verify?token=abc123",
            locale: "sk",
        }
        .render();
        assert!(email.subject.contains("Overte"));
        assert!(email.html.contains("overíte"));
    }

    #[test]
    fn verification_email_unknown_locale_falls_back_to_en() {
        let email = VerificationEmail {
            to: "user@example.com",
            verify_url: "https://app.sazinka.cz/verify?token=abc123",
            locale: "de",
        }
        .render();
        assert!(email.subject.contains("Verify"));
    }

    // --- AlreadyRegisteredEmail ---

    #[test]
    fn already_registered_email_en() {
        let email = AlreadyRegisteredEmail {
            to: "existing@example.com",
            login_url: "https://app.sazinka.cz/login",
            locale: "en",
        }
        .render();
        assert_eq!(email.to, "existing@example.com");
        assert!(email.subject.contains("already registered"));
        assert!(email.html.contains("https://app.sazinka.cz/login"));
        assert!(email.text.contains("https://app.sazinka.cz/login"));
    }

    #[test]
    fn already_registered_email_cs() {
        let email = AlreadyRegisteredEmail {
            to: "existing@example.com",
            login_url: "https://app.sazinka.cz/login",
            locale: "cs",
        }
        .render();
        assert!(email.subject.contains("již registrován"));
        assert!(email.html.contains("zaregistrován"));
    }

    #[test]
    fn already_registered_email_sk() {
        let email = AlreadyRegisteredEmail {
            to: "existing@example.com",
            login_url: "https://app.sazinka.cz/login",
            locale: "sk",
        }
        .render();
        assert!(email.subject.contains("zaregistrovaný"));
    }
}
