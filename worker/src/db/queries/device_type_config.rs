#![allow(dead_code)]
//! Device type config database queries

use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

use crate::types::device_type_config::{
    CreateDeviceTypeConfigRequest, CreateDeviceTypeFieldRequest, DeviceFieldValue,
    DeviceFieldValueDto, DeviceTypeConfig, DeviceTypeConfigWithFields, DeviceTypeField,
    UpdateDeviceTypeConfigRequest, UpdateDeviceTypeFieldRequest,
};

// =============================================================================
// Tenant lookup
// =============================================================================

/// Look up the tenant_id for a given user (via user_tenants pivot).
/// Returns None if the user has no tenant (should not happen post-migration).
pub async fn get_tenant_id_for_user(pool: &PgPool, user_id: Uuid) -> Result<Option<Uuid>> {
    let row = sqlx::query_scalar::<_, Uuid>(
        "SELECT tenant_id FROM user_tenants WHERE user_id = $1 LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

// =============================================================================
// Device type configs
// =============================================================================

/// List all device type configs for a tenant, with their fields.
pub async fn list_device_type_configs(
    pool: &PgPool,
    tenant_id: Uuid,
    include_inactive: bool,
) -> Result<Vec<DeviceTypeConfigWithFields>> {
    let configs = if include_inactive {
        sqlx::query_as::<_, DeviceTypeConfig>(
            r#"SELECT * FROM device_type_configs WHERE tenant_id = $1 ORDER BY sort_order, label"#,
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, DeviceTypeConfig>(
            r#"SELECT * FROM device_type_configs WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order, label"#,
        )
        .bind(tenant_id)
        .fetch_all(pool)
        .await?
    };

    if configs.is_empty() {
        return Ok(vec![]);
    }

    let config_ids: Vec<Uuid> = configs.iter().map(|c| c.id).collect();

    let all_fields = sqlx::query_as::<_, DeviceTypeField>(
        r#"SELECT * FROM device_type_fields
           WHERE device_type_config_id = ANY($1)
           ORDER BY sort_order"#,
    )
    .bind(&config_ids)
    .fetch_all(pool)
    .await?;

    let result = configs
        .into_iter()
        .map(|config| {
            let fields = all_fields
                .iter()
                .filter(|f| f.device_type_config_id == config.id)
                .cloned()
                .collect();
            DeviceTypeConfigWithFields { config, fields }
        })
        .collect();

    Ok(result)
}

/// Get a single device type config with its fields.
pub async fn get_device_type_config(
    pool: &PgPool,
    tenant_id: Uuid,
    config_id: Uuid,
) -> Result<Option<DeviceTypeConfigWithFields>> {
    let config = sqlx::query_as::<_, DeviceTypeConfig>(
        r#"SELECT * FROM device_type_configs WHERE id = $1 AND tenant_id = $2"#,
    )
    .bind(config_id)
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;

    let Some(config) = config else {
        return Ok(None);
    };

    let fields = sqlx::query_as::<_, DeviceTypeField>(
        r#"SELECT * FROM device_type_fields WHERE device_type_config_id = $1 ORDER BY sort_order"#,
    )
    .bind(config.id)
    .fetch_all(pool)
    .await?;

    Ok(Some(DeviceTypeConfigWithFields { config, fields }))
}

/// Update label, isActive, default durations, sortOrder for a device type config.
/// Returns the updated config with its fields (same shape as get_device_type_config).
pub async fn update_device_type_config(
    pool: &PgPool,
    tenant_id: Uuid,
    req: &UpdateDeviceTypeConfigRequest,
) -> Result<Option<DeviceTypeConfigWithFields>> {
    let config = sqlx::query_as::<_, DeviceTypeConfig>(
        r#"UPDATE device_type_configs SET
            label                             = COALESCE($3, label),
            is_active                         = COALESCE($4, is_active),
            default_revision_duration_minutes = COALESCE($5, default_revision_duration_minutes),
            default_revision_interval_months  = COALESCE($6, default_revision_interval_months),
            sort_order                        = COALESCE($7, sort_order)
        WHERE id = $1 AND tenant_id = $2
        RETURNING *"#,
    )
    .bind(req.id)
    .bind(tenant_id)
    .bind(&req.label)
    .bind(req.is_active)
    .bind(req.default_revision_duration_minutes)
    .bind(req.default_revision_interval_months)
    .bind(req.sort_order)
    .fetch_optional(pool)
    .await?;

    let Some(config) = config else {
        return Ok(None);
    };

    let fields = sqlx::query_as::<_, DeviceTypeField>(
        r#"SELECT * FROM device_type_fields WHERE device_type_config_id = $1 ORDER BY sort_order"#,
    )
    .bind(config.id)
    .fetch_all(pool)
    .await?;

    Ok(Some(DeviceTypeConfigWithFields { config, fields }))
}

/// Create a new custom (non-builtin) device type config for the tenant.
/// If `device_type_key` is not provided, a slug is generated from `label`.
/// Returns None if the generated/provided key already exists for this tenant.
pub async fn create_device_type_config(
    pool: &PgPool,
    tenant_id: Uuid,
    req: &CreateDeviceTypeConfigRequest,
) -> Result<Option<DeviceTypeConfigWithFields>> {
    // Generate device_type_key from label if not provided
    let key = match &req.device_type_key {
        Some(k) if !k.trim().is_empty() => slugify(k),
        _ => slugify(&req.label),
    };

    // Check uniqueness
    let exists: bool = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM device_type_configs WHERE tenant_id = $1 AND device_type_key = $2)",
    )
    .bind(tenant_id)
    .bind(&key)
    .fetch_one(pool)
    .await?;

    if exists {
        return Ok(None);
    }

    let next_sort_order: i64 = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM device_type_configs WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;

    let config = sqlx::query_as::<_, DeviceTypeConfig>(
        r#"INSERT INTO device_type_configs
            (id, tenant_id, device_type_key, label, is_active, is_builtin,
             default_revision_duration_minutes, default_revision_interval_months, sort_order)
        VALUES (uuid_generate_v4(), $1, $2, $3, true, false, $4, $5, $6)
        RETURNING *"#,
    )
    .bind(tenant_id)
    .bind(&key)
    .bind(&req.label)
    .bind(req.default_revision_duration_minutes)
    .bind(req.default_revision_interval_months)
    .bind(next_sort_order as i32)
    .fetch_one(pool)
    .await?;

    Ok(Some(DeviceTypeConfigWithFields { config, fields: vec![] }))
}

/// Convert a string to a lowercase ASCII slug (spaces → `_`, strip non-alphanumeric except `_`).
fn slugify(s: &str) -> String {
    // Basic ASCII transliteration for common Czech/Slovak characters
    let transliterated: String = s.chars().map(|c| match c {
        'á' | 'à' | 'ä' | 'â' => 'a',
        'č' => 'c',
        'ď' => 'd',
        'é' | 'ě' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' => 'i',
        'ľ' | 'ĺ' => 'l',
        'ň' => 'n',
        'ó' | 'ô' | 'ö' | 'ò' => 'o',
        'ř' => 'r',
        'š' => 's',
        'ť' => 't',
        'ú' | 'ů' | 'ü' | 'ù' | 'û' => 'u',
        'ý' => 'y',
        'ž' => 'z',
        ' ' | '-' | '/' => '_',
        other => other,
    }).collect();

    transliterated
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

// =============================================================================
// Device type fields
// =============================================================================

/// Create a new field in a device type template.
/// Verifies the config belongs to the tenant.
pub async fn create_device_type_field(
    pool: &PgPool,
    tenant_id: Uuid,
    req: &CreateDeviceTypeFieldRequest,
) -> Result<Option<DeviceTypeField>> {
    // Verify the config belongs to this tenant
    let owned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM device_type_configs WHERE id = $1 AND tenant_id = $2)",
    )
    .bind(req.device_type_config_id)
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;

    if !owned {
        return Ok(None);
    }

    // Place at end of existing fields
    let next_sort_order = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM device_type_fields WHERE device_type_config_id = $1",
    )
    .bind(req.device_type_config_id)
    .fetch_one(pool)
    .await? as i32;

    let field = sqlx::query_as::<_, DeviceTypeField>(
        r#"INSERT INTO device_type_fields
            (device_type_config_id, field_key, label, field_type, is_required,
             select_options, default_value, unit, placeholder, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *"#,
    )
    .bind(req.device_type_config_id)
    .bind(&req.field_key)
    .bind(&req.label)
    .bind(&req.field_type)
    .bind(req.is_required)
    .bind(&req.select_options)
    .bind(&req.default_value)
    .bind(&req.unit)
    .bind(&req.placeholder)
    .bind(next_sort_order)
    .fetch_one(pool)
    .await?;

    Ok(Some(field))
}

