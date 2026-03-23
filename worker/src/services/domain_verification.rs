//! Domain identity management for custom-domain SES sending.
//!
//! Handles the full lifecycle of a user's custom email domain:
//! - Creating / checking / deleting SES domain identities
//! - Selecting the correct `From` address (verified domain vs Ariadline fallback)
//! - Validating domain and from-email inputs

use anyhow::{anyhow, Result};
use sqlx::PgPool;
use uuid::Uuid;

// ============================================================================
// Public types
// ============================================================================

/// Resolved sender information for a single outgoing email.
#[derive(Debug, Clone, PartialEq)]
pub struct SenderInfo {
    /// RFC 5321 `From` header value, e.g. `"Firma <info@firma.cz>"`.
    pub from: String,
    /// Optional `Reply-To` address. Set when falling back to Ariadline sender.
    pub reply_to: Option<String>,
}

/// Verification status values stored in `user_email_domains.verification_status`.
#[derive(Debug, Clone, PartialEq)]
pub enum VerificationStatus {
    Pending,
    Verified,
    Failed,
}

impl VerificationStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Verified => "verified",
            Self::Failed => "failed",
        }
    }
}

impl std::fmt::Display for VerificationStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A row from `user_email_domains` (subset used by sender selection).
#[derive(Debug, Clone)]
pub struct UserEmailDomain {
    pub id: Uuid,
    pub user_id: Uuid,
    pub domain: String,
    pub from_email: String,
    pub from_name: Option<String>,
    pub is_active: bool,
    pub verification_status: String,
}

// ============================================================================
// Sender selection (pure — no I/O)
// ============================================================================

/// Select the `From` address for an outgoing email.
///
/// Rules (locked MVP decisions §1.3.1):
/// - If the user has an **active** domain with `verification_status = "verified"` →
///   use that domain's `from_email` / `from_name`.
/// - Otherwise → use the platform fallback `noreply@ariadline.cz` with display name
///   `"<business_name> via Ariadline"` and set `Reply-To` to `business_email`.
pub fn select_from_address(
    active_domain: Option<&UserEmailDomain>,
    fallback_from_email: &str,
    fallback_brand: &str,
    business_name: &str,
    business_email: &str,
) -> SenderInfo {
    if let Some(domain) = active_domain {
        if domain.is_active && domain.verification_status == "verified" {
            let display = domain
                .from_name
                .as_deref()
                .unwrap_or(business_name);
            return SenderInfo {
                from: format_from(display, &domain.from_email),
                reply_to: None,
            };
        }
    }

    // Fallback path
    let display = if business_name.is_empty() {
        fallback_brand.to_string()
    } else {
        format!("{} via {}", business_name, fallback_brand)
    };

    SenderInfo {
        from: format_from(&display, fallback_from_email),
        reply_to: if business_email.is_empty() {
            None
        } else {
            Some(business_email.to_string())
        },
    }
}

/// Format an RFC 5321 `From` value: `"Display Name <email>"`.
fn format_from(display: &str, email: &str) -> String {
    if display.is_empty() {
        email.to_string()
    } else {
        format!("{} <{}>", display, email)
    }
}

// ============================================================================
// Input validation (pure)
// ============================================================================

/// Validate a domain string (no protocol, no trailing dot, no spaces).
pub fn validate_domain(domain: &str) -> Result<()> {
    if domain.is_empty() {
        return Err(anyhow!("Domain must not be empty"));
    }
    if domain.contains("://") {
        return Err(anyhow!("Domain must not include a protocol prefix"));
    }
    if domain.contains(' ') {
        return Err(anyhow!("Domain must not contain spaces"));
    }
    if domain.starts_with('.') || domain.ends_with('.') {
        return Err(anyhow!("Domain must not start or end with a dot"));
    }
    Ok(())
}

/// Validate that `from_email` belongs to `domain`.
pub fn validate_from_email(from_email: &str, domain: &str) -> Result<()> {
    let parts: Vec<&str> = from_email.splitn(2, '@').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(anyhow!("Invalid email format: {}", from_email));
    }
    if parts[1] != domain {
        return Err(anyhow!(
            "from_email '{}' must be on domain '{}'",
            from_email,
            domain
        ));
    }
    Ok(())
}

// ============================================================================
// DB helpers
// ============================================================================

