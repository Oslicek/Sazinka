//! NATS message handlers

pub mod admin;
pub mod communication;
pub mod customer;
pub mod device;
pub mod geocode;
pub mod import;
pub mod jobs;
pub mod ping;
pub mod revision;
pub mod route;
pub mod settings;
pub mod slots;
pub mod vehicle;
pub mod visit;

use std::sync::Arc;
use anyhow::Result;
use async_nats::Client;
use sqlx::PgPool;
use tracing::{info, error};
use tokio::select;
use futures::StreamExt;
use uuid::Uuid;

use crate::config::Config;
use crate::services::geocoding::{create_geocoder, Geocoder};
use crate::services::routing::{RoutingService, create_routing_service_with_fallback};
use crate::services::valhalla_processor::ValhallaProcessor;
use crate::types::{
    Request, SuccessResponse, ErrorResponse,
    MatrixJobRequest, GeometryJobRequest,
};

// ==========================================================================
// Valhalla JetStream Handlers
// ==========================================================================

/// Handle valhalla.matrix.submit requests
async fn handle_valhalla_matrix_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<ValhallaProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<MatrixJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse valhalla matrix submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        match processor.submit_matrix_job(request.payload.locations).await {
            Ok(response) => {
                let success = SuccessResponse::new(request.id, response);
                let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            }
            Err(e) => {
                error!("Failed to submit matrix job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

/// Handle valhalla.geometry.submit requests
async fn handle_valhalla_geometry_submit(
    client: Client,
    mut subscriber: async_nats::Subscriber,
    processor: Arc<ValhallaProcessor>,
) -> Result<()> {
    while let Some(msg) = subscriber.next().await {
        let reply = match msg.reply {
            Some(ref r) => r.clone(),
            None => continue,
        };
        
        let request: Request<GeometryJobRequest> = match serde_json::from_slice(&msg.payload) {
            Ok(req) => req,
            Err(e) => {
                error!("Failed to parse valhalla geometry submit request: {}", e);
                let error = ErrorResponse::new(Uuid::nil(), "INVALID_REQUEST", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
                continue;
            }
        };
        
        match processor.submit_geometry_job(request.payload.locations).await {
            Ok(response) => {
                let success = SuccessResponse::new(request.id, response);
                let _ = client.publish(reply, serde_json::to_vec(&success)?.into()).await;
            }
            Err(e) => {
                error!("Failed to submit geometry job: {}", e);
                let error = ErrorResponse::new(request.id, "SUBMIT_ERROR", e.to_string());
                let _ = client.publish(reply, serde_json::to_vec(&error)?.into()).await;
            }
        }
    }
    
    Ok(())
}

/// Start all message handlers
pub async fn start_handlers(client: Client, pool: PgPool, config: &Config) -> Result<()> {
    info!("Starting message handlers...");

    // Create shared geocoder
    let geocoder: Arc<dyn Geocoder> = Arc::from(create_geocoder());
    info!("Geocoder initialized: {}", geocoder.name());

    // Create routing service with automatic Valhalla detection
    let routing_service: Arc<dyn RoutingService> = Arc::from(
        create_routing_service_with_fallback(config.valhalla_url.clone()).await
    );
    info!("Routing service initialized: {}", routing_service.name());

    // Subscribe to all subjects
    let ping_sub = client.subscribe("sazinka.ping").await?;
    let customer_create_sub = client.subscribe("sazinka.customer.create").await?;
    let customer_list_sub = client.subscribe("sazinka.customer.list").await?;
    let customer_get_sub = client.subscribe("sazinka.customer.get").await?;
    let customer_update_sub = client.subscribe("sazinka.customer.update").await?;
    let customer_delete_sub = client.subscribe("sazinka.customer.delete").await?;
    let customer_random_sub = client.subscribe("sazinka.customer.random").await?;
    let customer_list_extended_sub = client.subscribe("sazinka.customer.list.extended").await?;
    let customer_summary_sub = client.subscribe("sazinka.customer.summary").await?;
    let route_plan_sub = client.subscribe("sazinka.route.plan").await?;
    let route_save_sub = client.subscribe("sazinka.route.save").await?;
    let route_get_sub = client.subscribe("sazinka.route.get").await?;
    let route_insertion_sub = client.subscribe("sazinka.route.insertion.calculate").await?;
    let route_insertion_batch_sub = client.subscribe("sazinka.route.insertion.batch").await?;
    
    // Device subjects
    let device_create_sub = client.subscribe("sazinka.device.create").await?;
    let device_list_sub = client.subscribe("sazinka.device.list").await?;
    let device_get_sub = client.subscribe("sazinka.device.get").await?;
    let device_update_sub = client.subscribe("sazinka.device.update").await?;
    let device_delete_sub = client.subscribe("sazinka.device.delete").await?;
    
    // Revision subjects
    let revision_create_sub = client.subscribe("sazinka.revision.create").await?;
    let revision_list_sub = client.subscribe("sazinka.revision.list").await?;
    let revision_get_sub = client.subscribe("sazinka.revision.get").await?;
    let revision_update_sub = client.subscribe("sazinka.revision.update").await?;
    let revision_delete_sub = client.subscribe("sazinka.revision.delete").await?;
    let revision_complete_sub = client.subscribe("sazinka.revision.complete").await?;
    let revision_upcoming_sub = client.subscribe("sazinka.revision.upcoming").await?;
    let revision_stats_sub = client.subscribe("sazinka.revision.stats").await?;
    let revision_suggest_sub = client.subscribe("sazinka.revision.suggest").await?;
    let revision_queue_sub = client.subscribe("sazinka.revision.queue").await?;
    let revision_snooze_sub = client.subscribe("sazinka.revision.snooze").await?;
    let revision_schedule_sub = client.subscribe("sazinka.revision.schedule").await?;
    
    // Slots subjects
    let slots_suggest_sub = client.subscribe("sazinka.slots.suggest").await?;
    
    // Settings subjects
    let settings_get_sub = client.subscribe("sazinka.settings.get").await?;
    let settings_work_update_sub = client.subscribe("sazinka.settings.work.update").await?;
    let settings_business_update_sub = client.subscribe("sazinka.settings.business.update").await?;
    let settings_email_update_sub = client.subscribe("sazinka.settings.email.update").await?;
    
    // Depot subjects
    let depot_list_sub = client.subscribe("sazinka.depot.list").await?;
    let depot_create_sub = client.subscribe("sazinka.depot.create").await?;
    let depot_update_sub = client.subscribe("sazinka.depot.update").await?;
    let depot_delete_sub = client.subscribe("sazinka.depot.delete").await?;
    let depot_geocode_sub = client.subscribe("sazinka.depot.geocode").await?;
    
    // Communication subjects
    let comm_create_sub = client.subscribe("sazinka.communication.create").await?;
    let comm_list_sub = client.subscribe("sazinka.communication.list").await?;
    let comm_update_sub = client.subscribe("sazinka.communication.update").await?;
    let comm_delete_sub = client.subscribe("sazinka.communication.delete").await?;
    
    // Visit subjects
    let visit_create_sub = client.subscribe("sazinka.visit.create").await?;
    let visit_list_sub = client.subscribe("sazinka.visit.list").await?;
    let visit_update_sub = client.subscribe("sazinka.visit.update").await?;
    let visit_complete_sub = client.subscribe("sazinka.visit.complete").await?;
    let visit_delete_sub = client.subscribe("sazinka.visit.delete").await?;
    
    // Vehicle subjects
    let vehicle_create_sub = client.subscribe("sazinka.vehicle.create").await?;
    let vehicle_list_sub = client.subscribe("sazinka.vehicle.list").await?;
    let vehicle_update_sub = client.subscribe("sazinka.vehicle.update").await?;
    let vehicle_delete_sub = client.subscribe("sazinka.vehicle.delete").await?;
    
    // Import subjects
    let import_device_sub = client.subscribe("sazinka.import.device").await?;
    let import_revision_sub = client.subscribe("sazinka.import.revision").await?;
    let import_communication_sub = client.subscribe("sazinka.import.communication").await?;
    let import_visit_sub = client.subscribe("sazinka.import.visit").await?;

    info!("Subscribed to NATS subjects");

    // Clone for each handler
    let client_ping = client.clone();
    let client_customer_create = client.clone();
    let client_customer_list = client.clone();
    let client_customer_get = client.clone();
    let client_customer_update = client.clone();
    let client_customer_delete = client.clone();
    let client_customer_random = client.clone();
    let client_customer_list_extended = client.clone();
    let client_customer_summary = client.clone();
    let client_route_plan = client.clone();
    let client_route_save = client.clone();
    let client_route_get = client.clone();
    let client_route_insertion = client.clone();
    let client_route_insertion_batch = client.clone();
    
    // Device handler clones
    let client_device_create = client.clone();
    let client_device_list = client.clone();
    let client_device_get = client.clone();
    let client_device_update = client.clone();
    let client_device_delete = client.clone();
    
    // Revision handler clones
    let client_revision_create = client.clone();
    let client_revision_list = client.clone();
    let client_revision_get = client.clone();
    let client_revision_update = client.clone();
    let client_revision_delete = client.clone();
    let client_revision_complete = client.clone();
    let client_revision_upcoming = client.clone();
    let client_revision_stats = client.clone();
    let client_revision_suggest = client.clone();
    let client_revision_queue = client.clone();
    let client_revision_snooze = client.clone();
    let client_revision_schedule = client.clone();
    let client_slots_suggest = client.clone();
    
    let pool_customer_create = pool.clone();
    let pool_customer_list = pool.clone();
    let pool_customer_get = pool.clone();
    let pool_customer_update = pool.clone();
    let pool_customer_delete = pool.clone();
    let pool_customer_random = pool.clone();
    let pool_customer_list_extended = pool.clone();
    let pool_customer_summary = pool.clone();
    let pool_route_plan = pool.clone();
    let pool_route_save = pool.clone();
    let pool_route_get = pool.clone();
    let pool_route_insertion = pool.clone();
    let pool_route_insertion_batch = pool.clone();
    
    // Device pool clones
    let pool_device_create = pool.clone();
    let pool_device_list = pool.clone();
    let pool_device_get = pool.clone();
    let pool_device_update = pool.clone();
    let pool_device_delete = pool.clone();
    
    // Revision pool clones
    let pool_revision_create = pool.clone();
    let pool_revision_list = pool.clone();
    let pool_revision_get = pool.clone();
    let pool_revision_update = pool.clone();
    let pool_revision_delete = pool.clone();
    let pool_revision_complete = pool.clone();
    let pool_revision_upcoming = pool.clone();
    let pool_revision_stats = pool.clone();
    let pool_revision_suggest = pool.clone();
    let pool_revision_queue = pool.clone();
    let pool_revision_snooze = pool.clone();
    let pool_revision_schedule = pool.clone();
    let pool_slots_suggest = pool.clone();
    
    // Settings handler clones
    let client_settings_get = client.clone();
    let client_settings_work = client.clone();
    let client_settings_business = client.clone();
    let client_settings_email = client.clone();
    
    // Depot handler clones
    let client_depot_list = client.clone();
    let client_depot_create = client.clone();
    let client_depot_update = client.clone();
    let client_depot_delete = client.clone();
    let client_depot_geocode = client.clone();
    
    // Settings pool clones
    let pool_settings_get = pool.clone();
    let pool_settings_work = pool.clone();
    let pool_settings_business = pool.clone();
    let pool_settings_email = pool.clone();
    
    // Depot pool clones
    let pool_depot_list = pool.clone();
    let pool_depot_create = pool.clone();
    let pool_depot_update = pool.clone();
    let pool_depot_delete = pool.clone();
    
    // Communication handler clones
    let client_comm_create = client.clone();
    let client_comm_list = client.clone();
    let client_comm_update = client.clone();
    let client_comm_delete = client.clone();
    
    // Visit handler clones
    let client_visit_create = client.clone();
    let client_visit_list = client.clone();
    let client_visit_update = client.clone();
    let client_visit_complete = client.clone();
    let client_visit_delete = client.clone();
    
    // Communication pool clones
    let pool_comm_create = pool.clone();
    let pool_comm_list = pool.clone();
    let pool_comm_update = pool.clone();
    let pool_comm_delete = pool.clone();
    
    // Visit pool clones
    let pool_visit_create = pool.clone();
    let pool_visit_list = pool.clone();
    let pool_visit_update = pool.clone();
    let pool_visit_complete = pool.clone();
    let pool_visit_delete = pool.clone();
    
    // Vehicle handler clones
    let client_vehicle_create = client.clone();
    let client_vehicle_list = client.clone();
    let client_vehicle_update = client.clone();
    let client_vehicle_delete = client.clone();
    
    // Vehicle pool clones
    let pool_vehicle_create = pool.clone();
    let pool_vehicle_list = pool.clone();
    let pool_vehicle_update = pool.clone();
    let pool_vehicle_delete = pool.clone();
    
    // Import handler clones
    let client_import_device = client.clone();
    let client_import_revision = client.clone();
    let client_import_communication = client.clone();
    let client_import_visit = client.clone();
    
    // Import pool clones
    let pool_import_device = pool.clone();
    let pool_import_revision = pool.clone();
    let pool_import_communication = pool.clone();
    let pool_import_visit = pool.clone();
    
    let geocoder_depot_create = Arc::clone(&geocoder);
    let geocoder_depot_geocode = Arc::clone(&geocoder);
    
    let routing_plan = Arc::clone(&routing_service);
    let routing_insertion = Arc::clone(&routing_service);
    let routing_insertion_batch = Arc::clone(&routing_service);

    // Spawn handlers
    let ping_handle = tokio::spawn(async move {
        ping::handle_ping(client_ping, ping_sub).await
    });

    let customer_create_handle = tokio::spawn(async move {
        customer::handle_create(client_customer_create, customer_create_sub, pool_customer_create).await
    });

    let customer_list_handle = tokio::spawn(async move {
        customer::handle_list(client_customer_list, customer_list_sub, pool_customer_list).await
    });

    let customer_get_handle = tokio::spawn(async move {
        customer::handle_get(client_customer_get, customer_get_sub, pool_customer_get).await
    });

    let customer_update_handle = tokio::spawn(async move {
        customer::handle_update(client_customer_update, customer_update_sub, pool_customer_update).await
    });

    let customer_delete_handle = tokio::spawn(async move {
        customer::handle_delete(client_customer_delete, customer_delete_sub, pool_customer_delete).await
    });


    let customer_random_handle = tokio::spawn(async move {
        customer::handle_random(client_customer_random, customer_random_sub, pool_customer_random).await
    });

    let customer_list_extended_handle = tokio::spawn(async move {
        customer::handle_list_extended(client_customer_list_extended, customer_list_extended_sub, pool_customer_list_extended).await
    });

    let customer_summary_handle = tokio::spawn(async move {
        customer::handle_summary(client_customer_summary, customer_summary_sub, pool_customer_summary).await
    });

    let route_plan_handle = tokio::spawn(async move {
        route::handle_plan(client_route_plan, route_plan_sub, pool_route_plan, routing_plan).await
    });

    let route_save_handle = tokio::spawn(async move {
        route::handle_save(client_route_save, route_save_sub, pool_route_save).await
    });

    let route_get_handle = tokio::spawn(async move {
        route::handle_get(client_route_get, route_get_sub, pool_route_get).await
    });

    let route_insertion_handle = tokio::spawn(async move {
        route::handle_insertion_calculate(client_route_insertion, route_insertion_sub, pool_route_insertion, routing_insertion).await
    });

    let route_insertion_batch_handle = tokio::spawn(async move {
        route::handle_insertion_batch(client_route_insertion_batch, route_insertion_batch_sub, pool_route_insertion_batch, routing_insertion_batch).await
    });

    // Device handlers
    let device_create_handle = tokio::spawn(async move {
        device::handle_create(client_device_create, device_create_sub, pool_device_create).await
    });
    
    let device_list_handle = tokio::spawn(async move {
        device::handle_list(client_device_list, device_list_sub, pool_device_list).await
    });
    
    let device_get_handle = tokio::spawn(async move {
        device::handle_get(client_device_get, device_get_sub, pool_device_get).await
    });
    
    let device_update_handle = tokio::spawn(async move {
        device::handle_update(client_device_update, device_update_sub, pool_device_update).await
    });
    
    let device_delete_handle = tokio::spawn(async move {
        device::handle_delete(client_device_delete, device_delete_sub, pool_device_delete).await
    });
    
    // Revision handlers
    let revision_create_handle = tokio::spawn(async move {
        revision::handle_create(client_revision_create, revision_create_sub, pool_revision_create).await
    });
    
    let revision_list_handle = tokio::spawn(async move {
        revision::handle_list(client_revision_list, revision_list_sub, pool_revision_list).await
    });
    
    let revision_get_handle = tokio::spawn(async move {
        revision::handle_get(client_revision_get, revision_get_sub, pool_revision_get).await
    });
    
    let revision_update_handle = tokio::spawn(async move {
        revision::handle_update(client_revision_update, revision_update_sub, pool_revision_update).await
    });
    
    let revision_delete_handle = tokio::spawn(async move {
        revision::handle_delete(client_revision_delete, revision_delete_sub, pool_revision_delete).await
    });
    
    let revision_complete_handle = tokio::spawn(async move {
        revision::handle_complete(client_revision_complete, revision_complete_sub, pool_revision_complete).await
    });
    
    let revision_upcoming_handle = tokio::spawn(async move {
        revision::handle_upcoming(client_revision_upcoming, revision_upcoming_sub, pool_revision_upcoming).await
    });
    
    let revision_stats_handle = tokio::spawn(async move {
        revision::handle_stats(client_revision_stats, revision_stats_sub, pool_revision_stats).await
    });
    
    let revision_suggest_handle = tokio::spawn(async move {
        revision::handle_suggest(client_revision_suggest, revision_suggest_sub, pool_revision_suggest).await
    });
    
    let revision_queue_handle = tokio::spawn(async move {
        revision::handle_queue(client_revision_queue, revision_queue_sub, pool_revision_queue).await
    });
    
    let revision_snooze_handle = tokio::spawn(async move {
        revision::handle_snooze(client_revision_snooze, revision_snooze_sub, pool_revision_snooze).await
    });
    
    let revision_schedule_handle = tokio::spawn(async move {
        revision::handle_schedule(client_revision_schedule, revision_schedule_sub, pool_revision_schedule).await
    });
    
    // Slots handlers
    let slots_suggest_handle = tokio::spawn(async move {
        slots::handle_suggest(client_slots_suggest, slots_suggest_sub, pool_slots_suggest).await
    });
    
    // Settings handlers
    let settings_get_handle = tokio::spawn(async move {
        settings::handle_get_settings(client_settings_get, settings_get_sub, pool_settings_get).await
    });
    
    let settings_work_handle = tokio::spawn(async move {
        settings::handle_update_work_constraints(client_settings_work, settings_work_update_sub, pool_settings_work).await
    });
    
    let settings_business_handle = tokio::spawn(async move {
        settings::handle_update_business_info(client_settings_business, settings_business_update_sub, pool_settings_business).await
    });
    
    let settings_email_handle = tokio::spawn(async move {
        settings::handle_update_email_templates(client_settings_email, settings_email_update_sub, pool_settings_email).await
    });
    
    // Depot handlers
    let depot_list_handle = tokio::spawn(async move {
        settings::handle_list_depots(client_depot_list, depot_list_sub, pool_depot_list).await
    });
    
    let depot_create_handle = tokio::spawn(async move {
        settings::handle_create_depot(client_depot_create, depot_create_sub, pool_depot_create, geocoder_depot_create).await
    });
    
    let depot_update_handle = tokio::spawn(async move {
        settings::handle_update_depot(client_depot_update, depot_update_sub, pool_depot_update).await
    });
    
    let depot_delete_handle = tokio::spawn(async move {
        settings::handle_delete_depot(client_depot_delete, depot_delete_sub, pool_depot_delete).await
    });
    
    let depot_geocode_handle = tokio::spawn(async move {
        settings::handle_geocode_depot(client_depot_geocode, depot_geocode_sub, geocoder_depot_geocode).await
    });
    
    // Communication handlers
    let comm_create_handle = tokio::spawn(async move {
        communication::handle_create(client_comm_create, comm_create_sub, pool_comm_create).await
    });
    
    let comm_list_handle = tokio::spawn(async move {
        communication::handle_list(client_comm_list, comm_list_sub, pool_comm_list).await
    });
    
    let comm_update_handle = tokio::spawn(async move {
        communication::handle_update(client_comm_update, comm_update_sub, pool_comm_update).await
    });
    
    let comm_delete_handle = tokio::spawn(async move {
        communication::handle_delete(client_comm_delete, comm_delete_sub, pool_comm_delete).await
    });
    
    // Visit handlers
    let visit_create_handle = tokio::spawn(async move {
        visit::handle_create(client_visit_create, visit_create_sub, pool_visit_create).await
    });
    
    let visit_list_handle = tokio::spawn(async move {
        visit::handle_list(client_visit_list, visit_list_sub, pool_visit_list).await
    });
    
    let visit_update_handle = tokio::spawn(async move {
        visit::handle_update(client_visit_update, visit_update_sub, pool_visit_update).await
    });
    
    let visit_complete_handle = tokio::spawn(async move {
        visit::handle_complete(client_visit_complete, visit_complete_sub, pool_visit_complete).await
    });
    
    let visit_delete_handle = tokio::spawn(async move {
        visit::handle_delete(client_visit_delete, visit_delete_sub, pool_visit_delete).await
    });
    
    // Vehicle handlers
    let vehicle_create_handle = tokio::spawn(async move {
        vehicle::handle_create(client_vehicle_create, vehicle_create_sub, pool_vehicle_create).await
    });
    
    let vehicle_list_handle = tokio::spawn(async move {
        vehicle::handle_list(client_vehicle_list, vehicle_list_sub, pool_vehicle_list).await
    });
    
    let vehicle_update_handle = tokio::spawn(async move {
        vehicle::handle_update(client_vehicle_update, vehicle_update_sub, pool_vehicle_update).await
    });
    
    let vehicle_delete_handle = tokio::spawn(async move {
        vehicle::handle_delete(client_vehicle_delete, vehicle_delete_sub, pool_vehicle_delete).await
    });
    
    // Import handlers
    let import_device_handle = tokio::spawn(async move {
        import::handle_device_import(client_import_device, import_device_sub, pool_import_device).await
    });
    
    let import_revision_handle = tokio::spawn(async move {
        import::handle_revision_import(client_import_revision, import_revision_sub, pool_import_revision).await
    });
    
    let import_communication_handle = tokio::spawn(async move {
        import::handle_communication_import(client_import_communication, import_communication_sub, pool_import_communication).await
    });
    
    let import_visit_handle = tokio::spawn(async move {
        import::handle_visit_import(client_import_visit, import_visit_sub, pool_import_visit).await
    });

    // Start admin handlers
    let client_admin = client.clone();
    let pool_admin = pool.clone();
    let valhalla_url = config.valhalla_url.clone();
    let nominatim_url = Some(config.nominatim_url.clone());
    tokio::spawn(async move {
        if let Err(e) = admin::start_admin_handlers(client_admin, pool_admin, valhalla_url, nominatim_url).await {
            error!("Admin handlers error: {}", e);
        }
    });

    // Start geocoding processor and handlers
    let client_geocode = client.clone();
    let pool_geocode = pool.clone();
    let geocoder_batch = Arc::clone(&geocoder);
    tokio::spawn(async move {
        match geocode::GeocodeProcessor::new(client_geocode.clone(), pool_geocode.clone(), geocoder_batch).await {
            Ok(processor) => {
                let processor = Arc::new(processor);
                
                // Subscribe to geocode subjects
                let geocode_submit_sub = match client_geocode.subscribe("sazinka.geocode.submit").await {
                    Ok(sub) => sub,
                    Err(e) => {
                        error!("Failed to subscribe to geocode.submit: {}", e);
                        return;
                    }
                };
                let geocode_pending_sub = match client_geocode.subscribe("sazinka.geocode.pending").await {
                    Ok(sub) => sub,
                    Err(e) => {
                        error!("Failed to subscribe to geocode.pending: {}", e);
                        return;
                    }
                };
                let geocode_address_sub = match client_geocode.subscribe("sazinka.geocode.address.submit").await {
                    Ok(sub) => sub,
                    Err(e) => {
                        error!("Failed to subscribe to geocode.address.submit: {}", e);
                        return;
                    }
                };
                let reverse_geocode_sub = match client_geocode.subscribe("sazinka.geocode.reverse.submit").await {
                    Ok(sub) => sub,
                    Err(e) => {
                        error!("Failed to subscribe to geocode.reverse.submit: {}", e);
                        return;
                    }
                };
                
                // Start submit handler
                let client_submit = client_geocode.clone();
                let processor_submit = Arc::clone(&processor);
                tokio::spawn(async move {
                    if let Err(e) = geocode::handle_geocode_submit(client_submit, geocode_submit_sub, processor_submit).await {
                        error!("Geocode submit handler error: {}", e);
                    }
                });
                
                // Start pending handler
                let client_pending = client_geocode.clone();
                tokio::spawn(async move {
                    if let Err(e) = geocode::handle_geocode_pending(client_pending, geocode_pending_sub, pool_geocode).await {
                        error!("Geocode pending handler error: {}", e);
                    }
                });

                let client_address = client_geocode.clone();
                let processor_address = Arc::clone(&processor);
                tokio::spawn(async move {
                    if let Err(e) = geocode::handle_geocode_address_submit(client_address, geocode_address_sub, processor_address).await {
                        error!("Geocode address submit handler error: {}", e);
                    }
                });

                let client_reverse = client_geocode.clone();
                let processor_reverse = Arc::clone(&processor);
                tokio::spawn(async move {
                    if let Err(e) = geocode::handle_reverse_geocode_submit(client_reverse, reverse_geocode_sub, processor_reverse).await {
                        error!("Reverse geocode submit handler error: {}", e);
                    }
                });
                
                // Start job processors
                let processor_main = Arc::clone(&processor);
                tokio::spawn(async move {
                    if let Err(e) = processor_main.start_processing().await {
                        error!("Geocode processor error: {}", e);
                    }
                });
                let processor_address = Arc::clone(&processor);
                tokio::spawn(async move {
                    if let Err(e) = processor_address.start_address_processing().await {
                        error!("Geocode address processor error: {}", e);
                    }
                });
                let processor_reverse = Arc::clone(&processor);
                tokio::spawn(async move {
                    if let Err(e) = processor_reverse.start_reverse_processing().await {
                        error!("Reverse geocode processor error: {}", e);
                    }
                });
            }
            Err(e) => {
                error!("Failed to create geocode processor: {}", e);
            }
        }
    });

    // Start Valhalla processor (JetStream-based routing)
    if let Some(ref valhalla_url) = config.valhalla_url {
        let client_valhalla = client.clone();
        let valhalla_url_clone = valhalla_url.clone();
        tokio::spawn(async move {
            match crate::services::valhalla_processor::ValhallaProcessor::new(
                client_valhalla.clone(),
                &valhalla_url_clone,
            ).await {
                Ok(processor) => {
                    let processor = Arc::new(processor);
                    
                    // Subscribe to Valhalla job subjects
                    let matrix_submit_sub = match client_valhalla.subscribe("sazinka.valhalla.matrix.submit").await {
                        Ok(sub) => sub,
                        Err(e) => {
                            error!("Failed to subscribe to valhalla.matrix.submit: {}", e);
                            return;
                        }
                    };
                    let geometry_submit_sub = match client_valhalla.subscribe("sazinka.valhalla.geometry.submit").await {
                        Ok(sub) => sub,
                        Err(e) => {
                            error!("Failed to subscribe to valhalla.geometry.submit: {}", e);
                            return;
                        }
                    };
                    
                    // Start submit handlers
                    let client_matrix = client_valhalla.clone();
                    let processor_matrix = Arc::clone(&processor);
                    tokio::spawn(async move {
                        if let Err(e) = handle_valhalla_matrix_submit(client_matrix, matrix_submit_sub, processor_matrix).await {
                            error!("Valhalla matrix submit handler error: {}", e);
                        }
                    });
                    
                    let client_geometry = client_valhalla.clone();
                    let processor_geometry = Arc::clone(&processor);
                    tokio::spawn(async move {
                        if let Err(e) = handle_valhalla_geometry_submit(client_geometry, geometry_submit_sub, processor_geometry).await {
                            error!("Valhalla geometry submit handler error: {}", e);
                        }
                    });
                    
                    // Start job processors
                    let processor_matrix_worker = Arc::clone(&processor);
                    tokio::spawn(async move {
                        if let Err(e) = processor_matrix_worker.start_matrix_processing().await {
                            error!("Valhalla matrix processor error: {}", e);
                        }
                    });
                    
                    let processor_geometry_worker = Arc::clone(&processor);
                    tokio::spawn(async move {
                        if let Err(e) = processor_geometry_worker.start_geometry_processing().await {
                            error!("Valhalla geometry processor error: {}", e);
                        }
                    });
                    
                    info!("Valhalla JetStream processor started");
                }
                Err(e) => {
                    error!("Failed to create Valhalla processor: {}", e);
                }
            }
        });
    } else {
        info!("Valhalla URL not configured, skipping Valhalla JetStream processor");
    }

    // Start route planning job processor (JetStream-based)
    let client_route_jobs = client.clone();
    let pool_route_jobs = pool.clone();
    let routing_service_jobs = Arc::clone(&routing_service);
    tokio::spawn(async move {
        match jobs::JobProcessor::new(client_route_jobs.clone(), pool_route_jobs, routing_service_jobs).await {
            Ok(processor) => {
                let processor = Arc::new(processor);
                
                // Subscribe to route job submit
                let route_submit_sub = match client_route_jobs.subscribe("sazinka.route.submit").await {
                    Ok(sub) => sub,
                    Err(e) => {
                        error!("Failed to subscribe to route.submit: {}", e);
                        return;
                    }
                };
                
                // Start submit handler
                let client_submit = client_route_jobs.clone();
                let processor_submit = Arc::clone(&processor);
                tokio::spawn(async move {
                    if let Err(e) = jobs::handle_job_submit(client_submit, route_submit_sub, processor_submit).await {
                        error!("Route job submit handler error: {}", e);
                    }
                });
                
                // Start job processing
                let processor_main = Arc::clone(&processor);
                tokio::spawn(async move {
                    if let Err(e) = processor_main.start_processing().await {
                        error!("Route job processor error: {}", e);
                    }
                });
                
                info!("Route job processor started");
            }
            Err(e) => {
                error!("Failed to create route job processor: {}", e);
            }
        }
    });

    // Start job management handlers (history, cancel, retry)
    let client_job_history = client.clone();
    let job_history_sub = client.subscribe("sazinka.jobs.history").await?;
    let job_history_handle = tokio::spawn(async move {
        if let Err(e) = jobs::handle_job_history(client_job_history, job_history_sub).await {
            error!("Job history handler error: {}", e);
        }
    });
    
    let client_job_cancel = client.clone();
    let job_cancel_sub = client.subscribe("sazinka.jobs.cancel").await?;
    let job_cancel_handle = tokio::spawn(async move {
        if let Err(e) = jobs::handle_job_cancel(client_job_cancel, job_cancel_sub).await {
            error!("Job cancel handler error: {}", e);
        }
    });
    
    let client_job_retry = client.clone();
    let job_retry_sub = client.subscribe("sazinka.jobs.retry").await?;
    let job_retry_handle = tokio::spawn(async move {
        if let Err(e) = jobs::handle_job_retry(client_job_retry, job_retry_sub).await {
            error!("Job retry handler error: {}", e);
        }
    });

    info!("All handlers started, waiting for messages...");

    // Wait for any handler to finish (which means an error occurred)
    select! {
        result = ping_handle => {
            error!("Ping handler finished: {:?}", result);
        }
        result = customer_create_handle => {
            error!("Customer create handler finished: {:?}", result);
        }
        result = customer_list_handle => {
            error!("Customer list handler finished: {:?}", result);
        }
        result = customer_get_handle => {
            error!("Customer get handler finished: {:?}", result);
        }
        result = customer_update_handle => {
            error!("Customer update handler finished: {:?}", result);
        }
        result = customer_delete_handle => {
            error!("Customer delete handler finished: {:?}", result);
        }
        result = customer_random_handle => {
            error!("Customer random handler finished: {:?}", result);
        }
        result = customer_list_extended_handle => {
            error!("Customer list extended handler finished: {:?}", result);
        }
        result = customer_summary_handle => {
            error!("Customer summary handler finished: {:?}", result);
        }
        result = route_plan_handle => {
            error!("Route plan handler finished: {:?}", result);
        }
        result = route_save_handle => {
            error!("Route save handler finished: {:?}", result);
        }
        result = route_get_handle => {
            error!("Route get handler finished: {:?}", result);
        }
        result = route_insertion_handle => {
            error!("Route insertion handler finished: {:?}", result);
        }
        result = route_insertion_batch_handle => {
            error!("Route insertion batch handler finished: {:?}", result);
        }
        // Device handlers
        result = device_create_handle => {
            error!("Device create handler finished: {:?}", result);
        }
        result = device_list_handle => {
            error!("Device list handler finished: {:?}", result);
        }
        result = device_get_handle => {
            error!("Device get handler finished: {:?}", result);
        }
        result = device_update_handle => {
            error!("Device update handler finished: {:?}", result);
        }
        result = device_delete_handle => {
            error!("Device delete handler finished: {:?}", result);
        }
        // Revision handlers
        result = revision_create_handle => {
            error!("Revision create handler finished: {:?}", result);
        }
        result = revision_list_handle => {
            error!("Revision list handler finished: {:?}", result);
        }
        result = revision_get_handle => {
            error!("Revision get handler finished: {:?}", result);
        }
        result = revision_update_handle => {
            error!("Revision update handler finished: {:?}", result);
        }
        result = revision_delete_handle => {
            error!("Revision delete handler finished: {:?}", result);
        }
        result = revision_complete_handle => {
            error!("Revision complete handler finished: {:?}", result);
        }
        result = revision_upcoming_handle => {
            error!("Revision upcoming handler finished: {:?}", result);
        }
        result = revision_stats_handle => {
            error!("Revision stats handler finished: {:?}", result);
        }
        result = revision_suggest_handle => {
            error!("Revision suggest handler finished: {:?}", result);
        }
        result = revision_queue_handle => {
            error!("Revision queue handler finished: {:?}", result);
        }
        result = revision_snooze_handle => {
            error!("Revision snooze handler finished: {:?}", result);
        }
        result = revision_schedule_handle => {
            error!("Revision schedule handler finished: {:?}", result);
        }
        // Slots handlers
        result = slots_suggest_handle => {
            error!("Slots suggest handler finished: {:?}", result);
        }
        // Settings handlers
        result = settings_get_handle => {
            error!("Settings get handler finished: {:?}", result);
        }
        result = settings_work_handle => {
            error!("Settings work handler finished: {:?}", result);
        }
        result = settings_business_handle => {
            error!("Settings business handler finished: {:?}", result);
        }
        result = settings_email_handle => {
            error!("Settings email handler finished: {:?}", result);
        }
        // Depot handlers
        result = depot_list_handle => {
            error!("Depot list handler finished: {:?}", result);
        }
        result = depot_create_handle => {
            error!("Depot create handler finished: {:?}", result);
        }
        result = depot_update_handle => {
            error!("Depot update handler finished: {:?}", result);
        }
        result = depot_delete_handle => {
            error!("Depot delete handler finished: {:?}", result);
        }
        result = depot_geocode_handle => {
            error!("Depot geocode handler finished: {:?}", result);
        }
        // Communication handlers
        result = comm_create_handle => {
            error!("Communication create handler finished: {:?}", result);
        }
        result = comm_list_handle => {
            error!("Communication list handler finished: {:?}", result);
        }
        result = comm_update_handle => {
            error!("Communication update handler finished: {:?}", result);
        }
        result = comm_delete_handle => {
            error!("Communication delete handler finished: {:?}", result);
        }
        // Visit handlers
        result = visit_create_handle => {
            error!("Visit create handler finished: {:?}", result);
        }
        result = visit_list_handle => {
            error!("Visit list handler finished: {:?}", result);
        }
        result = visit_update_handle => {
            error!("Visit update handler finished: {:?}", result);
        }
        result = visit_complete_handle => {
            error!("Visit complete handler finished: {:?}", result);
        }
        result = visit_delete_handle => {
            error!("Visit delete handler finished: {:?}", result);
        }
        // Vehicle handlers
        result = vehicle_create_handle => {
            error!("Vehicle create handler finished: {:?}", result);
        }
        result = vehicle_list_handle => {
            error!("Vehicle list handler finished: {:?}", result);
        }
        result = vehicle_update_handle => {
            error!("Vehicle update handler finished: {:?}", result);
        }
        result = vehicle_delete_handle => {
            error!("Vehicle delete handler finished: {:?}", result);
        }
        // Import handlers
        result = import_device_handle => {
            error!("Import device handler finished: {:?}", result);
        }
        result = import_revision_handle => {
            error!("Import revision handler finished: {:?}", result);
        }
        result = import_communication_handle => {
            error!("Import communication handler finished: {:?}", result);
        }
        result = import_visit_handle => {
            error!("Import visit handler finished: {:?}", result);
        }
        // Job management handlers
        result = job_history_handle => {
            error!("Job history handler finished: {:?}", result);
        }
        result = job_cancel_handle => {
            error!("Job cancel handler finished: {:?}", result);
        }
        result = job_retry_handle => {
            error!("Job retry handler finished: {:?}", result);
        }
    }

    Ok(())
}
