//! Geocoding batch job handler
//!
//! Processes geocoding jobs from JetStream queue:
//! - Picks up customer IDs from queue
//! - Calls Nominatim for each customer without coordinates
//! - Updates database with coordinates
//! - Publishes progress updates

use std::sync::Arc;
use anyhow::Result;
use async_nats::Client;
use async_nats::jetstream::{self, Context as JsContext};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{info, warn, error};
use uuid::Uuid;

use crate::services::geocoding::Geocoder;
use crate::types::{
    GeocodeJobRequest, GeocodeJobStatus, GeocodeJobStatusUpdate,
    GeocodeAddressJobRequest, GeocodeAddressJobStatus, GeocodeAddressJobStatusUpdate,
    ReverseGeocodeJobRequest, ReverseGeocodeJobStatus, ReverseGeocodeJobStatusUpdate,
    QueuedGeocodeJob, ErrorResponse, Request, SuccessResponse,
};

// Stream and consumer names
const STREAM_NAME: &str = "SAZINKA_GEOCODE_JOBS";
const CONSUMER_NAME: &str = "geocode_workers";
const SUBJECT_JOBS: &str = "sazinka.jobs.geocode";
const SUBJECT_STATUS_PREFIX: &str = "sazinka.job.geocode.status";

const ADDRESS_STREAM_NAME: &str = "SAZINKA_GEOCODE_ADDRESS_JOBS";
const ADDRESS_CONSUMER_NAME: &str = "geocode_address_workers";
const SUBJECT_ADDRESS_JOBS: &str = "sazinka.jobs.geocode.address";
const SUBJECT_ADDRESS_STATUS_PREFIX: &str = "sazinka.job.geocode.address.status";

const REVERSE_STREAM_NAME: &str = "SAZINKA_REVERSE_GEOCODE_JOBS";
const REVERSE_CONSUMER_NAME: &str = "reverse_geocode_workers";
const SUBJECT_REVERSE_JOBS: &str = "sazinka.jobs.geocode.reverse";
const SUBJECT_REVERSE_STATUS_PREFIX: &str = "sazinka.job.geocode.reverse.status";

/// Geocoding job processor
pub struct GeocodeProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    geocoder: Arc<dyn Geocoder>,
}

impl GeocodeProcessor {
    /// Create a new geocode processor, initializing JetStream stream
    pub async fn new(
        client: Client,
        pool: PgPool,
        geocoder: Arc<dyn Geocoder>,
    ) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create or get stream for geocoding jobs
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![SUBJECT_JOBS.to_string()],
            max_messages: 1_000,
            max_bytes: 10 * 1024 * 1024, // 10 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream geocode stream '{}' ready", STREAM_NAME);

