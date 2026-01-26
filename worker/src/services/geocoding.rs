//! Geocoding abstraction layer with safety features
//!
//! This module provides a safe geocoding architecture that:
//! - Never risks getting blocked by external services
//! - Uses MockGeocoder for tests (deterministic, no network)
//! - Uses RateLimitedGeocoder for production (strict rate limiting)
//!
//! Configuration via GEOCODER_BACKEND env variable:
//! - "mock" → MockGeocoder (tests, development)
//! - "nominatim" → RateLimitedNominatimGeocoder (production)

use anyhow::Result;
use async_trait::async_trait;
use crate::types::Coordinates;

/// Geocoder trait - abstraction for all geocoding implementations
#[async_trait]
pub trait Geocoder: Send + Sync {
    /// Geocode an address to coordinates
    /// Returns None if address cannot be geocoded
    async fn geocode(&self, street: &str, city: &str, postal_code: &str) -> Result<Option<GeocodingResult>>;
    
    /// Get the name of this geocoder implementation
    fn name(&self) -> &'static str;
}

/// Result of geocoding operation
#[derive(Debug, Clone)]
pub struct GeocodingResult {
    /// Latitude and longitude
    pub coordinates: Coordinates,
    /// Confidence score 0.0-1.0
    pub confidence: f64,
    /// Display name returned by geocoder
    pub display_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // MockGeocoder Tests (TDD - these tests define the expected behavior)
    // ==========================================================================

    #[tokio::test]
    async fn mock_geocoder_returns_coordinates_for_any_address() {
        let geocoder = MockGeocoder::new();
        
        let result = geocoder.geocode("Václavské náměstí 1", "Praha", "11000").await;
        
        assert!(result.is_ok());
        let result = result.unwrap();
        assert!(result.is_some(), "MockGeocoder should always return coordinates");
    }

    #[tokio::test]
    async fn mock_geocoder_returns_deterministic_coordinates() {
        let geocoder = MockGeocoder::new();
        
        let result1 = geocoder.geocode("Václavské náměstí 1", "Praha", "11000").await.unwrap().unwrap();
        let result2 = geocoder.geocode("Václavské náměstí 1", "Praha", "11000").await.unwrap().unwrap();
        
        // Same input should produce same output
        assert_eq!(result1.coordinates.lat, result2.coordinates.lat);
        assert_eq!(result1.coordinates.lng, result2.coordinates.lng);
    }

    #[tokio::test]
    async fn mock_geocoder_returns_different_coordinates_for_different_addresses() {
        let geocoder = MockGeocoder::new();
        
        let praha = geocoder.geocode("Václavské náměstí 1", "Praha", "11000").await.unwrap().unwrap();
        let brno = geocoder.geocode("Náměstí Svobody 1", "Brno", "60200").await.unwrap().unwrap();
        
        // Different addresses should produce different coordinates
        assert_ne!(praha.coordinates.lat, brno.coordinates.lat);
        assert_ne!(praha.coordinates.lng, brno.coordinates.lng);
    }

    #[tokio::test]
    async fn mock_geocoder_returns_coordinates_within_czech_republic() {
        let geocoder = MockGeocoder::new();
        
        // Test multiple addresses
        let addresses = vec![
            ("Hlavní 1", "Praha", "11000"),
            ("Náměstí 2", "Brno", "60200"),
            ("Ulice 3", "Ostrava", "70200"),
            ("Cesta 4", "Plzeň", "30100"),
        ];
        
        for (street, city, postal) in addresses {
            let result = geocoder.geocode(street, city, postal).await.unwrap().unwrap();
            
            // Czech Republic bounds: lat 48.5-51.1, lng 12.0-18.9
            assert!(result.coordinates.lat >= 48.5 && result.coordinates.lat <= 51.1,
                "Latitude {} out of Czech bounds for {}, {}", result.coordinates.lat, street, city);
            assert!(result.coordinates.lng >= 12.0 && result.coordinates.lng <= 18.9,
                "Longitude {} out of Czech bounds for {}, {}", result.coordinates.lng, street, city);
        }
    }

    #[tokio::test]
    async fn mock_geocoder_returns_high_confidence() {
        let geocoder = MockGeocoder::new();
        
        let result = geocoder.geocode("Test", "Praha", "11000").await.unwrap().unwrap();
        
        // Mock always returns high confidence (it's fake but certain)
        assert!(result.confidence >= 0.9);
    }

