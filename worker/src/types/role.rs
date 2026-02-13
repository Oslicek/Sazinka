use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// A custom role created by a company owner
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Role {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// A role with its associated permissions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleWithPermissions {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub name: String,
    pub permissions: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Request to create a new role
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRoleRequest {
    pub name: String,
    pub permissions: Vec<String>,
}

/// Request to update an existing role
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateRoleRequest {
    pub id: Uuid,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub permissions: Option<Vec<String>>,
}

/// Request to assign a role to a user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignRoleRequest {
    pub user_id: Uuid,
    pub role_id: Uuid,
}

/// Request to unassign a role from a user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnassignRoleRequest {
    pub user_id: Uuid,
    pub role_id: Uuid,
}

/// Request to bulk-set roles for a user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetUserRolesRequest {
    pub user_id: Uuid,
    pub role_ids: Vec<Uuid>,
}

/// User's computed permissions from all assigned roles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPermissions {
    pub user_id: Uuid,
    pub permissions: Vec<String>,
}

/// Response containing a list of roles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListRolesResponse {
    pub roles: Vec<RoleWithPermissions>,
}

/// Response containing a single role
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetRoleResponse {
    pub role: RoleWithPermissions,
}

/// Response containing user's roles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRolesResponse {
    pub user_id: Uuid,
    pub roles: Vec<RoleWithPermissions>,
}