        let address_stream_config = jetstream::stream::Config {
            name: ADDRESS_STREAM_NAME.to_string(),
            subjects: vec![SUBJECT_ADDRESS_JOBS.to_string()],
            max_messages: 1_000,
            max_bytes: 5 * 1024 * 1024, // 5 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(address_stream_config).await?;
        info!("JetStream geocode address stream '{}' ready", ADDRESS_STREAM_NAME);

        let reverse_stream_config = jetstream::stream::Config {
            name: REVERSE_STREAM_NAME.to_string(),
            subjects: vec![SUBJECT_REVERSE_JOBS.to_string()],
            max_messages: 1_000,
            max_bytes: 5 * 1024 * 1024, // 5 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        js.get_or_create_stream(reverse_stream_config).await?;
        info!("JetStream reverse geocode stream '{}' ready", REVERSE_STREAM_NAME);
        
        Ok(Self {
            client,
            js,
            pool,
            geocoder,
        })
    }
    
    /// Submit a geocoding job to the queue
    pub async fn submit_job(&self, request: GeocodeJobRequest) -> Result<Uuid> {
        let job = QueuedGeocodeJob::new(request);
        let job_id = job.id;
        
        // Publish to JetStream
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(SUBJECT_JOBS, payload.into()).await?.await?;
        
        info!("Geocode job {} submitted with {} customers", job_id, job.request.customer_ids.len());
        
        // Publish initial status
        self.publish_status(job_id, GeocodeJobStatus::Queued { position: 1 }).await?;
        
        Ok(job_id)
    }
    
    /// Publish a status update for a job
    pub async fn publish_status(&self, job_id: Uuid, status: GeocodeJobStatus) -> Result<()> {
        let update = GeocodeJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", SUBJECT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }

    pub async fn publish_address_status(&self, job_id: Uuid, status: GeocodeAddressJobStatus) -> Result<()> {
        let update = GeocodeAddressJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", SUBJECT_ADDRESS_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }

    pub async fn publish_reverse_status(&self, job_id: Uuid, status: ReverseGeocodeJobStatus) -> Result<()> {
        let update = ReverseGeocodeJobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", SUBJECT_REVERSE_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Start processing geocoding jobs from the queue
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3, // Retry up to 3 times
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(CONSUMER_NAME, consumer_config).await?;
        info!("JetStream geocode consumer '{}' ready", CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    // Process job (not spawning separate task to maintain order)
                    if let Err(e) = processor.process_job(msg).await {
                        error!("Failed to process geocode job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving geocode message: {}", e);
                }
            }
        }
        
        Ok(())
    }

    pub async fn start_address_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(ADDRESS_STREAM_NAME).await?;
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(ADDRESS_CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            ..Default::default()
        };
        let consumer = stream.get_or_create_consumer(ADDRESS_CONSUMER_NAME, consumer_config).await?;
        info!("JetStream geocode address consumer '{}' ready", ADDRESS_CONSUMER_NAME);

        let mut messages = consumer.messages().await?;
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    if let Err(e) = self.process_address_job(msg).await {
                        error!("Failed to process geocode address job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving geocode address message: {}", e);
                }
            }
        }
        Ok(())
    }

    pub async fn start_reverse_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(REVERSE_STREAM_NAME).await?;
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(REVERSE_CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3,
            ..Default::default()
        };
        let consumer = stream.get_or_create_consumer(REVERSE_CONSUMER_NAME, consumer_config).await?;
        info!("JetStream reverse geocode consumer '{}' ready", REVERSE_CONSUMER_NAME);

        let mut messages = consumer.messages().await?;
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    if let Err(e) = self.process_reverse_job(msg).await {
                        error!("Failed to process reverse geocode job: {}", e);
                    }
                }
                Err(e) => {
                    error!("Error receiving reverse geocode message: {}", e);
                }
            }
        }
        Ok(())
    }
    
    /// Process a single geocoding job
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::job_history::JOB_HISTORY;
        
        let job: QueuedGeocodeJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let started_at = job.submitted_at;
        let customer_ids = &job.request.customer_ids;
        let total = customer_ids.len() as u32;
        
        info!("Processing geocode job {} with {} customers", job_id, total);
        
        let mut succeeded = 0u32;
        let mut failed = 0u32;
        let mut failed_addresses: Vec<String> = Vec::new();
        
        for (i, customer_id) in customer_ids.iter().enumerate() {
            let processed = (i + 1) as u32;
            
            // Publish progress every 10 customers or at the end
            if processed % 10 == 0 || processed == total {
                self.publish_status(job_id, GeocodeJobStatus::Processing {
                    processed,
                    total,
                    succeeded,
                    failed,
                }).await?;
            }
            
            // Get customer from database
            match self.geocode_customer(*customer_id).await {
                Ok(true) => {
                    succeeded += 1;
                }
                Ok(false) => {
                    // No result from geocoder, not an error but no coordinates
                    failed += 1;
                    if let Some(addr) = self.get_customer_address(*customer_id).await {
                        failed_addresses.push(addr);
                    }
                }
                Err(e) => {
                    warn!("Failed to geocode customer {}: {}", customer_id, e);
                    failed += 1;
                    if let Some(addr) = self.get_customer_address(*customer_id).await {
                        failed_addresses.push(format!("{} ({})", addr, e));
                    }
                }
            }
        }
        
        // Publish completion status
        self.publish_status(job_id, GeocodeJobStatus::Completed {
            total,
            succeeded,
            failed,
            failed_addresses: failed_addresses.into_iter().take(50).collect(), // Limit to 50
        }).await?;
        
        // Acknowledge the message
        if let Err(e) = msg.ack().await {
            error!("Failed to ack geocode job {}: {:?}", job_id, e);
        }
        
        // Record in job history
        JOB_HISTORY.record_completed(
            job_id,
            "geocode",
            started_at,
            Some(format!("{}/{} succeeded", succeeded, total)),
        );
        
        info!("Geocode job {} completed: {}/{} succeeded, {} failed", 
              job_id, succeeded, total, failed);
        
        Ok(())
    }

    async fn process_address_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::job_history::JOB_HISTORY;
        
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct QueuedAddressJob {
            id: Uuid,
            submitted_at: chrono::DateTime<chrono::Utc>,
            request: GeocodeAddressJobRequest,
        }

        let job: QueuedAddressJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let started_at = job.submitted_at;

        self.publish_address_status(job_id, GeocodeAddressJobStatus::Processing).await?;

        let result = self.geocoder.geocode(
            &job.request.street,
            &job.request.city,
            &job.request.postal_code,
        ).await?;

        match result {
            Some(geo) => {
                self.publish_address_status(job_id, GeocodeAddressJobStatus::Completed {
                    coordinates: geo.coordinates,
                    display_name: Some(geo.display_name.clone()),
                }).await?;
                let _ = msg.ack().await;
                JOB_HISTORY.record_completed(job_id, "geocode.address", started_at, Some(geo.display_name));
            }
            None => {
                self.publish_address_status(job_id, GeocodeAddressJobStatus::Failed {
                    error: "Address not found".to_string(),
                }).await?;
                let _ = msg.ack().await;
                JOB_HISTORY.record_failed(job_id, "geocode.address", started_at, "Address not found".to_string());
            }
        }

        Ok(())
    }

    async fn process_reverse_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::job_history::JOB_HISTORY;
        
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct QueuedReverseJob {
            id: Uuid,
            submitted_at: chrono::DateTime<chrono::Utc>,
            request: ReverseGeocodeJobRequest,
        }

        let job: QueuedReverseJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let started_at = job.submitted_at;

        self.publish_reverse_status(job_id, ReverseGeocodeJobStatus::Processing).await?;

        let result = self.geocoder.reverse_geocode(job.request.lat, job.request.lng).await?;
        match result {
            Some(addr) => {
                sqlx::query(
                    r#"
                    UPDATE customers
                    SET street = $1, city = $2, postal_code = $3,
                        lat = $4, lng = $5, geocode_status = 'success', updated_at = NOW()
                    WHERE id = $6
                    "#
                )
                .bind(&addr.street)
                .bind(&addr.city)
                .bind(&addr.postal_code)
                .bind(job.request.lat)
                .bind(job.request.lng)
                .bind(job.request.customer_id)
                .execute(&self.pool)
                .await?;

                self.publish_reverse_status(job_id, ReverseGeocodeJobStatus::Completed {
                    street: addr.street.clone(),
                    city: addr.city.clone(),
                    postal_code: addr.postal_code.clone(),
                    display_name: Some(addr.display_name.clone()),
                }).await?;
                let _ = msg.ack().await;
                JOB_HISTORY.record_completed(job_id, "geocode.reverse", started_at, Some(addr.display_name));
            }
            None => {
                self.publish_reverse_status(job_id, ReverseGeocodeJobStatus::Failed {
                    error: "Reverse geocode failed".to_string(),
                }).await?;
                let _ = msg.ack().await;
                JOB_HISTORY.record_failed(job_id, "geocode.reverse", started_at, "Reverse geocode failed".to_string());
            }
        }

        Ok(())
    }
    
    /// Geocode a single customer and update database
    async fn geocode_customer(&self, customer_id: Uuid) -> Result<bool> {
        // Get customer address from database
        // Note: street, city, postal_code are nullable in the schema
        let customer: Option<(Option<String>, Option<String>, Option<String>, Option<f64>, Option<f64>)> = sqlx::query_as(
            r#"
            SELECT street, city, postal_code, lat, lng
            FROM customers
            WHERE id = $1
            "#
        )
        .bind(customer_id)
        .fetch_optional(&self.pool)
        .await?;
        
        let (street_opt, city_opt, postal_code_opt, lat, lng) = match customer {
            Some(c) => c,
            None => {
                warn!("Customer {} not found", customer_id);
                return Ok(false);
            }
        };
        
        // Skip if already has coordinates
        if lat.is_some() && lng.is_some() {
            return Ok(true);
        }

        // Need at least street and city for geocoding
        let street = match street_opt {
            Some(s) if !s.is_empty() => s,
            _ => {
                warn!("Customer {} has no street address, skipping geocoding", customer_id);
                return Ok(false);
            }
        };
        let city = city_opt.unwrap_or_default();
        let postal_code = postal_code_opt.unwrap_or_default();
        
        // Call geocoder
        let result = self.geocoder.geocode(&street, &city, &postal_code).await?;
        
        match result {
            Some(geo_result) => {
                // Update database with coordinates and status
                sqlx::query(
                    r#"
                    UPDATE customers
                    SET lat = $1, lng = $2, geocode_status = 'success', updated_at = NOW()
                    WHERE id = $3
                    "#
                )
                .bind(geo_result.coordinates.lat)
                .bind(geo_result.coordinates.lng)
                .bind(customer_id)
                .execute(&self.pool)
                .await?;
                
                info!("Geocoded customer {}: ({}, {})", 
                      customer_id, geo_result.coordinates.lat, geo_result.coordinates.lng);
                
                Ok(true)
            }
            None => {
                // Mark as failed - address cannot be located
                sqlx::query(
                    r#"
                    UPDATE customers
                    SET geocode_status = 'failed', updated_at = NOW()
                    WHERE id = $1
                    "#
                )
                .bind(customer_id)
                .execute(&self.pool)
                .await?;
                
                warn!("No geocoding result for customer {} ({}, {}, {})", 
                      customer_id, street, city, postal_code);
                Ok(false)
            }
        }
    }
    
    /// Get customer address for error reporting
    async fn get_customer_address(&self, customer_id: Uuid) -> Option<String> {
        let result: Option<(Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT street, city, postal_code FROM customers WHERE id = $1"
        )
        .bind(customer_id)
        .fetch_optional(&self.pool)
        .await
        .ok()?;
        
        result.map(|(street, city, postal)| {
            format!("{}, {} {}", 
                street.unwrap_or_default(), 
                postal.unwrap_or_default(), 
                city.unwrap_or_default())
        })
    }
}

