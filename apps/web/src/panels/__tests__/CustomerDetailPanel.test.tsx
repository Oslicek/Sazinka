import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { usePanelState } from '../../hooks/usePanelState';
import { CustomerDetailPanel } from '../CustomerDetailPanel';
import type { PanelActions } from '../../types/panelState';

vi.mock('@/components/planner', () => ({
  CandidateDetail: () => <div data-testid="candidate-detail" />,
}));

// Captures actions reference during render (safe: RTL renders synchronously)
function makeActionsCapture() {
  const ref: { actions: PanelActions | null } = { actions: null };
  function ActionsCapture() {
    ref.actions = usePanelState().actions;
    return null;
  }
  return { ref, ActionsCapture };
}

describe('CustomerDetailPanel', () => {
  it('renders nothing when selectedCustomerId is null', () => {
    render(
      <PanelStateProvider>
        <CustomerDetailPanel mode="inbox" />
      </PanelStateProvider>,
    );

    expect(screen.queryByTestId('candidate-detail')).not.toBeInTheDocument();
  });

  it('renders nothing in plan mode even when selectedCustomerId is set (closed by default)', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <CustomerDetailPanel mode="plan" />
      </PanelStateProvider>,
    );

    act(() => {
      ref.actions!.selectCustomer('cust-1');
    });

    expect(screen.queryByTestId('candidate-detail')).not.toBeInTheDocument();
  });

  it('renders customer detail in inbox mode when selectedCustomerId is set', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <CustomerDetailPanel mode="inbox" />
      </PanelStateProvider>,
    );

    act(() => {
      ref.actions!.selectCustomer('cust-1');
    });

    expect(screen.getByTestId('candidate-detail')).toBeInTheDocument();
  });

  it('renders in plan mode when explicitly opened via isOpen prop', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <CustomerDetailPanel mode="plan" isOpen={true} />
      </PanelStateProvider>,
    );

    act(() => {
      ref.actions!.selectCustomer('cust-1');
    });

    expect(screen.getByTestId('candidate-detail')).toBeInTheDocument();
  });

  it('calls actions.selectCustomer(null) on close/dismiss', () => {
    const { ref, ActionsCapture } = makeActionsCapture();

    render(
      <PanelStateProvider>
        <ActionsCapture />
        <CustomerDetailPanel mode="inbox" />
      </PanelStateProvider>,
    );

    act(() => {
      ref.actions!.selectCustomer('cust-1');
    });

    expect(screen.getByTestId('candidate-detail')).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: /close/i }).click();
    });

    expect(screen.queryByTestId('candidate-detail')).not.toBeInTheDocument();
  });
});
