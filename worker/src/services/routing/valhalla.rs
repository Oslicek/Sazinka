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
use super::{RoutingService, DistanceTimeMatrices, RouteGeometry};

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
            .map(|c| ValhallaLocation { 
                lat: c.lat, 
                lon: c.lng,
                // 500m radius – sufficient for Nominatim-geocoded coordinates
                // that may be slightly off-road (building centroid vs road edge)
                radius: Some(500),
            })
            .collect();

        MatrixRequest {
            sources: locs.clone(),
            targets: locs,
            costing: "auto".to_string(),
            units: "kilometers".to_string(),
            costing_options: None,
        }
    }

    /// Build the route request for geometry
    pub fn build_route_request(&self, locations: &[Coordinates]) -> RouteRequest {
        let locs: Vec<ValhallaLocation> = locations
            .iter()
            .map(|c| ValhallaLocation { 
                lat: c.lat, 
                lon: c.lng,
                radius: Some(500),
            })
            .collect();

        RouteRequest {
            locations: locs,
            costing: "auto".to_string(),
            directions_type: "none".to_string(), // We only need geometry, not turn-by-turn
            costing_options: None,
        }
    }

    /// Get route geometry as GeoJSON coordinates
    pub async fn get_route_geometry(&self, locations: &[Coordinates]) -> Result<RouteGeometry> {
        if locations.len() < 2 {
            return Ok(RouteGeometry::empty());
        }

        let request = self.build_route_request(locations);
        let url = format!("{}/route", self.config.base_url);

        debug!("Requesting route geometry from Valhalla for {} locations", locations.len());

        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .context("Failed to send route request to Valhalla")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Valhalla route returned error {}: {}", status, body);
        }

        let route_response: RouteResponse = response
            .json()
            .await
            .context("Failed to parse Valhalla route response")?;

        // Extract and concatenate geometry from ALL legs
        let mut all_coordinates: Vec<[f64; 2]> = Vec::new();
        for (i, leg) in route_response.trip.legs.iter().enumerate() {
            let leg_coords = decode_polyline(&leg.shape, 6)?;
            debug!("Leg {} has {} points", i, leg_coords.len());
            
            // Skip the first point of subsequent legs (it's the same as last point of previous leg)
            if i == 0 {
                all_coordinates.extend(leg_coords);
            } else if !leg_coords.is_empty() {
                all_coordinates.extend(leg_coords.into_iter().skip(1));
            }
        }
        
        debug!("Received route geometry with {} total points from {} legs", 
               all_coordinates.len(), route_response.trip.legs.len());

        Ok(RouteGeometry { coordinates: all_coordinates })
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

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}

// Valhalla API types

#[derive(Debug, Serialize)]
struct MatrixRequest {
    sources: Vec<ValhallaLocation>,
    targets: Vec<ValhallaLocation>,
    costing: String,
    units: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    costing_options: Option<CostingOptions>,
}

#[derive(Debug, Serialize)]
struct CostingOptions {
    auto: AutoCostingOptions,
}

