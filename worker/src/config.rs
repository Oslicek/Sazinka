//! Configuration management

use anyhow::{Context, Result};

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

        Ok(Self {
            nats_url,
            database_url,
            nominatim_url,
            valhalla_url,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
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
}
