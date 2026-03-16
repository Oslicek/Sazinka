import { usePanelState } from '@/hooks/usePanelState';
import { RouteMapPanel as RouteMapPanelUI } from '@/components/planner/RouteMapPanel';

/**
 * Smart panel wrapper for the RouteMapPanel UI component.
 * Reads all map-relevant state from PanelStateContext and wires
 * up segment-highlight and stop-selection actions.
 */
export function RouteMapPanel() {
  const { state, actions } = usePanelState();
  const {
    routeStops,
    routeGeometry,
    highlightedSegment,
    insertionPreview,
    selectedCustomerId,
  } = state;

  return (
    <RouteMapPanelUI
      stops={routeStops}
      depot={null}
      routeGeometry={routeGeometry}
      highlightedSegment={highlightedSegment}
      insertionPreview={insertionPreview}
      highlightedStopId={selectedCustomerId}
      onSegmentHighlight={actions.highlightSegment}
      onStopClick={actions.selectCustomer}
    />
  );
}
