import { useState } from 'react';
import { usePanelState } from '@/hooks/usePanelState';
import {
  RouteDetailTimeline,
  PlanningTimeline,
  TimelineViewToggle,
  RouteSummaryStats,
  RouteSummaryActions,
  ArrivalBufferBar,
  type TimelineView,
} from '@/components/planner';
import type { SavedRouteStop } from '@/services/routeService';

interface RouteTimelinePanelProps {
  onOptimize?: () => void;
}

export function RouteTimelinePanel({ onOptimize }: RouteTimelinePanelProps) {
  const { state, actions } = usePanelState();
  const {
    routeStops,
    metrics,
    routeWarnings,
    breakWarnings,
    highlightedSegment,
    routeBufferPercent,
    routeBufferFixedMinutes,
    routeContext,
    returnToDepotLeg,
    depotDeparture,
    selectedCustomerId,
  } = state;

  const [timelineView, setTimelineView] = useState<TimelineView>('compact');

  const depot = routeContext ? { name: routeContext.depotName, lat: 0, lng: 0 } : null;

  const routeStartTime = routeStops[0]?.estimatedArrival ?? null;
  const routeEndTime = routeStops[routeStops.length - 1]?.estimatedDeparture ?? null;

  const handleReorder = (newStops: SavedRouteStop[]) => {
    actions.setRouteStops(newStops);
  };

  const handleRemoveStop = (stopId: string) => {
    actions.setRouteStops(routeStops.filter((s) => s.id !== stopId));
  };

  const handleAddBreak = () => {
    // stub — full mutation logic migrated in step A.6
    actions.setRouteStops(routeStops);
  };

  const handleBufferChange = (percent: number, fixedMinutes: number) => {
    actions.setRouteBuffer(percent, fixedMinutes);
  };

  const stopCount = routeStops.filter((s) => s.stopType !== 'break').length;
  const sharedTimelineProps = {
    stops: routeStops,
    depot,
    selectedStopId: selectedCustomerId,
    onStopClick: (_: string, index: number) => actions.highlightSegment(index),
    onReorder: handleReorder,
    onRemoveStop: handleRemoveStop,
    warnings: routeWarnings,
    routeStartTime,
    routeEndTime,
    depotDeparture,
    returnToDepotDistanceKm: returnToDepotLeg?.distanceKm ?? null,
    returnToDepotDurationMinutes: returnToDepotLeg?.durationMinutes ?? null,
  };

  return (
    <div>
      {breakWarnings.length > 0 && (
        <div role="alert">
          {breakWarnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <TimelineViewToggle value={timelineView} onChange={setTimelineView} />
      </div>

      <RouteSummaryStats
        routeStartTime={routeStartTime}
        routeEndTime={routeEndTime}
        metrics={metrics}
        stopCount={stopCount}
      />

      <RouteSummaryActions
        onOptimize={onOptimize}
        onAddBreak={handleAddBreak}
        canOptimize={stopCount >= 2}
      />

      <ArrivalBufferBar
        percent={routeBufferPercent}
        fixedMinutes={routeBufferFixedMinutes}
        onChange={handleBufferChange}
      />

      {timelineView === 'planning' ? (
        <PlanningTimeline {...sharedTimelineProps} />
      ) : (
        <RouteDetailTimeline
          {...sharedTimelineProps}
          highlightedSegment={highlightedSegment}
          onSegmentClick={(idx) => actions.highlightSegment(idx)}
        />
      )}
    </div>
  );
}
