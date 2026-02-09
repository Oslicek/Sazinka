//! VRP Solver configuration

/// Configuration for the VRP solver
#[derive(Debug, Clone)]
pub struct SolverConfig {
    /// Maximum solving time in seconds
    pub max_time_seconds: u32,
    /// Maximum generations for metaheuristic
    pub max_generations: usize,
    /// Arrival buffer as percentage of preceding segment duration (0-100)
    /// e.g. 10.0 means arrive 10% of segment duration before window start
    pub arrival_buffer_percent: f64,
}

impl Default for SolverConfig {
    fn default() -> Self {
        Self {
            max_time_seconds: 30,
            max_generations: 3000,
            arrival_buffer_percent: 10.0,
        }
    }
}

impl SolverConfig {
    /// Create config with custom values
    pub fn new(max_time_seconds: u32, max_generations: usize) -> Self {
        Self {
            max_time_seconds,
            max_generations,
            arrival_buffer_percent: 10.0,
        }
    }

    /// Create config with all values including buffer
    pub fn with_buffer(max_time_seconds: u32, max_generations: usize, arrival_buffer_percent: f64) -> Self {
        Self {
            max_time_seconds,
            max_generations,
            arrival_buffer_percent,
        }
    }

    /// Fast configuration for interactive use
    /// - Quick response time (~5 seconds)
    /// - Good enough for most cases
    pub fn fast() -> Self {
        Self {
            max_time_seconds: 5,
            max_generations: 500,
            arrival_buffer_percent: 10.0,
        }
    }

    /// Quality configuration for background processing
    /// - Longer solve time (~60 seconds)
    /// - Better optimization results
    pub fn quality() -> Self {
        Self {
            max_time_seconds: 60,
            max_generations: 10000,
            arrival_buffer_percent: 10.0,
        }
    }

    /// Instant configuration for very fast response
    /// - Minimal solve time (~2 seconds)
    /// - May not find optimal solution
    pub fn instant() -> Self {
        Self {
            max_time_seconds: 2,
            max_generations: 200,
            arrival_buffer_percent: 10.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = SolverConfig::default();
        assert_eq!(config.max_time_seconds, 30);
        assert_eq!(config.max_generations, 3000);
    }

    #[test]
    fn test_fast_config() {
        let config = SolverConfig::fast();
        assert_eq!(config.max_time_seconds, 5);
        assert!(config.max_generations < SolverConfig::default().max_generations);
    }

    #[test]
    fn test_quality_config() {
        let config = SolverConfig::quality();
        assert_eq!(config.max_time_seconds, 60);
        assert!(config.max_generations > SolverConfig::default().max_generations);
    }

    #[test]
    fn test_instant_config() {
        let config = SolverConfig::instant();
        assert!(config.max_time_seconds < SolverConfig::fast().max_time_seconds);
    }

    #[test]
    fn test_custom_config() {
        let config = SolverConfig::new(10, 1000);
        assert_eq!(config.max_time_seconds, 10);
        assert_eq!(config.max_generations, 1000);
        assert!((config.arrival_buffer_percent - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_default_config_has_buffer() {
        let config = SolverConfig::default();
        assert!((config.arrival_buffer_percent - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_with_buffer_config() {
        let config = SolverConfig::with_buffer(10, 1000, 15.0);
        assert_eq!(config.max_time_seconds, 10);
        assert_eq!(config.max_generations, 1000);
        assert!((config.arrival_buffer_percent - 15.0).abs() < f64::EPSILON);
    }
}
