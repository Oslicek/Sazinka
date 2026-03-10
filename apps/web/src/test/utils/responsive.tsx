import { vi } from 'vitest';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

// ── Viewport helpers ──────────────────────────────────────────────────────────

export const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  phone: { width: 390, height: 844 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

export function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
  window.dispatchEvent(new Event('resize'));
}

export function setViewportByName(name: ViewportName): void {
  const { width, height } = VIEWPORTS[name];
  setViewport(width, height);
}

// ── matchMedia mock ───────────────────────────────────────────────────────────

export function mockMatchMedia(width = 1280): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => {
      // Parse max-width and min-width queries
      const maxMatch = query.match(/max-width:\s*(\d+)px/);
      const minMatch = query.match(/min-width:\s*(\d+)px/);

      let matches = false;
      if (maxMatch) matches = width <= parseInt(maxMatch[1]);
      if (minMatch) matches = width >= parseInt(minMatch[1]);

      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

// ── Router-aware render ───────────────────────────────────────────────────────

/**
 * Renders a component with a minimal router mock already applied.
 * Use for components that call useNavigate / useSearch / Link.
 */
export function renderWithRouter(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return render(ui, options);
}
