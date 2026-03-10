/**
 * Phase 5 — Plan page mobile layout tests
 *
 * The Plan page uses CSS-only responsive stacking (no JSX branching).
 * Tests verify the DOM structure has the expected classes for CSS to target.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { mockMatchMedia, setViewport, VIEWPORTS } from '../test/utils/responsive';

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../services/routeService', () => ({
  getRoute: vi.fn().mockResolvedValue(null),
  listRoutes: vi.fn().mockResolvedValue([]),
  saveRoute: vi.fn(),
  recalculateRoute: vi.fn(),
}));
vi.mock('../services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue(null),
}));
vi.mock('../services/geometryService', () => ({
  calculateRouteShape: vi.fn().mockResolvedValue(null),
}));

vi.mock('../components/planner', () => ({
  RouteListPanel: () => <div data-testid="route-list-panel" />,
  RouteDetailTimeline: () => <div data-testid="route-detail-timeline" />,
  RouteMapPanel: () => <div data-testid="route-map-panel" />,
  PlanningTimeline: () => null,
  TimelineViewToggle: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
}));

vi.mock('../components/shared/PlannerFilters', () => ({
  PlannerFilters: () => <div data-testid="planner-filters" />,
}));

import { Plan } from './Plan';

describe('Plan page — mobile layout structure', () => {
  describe('desktop (1280px)', () => {
    beforeEach(() => {
      mockMatchMedia(VIEWPORTS.desktop.width);
      setViewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
    });

    it('renders the planner container', () => {
      const { container } = render(<Plan />);
      const planner = container.querySelector('[class*="planner"]');
      expect(planner).toBeInTheDocument();
    });

    it('renders sidebar and map wrapper', () => {
      const { container } = render(<Plan />);
      expect(container.querySelector('[class*="sidebar"]')).toBeInTheDocument();
      expect(container.querySelector('[class*="mapWrapper"]')).toBeInTheDocument();
    });

    it('renders sidebar resizer (visible on desktop)', () => {
      const { container } = render(<Plan />);
      expect(container.querySelector('[class*="sidebarResizer"]')).toBeInTheDocument();
    });

    it('desktop layout matches snapshot', () => {
      const { container } = render(<Plan />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('mobile / tablet structure', () => {
    beforeEach(() => {
      mockMatchMedia(VIEWPORTS.phone.width);
      setViewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
    });

    it('still renders sidebar and mapWrapper (CSS handles stacking)', () => {
      const { container } = render(<Plan />);
      expect(container.querySelector('[class*="sidebar"]')).toBeInTheDocument();
      expect(container.querySelector('[class*="mapWrapper"]')).toBeInTheDocument();
    });

    it('still renders sidebarResizer in DOM (CSS hides it at ≤ 1023px)', () => {
      const { container } = render(<Plan />);
      // The resizer is present in DOM; CSS `display: none` hides it
      expect(container.querySelector('[class*="sidebarResizer"]')).toBeInTheDocument();
    });
  });
});
