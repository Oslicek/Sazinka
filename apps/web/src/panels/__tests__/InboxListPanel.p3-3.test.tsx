/**
 * P3-3 — InboxListPanel isAdvancedFiltersOpen persistence tests
 *
 * Covers:
 *  - isAdvancedFiltersOpen survives unmount/remount via UPP session channel
 *  - closed state persists across remount
 *  - multi-cycle persistence
 *
 * TDD: RED tests written before implementing UPP wiring in InboxListPanel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { makeEnvelope, makeKey } from '@/persistence/core/types';
import { INBOX_UI_PROFILE_ID } from '@/persistence/profiles/inboxUiProfile';
import { PanelStateProvider } from '@/contexts/PanelStateContext';
import { InboxListPanel, resetInboxListCache } from '../InboxListPanel';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: () => ({ isConnected: false }),
}));

const TEST_USER_ID = 'inbox-ui-test-user';

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: TEST_USER_ID } };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/services/inboxService', () => ({
  getInbox: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock('@/services/inboxAdapter', () => ({
  inboxResponseToCallQueueResponse: vi.fn().mockReturnValue({ items: [] }),
}));

vi.mock('@/services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/routeService', () => ({
  getRoute: vi.fn().mockResolvedValue(null),
}));

// Capture isAdvancedOpen prop from InboxFilterBar
let capturedIsAdvancedOpen: boolean | undefined = undefined;

vi.mock('@/components/planner/InboxFilterBar', () => ({
  InboxFilterBar: ({
    isAdvancedOpen,
    onToggleAdvanced,
  }: {
    isAdvancedOpen?: boolean;
    onToggleAdvanced?: () => void;
  }) => {
    capturedIsAdvancedOpen = isAdvancedOpen;
    return (
      <div
        data-testid="inbox-filter-bar"
        data-advanced-open={String(isAdvancedOpen ?? false)}
        onClick={onToggleAdvanced}
      />
    );
  },
}));

vi.mock('@/components/planner', () => ({
  VirtualizedInboxList: () => <div data-testid="inbox-list" />,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function seedUpp(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: INBOX_UI_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

function renderPanel() {
  return render(
    <PanelStateProvider activePageContext="inbox">
      <InboxListPanel />
    </PanelStateProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InboxListPanel — isAdvancedFiltersOpen persistence (P3-3)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    capturedIsAdvancedOpen = undefined;
    resetInboxListCache();
  });

  it('restores isAdvancedFiltersOpen=true on remount', async () => {
    seedUpp('isAdvancedFiltersOpen', true);

    const { unmount } = renderPanel();

    await waitFor(() => {
      expect(capturedIsAdvancedOpen).toBe(true);
    });

    unmount();

    seedUpp('isAdvancedFiltersOpen', true);
    renderPanel();

    await waitFor(() => {
      expect(capturedIsAdvancedOpen).toBe(true);
    });
  });

  it('restores isAdvancedFiltersOpen=false on remount (default closed)', async () => {
    // No seeding — default is false
    renderPanel();

    await waitFor(() => {
      expect(capturedIsAdvancedOpen).toBe(false);
    });
  });

  it('multi-cycle: isAdvancedFiltersOpen=true persists across two unmount/remount cycles', async () => {
    seedUpp('isAdvancedFiltersOpen', true);

    const { unmount: u1 } = renderPanel();
    await waitFor(() => expect(capturedIsAdvancedOpen).toBe(true));
    u1();

    seedUpp('isAdvancedFiltersOpen', true);
    const { unmount: u2 } = renderPanel();
    await waitFor(() => expect(capturedIsAdvancedOpen).toBe(true));
    u2();

    seedUpp('isAdvancedFiltersOpen', true);
    renderPanel();
    await waitFor(() => expect(capturedIsAdvancedOpen).toBe(true));
  });

  it('corrupted storage falls back to false without crash', async () => {
    const key = makeKey({ userId: TEST_USER_ID, profileId: INBOX_UI_PROFILE_ID, controlId: 'isAdvancedFiltersOpen' });
    sessionStorage.setItem(key, '{ bad json');

    expect(() => renderPanel()).not.toThrow();

    await waitFor(() => {
      expect(capturedIsAdvancedOpen).toBe(false);
    });
  });
});
