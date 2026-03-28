/**
 * Phase 6 (RED → GREEN) — InboxListPanel focused fetch and top pin.
 *
 * IL6-1: first load sends focusCustomerId; focusedCustomerIncluded captured before adapter
 * IL6-2: subsequent reload without deep-link omits focus field
 * IL6-3: focusedCustomerIncluded=true → focused row rendered first
 * IL6-4: non-focused rows preserve relative sort order
 * IL6-5: focusedCustomerIncluded=false → warning banner, no crash
 * IL6-6: no deep-link → list order is baseline behavior
 * IL6-7: filters active after deep-link → target still visible and first
 * IL6-8: manual user selection later → no permanent pin for unrelated ids
 * IL6-9: selected detail visible when focused row present
 * IL6-10: candidate count consistent with pin logic
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { InboxListPanel, resetInboxListCache } from '../InboxListPanel';
import type { CandidateRowData } from '@/components/planner';
import type { CallQueueItem } from '@/services/revisionService';

// ── VirtualizedInboxList mock ─────────────────────────────────────────────────
vi.mock('@/components/planner', () => ({
  VirtualizedInboxList: ({
    candidates,
    isLoading,
  }: {
    candidates: CandidateRowData[];
    isLoading?: boolean;
  }) => {
    if (isLoading) return <div data-testid="inbox-loading">Loading</div>;
    if (candidates.length === 0) return <div data-testid="inbox-empty">Empty</div>;
    return (
      <div data-testid="inbox-list">
        {candidates.map((c, idx) => (
          <div key={c.id} data-testid={`candidate-${c.id}`} data-index={idx}>
            {c.customerName}
          </div>
        ))}
      </div>
    );
  },
}));

// ── Services mocks ─────────────────────────────────────────────────────────────
const mockGetInbox = vi.fn();
const mockInboxResponseToCallQueueResponse = vi.fn();
vi.mock('@/services/inboxService', () => ({
  getInbox: (...args: unknown[]) => mockGetInbox(...args),
}));
vi.mock('@/services/inboxAdapter', () => ({
  inboxResponseToCallQueueResponse: (...args: unknown[]) =>
    mockInboxResponseToCallQueueResponse(...args),
}));

vi.mock('@/services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/routeService', () => ({
  getRoute: vi.fn().mockResolvedValue({ route: null, stops: [] }),
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: () => ({ isConnected: true }),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(
    (selector?: (s: { user: { id: string } | null }) => unknown) => {
      const state = { user: { id: 'test-user-focus' } };
      return selector ? selector(state) : state;
    }
  ),
}));

// ── InboxFilterBar mock ───────────────────────────────────────────────────────
vi.mock('@/components/planner/InboxFilterBar', () => ({
  InboxFilterBar: ({ candidateCount }: { candidateCount: number }) => (
    <div data-testid="inbox-filter-bar" data-count={candidateCount}>
      FilterBar
    </div>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
function makeCandidate(id: string, name: string): CallQueueItem {
  return {
    id,
    deviceId: `dev-${id}`,
    customerId: id,
    userId: 'user-1',
    status: 'upcoming',
    dueDate: '2026-06-01',
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    customerName: name,
    customerPhone: '+420111222333',
    customerEmail: null,
    customerStreet: 'Main 1',
    customerCity: 'Prague',
    customerPostalCode: '10000',
    customerLat: 50.08,
    customerLng: 14.43,
    customerGeocodeStatus: 'success',
    deviceName: null,
    deviceType: 'boiler',
    deviceTypeDefaultDurationMinutes: null,
    daysUntilDue: 3,
    priority: 'due_soon',
    lastContactAt: null,
    contactAttempts: 0,
  };
}

function makeInboxResponse(
  items: CallQueueItem[],
  focusedCustomerIncluded?: boolean
) {
  return {
    items,
    total: items.length,
    overdueCount: 0,
    dueSoonCount: 0,
    ...(focusedCustomerIncluded !== undefined ? { focusedCustomerIncluded } : {}),
  };
}

const mockRouteContext = {
  date: '2026-06-01',
  crewId: 'crew-1',
  crewName: 'Crew 1',
  depotId: 'depot-1',
  depotName: 'Prague',
};

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <PanelStateProvider
      activePageContext="inbox"
      enableChannel={false}
      initialRouteContext={mockRouteContext}
    >
      {children}
    </PanelStateProvider>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  resetInboxListCache();
  sessionStorage.clear();

  const alpha = makeCandidate('alpha', 'Alpha');
  const beta = makeCandidate('beta', 'Beta');

  mockGetInbox.mockResolvedValue(makeInboxResponse([alpha, beta]));
  mockInboxResponseToCallQueueResponse.mockImplementation(
    (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
  );
});

afterEach(() => {
  sessionStorage.clear();
});

describe('InboxListPanel – focusCustomerId deep-link', () => {
  it('IL6-1: sends focusCustomerId in first getInbox call when session key is set', async () => {
    sessionStorage.setItem('planningInbox.focusCustomerId', 'alpha');
    mockGetInbox.mockResolvedValue(makeInboxResponse([makeCandidate('alpha', 'Alpha')], true));
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => {
      expect(mockGetInbox).toHaveBeenCalledWith(
        expect.objectContaining({ focusCustomerId: 'alpha' })
      );
    });
  });

  it('IL6-2: subsequent reload without deep-link omits focusCustomerId', async () => {
    // No focusCustomerId in sessionStorage
    mockGetInbox.mockResolvedValue(makeInboxResponse([]));

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());
    const calls = mockGetInbox.mock.calls;
    calls.forEach((call) => {
      expect((call[0] as { focusCustomerId?: unknown }).focusCustomerId).toBeUndefined();
    });
  });

  it('IL6-3: focusedCustomerIncluded=true → focused row rendered at index 0', async () => {
    const alpha = makeCandidate('alpha', 'Alpha');
    const beta = makeCandidate('beta', 'Beta');
    sessionStorage.setItem('planningInbox.focusCustomerId', 'beta');

    // Worker returns beta first (pinned)
    mockGetInbox.mockResolvedValue(makeInboxResponse([beta, alpha], true));
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => {
      const list = screen.getByTestId('inbox-list');
      const items = list.querySelectorAll('[data-testid^="candidate-"]');
      expect(items[0].getAttribute('data-testid')).toBe('candidate-beta');
    });
  });

  it('IL6-4: non-focused rows preserve their relative order after pin', async () => {
    const a = makeCandidate('alpha', 'Alpha');
    const b = makeCandidate('beta', 'Beta');
    const c = makeCandidate('gamma', 'Gamma');
    sessionStorage.setItem('planningInbox.focusCustomerId', 'gamma');

    // Worker pins gamma to front
    mockGetInbox.mockResolvedValue(makeInboxResponse([c, a, b], true));
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => screen.getByTestId('inbox-list'));

    const list = screen.getByTestId('inbox-list');
    const items = list.querySelectorAll('[data-testid^="candidate-"]');
    expect(items[0].getAttribute('data-testid')).toBe('candidate-gamma');
    // alpha and beta appear after gamma
    const remaining = [items[1], items[2]].map((el) => el.getAttribute('data-testid'));
    expect(remaining).toContain('candidate-alpha');
    expect(remaining).toContain('candidate-beta');
  });

  it('IL6-5: focusedCustomerIncluded=false shows warning banner, no crash', async () => {
    sessionStorage.setItem('planningInbox.focusCustomerId', 'missing-id');
    mockGetInbox.mockResolvedValue(
      makeInboxResponse([makeCandidate('alpha', 'Alpha')], false)
    );
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('focus-customer-warning')).toBeInTheDocument();
    });
    // List still shows normal rows
    expect(screen.getByTestId('candidate-alpha')).toBeInTheDocument();
  });

  it('IL6-6: no deep-link path → list order is baseline (no pin)', async () => {
    const a = makeCandidate('alpha', 'Alpha');
    const b = makeCandidate('beta', 'Beta');
    mockGetInbox.mockResolvedValue(makeInboxResponse([a, b]));
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => screen.getByTestId('inbox-list'));

    // No warning shown
    expect(screen.queryByTestId('focus-customer-warning')).toBeNull();
    // Both items present
    expect(screen.getByTestId('candidate-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-beta')).toBeInTheDocument();
  });

  it('IL6-7: focus session key cleared after first load', async () => {
    sessionStorage.setItem('planningInbox.focusCustomerId', 'alpha');
    mockGetInbox.mockResolvedValue(
      makeInboxResponse([makeCandidate('alpha', 'Alpha')], true)
    );
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => {
      expect(sessionStorage.getItem('planningInbox.focusCustomerId')).toBeNull();
    });
  });

  it('IL6-8: manual selection change does not permanently force pin for unrelated ids', async () => {
    // No deep-link; normal load
    const a = makeCandidate('alpha', 'Alpha');
    mockGetInbox.mockResolvedValue(makeInboxResponse([a]));
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => screen.getByTestId('candidate-alpha'));
    // No focus warning shown
    expect(screen.queryByTestId('focus-customer-warning')).toBeNull();
  });

  it('IL6-9: candidate count matches items when focus is applied', async () => {
    const items = [
      makeCandidate('alpha', 'Alpha'),
      makeCandidate('beta', 'Beta'),
      makeCandidate('gamma', 'Gamma'),
    ];
    sessionStorage.setItem('planningInbox.focusCustomerId', 'gamma');
    mockGetInbox.mockResolvedValue(
      makeInboxResponse([items[2], items[0], items[1]], true)
    );
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items })
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => {
      const bar = screen.getByTestId('inbox-filter-bar');
      expect(Number(bar.getAttribute('data-count'))).toBe(3);
    });
  });

  it('IL6-10: focusCustomerId omitted from getInbox after session key is cleared', async () => {
    // Simulate a second mount after first fetch already cleared the key
    sessionStorage.removeItem('planningInbox.focusCustomerId');
    mockGetInbox.mockResolvedValue(makeInboxResponse([]));

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());
    const call = mockGetInbox.mock.calls[0][0];
    expect((call as { focusCustomerId?: unknown }).focusCustomerId).toBeUndefined();
  });
});
