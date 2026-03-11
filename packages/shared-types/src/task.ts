// Task and TaskType shared types

export interface TaskType {
  id: string;
  userId: string;
  name: string;
  labelKey: string | null;
  isSystem: boolean;
  isActive: boolean;
  payloadSchema: Record<string, unknown> | null;
  createdAt: string;
}

export interface Task {
  id: string;
  userId: string;
  taskTypeId: string;
  customerId: string;
  visitId: string | null;
  deviceId: string | null;
  status: TaskStatus;
  payload: Record<string, unknown> | null;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined fields
  taskTypeName: string | null;
  taskTypeLabelKey: string | null;
}

export type TaskStatus = 'pending' | 'completed' | 'cancelled';

export interface CreateTaskTypeRequest {
  name: string;
  labelKey?: string | null;
  payloadSchema?: Record<string, unknown> | null;
}

export interface UpdateTaskTypeRequest {
  id: string;
  name?: string | null;
  labelKey?: string | null;
  isActive?: boolean | null;
  payloadSchema?: Record<string, unknown> | null;
}

export interface CreateTaskRequest {
  taskTypeId: string;
  customerId: string;
  visitId?: string | null;
  deviceId?: string | null;
  payload?: Record<string, unknown> | null;
  dueDate?: string | null;
}

export interface UpdateTaskRequest {
  id: string;
  status?: TaskStatus | null;
  payload?: Record<string, unknown> | null;
  dueDate?: string | null;
}

export interface ListTasksRequest {
  customerId?: string | null;
  taskTypeId?: string | null;
  status?: TaskStatus | null;
  limit?: number;
  offset?: number;
}

export interface TaskListResponse {
  items: Task[];
  total: number;
}
