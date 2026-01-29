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

    // ==========================================================================
    // RateLimitedNominatimGeocoder Tests
    // ==========================================================================

    #[test]
    fn rate_limited_nominatim_geocoder_has_correct_name() {
        let geocoder = RateLimitedNominatimGeocoder::new();
        assert_eq!(geocoder.name(), "nominatim");
    }

    #[test]
    fn rate_limited_nominatim_geocoder_can_be_created_with_custom_config() {
        let geocoder = RateLimitedNominatimGeocoder::with_config(
            "https://custom.nominatim.org",
            std::time::Duration::from_millis(2000),
            5,
            std::time::Duration::from_secs(600),
        );
        assert_eq!(geocoder.name(), "nominatim");
    }

    #[tokio::test]
    async fn rate_limited_nominatim_geocoder_rejects_when_circuit_breaker_open() {
        let geocoder = RateLimitedNominatimGeocoder::with_config(
            "https://nominatim.openstreetmap.org",
            std::time::Duration::from_millis(100),
            1, // Open after 1 failure
            std::time::Duration::from_secs(300),
        );
        
        // Manually trigger circuit breaker by recording failures
        geocoder.circuit_breaker.record_failure();
        
        // Now it should be open
        assert!(geocoder.circuit_breaker.is_open());
        
        // Request should be rejected
        let result = geocoder.geocode("Test", "Praha", "11000").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("circuit breaker"));
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
    /// Coordinates are guaranteed to be within Czech Republic with safety margin
    fn hash_to_coordinates(street: &str, city: &str, postal_code: &str) -> Coordinates {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        street.hash(&mut hasher);
        city.hash(&mut hasher);
        postal_code.hash(&mut hasher);
        let hash = hasher.finish();
        
        // Czech Republic INNER bounds with safety margin (away from borders)
        // Full CZ bounds: lat 48.5-51.1, lng 12.0-18.9
        // We use tighter bounds to ensure coordinates are in populated areas with roads
        const LAT_MIN: f64 = 49.0;  // North of Austrian border
        const LAT_MAX: f64 = 50.5;  // South of Polish border
        const LNG_MIN: f64 = 13.0;  // East of German border  
        const LNG_MAX: f64 = 17.5;  // West of Polish/Slovak border
        
        let lat_range = LAT_MAX - LAT_MIN;
        let lng_range = LNG_MAX - LNG_MIN;
        
        // Use different parts of the hash for lat and lng
        let lat_normalized = ((hash >> 32) as f64) / (u32::MAX as f64);
        let lng_normalized = ((hash & 0xFFFFFFFF) as f64) / (u32::MAX as f64);
        
        Coordinates {
            lat: LAT_MIN + (lat_normalized * lat_range),
            lng: LNG_MIN + (lng_normalized * lng_range),
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
// RateLimitedNominatimGeocoder Implementation
// ==========================================================================

use crate::services::nominatim::NominatimClient;

/// Default rate limit interval (1.5 seconds - Nominatim allows 1 req/s)
const DEFAULT_RATE_LIMIT_MS: u64 = 1500;

/// Default circuit breaker threshold (3 failures)
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD: u32 = 3;

/// Default circuit breaker recovery time (5 minutes)
const DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECS: u64 = 300;

/// Rate-limited Nominatim geocoder with circuit breaker protection
/// 
/// This geocoder wraps the NominatimClient with:
/// - Rate limiting: enforces minimum interval between requests
/// - Circuit breaker: stops requests after repeated failures
pub struct RateLimitedNominatimGeocoder {
    client: NominatimClient,
    rate_limiter: RateLimiter,
    /// Circuit breaker - pub(crate) for testing
    pub(crate) circuit_breaker: CircuitBreaker,
}

impl RateLimitedNominatimGeocoder {
    /// Create a new rate-limited Nominatim geocoder with default settings
    pub fn new() -> Self {
        Self::with_config(
            "https://nominatim.openstreetmap.org",
            Duration::from_millis(DEFAULT_RATE_LIMIT_MS),
            DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
            Duration::from_secs(DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECS),
        )
    }
    
    /// Create with custom configuration
    pub fn with_config(
        base_url: &str,
        rate_limit_interval: Duration,
        circuit_breaker_threshold: u32,
        circuit_breaker_recovery: Duration,
    ) -> Self {
        Self {
            client: NominatimClient::new(base_url),
            rate_limiter: RateLimiter::new(rate_limit_interval),
            circuit_breaker: CircuitBreaker::new(circuit_breaker_threshold, circuit_breaker_recovery),
        }
    }
    
    /// Create from environment variables
    pub fn from_env() -> Self {
        let base_url = std::env::var("NOMINATIM_BASE_URL")
            .unwrap_or_else(|_| "https://nominatim.openstreetmap.org".to_string());
        
        let rate_limit_ms = std::env::var("NOMINATIM_RATE_LIMIT_MS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_RATE_LIMIT_MS);
        
        let cb_threshold = std::env::var("NOMINATIM_CB_THRESHOLD")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_CIRCUIT_BREAKER_THRESHOLD);
        
        let cb_recovery_secs = std::env::var("NOMINATIM_CB_RECOVERY_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(DEFAULT_CIRCUIT_BREAKER_RECOVERY_SECS);
        
        Self::with_config(
            &base_url,
            Duration::from_millis(rate_limit_ms),
            cb_threshold,
            Duration::from_secs(cb_recovery_secs),
        )
    }
}

impl Default for RateLimitedNominatimGeocoder {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Geocoder for RateLimitedNominatimGeocoder {
    async fn geocode(&self, street: &str, city: &str, postal_code: &str) -> Result<Option<GeocodingResult>> {
        // Check circuit breaker first
        if self.circuit_breaker.is_open() {
            tracing::warn!("Circuit breaker is open, rejecting geocoding request");
            return Err(anyhow::anyhow!("Geocoding service temporarily unavailable (circuit breaker open)"));
        }
        
        // Wait for rate limiter
        self.rate_limiter.wait().await;
        
        // Make the actual request
        match self.client.geocode(street, city, postal_code).await {
            Ok(Some(coords)) => {
                self.circuit_breaker.record_success();
                Ok(Some(GeocodingResult {
                    coordinates: coords,
                    confidence: 0.8, // Nominatim doesn't provide confidence, use default
                    display_name: format!("{}, {}, {}, Czech Republic", street, postal_code, city),
                }))
            }
            Ok(None) => {
                // No result found is not a failure
                self.circuit_breaker.record_success();
                Ok(None)
            }
            Err(e) => {
                self.circuit_breaker.record_failure();
                tracing::error!("Geocoding failed: {}", e);
                Err(e)
            }
        }
    }
    
    fn name(&self) -> &'static str {
        "nominatim"
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
/// 
/// # Environment Variables
/// 
/// - `GEOCODER_BACKEND`: "mock" or "nominatim" (default: "mock")
/// - `NOMINATIM_BASE_URL`: Nominatim API URL (default: public OSM)
/// - `NOMINATIM_RATE_LIMIT_MS`: Minimum interval between requests (default: 1500)
/// - `NOMINATIM_CB_THRESHOLD`: Circuit breaker failure threshold (default: 3)
/// - `NOMINATIM_CB_RECOVERY_SECS`: Circuit breaker recovery time (default: 300)
pub fn create_geocoder() -> Box<dyn Geocoder> {
    let backend = std::env::var("GEOCODER_BACKEND").unwrap_or_else(|_| "mock".to_string());
    
    match backend.as_str() {
        "mock" => {
            tracing::info!("Using MockGeocoder");
            Box::new(MockGeocoder::new())
        }
        "nominatim" => {
            tracing::info!("Using RateLimitedNominatimGeocoder");
            Box::new(RateLimitedNominatimGeocoder::from_env())
        }
        _ => {
            tracing::warn!("Unknown GEOCODER_BACKEND '{}', using mock", backend);
            Box::new(MockGeocoder::new())
        }
    }
}
