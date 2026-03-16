import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DetachedPanelPage } from '../DetachedPanelPage';

vi.mock('@/panels', () => ({
  RouteMapPanel: () => <div data-testid="map-panel">MapPanel</div>,
  RouteTimelinePanel: () => <div data-testid="route-panel">RoutePanel</div>,
  CustomerDetailPanel: () => <div data-testid="detail-panel">DetailPanel</div>,
  InboxListPanel: () => <div data-testid="list-panel">ListPanel</div>,
  RouteListPanel: () => <div data-testid="routeList-panel">RouteListPanel</div>,
}));

vi.mock('@/contexts/PanelStateContext', () => ({
  PanelStateProvider: ({
    children,
    enableChannel,
  }: {
    children: React.ReactNode;
    enableChannel: boolean;
  }) => (
    <div data-testid="panel-provider" data-enable-channel={String(enableChannel)}>
      {children}
    </div>
  ),
}));

describe('DetachedPanelPage', () => {
  it('renders the requested panel (map)', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
  });

  it('renders the requested panel (route)', () => {
    render(<DetachedPanelPage panel="route" pageContext="inbox" />);
    expect(screen.getByTestId('route-panel')).toBeInTheDocument();
  });

  it('renders the requested panel (detail)', () => {
    render(<DetachedPanelPage panel="detail" pageContext="inbox" />);
    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();
  });

  it('wraps panel in PanelStateProvider with enableChannel=true', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    const provider = screen.getByTestId('panel-provider');
    expect(provider).toHaveAttribute('data-enable-channel', 'true');
  });
});