#[derive(Debug, Serialize)]
struct AutoCostingOptions {
    /// Search cutoff in meters for snapping to roads
    #[serde(skip_serializing_if = "Option::is_none")]
    search_cutoff: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
struct ValhallaLocation {
    lat: f64,
    lon: f64,
    /// Radius in meters for snapping to roads (default ~35m, we use much larger for mock geocoding)
    #[serde(skip_serializing_if = "Option::is_none")]
    radius: Option<u32>,
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

// Route API types

#[derive(Debug, Serialize)]
pub struct RouteRequest {
    locations: Vec<ValhallaLocation>,
    costing: String,
    directions_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    costing_options: Option<CostingOptions>,
}

#[derive(Debug, Deserialize)]
struct RouteResponse {
    trip: Trip,
}

#[derive(Debug, Deserialize)]
struct Trip {
    legs: Vec<Leg>,
}

#[derive(Debug, Deserialize)]
struct Leg {
    /// Encoded polyline shape
    shape: String,
}

/// Decode Valhalla's encoded polyline format
/// Precision is 6 decimal places for Valhalla (vs 5 for Google)
fn decode_polyline(encoded: &str, precision: u32) -> Result<Vec<[f64; 2]>> {
    let factor = 10_f64.powi(precision as i32);
    let mut coordinates = Vec::new();
    let mut lat = 0i64;
    let mut lng = 0i64;
    
    let bytes = encoded.as_bytes();
    let mut i = 0;
    
    while i < bytes.len() {
        // Decode latitude
        let mut shift = 0;
        let mut result = 0i64;
        loop {
            if i >= bytes.len() {
                anyhow::bail!("Invalid polyline encoding");
            }
            let byte = bytes[i] as i64 - 63;
            i += 1;
            result |= (byte & 0x1f) << shift;
            shift += 5;
            if byte < 0x20 {
                break;
            }
        }
        let dlat = if result & 1 != 0 {
            !(result >> 1)
        } else {
            result >> 1
        };
        lat += dlat;
        
        // Decode longitude
        shift = 0;
        result = 0;
        loop {
            if i >= bytes.len() {
                anyhow::bail!("Invalid polyline encoding");
            }
            let byte = bytes[i] as i64 - 63;
            i += 1;
            result |= (byte & 0x1f) << shift;
            shift += 5;
            if byte < 0x20 {
                break;
            }
        }
        let dlng = if result & 1 != 0 {
            !(result >> 1)
        } else {
            result >> 1
        };
        lng += dlng;
        
        // GeoJSON uses [lng, lat] order
        coordinates.push([lng as f64 / factor, lat as f64 / factor]);
    }
    
    Ok(coordinates)
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

    // Route geometry tests
    
    #[test]
    fn test_build_route_request() {
        let config = ValhallaConfig::default();
        let client = ValhallaClient::new(config);
        
        let locations = vec![
            Coordinates { lat: 50.0755, lng: 14.4378 }, // Prague
            Coordinates { lat: 49.1951, lng: 16.6068 }, // Brno
            Coordinates { lat: 49.8209, lng: 18.2625 }, // Ostrava
        ];
        
        let request = client.build_route_request(&locations);
        
        assert_eq!(request.locations.len(), 3);
        assert_eq!(request.costing, "auto");
        assert_eq!(request.directions_type, "none"); // We only need geometry
        
        // Check coordinates
        assert!((request.locations[0].lat - 50.0755).abs() < 0.0001);
        assert!((request.locations[1].lat - 49.1951).abs() < 0.0001);
        assert!((request.locations[2].lat - 49.8209).abs() < 0.0001);
    }

    #[test]
    fn test_route_geometry_struct() {
        let geometry = RouteGeometry {
            coordinates: vec![
                [14.4378, 50.0755],
                [15.5, 49.5],
                [16.6068, 49.1951],
            ],
        };
        
        assert_eq!(geometry.coordinates.len(), 3);
        // GeoJSON uses [lng, lat] order
        assert!((geometry.coordinates[0][0] - 14.4378).abs() < 0.0001); // lng
        assert!((geometry.coordinates[0][1] - 50.0755).abs() < 0.0001); // lat
    }

    #[test]
    fn test_route_geometry_empty_for_single_location() {
        let geometry = RouteGeometry::empty();
        assert!(geometry.coordinates.is_empty());
    }

    #[tokio::test]
    #[ignore = "Requires running Valhalla server"]
    async fn test_valhalla_route_geometry_prague_brno() {
        let config = ValhallaConfig::new("http://localhost:8002");
        let client = ValhallaClient::new(config);
        
        let locations = vec![
            Coordinates { lat: 50.0755, lng: 14.4378 }, // Prague
            Coordinates { lat: 49.1951, lng: 16.6068 }, // Brno
        ];
        
        let geometry = client.get_route_geometry(&locations).await.unwrap();
        
        // Should have many points along the route
        assert!(geometry.coordinates.len() > 10,
            "Expected many route points, got {}", geometry.coordinates.len());
        
        // First point should be near Prague
        let first = &geometry.coordinates[0];
        assert!((first[0] - 14.4378).abs() < 0.1, "First lng should be near Prague");
        assert!((first[1] - 50.0755).abs() < 0.1, "First lat should be near Prague");
        
        // Last point should be near Brno
        let last = geometry.coordinates.last().unwrap();
        assert!((last[0] - 16.6068).abs() < 0.1, "Last lng should be near Brno");
        assert!((last[1] - 49.1951).abs() < 0.1, "Last lat should be near Brno");
    }
}
