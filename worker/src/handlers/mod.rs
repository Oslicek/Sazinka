//! NATS message handlers

pub mod admin;
pub mod customer;
pub mod device;
pub mod geocode;
pub mod jobs;
pub mod ping;
pub mod revision;
pub mod route;
pub mod settings;

use std::sync::Arc;
use anyhow::Result;
use async_nats::Client;
use sqlx::PgPool;
use tracing::{info, error};
use tokio::select;

use crate::config::Config;
use crate::services::geocoding::{create_geocoder, Geocoder};
use crate::services::routing::{RoutingService, create_routing_service_with_fallback};

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
    let customer_geocode_sub = client.subscribe("sazinka.customer.geocode").await?;
    let customer_random_sub = client.subscribe("sazinka.customer.random").await?;
    let route_plan_sub = client.subscribe("sazinka.route.plan").await?;
    let route_save_sub = client.subscribe("sazinka.route.save").await?;
    let route_get_sub = client.subscribe("sazinka.route.get").await?;
    
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

    info!("Subscribed to NATS subjects");

    // Clone for each handler
    let client_ping = client.clone();
    let client_customer_create = client.clone();
    let client_customer_list = client.clone();
    let client_customer_get = client.clone();
    let client_customer_update = client.clone();
    let client_customer_delete = client.clone();
    let client_customer_geocode = client.clone();
    let client_customer_random = client.clone();
    let client_route_plan = client.clone();
    let client_route_save = client.clone();
    let client_route_get = client.clone();
    
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
    
    let pool_customer_create = pool.clone();
    let pool_customer_list = pool.clone();
    let pool_customer_get = pool.clone();
    let pool_customer_update = pool.clone();
    let pool_customer_delete = pool.clone();
    let pool_customer_random = pool.clone();
    let pool_route_plan = pool.clone();
    let pool_route_save = pool.clone();
    let pool_route_get = pool.clone();
    
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
    
    let geocoder_create = Arc::clone(&geocoder);
    let geocoder_update = Arc::clone(&geocoder);
    let geocoder_geocode = Arc::clone(&geocoder);
    let geocoder_depot_create = Arc::clone(&geocoder);
    let geocoder_depot_geocode = Arc::clone(&geocoder);
    
    let routing_plan = Arc::clone(&routing_service);

    // Spawn handlers
    let ping_handle = tokio::spawn(async move {
        ping::handle_ping(client_ping, ping_sub).await
    });

    let customer_create_handle = tokio::spawn(async move {
        customer::handle_create(client_customer_create, customer_create_sub, pool_customer_create, geocoder_create).await
    });

    let customer_list_handle = tokio::spawn(async move {
        customer::handle_list(client_customer_list, customer_list_sub, pool_customer_list).await
    });

    let customer_get_handle = tokio::spawn(async move {
        customer::handle_get(client_customer_get, customer_get_sub, pool_customer_get).await
    });

    let customer_update_handle = tokio::spawn(async move {
        customer::handle_update(client_customer_update, customer_update_sub, pool_customer_update, geocoder_update).await
    });

    let customer_delete_handle = tokio::spawn(async move {
        customer::handle_delete(client_customer_delete, customer_delete_sub, pool_customer_delete).await
    });

    let customer_geocode_handle = tokio::spawn(async move {
        customer::handle_geocode(client_customer_geocode, customer_geocode_sub, geocoder_geocode).await
    });

    let customer_random_handle = tokio::spawn(async move {
        customer::handle_random(client_customer_random, customer_random_sub, pool_customer_random).await
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
                
                // Start job processor
                if let Err(e) = processor.start_processing().await {
                    error!("Geocode processor error: {}", e);
                }
            }
            Err(e) => {
                error!("Failed to create geocode processor: {}", e);
            }
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
        result = customer_geocode_handle => {
            error!("Customer geocode handler finished: {:?}", result);
        }
        result = customer_random_handle => {
            error!("Customer random handler finished: {:?}", result);
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
    }

    Ok(())
}
