import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCrew,
  listCrews,
  getCrew,
  updateCrew,
  deleteCrew,
  type Crew,
  type CreateCrewRequest,
  type UpdateCrewRequest,
  type CrewServiceDeps,
} from './crewService';

describe('crewService', () => {
  const mockRequest = vi.fn();
  const mockDeps: CrewServiceDeps = {
    request: mockRequest,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockCrew: Crew = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userId: 'user-123',
    name: 'Posádka 1',
    homeDepotId: null,
    preferredAreas: [],
    workingHoursStart: '08:00:00',
    workingHoursEnd: '17:00:00',
    isActive: true,
    createdAt: '2026-02-05T12:00:00Z',
    updatedAt: '2026-02-05T12:00:00Z',
  };

  describe('createCrew', () => {
    const createRequest: CreateCrewRequest = {
      name: 'Posádka 1',
    };

    it('should call NATS with correct subject and payload', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCrew });

      await createCrew(createRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.crew.create',
        expect.objectContaining({
          payload: createRequest,
        })
      );
    });

    it('should return created crew on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCrew });

      const result = await createCrew(createRequest, mockDeps);

      expect(result).toEqual(mockCrew);
    });

    it('should throw error when NATS returns error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'Connection failed' },
      });

      await expect(createCrew(createRequest, mockDeps)).rejects.toThrow(
        'Connection failed'
      );
    });

    it('should include request id and timestamp', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCrew });

      await createCrew(createRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.crew.create',
        expect.objectContaining({
          id: expect.any(String),
          timestamp: expect.any(String),
        })
      );
    });
  });

  describe('listCrews', () => {
    const mockCrews: Crew[] = [mockCrew];

    it('should call NATS with correct subject', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockCrews, total: 1 },
      });

      await listCrews(true, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.crew.list',
        expect.objectContaining({
          payload: { activeOnly: true },
        })
      );
    });

    it('should return list of crews', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockCrews, total: 1 },
      });

      const result = await listCrews(true, mockDeps);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Posádka 1');
    });

    it('should throw error when NATS returns error response', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'DATABASE_ERROR', message: 'Query failed' },
      });

      await expect(listCrews(true, mockDeps)).rejects.toThrow('Query failed');
    });

    it('should request inactive crews when activeOnly is false', async () => {
      mockRequest.mockResolvedValueOnce({
        payload: { items: mockCrews, total: 1 },
      });

      await listCrews(false, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.crew.list',
        expect.objectContaining({
          payload: { activeOnly: false },
        })
      );
    });
  });

  describe('getCrew', () => {
    it('should call NATS with correct subject and crew id', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCrew });

      await getCrew('crew-123', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.crew.get',
        expect.objectContaining({
          payload: { id: 'crew-123' },
        })
      );
    });

    it('should return crew on success', async () => {
      mockRequest.mockResolvedValueOnce({ payload: mockCrew });

      const result = await getCrew('crew-123', mockDeps);

      expect(result).toEqual(mockCrew);
    });

    it('should throw error when crew not found', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'NOT_FOUND', message: 'Crew not found' },
      });

      await expect(getCrew('crew-123', mockDeps)).rejects.toThrow('Crew not found');
    });
  });

  describe('updateCrew', () => {
    const updateRequest: UpdateCrewRequest = {
      id: 'crew-123',
      name: 'Posádka 1 - Updated',
    };

    it('should call NATS with correct subject and update data', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { ...mockCrew, ...updateRequest } });

      await updateCrew(updateRequest, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.crew.update',
        expect.objectContaining({
          payload: updateRequest,
        })
      );
    });

    it('should return updated crew on success', async () => {
      const updatedCrew = { ...mockCrew, name: 'Posádka 1 - Updated' };
      mockRequest.mockResolvedValueOnce({ payload: updatedCrew });

      const result = await updateCrew(updateRequest, mockDeps);

      expect(result.name).toBe('Posádka 1 - Updated');
    });

    it('should throw error when crew not found', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'NOT_FOUND', message: 'Crew not found' },
      });

      await expect(updateCrew(updateRequest, mockDeps)).rejects.toThrow(
        'Crew not found'
      );
    });
  });

  describe('deleteCrew', () => {
    it('should call NATS with correct subject and crew id', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { deleted: true } });

      await deleteCrew('crew-123', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.crew.delete',
        expect.objectContaining({
          payload: { id: 'crew-123' },
        })
      );
    });

    it('should return true on successful deletion', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { deleted: true } });

      const result = await deleteCrew('crew-123', mockDeps);

      expect(result).toBe(true);
    });

    it('should throw error when crew not found', async () => {
      mockRequest.mockResolvedValueOnce({
        error: { code: 'NOT_FOUND', message: 'Crew not found' },
      });

      await expect(deleteCrew('crew-123', mockDeps)).rejects.toThrow(
        'Crew not found'
      );
    });
  });
});
