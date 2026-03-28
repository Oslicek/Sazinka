/**
 * BUG-13 — Deep-linked (focused) customer checkbox interaction.
 *
 * When a customer with failed geocode is pinned to index 0 via deep-link,
 * the checkbox must remain disabled (no geocode → can't route). But clicking
 * the disabled checkbox area should show a visible warning tooltip.
 *
 * B13-1: pinned customer with failed geocode keeps disableCheckbox=true
 * B13-2: pinned customer with valid geocode has disableCheckbox=false (normal)
 * B13-3: non-pinned customer with failed geocode still has disableCheckbox=true
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { PanelStateProvider } from '../../contexts/PanelStateContext';
import { InboxListPanel, resetInboxListCache } from '../InboxListPanel';
import type { CandidateRowData } from '@/components/planner';
import type { CallQueueItem } from '@/services/revisionService';

// ── i18n mock ──────────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// ── VirtualizedInboxList mock — exposes disableCheckbox ──────────────────────
vi.mock('@/components/planner', () => ({
  VirtualizedInboxList: ({
    candidates,
  }: {
    candidates: CandidateRowData[];
    isLoading?: boolean;
    selectable?: boolean;
    onSelectionChange?: (id: string, selected: boolean) => void;
  }) => {
    if (candidates.length === 0) return <div data-testid="inbox-empty">Empty</div>;
    return (
      <div data-testid="inbox-list">
        {candidates.map((c, idx) => (
          <div
            key={c.id}
            data-testid={`candidate-${c.id}`}
            data-index={idx}
            data-disable-checkbox={c.disableCheckbox ? 'true' : 'false'}
          >
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
      const state = { user: { id: 'test-user-bug13' } };
      return selector ? selector(state) : state;
    }
  ),
}));

vi.mock('@/components/planner/InboxFilterBar', () => ({
  InboxFilterBar: ({ candidateCount }: { candidateCount: number }) => (
    <div data-testid="inbox-filter-bar" data-count={candidateCount}>FilterBar</div>
  ),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCandidate(
  id: string,
  name: string,
  overrides?: Partial<CallQueueItem>,
): CallQueueItem {
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
    ...overrides,
  };
}

function makeInboxResponse(
  items: CallQueueItem[],
  focusedCustomerIncluded?: boolean,
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
});

afterEach(() => {
  sessionStorage.clear();
});

describe('BUG-13: focused customer checkbox', () => {
  it('B13-1: pinned customer with failed geocode keeps disableCheckbox=true', async () => {
    const noGeo = makeCandidate('no-geo', 'Alena Beneš', {
      customerGeocodeStatus: 'failed',
      customerLat: null,
      customerLng: null,
    });
    const normal = makeCandidate('normal', 'Marie Růžička');

    sessionStorage.setItem('planningInbox.focusCustomerId', 'no-geo');
    mockGetInbox.mockResolvedValue(makeInboxResponse([noGeo, normal], true));
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items }),
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => screen.getByTestId('inbox-list'));

    const pinnedRow = screen.getByTestId('candidate-no-geo');
    expect(pinnedRow.getAttribute('data-disable-checkbox')).toBe('true');
  });

  it('B13-2: pinned customer with valid geocode has disableCheckbox=false', async () => {
    const validGeo = makeCandidate('valid-geo', 'Valid Customer');
    const other = makeCandidate('other', 'Other');

    sessionStorage.setItem('planningInbox.focusCustomerId', 'valid-geo');
    mockGetInbox.mockResolvedValue(makeInboxResponse([validGeo, other], true));
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items }),
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => screen.getByTestId('inbox-list'));

    const row = screen.getByTestId('candidate-valid-geo');
    expect(row.getAttribute('data-disable-checkbox')).toBe('false');
  });

  it('B13-3: non-pinned customer with failed geocode has disableCheckbox=true', async () => {
    const normal = makeCandidate('normal', 'Normal');
    const noGeo = makeCandidate('no-geo-other', 'No Geo Other', {
      customerGeocodeStatus: 'failed',
      customerLat: null,
      customerLng: null,
    });

    mockGetInbox.mockResolvedValue(makeInboxResponse([normal, noGeo]));
    mockInboxResponseToCallQueueResponse.mockImplementation(
      (r: ReturnType<typeof makeInboxResponse>) => ({ items: r.items }),
    );

    render(<InboxListPanel />, { wrapper });

    await waitFor(() => screen.getByTestId('inbox-list'));

    const row = screen.getByTestId('candidate-no-geo-other');
    expect(row.getAttribute('data-disable-checkbox')).toBe('true');
  });
});
