import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DetachedPanelPage } from '../DetachedPanelPage';

vi.mock('@/panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="map-panel">MapPanel</div>,
}));

vi.mock('@/panels/InboxListPanel', () => ({
  InboxListPanel: () => <div data-testid="list-panel">ListPanel</div>,
}));

vi.mock('@/contexts/PanelStateContext', () => ({
  PanelStateProvider: ({
    children,
    enableChannel,
    isSourceOfTruth,
  }: {
    children: React.ReactNode;
    enableChannel: boolean;
    isSourceOfTruth: boolean;
  }) => (
    <div
      data-testid="panel-provider"
      data-enable-channel={String(enableChannel)}
      data-source-of-truth={String(isSourceOfTruth)}
    >
      {children}
    </div>
  ),
}));

describe('DetachedPanelPage', () => {
  it('renders Map panel at /panel/map', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    expect(screen.getByTestId('map-panel')).toBeInTheDocument();
  });

  it('renders List panel at /panel/list', () => {
    render(<DetachedPanelPage panel="list" pageContext="inbox" />);
    expect(screen.getByTestId('list-panel')).toBeInTheDocument();
  });

  it('wraps panel in PanelStateProvider with enableChannel=true', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    expect(screen.getByTestId('panel-provider')).toHaveAttribute('data-enable-channel', 'true');
  });

  it('wraps panel in PanelStateProvider with isSourceOfTruth=false', () => {
    render(<DetachedPanelPage panel="map" pageContext="inbox" />);
    expect(screen.getByTestId('panel-provider')).toHaveAttribute('data-source-of-truth', 'false');
  });
});
