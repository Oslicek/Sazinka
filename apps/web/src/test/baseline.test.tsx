/**
 * Phase 0.1 — Baseline DOM snapshots
 *
 * These snapshots capture the DOM structure BEFORE responsive changes.
 * They serve as a regression guard: if a desktop snapshot changes unexpectedly
 * during a later phase, the test will fail and require a deliberate update.
 *
 * To update snapshots intentionally:
 *   pnpm vitest --update-snapshots
 *
 * NOTE: DOM snapshots do not catch CSS layout bugs. Manual visual testing at
 * 375px / 390px / 768px / 1280px is required alongside these tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { mockMatchMedia, setViewport, VIEWPORTS } from './utils/responsive';

// ── Mocks required by Layout ──────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useNavigate: vi.fn(() => vi.fn()),
  useSearch: vi.fn(() => ({})),
}));

vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector: (s: { isConnected: boolean }) => unknown) =>
    selector({ isConnected: true }),
  ),
}));

vi.mock('../stores/activeJobsStore', () => ({
  useActiveJobsStore: vi.fn((selector: (s: { activeCount: number }) => unknown) =>
    selector({ activeCount: 0 }),
  ),
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector: (s: {
    user: { name: string; role: string } | null;
    logout: () => void;
    hasPermission: (p: string) => boolean;
  }) => unknown) =>
    selector({
      user: { name: 'Test User', role: 'admin' },
      logout: vi.fn(),
      hasPermission: () => true,
    }),
  ),
}));

// ── Layout baseline ───────────────────────────────────────────────────────────

import { Layout } from '../components/Layout';

describe('Layout baseline snapshots', () => {
  beforeEach(() => {
    mockMatchMedia(VIEWPORTS.desktop.width);
    setViewport(VIEWPORTS.desktop.width, VIEWPORTS.desktop.height);
  });

  it('desktop (1280px) — header structure matches snapshot', () => {
    const { container } = render(
      <Layout>
        <div data-testid="page-content">content</div>
      </Layout>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('phone (390px) — header structure matches snapshot', () => {
    mockMatchMedia(VIEWPORTS.phone.width);
    setViewport(VIEWPORTS.phone.width, VIEWPORTS.phone.height);
    const { container } = render(
      <Layout>
        <div data-testid="page-content">content</div>
      </Layout>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });

  it('tablet (768px) — header structure matches snapshot', () => {
    mockMatchMedia(VIEWPORTS.tablet.width);
    setViewport(VIEWPORTS.tablet.width, VIEWPORTS.tablet.height);
    const { container } = render(
      <Layout>
        <div data-testid="page-content">content</div>
      </Layout>,
    );
    expect(container.firstChild).toMatchSnapshot();
  });
});
