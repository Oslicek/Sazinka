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
}

impl Config {
    /// Load configuration from environment variables
    pub fn from_env() -> Result<Self> {
        // Load .env file if present
        dotenvy::dotenv().ok();

        let nats_url = std::env::var("NATS_URL")
            .unwrap_or_else(|_| "nats://localhost:4222".to_string());

        let database_url = std::env::var("DATABASE_URL")
            .context("DATABASE_URL must be set")?;

        let nominatim_url = std::env::var("NOMINATIM_URL")
            .unwrap_or_else(|_| "https://nominatim.openstreetmap.org".to_string());

        let valhalla_url = std::env::var("VALHALLA_URL").ok();

        let jwt_secret = std::env::var("JWT_SECRET")
            .context("JWT_SECRET must be set — generate one with: openssl rand -base64 48")?;

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

        Ok(Self {
            nats_url,
            database_url,
            nominatim_url,
            valhalla_url,
            jwt_secret,
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
        
        let config = Config::from_env().unwrap();
        assert_eq!(config.valhalla_url, Some("http://localhost:8002".to_string()));
        
        // Cleanup
        std::env::remove_var("VALHALLA_URL");
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
        
        let config = Config::from_env().unwrap();
        assert_eq!(config.nominatim_url, "http://localhost:8080");
        
        // Cleanup
        std::env::remove_var("NOMINATIM_URL");
    }
}
