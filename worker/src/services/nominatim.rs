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

#[derive(Debug, Deserialize)]
pub struct NominatimReverseAddress {
    pub road: Option<String>,
    pub house_number: Option<String>,
    pub city: Option<String>,
    pub town: Option<String>,
    pub village: Option<String>,
    pub postcode: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NominatimReverseResult {
    pub display_name: String,
    pub address: Option<NominatimReverseAddress>,
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

    /// Reverse geocode coordinates to address
    pub async fn reverse_geocode(&self, lat: f64, lng: f64) -> Result<Option<ReverseGeocodeOutput>> {
        let url = format!(
            "{}/reverse?lat={}&lon={}&format=json&addressdetails=1",
            self.base_url,
            lat,
            lng
        );

        let response = self.client
            .get(&url)
            .send()
            .await
            .context("Failed to send reverse geocoding request")?;

        if !response.status().is_success() {
            return Ok(None);
        }

        let result: NominatimReverseResult = response
            .json()
            .await
            .context("Failed to parse reverse geocoding response")?;

        let address = result.address.unwrap_or(NominatimReverseAddress {
            road: None,
            house_number: None,
            city: None,
            town: None,
            village: None,
            postcode: None,
        });

        let city = address.city.or(address.town).or(address.village).unwrap_or_default();
        let street = match (address.road, address.house_number) {
            (Some(road), Some(number)) => format!("{} {}", road, number),
            (Some(road), None) => road,
            _ => String::new(),
        };

        Ok(Some(ReverseGeocodeOutput {
            street,
            city,
            postal_code: address.postcode.unwrap_or_default(),
            display_name: result.display_name,
        }))
    }
}

pub struct ReverseGeocodeOutput {
    pub street: String,
    pub city: String,
    pub postal_code: String,
    pub display_name: String,
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