// ==========================================================================
// NATS Request Handlers
// ==========================================================================

/// Handle geocode.submit requests (submit a batch geocoding job)
pub async fn handle_geocode_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<GeocodeProcessor>,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<GeocodeJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse geocode submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Require authentication
        let _user_id = match crate::auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        match processor.submit_job(request.payload).await {
            Ok(job_id) => {
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct SubmitResponse {
                    job_id: Uuid,
                    message: String,
                }
                
                let response = SubmitResponse {
                    job_id,
                    message: "Geocoding job submitted".to_string(),
                };
                let success = SuccessResponse::new(request.id, response);
                let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            }
            Err(e) => {
                error!("Failed to submit geocode job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

pub async fn handle_geocode_address_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<GeocodeProcessor>,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<GeocodeAddressJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Require authentication
        let _user_id = match crate::auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct SubmitResponse {
            job_id: Uuid,
            message: String,
        }

        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct QueuedAddressJob {
            id: Uuid,
            submitted_at: chrono::DateTime<chrono::Utc>,
            request: GeocodeAddressJobRequest,
        }

        let job_id = Uuid::new_v4();
        let queued = QueuedAddressJob {
            id: job_id,
            submitted_at: chrono::Utc::now(),
            request: request.payload,
        };

        let payload = serde_json::to_vec(&queued)?;
        processor.js.publish(SUBJECT_ADDRESS_JOBS, payload.into()).await?.await?;

        processor.publish_address_status(job_id, GeocodeAddressJobStatus::Queued { position: 1 }).await?;

        let response = SubmitResponse {
            job_id,
            message: "Geocode address job submitted".to_string(),
        };
        let success = SuccessResponse::new(request.id, response);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    Ok(())
}

pub async fn handle_reverse_geocode_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<GeocodeProcessor>,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };

        let request: Request<ReverseGeocodeJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Require authentication
        let _user_id = match crate::auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct SubmitResponse {
            job_id: Uuid,
            message: String,
        }

        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct QueuedReverseJob {
            id: Uuid,
            submitted_at: chrono::DateTime<chrono::Utc>,
            request: ReverseGeocodeJobRequest,
        }

        let job_id = Uuid::new_v4();
        let queued = QueuedReverseJob {
            id: job_id,
            submitted_at: chrono::Utc::now(),
            request: request.payload,
        };

        let payload = serde_json::to_vec(&queued)?;
        processor.js.publish(SUBJECT_REVERSE_JOBS, payload.into()).await?.await?;

        processor.publish_reverse_status(job_id, ReverseGeocodeJobStatus::Queued { position: 1 }).await?;

        let response = SubmitResponse {
            job_id,
            message: "Reverse geocode job submitted".to_string(),
        };
        let success = SuccessResponse::new(request.id, response);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    Ok(())
}

