//! Role database queries

use sqlx::{PgPool, Row};
use uuid::Uuid;
use anyhow::Result;

use crate::types::role::{Role, RoleWithPermissions};

const ROLE_COLUMNS: &str = r#"
    id, owner_id, name, created_at, updated_at
"#;

/// Create a new role
pub async fn create_role(
    pool: &PgPool,
    owner_id: Uuid,
    name: &str,
) -> Result<Role> {
    let query = format!(
        "INSERT INTO roles (owner_id, name) VALUES ($1, $2) RETURNING {}",
        ROLE_COLUMNS
    );
    let role = sqlx::query_as::<_, Role>(&query)
        .bind(owner_id)
        .bind(name)
        .fetch_one(pool)
        .await?;

    Ok(role)
}

/// List all roles for an owner with their permissions
pub async fn list_roles(pool: &PgPool, owner_id: Uuid) -> Result<Vec<RoleWithPermissions>> {
    let query = r#"
        SELECT 
            r.id, r.owner_id, r.name, r.created_at, r.updated_at,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::VARCHAR[]) as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        WHERE r.owner_id = $1
        GROUP BY r.id, r.owner_id, r.name, r.created_at, r.updated_at
        ORDER BY r.name
    "#;
    
    let rows = sqlx::query(query)
        .bind(owner_id)
        .fetch_all(pool)
        .await?;
    
    let mut roles = Vec::new();
    for row in rows {
        roles.push(RoleWithPermissions {
            id: row.get("id"),
            owner_id: row.get("owner_id"),
            name: row.get("name"),
            permissions: row.get("permissions"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        });
    }
    
    Ok(roles)
}

/// Get a single role with permissions
pub async fn get_role(pool: &PgPool, role_id: Uuid, owner_id: Uuid) -> Result<Option<RoleWithPermissions>> {
    let query = r#"
        SELECT 
            r.id, r.owner_id, r.name, r.created_at, r.updated_at,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::VARCHAR[]) as permissions
        FROM roles r
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        WHERE r.id = $1 AND r.owner_id = $2
        GROUP BY r.id, r.owner_id, r.name, r.created_at, r.updated_at
    "#;
    
    let row = sqlx::query(query)
        .bind(role_id)
        .bind(owner_id)
        .fetch_optional(pool)
        .await?;
    
    if let Some(row) = row {
        Ok(Some(RoleWithPermissions {
            id: row.get("id"),
            owner_id: row.get("owner_id"),
            name: row.get("name"),
            permissions: row.get("permissions"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        }))
    } else {
        Ok(None)
    }
}

/// Update role name
pub async fn update_role(
    pool: &PgPool,
    role_id: Uuid,
    owner_id: Uuid,
    name: &str,
) -> Result<bool> {
    let query = "UPDATE roles SET name = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3";
    let result = sqlx::query(query)
        .bind(name)
        .bind(role_id)
        .bind(owner_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

/// Delete a role (cascades to permissions and user_roles)
pub async fn delete_role(pool: &PgPool, role_id: Uuid, owner_id: Uuid) -> Result<bool> {
    let query = "DELETE FROM roles WHERE id = $1 AND owner_id = $2";
    let result = sqlx::query(query)
        .bind(role_id)
        .bind(owner_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

/// Set permissions for a role (replaces all existing permissions)
pub async fn set_role_permissions(
    pool: &PgPool,
    role_id: Uuid,
    permissions: &[String],
) -> Result<()> {
    let mut tx = pool.begin().await?;

    // Delete existing permissions
    sqlx::query("DELETE FROM role_permissions WHERE role_id = $1")
        .bind(role_id)
        .execute(&mut *tx)
        .await?;

    // Insert new permissions
    for permission in permissions {
        sqlx::query("INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, $2)")
            .bind(role_id)
            .bind(permission)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

/// Assign a role to a user
pub async fn assign_role_to_user(
    pool: &PgPool,
    user_id: Uuid,
    role_id: Uuid,
) -> Result<()> {
    let query = "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING";
    sqlx::query(query)
        .bind(user_id)
        .bind(role_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Unassign a role from a user
pub async fn unassign_role_from_user(
    pool: &PgPool,
    user_id: Uuid,
    role_id: Uuid,
) -> Result<bool> {
    let query = "DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2";
    let result = sqlx::query(query)
        .bind(user_id)
        .bind(role_id)
        .execute(pool)
        .await?;

    Ok(result.rows_affected() > 0)
}

/// Get all roles assigned to a user
pub async fn get_user_roles(pool: &PgPool, user_id: Uuid) -> Result<Vec<RoleWithPermissions>> {
    let query = r#"
        SELECT 
            r.id, r.owner_id, r.name, r.created_at, r.updated_at,
            COALESCE(array_agg(rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::VARCHAR[]) as permissions
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        LEFT JOIN role_permissions rp ON r.id = rp.role_id
        WHERE ur.user_id = $1
        GROUP BY r.id, r.owner_id, r.name, r.created_at, r.updated_at
        ORDER BY r.name
    "#;
    
    let rows = sqlx::query(query)
        .bind(user_id)
        .fetch_all(pool)
        .await?;
    
    let mut roles = Vec::new();
    for row in rows {
        roles.push(RoleWithPermissions {
            id: row.get("id"),
            owner_id: row.get("owner_id"),
            name: row.get("name"),
            permissions: row.get("permissions"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        });
    }
    
    Ok(roles)
}

/// Get all permissions for a user (union of all assigned roles)
pub async fn get_user_permissions(pool: &PgPool, user_id: Uuid) -> Result<Vec<String>> {
    let query = r#"
        SELECT DISTINCT rp.permission_key
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        WHERE ur.user_id = $1
        ORDER BY rp.permission_key
    "#;
    
    let rows = sqlx::query(query)
        .bind(user_id)
        .fetch_all(pool)
        .await?;
    
    let permissions: Vec<String> = rows.iter().map(|row| row.get("permission_key")).collect();
    Ok(permissions)
}

/// Bulk-set roles for a user (replaces all existing role assignments)
pub async fn set_user_roles(
    pool: &PgPool,
    user_id: Uuid,
    role_ids: &[Uuid],
) -> Result<()> {
    let mut tx = pool.begin().await?;

    // Delete existing role assignments
    sqlx::query("DELETE FROM user_roles WHERE user_id = $1")
        .bind(user_id)
        .execute(&mut *tx)
        .await?;

    // Insert new role assignments
    for role_id in role_ids {
        sqlx::query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)")
            .bind(user_id)
            .bind(role_id)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}