/// Fetch the single active domain row for `user_id`, if any.
pub async fn get_active_domain(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<UserEmailDomain>> {
    let row = sqlx::query_as!(
        UserEmailDomain,
        r#"
        SELECT id, user_id, domain, from_email, from_name,
               is_active, verification_status
        FROM user_email_domains
        WHERE user_id = $1 AND is_active = true
        LIMIT 1
        "#,
        user_id
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Deactivate all existing active domains for `user_id` (before inserting a new one).
pub async fn deactivate_domains(pool: &PgPool, user_id: Uuid) -> Result<()> {
    sqlx::query!(
        "UPDATE user_email_domains SET is_active = false, updated_at = NOW() WHERE user_id = $1 AND is_active = true",
        user_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Insert a new domain row (caller must have called `deactivate_domains` first).
pub async fn insert_domain(
    pool: &PgPool,
    user_id: Uuid,
    domain: &str,
    from_email: &str,
    from_name: Option<&str>,
    dkim_tokens: &[String],
) -> Result<Uuid> {
    let id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO user_email_domains
            (id, user_id, domain, from_email, from_name, is_active,
             verification_status, dkim_tokens, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, true, 'pending', $6, NOW(), NOW())
        "#,
        id,
        user_id,
        domain,
        from_email,
        from_name,
        dkim_tokens,
    )
    .execute(pool)
    .await?;
    Ok(id)
}

/// Update verification status after a SES `GetEmailIdentity` check.
pub async fn update_verification_status(
    pool: &PgPool,
    id: Uuid,
    status: &VerificationStatus,
    verified_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<()> {
    sqlx::query!(
        r#"
        UPDATE user_email_domains
        SET verification_status = $2,
            verified_at = $3,
            last_checked_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
        "#,
        id,
        status.as_str(),
        verified_at,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a domain row (also calls `ses:DeleteEmailIdentity` at the handler level).
pub async fn delete_domain(pool: &PgPool, id: Uuid, user_id: Uuid) -> Result<()> {
    sqlx::query!(
        "DELETE FROM user_email_domains WHERE id = $1 AND user_id = $2",
        id,
        user_id
    )
    .execute(pool)
    .await?;
    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn verified_domain(from_email: &str, from_name: Option<&str>) -> UserEmailDomain {
        UserEmailDomain {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            domain: "firma.cz".to_string(),
            from_email: from_email.to_string(),
            from_name: from_name.map(str::to_string),
            is_active: true,
            verification_status: "verified".to_string(),
        }
    }

    fn pending_domain() -> UserEmailDomain {
        UserEmailDomain {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            domain: "firma.cz".to_string(),
            from_email: "info@firma.cz".to_string(),
            from_name: Some("Firma".to_string()),
            is_active: true,
            verification_status: "pending".to_string(),
        }
    }

    // ---- select_from_address: verified domain ----

    #[test]
    fn select_from_verified_domain_uses_domain_sender() {
        let domain = verified_domain("info@firma.cz", Some("Firma"));
        let info = select_from_address(
            Some(&domain),
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma s.r.o.",
            "jan@firma.cz",
        );
        assert_eq!(info.from, "Firma <info@firma.cz>");
        assert_eq!(info.reply_to, None);
    }

    #[test]
    fn select_from_verified_domain_no_from_name_uses_business_name() {
        let domain = verified_domain("info@firma.cz", None);
        let info = select_from_address(
            Some(&domain),
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma s.r.o.",
            "jan@firma.cz",
        );
        assert_eq!(info.from, "Firma s.r.o. <info@firma.cz>");
        assert_eq!(info.reply_to, None);
    }

    #[test]
    fn verified_domain_reply_to_is_none() {
        let domain = verified_domain("info@firma.cz", Some("Firma"));
        let info = select_from_address(
            Some(&domain),
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma",
            "jan@firma.cz",
        );
        assert!(info.reply_to.is_none());
    }

    // ---- select_from_address: fallback paths ----

    #[test]
    fn select_from_pending_domain_uses_fallback_with_reply_to() {
        let domain = pending_domain();
        let info = select_from_address(
            Some(&domain),
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma",
            "jan@firma.cz",
        );
        assert_eq!(info.from, "Firma via Ariadline <noreply@ariadline.cz>");
        assert_eq!(info.reply_to, Some("jan@firma.cz".to_string()));
    }

    #[test]
    fn select_from_failed_domain_uses_fallback_with_reply_to() {
        let mut domain = pending_domain();
        domain.verification_status = "failed".to_string();
        let info = select_from_address(
            Some(&domain),
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma",
            "jan@firma.cz",
        );
        assert_eq!(info.from, "Firma via Ariadline <noreply@ariadline.cz>");
        assert_eq!(info.reply_to, Some("jan@firma.cz".to_string()));
    }

    #[test]
    fn select_from_no_domain_uses_fallback_with_reply_to() {
        let info = select_from_address(
            None,
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma",
            "jan@firma.cz",
        );
        assert_eq!(info.from, "Firma via Ariadline <noreply@ariadline.cz>");
        assert_eq!(info.reply_to, Some("jan@firma.cz".to_string()));
    }

    #[test]
    fn select_from_inactive_verified_domain_uses_fallback() {
        let mut domain = verified_domain("info@firma.cz", Some("Firma"));
        domain.is_active = false;
        let info = select_from_address(
            Some(&domain),
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma",
            "jan@firma.cz",
        );
        assert_eq!(info.from, "Firma via Ariadline <noreply@ariadline.cz>");
    }

    #[test]
    fn fallback_display_name_includes_business_name_via_ariadline() {
        let info = select_from_address(
            None,
            "noreply@ariadline.cz",
            "Ariadline",
            "Revize Praha",
            "info@revize-praha.cz",
        );
        assert_eq!(info.from, "Revize Praha via Ariadline <noreply@ariadline.cz>");
    }

    #[test]
    fn fallback_display_name_empty_business_name_uses_brand_only() {
        let info = select_from_address(
            None,
            "noreply@ariadline.cz",
            "Ariadline",
            "",
            "info@firma.cz",
        );
        assert_eq!(info.from, "Ariadline <noreply@ariadline.cz>");
    }

    #[test]
    fn fallback_reply_to_is_user_business_email() {
        let info = select_from_address(
            None,
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma",
            "owner@firma.cz",
        );
        assert_eq!(info.reply_to, Some("owner@firma.cz".to_string()));
    }

    #[test]
    fn fallback_reply_to_none_when_no_business_email() {
        let info = select_from_address(
            None,
            "noreply@ariadline.cz",
            "Ariadline",
            "Firma",
            "",
        );
        assert!(info.reply_to.is_none());
    }

    // ---- validate_domain ----

    #[test]
    fn validate_domain_accepts_simple_domain() {
        assert!(validate_domain("firma.cz").is_ok());
    }

    #[test]
    fn validate_domain_accepts_subdomain() {
        assert!(validate_domain("mail.firma.cz").is_ok());
    }

    #[test]
    fn validate_domain_rejects_empty() {
        assert!(validate_domain("").is_err());
    }

    #[test]
    fn validate_domain_rejects_spaces() {
        assert!(validate_domain("firma .cz").is_err());
    }

    #[test]
    fn validate_domain_rejects_leading_dot() {
        assert!(validate_domain(".firma.cz").is_err());
    }

    #[test]
    fn validate_domain_rejects_trailing_dot() {
        assert!(validate_domain("firma.cz.").is_err());
    }

    #[test]
    fn validate_domain_rejects_https_prefix() {
        assert!(validate_domain("https://firma.cz").is_err());
    }

    #[test]
    fn validate_domain_rejects_http_prefix() {
        assert!(validate_domain("http://firma.cz").is_err());
    }

    // ---- validate_from_email ----

    #[test]
    fn validate_from_email_accepts_matching_domain() {
        assert!(validate_from_email("info@firma.cz", "firma.cz").is_ok());
    }

    #[test]
    fn validate_from_email_rejects_different_domain() {
        assert!(validate_from_email("info@other.cz", "firma.cz").is_err());
    }

    #[test]
    fn validate_from_email_rejects_no_at_sign() {
        assert!(validate_from_email("not-an-email", "firma.cz").is_err());
    }

    #[test]
    fn validate_from_email_rejects_empty_local_part() {
        assert!(validate_from_email("@firma.cz", "firma.cz").is_err());
    }

    #[test]
    fn validate_from_email_rejects_empty_domain_part() {
        assert!(validate_from_email("info@", "firma.cz").is_err());
    }

    // ---- VerificationStatus ----

    #[test]
    fn verification_status_as_str() {
        assert_eq!(VerificationStatus::Pending.as_str(), "pending");
        assert_eq!(VerificationStatus::Verified.as_str(), "verified");
        assert_eq!(VerificationStatus::Failed.as_str(), "failed");
    }

    #[test]
    fn verification_status_display() {
        assert_eq!(VerificationStatus::Verified.to_string(), "verified");
    }
}
