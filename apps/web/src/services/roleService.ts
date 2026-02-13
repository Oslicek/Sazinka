/**
 * Role service - handles RBAC role CRUD operations
 */

import type { SuccessResponse, ErrorResponse } from '@shared/messages';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';
import type { RoleWithPermissions } from '@shared/auth';

type NatsResponse<T> = SuccessResponse<T> | ErrorResponse;

function isErrorResponse(response: NatsResponse<unknown>): response is ErrorResponse {
  return 'error' in response;
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

export interface ListRolesResponse {
  roles: RoleWithPermissions[];
}

export interface GetRoleResponse {
  role: RoleWithPermissions;
}

export interface UserRolesResponse {
  userId: string;
  roles: RoleWithPermissions[];
}

// Dependency injection type for testing
export interface RoleServiceDeps {
  request: ReturnType<typeof useNatsStore.getState>['request'];
}

/**
 * Create a new role
 */
export async function createRole(
  payload: CreateRoleRequest,
  deps?: RoleServiceDeps
): Promise<RoleWithPermissions> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), payload);

  const response = await nats<RoleWithPermissions>('sazinka.role.create', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to create role');
  }

  return response.payload;
}

/**
 * List all roles for the current company
 */
export async function listRoles(
  deps?: RoleServiceDeps
): Promise<RoleWithPermissions[]> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), {});

  const response = await nats<ListRolesResponse>('sazinka.role.list', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to list roles');
  }

  return response.payload.roles;
}

/**
 * Get a single role by ID
 */
export async function getRole(
  roleId: string,
  deps?: RoleServiceDeps
): Promise<RoleWithPermissions> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), roleId);

  const response = await nats<GetRoleResponse>('sazinka.role.get', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to get role');
  }

  return response.payload.role;
}

/**
 * Update an existing role
 */
export async function updateRole(
  payload: UpdateRoleRequest,
  deps?: RoleServiceDeps
): Promise<RoleWithPermissions> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), payload);

  const response = await nats<RoleWithPermissions>('sazinka.role.update', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to update role');
  }

  return response.payload;
}

/**
 * Delete a role
 */
export async function deleteRole(
  roleId: string,
  deps?: RoleServiceDeps
): Promise<void> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), roleId);

  const response = await nats<void>('sazinka.role.delete', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to delete role');
  }
}

/**
 * Assign a role to a user
 */
export async function assignRole(
  payload: AssignRoleRequest,
  deps?: RoleServiceDeps
): Promise<void> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), payload);

  const response = await nats<void>('sazinka.role.assign', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to assign role');
  }
}

/**
 * Unassign a role from a user
 */
export async function unassignRole(
  payload: UnassignRoleRequest,
  deps?: RoleServiceDeps
): Promise<void> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), payload);

  const response = await nats<void>('sazinka.role.unassign', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to unassign role');
  }
}

/**
 * Get all roles assigned to a user
 */
export async function getUserRoles(
  userId: string,
  deps?: RoleServiceDeps
): Promise<RoleWithPermissions[]> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), userId);

  const response = await nats<UserRolesResponse>('sazinka.user.roles.get', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to get user roles');
  }

  return response.payload.roles;
}

/**
 * Bulk-set roles for a user (replaces all existing role assignments)
 */
export async function setUserRoles(
  payload: SetUserRolesRequest,
  deps?: RoleServiceDeps
): Promise<void> {
  const nats = deps?.request || useNatsStore.getState().request;
  const request = createRequest(getToken(), payload);

  const response = await nats<void>('sazinka.user.roles.set', request, 5000);

  if (isErrorResponse(response)) {
    throw new Error(response.error.message || 'Failed to set user roles');
  }
}