    #[tokio::test]
    async fn mock_geocoder_name_is_mock() {
        let geocoder = MockGeocoder::new();
        assert_eq!(geocoder.name(), "mock");
    }

    // ==========================================================================
    // RateLimiter Tests
    // ==========================================================================

    #[tokio::test]
    async fn rate_limiter_enforces_minimum_interval() {
        let limiter = RateLimiter::new(std::time::Duration::from_millis(100));
        
        let start = std::time::Instant::now();
        
        // First call should be immediate
        limiter.wait().await;
        let after_first = start.elapsed();
        assert!(after_first < std::time::Duration::from_millis(50), "First call should be immediate");
        
        // Second call should wait
        limiter.wait().await;
        let after_second = start.elapsed();
        assert!(after_second >= std::time::Duration::from_millis(100), 
            "Second call should wait at least 100ms, took {:?}", after_second);
    }

    #[tokio::test]
    async fn rate_limiter_allows_call_after_interval() {
        let limiter = RateLimiter::new(std::time::Duration::from_millis(50));
        
        limiter.wait().await;
        
        // Wait longer than interval
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        
        let start = std::time::Instant::now();
        limiter.wait().await;
        let elapsed = start.elapsed();
        
        // Should be immediate since we waited longer than interval
        assert!(elapsed < std::time::Duration::from_millis(20), 
            "Call after interval should be immediate, took {:?}", elapsed);
    }

    // ==========================================================================
    // CircuitBreaker Tests
    // ==========================================================================

    #[test]
    fn circuit_breaker_starts_closed() {
        let breaker = CircuitBreaker::new(3, std::time::Duration::from_secs(60));
        assert!(!breaker.is_open());
    }

    #[test]
    fn circuit_breaker_opens_after_threshold_failures() {
        let breaker = CircuitBreaker::new(3, std::time::Duration::from_secs(60));
        
        breaker.record_failure();
        assert!(!breaker.is_open(), "Should not open after 1 failure");
        
        breaker.record_failure();
        assert!(!breaker.is_open(), "Should not open after 2 failures");
        
        breaker.record_failure();
        assert!(breaker.is_open(), "Should open after 3 failures");
    }

    #[test]
    fn circuit_breaker_resets_on_success() {
        let breaker = CircuitBreaker::new(3, std::time::Duration::from_secs(60));
        
        breaker.record_failure();
        breaker.record_failure();
        breaker.record_success();
        
        // After success, failure count should reset
        breaker.record_failure();
        breaker.record_failure();
        assert!(!breaker.is_open(), "Should not be open, count was reset");
    }

    #[tokio::test]
    async fn circuit_breaker_closes_after_recovery_time() {
        let breaker = CircuitBreaker::new(3, std::time::Duration::from_millis(50));
        
        // Trigger circuit breaker
        breaker.record_failure();
        breaker.record_failure();
        breaker.record_failure();
        assert!(breaker.is_open());
        
        // Wait for recovery
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
        
        // Should be closed now (half-open state, allowing retry)
        assert!(!breaker.is_open(), "Circuit breaker should close after recovery time");
    }

    // ==========================================================================
    // GeocoderFactory Tests
    // ==========================================================================

    #[test]
    fn geocoder_factory_creates_mock_by_default_in_test() {
        let geocoder = create_geocoder_from_env_for_test("mock");
        assert_eq!(geocoder.name(), "mock");
    }
}

// ==========================================================================
// MockGeocoder Implementation
// ==========================================================================

/// Mock geocoder for testing - returns deterministic fake coordinates
pub struct MockGeocoder;

impl MockGeocoder {
    pub fn new() -> Self {
        Self
    }
    
    /// Generate deterministic coordinates from address hash
    fn hash_to_coordinates(street: &str, city: &str, postal_code: &str) -> Coordinates {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        street.hash(&mut hasher);
        city.hash(&mut hasher);
        postal_code.hash(&mut hasher);
        let hash = hasher.finish();
        
        // Czech Republic bounds: lat 48.5-51.1, lng 12.0-18.9
        let lat_range = 51.1 - 48.5;
        let lng_range = 18.9 - 12.0;
        
        // Use different parts of the hash for lat and lng
        let lat_normalized = ((hash >> 32) as f64) / (u32::MAX as f64);
        let lng_normalized = ((hash & 0xFFFFFFFF) as f64) / (u32::MAX as f64);
        
        Coordinates {
            lat: 48.5 + (lat_normalized * lat_range),
            lng: 12.0 + (lng_normalized * lng_range),
        }
    }
}

