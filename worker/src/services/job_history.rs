#![allow(dead_code)]
//! Job history service
//!
//! Stores recent job completions in memory with file-backed persistence
//! so history survives worker restarts.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use uuid::Uuid;
use chrono::{DateTime, Utc};

const MAX_HISTORY_SIZE: usize = 100;
const HISTORY_FILE: &str = "logs/job-history.json";

/// Job entry in history
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobHistoryEntry {
    pub id: Uuid,
    pub user_id: Uuid,
    pub job_type: String,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: DateTime<Utc>,
    pub duration_ms: u64,
    pub error: Option<String>,
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report: Option<serde_json::Value>,
}

/// Response for listing job history
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobHistoryResponse {
    pub jobs: Vec<JobHistoryEntry>,
    pub total: usize,
}

/// Job history storage backed by an in-memory deque + JSON file on disk.
pub struct JobHistoryService {
    history: Arc<RwLock<VecDeque<JobHistoryEntry>>>,
}

impl JobHistoryService {
    pub fn new() -> Self {
        let mut deque = VecDeque::with_capacity(MAX_HISTORY_SIZE);
        if let Some(loaded) = Self::load_from_disk() {
            for entry in loaded {
                deque.push_back(entry);
            }
            info!("Loaded {} job history entries from disk", deque.len());
        }
        Self {
            history: Arc::new(RwLock::new(deque)),
        }
    }
    
    /// Record a completed job (without report)
    pub fn record_completed(
        &self,
        id: Uuid,
        job_type: &str,
        user_id: Uuid,
        started_at: DateTime<Utc>,
        details: Option<String>,
    ) {
        self.record_completed_with_report(id, job_type, user_id, started_at, details, None);
    }

    /// Record a completed job with an optional import report
    pub fn record_completed_with_report(
        &self,
        id: Uuid,
        job_type: &str,
        user_id: Uuid,
        started_at: DateTime<Utc>,
        details: Option<String>,
        report: Option<serde_json::Value>,
    ) {
        let completed_at = Utc::now();
        let duration_ms = (completed_at - started_at).num_milliseconds() as u64;
        
        let entry = JobHistoryEntry {
            id,
            user_id,
            job_type: job_type.to_string(),
            status: "completed".to_string(),
            started_at,
            completed_at,
            duration_ms,
            error: None,
            details,
            report,
        };
        
        self.add_entry(entry);
    }
    
    /// Record a failed job
    pub fn record_failed(
        &self,
        id: Uuid,
        job_type: &str,
        user_id: Uuid,
        started_at: DateTime<Utc>,
        error: String,
    ) {
        let completed_at = Utc::now();
        let duration_ms = (completed_at - started_at).num_milliseconds() as u64;
        
        let entry = JobHistoryEntry {
            id,
            user_id,
            job_type: job_type.to_string(),
            status: "failed".to_string(),
            started_at,
            completed_at,
            duration_ms,
            error: Some(error),
            details: None,
            report: None,
        };
        
        self.add_entry(entry);
    }
    
    /// Record a cancelled job
    pub fn record_cancelled(
        &self,
        id: Uuid,
        job_type: &str,
        user_id: Uuid,
        started_at: DateTime<Utc>,
    ) {
        let completed_at = Utc::now();
        let duration_ms = (completed_at - started_at).num_milliseconds() as u64;
        
        let entry = JobHistoryEntry {
            id,
            user_id,
            job_type: job_type.to_string(),
            status: "cancelled".to_string(),
            started_at,
            report: None,
            completed_at,
            duration_ms,
            error: None,
            details: None,
        };
        
        self.add_entry(entry);
    }
    
    fn add_entry(&self, entry: JobHistoryEntry) {
        let mut history = self.history.write();
        
        if history.len() >= MAX_HISTORY_SIZE {
            history.pop_back();
        }
        
        history.push_front(entry);
        
        Self::save_to_disk(&history);
    }
    
    /// Get recent job history (all users — for admin use only)
    pub fn get_recent(&self, limit: usize) -> JobHistoryResponse {
        let history = self.history.read();
        let jobs: Vec<JobHistoryEntry> = history
            .iter()
            .take(limit)
            .cloned()
            .collect();
        let total = history.len();
        
        JobHistoryResponse { jobs, total }
    }
    
    /// Get recent job history filtered by user (multi-tenant safe)
    pub fn get_recent_for_user(&self, user_id: Uuid, limit: usize) -> JobHistoryResponse {
        let history = self.history.read();
        let jobs: Vec<JobHistoryEntry> = history
            .iter()
            .filter(|j| j.user_id == user_id)
            .take(limit)
            .cloned()
            .collect();
        let total = jobs.len();
        
        JobHistoryResponse { jobs, total }
    }
    
    /// Get jobs by type
    pub fn get_by_type(&self, job_type: &str, limit: usize) -> JobHistoryResponse {
        let history = self.history.read();
        let jobs: Vec<JobHistoryEntry> = history
            .iter()
            .filter(|j| j.job_type == job_type)
            .take(limit)
            .cloned()
            .collect();
        let total = jobs.len();
        
        JobHistoryResponse { jobs, total }
    }
    
    /// Get jobs by status
    pub fn get_by_status(&self, status: &str, limit: usize) -> JobHistoryResponse {
        let history = self.history.read();
        let jobs: Vec<JobHistoryEntry> = history
            .iter()
            .filter(|j| j.status == status)
            .take(limit)
            .cloned()
            .collect();
        let total = jobs.len();
        
        JobHistoryResponse { jobs, total }
    }
    