/// Handle geocode.pending - get customers without coordinates
pub async fn handle_geocode_pending(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    pool: PgPool,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        // Parse request for auth
        let request: Request<serde_json::Value> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse geocode pending request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };

        // Require authentication
        let user_id = match crate::auth::extract_auth(&request, &jwt_secret) {
            Ok(info) => info.data_user_id(),
            Err(_) => {
                let error = ErrorResponse::new(request.id, "UNAUTHORIZED", "Authentication required");
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        // Query customers pending geocoding for this user
        let customers: Vec<(Uuid, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            r#"
            SELECT id, name, street, city
            FROM customers
            WHERE geocode_status = 'pending' AND user_id = $1
            ORDER BY created_at DESC
            LIMIT 1000
            "#
        )
        .bind(user_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();
        
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct PendingCustomer {
            id: Uuid,
            name: String,
            address: String,
        }
        
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct PendingResponse {
            count: usize,
            customers: Vec<PendingCustomer>,
        }
        
        let response = PendingResponse {
            count: customers.len(),
            customers: customers.into_iter().map(|(id, name, street, city)| {
                PendingCustomer {
                    id,
                    name: name.unwrap_or_default(),
                    address: format!("{}, {}", 
                        street.unwrap_or_default(), 
                        city.unwrap_or_default()),
                }
            }).collect(),
        };
        
        let success = SuccessResponse::new(request.id, response);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    
    Ok(())
}

fn extract_request_id(payload: &[u8]) -> Uuid {
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(payload) {
        if let Some(id_str) = v.get("id").and_then(|id| id.as_str()) {
            if let Ok(uuid) = Uuid::parse_str(id_str) {
                return uuid;
            }
        }
    }
    Uuid::new_v4()
}

// ==========================================================================
// Tests
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_config_values() {
        assert_eq!(STREAM_NAME, "SAZINKA_GEOCODE_JOBS");
        assert_eq!(SUBJECT_JOBS, "sazinka.jobs.geocode");
        assert!(SUBJECT_STATUS_PREFIX.starts_with("sazinka.job.geocode.status"));
    }
}
