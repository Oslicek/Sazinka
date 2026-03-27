/**
 * A.4 — PlanningTimeline: last visit comment for expanded stops.
 *
 * Per §3.2a: the parent calls useLastVisitComment for the expanded stop
 * and passes { notes, visit } as a prop down to the timeline.
 * Card components are pure/testable without NATS mocking.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanningTimeline } from './PlanningTimeline';
import type { SavedRouteStop } from '../../services/routeService';
import type { Visit } from '@shared/visit';

// dnd-kit requires PointerEvent
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn(() => []),
    useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false })),
  };
});

vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/sortable')>();
  return {
    ...actual,
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useSortable: vi.fn(() => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: null,
      isDragging: false,
    })),
  };
});

import React from 'react';

function makeStop(overrides: Partial<SavedRouteStop> = {}): SavedRouteStop {
  return {
    id: 's1',
    routeId: 'r1',
    revisionId: 'rev1',
    stopOrder: 1,
    estimatedArrival: '09:00:00',
    estimatedDeparture: '09:45:00',
    distanceFromPreviousKm: 5,
    durationFromPreviousMinutes: 10,
    status: 'confirmed',
    stopType: 'customer',
    customerId: 'cust1',
    customerName: 'Karel Suchý',
    address: 'Lesní 123, Brno',
    customerLat: 49.2,
    customerLng: 16.6,
    customerPhone: null,
    customerEmail: null,
    scheduledDate: '2026-01-25',
    scheduledTimeStart: '09:00:00',
    scheduledTimeEnd: '09:45:00',
    revisionStatus: 'confirmed',
    serviceDurationMinutes: 45,
    ...overrides,
  };
}

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: 'v-1',
    userId: 'u-1',
    customerId: 'cust1',
    scheduledDate: '2026-03-15',
    status: 'completed',
    visitType: 'revision',
    requiresFollowUp: false,
    createdAt: '2026-03-15T08:00:00Z',
    updatedAt: '2026-03-15T10:00:00Z',
    ...overrides,
  };
}

const depot = { name: 'Brno-střed', lat: 49.19, lng: 16.59 };

function renderTimeline(
  stops: SavedRouteStop[],
  selectedStopId: string | null,
  lastVisitComment?: { notes: string | null; visit: Visit | null },
) {
  return render(
    <PlanningTimeline
      stops={stops}
      depot={depot}
      onStopClick={() => {}}
      selectedStopId={selectedStopId}
      lastVisitComment={lastVisitComment}
    />,
  );
}

describe('PlanningTimeline — last visit comment', () => {
  const stop = makeStop();
  const visit = makeVisit();

  // A.4.4 Expanded stop shows comment text
  it('shows comment text when stop is expanded', () => {
    renderTimeline([stop], 'cust1', { notes: 'Kotel vyměněn', visit });

    // Click to expand
    fireEvent.click(screen.getByText('Karel Suchý'));

    expect(screen.getByText('Kotel vyměněn')).toBeInTheDocument();
  });

  // A.4.5 Expanded stop shows visit date alongside comment
  it('shows visit date alongside comment when stop is expanded', () => {
    renderTimeline([stop], 'cust1', { notes: 'Kotel vyměněn', visit });

    fireEvent.click(screen.getByText('Karel Suchý'));

    const commentBlock = document.querySelector('[data-testid="stop-comment"]');
    expect(commentBlock).toBeInTheDocument();
    expect(commentBlock!.textContent).toMatch(/2026|15\. 3\.|15\.03\.|3\/15/);
  });

  // A.4.6 Collapsed stop hides comment
  it('hides comment when stop is not expanded', () => {
    renderTimeline([stop], null, { notes: 'Kotel vyměněn', visit });
    // Stop not expanded by default, comment should not be visible
    expect(screen.queryByText('Kotel vyměněn')).not.toBeInTheDocument();
  });

  // A.4.7 Break card never shows comment
  it('never shows comment on a break stop', () => {
    const breakStop = makeStop({
      id: 'b1',
      stopType: 'break',
      customerId: null,
      customerName: null,
      serviceDurationMinutes: 30,
      breakDurationMinutes: 30,
    });
    renderTimeline([breakStop], null, { notes: 'Should not appear', visit });
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });

  // A.4.8 Stop with customerId=null -> parent passes no comment (no fetch triggered)
  it('renders without comment when stop has no customerId', () => {
    const noIdStop = makeStop({ id: 's-null', customerId: null });
    renderTimeline([noIdStop], null, undefined);
    expect(screen.queryByText('Kotel vyměněn')).not.toBeInTheDocument();
  });

  // A.4.9 API failure -> notes null -> hidden, no crash
  it('renders without crashing when lastVisitComment has null notes', () => {
    expect(() =>
      renderTimeline([stop], 'cust1', { notes: null, visit: null }),
    ).not.toThrow();
  });

  // A.4.10 Long text: title attribute provides full text
  it('applies line-clamp and full text accessible via title on expanded stop', () => {
    const longNote = 'Very long note. '.repeat(50);
    renderTimeline([stop], 'cust1', { notes: longNote, visit });

    fireEvent.click(screen.getByText('Karel Suchý'));

    const noteEl = document.querySelector('[class*="stopCommentText"]') ??
      screen.queryByText(longNote);
    expect(noteEl).toBeInTheDocument();
    expect(noteEl?.getAttribute('title')).toBe(longNote);
  });

  // A.4.11 Follow-up badge shown when requiresFollowUp is true
  it('shows follow-up badge when visit.requiresFollowUp is true', () => {
    const followUpVisit = makeVisit({ requiresFollowUp: true, followUpReason: 'Nutná oprava' });
    renderTimeline([stop], 'cust1', { notes: 'Poznámka', visit: followUpVisit });

    fireEvent.click(screen.getByText('Karel Suchý'));

    expect(
      screen.queryByText('Nutná oprava') ??
      document.querySelector('[class*="followUp"], [class*="stopCommentFollowUp"]'),
    ).toBeTruthy();
  });
});
