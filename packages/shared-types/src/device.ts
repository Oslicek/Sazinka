// Device types

import type { DeviceFieldValue } from './deviceTypeConfig';

export interface Device {
  id: string;
  customerId: string;
  userId: string;
  deviceType: DeviceType;
  /** FK to device_type_configs; present after PRJ_DEVICES migration */
  deviceTypeConfigId?: string | null;
  deviceName?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  installationDate?: string | null;
  revisionIntervalMonths: number;
  nextDueDate?: string | null;
  notes?: string | null;
  /** Custom field values for this device's type */
  customFields?: DeviceFieldValue[];
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

/** i18n translation keys for device types — resolve via t(DEVICE_TYPE_KEYS[type]) */
export const DEVICE_TYPE_KEYS: Record<DeviceType, string> = {
  gas_boiler: 'common:device_type.gas_boiler',
  gas_water_heater: 'common:device_type.gas_water_heater',
  chimney: 'common:device_type.chimney',
  fireplace: 'common:device_type.fireplace',
  gas_stove: 'common:device_type.gas_stove',
  other: 'common:device_type.other',
};

export interface CreateDeviceRequest {
  customerId: string;
  deviceType: string;
  /** New: FK to device_type_configs (required after PRJ_DEVICES migration) */
  deviceTypeConfigId?: string;
  deviceName?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  installationDate?: string;
  revisionIntervalMonths: number;
  notes?: string;
  /** Custom field values keyed by fieldId */
  customFields?: DeviceFieldValue[];
}
