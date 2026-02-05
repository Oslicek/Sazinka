//! Ping handler for health checks

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tracing::{debug, error};

#[derive(Debug, Serialize, Deserialize)]
struct PingRequest {
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    timestamp: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PongResponse {
    message: String,
    timestamp: String,
}

/// Handle ping messages
pub async fn handle_ping(client: Client, mut subscriber: Subscriber) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received ping message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                error!("Ping message without reply subject");
                continue;
            }
        };

        // Parse request
        let request: PingRequest = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse ping request: {}", e);
                let error_response = serde_json::json!({
                    "error": {
                        "code": "INVALID_REQUEST",
                        "message": format!("Failed to parse request: {}", e)
                    }
                });
                let _ = client.publish(reply, error_response.to_string().into()).await;
                continue;
            }
        };

        // Create response
        let response = PongResponse {
            message: request.message.map(|m| format!("Pong: {}", m)).unwrap_or_else(|| "Pong".to_string()),
            timestamp: chrono::Utc::now().to_rfc3339(),
        };

        // Send reply
        let response_bytes = serde_json::to_vec(&response)?;
        client.publish(reply, response_bytes.into()).await?;
        
        debug!("Sent pong response");
    }

    Ok(())
}
