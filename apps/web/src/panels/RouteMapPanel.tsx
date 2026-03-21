import { useEffect, useRef, useCallback } from 'react';
import { usePanelState } from '@/hooks/usePanelState';
import { useNatsStore } from '@/stores/natsStore';
import { RouteMapPanel as RouteMapPanelUI } from '@/components/planner/RouteMapPanel';
import * as routeService from '@/services/routeService';
import * as geometryService from '@/services/geometryService';
import type { SavedRouteStop } from '@/services/routeService';

/**
 * Smart panel wrapper for the RouteMapPanel UI component.
 * Reads all map-relevant state from PanelStateContext, wires up
 * segment-highlight and stop-selection actions, and independently
 * fetches route stops + geometry via NATS when a routeContext is available.
 */
import type { SelectedCandidate } from '@/components/planner/RouteMapPanel';
import type { InsertionPreview } from '@/components/planner/RouteMapPanel';
import { toggleMapSelectedId, mergeMapSelectedIds } from '@/utils/mapSelection';

interface RouteMapPanelProps {
  selectedCandidate?: SelectedCandidate | null;
  insertionPreview?: InsertionPreview | null;
}

export function RouteMapPanel({ selectedCandidate, insertionPreview: propInsertionPreview }: RouteMapPanelProps = {}) {
  const { state, actions } = usePanelState();
  const { isConnected } = useNatsStore();
  const {
    routeStops,
    routeGeometry,
    highlightedSegment,
    insertionPreview,
    selectedCustomerId,
    routeContext,
  } = state;

  const effectiveCandidate = selectedCandidate ?? state.selectedCandidateForMap ?? null;
  const effectiveCandidates = state.selectedCandidatesForMap ?? [];
  const mapSelectionTool = state.mapSelectionTool ?? null;
  const mapSelectedIds = state.mapSelectedIds ?? [];

  const geometryUnsubRef = useRef<(() => void) | null>(null);

  // Fetch route stops only when PanelState has none (detached windows).
  // When used inside PlanningInbox the bridge keeps PanelState up-to-date,
  // so an independent fetch would overwrite locally-modified scheduling data.
  useEffect(() => {
    if (!isConnected || !routeContext?.date || routeStops.length > 0) return;
    let cancelled = false;
    routeService
      .getRoute({ date: routeContext.date })
      .then((res) => {
        if (cancelled) return;
        const stops = (res as { route: unknown; stops: SavedRouteStop[] }).stops ?? [];
        // ONLY set stops if we actually got some from the backend.
        // If we got 0 stops, it means the route was deleted or doesn't exist,
        // and we shouldn't broadcast an empty array that might overwrite local state.
        if (stops.length > 0) {
          actions.setRouteStops(stops);
        }
      })
      .catch(() => {
        // Do not broadcast empty array on error either
      });
    return () => { cancelled = true; };
  }, [isConnected, routeContext?.date, actions, routeStops.length]);

  // Fetch geometry when stops change (includes depot for full road geometry)
  const depot = state.mapDepot ?? null;
  const fetchGeometry = useCallback(async (stops: SavedRouteStop[], depotCoord: { lat: number; lng: number } | null) => {
    const routableStops = stops.filter(
      (s) => s.stopType !== 'break' && s.customerLat != null && s.customerLng != null
    );

    if (routableStops.length < 1) {
      actions.setRouteGeometry([]);
      return;
    }

    const stopLocations = routableStops.map((s) => ({ lat: s.customerLat!, lng: s.customerLng! }));
    const locations = depotCoord
      ? [{ lat: depotCoord.lat, lng: depotCoord.lng }, ...stopLocations, { lat: depotCoord.lat, lng: depotCoord.lng }]
      : stopLocations;

    try {
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }

      const jobResponse = await geometryService.submitGeometryJob(locations);
      const unsubscribe = await geometryService.subscribeToGeometryJobStatus(
        jobResponse.jobId,
        (update: { status: { type: string; coordinates?: [number, number][]; error?: string } }) => {
          if (update.status.type === 'completed' && update.status.coordinates) {
            actions.setRouteGeometry(update.status.coordinates);
            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          } else if (update.status.type === 'failed') {
            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          }
        }
      );
      geometryUnsubRef.current = unsubscribe;
    } catch {
      // Non-critical — map still renders without geometry
    }
  }, [actions]);

  const geometryKey = routeStops
    .filter((s) => s.stopType !== 'break' && s.customerLat != null && s.customerLng != null)
    .map((s) => `${s.customerLat},${s.customerLng}`)
    .join('|');

  useEffect(() => {
    if (!isConnected || routeStops.length === 0) {
      actions.setRouteGeometry([]);
      return;
    }
    fetchGeometry(routeStops, depot);

    return () => {
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, geometryKey, fetchGeometry, depot]);

  return (
    <RouteMapPanelUI
      stops={routeStops}
      depot={state.mapDepot ?? null}
      routeGeometry={routeGeometry}
      highlightedSegment={highlightedSegment}
      insertionPreview={propInsertionPreview ?? insertionPreview}
      highlightedStopId={selectedCustomerId}
      selectedCandidate={effectiveCandidate}
      selectedCandidates={effectiveCandidates}
      mapSelectionTool={mapSelectionTool}
      onMapSelectionToolChange={actions.setMapSelectionTool}
      mapSelectedIds={mapSelectedIds}
      onCandidateToggle={(id) => actions.setMapSelectedIds(toggleMapSelectedId(mapSelectedIds, id))}
      onCandidateRectSelect={(ids) => actions.setMapSelectedIds(mergeMapSelectedIds(mapSelectedIds, ids))}
      onSegmentHighlight={actions.highlightSegment}
      onStopClick={actions.selectCustomer}
    />
  );
}
