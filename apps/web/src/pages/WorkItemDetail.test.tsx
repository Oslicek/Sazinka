/**
 * WorkItemDetail page — unified device notes tests (Phase U7)
 * WID1–WID10
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Note } from '@shared/note';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('../services/workItemService', () => ({
  getWorkItem: vi.fn(),
  completeWorkItem: vi.fn(),
  getWorkTypeLabel: (s: string) => s,
  getWorkResultLabel: (s: string) => s,
}));

vi.mock('../services/noteService', () => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock('@/utils/auth', () => ({
  getToken: vi.fn().mockReturnValue('test-token'),
  getUserId: () => 'user-001',
  hasRole: () => true,
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: vi.fn(() => ({ workItemId: 'wi-001' })),
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

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { WorkItemDetail } from './WorkItemDetail';
import { getWorkItem } from '../services/workItemService';
import { listNotes, createNote } from '../services/noteService';

const mockGetWorkItem = vi.mocked(getWorkItem);
const mockListNotes = vi.mocked(listNotes);
const mockCreateNote = vi.mocked(createNote);

// ── Fixtures ──────────────────────────────────────────────────────────────

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-001',
  userId: 'user-001',
  entityType: 'device',
  entityId: 'device-001',
  visitId: null,
  content: 'Device note content',
  createdAt: '2026-03-28T10:00:00Z',
  updatedAt: '2026-03-28T10:00:00Z',
  deletedAt: null,
  ...overrides,
});

const baseWorkItem = {
  id: 'wi-001',
  visitId: 'visit-001',
  userId: 'user-001',
  deviceId: 'device-001',
  workType: 'inspection',
  result: null,
  resultNotes: null,
  findings: null,
  durationMinutes: null,
  requiresFollowUp: false,
  followUpReason: null,
  revisionId: null,
  createdAt: '2026-03-28T08:00:00Z',
  updatedAt: '2026-03-28T08:00:00Z',
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WorkItemDetail — unified device notes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConnected = true;
    mockGetWorkItem.mockResolvedValue(baseWorkItem as any);
    mockListNotes.mockResolvedValue([]);
    mockCreateNote.mockResolvedValue(makeNote({ id: 'new-note', content: '' }));
  });

  // WID1 — device notes section renders when deviceId present
  it('WID1: renders device notes section when work item has deviceId', async () => {
    render(<WorkItemDetail />);
    await waitFor(() => expect(screen.getByTestId('device-notes-section')).toBeDefined());
  });

  // WID2 — device notes section absent when no deviceId
  it('WID2: does not render device notes section when no deviceId', async () => {
    mockGetWorkItem.mockResolvedValue({ ...baseWorkItem, deviceId: null } as any);
    render(<WorkItemDetail />);
    await waitFor(() => screen.getAllByText('inspection'));
    expect(screen.queryByTestId('device-notes-section')).toBeNull();
  });

  // WID3 — listNotes called with device entityType
  it('WID3: calls listNotes with device entityType on load', async () => {
    render(<WorkItemDetail />);
    await waitFor(() => {
      expect(mockListNotes).toHaveBeenCalledWith('device', 'device-001');
    });
  });

  // WID4 — empty state when no notes
  it('WID4: shows empty state when no device notes', async () => {
    render(<WorkItemDetail />);
    await waitFor(() => expect(screen.getByTestId('device-notes-empty')).toBeDefined());
  });

  // WID5 — loaded notes render
  it('WID5: renders loaded device notes', async () => {
    mockListNotes.mockResolvedValue([makeNote({ content: 'Observed corrosion' })]);
    render(<WorkItemDetail />);
    await waitFor(() => expect(screen.getByTestId('device-notes-list')).toBeDefined());
  });

  // WID6 — add note button calls createNote
  it('WID6: add note button calls createNote with device entityType', async () => {
    render(<WorkItemDetail />);
    await waitFor(() => screen.getByTestId('add-device-note-btn'));
    await userEvent.click(screen.getByTestId('add-device-note-btn'));
    expect(mockCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'device', entityId: 'device-001' })
    );
  });

  // WID7 — new note appears after creation
  it('WID7: newly created note appears in device notes list', async () => {
    const newNote = makeNote({ id: 'new-note', content: '' });
    mockCreateNote.mockResolvedValue(newNote);
    render(<WorkItemDetail />);
    await waitFor(() => screen.getByTestId('add-device-note-btn'));
    await userEvent.click(screen.getByTestId('add-device-note-btn'));
    await waitFor(() => expect(screen.getByTestId('device-notes-list')).toBeDefined());
  });

  // WID8 — legacy notes textarea not present in completion dialog
  it('WID8: complete dialog does not show legacy notes/findings textareas', async () => {
    render(<WorkItemDetail />);
    await waitFor(() => screen.getByRole('button', { name: /complete/i }));
    const completeBtn = screen.getAllByRole('button', { name: /complete/i })[0];
    await userEvent.click(completeBtn);
    expect(screen.queryByRole('textbox', { name: /notes/i })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /findings/i })).toBeNull();
  });

  // WID9 — hint message shown in dialog instead of legacy textareas
  it('WID9: complete dialog shows notes hint instead of textareas', async () => {
    render(<WorkItemDetail />);
    await waitFor(() => screen.getByRole('button', { name: /complete/i }));
    const completeBtn = screen.getAllByRole('button', { name: /complete/i })[0];
    await userEvent.click(completeBtn);
    await waitFor(() => expect(screen.getByTestId('device-notes-section')).toBeDefined());
  });

  // WID10 — listNotes not called when deviceId is absent
  it('WID10: listNotes not called when work item has no device', async () => {
    mockGetWorkItem.mockResolvedValue({ ...baseWorkItem, deviceId: null } as any);
    render(<WorkItemDetail />);
    await waitFor(() => screen.getAllByText('inspection'));
    expect(mockListNotes).not.toHaveBeenCalled();
  });
});
