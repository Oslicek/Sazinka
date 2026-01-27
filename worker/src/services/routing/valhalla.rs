//! Valhalla routing engine client
//!
//! Valhalla API documentation:
//! https://valhalla.github.io/valhalla/api/matrix/api-reference/

use async_trait::async_trait;
use anyhow::{Result, Context};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{debug, warn};

use crate::types::Coordinates;
use super::{RoutingService, DistanceTimeMatrices};

/// Valhalla client configuration
#[derive(Debug, Clone)]
pub struct ValhallaConfig {
    /// Base URL of Valhalla server (e.g., "http://localhost:8002")
    pub base_url: String,
    /// Request timeout in seconds
    pub timeout_seconds: u64,
}

impl Default for ValhallaConfig {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:8002".to_string(),
            timeout_seconds: 30,
        }
    }
}

impl ValhallaConfig {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            ..Default::default()
        }
    }
}

/// Valhalla routing client
pub struct ValhallaClient {
    client: Client,
    config: ValhallaConfig,
}

impl ValhallaClient {
    pub fn new(config: ValhallaConfig) -> Self {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(config.timeout_seconds))
            .build()
            .expect("Failed to create HTTP client");

        Self { client, config }
    }

    /// Build the sources_to_targets request
    fn build_matrix_request(&self, locations: &[Coordinates]) -> MatrixRequest {
        let locs: Vec<ValhallaLocation> = locations
            .iter()
            .map(|c| ValhallaLocation { lat: c.lat, lon: c.lng })
            .collect();

        MatrixRequest {
            sources: locs.clone(),
            targets: locs,
            costing: "auto".to_string(),
            units: "kilometers".to_string(),
        }
    }
}

#[async_trait]
impl RoutingService for ValhallaClient {
    async fn get_matrices(&self, locations: &[Coordinates]) -> Result<DistanceTimeMatrices> {
        let n = locations.len();
        
        if n == 0 {
            return Ok(DistanceTimeMatrices::empty());
        }

        if n == 1 {
            return Ok(DistanceTimeMatrices {
                distances: vec![vec![0]],
                durations: vec![vec![0]],
                size: 1,
            });
        }

        let request = self.build_matrix_request(locations);
        let url = format!("{}/sources_to_targets", self.config.base_url);

        debug!("Requesting distance matrix from Valhalla for {} locations", n);

        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .context("Failed to send request to Valhalla")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Valhalla returned error {}: {}", status, body);
        }

        let matrix_response: MatrixResponse = response
            .json()
            .await
            .context("Failed to parse Valhalla response")?;

        // Convert response to our format
        let mut distances = vec![vec![0u64; n]; n];
        let mut durations = vec![vec![0u64; n]; n];

        for (i, row) in matrix_response.sources_to_targets.iter().enumerate() {
            for (j, cell) in row.iter().enumerate() {
                // Convert km to meters
                distances[i][j] = cell.distance
                    .map(|d| (d * 1000.0) as u64)
                    .unwrap_or_else(|| {
                        warn!("No distance for route {} -> {}", i, j);
                        u64::MAX / 2  // Very large but won't overflow
                    });
                
                // Time is already in seconds
                durations[i][j] = cell.time
                    .map(|t| t as u64)
                    .unwrap_or_else(|| {
                        warn!("No duration for route {} -> {}", i, j);
                        u64::MAX / 2
                    });
            }
        }

        debug!("Received distance matrix from Valhalla: {}x{}", n, n);

        Ok(DistanceTimeMatrices {
            distances,
            durations,
            size: n,
        })
    }

    fn name(&self) -> &str {
        "Valhalla"
    }
}

// Valhalla API types

#[derive(Debug, Serialize)]
struct MatrixRequest {
    sources: Vec<ValhallaLocation>,
    targets: Vec<ValhallaLocation>,
    costing: String,
    units: String,
}

#[derive(Debug, Serialize, Clone)]
struct ValhallaLocation {
    lat: f64,
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct MatrixResponse {
    sources_to_targets: Vec<Vec<MatrixCell>>,
}

#[derive(Debug, Deserialize)]
struct MatrixCell {
    /// Distance in kilometers (when units="kilometers")
    distance: Option<f64>,
    /// Time in seconds
    time: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valhalla_config_default() {
        let config = ValhallaConfig::default();
        assert_eq!(config.base_url, "http://localhost:8002");
        assert_eq!(config.timeout_seconds, 30);
    }

    #[test]
    fn test_valhalla_config_custom() {
        let config = ValhallaConfig::new("http://valhalla:8002");
        assert_eq!(config.base_url, "http://valhalla:8002");
    }

    #[test]
    fn test_build_matrix_request() {
        let config = ValhallaConfig::default();
        let client = ValhallaClient::new(config);
        
        let locations = vec![
            Coordinates { lat: 50.0755, lng: 14.4378 },
            Coordinates { lat: 49.1951, lng: 16.6068 },
        ];
        
        let request = client.build_matrix_request(&locations);
        
        assert_eq!(request.sources.len(), 2);
        assert_eq!(request.targets.len(), 2);
        assert_eq!(request.costing, "auto");
        assert_eq!(request.units, "kilometers");
        
        // Check coordinates are correct
        assert!((request.sources[0].lat - 50.0755).abs() < 0.0001);
        assert!((request.sources[0].lon - 14.4378).abs() < 0.0001);
    }

    #[test]
    fn test_valhalla_client_name() {
        let config = ValhallaConfig::default();
        let client = ValhallaClient::new(config);
        assert_eq!(client.name(), "Valhalla");
    }

    // Integration tests with real Valhalla would go here
    // They should be marked with #[ignore] and run manually
    // when Valhalla is available
    
    #[tokio::test]
    #[ignore = "Requires running Valhalla server"]
    async fn test_valhalla_integration_prague_brno() {
        let config = ValhallaConfig::new("http://localhost:8002");
        let client = ValhallaClient::new(config);
        
        let locations = vec![
            Coordinates { lat: 50.0755, lng: 14.4378 }, // Prague
            Coordinates { lat: 49.1951, lng: 16.6068 }, // Brno
        ];
        
        let matrices = client.get_matrices(&locations).await.unwrap();
        
        assert_eq!(matrices.size, 2);
        
        // Prague to Brno is ~205 km by road
        let distance_km = matrices.distance(0, 1) as f64 / 1000.0;
        assert!(distance_km > 190.0 && distance_km < 230.0,
            "Expected ~205 km, got {} km", distance_km);
        
        // Travel time should be ~2 hours = ~7200 seconds
        let duration_hours = matrices.duration(0, 1) as f64 / 3600.0;
        assert!(duration_hours > 1.5 && duration_hours < 3.0,
            "Expected ~2 hours, got {} hours", duration_hours);
    }
}
