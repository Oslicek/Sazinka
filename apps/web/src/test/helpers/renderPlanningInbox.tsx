/**
 * Shared viewport + breakpoint setup for PlanningInbox tests.
 * Service mocks stay in each test file (Vitest hoists vi.mock).
 */
import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { mockMatchMedia, setViewport, VIEWPORTS } from '../utils/responsive';
import type { BreakpointState } from '@/hooks/useBreakpoint';

export function setupPlanningInboxDesktop(
  mockUseBreakpoint: { mockReturnValue: (v: BreakpointState) => void },
): void {
  mockMatchMedia(VIEWPORTS.desktop.width);
  setViewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
  mockUseBreakpoint.mockReturnValue({
    breakpoint: 'desktop',
    isPhone: false,
    isMobileUi: false,
    isTouch: false,
  });
}

export function setupPlanningInboxPhone(
  mockUseBreakpoint: { mockReturnValue: (v: BreakpointState) => void },
): void {
  mockMatchMedia(VIEWPORTS.phone.width);
  setViewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
  mockUseBreakpoint.mockReturnValue({
    breakpoint: 'phone',
    isPhone: true,
    isMobileUi: true,
    isTouch: true,
  });
}

export function setupPlanningInboxTablet(
  mockUseBreakpoint: { mockReturnValue: (v: BreakpointState) => void },
): void {
  mockMatchMedia(VIEWPORTS.tablet.width);
  setViewport(VIEWPORTS.tablet.width, VIEWPORTS.tablet.height);
  mockUseBreakpoint.mockReturnValue({
    breakpoint: 'tablet',
    isPhone: false,
    isMobileUi: true,
    isTouch: true,
  });
}

export interface RenderPlanningInboxResult {
  user: ReturnType<typeof userEvent.setup>;
}

/**
 * Renders UI with optional Testing Library options; sets up userEvent.setup().
 */
export function renderPlanningInbox(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
): RenderPlanningInboxResult & ReturnType<typeof render> {
  const user = userEvent.setup();
  const view = render(ui, options);
  return { user, ...view };
}
