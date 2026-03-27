import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RouteDetailTimeline } from './RouteDetailTimeline';
import type { SavedRouteStop } from '../../services/routeService';
import { makeVisitFixture } from '@/test-utils/visitFixtures';
import type { Visit } from '@shared/visit';

function makeStop(overrides: Partial<SavedRouteStop> = {}): SavedRouteStop {
  return {
    id: 's1',
    routeId: 'r1',
    revisionId: 'rev1',
    stopOrder: 1,
    estimatedArrival: '09:00:00',
    estimatedDeparture: '09:45:00',
    distanceFromPreviousKm: 12.5,
    durationFromPreviousMinutes: 18,
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
    ...overrides,
  };
}

const mockStops: SavedRouteStop[] = [
  makeStop({ id: 's1', customerId: 'cust1', customerName: 'Karel Suchý', address: 'Lesní 123, Brno' }),
  makeStop({
    id: 's2',
    stopOrder: 2,
    estimatedArrival: '10:00:00',
    estimatedDeparture: '10:30:00',
    distanceFromPreviousKm: 8.3,
    durationFromPreviousMinutes: 12,
    status: 'scheduled',
    customerId: 'cust2',
    customerName: 'Marie Dvořáková',
    address: 'Hlavní 45, Brno',
    customerLat: 49.21,
    customerLng: 16.61,
    scheduledDate: null,
    scheduledTimeStart: null,
    scheduledTimeEnd: null,
    revisionStatus: 'upcoming',
  }),
];

function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return makeVisitFixture({ customerId: 'cust1', scheduledDate: '2026-03-15', ...overrides });
}

const mockDepot = { name: 'Brno-střed', lat: 49.19, lng: 16.59 };

