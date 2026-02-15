//! Cancellation registry for background jobs
//!
//! Provides cooperative cancellation with owner verification (multi-tenant security)
//! and RAII-based automatic cleanup via `JobGuard`.

use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
use once_cell::sync::Lazy;

/// Global cancellation registry singleton
pub static CANCELLATION: Lazy<CancellationRegistry> = Lazy::new(CancellationRegistry::default);

/// Internal entry tracking a job's cancellation token and its owner
struct JobEntry {
    token: CancellationToken,
    owner_id: Uuid,
}

/// RAII guard that automatically removes the job from the registry when dropped.
/// Must be kept alive for the duration of job processing.
pub struct JobGuard {
    job_id: Uuid,
    registry: CancellationRegistry,
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        self.registry.remove(&self.job_id);
    }
}

/// Error type for cancel operations
#[derive(Debug, PartialEq, Eq)]
pub enum CancelError {
    /// Caller is not the owner of this job
    NotOwner,
}

/// Thread-safe registry of active jobs and their cancellation tokens.
/// Designed for minimal lock contention — all operations are O(1) HashMap lookups.
#[derive(Clone, Default)]
pub struct CancellationRegistry {
    jobs: Arc<Mutex<HashMap<Uuid, JobEntry>>>,
}

impl CancellationRegistry {
    /// Register a job with its owner. Returns a `JobGuard` that must be held
    /// in scope during processing. When the guard is dropped, the job is
    /// automatically removed from the registry.
    pub fn register(&self, job_id: Uuid, owner_id: Uuid) -> JobGuard {
        let token = CancellationToken::new();
        self.jobs.lock().insert(job_id, JobEntry {
            token,
            owner_id,
        });
        JobGuard {
            job_id,
            registry: self.clone(),
        }
    }

    /// Cancel a job — ONLY if the caller is the owner.
    ///
    /// Returns:
    /// - `Ok(true)`  — job found and cancelled
    /// - `Ok(false)` — job not found (already finished or not yet processing)
    /// - `Err(NotOwner)` — job exists but belongs to a different user
    pub fn cancel(&self, job_id: &Uuid, caller_id: Uuid) -> Result<bool, CancelError> {
        let jobs = self.jobs.lock();
        match jobs.get(job_id) {
            Some(entry) => {
                if entry.owner_id != caller_id {
                    return Err(CancelError::NotOwner);
                }
                entry.token.cancel();
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Pre-register a cancelled token for a job still in the queue.
    /// When the processor picks up the job and calls `is_cancelled()`,
    /// it will see the token is already cancelled and skip processing.
    pub fn pre_cancel(&self, job_id: Uuid, caller_id: Uuid) {
        let token = CancellationToken::new();
        token.cancel();
        self.jobs.lock().insert(job_id, JobEntry {
            token,
            owner_id: caller_id,
        });
    }

    /// Check if a job has been cancelled. Called inside processing loops.
    /// This is the hot path — single HashMap lookup under Mutex.
    pub fn is_cancelled(&self, job_id: &Uuid) -> bool {
        self.jobs.lock()
            .get(job_id)
            .map_or(false, |e| e.token.is_cancelled())
    }

    /// Remove a finished job from the registry.
    /// Called automatically by `JobGuard::drop`.
    pub fn remove(&self, job_id: &Uuid) {
        self.jobs.lock().remove(job_id);
    }

    /// Check if a job is currently registered (for testing)
    #[cfg(test)]
    fn contains(&self, job_id: &Uuid) -> bool {
        self.jobs.lock().contains_key(job_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: create a fresh registry for each test (avoids global state interference)
    fn new_registry() -> CancellationRegistry {
        CancellationRegistry::default()
    }

    // ── 1.1 ──────────────────────────────────────────────────────────────
    #[test]
    fn test_register_and_is_cancelled_false() {
        let reg = new_registry();
        let job_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();

        let _guard = reg.register(job_id, owner_id);

        // Newly registered job must NOT be cancelled
        assert!(!reg.is_cancelled(&job_id));
    }

    // ── 1.2 ──────────────────────────────────────────────────────────────
    #[test]
    fn test_cancel_own_job() {
        let reg = new_registry();
        let job_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();

        let _guard = reg.register(job_id, owner_id);

        let result = reg.cancel(&job_id, owner_id);
        assert_eq!(result, Ok(true));
        assert!(reg.is_cancelled(&job_id));
    }

    // ── 1.3 ──────────────────────────────────────────────────────────────
    #[test]
    fn test_cancel_not_owner_rejected() {
        let reg = new_registry();
        let job_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();
        let attacker_id = Uuid::new_v4();

        let _guard = reg.register(job_id, owner_id);

        let result = reg.cancel(&job_id, attacker_id);
        assert_eq!(result, Err(CancelError::NotOwner));
        // Job must still be running (not cancelled)
        assert!(!reg.is_cancelled(&job_id));
    }

    // ── 1.4 ──────────────────────────────────────────────────────────────
    #[test]
    fn test_cancel_nonexistent_returns_false() {
        let reg = new_registry();
        let fake_id = Uuid::new_v4();
        let caller_id = Uuid::new_v4();

        let result = reg.cancel(&fake_id, caller_id);
        assert_eq!(result, Ok(false));
    }

    // ── 1.5 ──────────────────────────────────────────────────────────────
    #[test]
    fn test_pre_cancel_is_immediately_cancelled() {
        let reg = new_registry();
        let job_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();

        reg.pre_cancel(job_id, owner_id);

        assert!(reg.is_cancelled(&job_id));
    }

    // ── 1.6 ──────────────────────────────────────────────────────────────
    #[test]
    fn test_guard_drop_removes_from_registry() {
        let reg = new_registry();
        let job_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();

        {
            let _guard = reg.register(job_id, owner_id);
            assert!(reg.contains(&job_id));
        } // _guard dropped here

        assert!(!reg.contains(&job_id));
    }

    // ── 1.7 ──────────────────────────────────────────────────────────────
    #[test]
    fn test_register_returns_guard_not_token() {
        let reg = new_registry();
        let job_id = Uuid::new_v4();
        let owner_id = Uuid::new_v4();

        // register() must return JobGuard, not CancellationToken
        let guard: JobGuard = reg.register(job_id, owner_id);
        assert_eq!(guard.job_id, job_id);
    }
}
