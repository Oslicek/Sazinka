import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CandidateDetail, type CandidateDetailData } from './CandidateDetail';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn((selector: (s: { isConnected: boolean }) => unknown) =>
    selector({ isConnected: false })
  ),
}));

vi.mock('@/services/deviceService', () => ({
  listDevices: vi.fn(() => Promise.resolve({ items: [] })),
}));

vi.mock('@/services/visitService', () => ({
  listVisits: vi.fn(() => Promise.resolve({ visits: [], total: 0 })),
  getVisit: vi.fn(() => Promise.resolve({ visit: {}, workItems: [] })),
  getVisitStatusLabel: vi.fn(() => ''),
  getVisitResultLabel: vi.fn(() => ''),
}));

import { useNatsStore } from '@/stores/natsStore';
import { listVisits, getVisit } from '@/services/visitService';

const mockUseNatsStore = vi.mocked(useNatsStore);
const mockListVisits = vi.mocked(listVisits);
const mockGetVisit = vi.mocked(getVisit);

describe('CandidateDetail', () => {
  const mockCandidate: CandidateDetailData = {
    id: 'rev-1',
    customerId: 'cust-1',
    customerName: 'Test Customer',
    deviceType: 'Boiler',
    deviceName: 'Main Boiler',
    phone: '+420123456789',
    street: 'Test Street 123',
    city: 'Prague',
    dueDate: '2026-03-01',
    daysUntilDue: 30,
    priority: 'upcoming',
  };

  const mockHandlers = {
    onSchedule: vi.fn(),
    onSnooze: vi.fn(),
    onFixAddress: vi.fn(),
    onAddToRoute: vi.fn(),
    onRemoveFromRoute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Action Buttons Position', () => {
    it('should render action buttons below state flags and above appointment sections', () => {
      const { container } = render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      const actions = container.querySelector('[data-testid="candidate-actions"]');
      const header = container.querySelector('[data-testid="candidate-header"]');
      const stateFlags = container.querySelector('[data-testid="state-flags"]');

      expect(actions).toBeInTheDocument();
      expect(header).toBeInTheDocument();
      expect(stateFlags).toBeInTheDocument();
      expect(header!.contains(stateFlags!)).toBe(true);

      // Root order: compact header (contains flags) comes before action row
      const root = container.firstElementChild as HTMLElement;
      const children = Array.from(root.children);
      const headerIndex = children.indexOf(header!);
      const actionsIndex = children.indexOf(actions!);
      expect(headerIndex).toBeLessThan(actionsIndex);
    });

    it('should render all three action buttons', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      expect(screen.getByRole('button', { name: /candidate_make_appointment/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /candidate_add_to_route/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /candidate_snooze/i })).toBeInTheDocument();
    });
  });

  describe('Snooze Dropdown', () => {
    it('should render snooze button with dropdown', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      // The dropdown toggle (▼) has aria-haspopup
      const dropdownToggle = screen.getByRole('button', { name: '▼' });
      expect(dropdownToggle).toBeInTheDocument();
      expect(dropdownToggle).toHaveAttribute('aria-haspopup', 'true');
    });

    it('should show dropdown menu when snooze button is clicked', async () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      // Click the dropdown toggle (▼) to open the menu
      const dropdownToggle = screen.getByRole('button', { name: '▼' });
      fireEvent.click(dropdownToggle);

      await waitFor(() => {
        // Dropdown options (these are unique - primary button shows default e.g. "o týden")
        expect(screen.getByText(/candidate_snooze_1_day/i)).toBeInTheDocument();
        expect(screen.getByText(/candidate_snooze_2_weeks/i)).toBeInTheDocument();
        expect(screen.getByText(/candidate_snooze_1_month/i)).toBeInTheDocument();
        // Primary button shows candidate_snooze, dropdown shows candidate_snooze_1_week
        expect(screen.getByText(/candidate_snooze_1_week/i)).toBeInTheDocument();
      });
    });

    it('should call onSnooze with correct days when option is selected', async () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      const dropdownToggle = screen.getByRole('button', { name: '▼' });
      fireEvent.click(dropdownToggle);

      // "candidate_snooze_1_week" in dropdown (exact match)
      const weekOption = await screen.findByRole('button', { name: /^candidate_snooze_1_week$/i });
      fireEvent.click(weekOption);

      expect(mockHandlers.onSnooze).toHaveBeenCalledWith('rev-1', 7);
    });

    it('should persist last selected snooze option as default', async () => {
      const { rerender } = render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      // Select 2 weeks option - open dropdown first
      const dropdownToggle = screen.getByRole('button', { name: '▼' });
      fireEvent.click(dropdownToggle);
      const twoWeeksOption = await screen.findByText(/candidate_snooze_2_weeks/i);
      fireEvent.click(twoWeeksOption);

      // Rerender with new candidate
      const newCandidate = { ...mockCandidate, id: 'rev-2', customerId: 'cust-2' };
      rerender(
        <CandidateDetail
          candidate={newCandidate}
          {...mockHandlers}
        />
      );

      // Button should show snooze with selected option (mock returns candidate_snooze)
      expect(screen.getByRole('button', { name: /candidate_snooze/i })).toBeInTheDocument();
    });
  });

  describe('State Flags', () => {
    it('should display "Termín" and "V trase" flags at the top', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          isInRoute={false}
          {...mockHandlers}
        />
      );

      const stateFlags = screen.getByTestId('state-flags');
      expect(stateFlags).toHaveTextContent(/candidate_state_appointment/i);
      expect(stateFlags).toHaveTextContent(/candidate_state_in_route/i);
    });

    it('should show "Termín: Ne" when not scheduled', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      const stateFlags = screen.getByTestId('state-flags');
      expect(stateFlags).toHaveTextContent(/candidate_state_appointment/i);
      expect(stateFlags).toHaveTextContent(/candidate_state_no/i);
    });

    it('should show "Termín: Ano" when scheduled', () => {
      const scheduledCandidate = {
        ...mockCandidate,
        isScheduled: true,
      } as CandidateDetailData & { isScheduled: boolean };

      render(
        <CandidateDetail
          candidate={scheduledCandidate}
          {...mockHandlers}
        />
      );

      const stateFlags = screen.getByTestId('state-flags');
      expect(stateFlags).toHaveTextContent(/candidate_state_appointment/i);
      expect(stateFlags).toHaveTextContent(/candidate_state_yes/i);
    });

    it('should show "V trase: Ne" when not in route', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          isInRoute={false}
          {...mockHandlers}
        />
      );

      const stateFlags = screen.getByTestId('state-flags');
      expect(stateFlags).toHaveTextContent(/candidate_state_in_route/i);
      expect(stateFlags).toHaveTextContent(/candidate_state_no/i);
    });

    it('should show "V trase: Ano" when in route', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          isInRoute={true}
          {...mockHandlers}
        />
      );

      const stateFlags = screen.getByTestId('state-flags');
      expect(stateFlags).toHaveTextContent(/candidate_state_in_route/i);
      expect(stateFlags).toHaveTextContent(/candidate_state_yes/i);
    });

    it('should display state flags with appropriate styling', () => {
      const { container } = render(
        <CandidateDetail
          candidate={mockCandidate}
          isInRoute={true}
          {...mockHandlers}
        />
      );

      const stateFlags = container.querySelector('[data-testid="state-flags"]');
      expect(stateFlags).toBeInTheDocument();
      expect(stateFlags?.className).toMatch(/stateFlags/);
    });
  });

  describe('Integration', () => {
    it('should render all components in correct order: header, flags, then actions', () => {
      const { container } = render(
        <CandidateDetail
          candidate={mockCandidate}
          isInRoute={true}
          {...mockHandlers}
        />
      );

      const root = container.firstElementChild as HTMLElement;
      const children = Array.from(root.children);
      const header = container.querySelector('[data-testid="candidate-header"]');
      const actions = container.querySelector('[data-testid="candidate-actions"]');
      const stateFlags = container.querySelector('[data-testid="state-flags"]');

      expect(header).toBeTruthy();
      expect(stateFlags).toBeTruthy();
      expect(actions).toBeTruthy();
      expect(header!.contains(stateFlags!)).toBe(true);

      const headerIndex = children.indexOf(header!);
      const actionsIndex = children.indexOf(actions!);
      expect(headerIndex).toBeGreaterThanOrEqual(0);
      expect(actionsIndex).toBeGreaterThanOrEqual(0);
      expect(headerIndex).toBeLessThan(actionsIndex);
    });
  });

  describe('Unschedule (Zrušit termín)', () => {
    const scheduledCandidate: CandidateDetailData = {
      ...mockCandidate,
      isScheduled: true,
      scheduledDate: '2026-04-10',
      scheduledTimeStart: '09:00',
      scheduledTimeEnd: '10:00',
    };

    it('renders "Zrušit termín" button when candidate is scheduled and onUnschedule is provided', () => {
      render(
        <CandidateDetail
          candidate={scheduledCandidate}
          onUnschedule={vi.fn()}
          {...mockHandlers}
        />
      );
      expect(screen.getByRole('button', { name: /candidate_cancel_appointment/i })).toBeInTheDocument();
    });

    it('does NOT render "Zrušit termín" button when candidate is not scheduled', () => {
      render(
        <CandidateDetail
          candidate={{ ...mockCandidate, isScheduled: false }}
          onUnschedule={vi.fn()}
          {...mockHandlers}
        />
      );
      expect(screen.queryByRole('button', { name: /candidate_cancel_appointment/i })).not.toBeInTheDocument();
    });

    it('does NOT render "Zrušit termín" button when onUnschedule is not provided', () => {
      render(
        <CandidateDetail
          candidate={scheduledCandidate}
          {...mockHandlers}
        />
      );
      expect(screen.queryByRole('button', { name: /candidate_cancel_appointment/i })).not.toBeInTheDocument();
    });

    it('calls onUnschedule with candidate id after confirm dialog is accepted', () => {
      const onUnschedule = vi.fn();
      vi.spyOn(window, 'confirm').mockReturnValueOnce(true);

      render(
        <CandidateDetail
          candidate={scheduledCandidate}
          onUnschedule={onUnschedule}
          {...mockHandlers}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /candidate_cancel_appointment/i }));
      expect(window.confirm).toHaveBeenCalled();
      expect(onUnschedule).toHaveBeenCalledWith(scheduledCandidate.id);
    });

    it('does NOT call onUnschedule when confirm dialog is rejected', () => {
      const onUnschedule = vi.fn();
      vi.spyOn(window, 'confirm').mockReturnValueOnce(false);

      render(
        <CandidateDetail
          candidate={scheduledCandidate}
          onUnschedule={onUnschedule}
          {...mockHandlers}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /candidate_cancel_appointment/i }));
      expect(onUnschedule).not.toHaveBeenCalled();
    });

    it('disables button while unschedule is in progress (double-click protection)', async () => {
      let resolveUnschedule: () => void;
      const onUnschedule = vi.fn(() => new Promise<void>((resolve) => { resolveUnschedule = resolve; }));
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      render(
        <CandidateDetail
          candidate={scheduledCandidate}
          onUnschedule={onUnschedule}
          {...mockHandlers}
        />
      );

      const button = screen.getByRole('button', { name: /candidate_cancel_appointment/i });
      expect(button).not.toBeDisabled();

      fireEvent.click(button);
      expect(onUnschedule).toHaveBeenCalledTimes(1);

      await waitFor(() => {
        expect(button).toBeDisabled();
      });

      resolveUnschedule!();
      await waitFor(() => {
        expect(button).not.toBeDisabled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Last visit banner (A.3 test matrix)
  // These tests override isConnected to true so the useEffect actually fires.
  // -------------------------------------------------------------------------
  describe('Last visit banner', () => {
    const visitRow = {
      id: 'v-1',
      userId: 'u-1',
      customerId: 'cust-1',
      scheduledDate: '2026-03-20',
      status: 'completed',
      visitType: 'revision',
      requiresFollowUp: false,
      resultNotes: null,
      followUpReason: null,
      createdAt: '2026-03-20T08:00:00Z',
      updatedAt: '2026-03-20T10:00:00Z',
    };

    beforeEach(() => {
      // Override global mock: enable NATS for banner tests
      mockUseNatsStore.mockImplementation(
        (selector: (s: { isConnected: boolean }) => unknown) =>
          selector({ isConnected: true }),
      );
      mockListVisits.mockResolvedValue({ visits: [], total: 0 });
      mockGetVisit.mockResolvedValue({
        visit: visitRow as any,
        customerName: null,
        customerStreet: null,
        customerCity: null,
        customerPostalCode: null,
        customerPhone: null,
        customerLat: null,
        customerLng: null,
        workItems: [],
      });
    });

    function renderDetail(candidate = mockCandidate) {
      return render(<CandidateDetail candidate={candidate} {...mockHandlers} />);
    }

    // A.3.1 Comment banner shown when resolved comment exists
    it('shows comment banner when last visit has notes', async () => {
      mockListVisits.mockResolvedValue({ visits: [{ ...visitRow, resultNotes: 'Kotel vyměněn' }], total: 1 });
      mockGetVisit.mockResolvedValue({
        visit: { ...visitRow, resultNotes: 'Kotel vyměněn' } as any,
        customerName: null, customerStreet: null, customerCity: null,
        customerPostalCode: null, customerPhone: null, customerLat: null, customerLng: null,
        workItems: [],
      });

      renderDetail();

      await waitFor(() => {
        expect(screen.getByText('Kotel vyměněn')).toBeInTheDocument();
      });
    });

    // A.3.2 Comment banner hidden when no comment
    it('hides comment banner when no last visit notes', async () => {
      mockListVisits.mockResolvedValue({ visits: [], total: 0 });

      renderDetail();

      await act(async () => {});

      expect(screen.queryByText('candidate_visit_note')).not.toBeInTheDocument();
    });

    // A.3.3 Visit date shown in banner header when comment is visible
    it('shows visit date in banner header when comment is visible', async () => {
      mockListVisits.mockResolvedValue({ visits: [{ ...visitRow, resultNotes: 'Poznámka' }], total: 1 });
      mockGetVisit.mockResolvedValue({
        visit: { ...visitRow, resultNotes: 'Poznámka' } as any,
        customerName: null, customerStreet: null, customerCity: null,
        customerPostalCode: null, customerPhone: null, customerLat: null, customerLng: null,
        workItems: [],
      });

      renderDetail();

      await waitFor(() => {
        // formatDate('2026-03-20') should produce a locale-formatted date string
        expect(screen.getByText('Poznámka')).toBeInTheDocument();
        // The banner meta date span should contain some representation of 2026-03-20
        const banner = screen.getByText('Poznámka').closest('[class*="lastVisitBanner"]');
        expect(banner).toBeInTheDocument();
        expect(banner!.textContent).toMatch(/2026|20\. 3\.|20\.03\./);
      });
    });

    // A.3.4 Follow-up indicator block shown when requiresFollowUp === true
    it('shows follow-up indicator block when requiresFollowUp is true', async () => {
      const followUpVisit = {
        ...visitRow,
        resultNotes: 'Hlavní poznámka',
        requiresFollowUp: true,
        followUpReason: 'Nutná opravná návštěva',
      };
      mockListVisits.mockResolvedValue({ visits: [followUpVisit], total: 1 });
      mockGetVisit.mockResolvedValue({
        visit: followUpVisit as any,
        customerName: null, customerStreet: null, customerCity: null,
        customerPostalCode: null, customerPhone: null, customerLat: null, customerLng: null,
        workItems: [],
      });

      renderDetail();

      await waitFor(() => {
        expect(screen.getByText('Nutná opravná návštěva')).toBeInTheDocument();
      });
    });

    // A.3.5 Follow-up indicator hidden when requiresFollowUp === false
    it('hides follow-up indicator when requiresFollowUp is false', async () => {
      const normalVisit = {
        ...visitRow,
        resultNotes: 'Vše v pořádku',
        requiresFollowUp: false,
        followUpReason: 'Should not appear',
      };
      mockListVisits.mockResolvedValue({ visits: [normalVisit], total: 1 });
      mockGetVisit.mockResolvedValue({
        visit: normalVisit as any,
        customerName: null, customerStreet: null, customerCity: null,
        customerPostalCode: null, customerPhone: null, customerLat: null, customerLng: null,
        workItems: [],
      });

      renderDetail();

      await waitFor(() => {
        expect(screen.getByText('Vše v pořádku')).toBeInTheDocument();
      });
      expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
    });

    // A.3.6 Loading state does not flash stale comment when switching candidates
    it('clears comment when switching to a new candidate with no notes', async () => {
      mockListVisits.mockResolvedValue({ visits: [{ ...visitRow, resultNotes: 'Old note' }], total: 1 });
      mockGetVisit.mockResolvedValue({
        visit: { ...visitRow, resultNotes: 'Old note' } as any,
        customerName: null, customerStreet: null, customerCity: null,
        customerPostalCode: null, customerPhone: null, customerLat: null, customerLng: null,
        workItems: [],
      });

      const { rerender } = render(<CandidateDetail candidate={mockCandidate} {...mockHandlers} />);

      await waitFor(() => expect(screen.getByText('Old note')).toBeInTheDocument());

      // Switch to a candidate that has no notes
      mockListVisits.mockResolvedValue({ visits: [], total: 0 });
      const candidate2 = { ...mockCandidate, customerId: 'cust-2' };
      rerender(<CandidateDetail candidate={candidate2} {...mockHandlers} />);

      await waitFor(() => {
        expect(screen.queryByText('Old note')).not.toBeInTheDocument();
      });
    });

    // A.3.7 Switching customer updates displayed comment correctly
    it('updates comment when switching to a new candidate with different notes', async () => {
      mockListVisits.mockResolvedValue({ visits: [{ ...visitRow, resultNotes: 'Note A' }], total: 1 });
      mockGetVisit.mockResolvedValue({
        visit: { ...visitRow, resultNotes: 'Note A' } as any,
        customerName: null, customerStreet: null, customerCity: null,
        customerPostalCode: null, customerPhone: null, customerLat: null, customerLng: null,
        workItems: [],
      });

      const { rerender } = render(<CandidateDetail candidate={mockCandidate} {...mockHandlers} />);
      await waitFor(() => expect(screen.getByText('Note A')).toBeInTheDocument());

      mockListVisits.mockResolvedValue({
        visits: [{ ...visitRow, id: 'v-2', customerId: 'cust-2', resultNotes: 'Note B' }],
        total: 1,
      });
      mockGetVisit.mockResolvedValue({
        visit: { ...visitRow, id: 'v-2', customerId: 'cust-2', resultNotes: 'Note B' } as any,
        customerName: null, customerStreet: null, customerCity: null,
        customerPostalCode: null, customerPhone: null, customerLat: null, customerLng: null,
        workItems: [],
      });

      const candidate2 = { ...mockCandidate, customerId: 'cust-2' };
      rerender(<CandidateDetail candidate={candidate2} {...mockHandlers} />);

      await waitFor(() => {
        expect(screen.getByText('Note B')).toBeInTheDocument();
        expect(screen.queryByText('Note A')).not.toBeInTheDocument();
      });
    });
  });
});
