/**
 * P1-2 — Jobs page persistence tests
 *
 * Covers:
 *  - historyFilter tab survives unmount/remount via UPP session channel
 *  - multi-cycle persistence
 *  - corrupted storage falls back to 'all'
 *
 * TDD: RED tests written before implementing UPP wiring in Jobs.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { makeEnvelope, makeKey } from '../persistence/core/types';
import { JOBS_PROFILE_ID } from '../persistence/profiles/jobsProfile';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: vi.fn(() => ({})),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean; request: unknown; subscribe: unknown }) => unknown) => {
    const state = { isConnected: false, request: vi.fn(), subscribe: vi.fn().mockResolvedValue(() => {}) };
    return selector ? selector(state) : state;
  }),
}));

const TEST_USER_ID = 'jobs-test-user';

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: TEST_USER_ID } };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../stores/activeJobsStore', () => ({
  useActiveJobsStore: vi.fn((selector?: (s: { jobs: Map<string, unknown> }) => unknown) => {
    const state = { jobs: new Map() };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../services/jobService', () => ({
  cancelJob: vi.fn(),
  retryJob: vi.fn(),
  listJobHistory: vi.fn().mockResolvedValue({ jobs: [] }),
}));

vi.mock('../services/exportPlusService', () => ({
  downloadExportJob: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedUpp(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: JOBS_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

import { Jobs } from './Jobs';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Jobs page — persistence (P1-2)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('historyFilter tab restores persisted value on remount', async () => {
    seedUpp('historyFilter', 'failed');

    render(<Jobs />);

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /failed/i });
      expect(btn.className).toMatch(/activeTab/);
    });
  });

  it('historyFilter survives two unmount/remount cycles', async () => {
    seedUpp('historyFilter', 'completed');

    const { unmount: unmount1 } = render(<Jobs />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /completed/i }).className).toMatch(/activeTab/);
    });
    unmount1();

    render(<Jobs />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /completed/i }).className).toMatch(/activeTab/);
    });
  });

  it('corrupted storage value falls back to "all" tab', async () => {
    const key = makeKey({ userId: TEST_USER_ID, profileId: JOBS_PROFILE_ID, controlId: 'historyFilter' });
    sessionStorage.setItem(key, 'not-a-valid-envelope');

    render(<Jobs />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /all/i }).className).toMatch(/activeTab/);
    });
  });

  it('defaults to "all" tab when nothing is persisted', async () => {
    render(<Jobs />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /all/i }).className).toMatch(/activeTab/);
    });
  });
});