impl Default for MockGeocoder {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Geocoder for MockGeocoder {
    async fn geocode(&self, street: &str, city: &str, postal_code: &str) -> Result<Option<GeocodingResult>> {
        let coordinates = Self::hash_to_coordinates(street, city, postal_code);
        
        Ok(Some(GeocodingResult {
            coordinates,
            confidence: 0.95, // Mock always has high confidence
            display_name: format!("{}, {}, {}, Czech Republic", street, postal_code, city),
        }))
    }
    
    fn name(&self) -> &'static str {
        "mock"
    }
}

// ==========================================================================
// RateLimiter Implementation
// ==========================================================================

use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::{Duration, Instant};

/// Rate limiter that enforces minimum interval between calls
pub struct RateLimiter {
    last_call: Arc<Mutex<Option<Instant>>>,
    min_interval: Duration,
}

impl RateLimiter {
    pub fn new(min_interval: Duration) -> Self {
        Self {
            last_call: Arc::new(Mutex::new(None)),
            min_interval,
        }
    }
    
    /// Wait until it's safe to make another call
    pub async fn wait(&self) {
        let mut last = self.last_call.lock().await;
        
        if let Some(last_time) = *last {
            let elapsed = last_time.elapsed();
            if elapsed < self.min_interval {
                let wait_time = self.min_interval - elapsed;
                drop(last); // Release lock while sleeping
                tokio::time::sleep(wait_time).await;
                last = self.last_call.lock().await;
            }
        }
        
        *last = Some(Instant::now());
    }
}

// ==========================================================================
// CircuitBreaker Implementation
// ==========================================================================

use std::sync::atomic::{AtomicU32, Ordering};

/// Circuit breaker to prevent hammering a failing service
pub struct CircuitBreaker {
    failure_count: AtomicU32,
    threshold: u32,
    last_failure: Arc<Mutex<Option<Instant>>>,
    recovery_time: Duration,
}

impl CircuitBreaker {
    pub fn new(threshold: u32, recovery_time: Duration) -> Self {
        Self {
            failure_count: AtomicU32::new(0),
            threshold,
            last_failure: Arc::new(Mutex::new(None)),
            recovery_time,
        }
    }
    
    /// Check if circuit is open (blocking calls)
    pub fn is_open(&self) -> bool {
        let count = self.failure_count.load(Ordering::Relaxed);
        if count >= self.threshold {
            // Check if recovery time has passed
            if let Ok(last) = self.last_failure.try_lock() {
                if let Some(last_time) = *last {
                    if last_time.elapsed() >= self.recovery_time {
                        return false; // Allow retry (half-open)
                    }
                }
            }
            return true;
        }
        false
    }
    
    /// Record a failure
    pub fn record_failure(&self) {
        self.failure_count.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut last) = self.last_failure.try_lock() {
            *last = Some(Instant::now());
        }
    }
    
    /// Record a success (resets failure count)
    pub fn record_success(&self) {
        self.failure_count.store(0, Ordering::Relaxed);
    }
}

// ==========================================================================
// Factory function
// ==========================================================================

/// Create geocoder based on backend name (for testing)
#[cfg(test)]
fn create_geocoder_from_env_for_test(backend: &str) -> Box<dyn Geocoder> {
    match backend {
        "mock" => Box::new(MockGeocoder::new()),
        _ => Box::new(MockGeocoder::new()), // Default to mock in tests
    }
}

/// Create geocoder based on GEOCODER_BACKEND environment variable
pub fn create_geocoder() -> Box<dyn Geocoder> {
    let backend = std::env::var("GEOCODER_BACKEND").unwrap_or_else(|_| "mock".to_string());
    
    match backend.as_str() {
        "mock" => Box::new(MockGeocoder::new()),
        "nominatim" => {
            // Will be implemented next - RateLimitedNominatimGeocoder
            tracing::warn!("Nominatim geocoder not yet implemented, falling back to mock");
            Box::new(MockGeocoder::new())
        }
        _ => {
            tracing::warn!("Unknown GEOCODER_BACKEND '{}', using mock", backend);
            Box::new(MockGeocoder::new())
        }
    }
}
