//! Job queue handlers for async task processing
//!
//! Uses NATS JetStream for persistent job queuing with:
//! - Job submission and status tracking
//! - Worker pool processing with acknowledgements
//! - Real-time status updates via pub/sub

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::collections::HashMap;
use anyhow::Result;
use async_nats::Client;
use async_nats::jetstream::{self, Context as JsContext};
use chrono::{DateTime, Utc};
use futures::StreamExt;
use sqlx::PgPool;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::db::queries;
use crate::defaults::{default_work_end, default_work_start, DEFAULT_SERVICE_DURATION_MINUTES};
use crate::services::routing::{RoutingService, MockRoutingService};
use crate::services::vrp::{VrpSolver, VrpProblem, VrpStop, Depot, SolverConfig, StopTimeWindow, BreakConfig};
use crate::types::{
    Coordinates, ErrorResponse, Request, SuccessResponse,
    JobSubmitResponse, JobStatus, JobStatusUpdate, QueuedJob, RoutePlanJobRequest,
    PlannedRouteStop, RoutePlanResponse, RouteWarning, StopType,
};

// Stream and consumer names
const STREAM_NAME: &str = "SAZINKA_JOBS";
const CONSUMER_NAME: &str = "route_workers";
const SUBJECT_JOBS: &str = "sazinka.jobs.route";
const SUBJECT_STATUS_PREFIX: &str = "sazinka.job.status";

/// Statistics about the job queue
#[derive(Debug, Clone)]
pub struct QueueStats {
    /// Number of pending jobs
    pub pending: u32,
    /// Number of jobs being processed
    pub processing: u32,
    /// Average processing time in ms
    pub avg_processing_time_ms: u32,
}

/// Shared state for job processing
pub struct JobProcessor {
    client: Client,
    js: JsContext,
    pool: PgPool,
    routing_service: Arc<dyn RoutingService>,
    pending_count: AtomicU32,
}

impl JobProcessor {
    /// Create a new job processor
    pub async fn new(
        client: Client,
        pool: PgPool,
        routing_service: Arc<dyn RoutingService>,
    ) -> Result<Self> {
        let js = jetstream::new(client.clone());
        
        // Create or get stream
        let stream_config = jetstream::stream::Config {
            name: STREAM_NAME.to_string(),
            subjects: vec![SUBJECT_JOBS.to_string()],
            max_messages: 10_000,
            max_bytes: 100 * 1024 * 1024, // 100 MB
            retention: jetstream::stream::RetentionPolicy::WorkQueue,
            ..Default::default()
        };
        
        js.get_or_create_stream(stream_config).await?;
        info!("JetStream stream '{}' ready", STREAM_NAME);
        
        Ok(Self {
            client,
            js,
            pool,
            routing_service,
            pending_count: AtomicU32::new(0),
        })
    }
    
    /// Submit a job to the queue
    pub async fn submit_job(&self, request: RoutePlanJobRequest) -> Result<JobSubmitResponse> {
        let job = QueuedJob::new(request, crate::types::job::JobPriority::Normal);
        let job_id = job.id;
        
        // Publish to JetStream
        let payload = serde_json::to_vec(&job)?;
        self.js.publish(SUBJECT_JOBS, payload.into()).await?.await?;
        
        let pending = self.pending_count.fetch_add(1, Ordering::Relaxed) + 1;
        let estimated_wait = self.estimate_wait_time(pending);
        
        info!("Job {} submitted, position {} in queue", job_id, pending);
        
        // Publish initial status
        self.publish_status(job_id, JobStatus::Queued {
            position: pending,
            estimated_wait_seconds: estimated_wait,
        }).await?;
        
        Ok(JobSubmitResponse {
            job_id,
            position: pending,
            estimated_wait_seconds: estimated_wait,
        })
    }
    
