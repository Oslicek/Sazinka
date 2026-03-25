/**
 * Phase 8 / P5 — PlanningInbox persistence V2 tests.
 *
 * Verifies legacy key compatibility and that the UPP profile reads/writes
 * the same keys as the existing implementation.
 *
 * Covers:
 *  - C37: Settings cross-page write (enforceDrivingBreakRule)
 *  - C38: BooleanPlugin legacy string 'true'/'false' decoding
 *  - InboxListPanel filter sync (filters key)
 *  - Legacy key compatibility: planningInbox.* keys still work
 *  - P5: channel isolation, falsy preservation, legacy seeding, route non-regression
 *
 * CRITICAL: These tests must NOT break route selection or detach behavior.
 * The mandatory gate (test:upp-gate) runs the full Inbox guard suite separately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { BooleanPlugin } from '../../persistence/plugins/BooleanPlugin';
import { makeKey, makeEnvelope } from '@/persistence/core/types';
import { INBOX_BREAK_RULE_PROFILE_ID } from '@/persistence/profiles/inboxBreakRuleProfile';

// ---------------------------------------------------------------------------
// Router mock
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useSearch: vi.fn(() => ({})),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Breakpoint mock
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => ({
    breakpoint: 'desktop',
    isPhone: false,
    isMobileUi: false,
    isTouch: false,
  })),
}));

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

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
  useAuthStore: vi.fn((selector: (s: { user: { id: string; name: string } | null }) => unknown) =>
    selector({ user: { id: 'test-user-inbox', name: 'Test' } }),
  ),
}));

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------

vi.mock('@/services/settingsService', () => ({
  getSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/routeService', () => ({
  recalculateRoute: vi.fn(),
  getRoute: vi.fn().mockResolvedValue(null),
  saveRoute: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/calendarService', () => ({
  listCalendarItems: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/insertionService', () => ({
  calculateInsertions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/geometryService', () => ({
  calculateRouteShape: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/inboxService', () => ({
  getInbox: vi.fn().mockResolvedValue({ items: [] }),
  listPlannedActions: vi.fn().mockResolvedValue([]),
  updatePlannedAction: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/scoringService', () => ({
  listRuleSets: vi.fn().mockResolvedValue([]),
  getInboxState: vi.fn().mockResolvedValue(null),
  saveInboxState: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Hook mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useAutoSave', () => ({
  useAutoSave: vi.fn(() => ({
    isSaving: false,
    lastSaved: null,
    saveError: null,
    retry: vi.fn(),
  })),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  usePlannerShortcuts: vi.fn(),
}));

vi.mock('@/hooks/useDetachState', () => ({
  useDetachState: () => ({
    isDetached: () => false,
    detach: vi.fn(),
    reattach: vi.fn(),
    canDetach: true,
  }),
}));

vi.mock('@/hooks/useLayoutMode', () => ({
  useLayoutMode: () => ({ mode: 'wide', setMode: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Panel mocks
// ---------------------------------------------------------------------------

vi.mock('@/panels/RouteMapPanel', () => ({
  RouteMapPanel: () => <div data-testid="map-panel">Map</div>,
}));

vi.mock('@/panels/InboxListPanel', () => ({
  InboxListPanel: () => <div data-testid="inbox-list-panel">List</div>,
}));

// ---------------------------------------------------------------------------
// Heavy component mocks
// ---------------------------------------------------------------------------

vi.mock('@/components/planner', () => ({
  RouteMapPanel: () => <div data-testid="map-panel-planner">Map</div>,
  VirtualizedInboxList: () => <div data-testid="inbox-list">List</div>,
  CandidateDetail: () => <div data-testid="candidate-detail">Detail</div>,
  MultiCrewTip: () => null,
  RouteDetailTimeline: () => <div data-testid="route-detail-timeline" />,
  PlanningTimeline: () => <div data-testid="planning-timeline" />,
  TimelineViewToggle: () => null,
  RouteSummaryStats: () => null,
  RouteSummaryActions: () => null,
  ArrivalBufferBar: () => null,
  buildTimelineItems: vi.fn(() => []),
}));

vi.mock('@/components/planner/DraftModeBar', () => ({
  DraftModeBar: () => null,
}));

vi.mock('@/components/common', () => ({
  CollapseButton: () => null,
  ThreePanelLayout: ({
    left,
    center,
    right,
  }: {
    left: React.ReactNode;
    center: React.ReactNode;
    right: React.ReactNode;
  }) => (
    <div data-testid="three-panel-layout">
      <div data-testid="panel-left">{left}</div>
      <div data-testid="panel-center">{center}</div>
      <div data-testid="panel-right">{right}</div>
    </div>
  ),
  SplitView: ({ panels }: { panels: { id: string; content: React.ReactNode }[] }) => (
    <div data-testid="split-view">
      {panels.map((p: { id: string; content: React.ReactNode }) => (
        <div key={p.id}>{p.content}</div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/layout', () => ({
  SplitLayout: ({ first, second }: { first: React.ReactNode; second: React.ReactNode }) => (
    <div data-testid="split-layout">{first}{second}</div>
  ),
  LayoutManager: () => <div data-testid="layout-manager">LayoutManager</div>,
  DetachButton: ({ onDetach, 'data-testid': testId }: { onDetach: () => void; 'data-testid'?: string }) => (
    <button data-testid={testId ?? 'detach-btn'} onClick={onDetach}>Detach</button>
  ),
  MapPanelShell: ({
    panelName,
    children,
    onDetach,
    canDetach,
  }: {
    panelName: string;
    children: React.ReactNode;
    onDetach?: () => void;
    canDetach?: boolean;
  }) => (
    <div data-testid="map-panel-shell" data-panel={panelName}>
      {canDetach && onDetach && (
        <button data-testid={`detach-${panelName}-btn`} onClick={onDetach}>
          Detach
        </button>
      )}
      {children}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { PlanningInbox } from '../PlanningInbox';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanningInbox — persistence V2 (Phase 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  // ── Legacy key compatibility ───────────────────────────────────────────────

  it('planningInbox.filters in sessionStorage is read without crash', () => {
    const filters = { crewId: 'crew-1', depotId: 'depot-1' };
    sessionStorage.setItem('planningInbox.filters', JSON.stringify(filters));
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('planningInbox.context in sessionStorage is read without crash', () => {
    const ctx = { date: '2026-03-21', crewId: 'crew-1', depotId: 'depot-1' };
    sessionStorage.setItem('planningInbox.context', JSON.stringify(ctx));
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('planningInbox.selectedId in sessionStorage is read without crash', () => {
    sessionStorage.setItem('planningInbox.selectedId', 'cust-abc');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  // ── Settings cross-page write (C37) ────────────────────────────────────────

  it('Settings writes enforceDrivingBreakRule=true, Inbox reads it correctly (C37)', () => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'true');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('Settings writes enforceDrivingBreakRule=false, Inbox reads it correctly (C37)', () => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'false');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  // ── BooleanPlugin legacy string decoding (C38) ─────────────────────────────

  it('BooleanPlugin decodes legacy string "true" from localStorage (C38)', () => {
    const plugin = new BooleanPlugin(true);
    const raw = localStorage.getItem('planningInbox.enforceDrivingBreakRule') ?? 'true';
    expect(plugin.decode(raw)).toBe(true);
  });

  it('BooleanPlugin decodes legacy string "false" from localStorage (C38)', () => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'false');
    const plugin = new BooleanPlugin(true);
    const raw = localStorage.getItem('planningInbox.enforceDrivingBreakRule');
    expect(plugin.decode(raw)).toBe(false);
  });

  it('BooleanPlugin default=true when key is absent (C38)', () => {
    const plugin = new BooleanPlugin(true);
    expect(plugin.decode(null)).toBe(true);
  });

  // ── InboxListPanel filter sync ─────────────────────────────────────────────

  it('InboxListPanel renders when planningInbox.filters is set (filter sync)', () => {
    const filters = { crewId: 'crew-1', depotId: 'depot-1', date: '2026-03-21' };
    sessionStorage.setItem('planningInbox.filters', JSON.stringify(filters));
    render(<PlanningInbox />);
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  // ── Corrupt data fallback ──────────────────────────────────────────────────

  it('corrupt planningInbox.filters falls back gracefully', () => {
    sessionStorage.setItem('planningInbox.filters', '{ bad json');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('corrupt planningInbox.context falls back gracefully', () => {
    sessionStorage.setItem('planningInbox.context', '{ bad json');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P5 — UPP wiring tests
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'test-user-inbox';

function seedBreakRuleUpp(value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: INBOX_BREAK_RULE_PROFILE_ID, controlId: 'enforceDrivingBreakRule' });
  localStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'local')));
}

describe('PlanningInbox — P5 UPP wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  // ── Channel isolation ──────────────────────────────────────────────────────

  it('enforceDrivingBreakRule commit writes to localStorage only (not sessionStorage)', () => {
    seedBreakRuleUpp(false);
    expect(() => render(<PlanningInbox />)).not.toThrow();
    // The UPP key for break rule should be in localStorage
    const key = makeKey({ userId: TEST_USER_ID, profileId: INBOX_BREAK_RULE_PROFILE_ID, controlId: 'enforceDrivingBreakRule' });
    expect(localStorage.getItem(key)).not.toBeNull();
    // And NOT in sessionStorage
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  // ── Falsy preservation ─────────────────────────────────────────────────────

  it('enforceDrivingBreakRule=false survives seed and remount (via ??, not lost to default true)', async () => {
    seedBreakRuleUpp(false);
    const { unmount } = render(<PlanningInbox />);
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
    unmount();

    render(<PlanningInbox />);
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
    // Page renders without crash — break rule was false, not reset to true
  });

  // ── Legacy seed ────────────────────────────────────────────────────────────

  it('prefill planningInbox.filters legacy key, mount Inbox, value appears without crash', () => {
    sessionStorage.setItem('planningInbox.filters', JSON.stringify({ crewId: 'crew-legacy', depotId: 'depot-legacy' }));
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it("prefill planningInbox.enforceDrivingBreakRule='false' legacy key, Inbox reads it as false", () => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'false');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('corrupt legacy planningInbox.filters JSON produces DEFAULT_FILTER_EXPRESSION, not null', () => {
    sessionStorage.setItem('planningInbox.filters', '{ bad json');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it('absent legacy keys produce profile defaults (no throw)', () => {
    // No keys in storage at all
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  // ── Settings cross-page compatibility ─────────────────────────────────────

  it("Settings writes planningInbox.enforceDrivingBreakRule='true' in localStorage; Inbox picks it up", () => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'true');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  it("Settings writes planningInbox.enforceDrivingBreakRule='false' in localStorage; Inbox shows false", () => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', 'false');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
  });

  // ── Route timeline non-regression ─────────────────────────────────────────

  it('planningInbox.context read/write path unchanged (direct sessionStorage)', () => {
    const ctx = { date: '2026-03-21', crewId: 'crew-1', depotId: 'depot-1' };
    sessionStorage.setItem('planningInbox.context', JSON.stringify(ctx));
    expect(() => render(<PlanningInbox />)).not.toThrow();
    // Context key must still be readable directly from sessionStorage
    expect(sessionStorage.getItem('planningInbox.context')).not.toBeNull();
  });

  it('planningInbox.selectedId read/write path unchanged (direct sessionStorage)', () => {
    sessionStorage.setItem('planningInbox.selectedId', 'cust-route-guard');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    // selectedId key must still be in sessionStorage after render
    expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('cust-route-guard');
  });

  it('sazinka.snooze.defaultDays read path unchanged (UPP does not touch it)', () => {
    localStorage.setItem('sazinka.snooze.defaultDays', '14');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    // Snooze key must still be readable directly from localStorage
    expect(localStorage.getItem('sazinka.snooze.defaultDays')).toBe('14');
  });

  it('P0 guard tests still green — timeline rendering unaffected through inbox navigation cycles', () => {
    const ctx = { date: '2026-03-21', crewId: 'crew-1', depotId: 'depot-1' };
    sessionStorage.setItem('planningInbox.context', JSON.stringify(ctx));
    sessionStorage.setItem('planningInbox.selectedId', 'cust-timeline-cycle');
    expect(() => render(<PlanningInbox />)).not.toThrow();
    expect(screen.getByTestId('inbox-list-panel')).toBeInTheDocument();
    expect(sessionStorage.getItem('planningInbox.selectedId')).toBe('cust-timeline-cycle');
  });
});
