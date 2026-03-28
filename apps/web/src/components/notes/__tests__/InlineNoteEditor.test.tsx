/**
 * InlineNoteEditor shared building block tests — NY1–NY9 (U11) + NY10–NY15 (U12)
 *
 * NY1–NY9:  draft rendering, autosave, conflict UI, save-error retry, entity types
 * NY10–NY15: delete action, confirmation, success, cancel, failure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Note } from '@shared/note';

// ── Module mocks (hoisted) ──────────────────────────────────────────────────

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: { getState: () => ({ request: vi.fn() }) },
}));

vi.mock('../../../services/noteService', () => ({
  updateNote: vi.fn().mockResolvedValue({
    id: 'note-001', content: 'saved', entityType: 'visit',
    entityId: 'e-001', userId: 'u-001', createdAt: '', updatedAt: '',
  }),
  deleteNote: vi.fn().mockResolvedValue({ deleted: true }),
}));

vi.mock('../../../hooks/useNoteDraft', () => ({
  useNoteDraft: vi.fn(),
}));

vi.mock('../../../hooks/useAutoSave', () => ({
  useAutoSave: vi.fn(),
}));

vi.mock('../../notes/NoteEditor', () => ({
  NoteEditor: ({ initialContent, onChange }: { initialContent: string; onChange?: (v: string) => void }) => (
    <div data-testid="note-editor">
      <div data-testid="editor-content">{initialContent}</div>
      <button type="button" data-testid="trigger-change" onClick={() => onChange?.('new content')} />
    </div>
  ),
}));

// ── Import after mocks ──────────────────────────────────────────────────────
import { InlineNoteEditor } from '../InlineNoteEditor';
import { useNoteDraft } from '../../../hooks/useNoteDraft';
import { useAutoSave } from '../../../hooks/useAutoSave';
import { deleteNote } from '../../../services/noteService';

// ── Helpers ─────────────────────────────────────────────────────────────────

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

const mockUpdateDraft = vi.fn();
const mockResolveKeepLocal = vi.fn();
const mockResolveUseServer = vi.fn();
const mockRetry = vi.fn();

function setupMocks({
  draft = 'initial content',
  hasConflict = false,
  saveError = null as string | null,
} = {}) {
  vi.mocked(useNoteDraft).mockReturnValue({
    draft,
    updateDraft: mockUpdateDraft,
    hasConflict,
    resolveKeepLocal: mockResolveKeepLocal,
    resolveUseServer: mockResolveUseServer,
    conflictResolved: false,
    setConflictResolved: vi.fn(),
  });
  vi.mocked(useAutoSave).mockReturnValue({ saveError, retry: mockRetry, isSaving: false });
}

// ── U11: NY1–NY9 ─────────────────────────────────────────────────────────────

describe('InlineNoteEditor — core (NY1–NY9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('NY1: renders NoteEditor with draft content', () => {
    setupMocks({ draft: 'my draft' });
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} />);
    expect(screen.getByTestId('note-editor')).toBeDefined();
    expect(screen.getByTestId('editor-content').textContent).toBe('my draft');
  });

  it('NY2: changing content calls updateDraft', () => {
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId('trigger-change'));
    expect(mockUpdateDraft).toHaveBeenCalledWith('new content');
  });

  it('NY3: conflict banner visible when hasConflict=true', () => {
    setupMocks({ hasConflict: true });
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} />);
    expect(screen.getByTestId('conflict-prompt')).toBeDefined();
  });

  it('NY4: Keep local button calls resolveKeepLocal', () => {
    setupMocks({ hasConflict: true });
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText(/keep local/i));
    expect(mockResolveKeepLocal).toHaveBeenCalled();
  });

  it('NY5: Use server button calls resolveUseServer', () => {
    setupMocks({ hasConflict: true });
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText(/use server/i));
    expect(mockResolveUseServer).toHaveBeenCalled();
  });

  it('NY6: save error banner shows retry button', () => {
    setupMocks({ saveError: 'Network error' });
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} />);
    expect(screen.getByTestId('save-error')).toBeDefined();
    fireEvent.click(screen.getByText(/retry/i));
    expect(mockRetry).toHaveBeenCalled();
  });

  it.each([
    ['customer' as const, 'customer-entity'],
    ['device' as const, 'device-entity'],
    ['visit' as const, 'visit-entity'],
  ])('NY7–NY9: works for entityType=%s', (entityType, entityId) => {
    render(
      <InlineNoteEditor
        note={makeNote({ entityType, entityId })}
        sessionId="s-001"
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByTestId('note-editor')).toBeDefined();
  });
});

// ── U12: NY10–NY15 ───────────────────────────────────────────────────────────

describe('InlineNoteEditor — delete (NY10–NY15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
    vi.mocked(deleteNote).mockResolvedValue({ deleted: true });
  });

  it('NY10: delete action button is visible when onDeleted prop provided', () => {
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByTestId('delete-note-btn')).toBeDefined();
  });

  it('NY11: clicking delete shows confirmation, does not delete immediately', () => {
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('delete-note-btn'));
    expect(screen.getByTestId('delete-confirm-prompt')).toBeDefined();
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it('NY12: confirming delete calls deleteNote with noteId', async () => {
    render(<InlineNoteEditor note={makeNote({ id: 'note-999' })} sessionId="s-001" onSaved={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('delete-note-btn'));
    await act(async () => { fireEvent.click(screen.getByTestId('delete-confirm-yes')); });
    expect(deleteNote).toHaveBeenCalledWith({ noteId: 'note-999' });
  });

  it('NY13: successful delete calls onDeleted callback with noteId', async () => {
    const onDeleted = vi.fn();
    render(<InlineNoteEditor note={makeNote({ id: 'note-999' })} sessionId="s-001" onSaved={vi.fn()} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByTestId('delete-note-btn'));
    await act(async () => { fireEvent.click(screen.getByTestId('delete-confirm-yes')); });
    expect(onDeleted).toHaveBeenCalledWith('note-999');
  });

  it('NY14: cancel keeps note and hides confirm prompt', () => {
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('delete-note-btn'));
    fireEvent.click(screen.getByTestId('delete-confirm-no'));
    expect(screen.queryByTestId('delete-confirm-prompt')).toBeNull();
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it('NY15: delete API failure shows error, note editor remains', async () => {
    vi.mocked(deleteNote).mockRejectedValueOnce(new Error('Server error'));
    render(<InlineNoteEditor note={makeNote()} sessionId="s-001" onSaved={vi.fn()} onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByTestId('delete-note-btn'));
    await act(async () => { fireEvent.click(screen.getByTestId('delete-confirm-yes')); });
    expect(screen.getByTestId('delete-error')).toBeDefined();
    expect(screen.getByTestId('note-editor')).toBeDefined();
  });
});