/// Update a field's mutable attributes (label, isRequired, defaultValue, selectOptions, unit, placeholder).
/// fieldKey and fieldType are immutable.
pub async fn update_device_type_field(
    pool: &PgPool,
    tenant_id: Uuid,
    req: &UpdateDeviceTypeFieldRequest,
) -> Result<Option<DeviceTypeField>> {
    let field = sqlx::query_as::<_, DeviceTypeField>(
        r#"UPDATE device_type_fields f SET
            label          = COALESCE($3, f.label),
            is_required    = COALESCE($4, f.is_required),
            default_value  = COALESCE($5, f.default_value),
            select_options = COALESCE($6, f.select_options),
            unit           = COALESCE($7, f.unit),
            placeholder    = COALESCE($8, f.placeholder)
        FROM device_type_configs c
        WHERE f.id = $1
          AND f.device_type_config_id = c.id
          AND c.tenant_id = $2
        RETURNING f.*"#,
    )
    .bind(req.id)
    .bind(tenant_id)
    .bind(&req.label)
    .bind(req.is_required)
    .bind(&req.default_value)
    .bind(&req.select_options)
    .bind(&req.unit)
    .bind(&req.placeholder)
    .fetch_optional(pool)
    .await?;
    Ok(field)
}

/// Activate or deactivate a field. Existing values are preserved on deactivation.
pub async fn set_field_active(
    pool: &PgPool,
    tenant_id: Uuid,
    field_id: Uuid,
    is_active: bool,
) -> Result<bool> {
    let result = sqlx::query(
        r#"UPDATE device_type_fields f SET is_active = $3
        FROM device_type_configs c
        WHERE f.id = $1
          AND f.device_type_config_id = c.id
          AND c.tenant_id = $2"#,
    )
    .bind(field_id)
    .bind(tenant_id)
    .bind(is_active)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Reorder fields by assigning sort_order = index in the provided list.
/// Verifies the config belongs to the tenant.
pub async fn reorder_fields(
    pool: &PgPool,
    tenant_id: Uuid,
    device_type_config_id: Uuid,
    field_ids: &[Uuid],
) -> Result<bool> {
    let owned = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM device_type_configs WHERE id = $1 AND tenant_id = $2)",
    )
    .bind(device_type_config_id)
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;

    if !owned {
        return Ok(false);
    }

    for (i, field_id) in field_ids.iter().enumerate() {
        sqlx::query(
            "UPDATE device_type_fields SET sort_order = $1 WHERE id = $2 AND device_type_config_id = $3",
        )
        .bind(i as i32)
        .bind(field_id)
        .bind(device_type_config_id)
        .execute(pool)
        .await?;
    }

    Ok(true)
}

