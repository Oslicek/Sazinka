import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CandidateDetail, type CandidateDetailData } from './CandidateDetail';

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

      // Actions should come before header in DOM order
      const actionsIndex = Array.from(container.children).indexOf(actions?.parentElement!);
      const headerIndex = Array.from(container.children).indexOf(header?.parentElement!);
      expect(actionsIndex).toBeLessThan(headerIndex);
    });

    it('should render all three action buttons', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      expect(screen.getByRole('button', { name: /domluvit termín/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /přidat do trasy/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /odložit/i })).toBeInTheDocument();
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

      const snoozeButton = screen.getByRole('button', { name: /odložit/i });
      expect(snoozeButton).toBeInTheDocument();
      expect(snoozeButton).toHaveAttribute('aria-haspopup', 'true');
    });

    it('should show dropdown menu when snooze button is clicked', async () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      const snoozeButton = screen.getByRole('button', { name: /odložit/i });
      fireEvent.click(snoozeButton);

      await waitFor(() => {
        expect(screen.getByText(/o den/i)).toBeInTheDocument();
        expect(screen.getByText(/o týden/i)).toBeInTheDocument();
        expect(screen.getByText(/o 2 týdny/i)).toBeInTheDocument();
        expect(screen.getByText(/o měsíc/i)).toBeInTheDocument();
      });
    });

    it('should call onSnooze with correct days when option is selected', async () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      const snoozeButton = screen.getByRole('button', { name: /odložit/i });
      fireEvent.click(snoozeButton);

      const weekOption = await screen.findByText(/o týden/i);
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

      // Select 2 weeks option
      const snoozeButton = screen.getByRole('button', { name: /odložit/i });
      fireEvent.click(snoozeButton);
      const twoWeeksOption = await screen.findByText(/o 2 týdny/i);
      fireEvent.click(twoWeeksOption);

      // Rerender with new candidate
      const newCandidate = { ...mockCandidate, id: 'rev-2', customerId: 'cust-2' };
      rerender(
        <CandidateDetail
          candidate={newCandidate}
          {...mockHandlers}
        />
      );

      // Button should show "o 2 týdny" as default
      expect(screen.getByRole('button', { name: /odložit.*o 2 týdny/i })).toBeInTheDocument();
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

      expect(screen.getByText(/termín/i)).toBeInTheDocument();
      expect(screen.getByText(/v trase/i)).toBeInTheDocument();
    });

    it('should show "Termín: Ne" when not scheduled', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      expect(screen.getByText(/termín.*ne/i)).toBeInTheDocument();
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

      expect(screen.getByText(/termín.*ano/i)).toBeInTheDocument();
    });

    it('should show "V trase: Ne" when not in route', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          isInRoute={false}
          {...mockHandlers}
        />
      );

      expect(screen.getByText(/v trase.*ne/i)).toBeInTheDocument();
    });

    it('should show "V trase: Ano" when in route', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          isInRoute={true}
          {...mockHandlers}
        />
      );

      expect(screen.getByText(/v trase.*ano/i)).toBeInTheDocument();
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
      expect(stateFlags).toHaveClass('stateFlags');
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
});
