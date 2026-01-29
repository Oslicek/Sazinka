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

        // For now, return empty logs - in a real implementation,
        // you would read from a log file or log aggregation service
        let request_id = extract_request_id(&msg.payload);
        let response = SuccessResponse::new(request_id, LogsResponse {
            logs: vec![
                LogEntry {
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    level: "info".to_string(),
                    message: "Admin logs endpoint called".to_string(),
                    target: Some("sazinka_worker::handlers::admin".to_string()),
                },
            ],
        });

        let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
    }

    Ok(())
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