// =============================================================================
// Device field values
// =============================================================================

/// Upsert a set of custom field values for a device.
pub async fn upsert_device_field_values(
    pool: &PgPool,
    device_id: Uuid,
    values: &[(Uuid, serde_json::Value)], // (field_id, value_json)
) -> Result<()> {
    for (field_id, value_json) in values {
        sqlx::query(
            r#"INSERT INTO device_field_values (id, device_id, field_id, value_json)
               VALUES (uuid_generate_v4(), $1, $2, $3)
               ON CONFLICT (device_id, field_id)
               DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()"#,
        )
        .bind(device_id)
        .bind(field_id)
        .bind(value_json)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Load all custom field values for a batch of devices.
/// Returns (device_id, field_id, field_key, value_json) tuples.
pub async fn load_field_values_for_devices(
    pool: &PgPool,
    device_ids: &[Uuid],
) -> Result<Vec<DeviceFieldValue>> {
    if device_ids.is_empty() {
        return Ok(vec![]);
    }
    let values = sqlx::query_as::<_, DeviceFieldValue>(
        r#"SELECT dfv.* FROM device_field_values dfv
           WHERE dfv.device_id = ANY($1)"#,
    )
    .bind(device_ids)
    .fetch_all(pool)
    .await?;
    Ok(values)
}

/// Load field values as DTOs (with field_key) for a single device.
pub async fn load_field_value_dtos_for_device(
    pool: &PgPool,
    device_id: Uuid,
) -> Result<Vec<DeviceFieldValueDto>> {
    let rows = sqlx::query_as::<_, (Uuid, String, serde_json::Value)>(
        r#"SELECT dfv.field_id, dtf.field_key, dfv.value_json
           FROM device_field_values dfv
           JOIN device_type_fields dtf ON dtf.id = dfv.field_id
           WHERE dfv.device_id = $1"#,
    )
    .bind(device_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(field_id, field_key, value)| DeviceFieldValueDto {
            field_id,
            field_key,
            value,
        })
        .collect())
}
