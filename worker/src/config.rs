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

        Ok(Self {
            nats_url,
            database_url,
            nominatim_url,
        })
    }
}
