// Unified note types — journal-style notes for customer, device, and visit entities.

export type NoteEntityType = 'customer' | 'device' | 'visit';

export interface Note {
  id: string;
  userId: string;
  entityType: NoteEntityType;
  entityId: string;
  /** Which visit this note was created during (null for standalone notes) */
  visitId?: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface NoteHistoryEntry {
  id: string;
  noteId: string;
  sessionId: string;
  editedByUserId: string;
  content: string;
  firstEditedAt: string;
  lastEditedAt: string;
  changeCount: number;
}

export interface CreateNoteRequest {
  entityType: NoteEntityType;
  entityId: string;
  /** Optionally link to a visit (e.g. device note created during a visit) */
  visitId?: string;
  sessionId: string;
  content: string;
}

export interface UpdateNoteRequest {
  noteId: string;
  sessionId: string;
  content: string;
  // Note: no version/etag — update is last-writer-wins by design (see plan N17)
}

export interface ListNotesRequest {
  entityType: NoteEntityType;
  entityId: string;
}

export interface ListNotesResponse {
  notes: Note[];
}

export interface AuditNoteRequest {
  noteId: string;
}

export interface AuditNoteResponse {
  entries: NoteHistoryEntry[];
}

export interface DeleteNoteRequest {
  noteId: string;
}
