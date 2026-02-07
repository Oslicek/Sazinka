import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  createCustomer, 
  listCustomers, 
  submitGeocodeJob, 
  subscribeToGeocodeJobStatus,
  submitGeocodeAddressJob,
  subscribeToGeocodeAddressJobStatus,
  submitReverseGeocodeJob,
  subscribeToReverseGeocodeJobStatus,
  type CustomerServiceDeps 
} from './customerService';
import type { CreateCustomerRequest, Customer } from '@shared/customer';

describe('customerService', () => {
  const mockRequest = vi.fn();
  const mockSubscribe = vi.fn();
  const mockDeps: CustomerServiceDeps = {
    request: mockRequest,
    subscribe: mockSubscribe,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createCustomer', () => {
    const validCustomerData: CreateCustomerRequest = {
      name: 'Jan Novák',
      email: 'jan@example.com',
      phone: '+420 123 456 789',
      street: 'Hlavní 123',
      city: 'Praha',
      postalCode: '11000',
      country: 'CZ',
      notes: 'Testovací zákazník',
    };

    const mockCustomerResponse: Customer = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      userId: 'user-123',
      type: 'person',
      name: 'Jan Novák',
      email: 'jan@example.com',
      phone: '+420 123 456 789',
      street: 'Hlavní 123',
      city: 'Praha',
      postalCode: '11000',
      country: 'CZ',
      geocodeStatus: 'pending',
      notes: 'Testovací zákazník',
      createdAt: '2026-01-26T12:00:00Z',
      updatedAt: '2026-01-26T12:00:00Z',
    };

    it('should call NATS with correct subject and payload', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCustomerResponse });

      await createCustomer('user-123', validCustomerData, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.customer.create',
        expect.objectContaining({
          userId: 'user-123',
          payload: validCustomerData,
        })
      );
    });

    it('should return created customer on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCustomerResponse });

      const result = await createCustomer('user-123', validCustomerData, mockDeps);

      expect(result).toEqual(mockCustomerResponse);
    });

    it('should throw error when NATS returns error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'Connection failed' },
      });

      await expect(createCustomer('user-123', validCustomerData, mockDeps)).rejects.toThrow(
        'Connection failed'
      );
    });

    it('should throw error when NATS request fails', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Network error'));

      await expect(createCustomer('user-123', validCustomerData, mockDeps)).rejects.toThrow(
        'Network error'
      );
    });

    it('should include request id and timestamp', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCustomerResponse });

      await createCustomer('user-123', validCustomerData, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.customer.create',
        expect.objectContaining({
          id: expect.any(String),
          timestamp: expect.any(String),
        })
      );
    });

    it('should use camelCase userId field for backend compatibility', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCustomerResponse });

      await createCustomer('user-123', validCustomerData, mockDeps);

      const callArgs = mockRequest.mock.calls[0][1];
      // Verify camelCase is used (not snake_case user_id)
      expect(callArgs).toHaveProperty('userId', 'user-123');
      expect(callArgs).not.toHaveProperty('user_id');
    });
  });

  describe('listCustomers', () => {
    const mockCustomers: Customer[] = [
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        userId: 'user-123',
        type: 'person',
        name: 'Jan Novák',
        street: 'Hlavní 123',
        city: 'Praha',
        postalCode: '11000',
        country: 'CZ',
        geocodeStatus: 'success',
        createdAt: '2026-01-26T12:00:00Z',
        updatedAt: '2026-01-26T12:00:00Z',
      },
      {
        id: '223e4567-e89b-12d3-a456-426614174001',
        userId: 'user-123',
        type: 'person',
        name: 'Petr Svoboda',
        street: 'Vedlejší 456',
        city: 'Brno',
        postalCode: '60200',
        country: 'CZ',
        geocodeStatus: 'pending',
        createdAt: '2026-01-26T12:00:00Z',
        updatedAt: '2026-01-26T12:00:00Z',
      },
    ];

    it('should call NATS with correct subject', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockCustomers, total: 2, limit: 50, offset: 0 },
      });

      await listCustomers('user-123', {}, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.customer.list',
        expect.objectContaining({
          userId: 'user-123',
        })
      );
    });

    it('should return list of customers', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockCustomers, total: 2, limit: 50, offset: 0 },
      });

      const result = await listCustomers('user-123', {}, mockDeps);

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should pass pagination parameters', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: [], total: 0, limit: 10, offset: 20 },
      });

      await listCustomers('user-123', { limit: 10, offset: 20 }, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.customer.list',
        expect.objectContaining({
          payload: { limit: 10, offset: 20 },
        })
      );
    });
  });

  describe('submitGeocodeJob', () => {
    it('should call NATS with correct subject and payload', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { jobId: 'job-123', message: 'ok' } });

      await submitGeocodeJob('user-123', ['cust-1'], mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.geocode.submit',
        expect.objectContaining({
          userId: 'user-123',
          payload: expect.objectContaining({
            customerIds: ['cust-1'],
          }),
        })
      );
    });

    it('should return job response on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { jobId: 'job-123', message: 'ok' } });

      const result = await submitGeocodeJob('user-123', ['cust-1'], mockDeps);

      expect(result.jobId).toBe('job-123');
    });

    it('should throw error when NATS returns error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'SUBMIT_ERROR', message: 'Queue error' },
      });

      await expect(submitGeocodeJob('user-123', ['cust-1'], mockDeps)).rejects.toThrow(
        'Queue error'
      );
    });
  });

  describe('subscribeToGeocodeJobStatus', () => {
    it('should subscribe to job status subject', async () => {
      mockSubscribe.mockResolvedValueOnce(() => {});
      const callback = vi.fn();

      await subscribeToGeocodeJobStatus('job-123', callback, mockDeps);

      expect(mockSubscribe).toHaveBeenCalledWith(
        'sazinka.job.geocode.status.job-123',
        callback
      );
    });
  });

  describe('submitGeocodeAddressJob', () => {
    it('should call NATS with correct subject and payload', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { jobId: 'job-addr', message: 'ok' } });

      await submitGeocodeAddressJob('user-123', { street: 'A', city: 'B', postalCode: '10000' }, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.geocode.address.submit',
        expect.objectContaining({
          userId: 'user-123',
          payload: expect.objectContaining({
            street: 'A',
            city: 'B',
            postalCode: '10000',
          }),
        })
      );
    });
  });

  describe('subscribeToGeocodeAddressJobStatus', () => {
    it('should subscribe to address job status subject', async () => {
      mockSubscribe.mockResolvedValueOnce(() => {});
      const callback = vi.fn();

      await subscribeToGeocodeAddressJobStatus('job-addr', callback, mockDeps);

      expect(mockSubscribe).toHaveBeenCalledWith(
        'sazinka.job.geocode.address.status.job-addr',
        callback
      );
    });
  });

  describe('submitReverseGeocodeJob', () => {
    it('should call NATS with correct subject and payload', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { jobId: 'job-rev', message: 'ok' } });

      await submitReverseGeocodeJob('user-123', { customerId: 'cust-1', lat: 1, lng: 2 }, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.geocode.reverse.submit',
        expect.objectContaining({
          userId: 'user-123',
          payload: expect.objectContaining({
            customerId: 'cust-1',
            lat: 1,
            lng: 2,
          }),
        })
      );
    });
  });

  describe('subscribeToReverseGeocodeJobStatus', () => {
    it('should subscribe to reverse job status subject', async () => {
      mockSubscribe.mockResolvedValueOnce(() => {});
      const callback = vi.fn();

      await subscribeToReverseGeocodeJobStatus('job-rev', callback, mockDeps);

      expect(mockSubscribe).toHaveBeenCalledWith(
        'sazinka.job.geocode.reverse.status.job-rev',
        callback
      );
    });
  });
});
