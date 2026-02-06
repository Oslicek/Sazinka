// Device types

export interface Device {
  id: string;
  customerId: string;
  userId: string;
  deviceType: DeviceType;
  deviceName?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  installationDate?: string | null;
  revisionIntervalMonths: number;
  nextDueDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DeviceType =
  | 'gas_boiler'
  | 'gas_water_heater'
  | 'chimney'
  | 'fireplace'
  | 'gas_stove'
  | 'other';

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  gas_boiler: 'Plynový kotel',
  gas_water_heater: 'Plynový ohřívač vody',
  chimney: 'Komín',
  fireplace: 'Krb',
  gas_stove: 'Plynový sporák',
  other: 'Jiné',
};

export interface CreateDeviceRequest {
  customerId: string;
  deviceType: string;
  deviceName?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installationDate?: string;
  revisionIntervalMonths: number;
  notes?: string;
}
