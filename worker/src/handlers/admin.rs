//! Admin handlers for system management
//! 
//! Provides endpoints for:
//! - Health checks
//! - Database status and management
//! - Valhalla status
//! - System logs

use anyhow::Result;
use async_nats::Client;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tracing::{info, error, warn};

use crate::types::{Request, SuccessResponse, ErrorResponse};

// ==========================================================================
// Request/Response Types
// ==========================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatusRequest {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatusResponse {
    pub connected: bool,
    pub size_bytes: i64,
    pub size_human: String,
    pub tables: Vec<TableInfo>,
    pub connection_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub rows: i64,
    pub size: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbResetRequest {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbResetResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValhallaStatusRequest {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValhallaStatusResponse {
    pub available: bool,
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsRequest {
    pub limit: Option<i32>,
    pub level: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsResponse {
    pub logs: Vec<LogEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    pub target: Option<String>,
}

// ==========================================================================
// Handlers
// ==========================================================================

/// Start all admin handlers
pub async fn start_admin_handlers(
    client: Client,
    pool: PgPool,
    valhalla_url: Option<String>,
) -> Result<()> {
    info!("Starting admin handlers...");

    // Spawn handlers
    let client1 = client.clone();
    let pool1 = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = handle_db_status(client1, pool1).await {
            error!("DB status handler error: {}", e);
        }
    });

    let client2 = client.clone();
    let pool2 = pool.clone();
    tokio::spawn(async move {
        if let Err(e) = handle_db_reset(client2, pool2).await {
            error!("DB reset handler error: {}", e);
        }
    });

    let client3 = client.clone();
    let valhalla_url_clone = valhalla_url.clone();
    tokio::spawn(async move {
        if let Err(e) = handle_valhalla_status(client3, valhalla_url_clone).await {
            error!("Valhalla status handler error: {}", e);
        }
    });

    let client4 = client.clone();
    tokio::spawn(async move {
        if let Err(e) = handle_logs(client4).await {
            error!("Logs handler error: {}", e);
        }
    });

    info!("Admin handlers started");
    Ok(())
}

/// Handle database status requests
async fn handle_db_status(client: Client, pool: PgPool) -> Result<()> {
    let mut sub = client.subscribe("sazinka.admin.db.status").await?;
    
    while let Some(msg) = sub.next().await {
        let reply = match msg.reply {
            Some(r) => r,
            None => continue,
        };

        let response = match get_db_status(&pool).await {
            Ok(status) => {
                let request_id = extract_request_id(&msg.payload);
                SuccessResponse::new(request_id, status)
            }
            Err(e) => {
                error!("Failed to get DB status: {}", e);
                let request_id = extract_request_id(&msg.payload);
                let error = ErrorResponse::new(request_id, "DB_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

/// Get database status
async fn get_db_status(pool: &PgPool) -> Result<DbStatusResponse> {
    // Check connection
    let connected = sqlx::query("SELECT 1")
        .fetch_one(pool)
        .await
        .is_ok();

    if !connected {
        return Ok(DbStatusResponse {
            connected: false,
            size_bytes: 0,
            size_human: "N/A".to_string(),
            tables: vec![],
            connection_status: "disconnected".to_string(),
        });
    }

    // Get database size
    let size_row: (i64,) = sqlx::query_as(
        "SELECT pg_database_size(current_database())"
    )
    .fetch_one(pool)
    .await
    .unwrap_or((0,));

    let size_bytes = size_row.0;
    let size_human = format_bytes(size_bytes);

    // Get table info
    let tables: Vec<(String, i64, i64)> = sqlx::query_as(
        r#"
        SELECT 
            relname::text as name,
            n_live_tup as rows,
            pg_relation_size(relid) as size
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
        "#
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let table_infos: Vec<TableInfo> = tables
        .into_iter()
        .map(|(name, rows, size)| TableInfo {
            name,
            rows,
            size: format_bytes(size),
        })
        .collect();

    Ok(DbStatusResponse {
        connected: true,
        size_bytes,
        size_human,
        tables: table_infos,
        connection_status: "connected".to_string(),
    })
}

/// Handle database reset requests
async fn handle_db_reset(client: Client, pool: PgPool) -> Result<()> {
    let mut sub = client.subscribe("sazinka.admin.db.reset").await?;
    
    while let Some(msg) = sub.next().await {
        let reply = match msg.reply {
            Some(r) => r,
            None => continue,
        };

        warn!("Database reset requested!");

        let response = match reset_database(&pool).await {
            Ok(_) => {
                info!("Database reset completed successfully");
                let request_id = extract_request_id(&msg.payload);
                SuccessResponse::new(request_id, DbResetResponse {
                    success: true,
                    message: "Database reset successfully".to_string(),
                })
            }
            Err(e) => {
                error!("Failed to reset database: {}", e);
                let request_id = extract_request_id(&msg.payload);
                let error = ErrorResponse::new(request_id, "RESET_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

/// Reset database - truncate all user tables and create default user
async fn reset_database(pool: &PgPool) -> Result<()> {
    // Get list of user tables
    let tables: Vec<(String,)> = sqlx::query_as(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_sqlx_migrations'"
    )
    .fetch_all(pool)
    .await?;

    // Truncate each table
    for (table,) in tables {
        sqlx::query(&format!("TRUNCATE TABLE {} CASCADE", table))
            .execute(pool)
            .await?;
        info!("Truncated table: {}", table);
    }

    // Create a default user so that customers can be imported
    let default_user_id = uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
    sqlx::query(
        r#"
        INSERT INTO users (id, email, password_hash, name, phone, business_name, street, city, postal_code, lat, lng)
        VALUES ($1, 'admin@sazinka.cz', 'not-set', 'Výchozí uživatel', '+420000000000', 'Sazinka s.r.o.', 
                'Václavské náměstí 1', 'Praha', '11000', 50.0755, 14.4378)
        ON CONFLICT (id) DO NOTHING
        "#
    )
    .bind(default_user_id)
    .execute(pool)
    .await?;
    info!("Created default user with id: {}", default_user_id);

    Ok(())
}

/// Handle Valhalla status requests
async fn handle_valhalla_status(client: Client, valhalla_url: Option<String>) -> Result<()> {
    let mut sub = client.subscribe("sazinka.admin.valhalla.status").await?;
    
    while let Some(msg) = sub.next().await {
        let reply = match msg.reply {
            Some(r) => r,
            None => continue,
        };

        let (available, url) = match &valhalla_url {
            Some(url) => {
                // Check if Valhalla is responding
                let http_client = reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(5))
                    .build()
                    .unwrap();
                
                let check = http_client.get(format!("{}/status", url)).send().await;
                (check.is_ok(), url.clone())
            }
            None => (false, "Not configured".to_string()),
        };

        let request_id = extract_request_id(&msg.payload);
        let response = SuccessResponse::new(request_id, ValhallaStatusResponse {
            available,
            url,
        });

        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

/// Handle logs requests
async fn handle_logs(client: Client) -> Result<()> {
    let mut sub = client.subscribe("sazinka.admin.logs").await?;
    
    while let Some(msg) = sub.next().await {
        let reply = match msg.reply {
            Some(r) => r,
            None => continue,
        };

        // Parse request to get limit and level filter
        let request: LogsRequest = serde_json::from_slice(&msg.payload)
            .map(|r: Request<LogsRequest>| r.payload)
            .unwrap_or(LogsRequest { limit: Some(100), level: None });
        
        let limit = request.limit.unwrap_or(100) as usize;
        let level_filter = request.level.as_deref();
        
        // Read logs from all log files in the logs directory
        let logs_dir = std::env::var("LOGS_DIR").unwrap_or_else(|_| "../logs".to_string());
        let logs = read_all_logs(&logs_dir, limit, level_filter);
        
        let request_id = extract_request_id(&msg.payload);
        let response = SuccessResponse::new(request_id, LogsResponse { logs });

        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
}

/// Read logs from all .log files in the specified directory
fn read_all_logs(logs_dir: &str, limit: usize, level_filter: Option<&str>) -> Vec<LogEntry> {
    let mut all_logs: Vec<LogEntry> = Vec::new();
    
    let dir = std::path::Path::new(logs_dir);
    if !dir.exists() {
        return all_logs;
    }
    
    // Read each .log file
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map_or(false, |e| e == "log") {
                let source = path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                
                if let Ok(lines) = read_last_lines(&path, limit * 2) {  // Read more, will filter
                    for line in lines {
                        if let Some(entry) = parse_log_line(&line, &source) {
                            // Apply level filter
                            if let Some(filter) = level_filter {
                                if !matches_level_filter(&entry.level, filter) {
                                    continue;
                                }
                            }
                            all_logs.push(entry);
                        }
                    }
                }
            }
        }
    }
    
    // Sort by timestamp (newest first) and limit
    all_logs.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    all_logs.truncate(limit);
    
    all_logs
}

/// Read last N lines from a file (efficient tail implementation)
fn read_last_lines(path: &std::path::Path, n: usize) -> std::io::Result<Vec<String>> {
    use std::io::{BufRead, BufReader};
    use std::collections::VecDeque;
    
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(file);
    
    let mut last_lines: VecDeque<String> = VecDeque::with_capacity(n);
    
    for line in reader.lines() {
        if let Ok(line) = line {
            if last_lines.len() >= n {
                last_lines.pop_front();
            }
            last_lines.push_back(line);
        }
    }
    
    Ok(last_lines.into_iter().collect())
}

/// Parse a log line into a LogEntry
fn parse_log_line(line: &str, source: &str) -> Option<LogEntry> {
    // Skip empty lines
    if line.trim().is_empty() {
        return None;
    }
    
    // Try to parse tracing-subscriber format: "2026-01-29T15:24:28.384366Z  INFO sazinka_worker: Message"
    // Or NATS format: "[123] 2026/01/29 15:24:28.384 [INF] Message"
    
    let (timestamp, level, message, target) = if line.starts_with('[') {
        // NATS log format: [pid] date time [LEVEL] message
        parse_nats_log_line(line)
    } else {
        // Tracing subscriber format
        parse_tracing_log_line(line)
    };
    
    Some(LogEntry {
        timestamp,
        level,
        message,
        target: Some(target.unwrap_or_else(|| source.to_string())),
    })
}

/// Parse NATS log format
fn parse_nats_log_line(line: &str) -> (String, String, String, Option<String>) {
    // Format: [pid] 2026/01/29 15:24:28.384366 [INF] message
    let timestamp = chrono::Utc::now().to_rfc3339();  // Default
    let mut level = "info".to_string();
    let mut message = line.to_string();
    
    // Extract level from [INF], [WRN], [ERR], [DBG]
    if let Some(level_start) = line.find("] [") {
        if let Some(level_end) = line[level_start + 3..].find(']') {
            let level_str = &line[level_start + 3..level_start + 3 + level_end];
            level = match level_str {
                "INF" => "info",
                "WRN" => "warn",
                "ERR" => "error",
                "DBG" => "debug",
                "TRC" => "trace",
                _ => "info",
            }.to_string();
            
            message = line[level_start + 3 + level_end + 2..].trim().to_string();
        }
    }
    
    (timestamp, level, message, Some("nats".to_string()))
}

/// Parse tracing-subscriber log format
fn parse_tracing_log_line(line: &str) -> (String, String, String, Option<String>) {
    // Format: 2026-01-29T15:24:28.384366Z  INFO sazinka_worker: Starting...
    // Or:     2026-01-29T15:24:28.384366Z  INFO sazinka_worker::handlers: Message
    
    let parts: Vec<&str> = line.splitn(4, ' ').collect();
    
    if parts.len() >= 3 {
        let timestamp = parts[0].to_string();
        let level = parts[1].trim().to_lowercase();
        let rest = if parts.len() >= 4 { parts[3] } else { parts[2] };
        
        // Extract target and message
        let (target, message) = if let Some(colon_pos) = rest.find(": ") {
            (Some(rest[..colon_pos].to_string()), rest[colon_pos + 2..].to_string())
        } else {
            (None, rest.to_string())
        };
        
        return (timestamp, level, message, target);
    }
    
    (chrono::Utc::now().to_rfc3339(), "info".to_string(), line.to_string(), None)
}

/// Check if log level matches filter
fn matches_level_filter(level: &str, filter: &str) -> bool {
    let level_priority = match level.to_lowercase().as_str() {
        "error" => 4,
        "warn" => 3,
        "info" => 2,
        "debug" => 1,
        "trace" => 0,
        _ => 2,
    };
    
    let filter_priority = match filter.to_lowercase().as_str() {
        "error" => 4,
        "warn" => 3,
        "info" => 2,
        "debug" => 1,
        "trace" | "all" => 0,
        _ => 0,
    };
    
    level_priority >= filter_priority
}

// ==========================================================================
// Helpers
// ==========================================================================

fn format_bytes(bytes: i64) -> String {
    const KB: i64 = 1024;
    const MB: i64 = KB * 1024;
    const GB: i64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

fn extract_request_id(payload: &[u8]) -> uuid::Uuid {
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(payload) {
        if let Some(id_str) = v.get("id").and_then(|id| id.as_str()) {
            if let Ok(uuid) = uuid::Uuid::parse_str(id_str) {
                return uuid;
            }
        }
    }
    uuid::Uuid::new_v4()
}
