//! Configuration management

use anyhow::{self, Context, Result};

/// Application configuration
#[derive(Debug, Clone)]
pub struct Config {
    /// NATS server URL
    pub nats_url: String,
    
    /// PostgreSQL connection string
    pub database_url: String,
    
    /// Nominatim API URL (for geocoding)
    pub nominatim_url: String,
    
    /// Valhalla routing engine URL (optional, falls back to mock if unavailable)
    pub valhalla_url: Option<String>,
    
    /// JWT secret key for token signing/validation
    pub jwt_secret: String,

    /// Base URL of the web app (e.g. "https://app.sazinka.cz").
    /// Used to build email verification links.
    pub app_base_url: String,

    /// AWS region for SES (e.g. "eu-central-1"). None → email sending disabled.
    pub ses_region: Option<String>,
    /// Platform fallback sender address used when user has no verified domain.
    pub ses_from_email: Option<String>,
    /// Platform brand name for fallback display name composition.
    pub ses_from_name: Option<String>,
    /// Optional SES configuration set name for open/click/bounce tracking.
    pub ses_configuration_set: Option<String>,
}

impl Config {
    /// Load configuration from environment variables.
    /// Expects `dotenvy::dotenv()` to have been called already.
    pub fn from_env() -> Result<Self> {
        let nats_url = std::env::var("NATS_URL")
            .unwrap_or_else(|_| "nats://localhost:4222".to_string());

        let database_url = std::env::var("DATABASE_URL")
            .context("DATABASE_URL must be set")?;

        let nominatim_url = std::env::var("NOMINATIM_URL")
            .unwrap_or_else(|_| "https://nominatim.openstreetmap.org".to_string());

        let valhalla_url = std::env::var("VALHALLA_URL").ok();

        let jwt_secret = std::env::var("JWT_SECRET")
            .context("JWT_SECRET must be set — generate one with: openssl rand -base64 48")?;

        let app_base_url = std::env::var("APP_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:5173".to_string());

        if jwt_secret.len() < 32 {
            anyhow::bail!(
                "JWT_SECRET must be at least 32 bytes (current: {} bytes). Generate one with: openssl rand -base64 48",
                jwt_secret.len()
            );
        }

        const KNOWN_DEV_SECRETS: &[&str] = &[
            "dev-secret-change-in-production-min-32-bytes!!",
        ];
        if KNOWN_DEV_SECRETS.contains(&jwt_secret.as_str()) {
            tracing::warn!("⚠ JWT_SECRET matches a known default — change it for production!");
        }

        let ses_region = std::env::var("SES_REGION").ok();
        let ses_from_email = std::env::var("SES_FROM_EMAIL").ok();
        let ses_from_name = std::env::var("SES_FROM_NAME").ok();
        let ses_configuration_set = std::env::var("SES_CONFIGURATION_SET").ok();

        Ok(Self {
            nats_url,
            database_url,
            nominatim_url,
            valhalla_url,
            jwt_secret,
            app_base_url,
            ses_region,
            ses_from_email,
            ses_from_name,
            ses_configuration_set,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // requires --test-threads=1 due to env var race
    fn test_config_valhalla_url_none_when_not_set() {
        // Clear env var if set
        std::env::remove_var("VALHALLA_URL");
        std::env::set_var("DATABASE_URL", "postgres://test");
        
        let config = Config::from_env().unwrap();
        assert!(config.valhalla_url.is_none());
    }

    #[test]
    fn test_config_valhalla_url_some_when_set() {
        std::env::set_var("VALHALLA_URL", "http://localhost:8002");
        std::env::set_var("DATABASE_URL", "postgres://test");
        std::env::set_var("JWT_SECRET", "test-secret-that-is-at-least-32-bytes-long!!");
        
        let config = Config::from_env().unwrap();
        assert_eq!(config.valhalla_url, Some("http://localhost:8002".to_string()));
        
        // Cleanup
        std::env::remove_var("VALHALLA_URL");
        std::env::remove_var("JWT_SECRET");
    }

    #[test]
    #[ignore] // requires --test-threads=1 due to env var race
    fn test_config_nominatim_url_defaults_to_public() {
        std::env::remove_var("NOMINATIM_URL");
        std::env::set_var("DATABASE_URL", "postgres://test");
        
        let config = Config::from_env().unwrap();
        assert_eq!(config.nominatim_url, "https://nominatim.openstreetmap.org");
    }

    #[test]
    fn test_config_nominatim_url_uses_local_when_set() {
        std::env::set_var("NOMINATIM_URL", "http://localhost:8080");
        std::env::set_var("DATABASE_URL", "postgres://test");
        std::env::set_var("JWT_SECRET", "test-secret-that-is-at-least-32-bytes-long!!");
        
        let config = Config::from_env().unwrap();
        assert_eq!(config.nominatim_url, "http://localhost:8080");
        
        // Cleanup
        std::env::remove_var("NOMINATIM_URL");
        std::env::remove_var("JWT_SECRET");
    }

    #[test]
    fn test_config_ses_region_some_when_set() {
        std::env::set_var("SES_REGION", "eu-central-1");
        std::env::set_var("SES_FROM_EMAIL", "noreply@ariadline.cz");
        std::env::set_var("SES_FROM_NAME", "Ariadline");
        std::env::set_var("DATABASE_URL", "postgres://test");
        std::env::set_var("JWT_SECRET", "test-secret-that-is-at-least-32-bytes-long!!");

        let config = Config::from_env().unwrap();
        assert_eq!(config.ses_region, Some("eu-central-1".to_string()));
        assert_eq!(config.ses_from_email, Some("noreply@ariadline.cz".to_string()));
        assert_eq!(config.ses_from_name, Some("Ariadline".to_string()));

        std::env::remove_var("SES_REGION");
        std::env::remove_var("SES_FROM_EMAIL");
        std::env::remove_var("SES_FROM_NAME");
        std::env::remove_var("JWT_SECRET");
    }

    #[test]
    #[ignore] // requires --test-threads=1 due to env var race
    fn test_config_ses_region_none_when_not_set() {
        std::env::remove_var("SES_REGION");
        std::env::set_var("DATABASE_URL", "postgres://test");
        std::env::set_var("JWT_SECRET", "test-secret-that-is-at-least-32-bytes-long!!");

        let config = Config::from_env().unwrap();
        assert!(config.ses_region.is_none());
        assert!(config.ses_from_email.is_none());
        assert!(config.ses_from_name.is_none());
        assert!(config.ses_configuration_set.is_none());

        std::env::remove_var("JWT_SECRET");
    }

    #[test]
    fn test_config_ses_configuration_set_some_when_set() {
        std::env::set_var("SES_CONFIGURATION_SET", "sazinka-tracking");
        std::env::set_var("DATABASE_URL", "postgres://test");
        std::env::set_var("JWT_SECRET", "test-secret-that-is-at-least-32-bytes-long!!");

        let config = Config::from_env().unwrap();
        assert_eq!(config.ses_configuration_set, Some("sazinka-tracking".to_string()));

        std::env::remove_var("SES_CONFIGURATION_SET");
        std::env::remove_var("JWT_SECRET");
    }
}
