/**
 * Phase 6 tests: NotesHistory component — NH1–NH4.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NotesHistoryEntry } from '@shared/visit';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: { getState: () => ({ request: vi.fn() }) },
}));

import { NotesHistory } from '../NotesHistory';

function makeEntry(overrides: Partial<NotesHistoryEntry> = {}): NotesHistoryEntry {
  return {
    id: 'nh-1',
    sessionId: 'sess-1',
    editedByUserId: 'u-1',
    editedByName: 'Jan Novák',
    fieldNotes: 'Some notes',
    firstEditedAt: '2025-06-01T10:00:00Z',
    lastEditedAt: '2025-06-01T12:00:00Z',
    changeCount: 1,
    ...overrides,
  };
}

describe('NotesHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NH1: renders list of entries
  it('NH1: renders list of history entries', () => {
    const entries = [
      makeEntry({ id: 'nh-1', editedByName: 'Alice' }),
      makeEntry({ id: 'nh-2', editedByName: 'Bob' }),
      makeEntry({ id: 'nh-3', editedByName: 'Charlie' }),
    ];
    render(<NotesHistory entries={entries} />);
    const items = screen.getAllByTestId('history-entry');
    expect(items).toHaveLength(3);
  });

  // NH2: shows editor name and date
  it('NH2: shows editor name and date', () => {
    const entries = [makeEntry({ editedByName: 'Jan Novák', lastEditedAt: '2025-06-01T12:00:00Z' })];
    render(<NotesHistory entries={entries} />);
    expect(screen.getByText('Jan Novák')).toBeDefined();
    expect(screen.getByTestId('history-entry').textContent).toContain('2025');
  });

  // NH3: shows change count
  it('NH3: shows change count badge', () => {
    const entries = [makeEntry({ changeCount: 5 })];
    render(<NotesHistory entries={entries} />);
    const badge = screen.getByTestId('change-count');
    expect(badge.textContent).toContain('5');
  });

  // NH4: empty state
  it('NH4: shows empty state when no entries', () => {
    render(<NotesHistory entries={[]} />);
    expect(screen.getByTestId('history-empty')).toBeDefined();
  });
});