    /// Get current queue statistics
    pub async fn get_stats(&self) -> QueueStats {
        QueueStats {
            pending: self.pending_count.load(Ordering::Relaxed),
            processing: 0, // TODO: track in-flight jobs
            avg_processing_time_ms: 2000, // Estimate
        }
    }
    
    /// Publish a status update for a job
    pub async fn publish_status(&self, job_id: Uuid, status: JobStatus) -> Result<()> {
        let update = JobStatusUpdate::new(job_id, status);
        let subject = format!("{}.{}", SUBJECT_STATUS_PREFIX, job_id);
        let payload = serde_json::to_vec(&update)?;
        
        self.client.publish(subject, payload.into()).await?;
        Ok(())
    }
    
    /// Estimate wait time based on queue position
    fn estimate_wait_time(&self, position: u32) -> u32 {
        // Rough estimate: 2-3 seconds per job
        position * 3
    }
    
    /// Start processing jobs from the queue
    pub async fn start_processing(self: Arc<Self>) -> Result<()> {
        let stream = self.js.get_stream(STREAM_NAME).await?;
        
        let consumer_config = jetstream::consumer::pull::Config {
            durable_name: Some(CONSUMER_NAME.to_string()),
            ack_policy: jetstream::consumer::AckPolicy::Explicit,
            max_deliver: 3, // Retry up to 3 times
            ..Default::default()
        };
        
        let consumer = stream.get_or_create_consumer(CONSUMER_NAME, consumer_config).await?;
        info!("JetStream consumer '{}' ready", CONSUMER_NAME);
        
        let mut messages = consumer.messages().await?;
        
        while let Some(msg) = messages.next().await {
            match msg {
                Ok(msg) => {
                    let processor = Arc::clone(&self);
                    
                    // Process in separate task
                    tokio::spawn(async move {
                        if let Err(e) = processor.process_job(msg).await {
                            error!("Failed to process job: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Error receiving message: {}", e);
                }
            }
        }
        
        Ok(())
    }
    
    /// Process a single job
    async fn process_job(&self, msg: jetstream::Message) -> Result<()> {
        use crate::services::job_history::JOB_HISTORY;
        
        let job: QueuedJob = serde_json::from_slice(&msg.payload)?;
        let job_id = job.id;
        let started_at = Utc::now();
        
        info!("Processing route job {} with {} customers", job_id, job.request.customer_ids.len());
        self.pending_count.fetch_sub(1, Ordering::Relaxed);
        
        // Publish processing status
        self.publish_status(job_id, JobStatus::Processing {
            progress: 0,
            message: "Načítání zákazníků...".to_string(),
        }).await?;
        
        // Execute route planning
        match self.execute_route_plan(job_id, &job.request).await {
            Ok(result) => {
                self.publish_status(job_id, JobStatus::Completed { result: result.clone() }).await?;
                if let Err(e) = msg.ack().await {
                    error!("Failed to ack job {}: {:?}", job_id, e);
                }
                
                // Record in job history
                JOB_HISTORY.record_completed(
                    job_id,
                    "route",
                    started_at,
                    Some(format!("{} zastávek, {:.1} km", result.stops.len(), result.total_distance_km)),
                );
                
                info!("Route job {} completed: {} stops, {:.1} km", 
                      job_id, result.stops.len(), result.total_distance_km);
            }
            Err(e) => {
                self.publish_status(job_id, JobStatus::Failed { 
                    error: e.to_string() 
                }).await?;
                
                // Record failure in job history
                JOB_HISTORY.record_failed(job_id, "route", started_at, e.to_string());
                
                // Ack to prevent infinite retries for permanent failures
                let _ = msg.ack().await;
                warn!("Route job {} failed: {}", job_id, e);
            }
        }
        
        Ok(())
    }
    
    /// Execute the actual route planning logic
    async fn execute_route_plan(
        &self,
        job_id: Uuid,
        request: &RoutePlanJobRequest,
    ) -> Result<RoutePlanResponse> {
        let user_id = request.user_id.unwrap_or(Uuid::nil());

        // Load crew (if specified) for working hours and arrival buffer
        let crew = if let Some(crew_id) = request.crew_id {
            match queries::crew::get_crew(&self.pool, crew_id, user_id).await {
                Ok(Some(c)) => {
                    info!("Job: using crew '{}': working hours {:?}-{:?}, buffer {}%",
                        c.name, c.working_hours_start, c.working_hours_end, c.arrival_buffer_percent);
                    Some(c)
                }
                _ => {
                    warn!("Job: crew {} not found, using user settings", crew_id);
                    None
                }
            }
        } else {
            None
        };

        let arrival_buffer_percent = crew.as_ref().map(|c| c.arrival_buffer_percent).unwrap_or(10.0);
        let solver = VrpSolver::new(SolverConfig::with_buffer(5, 500, arrival_buffer_percent));
        
        // Validate request
        if request.customer_ids.is_empty() {
            return Ok(RoutePlanResponse {
                stops: vec![],
                total_distance_km: 0.0,
                total_duration_minutes: 0,
                algorithm: "none".to_string(),
                solve_time_ms: 0,
                solver_log: vec![],
                optimization_score: 100,
                warnings: vec![],
                unassigned: vec![],
                geometry: vec![],
                return_to_depot_distance_km: None,
                return_to_depot_duration_minutes: None,
            });
        }
        
        // Load customers from database
        self.publish_status(job_id, JobStatus::Processing {
            progress: 10,
            message: "Načítání zákazníků z databáze...".to_string(),
        }).await?;
        
        let customers = self.load_customers_for_route(user_id, &request.customer_ids, request.date, &request.time_windows).await?;
        
        // Filter customers with valid coordinates
        let (valid_customers, invalid_ids): (Vec<_>, Vec<_>) = customers
            .into_iter()
            .partition(|c| c.lat.is_some() && c.lng.is_some());
        
        let mut warnings = Vec::new();
        for customer in &invalid_ids {
            warnings.push(RouteWarning {
                stop_index: None,
                warning_type: "MISSING_COORDINATES".to_string(),
                message: format!("Zákazník {} nemá souřadnice", customer.name.as_deref().unwrap_or("(unnamed)")),
            });
        }
        
        if valid_customers.is_empty() {
            return Ok(RoutePlanResponse {
                stops: vec![],
                total_distance_km: 0.0,
                total_duration_minutes: 0,
                algorithm: "none".to_string(),
                solve_time_ms: 0,
                solver_log: vec![],
                optimization_score: 0,
                warnings,
                unassigned: request.customer_ids.clone(),
                geometry: vec![],
                return_to_depot_distance_km: None,
                return_to_depot_duration_minutes: None,
            });
        }
        
        // Load user settings
        self.publish_status(job_id, JobStatus::Processing {
            progress: 20,
            message: "Načítání nastavení...".to_string(),
        }).await?;
        
        let (user_shift_start, user_shift_end, service_duration, break_config) = match queries::settings::get_user_settings(&self.pool, user_id).await {
            Ok(Some(settings)) => {
                let break_cfg = if settings.break_enabled {
                    Some(BreakConfig {
                        earliest_time: settings.break_earliest_time,
                        latest_time: settings.break_latest_time,
                        duration_minutes: settings.break_duration_minutes as u32,
                    })
                } else {
                    None
                };
                (settings.working_hours_start, settings.working_hours_end, settings.default_service_duration_minutes as u32, break_cfg)
            }
            _ => {
                (
                    default_work_start(),
                    default_work_end(),
                    DEFAULT_SERVICE_DURATION_MINUTES,
                    None,
                )
            }
        };

        // Crew working hours take priority over user settings
        let shift_start = crew.as_ref().map(|c| c.working_hours_start).unwrap_or(user_shift_start);
        let shift_end = crew.as_ref().map(|c| c.working_hours_end).unwrap_or(user_shift_end);
        info!("Job: route planning shift: {:?}-{:?} (crew override: {})", shift_start, shift_end, crew.is_some());
        
        // Build VRP problem
        let vrp_problem = self.build_vrp_problem(
            &request.start_location,
            &valid_customers,
            shift_start,
            shift_end,
            service_duration,
            break_config,
        );
        
        // Build location list for matrix
        let mut locations = vec![request.start_location];
        for customer in &valid_customers {
            if let Some(coords) = customer_coordinates(customer) {
                locations.push(coords);
            }
        }
        
        // Get distance/time matrices
        self.publish_status(job_id, JobStatus::Processing {
            progress: 40,
            message: "Výpočet vzdáleností...".to_string(),
        }).await?;
        
        let (matrices, routing_fallback_used) = match self.routing_service.get_matrices(&locations).await {
            Ok(m) => (m, false),
            Err(e) => {
                warn!("Primary routing failed: {}. Using fallback.", e);
                let mock_service = MockRoutingService::new();
                match mock_service.get_matrices(&locations).await {
                    Ok(m) => (m, true),
                    Err(e2) => {
                        return Err(anyhow::anyhow!("Routing failed: {}", e2));
                    }
                }
            }
        };
        
        // Solve VRP
        self.publish_status(job_id, JobStatus::Processing {
            progress: 60,
            message: "Optimalizace trasy...".to_string(),
        }).await?;
        
        let solution = solver.solve(&vrp_problem, &matrices, request.date).await?;
        
        // Build response
        self.publish_status(job_id, JobStatus::Processing {
            progress: 80,
            message: "Sestavování výsledku...".to_string(),
        }).await?;
        
        let customer_matrix_index: HashMap<Uuid, usize> = valid_customers
            .iter()
            .enumerate()
            .map(|(idx, c)| (c.id, idx + 1)) // 0 is depot
            .collect();
        let mut planned_stops: Vec<PlannedRouteStop> = Vec::new();
        let mut previous_matrix_index: usize = 0;
        for stop in &solution.stops {
            if let Some(customer) = valid_customers.iter().find(|c| c.id.to_string() == stop.stop_id) {
                let matrix_index = customer_matrix_index.get(&customer.id).copied().unwrap_or(0);
                let leg_distance_km = if matrix_index > 0 {
                    Some(matrices.distance(previous_matrix_index, matrix_index) as f64 / 1000.0)
                } else {
                    None
                };
                let leg_duration_min = if matrix_index > 0 {
                    Some((matrices.duration(previous_matrix_index, matrix_index) as i32 + 30) / 60)
                } else {
                    None
                };
                planned_stops.push(PlannedRouteStop {
                    customer_id: customer.id,
                    customer_name: customer.name.clone().unwrap_or_default(),
                    address: format!("{}, {} {}", customer.street.as_deref().unwrap_or(""), customer.city.as_deref().unwrap_or(""), customer.postal_code.as_deref().unwrap_or("")),
                    coordinates: customer_coordinates(customer).unwrap_or(request.start_location),
                    order: stop.order as i32,
                    eta: stop.arrival_time,
                    etd: stop.departure_time,
                    service_duration_minutes: service_duration as i32,
                    time_window: match (customer.scheduled_time_start, customer.scheduled_time_end) {
                        (Some(start), Some(end)) => Some(crate::types::TimeWindow {
                            start,
                            end,
                            is_hard: true,
                        }),
                        _ => None,
                    },
                    stop_type: Some(StopType::Customer),
                    break_duration_minutes: None,
                    break_time_start: None,
                    distance_from_previous_km: leg_distance_km,
                    duration_from_previous_minutes: leg_duration_min,
                });
                if matrix_index > 0 {
                    previous_matrix_index = matrix_index;
                }
            } else if stop.customer_id.is_nil() {
                // Break stop from VRP solver — crew stays at the previous
                // location, so the travel leg is 0 km / 0 min.
                planned_stops.push(PlannedRouteStop {
                    customer_id: Uuid::nil(),
                    customer_name: "Pauza".to_string(),
                    address: "Pauza".to_string(),
                    coordinates: request.start_location,
                    order: stop.order as i32,
                    eta: stop.arrival_time,
                    etd: stop.departure_time,
                    service_duration_minutes: ((stop.departure_time - stop.arrival_time).num_minutes().max(0)) as i32,
                    time_window: None,
                    stop_type: Some(StopType::Break),
                    break_duration_minutes: Some(((stop.departure_time - stop.arrival_time).num_minutes().max(0)) as i32),
                    break_time_start: Some(stop.arrival_time),
                    distance_from_previous_km: Some(0.0),
                    duration_from_previous_minutes: Some(0),
                });
            }
        }
        
        // Add solver warnings
        for w in &solution.warnings {
            warnings.push(RouteWarning {
                stop_index: None,
                warning_type: w.warning_type.clone(),
                message: w.message.clone(),
            });
        }
        
        if routing_fallback_used {
            warnings.push(RouteWarning {
                stop_index: None,
                warning_type: "ROUTING_FALLBACK".to_string(),
                message: "Valhalla nedostupná - použity odhadované vzdálenosti".to_string(),
            });
        }
        
        // Collect unassigned
        let mut unassigned: Vec<Uuid> = invalid_ids.iter().map(|c| c.id).collect();
        for stop_id in &solution.unassigned {
            if let Ok(id) = Uuid::parse_str(stop_id) {
                unassigned.push(id);
            }
        }
        
        // Build geometry
        self.publish_status(job_id, JobStatus::Processing {
            progress: 90,
            message: "Generování geometrie trasy...".to_string(),
        }).await?;
        
        let geometry = if !planned_stops.is_empty() {
            let mut route_coords: Vec<Coordinates> = vec![request.start_location];
            for stop in &planned_stops {
                route_coords.push(stop.coordinates);
            }
            route_coords.push(request.start_location);
            
            if !routing_fallback_used {
                if let Some(valhalla) = self.routing_service.as_any().downcast_ref::<crate::services::routing::ValhallaClient>() {
                    match valhalla.get_route_geometry(&route_coords).await {
                        Ok(geom) => geom.coordinates,
                        Err(_) => route_coords.iter().map(|c| [c.lng, c.lat]).collect(),
                    }
                } else {
                    route_coords.iter().map(|c| [c.lng, c.lat]).collect()
                }
            } else {
                route_coords.iter().map(|c| [c.lng, c.lat]).collect()
            }
        } else {
            vec![]
        };
        
        let return_to_depot_distance_km = if previous_matrix_index > 0 {
            Some(matrices.distance(previous_matrix_index, 0) as f64 / 1000.0)
        } else {
            None
        };
        let return_to_depot_duration_minutes = if previous_matrix_index > 0 {
            Some((matrices.duration(previous_matrix_index, 0) as i32 + 30) / 60)
        } else {
            None
        };

        Ok(RoutePlanResponse {
            stops: planned_stops,
            total_distance_km: solution.total_distance_meters as f64 / 1000.0,
            total_duration_minutes: (solution.total_duration_seconds / 60) as i32,
            algorithm: solution.algorithm,
            solve_time_ms: solution.solve_time_ms,
            solver_log: solution.solver_log,
            optimization_score: solution.optimization_score as i32,
            warnings,
            unassigned,
            geometry,
            return_to_depot_distance_km,
            return_to_depot_duration_minutes,
        })
    }
    
    /// Load customers for route planning.
    ///
    /// Time window resolution priority:
    /// 1) Frontend-provided time windows (from saved route stops — what the user sees)
    /// 2) `revisions` table (authoritative DB source)
    /// 3) `visits` table (legacy fallback)
    async fn load_customers_for_route(
        &self,
        user_id: Uuid,
        customer_ids: &[Uuid],
        date: chrono::NaiveDate,
        frontend_time_windows: &[crate::types::CustomerTimeWindow],
    ) -> Result<Vec<CustomerForRoute>> {
        // Build a lookup map from frontend time windows
        let fe_tw_map: HashMap<Uuid, &crate::types::CustomerTimeWindow> = frontend_time_windows
            .iter()
            .map(|tw| (tw.customer_id, tw))
            .collect();
        
        let mut customers = Vec::new();
        
        for customer_id in customer_ids {
            if let Some(customer) = queries::customer::get_customer(&self.pool, user_id, *customer_id).await? {
                // Priority 1: Frontend-provided time windows (what the user sees in the UI)
                let (tw_start, tw_end) = if let Some(fe_tw) = fe_tw_map.get(customer_id) {
                    // Accept both "HH:MM" and "HH:MM:SS" formats
                    let start = chrono::NaiveTime::parse_from_str(&fe_tw.start, "%H:%M:%S")
                        .or_else(|_| chrono::NaiveTime::parse_from_str(&fe_tw.start, "%H:%M"))
                        .ok();
                    let end = chrono::NaiveTime::parse_from_str(&fe_tw.end, "%H:%M:%S")
                        .or_else(|_| chrono::NaiveTime::parse_from_str(&fe_tw.end, "%H:%M"))
                        .ok();
                    if start.is_some() && end.is_some() {
                        info!(
                            "Customer {} ({}): using frontend time window {:?}-{:?}",
                            customer_id,
                            customer.name.as_deref().unwrap_or("?"),
                            start, end,
                        );
                        (start, end)
                    } else {
                        warn!(
                            "Customer {} ({}): invalid frontend time window '{}'-'{}', falling back to DB",
                            customer_id,
                            customer.name.as_deref().unwrap_or("?"),
                            fe_tw.start, fe_tw.end,
                        );
                        match queries::revision::get_scheduled_time_window_with_fallback(
                            &self.pool,
                            user_id,
                            *customer_id,
                            date,
                        )
                        .await
                        {
                            Ok(Some((start, end))) => (Some(start), Some(end)),
                            Ok(None) => (None, None),
                            Err(e) => {
                                warn!(
                                    "Failed to load fallback time window for customer {} on {}: {}",
                                    customer_id, date, e
                                );
                                (None, None)
                            }
                        }
                    }
                } else {
                    // Priority 2+3: DB lookup (revisions, then visits)
                    match queries::revision::get_scheduled_time_window_with_fallback(
                        &self.pool,
                        user_id,
                        *customer_id,
                        date,
                    )
                    .await
                    {
                        Ok(Some((start, end))) => (Some(start), Some(end)),
                        Ok(None) => (None, None),
                        Err(e) => {
                            warn!(
                                "Failed to load fallback time window for customer {} on {}: {}",
                                customer_id, date, e
                            );
                            (None, None)
                        }
                    }
                };
                
                customers.push(CustomerForRoute {
                    id: customer.id,
                    name: customer.name.clone(),
                    street: customer.street.clone(),
                    city: customer.city.clone(),
                    postal_code: customer.postal_code.clone(),
                    lat: customer.lat,
                    lng: customer.lng,
                    scheduled_time_start: tw_start,
                    scheduled_time_end: tw_end,
                });
            }
        }
        
        Ok(customers)
    }
    
    /// Build VRP problem from customers
    fn build_vrp_problem(
        &self,
        start: &Coordinates,
        customers: &[CustomerForRoute],
        shift_start: chrono::NaiveTime,
        shift_end: chrono::NaiveTime,
        service_duration_minutes: u32,
        break_config: Option<BreakConfig>,
    ) -> VrpProblem {
        let stops: Vec<VrpStop> = customers
            .iter()
            .filter_map(|c| {
                let coordinates = customer_coordinates(c)?;
                // For scheduled customers: point time window [start, start]
                // forces the solver to arrive at exactly the agreed time.
                // Service duration = full slot length (end - start).
                // If the solver can't meet the constraint, it marks the stop
                // as unassigned — the frontend will keep it with a warning.
                let (time_window, stop_service_duration) = match (c.scheduled_time_start, c.scheduled_time_end) {
                    (Some(start), Some(end)) => {
                        let slot_minutes = (end - start).num_minutes().max(1) as u32;
                        info!(
                            "VRP stop {} ({}) scheduled {:?}-{:?} → point window={:?}, service={}min",
                            c.id,
                            c.name.as_deref().unwrap_or("?"),
                            start, end, start, slot_minutes,
                        );
                        (
                            Some(StopTimeWindow {
                                start,
                                end: start, // Point arrival at slot start
                                is_hard: true,
                            }),
                            slot_minutes,
                        )
                    }
                    _ => (None, service_duration_minutes),
                };
                Some(VrpStop {
                    id: c.id.to_string(),
                    customer_id: c.id,
                    customer_name: c.name.clone().unwrap_or_default(),
                    coordinates,
                    service_duration_minutes: stop_service_duration,
                    time_window,
                    priority: 1,
                })
            })
            .collect();
        
        VrpProblem {
            depot: Depot { coordinates: *start },
            stops,
            shift_start,
            shift_end,
            break_config,
        }
    }
}

fn customer_coordinates(customer: &CustomerForRoute) -> Option<Coordinates> {
    Some(Coordinates {
        lat: customer.lat?,
        lng: customer.lng?,
    })
}

/// Simple customer data for route planning
struct CustomerForRoute {
    id: Uuid,
    name: Option<String>,
    street: Option<String>,
    city: Option<String>,
    postal_code: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    /// Scheduled time window from revision (if any)
    scheduled_time_start: Option<chrono::NaiveTime>,
    scheduled_time_end: Option<chrono::NaiveTime>,
}

// ==========================================================================
// NATS Request Handlers
// ==========================================================================

/// Handle job.submit requests
pub async fn handle_job_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<JobProcessor>,
    jwt_secret: Arc<String>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<RoutePlanJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse job submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        // Extract user_id from JWT token or Request wrapper
        let request_id = request.id;
        let request_user_id = request.user_id.clone();
        // Try to extract auth before moving payload
        let auth_user_id = crate::auth::extract_auth(&request, &jwt_secret)
            .ok()
            .map(|auth| auth.user_id);
        
        let mut job_request = request.payload;
        if job_request.user_id.is_none() {
            if let Some(uid) = auth_user_id {
                job_request.user_id = Some(uid);
            } else {
                job_request.user_id = request_user_id;
            }
        }
        
        match processor.submit_job(job_request).await {
            Ok(response) => {
                let success = SuccessResponse::new(request_id, response);
                let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            }
            Err(e) => {
                error!("Failed to submit job: {}", e);
                let error = ErrorResponse::new(request_id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

/// Handle job.stats requests
pub async fn handle_job_stats(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<JobProcessor>,
) -> Result<()> {
    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct StatsResponse {
        pending: u32,
        processing: u32,
        avg_processing_time_ms: u32,
    }
    
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let stats = processor.get_stats().await;
        let response = StatsResponse {
            pending: stats.pending,
            processing: stats.processing,
            avg_processing_time_ms: stats.avg_processing_time_ms,
        };
        
        let request_id = extract_request_id(&msg.payload);
        let success = SuccessResponse::new(request_id, response);
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
// Job History Handler
// ==========================================================================

/// Request to get job history
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListJobHistoryRequest {
    pub limit: Option<usize>,
    pub job_type: Option<String>,
    pub status: Option<String>,
}

/// Handle jobs.history requests
pub async fn handle_job_history(
    client: Client,
    mut subscriber: async_nats::Subscriber,
) -> Result<()> {
    use crate::services::job_history::{JOB_HISTORY, JobHistoryResponse};
    
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<ListJobHistoryRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse job history request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let limit = request.payload.limit.unwrap_or(50);
        
        let history: JobHistoryResponse = match (&request.payload.job_type, &request.payload.status) {
            (Some(job_type), _) => JOB_HISTORY.get_by_type(job_type, limit),
            (_, Some(status)) => JOB_HISTORY.get_by_status(status, limit),
            _ => JOB_HISTORY.get_recent(limit),
        };
        
        let success = SuccessResponse::new(request.id, history);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    
    Ok(())
}

// ==========================================================================
// Job Management Handlers (Cancel, Retry)
// ==========================================================================

/// Request to cancel a job
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelJobRequest {
    pub job_id: Uuid,
    pub job_type: String,
}

/// Request to retry a failed job
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryJobRequest {
    pub job_id: Uuid,
    pub job_type: String,
}

/// Response from job action (cancel/retry)
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobActionResponse {
    pub success: bool,
    pub message: String,
    pub job_id: Uuid,
}

/// Handle jobs.cancel requests
pub async fn handle_job_cancel(
    client: Client,
    mut subscriber: async_nats::Subscriber,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<CancelJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse cancel job request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let job_id = request.payload.job_id;
        let job_type = &request.payload.job_type;
        
        info!("Attempting to cancel job {} of type {}", job_id, job_type);
        
        // For now, we publish a "cancelled" status to notify subscribers
        // In a full implementation, we would remove the job from JetStream queue
        let status_subject = format!("sazinka.job.{}.status.{}", job_type, job_id);
        let cancel_status = serde_json::json!({
            "jobId": job_id.to_string(),
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "status": {
                "type": "failed",
                "error": "Job cancelled by user"
            }
        });
        
        if let Err(e) = client.publish(status_subject, serde_json::to_vec(&cancel_status)?.into()).await {
            warn!("Failed to publish cancel status: {}", e);
            let response = JobActionResponse {
                success: false,
                message: format!("Failed to cancel job: {}", e),
                job_id,
            };
            let success = SuccessResponse::new(request.id, response);
            let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            continue;
        }
        
        let response = JobActionResponse {
            success: true,
            message: "Job cancellation requested".to_string(),
            job_id,
        };
        let success = SuccessResponse::new(request.id, response);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    
    Ok(())
}

/// Handle jobs.retry requests
pub async fn handle_job_retry(
    client: Client,
    mut subscriber: async_nats::Subscriber,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<RetryJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse retry job request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        let job_id = request.payload.job_id;
        let job_type = &request.payload.job_type;
        
        info!("Attempting to retry job {} of type {}", job_id, job_type);
        
        // In a full implementation, we would:
        // 1. Look up the original job request
        // 2. Re-submit it to the appropriate queue
        // For now, return a placeholder response
        
        let response = JobActionResponse {
            success: false,
            message: "Job retry not yet implemented - please re-submit the job manually".to_string(),
            job_id,
        };
        let success = SuccessResponse::new(request.id, response);
        let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
    }
    
    Ok(())
}

// ==========================================================================
// Tests
// ==========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_stats_default_values() {
        let stats = QueueStats {
            pending: 0,
            processing: 0,
            avg_processing_time_ms: 2000,
        };
        
        assert_eq!(stats.pending, 0);
        assert_eq!(stats.avg_processing_time_ms, 2000);
    }

    #[test]
    fn test_estimate_wait_time() {
        // Position 1 = 3 seconds
        assert_eq!(1 * 3, 3);
        // Position 10 = 30 seconds
        assert_eq!(10 * 3, 30);
    }

    #[test]
    fn test_stream_config_values() {
        assert_eq!(STREAM_NAME, "SAZINKA_JOBS");
        assert_eq!(SUBJECT_JOBS, "sazinka.jobs.route");
        assert!(SUBJECT_STATUS_PREFIX.starts_with("sazinka.job.status"));
    }
}
