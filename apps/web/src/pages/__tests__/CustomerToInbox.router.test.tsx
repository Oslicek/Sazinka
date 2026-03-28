/**
 * Phase 7 (RED → GREEN) — Mandatory router integration tests.
 *
 * RI7-1: Click from CustomerHeader → router navigates to /inbox?customerId=<id>
 * RI7-2: Click from CustomerPreviewPanel → router location contains same query
 * RI7-3: Landing on /inbox?customerId=<id> → PlanningInbox consumes and cleans URL
 * RI7-4: Full mocked flow → focusCustomerId stored for InboxListPanel, session keys set
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { Customer, CustomerListItem } from '@shared/customer';

// ── Router mock ───────────────────────────────────────────────────────────────
const { mockNavigate, mockUseSearch } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseSearch: vi.fn(() => ({})),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => mockNavigate),
  useSearch: mockUseSearch,
  // Link mock: renders anchor with correct href AND fires navigate on click
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
    [key: string]: unknown;
  }) => {
    const qs = search ? new URLSearchParams(search).toString() : '';
    const href = qs ? `${to}?${qs}` : to;
    return (
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          mockNavigate({ to, search, replace: false });
        }}
      >
        {children}
      </a>
    );
  },
}));

// ── i18n mock ─────────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────
const baseCustomer: Customer = {
  id: 'ri7-customer',
  userId: 'user-1',
  type: 'person',
  name: 'RI7 Test Customer',
  street: 'Router 7',
  city: 'Integration',
  postalCode: '00007',
  country: 'CZ',
  geocodeStatus: 'success',
  lat: 50.0,
  lng: 14.0,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const baseListItem: CustomerListItem = {
  id: 'ri7-customer',
  userId: 'user-1',
  type: 'person',
  name: 'RI7 Test Customer',
  street: 'Router 7',
  city: 'Integration',
  postalCode: '00007',
  lat: 50.0,
  lng: 14.0,
  geocodeStatus: 'success',
  createdAt: '2024-01-01T00:00:00Z',
  deviceCount: 1,
  nextRevisionDate: null,
  overdueCount: 0,
  neverServicedCount: 0,
};

// ── PlanningInbox mocks (heavy page) ─────────────────────────────────────────
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn(() => ({ isConnected: false })),
}));
vi.mock('@/stores/routeCacheStore', () => ({
  useRouteCacheStore: vi.fn(() => ({
    setRouteContext: vi.fn(),
    getCachedInsertion: vi.fn(),
    setCachedInsertions: vi.fn(),
    incrementRouteVersion: vi.fn(),
    invalidateCache: vi.fn(),
  })),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn((selector: (s: { user: { name: string } | null }) => unknown) =>
    selector({ user: { name: 'Test' } }),
  ),
}));
vi.mock('@/services/settingsService', () => ({ getSettings: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/crewService', () => ({ listCrews: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/routeService', () => ({
  recalculateRoute: vi.fn(),
  getRoute: vi.fn().mockResolvedValue(null),
  saveRoute: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/services/calendarService', () => ({ listCalendarItems: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/insertionService', () => ({ calculateInsertions: vi.fn().mockResolvedValue([]) }));
vi.mock('@/services/geometryService', () => ({ calculateRouteShape: vi.fn().mockResolvedValue(null) }));
vi.mock('@/services/inboxService', () => ({
  getInbox: vi.fn().mockResolvedValue({ items: [], total: 0, overdueCount: 0, dueSoonCount: 0 }),
  listPlannedActions: vi.fn().mockResolvedValue([]),
  updatePlannedAction: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/hooks/useAutoSave', () => ({
  useAutoSave: vi.fn(() => ({ isSaving: false, lastSaved: null, saveError: null, retry: vi.fn() })),
}));
vi.mock('@/hooks/useKeyboardShortcuts', () => ({ usePlannerShortcuts: vi.fn() }));
vi.mock('@/hooks/useDetachState', () => ({
  useDetachState: () => ({ isDetached: () => false, detach: vi.fn(), reattach: vi.fn(), canDetach: true }),
}));
vi.mock('@/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ mode: 'wide', setMode: vi.fn() }),
}));
vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => ({ isMobileUi: false, isTabletUi: false, isDesktopUi: true, isTouch: false })),
}));
vi.mock('@/hooks/useLastVisitComment', () => ({
  useLastVisitComment: vi.fn(() => ({ notes: null, visit: null })),
}));
vi.mock('@/panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="map-panel" />,
}));
vi.mock('@/panels/InboxListPanel', () => ({
  InboxListPanel: () => <div data-testid="inbox-list-panel" />,
}));
vi.mock('@/components/planner', () => ({
  RouteMapPanel: () => <div />,
  VirtualizedInboxList: () => <div />,
  CandidateDetail: () => <div />,
  MultiCrewTip: () => null,
  RouteDetailTimeline: () => <div />,
  PlanningTimeline: () => <div />,
  TimelineViewToggle: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
  buildTimelineItems: vi.fn(() => []),
}));
vi.mock('@/components/planner/DraftModeBar', () => ({ DraftModeBar: () => null }));
vi.mock('@/components/common', () => ({
  CollapseButton: () => null,
  ThreePanelLayout: ({ left, center, right }: { left: React.ReactNode; center: React.ReactNode; right: React.ReactNode }) => (
    <div><div data-testid="panel-left">{left}</div><div>{center}</div><div>{right}</div></div>
  ),
  SplitView: ({ panels }: { panels: { id: string; content: React.ReactNode }[] }) => (
    <div>{panels.map((p: { id: string; content: React.ReactNode }) => <div key={p.id}>{p.content}</div>)}</div>
  ),
}));
vi.mock('@/components/layout', () => ({
  SplitLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LayoutManager: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DetachButton: () => null,
  MapPanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/services/revisionService', () => ({ unscheduleRevision: vi.fn() }));
vi.mock('@/services/customerService', () => ({ updateCustomer: vi.fn() }));

// ── CustomerPreviewPanel mocks ────────────────────────────────────────────────
vi.mock('@/components/customers/AddressMap', () => ({
  AddressMap: () => <div data-testid="address-map" />,
}));
vi.mock('@/components/customers/AddressStatusChip', () => ({
  AddressStatusChip: () => <span />,
}));
vi.mock('@/components/devices', () => ({ DeviceList: () => <div /> }));
vi.mock('@/components/timeline', () => ({ CustomerTimeline: () => <div /> }));
vi.mock('@/i18n/formatters', () => ({ formatDate: (d: string) => d }));

// ── SUT imports ───────────────────────────────────────────────────────────────
import { CustomerHeader } from '@/components/customers/CustomerHeader';
import { CustomerPreviewPanel } from '@/components/customers/CustomerPreviewPanel';
import { PlanningInbox } from '../PlanningInbox';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CustomerToInbox router integration (Phase 7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockUseSearch.mockReturnValue({});
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('RI7-1: clicking CustomerHeader "Show in Inbox" calls navigate with /inbox and customerId', () => {
    render(<CustomerHeader customer={baseCustomer} onEdit={vi.fn()} onAddToPlan={vi.fn()} />);

    const link = screen.getByRole('link', { name: /action_show_in_inbox/i });
    // Verify href contains correct query param
    expect(link.getAttribute('href')).toContain('/inbox');
    expect(link.getAttribute('href')).toContain('customerId=ri7-customer');

    // Click triggers router navigation
    fireEvent.click(link);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/inbox',
        search: expect.objectContaining({ customerId: 'ri7-customer' }),
      })
    );
  });

  it('RI7-2: clicking CustomerPreviewPanel "Show in Inbox" calls navigate with customerId query', () => {
    render(
      <CustomerPreviewPanel
        customer={baseListItem}
        fullCustomer={null}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    );

    const link = screen.getByRole('link', { name: /action_show_in_inbox/i });
    expect(link.getAttribute('href')).toContain('customerId=ri7-customer');

    fireEvent.click(link);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/inbox',
        search: expect.objectContaining({ customerId: 'ri7-customer' }),
      })
    );
  });

  it('RI7-3: PlanningInbox landing on /inbox?customerId=<id> cleans URL with replace:true', async () => {
    mockUseSearch.mockReturnValue({ customerId: 'ri7-customer' });

    render(<PlanningInbox />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ replace: true })
      );
    });
    // cleaned search has no customerId
    const cleanupCall = mockNavigate.mock.calls.find((c) => c[0]?.replace === true);
    expect(cleanupCall![0].search?.customerId).toBeUndefined();
  });

  it('RI7-4: full mocked flow — session keys set for selection and focus handoff', async () => {
    mockUseSearch.mockReturnValue({ customerId: 'ri7-customer' });

    render(<PlanningInbox />);

    await waitFor(() => {
      expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('ri7-customer');
    });
    expect(sessionStorage.getItem('planningInbox.focusCustomerId')).toBe('ri7-customer');
  });
});
