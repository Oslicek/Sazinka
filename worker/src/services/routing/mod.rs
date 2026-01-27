//! Routing service for distance/time matrix calculations
//!
//! Uses Valhalla for production, mock for tests.

mod valhalla;

pub use valhalla::{ValhallaClient, ValhallaConfig};

use async_trait::async_trait;
use anyhow::Result;
use crate::types::Coordinates;

/// Distance and time matrices between locations
#[derive(Debug, Clone)]
pub struct DistanceTimeMatrices {
    /// Distance in meters [i][j] from location i to location j
    pub distances: Vec<Vec<u64>>,
    /// Duration in seconds [i][j] from location i to location j
    pub durations: Vec<Vec<u64>>,
    /// Number of locations
    pub size: usize,
}

impl DistanceTimeMatrices {
    /// Create empty matrices
    pub fn empty() -> Self {
        Self {
            distances: vec![],
            durations: vec![],
            size: 0,
        }
    }

    /// Get distance from location i to location j in meters
    pub fn distance(&self, from: usize, to: usize) -> u64 {
        self.distances[from][to]
    }

    /// Get duration from location i to location j in seconds
    pub fn duration(&self, from: usize, to: usize) -> u64 {
        self.durations[from][to]
    }
}

/// Routing service trait for abstraction (Valhalla, mock, etc.)
#[async_trait]
pub trait RoutingService: Send + Sync {
    /// Get distance and time matrices for a list of locations
    /// First location is typically the depot (starting point)
    async fn get_matrices(&self, locations: &[Coordinates]) -> Result<DistanceTimeMatrices>;
    
    /// Get service name for logging
    fn name(&self) -> &str;
}

/// Mock routing service for tests
/// Uses Haversine distance × coefficient for estimation
pub struct MockRoutingService {
    /// Coefficient for converting straight-line to road distance (default: 1.3)
    road_coefficient: f64,
    /// Average speed in km/h for time estimation (default: 40)
    average_speed_kmh: f64,
}

impl Default for MockRoutingService {
    fn default() -> Self {
        Self {
            road_coefficient: 1.3,
            average_speed_kmh: 40.0,
        }
    }
}

impl MockRoutingService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_params(road_coefficient: f64, average_speed_kmh: f64) -> Self {
        Self {
            road_coefficient,
            average_speed_kmh,
        }
    }
}

#[async_trait]
impl RoutingService for MockRoutingService {
    async fn get_matrices(&self, locations: &[Coordinates]) -> Result<DistanceTimeMatrices> {
        use crate::services::geo::haversine_distance;

        let n = locations.len();
        if n == 0 {
            return Ok(DistanceTimeMatrices::empty());
        }

        let mut distances = vec![vec![0u64; n]; n];
        let mut durations = vec![vec![0u64; n]; n];

        for i in 0..n {
            for j in 0..n {
                if i != j {
                    // Haversine distance in km
                    let straight_line_km = haversine_distance(&locations[i], &locations[j]);
                    // Estimated road distance in meters
                    let road_distance_m = (straight_line_km * self.road_coefficient * 1000.0) as u64;
                    // Travel time in seconds
                    let travel_time_s = ((straight_line_km * self.road_coefficient) 
                        / self.average_speed_kmh * 3600.0) as u64;
                    
                    distances[i][j] = road_distance_m;
                    durations[i][j] = travel_time_s;
                }
            }
        }

        Ok(DistanceTimeMatrices {
            distances,
            durations,
            size: n,
        })
    }

    fn name(&self) -> &str {
        "MockRouting"
    }
}

