import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDevice,
  listDevices,
  getDevice,
  updateDevice,
  deleteDevice,
  type DeviceServiceDeps,
} from './deviceService';
import type { Device, CreateDeviceRequest } from '@shared/device';

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-user-id',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

describe('deviceService', () => {
  const mockRequest = vi.fn();
  const mockDeps: DeviceServiceDeps = {
    request: mockRequest,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockDevice: Device = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    customerId: 'customer-123',
    userId: 'user-123',
    deviceType: 'gas_boiler',
    manufacturer: 'Junkers',
    model: 'Cerapur',
    serialNumber: 'SN12345',
    installationDate: '2020-01-15',
    revisionIntervalMonths: 12,
    notes: 'Hlavní kotel',
    createdAt: '2026-01-26T12:00:00Z',
    updatedAt: '2026-01-26T12:00:00Z',
  };

  describe('createDevice', () => {
    const createRequest: CreateDeviceRequest = {
      customerId: 'customer-123',
      deviceType: 'gas_boiler',
      manufacturer: 'Junkers',
      model: 'Cerapur',
      serialNumber: 'SN12345',
      installationDate: '2020-01-15',
      revisionIntervalMonths: 12,
      notes: 'Hlavní kotel',
    };

    it('should call NATS with correct subject and payload', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockDevice });

      await createDevice(createRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device.create',
        expect.objectContaining({
          payload: createRequest,
        })
      );
    });

    it('should return created device on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockDevice });

      const result = await createDevice(createRequest, mockDeps);

      expect(result).toEqual(mockDevice);
    });

    it('should throw error when NATS returns error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'Connection failed' },
      });

      await expect(createDevice(createRequest, mockDeps)).rejects.toThrow(
        'Connection failed'
      );
    });

    it('should include request id and timestamp', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockDevice });

      await createDevice(createRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device.create',
        expect.objectContaining({
          id: expect.any(String),
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('listDevices', () => {
    const mockDevices: Device[] = [mockDevice];

    it('should call NATS with correct subject and customerId', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockDevices, total: 1 },
      });

      await listDevices('customer-123', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device.list',
        expect.objectContaining({
          payload: { customerId: 'customer-123' },
        })
      );
    });

    it('should return list of devices', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockDevices, total: 1 },
      });

      const result = await listDevices('customer-123', mockDeps);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should throw error when NATS returns error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'Query failed' },
      });

      await expect(listDevices('customer-123', mockDeps)).rejects.toThrow(
        'Query failed'
      );
    });
  });

  describe('getDevice', () => {
    it('should call NATS with correct subject and device/customer ids', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockDevice });

      await getDevice('device-123', 'customer-123', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device.get',
        expect.objectContaining({
          payload: { id: 'device-123', customerId: 'customer-123' },
        })
      );
    });

    it('should return device on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockDevice });

      const result = await getDevice('device-123', 'customer-123', mockDeps);

      expect(result).toEqual(mockDevice);
    });

    it('should throw error when device not found', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'NOT_FOUND', message: 'Device not found' },
      });

      await expect(
        getDevice('device-123', 'customer-123', mockDeps)
      ).rejects.toThrow('Device not found');
    });
  });

  describe('updateDevice', () => {
    const updateRequest = {
      id: 'device-123',
      manufacturer: 'Vaillant',
      model: 'ecoTEC',
    };

    it('should call NATS with correct subject and update data', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { ...mockDevice, ...updateRequest } });

      await updateDevice('customer-123', updateRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device.update',
        expect.objectContaining({
          payload: { ...updateRequest, customerId: 'customer-123' },
        })
      );
    });

    it('should return updated device on success', async () => {
      const updatedDevice = { ...mockDevice, manufacturer: 'Vaillant', model: 'ecoTEC' };
      mockRequest.mockResolvedValueOnce({ payload: updatedDevice });

      const result = await updateDevice('customer-123', updateRequest, mockDeps);

      expect(result.manufacturer).toBe('Vaillant');
      expect(result.model).toBe('ecoTEC');
    });

    it('should throw error when device not found', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'NOT_FOUND', message: 'Device not found' },
      });

      await expect(
        updateDevice('customer-123', updateRequest, mockDeps)
      ).rejects.toThrow('Device not found');
    });
  });

  describe('deleteDevice', () => {
    it('should call NATS with correct subject and device/customer ids', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { deleted: true } });

      await deleteDevice('device-123', 'customer-123', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.device.delete',
        expect.objectContaining({
          payload: { id: 'device-123', customerId: 'customer-123' },
        })
      );
    });

    it('should return true on successful deletion', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { deleted: true } });

      const result = await deleteDevice('device-123', 'customer-123', mockDeps);

      expect(result).toBe(true);
    });

    it('should throw error when device not found', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'NOT_FOUND', message: 'Device not found' },
      });

      await expect(
        deleteDevice('device-123', 'customer-123', mockDeps)
      ).rejects.toThrow('Device not found');
    });
  });
});
