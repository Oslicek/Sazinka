/**
 * Phase 8 — WorkLog mobile card layout tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockMatchMedia, setViewport, VIEWPORTS } from '../test/utils/responsive';

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(),
}));
import { useBreakpoint } from '@/hooks/useBreakpoint';
const mockUseBreakpoint = vi.mocked(useBreakpoint);

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; params?: Record<string, string>; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../services/visitService', () => ({
  listVisits: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getVisitTypeLabel: vi.fn((t: string) => t),
  getVisitStatusLabel: vi.fn((s: string) => s),
}));
vi.mock('../services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue(null),
}));
vi.mock('../components/worklog/QuickVisitDialog', () => ({
  QuickVisitDialog: () => null,
}));
vi.mock('../components/shared/PlannerFilters', () => ({
  PlannerFilters: () => <div data-testid="planner-filters" />,
}));

import { WorkLog } from './WorkLog';

describe('WorkLog — Phase 8 mobile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('desktop layout', () => {
    beforeEach(() => {
      mockMatchMedia(VIEWPORTS.desktop.width);
      setViewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
      mockUseBreakpoint.mockReturnValue({
        breakpoint: 'desktop',
        isPhone: false,
        isMobileUi: false,
        isTouch: false,
      });
    });

    it('renders the page container', () => {
      render(<WorkLog />);
      expect(document.querySelector('[class*="page"]')).toBeInTheDocument();
    });

    it('does NOT render mobile card list on desktop', () => {
      render(<WorkLog />);
      expect(document.querySelector('[class*="mobileCard"]')).not.toBeInTheDocument();
    });

    it('desktop layout matches snapshot', () => {
      const { container } = render(<WorkLog />);
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  describe('mobile layout', () => {
    beforeEach(() => {
      mockMatchMedia(VIEWPORTS.phone.width);
      setViewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
      mockUseBreakpoint.mockReturnValue({
        breakpoint: 'phone',
        isPhone: true,
        isMobileUi: true,
        isTouch: true,
      });
    });

    it('renders the page container on mobile', () => {
      render(<WorkLog />);
      expect(document.querySelector('[class*="page"]')).toBeInTheDocument();
    });

    it('quick-create button is present on mobile', () => {
      render(<WorkLog />);
      expect(screen.getByText('worklog_quick_create')).toBeInTheDocument();
    });
  });

  describe('tablet layout', () => {
    it('renders page container on tablet (isMobileUi=true)', () => {
      mockMatchMedia(VIEWPORTS.tablet.width);
      setViewport(VIEWPORTS.tablet.width, VIEWPORTS.tablet.height);
      mockUseBreakpoint.mockReturnValue({
        breakpoint: 'tablet',
        isPhone: false,
        isMobileUi: true,
        isTouch: true,
      });
      render(<WorkLog />);
      expect(document.querySelector('[class*="page"]')).toBeInTheDocument();
    });
  });
});
