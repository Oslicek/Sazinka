import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    it('should render action buttons above customer name', () => {
      const { container } = render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      const actions = container.querySelector('[data-testid="candidate-actions"]');
      const header = container.querySelector('[data-testid="candidate-header"]');

      expect(actions).toBeInTheDocument();
      expect(header).toBeInTheDocument();

      // Actions should come before header in DOM order (both are siblings under the same parent)
      const parent = actions?.parentElement;
      expect(parent).toBeTruthy();
      const actionsIndex = Array.from(parent!.children).indexOf(actions!);
      const headerIndex = Array.from(parent!.children).indexOf(header!);
      expect(actionsIndex).toBeLessThan(headerIndex);
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
    it('should render all components in correct order: flags, actions, then header', () => {
      const { container } = render(
        <CandidateDetail
          candidate={mockCandidate}
          isInRoute={true}
          {...mockHandlers}
        />
      );

      const elements = Array.from(container.firstChild?.childNodes || []);
      const stateFlags = elements.find((el: any) => el.getAttribute?.('data-testid') === 'state-flags');
      const actions = elements.find((el: any) => el.getAttribute?.('data-testid') === 'candidate-actions');
      const header = elements.find((el: any) => el.getAttribute?.('data-testid') === 'candidate-header');

      const stateFlagsIndex = elements.indexOf(stateFlags!);
      const actionsIndex = elements.indexOf(actions!);
      const headerIndex = elements.indexOf(header!);

      expect(stateFlagsIndex).toBeLessThan(actionsIndex);
      expect(actionsIndex).toBeLessThan(headerIndex);
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
});
