import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listDeviceTypeConfigs,
  getDeviceTypeConfig,
  updateDeviceTypeConfig,
  createDeviceTypeField,
  updateDeviceTypeField,
  setFieldActive,
  reorderFields,
  type DeviceTypeConfigServiceDeps,
} from './deviceTypeConfigService';
import type {
  DeviceTypeConfigWithFields,
  DeviceTypeField,
} from '@shared/deviceTypeConfig';

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

describe('deviceTypeConfigService', () => {
  const mockRequest = vi.fn();
  const mockDeps: DeviceTypeConfigServiceDeps = { request: mockRequest };

  beforeEach(() => vi.clearAllMocks());

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------
  const mockField: DeviceTypeField = {
    id: 'field-1',
    deviceTypeConfigId: 'cfg-1',
    fieldKey: 'rated_power',
    label: 'Jmenovitý výkon',
    fieldType: 'number',
    isRequired: false,
    unit: 'kW',
    sortOrder: 0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const mockConfig: DeviceTypeConfigWithFields = {
    config: {
      id: 'cfg-1',
      tenantId: 'tenant-1',
      deviceTypeKey: 'gas_boiler',
      label: 'Plynový kotel',
      isActive: true,
      isBuiltin: true,
      defaultRevisionDurationMinutes: 60,
      defaultRevisionIntervalMonths: 12,
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    fields: [mockField],
  };

  // ---------------------------------------------------------------------------
  // listDeviceTypeConfigs
  // ---------------------------------------------------------------------------
  describe('listDeviceTypeConfigs', () => {
    it('calls correct NATS subject', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { items: [mockConfig] } });
      await listDeviceTypeConfigs({}, mockDeps);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_config.list',
        expect.objectContaining({ payload: {} })
      );
    });

    it('returns array of configs', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { items: [mockConfig] } });
      const result = await listDeviceTypeConfigs({}, mockDeps);
      expect(result).toHaveLength(1);
      expect(result[0].config.deviceTypeKey).toBe('gas_boiler');
    });

    it('passes includeInactive flag', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { items: [] } });
      await listDeviceTypeConfigs({ includeInactive: true }, mockDeps);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_config.list',
        expect.objectContaining({ payload: { includeInactive: true } })
      );
    });

    it('throws on error response', async () => {
      mockRequest.mockResolvedValueOnce({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
      await expect(listDeviceTypeConfigs({}, mockDeps)).rejects.toThrow('Auth required');
    });
  });

  // ---------------------------------------------------------------------------
  // getDeviceTypeConfig
  // ---------------------------------------------------------------------------
  describe('getDeviceTypeConfig', () => {
    it('calls correct NATS subject with id', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockConfig });
      await getDeviceTypeConfig({ id: 'cfg-1' }, mockDeps);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_config.get',
        expect.objectContaining({ payload: { id: 'cfg-1' } })
      );
    });

    it('returns config with fields', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockConfig });
      const result = await getDeviceTypeConfig({ id: 'cfg-1' }, mockDeps);
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].fieldKey).toBe('rated_power');
    });

    it('throws on NOT_FOUND', async () => {
      mockRequest.mockResolvedValueOnce({ error: { code: 'NOT_FOUND', message: 'Config not found' } });
      await expect(getDeviceTypeConfig({ id: 'bad-id' }, mockDeps)).rejects.toThrow('Config not found');
    });
  });

  // ---------------------------------------------------------------------------
  // updateDeviceTypeConfig
  // ---------------------------------------------------------------------------
  describe('updateDeviceTypeConfig', () => {
    it('sends only changed fields', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { ...mockConfig.config } });
      await updateDeviceTypeConfig({ id: 'cfg-1', label: 'Kotel (upravený)' }, mockDeps);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_config.update',
        expect.objectContaining({ payload: { id: 'cfg-1', label: 'Kotel (upravený)' } })
      );
    });

    it('can deactivate a config', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { ...mockConfig.config, isActive: false } });
      await updateDeviceTypeConfig({ id: 'cfg-1', isActive: false }, mockDeps);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_config.update',
        expect.objectContaining({ payload: expect.objectContaining({ isActive: false }) })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // createDeviceTypeField
  // ---------------------------------------------------------------------------
  describe('createDeviceTypeField', () => {
    it('calls correct NATS subject', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockField });
      await createDeviceTypeField({
        deviceTypeConfigId: 'cfg-1',
        fieldKey: 'rated_power',
        label: 'Jmenovitý výkon',
        fieldType: 'number',
        unit: 'kW',
      }, mockDeps);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_field.create',
        expect.objectContaining({
          payload: expect.objectContaining({ fieldKey: 'rated_power', fieldType: 'number' }),
        })
      );
    });

    it('returns created field', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockField });
      const result = await createDeviceTypeField({
        deviceTypeConfigId: 'cfg-1',
        fieldKey: 'rated_power',
        label: 'Jmenovitý výkon',
        fieldType: 'number',
      }, mockDeps);
      expect(result.fieldKey).toBe('rated_power');
    });
  });

  // ---------------------------------------------------------------------------
  // updateDeviceTypeField
  // ---------------------------------------------------------------------------
  describe('updateDeviceTypeField', () => {
    it('does not allow changing fieldKey or fieldType (caller responsibility)', async () => {
      // fieldKey/fieldType are not part of UpdateDeviceTypeFieldRequest type — compile-time enforcement
      const updatePayload = { id: 'field-1', label: 'Výkon' };
      mockRequest.mockResolvedValueOnce({ payload: { ...mockField, label: 'Výkon' } });
      const result = await updateDeviceTypeField(updatePayload, mockDeps);
      expect(result.label).toBe('Výkon');
    });

    it('can update selectOptions', async () => {
      const newOptions = [{ key: 'natural_gas', label: 'zemní plyn' }];
      mockRequest.mockResolvedValueOnce({ payload: { ...mockField, selectOptions: newOptions } });
      await updateDeviceTypeField({ id: 'field-1', selectOptions: newOptions }, mockDeps);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_field.update',
        expect.objectContaining({ payload: expect.objectContaining({ selectOptions: newOptions }) })
      );
    });
  });

  // ---------------------------------------------------------------------------
  // setFieldActive
  // ---------------------------------------------------------------------------
  describe('setFieldActive', () => {
    it('deactivates a field', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { updated: true } });
      const result = await setFieldActive({ id: 'field-1', isActive: false }, mockDeps);
      expect(result).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_field.set_active',
        expect.objectContaining({ payload: { id: 'field-1', isActive: false } })
      );
    });

    it('reactivates a field', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { updated: true } });
      const result = await setFieldActive({ id: 'field-1', isActive: true }, mockDeps);
      expect(result).toBe(true);
    });

    it('throws on NOT_FOUND', async () => {
      mockRequest.mockResolvedValueOnce({ error: { code: 'NOT_FOUND', message: 'Field not found' } });
      await expect(setFieldActive({ id: 'bad-id', isActive: false }, mockDeps)).rejects.toThrow('Field not found');
    });
  });

  // ---------------------------------------------------------------------------
  // reorderFields
  // ---------------------------------------------------------------------------
  describe('reorderFields', () => {
    it('sends deviceTypeConfigId and ordered fieldIds', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { reordered: true } });
      await reorderFields({ deviceTypeConfigId: 'cfg-1', fieldIds: ['field-2', 'field-1'] }, mockDeps);
      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device_type_field.reorder',
        expect.objectContaining({
          payload: { deviceTypeConfigId: 'cfg-1', fieldIds: ['field-2', 'field-1'] },
        })
      );
    });

    it('returns true on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { reordered: true } });
      const result = await reorderFields({ deviceTypeConfigId: 'cfg-1', fieldIds: [] }, mockDeps);
      expect(result).toBe(true);
    });

    it('throws on error', async () => {
      mockRequest.mockResolvedValueOnce({ error: { code: 'NOT_FOUND', message: 'Config not found' } });
      await expect(reorderFields({ deviceTypeConfigId: 'bad', fieldIds: [] }, mockDeps))
        .rejects.toThrow('Config not found');
    });
  });
});
