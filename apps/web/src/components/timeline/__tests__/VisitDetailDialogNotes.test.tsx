/**
 * VisitDetailDialog — unified notes read-only excerpts tests (Phase U6)
 * DD1–DD6
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Visit } from '@shared/visit';
import type { Note } from '@shared/note';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../services/visitService', () => ({
  updateVisit: vi.fn(),
  completeVisit: vi.fn(),
  getVisitStatusLabel: (s: string) => s,
  getVisitTypeLabel: (s: string) => s,
  getVisitResultLabel: (s: string) => s,
}));

vi.mock('../../../services/noteService', () => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('../../../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector: any) => selector({ isConnected: true })),
}));
vi.mock('../../common/TimeInput', () => ({
  TimeInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { VisitDetailDialog } from '../VisitDetailDialog';
import { listNotes } from '../../../services/noteService';

const mockListNotes = vi.mocked(listNotes);

// ── Fixtures ──────────────────────────────────────────────────────────────

const makeVisit = (overrides: Partial<Visit> = {}): Visit => ({
  id: 'visit-001',
  userId: 'user-001',
  customerId: 'customer-001',
  crewId: null,
  deviceId: null,
  scheduledDate: '2026-03-28',
  scheduledTimeStart: '09:00',
  scheduledTimeEnd: '10:00',
  status: 'completed',
  visitType: 'revision',
  actualArrival: null,
  actualDeparture: null,
  result: 'successful',
  fieldNotes: null,
  requiresFollowUp: false,
  followUpReason: null,
  createdAt: '2026-03-28T08:00:00Z',
  updatedAt: '2026-03-28T08:00:00Z',
  ...overrides,
} as Visit);

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-001',
  userId: 'user-001',
  entityType: 'visit',
  entityId: 'visit-001',
  content: 'Completed visit note',
  createdAt: '2026-03-28T10:00:00Z',
  updatedAt: '2026-03-28T10:00:00Z',
  deletedAt: null,
  ...overrides,
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VisitDetailDialog — notes in completed info', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListNotes.mockResolvedValue([]);
  });

  // DD1 — completed info section renders
  it('DD1: completed info section renders for completed visit', () => {
    render(
      <VisitDetailDialog
        visit={makeVisit()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(screen.getByTestId('visit-dialog-completed-info')).toBeDefined();
  });

  // DD2 — listNotes called for completed visit
  it('DD2: listNotes called for completed visit', async () => {
    render(
      <VisitDetailDialog
        visit={makeVisit()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(mockListNotes).toHaveBeenCalledWith('visit', 'visit-001');
    });
  });

  // DD3 — listNotes NOT called for non-completed visit
  it('DD3: listNotes NOT called for planned visit', async () => {
    render(
      <VisitDetailDialog
        visit={makeVisit({ status: 'planned' })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    // No completed info for planned visit, so no note fetch
    expect(mockListNotes).not.toHaveBeenCalled();
  });

  // DD4 — note excerpts rendered
  it('DD4: note excerpts rendered for completed visit', async () => {
    mockListNotes.mockResolvedValue([makeNote({ content: 'Visit observation' })]);
    render(
      <VisitDetailDialog
        visit={makeVisit()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('visit-dialog-notes-excerpts')).toBeDefined()
    );
    expect(screen.getByTestId('dialog-note-excerpt-note-001')).toBeDefined();
  });

  // DD5 — note content truncated at 300 chars
  it('DD5: note excerpts truncated at 300 chars', async () => {
    const longContent = 'x'.repeat(400);
    mockListNotes.mockResolvedValue([makeNote({ content: longContent })]);
    render(
      <VisitDetailDialog
        visit={makeVisit()}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('dialog-note-excerpt-note-001')).toBeDefined()
    );
    const excerptText = screen.getByTestId('dialog-note-excerpt-note-001').textContent ?? '';
    expect(excerptText).toContain('…');
    expect(excerptText.length).toBeLessThan(400);
  });

  // DD6 — legacy fieldNotes shown when no unified notes
  it('DD6: legacy fieldNotes shown when no unified notes exist', async () => {
    mockListNotes.mockResolvedValue([]);
    render(
      <VisitDetailDialog
        visit={makeVisit({ fieldNotes: 'Old legacy note' })}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await waitFor(() =>
      expect(screen.getByTestId('visit-dialog-legacy-notes')).toBeDefined()
    );
    expect(screen.getByTestId('visit-dialog-legacy-notes').textContent).toContain('Old legacy note');
  });
});
