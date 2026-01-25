//! Nominatim geocoding client

use anyhow::{Context, Result};
use serde::Deserialize;
use crate::types::Coordinates;

/// Nominatim API response
#[derive(Debug, Deserialize)]
pub struct NominatimResult {
    pub lat: String,
    pub lon: String,
    pub display_name: String,
}

/// Nominatim geocoding client
pub struct NominatimClient {
    base_url: String,
    client: reqwest::Client,
}

impl NominatimClient {
    /// Create a new client
    pub fn new(base_url: &str) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Sazinka/1.0 (https://sazinka.cz)")
            .build()
            .expect("Failed to create HTTP client");

        Self {
            base_url: base_url.to_string(),
            client,
        }
    }

    /// Geocode an address to coordinates
    pub async fn geocode(&self, address: &str, city: &str, postal_code: &str) -> Result<Option<Coordinates>> {
        let full_address = format!("{}, {}, {}, Czech Republic", address, postal_code, city);

        let url = format!(
            "{}/search?q={}&format=json&countrycodes=cz&limit=1",
            self.base_url,
            urlencoding::encode(&full_address)
        );

        let response = self.client
            .get(&url)
            .send()
            .await
            .context("Failed to send geocoding request")?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let results: Vec<NominatimResult> = response
            .json()
            .await
            .context("Failed to parse geocoding response")?;

        if let Some(result) = results.first() {
            let lat: f64 = result.lat.parse().context("Invalid latitude")?;
            let lng: f64 = result.lon.parse().context("Invalid longitude")?;

            Ok(Some(Coordinates { lat, lng }))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests require network access and hit the public Nominatim API
    // They are marked as ignored by default

    #[tokio::test]
    #[ignore]
    async fn test_geocode_prague() {
        let client = NominatimClient::new("https://nominatim.openstreetmap.org");

        let result = client
            .geocode("Václavské náměstí", "Praha", "110 00")
            .await
            .unwrap();

        assert!(result.is_some());
        let coords = result.unwrap();

        // Václavské náměstí is around 50.08°N, 14.43°E
        assert!((coords.lat - 50.08).abs() < 0.1);
        assert!((coords.lng - 14.43).abs() < 0.1);
    }
}
