//! Work item message handlers

use anyhow::Result;
use async_nats::{Client, Subscriber};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, warn};
use uuid::Uuid;

use crate::db::queries;
use crate::types::{
    ErrorResponse, Request, SuccessResponse,
};
use crate::types::work_item::{
    CreateWorkItemRequest, CompleteWorkItemRequest,
    ListWorkItemsRequest, ListWorkItemsResponse,
    WorkItemIdRequest, VisitWorkItem,
};

/// Handle work_item.create messages
pub async fn handle_create(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received work_item.create message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CreateWorkItemRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Check user_id
        let _user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        match queries::work_item::create_work_item(&pool, &request.payload).await {
            Ok(item) => {
                let response = SuccessResponse::new(request.id, item);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Created work item: {}", response.payload.id);
            }
            Err(e) => {
                error!("Failed to create work item: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle work_item.list messages
pub async fn handle_list(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received work_item.list message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<ListWorkItemsRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let _user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let payload = &request.payload;
        let items = if let Some(visit_id) = payload.visit_id {
            queries::work_item::list_work_items_for_visit(&pool, visit_id).await
        } else if let Some(revision_id) = payload.revision_id {
            queries::work_item::list_work_items_for_revision(&pool, revision_id).await
        } else {
            // No filter specified - return empty
            Ok(vec![])
        };

        match items {
            Ok(items) => {
                let total = items.len() as i64;
                let response = SuccessResponse::new(request.id, ListWorkItemsResponse { items, total });
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Err(e) => {
                error!("Failed to list work items: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle work_item.get messages
pub async fn handle_get(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received work_item.get message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<WorkItemIdRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let _user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        match queries::work_item::get_work_item(&pool, request.payload.id).await {
            Ok(Some(item)) => {
                let response = SuccessResponse::new(request.id, item);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Work item not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to get work item: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

/// Handle work_item.complete messages
pub async fn handle_complete(
    client: Client,
    mut subscriber: Subscriber,
    pool: PgPool,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        debug!("Received work_item.complete message");

        let reply = match msg.reply {
            Some(ref reply) => reply.clone(),
            None => {
                warn!("Message without reply subject");
                continue;
            }
        };

        let request: Request<CompleteWorkItemRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let _user_id = match request.user_id {
            Some(id) => id,
            None => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "user_id required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        let payload = &request.payload;
        match queries::work_item::complete_work_item(
            &pool,
            payload.id,
            payload.result,
            payload.duration_minutes,
            payload.result_notes.as_deref(),
            payload.findings.as_deref(),
            payload.requires_follow_up.unwrap_or(false),
            payload.follow_up_reason.as_deref(),
        ).await {
            Ok(Some(item)) => {
                let response = SuccessResponse::new(request.id, item);
                let _ = client.publish(reply, serde_json::to_vec(&response)?.into()).await;
                debug!("Completed work item: {}", payload.id);
            }
            Ok(None) => {
                let error = ErrorResponse::new(request.id, "NOT_FOUND", "Work item not found");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
            Err(e) => {
                error!("Failed to complete work item: {}", e);
                let error = ErrorResponse::new(request.id, "DATABASE_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::work_item::{WorkType, WorkResult};

    #[test]
    fn test_create_request_deserialization() {
        let json = r#"{
            "id": "00000000-0000-0000-0000-000000000001",
            "userId": "00000000-0000-0000-0000-000000000002",
            "payload": {
                "visitId": "00000000-0000-0000-0000-000000000003",
                "workType": "revision"
            }
        }"#;

        let req: Request<CreateWorkItemRequest> = serde_json::from_str(json).unwrap();
        assert_eq!(req.payload.work_type, WorkType::Revision);
        assert!(req.payload.device_id.is_none());
    }

    #[test]
    fn test_complete_request_deserialization() {
        let json = r#"{
            "id": "00000000-0000-0000-0000-000000000001",
            "userId": "00000000-0000-0000-0000-000000000002",
            "payload": {
                "id": "00000000-0000-0000-0000-000000000003",
                "result": "successful",
                "durationMinutes": 45,
                "findings": "Bez závad"
            }
        }"#;

        let req: Request<CompleteWorkItemRequest> = serde_json::from_str(json).unwrap();
        assert_eq!(req.payload.result, WorkResult::Successful);
        assert_eq!(req.payload.duration_minutes, Some(45));
    }

    #[test]
    fn test_list_request_with_visit_id() {
        let json = r#"{
            "id": "00000000-0000-0000-0000-000000000001",
            "userId": "00000000-0000-0000-0000-000000000002",
            "payload": {
                "visitId": "00000000-0000-0000-0000-000000000003"
            }
        }"#;

        let req: Request<ListWorkItemsRequest> = serde_json::from_str(json).unwrap();
        assert!(req.payload.visit_id.is_some());
        assert!(req.payload.revision_id.is_none());
    }
}
