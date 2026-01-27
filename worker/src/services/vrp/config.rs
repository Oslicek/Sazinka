//! VRP Solver configuration

/// Configuration for the VRP solver
#[derive(Debug, Clone)]
pub struct SolverConfig {
    /// Maximum solving time in seconds
    pub max_time_seconds: u32,
    /// Maximum generations for metaheuristic
    pub max_generations: usize,
}

impl Default for SolverConfig {
    fn default() -> Self {
        Self {
            max_time_seconds: 30,
            max_generations: 3000,
        }
    }
}

impl SolverConfig {
    /// Create config with custom values
    pub fn new(max_time_seconds: u32, max_generations: usize) -> Self {
        Self {
            max_time_seconds,
            max_generations,
        }
    }

    /// Fast configuration for interactive use
    /// - Quick response time (~5 seconds)
    /// - Good enough for most cases
    pub fn fast() -> Self {
        Self {
            max_time_seconds: 5,
            max_generations: 500,
        }
    }

    /// Quality configuration for background processing
    /// - Longer solve time (~60 seconds)
    /// - Better optimization results
    pub fn quality() -> Self {
        Self {
            max_time_seconds: 60,
            max_generations: 10000,
        }
    }

    /// Instant configuration for very fast response
    /// - Minimal solve time (~2 seconds)
    /// - May not find optimal solution
    pub fn instant() -> Self {
        Self {
            max_time_seconds: 2,
            max_generations: 200,
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
    }
}
