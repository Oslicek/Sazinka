
//! Multi-key rate limiter for the onboarding wizard.
//!
//! `MultiRateLimiter` holds multiple independent `RateLimiter` instances, each
//! identified by a string name (e.g. `"register.start"`, `"geocode.depot"`).
//! Every limiter has its own `max_attempts` and `window_secs`, which allows
//! fine-tuned throttling per endpoint.
//!
//! Rate limiting is in-memory and resets on process restart.
//! It is safe to share via `Arc<MultiRateLimiter>` across async tasks.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;

// =============================================================================
// Core RateLimiter
// =============================================================================

/// Configuration for a single rate limiter bucket.
#[derive(Debug, Clone)]
pub struct RateLimiterConfig {
    pub max_attempts: usize,
    pub window_secs: u64,
}

/// In-memory rate limiter — tracks per-key attempt timestamps.
pub struct RateLimiter {
    attempts: Mutex<HashMap<String, Vec<Instant>>>,
    max_attempts: usize,
    window_secs: u64,
}

impl RateLimiter {
    pub fn new(max_attempts: usize, window_secs: u64) -> Self {
        Self {
            attempts: Mutex::new(HashMap::new()),
            max_attempts,
            window_secs,
        }
    }

    /// Check `key` against the limit. Returns `true` if the request is allowed,
    /// `false` if it is rate-limited. Records the attempt on `true`.
    pub fn check_and_record(&self, key: &str) -> bool {
        let mut attempts = self.attempts.lock();
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.window_secs);

        let entry = attempts.entry(key.to_string()).or_default();
        entry.retain(|t| now.duration_since(*t) < window);

        if entry.len() >= self.max_attempts {
            return false;
        }
        entry.push(now);
        true
    }

    /// Remove entries that have expired (call periodically to free memory).
    pub fn cleanup(&self) {
        let mut attempts = self.attempts.lock();
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.window_secs);
        attempts.retain(|_, entries| {
            entries.retain(|t| now.duration_since(*t) < window);
            !entries.is_empty()
        });
    }
}

// =============================================================================
// MultiRateLimiter
// =============================================================================

/// A collection of named `RateLimiter` instances with independent configurations.
pub struct MultiRateLimiter {
    limiters: HashMap<String, Arc<RateLimiter>>,
}

impl MultiRateLimiter {
    /// Build a `MultiRateLimiter` from a list of `(name, config)` pairs.
    pub fn new(configs: Vec<(&str, RateLimiterConfig)>) -> Self {
        let limiters = configs
            .into_iter()
            .map(|(name, cfg)| {
                (
                    name.to_string(),
                    Arc::new(RateLimiter::new(cfg.max_attempts, cfg.window_secs)),
                )
            })
            .collect();
        Self { limiters }
    }

    /// Check `key` against the named limiter.
    /// Returns `true` if allowed, `false` if rate-limited or limiter not found.
    pub fn check_and_record(&self, limiter: &str, key: &str) -> bool {
        match self.limiters.get(limiter) {
            Some(l) => l.check_and_record(key),
            None => {
                tracing::warn!("MultiRateLimiter: unknown limiter '{}'", limiter);
                true // Fail open — don't block if misconfigured
            }
        }
    }

    pub fn cleanup_all(&self) {
        for l in self.limiters.values() {
            l.cleanup();
        }
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limiter_allows_within_limit() {
        let l = RateLimiter::new(3, 60);
        assert!(l.check_and_record("a@b.com"));
        assert!(l.check_and_record("a@b.com"));
        assert!(l.check_and_record("a@b.com"));
    }

    #[test]
    fn rate_limiter_blocks_over_limit() {
        let l = RateLimiter::new(3, 60);
        l.check_and_record("a@b.com");
        l.check_and_record("a@b.com");
        l.check_and_record("a@b.com");
        assert!(!l.check_and_record("a@b.com"));
    }

    #[test]
    fn rate_limiter_keys_are_independent() {
        let l = RateLimiter::new(2, 60);
        l.check_and_record("user1@b.com");
        l.check_and_record("user1@b.com");
        assert!(!l.check_and_record("user1@b.com")); // blocked

        assert!(l.check_and_record("user2@b.com")); // independent
    }

    #[test]
    fn multi_rate_limiter_independent_configs() {
        let m = MultiRateLimiter::new(vec![
            ("register", RateLimiterConfig { max_attempts: 3, window_secs: 60 }),
            ("geocode",  RateLimiterConfig { max_attempts: 5, window_secs: 300 }),
        ]);

        // register allows 3, then blocks
        assert!(m.check_and_record("register", "a@b.com"));
        assert!(m.check_and_record("register", "a@b.com"));
        assert!(m.check_and_record("register", "a@b.com"));
        assert!(!m.check_and_record("register", "a@b.com"));

        // geocode limiter has different quota — still at 0 for this key
        assert!(m.check_and_record("geocode", "a@b.com"));
        assert!(m.check_and_record("geocode", "a@b.com"));
    }

    #[test]
    fn multi_rate_limiter_unknown_limiter_fails_open() {
        let m = MultiRateLimiter::new(vec![]);
        // Unknown limiters should not block requests
        assert!(m.check_and_record("nonexistent", "a@b.com"));
    }
}
