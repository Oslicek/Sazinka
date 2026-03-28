import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createNote,
  updateNote,
  listNotes,
  getLatestNoteContent,
  fetchNoteAudit,
  deleteNote,
  type NoteServiceDeps,
} from './noteService';
import type {
  CreateNoteRequest,
  UpdateNoteRequest,
  Note,
  NoteHistoryEntry,
  AuditNoteResponse,
} from '@shared/note';

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-user-id',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

const mockNote = (overrides: Partial<Note> = {}): Note => ({
  id: '123e4567-e89b-12d3-a456-426614174000',
  userId: 'user-123',
  entityType: 'visit',
  entityId: 'entity-456',
  visitId: null,
  content: 'Test note content',
  createdAt: '2026-03-28T10:00:00Z',
  updatedAt: '2026-03-28T10:00:00Z',
  deletedAt: null,
  ...overrides,
});

describe('noteService', () => {
  const mockRequest = vi.fn();
  const mockDeps: NoteServiceDeps = { request: mockRequest };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NT3 — noteService_create_payload
  describe('createNote', () => {
    it('sends correct NATS subject and returns created note', async () => {
      const note = mockNote();
      mockRequest.mockResolvedValueOnce({ payload: note });

      const data: CreateNoteRequest = {
        entityType: 'visit',
        entityId: 'entity-456',
        sessionId: 'session-789',
        content: 'Test note content',
      };

      const result = await createNote(data, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.note.create',
        expect.objectContaining({ payload: data })
      );
      expect(result).toEqual(note);
    });

    it('creates note for device entity with visit_id', async () => {
      const note = mockNote({ entityType: 'device', visitId: 'visit-001' });
      mockRequest.mockResolvedValueOnce({ payload: note });

      const data: CreateNoteRequest = {
        entityType: 'device',
        entityId: 'device-001',
        visitId: 'visit-001',
        sessionId: 'session-001',
        content: 'Device observation',
      };

      const result = await createNote(data, mockDeps);
      expect(result.entityType).toBe('device');
      expect(result.visitId).toBe('visit-001');
    });

    it('creates note for customer entity', async () => {
      const note = mockNote({ entityType: 'customer' });
      mockRequest.mockResolvedValueOnce({ payload: note });

      const data: CreateNoteRequest = {
        entityType: 'customer',
        entityId: 'customer-001',
        sessionId: 'session-001',
        content: 'Customer note',
      };

      const result = await createNote(data, mockDeps);
      expect(result.entityType).toBe('customer');
    });
  });

  // NT3 — noteService_update — also update service
  describe('updateNote', () => {
    it('sends correct NATS subject and returns updated note', async () => {
      const updatedNote = mockNote({ content: 'Updated content' });
      mockRequest.mockResolvedValueOnce({ payload: updatedNote });

      const data: UpdateNoteRequest = {
        noteId: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: 'session-789',
        content: 'Updated content',
      };

      const result = await updateNote(data, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.note.update',
        expect.objectContaining({ payload: data })
      );
      expect(result.content).toBe('Updated content');
    });
  });

  // NT4 — noteService_list_entity
  describe('listNotes', () => {
    it('returns notes for entity', async () => {
      const notes = [mockNote(), mockNote({ id: 'note-2', content: 'Second note' })];
      mockRequest.mockResolvedValueOnce({ payload: { notes } });

      const result = await listNotes('visit', 'entity-456', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.note.list',
        expect.objectContaining({ payload: { entityType: 'visit', entityId: 'entity-456' } })
      );
      expect(result).toHaveLength(2);
    });

    it('returns empty array for entity with no notes', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { notes: [] } });
      const result = await listNotes('visit', 'entity-empty', mockDeps);
      expect(result).toEqual([]);
    });
  });

  // NT7 — compact_projection_null_when_no_notes
  describe('getLatestNoteContent', () => {
    it('returns null when entity has no notes', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { notes: [] } });
      const result = await getLatestNoteContent('visit', 'entity-empty', mockDeps);
      expect(result).toBeNull();
    });

    it('returns latest note content (by createdAt DESC)', async () => {
      const older = mockNote({ id: 'note-1', content: 'Older note', createdAt: '2026-03-01T10:00:00Z' });
      const newer = mockNote({ id: 'note-2', content: 'Newer note', createdAt: '2026-03-28T10:00:00Z' });
      mockRequest.mockResolvedValueOnce({ payload: { notes: [older, newer] } });

      const result = await getLatestNoteContent('visit', 'entity-123', mockDeps);
      expect(result).toBe('Newer note');
    });
  });

  // NT5 — noteService_audit
  describe('fetchNoteAudit', () => {
    it('sends correct NATS subject and returns audit entries', async () => {
      const entry: NoteHistoryEntry = {
        id: 'audit-001',
        noteId: 'note-001',
        sessionId: 'session-001',
        editedByUserId: 'user-001',
        content: 'First version',
        firstEditedAt: '2026-03-28T10:00:00Z',
        lastEditedAt: '2026-03-28T10:05:00Z',
        changeCount: 2,
      };
      const response: AuditNoteResponse = { entries: [entry] };
      mockRequest.mockResolvedValueOnce({ payload: response });

      const result = await fetchNoteAudit('note-001', mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.note.audit',
        expect.objectContaining({ payload: { noteId: 'note-001' } })
      );
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].changeCount).toBe(2);
    });
  });

  // NT6 — noteService_delete
  describe('deleteNote', () => {
    it('sends correct NATS subject and returns deleted flag', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { deleted: true } });

      const result = await deleteNote({ noteId: 'note-001' }, mockDeps);

      expect(mockRequest).toHaveBeenCalledWith(
        'sazinka.note.delete',
        expect.objectContaining({ payload: { noteId: 'note-001' } })
      );
      expect(result.deleted).toBe(true);
    });

    it('returns deleted: true on second call (idempotent)', async () => {
      mockRequest.mockResolvedValueOnce({ payload: { deleted: true } });
      const result = await deleteNote({ noteId: 'already-deleted' }, mockDeps);
      expect(result.deleted).toBe(true);
    });
  });

  // NT2 — Note_deletedAt_optional
  describe('Note type', () => {
    it('Note with deletedAt null is valid', () => {
      const note = mockNote({ deletedAt: null });
      expect(note.deletedAt).toBeNull();
    });

    it('Note with deletedAt set is valid', () => {
      const note = mockNote({ deletedAt: '2026-03-28T12:00:00Z' });
      expect(note.deletedAt).toBeDefined();
    });

    it('Note without deletedAt field is valid (undefined)', () => {
      const note: Note = {
        id: 'note-001',
        userId: 'user-001',
        entityType: 'customer',
        entityId: 'customer-001',
        content: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      expect(note.deletedAt).toBeUndefined();
    });
  });
});