    fn load_from_disk() -> Option<Vec<JobHistoryEntry>> {
        let path = Path::new(HISTORY_FILE);
        if !path.exists() {
            return None;
        }
        match std::fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<Vec<JobHistoryEntry>>(&content) {
                Ok(entries) => Some(entries),
                Err(e) => {
                    warn!("Failed to parse job history file: {}", e);
                    None
                }
            },
            Err(e) => {
                warn!("Failed to read job history file: {}", e);
                None
            }
        }
    }
    
    fn save_to_disk(history: &VecDeque<JobHistoryEntry>) {
        let path = Path::new(HISTORY_FILE);
        if let Some(dir) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(dir) {
                warn!("Failed to create job history directory: {}", e);
                return;
            }
        }
        let entries: Vec<&JobHistoryEntry> = history.iter().collect();
        match serde_json::to_string_pretty(&entries) {
            Ok(json) => {
                if let Err(e) = std::fs::write(path, json) {
                    warn!("Failed to write job history file: {}", e);
                }
            }
            Err(e) => warn!("Failed to serialize job history: {}", e),
        }
    }
}

impl Default for JobHistoryService {
    fn default() -> Self {
        Self::new()
    }
}

// Global instance for easy access
lazy_static::lazy_static! {
    pub static ref JOB_HISTORY: JobHistoryService = JobHistoryService::new();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static TEST_COUNTER: AtomicU32 = AtomicU32::new(0);

    fn fresh_service() -> JobHistoryService {
        TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        JobHistoryService {
            history: Arc::new(RwLock::new(VecDeque::with_capacity(MAX_HISTORY_SIZE))),
        }
    }

    #[test]
    fn test_record_completed_job() {
        let service = fresh_service();
        let id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let started_at = Utc::now() - chrono::Duration::seconds(5);
        
        service.record_completed(id, "geocode", user_id, started_at, Some("5 addresses".to_string()));
        
        let history = service.get_recent(10);
        assert_eq!(history.jobs.len(), 1);
        assert_eq!(history.jobs[0].id, id);
        assert_eq!(history.jobs[0].status, "completed");
        assert_eq!(history.jobs[0].user_id, user_id);
    }

    #[test]
    fn test_record_failed_job() {
        let service = fresh_service();
        let id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let started_at = Utc::now();
        
        service.record_failed(id, "geocode", user_id, started_at, "Connection timeout".to_string());
        
        let history = service.get_recent(10);
        assert_eq!(history.jobs.len(), 1);
        assert_eq!(history.jobs[0].status, "failed");
        assert_eq!(history.jobs[0].error, Some("Connection timeout".to_string()));
    }

    #[test]
    fn test_history_limit() {
        let service = fresh_service();
        let user_id = Uuid::new_v4();
        
        for i in 0..150 {
            let id = Uuid::new_v4();
            service.record_completed(id, "test", user_id, Utc::now(), Some(format!("Job {}", i)));
        }
        
        let history = service.get_recent(200);
        assert_eq!(history.jobs.len(), MAX_HISTORY_SIZE);
    }

    #[test]
    fn test_get_by_type() {
        let service = fresh_service();
        let user_id = Uuid::new_v4();
        
        service.record_completed(Uuid::new_v4(), "geocode", user_id, Utc::now(), None);
        service.record_completed(Uuid::new_v4(), "route", user_id, Utc::now(), None);
        service.record_completed(Uuid::new_v4(), "geocode", user_id, Utc::now(), None);
        
        let geocode_jobs = service.get_by_type("geocode", 10);
        assert_eq!(geocode_jobs.jobs.len(), 2);
    }

    #[test]
    fn test_record_cancelled_appears_in_history() {
        let service = fresh_service();
        let id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let started_at = Utc::now() - chrono::Duration::seconds(3);

        service.record_cancelled(id, "import.customer", user_id, started_at);

        let history = service.get_recent(10);
        assert_eq!(history.jobs.len(), 1);
        assert_eq!(history.jobs[0].id, id);
        assert_eq!(history.jobs[0].status, "cancelled");
        assert_eq!(history.jobs[0].user_id, user_id);
        assert_eq!(history.jobs[0].job_type, "import.customer");
        assert!(history.jobs[0].error.is_none());
    }

    #[test]
    fn test_get_recent_for_user_isolates_users() {
        let service = fresh_service();
        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();

        service.record_completed(Uuid::new_v4(), "geocode", user_a, Utc::now(), None);
        service.record_completed(Uuid::new_v4(), "route", user_b, Utc::now(), None);
        service.record_completed(Uuid::new_v4(), "export", user_a, Utc::now(), None);
        service.record_cancelled(Uuid::new_v4(), "import", user_b, Utc::now());

        let history_a = service.get_recent_for_user(user_a, 50);
        assert_eq!(history_a.jobs.len(), 2);
        assert!(history_a.jobs.iter().all(|j| j.user_id == user_a));

        let history_b = service.get_recent_for_user(user_b, 50);
        assert_eq!(history_b.jobs.len(), 2);
        assert!(history_b.jobs.iter().all(|j| j.user_id == user_b));
    }

    #[test]
    fn test_record_completed_with_user_id() {
        let service = fresh_service();
        let id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let started_at = Utc::now();

        service.record_completed(id, "route", user_id, started_at, Some("10 stops".to_string()));

        let history = service.get_recent(10);
        assert_eq!(history.jobs[0].user_id, user_id);
        assert_eq!(history.jobs[0].status, "completed");
    }
}
