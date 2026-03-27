/**
 * Phase 6 tests: Completion dialog field-notes integration — CD1–CD3.
 * These verify the VisitDetailDialog properly shows note previews
 * for completed visits and passes fieldNotes during completion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { Visit } from '@shared/visit';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/services/visitService', () => ({
  updateVisit: vi.fn().mockResolvedValue({}),
  completeVisit: vi.fn().mockResolvedValue({}),
  getVisitStatusLabel: (s: string) => s,
  getVisitTypeLabel: (t: string) => t,
  getVisitResultLabel: (r: string) => r,
}));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: Object.assign(vi.fn().mockReturnValue(true), {
    getState: () => ({ request: vi.fn() }),
  }),
}));

import { VisitDetailDialog } from '../../timeline/VisitDetailDialog';
import { completeVisit } from '@/services/visitService';

const BASE_VISIT: Visit = {
  id: 'v-1',
  customerId: 'c-1',
  userId: 'u-1',
  visitType: 'consultation',
  status: 'planned',
  scheduledDate: '2025-06-01',
  scheduledTimeStart: '09:00:00',
  scheduledTimeEnd: '10:00:00',
  result: null,
  fieldNotes: null,
  requiresFollowUp: false,
  followUpReason: null,
  actualArrival: null,
  actualDeparture: null,
  createdAt: '2025-06-01T08:00:00Z',
  updatedAt: '2025-06-01T08:00:00Z',
};

describe('CompleteVisit field-notes integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // CD1: shows note preview for completed visit
  it('CD1: shows fieldNotes for a completed visit', () => {
    const completed: Visit = {
      ...BASE_VISIT,
      status: 'completed',
      result: 'successful',
      fieldNotes: 'Visit went well. All work done.',
    };
    render(<VisitDetailDialog visit={completed} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText(/Visit went well/)).toBeDefined();
  });

  // CD2: completion form includes notes textarea
  it('CD2: completion form includes notes textarea', () => {
    render(<VisitDetailDialog visit={BASE_VISIT} onClose={vi.fn()} onSaved={vi.fn()} />);
    const completeBtn = screen.getByText(/visit_mark_complete/);
    fireEvent.click(completeBtn);
    const textarea = screen.getByPlaceholderText(/visit_optional_note_placeholder/);
    expect(textarea).toBeDefined();
  });

  // CD3: completing sends fieldNotes in payload
  it('CD3: completing sends fieldNotes in the payload', async () => {
    render(<VisitDetailDialog visit={BASE_VISIT} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByText(/visit_mark_complete/));

    const textarea = screen.getByPlaceholderText(/visit_optional_note_placeholder/);
    fireEvent.change(textarea, { target: { value: 'Final notes here' } });

    const confirmBtns = screen.getAllByText(/visit_complete_dialog_title/);
    const confirmBtn = confirmBtns.find((el) => el.tagName === 'BUTTON') ?? confirmBtns[confirmBtns.length - 1];
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(completeVisit).toHaveBeenCalledWith(
        expect.objectContaining({ fieldNotes: 'Final notes here' }),
      );
    });
  });
});
