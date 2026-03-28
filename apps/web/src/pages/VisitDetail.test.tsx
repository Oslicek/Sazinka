/**
 * VisitDetail page — unified notes workspace tests (Phase U5)
 * VD1–VD12
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Note } from '@shared/note';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../services/visitService', () => ({
  getVisit: vi.fn(),
  updateVisit: vi.fn(),
  completeVisit: vi.fn(),
  getVisitStatusLabel: (s: string) => s,
  getVisitTypeLabel: (s: string) => s,
  getVisitResultLabel: (s: string) => s,
}));

vi.mock('../services/noteService', () => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock('../services/workItemService', () => ({
  getWorkTypeLabel: (s: string) => s,
  listWorkItems: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
}));

vi.mock('@/utils/auth', () => ({
  getToken: vi.fn().mockReturnValue('test-token'),
  getUserId: () => 'user-001',
  hasRole: () => true,
}));

vi.mock('../utils/webgl', () => ({ isWebGLSupported: () => false }));

vi.mock('@tanstack/react-router', () => ({
  useParams: vi.fn(() => ({ visitId: 'visit-001' })),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

let mockIsConnected = true;
vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector: (s: { isConnected: boolean }) => unknown) => {
    return selector({ isConnected: mockIsConnected });
  }),
}));

vi.mock('../i18n/formatters', () => ({
  formatDate: (_d: Date, _style: string) => '1 Jan 2026',
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { VisitDetail } from './VisitDetail';
import { getVisit } from '../services/visitService';
import { listNotes, createNote } from '../services/noteService';

const mockGetVisit = vi.mocked(getVisit);
const mockListNotes = vi.mocked(listNotes);
const mockCreateNote = vi.mocked(createNote);

// ── Fixtures ──────────────────────────────────────────────────────────────

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-001',
  userId: 'user-001',
  entityType: 'visit',
  entityId: 'visit-001',
  visitId: null,
  content: 'Test note',
  createdAt: '2026-03-28T10:00:00Z',
  updatedAt: '2026-03-28T10:00:00Z',
  deletedAt: null,
  ...overrides,
});

const visitResponseBase = {
  visit: {
    id: 'visit-001',
    userId: 'user-001',
    customerId: 'customer-001',
    crewId: null,
    deviceId: null,
    scheduledDate: '2026-03-28',
    scheduledTimeStart: '09:00',
    scheduledTimeEnd: '10:00',
    status: 'planned',
    visitType: 'revision',
    actualArrival: null,
    actualDeparture: null,
    result: null,
    fieldNotes: null,
    requiresFollowUp: false,
    followUpReason: null,
    createdAt: '2026-03-28T08:00:00Z',
    updatedAt: '2026-03-28T08:00:00Z',
  },
  customerName: 'Test Customer',
  customerStreet: 'Main St',
  customerCity: 'Prague',
  customerPostalCode: '11000',
  customerPhone: '+420123456789',
  customerLat: 50.0755,
  customerLng: 14.4378,
  workItems: [],
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VisitDetail — unified notes workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected = true;
    mockGetVisit.mockResolvedValue(visitResponseBase as any);
    // Default: no notes for any entity
    mockListNotes.mockResolvedValue([]);
  });

  // VD1 — visit notes section renders
  it('VD1: renders visit notes section', async () => {
    render(<VisitDetail />);
    await waitFor(() => expect(screen.getByTestId('visit-notes-section')).toBeDefined());
  });

  // VD2 — customer notes section renders
  it('VD2: renders customer notes section', async () => {
    render(<VisitDetail />);
    await waitFor(() => expect(screen.getByTestId('customer-notes-section')).toBeDefined());
  });

  // VD3 — empty state when no notes
  it('VD3: shows empty state for visit notes when no notes', async () => {
    render(<VisitDetail />);
    await waitFor(() => expect(screen.getByTestId('visit-notes-empty')).toBeDefined());
  });

  // VD4 — notes loaded from server are rendered
  it('VD4: renders loaded visit notes', async () => {
    mockListNotes.mockImplementation(async (et, _eid) => {
      if (et === 'visit') return [makeNote({ content: 'Server note content' })];
      return [];
    });
    render(<VisitDetail />);
    await waitFor(() => expect(screen.getByTestId('note-row-note-001')).toBeDefined());
  });

  // VD5 — add visit note button calls createNote
  it('VD5: add visit note calls createNote service', async () => {
    const newNote = makeNote({ id: 'new-note', content: '' });
    mockCreateNote.mockResolvedValue(newNote);
    render(<VisitDetail />);
    await waitFor(() => screen.getByTestId('add-visit-note-btn'));

    const btn = screen.getByTestId('add-visit-note-btn');
    await userEvent.click(btn);

    expect(mockCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'visit',
        entityId: 'visit-001',
        content: '',
      })
    );
  });

  // VD6 — add customer note button calls createNote
  it('VD6: add customer note calls createNote service', async () => {
    const newNote = makeNote({ id: 'cust-note', entityType: 'customer', entityId: 'customer-001' });
    mockCreateNote.mockResolvedValue(newNote);
    render(<VisitDetail />);
    await waitFor(() => screen.getByTestId('add-customer-note-btn'));

    const btn = screen.getByTestId('add-customer-note-btn');
    await userEvent.click(btn);

    expect(mockCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'customer',
        entityId: 'customer-001',
        visitId: 'visit-001',
      })
    );
  });

  // VD7 — device notes section shown per device in work items
  it('VD7: device notes section shown for devices in work items', async () => {
    mockGetVisit.mockResolvedValue({
      ...visitResponseBase,
      workItems: [
        {
          id: 'wi-001',
          visitId: 'visit-001',
          deviceId: 'device-001',
          workType: 'revision',
          requiresFollowUp: false,
          createdAt: '2026-03-28T08:00:00Z',
        },
      ],
    } as any);
    mockListNotes.mockResolvedValue([]);
    render(<VisitDetail />);
    await waitFor(() =>
      expect(screen.getByTestId('device-notes-device-001')).toBeDefined()
    );
  });

  // VD8 — listNotes called for visit, customer, and devices
  it('VD8: listNotes called for visit and customer entities', async () => {
    render(<VisitDetail />);
    await waitFor(() => screen.getByTestId('visit-notes-section'));

    expect(mockListNotes).toHaveBeenCalledWith('visit', 'visit-001');
    expect(mockListNotes).toHaveBeenCalledWith('customer', 'customer-001');
  });

  // VD9 — newly created note appears in the list
  it('VD9: newly created note appears in list after creation', async () => {
    const newNote = makeNote({ id: 'new-note-001', content: '' });
    mockCreateNote.mockResolvedValue(newNote);
    render(<VisitDetail />);
    await waitFor(() => screen.getByTestId('add-visit-note-btn'));

    await userEvent.click(screen.getByTestId('add-visit-note-btn'));

    await waitFor(() => expect(screen.getByTestId('note-row-new-note-001')).toBeDefined());
  });

  // VD10 — device accordion collapsed by default
  it('VD10: device notes accordion is collapsed by default', async () => {
    mockGetVisit.mockResolvedValue({
      ...visitResponseBase,
      workItems: [
        {
          id: 'wi-001',
          visitId: 'visit-001',
          deviceId: 'device-abc',
          workType: 'repair',
          requiresFollowUp: false,
          createdAt: '2026-03-28T08:00:00Z',
        },
      ],
    } as any);
    render(<VisitDetail />);
    await waitFor(() => screen.getByTestId('device-notes-device-abc'));

    // Content is hidden (accordion closed)
    expect(screen.queryByTestId('device-notes-empty-device-abc')).toBeNull();
  });

  // VD11 — multiple notes appear in the visit notes list
  it('VD11: multiple visit notes appear in the list', async () => {
    mockListNotes.mockImplementation(async (et) => {
      if (et === 'visit') {
        return [
          makeNote({ id: 'note-1', content: 'First note' }),
          makeNote({ id: 'note-2', content: 'Second note' }),
        ];
      }
      return [];
    });
    render(<VisitDetail />);
    await waitFor(() => {
      expect(screen.getByTestId('note-row-note-1')).toBeDefined();
      expect(screen.getByTestId('note-row-note-2')).toBeDefined();
    });
  });

  // VD12 — customer notes section shows empty state when no notes
  it('VD12: customer notes empty state', async () => {
    render(<VisitDetail />);
    await waitFor(() => expect(screen.getByTestId('customer-notes-empty')).toBeDefined());
  });
});
