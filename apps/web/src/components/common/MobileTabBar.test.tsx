import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileTabBar } from './MobileTabBar';
import { mockMatchMedia, setViewport, VIEWPORTS } from '../../test/utils/responsive';

// Mock useBreakpoint so we can control the breakpoint in tests
vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(),
}));

import { useBreakpoint } from '@/hooks/useBreakpoint';
const mockUseBreakpoint = vi.mocked(useBreakpoint);

const TABS = [
  { id: 'list', label: 'List' },
  { id: 'map', label: 'Map' },
  { id: 'detail', label: 'Detail' },
];

describe('MobileTabBar', () => {
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

  it('renders all provided tabs', () => {
    render(<MobileTabBar tabs={TABS} activeTab="list" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Map' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Detail' })).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected=true', () => {
    render(<MobileTabBar tabs={TABS} activeTab="map" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Detail' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onTabChange with the tab id when a tab is clicked', async () => {
    const onTabChange = vi.fn();
    render(<MobileTabBar tabs={TABS} activeTab="list" onTabChange={onTabChange} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Map' }));
    expect(onTabChange).toHaveBeenCalledWith('map');
  });

  it('renders badge when badge > 0', () => {
    const tabsWithBadge = [
      ...TABS.slice(0, 2),
      { id: 'detail', label: 'Detail', badge: 3 },
    ];
    render(<MobileTabBar tabs={tabsWithBadge} activeTab="list" onTabChange={vi.fn()} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not render badge when badge is 0', () => {
    const tabsWithZeroBadge = [
      ...TABS.slice(0, 2),
      { id: 'detail', label: 'Detail', badge: 0 },
    ];
    render(<MobileTabBar tabs={tabsWithZeroBadge} activeTab="list" onTabChange={vi.fn()} />);
    // Badge element should not be present
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('returns null (renders nothing) on desktop', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'desktop',
      isPhone: false,
      isMobileUi: false,
      isTouch: false,
    });
    const { container } = render(
      <MobileTabBar tabs={TABS} activeTab="list" onTabChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders on tablet (isMobileUi=true)', () => {
    mockUseBreakpoint.mockReturnValue({
      breakpoint: 'tablet',
      isPhone: false,
      isMobileUi: true,
      isTouch: true,
    });
    render(<MobileTabBar tabs={TABS} activeTab="list" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('has tablist role on the container', () => {
    render(<MobileTabBar tabs={TABS} activeTab="list" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
