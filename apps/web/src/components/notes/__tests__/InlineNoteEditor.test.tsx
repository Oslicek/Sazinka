/**
 * InlineNoteEditor shared building block tests — NY1–NY9
 *
 * Covers: draft rendering, autosave, conflict UI, save-error retry,
 * and all three entity types.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Note } from '@shared/note';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: { getState: () => ({ request: vi.fn() }) },
}));

// Mock hooks — control draft / conflict / autosave behaviour in tests
const mockUpdateDraft = vi.fn();
const mockResolveKeepLocal = vi.fn();
const mockResolveUseServer = vi.fn();
let mockHasConflict = false;
let mockDraft = 'initial content';

vi.mock('../../../hooks/useNoteDraft', () => ({
  useNoteDraft: () => ({
    draft: mockDraft,
    updateDraft: mockUpdateDraft,
    hasConflict: mockHasConflict,
    resolveKeepLocal: mockResolveKeepLocal,
    resolveUseServer: mockResolveUseServer,
  }),
}));

const mockRetry = vi.fn();
let mockSaveError: string | null = null;

vi.mock('../../../hooks/useAutoSave', () => ({
  useAutoSave: () => ({ saveError: mockSaveError, retry: mockRetry }),
}));

vi.mock('../../notes/NoteEditor', () => ({
  NoteEditor: ({ initialContent, onChange }: { initialContent: string; onChange?: (v: string) => void }) => (
    <div data-testid="note-editor">
      <div data-testid="editor-content">{initialContent}</div>
      <button data-testid="trigger-change" onClick={() => onChange?.('new content')} />
    </div>
  ),
}));

vi.mock('../../../services/noteService', () => ({
  updateNote: vi.fn().mockResolvedValue({ id: 'note-001', content: 'saved', entityType: 'visit', entityId: 'e-001', userId: 'u-001', createdAt: '', updatedAt: '' }),
}));

import { InlineNoteEditor } from '../InlineNoteEditor';

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-001',
  userId: 'user-001',
  entityType: 'visit',
  entityId: 'entity-001',
  visitId: null,
  content: 'initial content',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
  ...overrides,
});

describe('InlineNoteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasConflict = false;
    mockDraft = 'initial content';
    mockSaveError = null;
  });

  // NY1 — renders NoteEditor with draft from useNoteDraft
  it('NY1: renders NoteEditor with draft content', () => {
    mockDraft = 'my draft';
    render(<InlineNoteEditor note={makeNote()} sessionId="session-001" onSaved={vi.fn()} />);
    expect(screen.getByTestId('note-editor')).toBeDefined();
    expect(screen.getByTestId('editor-content').textContent).toBe('my draft');
  });

  // NY2 — autosave: changing content calls updateDraft
  it('NY2: changing content calls updateDraft', () => {
    render(<InlineNoteEditor note={makeNote()} sessionId="session-001" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId('trigger-change'));
    expect(mockUpdateDraft).toHaveBeenCalledWith('new content');
  });

  // NY3 — conflict banner visible when hasConflict=true
  it('NY3: conflict banner visible when draft differs from server', () => {
    mockHasConflict = true;
    render(<InlineNoteEditor note={makeNote()} sessionId="session-001" onSaved={vi.fn()} />);
    expect(screen.getByTestId('conflict-prompt')).toBeDefined();
  });

  // NY4 — Keep local resolves conflict
  it('NY4: Keep local button calls resolveKeepLocal', () => {
    mockHasConflict = true;
    render(<InlineNoteEditor note={makeNote()} sessionId="session-001" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText(/keep local/i));
    expect(mockResolveKeepLocal).toHaveBeenCalled();
  });

  // NY5 — Use server resolves conflict
  it('NY5: Use server button calls resolveUseServer', () => {
    mockHasConflict = true;
    render(<InlineNoteEditor note={makeNote()} sessionId="session-001" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText(/use server/i));
    expect(mockResolveUseServer).toHaveBeenCalled();
  });

  // NY6 — save error shows retry button
  it('NY6: save error banner shows retry button', () => {
    mockSaveError = 'Network error';
    render(<InlineNoteEditor note={makeNote()} sessionId="session-001" onSaved={vi.fn()} />);
    expect(screen.getByTestId('save-error')).toBeDefined();
    fireEvent.click(screen.getByText(/retry/i));
    expect(mockRetry).toHaveBeenCalled();
  });

  // NY7–NY9 — all three entity types (parametrized)
  it.each([
    ['customer' as const, 'customer-entity'],
    ['device' as const, 'device-entity'],
    ['visit' as const, 'visit-entity'],
  ])('NY7–NY9: works for entityType=%s', (entityType, entityId) => {
    render(
      <InlineNoteEditor
        note={makeNote({ entityType, entityId })}
        sessionId="session-001"
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByTestId('note-editor')).toBeDefined();
  });
});
