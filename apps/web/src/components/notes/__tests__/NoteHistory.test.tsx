/**
 * NoteHistory generalized building block tests — NB6 + more
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NoteHistoryEntry } from '@shared/note';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: { getState: () => ({ request: vi.fn() }) },
}));

import { NoteHistory } from '../NoteHistory';

const makeEntry = (overrides: Partial<NoteHistoryEntry> = {}): NoteHistoryEntry => ({
  id: 'entry-001',
  noteId: 'note-001',
  sessionId: 'session-001',
  editedByUserId: 'user-001',
  content: 'First draft of notes',
  firstEditedAt: '2026-03-28T10:00:00Z',
  lastEditedAt: '2026-03-28T10:05:00Z',
  changeCount: 1,
  ...overrides,
});

describe('NoteHistory', () => {
  // NB6 — lists audit entries
  it('NB6: renders audit entries list', () => {
    render(<NoteHistory entries={[makeEntry(), makeEntry({ id: 'entry-002' })]} />);
    expect(screen.getAllByTestId('history-entry')).toHaveLength(2);
  });

  it('shows empty state when no entries', () => {
    render(<NoteHistory entries={[]} />);
    expect(screen.getByTestId('history-empty')).toBeDefined();
  });

  it('shows change count badge when changeCount > 1', () => {
    render(<NoteHistory entries={[makeEntry({ changeCount: 5 })]} />);
    expect(screen.getByTestId('change-count').textContent).toContain('5');
  });

  it('shows single edit badge when changeCount = 1', () => {
    render(<NoteHistory entries={[makeEntry({ changeCount: 1 })]} />);
    expect(screen.getByTestId('change-count').textContent).toContain('1');
  });

  it('uses content field (not fieldNotes) for preview', () => {
    render(<NoteHistory entries={[makeEntry({ content: 'Test content preview' })]} />);
    expect(screen.getByTestId('history-entry').textContent).toContain('Test content preview');
  });

  it('truncates preview at 200 chars', () => {
    const longContent = 'x'.repeat(300);
    render(<NoteHistory entries={[makeEntry({ content: longContent })]} />);
    const preview = screen.getByTestId('history-entry').textContent ?? '';
    expect(preview).toContain('…');
    expect(preview.length).toBeLessThan(300);
  });

  it('displays editedByUserId', () => {
    render(<NoteHistory entries={[makeEntry({ editedByUserId: 'user-abc' })]} />);
    expect(screen.getByTestId('history-entry').textContent).toContain('user-abc');
  });
});
