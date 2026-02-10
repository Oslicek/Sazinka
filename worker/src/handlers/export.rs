//! Export handlers for async export jobs.

use std::sync::Arc;

use anyhow::Result;
use async_nats::{Client, Subscriber};
use base64::Engine;
use futures::StreamExt;
use tracing::error;
use uuid::Uuid;

use crate::auth;
use crate::services::export_processor::{
    ExportDownloadRequest, ExportDownloadResponse, ExportProcessor, ExportPlusRequest,
};
use crate::types::{ErrorResponse, Request, SuccessResponse};

/// Handle export submit requests.
pub async fn handle_export_submit(
    client: Client,
    mut subscriber: Subscriber,
    jwt_secret: Arc<String>,
    processor: Arc<ExportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<ExportPlusRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let data_user_id = auth_info.data_user_id();
        match processor.submit_job(data_user_id, request.payload).await {
            Ok(response) => {
                let success = SuccessResponse::new(request.id, response);
                let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            }
            Err(e) => {
                error!("Failed to submit export job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle export download requests.
pub async fn handle_export_download(
    client: Client,
    mut subscriber: Subscriber,
    jwt_secret: Arc<String>,
    processor: Arc<ExportProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<ExportDownloadRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let auth_info = match auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info,
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let data_user_id = auth_info.data_user_id();
        match processor
            .load_export_file(
                data_user_id,
                request.payload.job_id,
                request.payload.user_time_zone_offset_minutes,
            )
            .await
        {
            Ok((filename, bytes)) => {
                let payload = ExportDownloadResponse {
                    filename,
                    content_type: "application/zip".to_string(),
                    file_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
                    size_bytes: bytes.len() as u64,
                };
                let success = SuccessResponse::new(request.id, payload);
                let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            }
            Err(e) => {
                let error = ErrorResponse::new(request.id, "DOWNLOAD_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}