describe('RouteDetailTimeline', () => {
  it('should render depot at start and end', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    const depotElements = screen.getAllByText(/brno-střed/i);
    expect(depotElements.length).toBeGreaterThanOrEqual(2);
  });

  it('should render all stops with customer names', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/karel suchý/i)).toBeInTheDocument();
    expect(screen.getByText(/marie dvořáková/i)).toBeInTheDocument();
  });

  it('should render time windows for stops', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    // Dohodnuto: 09:00–09:45 or Vypočítáno - formatTime gives HH:MM (appears in segment + stop)
    expect(screen.getAllByText(/09:00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/09:45/).length).toBeGreaterThanOrEqual(1);
  });

  it('should show confirmation badges for stops', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    // First stop: revisionStatus 'confirmed' -> "Potvrzeno"; Second: 'upcoming' -> "Nepotvrzeno"
    expect(screen.getByText('timeline_status_confirmed')).toBeInTheDocument();
    expect(screen.getByText('timeline_status_pending')).toBeInTheDocument();
  });

  it('should render segments with distance and duration', () => {
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/12\.5 km/i)).toBeInTheDocument();
    // formatDurationHm outputs "0h 18min" for 18 minutes
    expect(screen.getByText(/18.*min/i)).toBeInTheDocument();
    expect(screen.getByText(/8\.3 km/i)).toBeInTheDocument();
  });

  it('should call onStopClick when stop card is clicked', () => {
    const onStopClick = vi.fn();
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={onStopClick}
        onSegmentClick={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/karel suchý/i));
    expect(onStopClick).toHaveBeenCalledWith('cust1', 0);
  });

  it('should call onSegmentClick when segment is clicked', () => {
    const onSegmentClick = vi.fn();
    render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={onSegmentClick}
      />
    );
    // Click on the first segment (depot -> stop 1)
    fireEvent.click(screen.getByText(/12\.5 km/i));
    expect(onSegmentClick).toHaveBeenCalledWith(0);
  });

  it('should highlight selected stop', () => {
    const { container } = render(
      <RouteDetailTimeline
        stops={mockStops}
        depot={mockDepot}
        selectedStopId="cust1"
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    const selected = container.querySelector('[data-selected="true"]');
    expect(selected).toBeInTheDocument();
  });

  it('should render empty state when no stops', () => {
    render(
      <RouteDetailTimeline
        stops={[]}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />
    );
    expect(screen.getByText(/timeline_empty/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// A.4 Last visit comment in compact timeline (RouteDetailTimeline)
// Per §3.2a: parent passes lastVisitComment prop to the selected card.
// ---------------------------------------------------------------------------
describe('RouteDetailTimeline — last visit comment', () => {
  const stop = makeStop({ id: 's1', customerId: 'cust1', customerName: 'Karel Suchý' });
  const visit = makeVisit({ scheduledDate: '2026-03-15' });

  function renderTimeline(
    selectedStopId: string | null,
    lastVisitComment?: { notes: string | null; visit: Visit | null },
  ) {
    return render(
      <RouteDetailTimeline
        stops={[stop]}
        depot={mockDepot}
        selectedStopId={selectedStopId}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
        lastVisitComment={lastVisitComment}
      />,
    );
  }

  // A.4.1 Selected stop shows comment text
  it('shows comment text on selected stop', () => {
    renderTimeline('cust1', { notes: 'Kotel vyměněn', visit });
    expect(screen.getByText('Kotel vyměněn')).toBeInTheDocument();
  });

  // A.4.2 Selected stop shows visit date alongside comment
  it('shows visit date alongside comment on selected stop', () => {
    renderTimeline('cust1', { notes: 'Kotel vyměněn', visit });
    const commentBlock = document.querySelector('[data-testid="stop-comment"]');
    expect(commentBlock).toBeInTheDocument();
    expect(commentBlock!.textContent).toMatch(/2026|15\. 3\.|15\.03\.|3\/15/);
  });

  // A.4.3 Non-selected stop does NOT show comment
  it('hides comment when stop is not selected', () => {
    renderTimeline(null, { notes: 'Kotel vyměněn', visit });
    expect(screen.queryByText('Kotel vyměněn')).not.toBeInTheDocument();
  });

  // A.4.5 (compact has no expand; just test null comment = hidden block)
  it('hides comment block when comment notes are null', () => {
    renderTimeline('cust1', { notes: null, visit: null });
    expect(screen.queryByText(/Kotel/)).not.toBeInTheDocument();
  });

  // A.4.7 Break card never shows comment even if prop is passed
  it('never shows comment on a break stop', () => {
    const breakStop = makeStop({
      id: 'b1',
      stopType: 'break',
      customerId: null,
      customerName: null,
    });
    render(
      <RouteDetailTimeline
        stops={[breakStop]}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
        lastVisitComment={{ notes: 'Should not appear', visit }}
      />,
    );
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });

  // A.4.8 Stop with customerId=null -> no comment rendered
  it('renders no comment when stop has no customerId', () => {
    const noIdStop = makeStop({ id: 's-null', customerId: null, customerName: 'Unknown' });
    render(
      <RouteDetailTimeline
        stops={[noIdStop]}
        depot={mockDepot}
        selectedStopId={null}
        highlightedSegment={null}
        onStopClick={() => {}}
        onSegmentClick={() => {}}
      />,
    );
    expect(screen.queryByText('Kotel vyměněn')).not.toBeInTheDocument();
  });

  // A.4.9 API failure -> { notes: null, visit: null } -> hidden block, no crash
  it('renders without crashing when lastVisitComment has null notes and null visit', () => {
    expect(() => renderTimeline('cust1', { notes: null, visit: null })).not.toThrow();
    expect(screen.queryByText(/note/i)).not.toBeInTheDocument();
  });

  // A.4.10 Long text: CSS clamp class applied
  it('applies line-clamp CSS class to long comment text', () => {
    const longNote = 'Very long note. '.repeat(50);
    const { container } = renderTimeline('cust1', { notes: longNote, visit });
    const noteEl = container.querySelector('[class*="stopCommentText"]') ??
      screen.queryByText(longNote);
    expect(noteEl).toBeInTheDocument();
    // title attribute provides full text for accessibility
    expect(noteEl?.getAttribute('title')).toBe(longNote);
  });

  // A.4.11 Follow-up badge/icon shown when requiresFollowUp is true
  it('shows follow-up badge when visit.requiresFollowUp is true', () => {
    const followUpVisit = makeVisit({ requiresFollowUp: true, followUpReason: 'Nutná oprava' });
    renderTimeline('cust1', { notes: 'Poznámka', visit: followUpVisit });
    // Some indicator of follow-up should be visible (icon or text)
    expect(
      screen.getByText('Nutná oprava') ||
      screen.getByTitle(/follow.*up|⚠/i) ||
      document.querySelector('[class*="followUp"]'),
    ).toBeTruthy();
  });
});
