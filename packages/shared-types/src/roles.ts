// Role management types

export interface Role {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleWithPermissions {
  id: string;
  ownerId: string;
  name: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoleRequest {
  name: string;
  permissions: string[];
}

export interface UpdateRoleRequest {
  id: string;
  name?: string;
  permissions?: string[];
}

export interface AssignRoleRequest {
  userId: string;
  roleId: string;
}

export interface UnassignRoleRequest {
  userId: string;
  roleId: string;
}

export interface SetUserRolesRequest {
  userId: string;
  roleIds: string[];
}

export interface UserRole {
  id: string;
  name: string;
}
