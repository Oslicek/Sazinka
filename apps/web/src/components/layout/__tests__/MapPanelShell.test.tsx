/**
 * MapPanelShell unit tests.
 *
 * Specifies the behavior of the shared MapPanelShell component:
 *   - Shell renders children inside a dedicated content container.
 *   - DetachButton appears only when canDetach=true.
 *   - DetachButton lives in a separate controls container (not the same div as
 *     the map child) so it cannot overlap MapLibre's NavigationControl.
 *   - Clicking DetachButton calls detach() with the panel name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockDetachState } = vi.hoisted(() => ({
  mockDetachState: {
    canDetach: true,
    isDetached: vi.fn(() => false),
    detach: vi.fn(),
    reattach: vi.fn(),
  },
}));

vi.mock('@/hooks/useDetachState', () => ({
  useDetachState: () => mockDetachState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { MapPanelShell } from '../MapPanelShell';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockDetachState.canDetach = true;
  mockDetachState.isDetached.mockReturnValue(false);
});

describe('MapPanelShell', () => {
  it('renders children', () => {
    render(
      <MapPanelShell panelName="map">
        <div data-testid="child-content" />
      </MapPanelShell>,
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders the shell root with data-testid="map-panel-shell"', () => {
    render(
      <MapPanelShell panelName="map">
        <div />
      </MapPanelShell>,
    );
    expect(screen.getByTestId('map-panel-shell')).toBeInTheDocument();
  });

  it('renders DetachButton when canDetach=true', () => {
    render(
      <MapPanelShell panelName="map">
        <div />
      </MapPanelShell>,
    );
    expect(
      screen.getByRole('button', { name: /open in new window/i }),
    ).toBeInTheDocument();
  });

  it('does not render DetachButton when canDetach=false', () => {
    mockDetachState.canDetach = false;
    render(
      <MapPanelShell panelName="map">
        <div />
      </MapPanelShell>,
    );
    expect(
      screen.queryByRole('button', { name: /open in new window/i }),
    ).not.toBeInTheDocument();
  });

  it('DetachButton is inside map-panel-shell-controls, not map-panel-shell-content', () => {
    render(
      <MapPanelShell panelName="map">
        <div data-testid="child-content" />
      </MapPanelShell>,
    );

    const controls = screen.getByTestId('map-panel-shell-controls');
    const content = screen.getByTestId('map-panel-shell-content');
    const btn = screen.getByRole('button', { name: /open in new window/i });

    // Button is inside controls
    expect(controls).toContainElement(btn);
    // Button is NOT inside content (would overlap map)
    expect(content).not.toContainElement(btn);
    // Child is inside content
    expect(content).toContainElement(screen.getByTestId('child-content'));
  });

  it('calls detach with the panelName when DetachButton is clicked', async () => {
    const user = userEvent.setup();
    render(
      <MapPanelShell panelName="map">
        <div />
      </MapPanelShell>,
    );
    await user.click(screen.getByRole('button', { name: /open in new window/i }));
    expect(mockDetachState.detach).toHaveBeenCalledWith('map');
  });

  it('uses provided panelName when calling detach', async () => {
    const user = userEvent.setup();
    render(
      <MapPanelShell panelName="list">
        <div />
      </MapPanelShell>,
    );
    await user.click(screen.getByRole('button', { name: /open in new window/i }));
    expect(mockDetachState.detach).toHaveBeenCalledWith('list');
  });
});
