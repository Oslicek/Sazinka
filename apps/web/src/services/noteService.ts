/**
 * Note service — NATS wrapper for the unified notes system.
 *
 * Subjects:
 *   sazinka.note.create  — create a new note entry
 *   sazinka.note.update  — update note content (with audit)
 *   sazinka.note.list    — list active notes for an entity
 *   sazinka.note.audit   — fetch session-level audit trail for a note
 *   sazinka.note.delete  — soft-delete a note entry
 */

import type {
  AuditNoteResponse,
  CreateNoteRequest,
  DeleteNoteRequest,
  ListNotesResponse,
  Note,
  NoteEntityType,
  UpdateNoteRequest,
} from '@shared/note';
import { createRequest } from '@shared/messages';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';

export interface NoteServiceDeps {
  request: <TRes>(subject: string, payload: unknown) => Promise<TRes>;
}

function getDefaultDeps(): NoteServiceDeps {
  return {
    request: useNatsStore.getState().request,
  };
}

/**
 * Create a new note entry for an entity.
 */
export async function createNote(
  data: CreateNoteRequest,
  deps = getDefaultDeps()
): Promise<Note> {
  const req = createRequest(getToken(), data);
  const response = await deps.request<{ payload: Note }>('sazinka.note.create', req);
  return response.payload;
}

/**
 * Update note content (last-writer-wins; audit row upserted by session).
 */
export async function updateNote(
  data: UpdateNoteRequest,
  deps = getDefaultDeps()
): Promise<Note> {
  const req = createRequest(getToken(), data);
  const response = await deps.request<{ payload: Note }>('sazinka.note.update', req);
  return response.payload;
}

/**
 * List all active (non-deleted) notes for an entity, ordered by created_at ASC.
 * Returns null (compact projection fallback) when the entity has no notes at all.
 */
export async function listNotes(
  entityType: NoteEntityType,
  entityId: string,
  deps = getDefaultDeps()
): Promise<Note[]> {
  const req = createRequest(getToken(), { entityType, entityId });
  const response = await deps.request<{ payload: ListNotesResponse }>('sazinka.note.list', req);
  return response.payload.notes;
}

/**
 * Get the latest note content for an entity as a single string (compact projection).
 * Returns null if the entity has no notes (per plan N14).
 */
export async function getLatestNoteContent(
  entityType: NoteEntityType,
  entityId: string,
  deps = getDefaultDeps()
): Promise<string | null> {
  const notes = await listNotes(entityType, entityId, deps);
  if (notes.length === 0) return null;
  const sorted = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return sorted[0].content;
}

/**
 * Fetch session-level audit trail for a specific note.
 */
export async function fetchNoteAudit(
  noteId: string,
  deps = getDefaultDeps()
): Promise<AuditNoteResponse> {
  const req = createRequest(getToken(), { noteId });
  const response = await deps.request<{ payload: AuditNoteResponse }>('sazinka.note.audit', req);
  return response.payload;
}

/**
 * Soft-delete a note entry.
 */
export async function deleteNote(
  data: DeleteNoteRequest,
  deps = getDefaultDeps()
): Promise<{ deleted: boolean }> {
  const req = createRequest(getToken(), data);
  const response = await deps.request<{ payload: { deleted: boolean } }>('sazinka.note.delete', req);
  return response.payload;
}