/// Create routing service based on configuration
pub fn create_routing_service(config: Option<ValhallaConfig>) -> Box<dyn RoutingService> {
    match config {
        Some(cfg) => Box::new(ValhallaClient::new(cfg)),
        None => Box::new(MockRoutingService::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prague() -> Coordinates {
        Coordinates { lat: 50.0755, lng: 14.4378 }
    }

    fn brno() -> Coordinates {
        Coordinates { lat: 49.1951, lng: 16.6068 }
    }

    fn ostrava() -> Coordinates {
        Coordinates { lat: 49.8209, lng: 18.2625 }
    }

    #[tokio::test]
    async fn test_mock_routing_empty_locations() {
        let service = MockRoutingService::new();
        let matrices = service.get_matrices(&[]).await.unwrap();
        
        assert_eq!(matrices.size, 0);
        assert!(matrices.distances.is_empty());
        assert!(matrices.durations.is_empty());
    }

    #[tokio::test]
    async fn test_mock_routing_single_location() {
        let service = MockRoutingService::new();
        let matrices = service.get_matrices(&[prague()]).await.unwrap();
        
        assert_eq!(matrices.size, 1);
        assert_eq!(matrices.distances.len(), 1);
        assert_eq!(matrices.distance(0, 0), 0);
        assert_eq!(matrices.duration(0, 0), 0);
    }

    #[tokio::test]
    async fn test_mock_routing_two_locations() {
        let service = MockRoutingService::new();
        let matrices = service.get_matrices(&[prague(), brno()]).await.unwrap();
        
        assert_eq!(matrices.size, 2);
        
        // Diagonal should be zero
        assert_eq!(matrices.distance(0, 0), 0);
        assert_eq!(matrices.distance(1, 1), 0);
        
        // Prague to Brno is ~185 km straight line, ~240 km road
        let distance_km = matrices.distance(0, 1) as f64 / 1000.0;
        assert!(distance_km > 200.0 && distance_km < 280.0, 
            "Expected ~240 km, got {} km", distance_km);
        
        // Should be symmetric
        assert_eq!(matrices.distance(0, 1), matrices.distance(1, 0));
        assert_eq!(matrices.duration(0, 1), matrices.duration(1, 0));
    }

    #[tokio::test]
    async fn test_mock_routing_travel_time_reasonable() {
        let service = MockRoutingService::new();
        let matrices = service.get_matrices(&[prague(), brno()]).await.unwrap();
        
        // ~240 km at 40 km/h = ~6 hours = ~21600 seconds
        let duration_hours = matrices.duration(0, 1) as f64 / 3600.0;
        assert!(duration_hours > 5.0 && duration_hours < 8.0,
            "Expected ~6 hours, got {} hours", duration_hours);
    }

    #[tokio::test]
    async fn test_mock_routing_three_locations_matrix() {
        let service = MockRoutingService::new();
        let locations = vec![prague(), brno(), ostrava()];
        let matrices = service.get_matrices(&locations).await.unwrap();
        
        assert_eq!(matrices.size, 3);
        assert_eq!(matrices.distances.len(), 3);
        assert_eq!(matrices.distances[0].len(), 3);
        
        // All diagonal elements should be zero
        for i in 0..3 {
            assert_eq!(matrices.distance(i, i), 0);
            assert_eq!(matrices.duration(i, i), 0);
        }
        
        // All off-diagonal elements should be positive
        for i in 0..3 {
            for j in 0..3 {
                if i != j {
                    assert!(matrices.distance(i, j) > 0);
                    assert!(matrices.duration(i, j) > 0);
                }
            }
        }
    }

    #[tokio::test]
    async fn test_mock_routing_custom_params() {
        let service = MockRoutingService::with_params(1.5, 60.0);
        let matrices = service.get_matrices(&[prague(), brno()]).await.unwrap();
        
        // With higher coefficient (1.5) and faster speed (60 km/h)
        // Distance should be larger, time should be similar or slightly less
        let distance_km = matrices.distance(0, 1) as f64 / 1000.0;
        assert!(distance_km > 250.0 && distance_km < 320.0,
            "Expected ~280 km with 1.5 coefficient, got {} km", distance_km);
    }

    #[test]
    fn test_routing_service_name() {
        let mock = MockRoutingService::new();
        assert_eq!(mock.name(), "MockRouting");
    }
}
