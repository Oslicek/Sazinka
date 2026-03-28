/**
 * VisitDetailDialog — deep-link tests (U14 / NY23–NY26)
 *
 * NY23: completed/cancelled/rescheduled visit has "View / Edit" link
 * NY24: planned/in-progress visit also has "View / Edit" link
 * NY25: the link targets /visits/$visitId
 * NY26: clicking the link calls onClose (then navigates) — so the dialog is dismissed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Visit } from '@shared/visit';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, params, children, onClick, ...rest }: { to: string; params?: Record<string, string>; children: React.ReactNode; onClick?: () => void; [key: string]: unknown }) => (
    <a
      href={typeof params === 'object' ? to.replace('$visitId', params?.visitId ?? '') : to}
      data-to={to}
      data-visit-id={params?.visitId}
      onClick={onClick}
      {...rest}
    >
      {children}
    </a>
  ),
}));

vi.mock('../../../services/visitService', () => ({
  updateVisit: vi.fn(),
  completeVisit: vi.fn(),
  getVisitStatusLabel: (s: string) => s,
  getVisitTypeLabel: (s: string) => s,
  getVisitResultLabel: (s: string) => s,
}));

vi.mock('../../../services/noteService', () => ({
  listNotes: vi.fn().mockResolvedValue([]),
  createNote: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('../../../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector: (s: { isConnected: boolean }) => unknown) =>
    selector({ isConnected: true }),
  ),
}));
vi.mock('../../common/TimeInput', () => ({
  TimeInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

// ── Imports ────────────────────────────────────────────────────────────────

import { VisitDetailDialog } from '../VisitDetailDialog';

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

// ── Tests ──────────────────────────────────────────────────────────────────

describe('VisitDetailDialog — deep-link (NY23–NY26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NY23 — completed visit shows View/Edit link
  it('NY23: completed visit shows View/Edit link', () => {
    render(<VisitDetailDialog visit={makeVisit({ status: 'completed' })} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('visit-dialog-view-edit-link')).toBeDefined();
  });

  // NY23b — cancelled visit shows View/Edit link
  it('NY23b: cancelled visit shows View/Edit link', () => {
    render(<VisitDetailDialog visit={makeVisit({ status: 'cancelled' } as Partial<Visit>)} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('visit-dialog-view-edit-link')).toBeDefined();
  });

  // NY24 — planned visit also shows View/Edit link
  it('NY24: planned visit shows View/Edit link', () => {
    render(<VisitDetailDialog visit={makeVisit({ status: 'planned' })} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('visit-dialog-view-edit-link')).toBeDefined();
  });

  // NY24b — in_progress visit shows View/Edit link
  it('NY24b: in_progress visit shows View/Edit link', () => {
    render(<VisitDetailDialog visit={makeVisit({ status: 'in_progress' })} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByTestId('visit-dialog-view-edit-link')).toBeDefined();
  });

  // NY25 — link contains the correct visitId
  it('NY25: View/Edit link targets /visits/$visitId', () => {
    render(<VisitDetailDialog visit={makeVisit({ id: 'visit-abc' })} onClose={vi.fn()} onSaved={vi.fn()} />);
    const link = screen.getByTestId('visit-dialog-view-edit-link');
    const visitId = link.getAttribute('data-visit-id') ?? link.getAttribute('href') ?? '';
    expect(visitId).toContain('visit-abc');
  });

  // NY26 — clicking the link calls onClose
  it('NY26: clicking View/Edit link calls onClose to dismiss the dialog', () => {
    const onClose = vi.fn();
    render(<VisitDetailDialog visit={makeVisit({ id: 'visit-abc' })} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByTestId('visit-dialog-view-edit-link'));
    expect(onClose).toHaveBeenCalled();
  });
});
