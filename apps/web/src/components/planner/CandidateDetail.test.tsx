import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CandidateDetail, type CandidateDetailData } from './CandidateDetail';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
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
        expect(screen.getByText(/odložit o den/i)).toBeInTheDocument();
        expect(screen.getByText(/o 2 týdny/i)).toBeInTheDocument();
        expect(screen.getByText(/o měsíc/i)).toBeInTheDocument();
        // "o týden" appears in both primary button and dropdown - check we have at least 2
        expect(screen.getAllByText(/o týden/i).length).toBeGreaterThanOrEqual(2);
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

      // "Odložit o týden" in dropdown (exact match) - primary has "⏰ Odložit o týden"
      const weekOption = await screen.findByRole('button', { name: /^Odložit o týden$/i });
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

      const stateFlags = screen.getByTestId('state-flags');
      expect(stateFlags).toHaveTextContent(/termín/i);
      expect(stateFlags).toHaveTextContent(/v trase/i);
    });

    it('should show "Termín: Ne" when not scheduled', () => {
      render(
        <CandidateDetail
          candidate={mockCandidate}
          {...mockHandlers}
        />
      );

      const stateFlags = screen.getByTestId('state-flags');
      expect(stateFlags).toHaveTextContent(/termín/i);
      expect(stateFlags).toHaveTextContent(/ne/i);
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
      expect(stateFlags).toHaveTextContent(/termín/i);
      expect(stateFlags).toHaveTextContent(/ano/i);
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
      expect(stateFlags).toHaveTextContent(/v trase/i);
      expect(stateFlags).toHaveTextContent(/ne/i);
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
      expect(stateFlags).toHaveTextContent(/v trase/i);
      expect(stateFlags).toHaveTextContent(/ano/i);
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
});
