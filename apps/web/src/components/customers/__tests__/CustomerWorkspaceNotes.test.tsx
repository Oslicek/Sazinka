/**
 * CustomerWorkspace — unified notes sidebar tests (Phase U6)
 * CW1–CW6
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Customer } from '@shared/customer';
import type { Note } from '@shared/note';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../services/noteService', () => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock('../../notes/NoteEditor', () => ({
  NoteEditor: ({ initialContent, onChange }: { initialContent: string; onChange?: (v: string) => void }) => (
    <div data-testid="note-editor" data-content={initialContent}>
      <textarea
        value={initialContent}
        onChange={(e) => onChange?.(e.target.value)}
        data-testid="note-textarea"
        readOnly
      />
    </div>
  ),
}));

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('../../../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector: any) => selector({ isConnected: true })),
}));
vi.mock('../../customers/AddressMap', () => ({
  AddressMap: () => <div data-testid="address-map" />,
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { CustomerWorkspace } from '../CustomerWorkspace';
import { listNotes, createNote } from '../../../services/noteService';

const mockListNotes = vi.mocked(listNotes);
const mockCreateNote = vi.mocked(createNote);

// ── Fixtures ──────────────────────────────────────────────────────────────

const makeCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'customer-001',
  userId: 'user-001',
  type: 'person',
  name: 'Test Customer',
  notes: 'Legacy note',
  geocodeStatus: 'success',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
} as Customer);

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-001',
  userId: 'user-001',
  entityType: 'customer',
  entityId: 'customer-001',
  content: 'Customer note content',
  createdAt: '2026-03-28T10:00:00Z',
  updatedAt: '2026-03-28T10:00:00Z',
  deletedAt: null,
  ...overrides,
});

const defaultTabs = { devices: <div>Devices</div>, revisions: <div>Revisions</div> };

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CustomerWorkspace — notes sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListNotes.mockResolvedValue([]);
  });

  // CW1 — notes sidebar section renders
  it('CW1: renders customer notes sidebar section', async () => {
    render(<CustomerWorkspace customer={makeCustomer()} tabs={defaultTabs} />);
    await waitFor(() => expect(screen.getByTestId('customer-notes-sidebar')).toBeDefined());
  });

  // CW2 — empty state when no notes
  it('CW2: shows empty state when no notes', async () => {
    render(<CustomerWorkspace customer={makeCustomer()} tabs={defaultTabs} />);
    await waitFor(() => expect(screen.getByTestId('customer-notes-sidebar-empty')).toBeDefined());
  });

  // CW3 — notes from server rendered
  it('CW3: renders loaded customer notes', async () => {
    mockListNotes.mockResolvedValue([makeNote()]);
    render(<CustomerWorkspace customer={makeCustomer()} tabs={defaultTabs} />);
    await waitFor(() => expect(screen.getByTestId('customer-notes-sidebar-list')).toBeDefined());
  });

  // CW4 — listNotes called with customer entity
  it('CW4: listNotes called for the customer on mount', async () => {
    render(<CustomerWorkspace customer={makeCustomer()} tabs={defaultTabs} />);
    await waitFor(() => {
      expect(mockListNotes).toHaveBeenCalledWith('customer', 'customer-001');
    });
  });

  // CW5 — add note button creates note
  it('CW5: add note button calls createNote', async () => {
    const newNote = makeNote({ id: 'new-note', content: '' });
    mockCreateNote.mockResolvedValue(newNote);
    render(<CustomerWorkspace customer={makeCustomer()} tabs={defaultTabs} />);
    await waitFor(() => screen.getByTestId('add-customer-note-sidebar-btn'));

    await userEvent.click(screen.getByTestId('add-customer-note-sidebar-btn'));

    expect(mockCreateNote).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'customer', entityId: 'customer-001' })
    );
  });

  // CW6 — newly created note appears
  it('CW6: newly created note appears in the list', async () => {
    const newNote = makeNote({ id: 'created-note', content: '' });
    mockCreateNote.mockResolvedValue(newNote);
    render(<CustomerWorkspace customer={makeCustomer()} tabs={defaultTabs} />);
    await waitFor(() => screen.getByTestId('add-customer-note-sidebar-btn'));

    await userEvent.click(screen.getByTestId('add-customer-note-sidebar-btn'));

    await waitFor(() => expect(screen.getByTestId('customer-notes-sidebar-list')).toBeDefined());
  });
});
