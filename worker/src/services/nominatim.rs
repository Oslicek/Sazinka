#![allow(dead_code)]
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
            .user_agent("Ariadline/1.0 (https://ariadline.cz)")
            .build()
            .expect("Failed to create HTTP client");

        Self {
            base_url: base_url.to_string(),
            client,
        }
    }

    /// Geocode an address to coordinates
    pub async fn geocode(&self, address: &str, city: &str, postal_code: &str) -> Result<Option<Coordinates>> {
        let pc = postal_code.trim();
        let full_address = if pc.is_empty() {
            format!("{}, {}, Czech Republic", address, city)
        } else {
            format!("{}, {}, {}, Czech Republic", address, pc, city)
        };

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
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    async fn spawn_single_response_server(
        status_line: &str,
        body: &str,
    ) -> (String, oneshot::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = oneshot::channel::<String>();
        let response = format!(
            "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            status_line,
            body.len(),
            body
        );

        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 4096];
            let read = stream.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..read]).to_string();
            let _ = tx.send(req);
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
        });

        (format!("http://{}", addr), rx)
    }

    // Note: These tests require network access and hit the public Nominatim API
    // They are marked as ignored by default

    #[tokio::test]
    async fn geocode_builds_query_without_postal_code() {
        let (base_url, request_rx) = spawn_single_response_server("200 OK", "[]").await;
        let client = NominatimClient::new(&base_url);

        let result = client.geocode("Main 1", "Prague", "   ").await.unwrap();
        assert!(result.is_none());

        let req = request_rx.await.unwrap();
        assert!(req.contains("GET /search?q=Main%201%2C%20Prague%2C%20Czech%20Republic"));
    }

    #[tokio::test]
    async fn geocode_builds_query_with_postal_code() {
        let (base_url, request_rx) = spawn_single_response_server("200 OK", "[]").await;
        let client = NominatimClient::new(&base_url);

        let result = client.geocode("Main 1", "Prague", "11000").await.unwrap();
        assert!(result.is_none());

        let req = request_rx.await.unwrap();
        assert!(req.contains("GET /search?q=Main%201%2C%2011000%2C%20Prague%2C%20Czech%20Republic"));
    }

    #[tokio::test]
    async fn reverse_geocode_assembles_street_and_city_with_fallbacks() {
        let payload = r#"{
            "display_name":"Some Place",
            "address":{
                "road":"Main",
                "house_number":"15",
                "town":"Brno",
                "postcode":"60200"
            }
        }"#;
        let (base_url, _request_rx) = spawn_single_response_server("200 OK", payload).await;
        let client = NominatimClient::new(&base_url);

        let result = client.reverse_geocode(49.2, 16.6).await.unwrap().unwrap();
        assert_eq!(result.street, "Main 15");
        assert_eq!(result.city, "Brno");
        assert_eq!(result.postal_code, "60200");
        assert_eq!(result.display_name, "Some Place");
    }

    #[tokio::test]
    async fn reverse_geocode_handles_missing_road_and_city() {
        let payload = r#"{
            "display_name":"Unknown Place",
            "address":{
                "village":"Lhota"
            }
        }"#;
        let (base_url, _request_rx) = spawn_single_response_server("200 OK", payload).await;
        let client = NominatimClient::new(&base_url);

        let result = client.reverse_geocode(49.0, 15.0).await.unwrap().unwrap();
        assert_eq!(result.street, "");
        assert_eq!(result.city, "Lhota");
        assert_eq!(result.postal_code, "");
    }

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
