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

  // #region agent log
  useEffect(() => {
    console.log('[DBG-2ba648] RouteMapPanel state', { isConnected, routeStopsCount: routeStops.length, routeGeometryCount: routeGeometry.length, selectedCustomerId, propCandidateId: selectedCandidate?.id ?? null, ctxCandidateId: state.selectedCandidateForMap?.id ?? null, effectiveCandidateId: effectiveCandidate?.id ?? null, effectiveCandidateCoords: effectiveCandidate?.coordinates ?? null });
  }, [isConnected, routeStops.length, routeGeometry.length, selectedCustomerId, selectedCandidate, state.selectedCandidateForMap, effectiveCandidate]);
  // #endregion

  const geometryUnsubRef = useRef<(() => void) | null>(null);

  // Fetch route stops only when PanelState has none (detached windows).
  // When used inside PlanningInbox the bridge keeps PanelState up-to-date,
  // so an independent fetch would overwrite locally-modified scheduling data.
  useEffect(() => {
    // #region agent log
    console.log('[DBG-2ba648] route fetch guard', { isConnected, hasDate: !!routeContext?.date, routeStopsLen: routeStops.length, willFetch: isConnected && !!routeContext?.date && routeStops.length === 0 });
    // #endregion
    if (!isConnected || !routeContext?.date || routeStops.length > 0) return;
    let cancelled = false;
    routeService
      .getRoute({ date: routeContext.date })
      .then((res) => {
        if (cancelled) return;
        const stops = (res as { route: unknown; stops: SavedRouteStop[] }).stops ?? [];
        // #region agent log
        console.log('[DBG-2ba648] route fetch result', { stopsCount: stops.length, firstStop: stops[0] ? { id: stops[0].id, customerId: stops[0].customerId } : null });
        // #endregion
        actions.setRouteStops(stops);
      })
      .catch((err) => {
        // #region agent log
        console.log('[DBG-2ba648] route fetch error', { error: String(err) });
        // #endregion
        if (!cancelled) actions.setRouteStops([]);
      });
    return () => { cancelled = true; };
  }, [isConnected, routeContext?.date, actions, routeStops.length]);

  // Fetch geometry when stops change
  const fetchGeometry = useCallback(async (stops: SavedRouteStop[]) => {
    const routableStops = stops.filter(
      (s) => s.stopType !== 'break' && s.customerLat != null && s.customerLng != null
    );

    if (routableStops.length < 1) {
      actions.setRouteGeometry([]);
      return;
    }

    const locations = routableStops.map((s) => ({ lat: s.customerLat!, lng: s.customerLng! }));

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
    // #region agent log
    console.log('[DBG-2ba648] geometry effect', { isConnected, routeStopsLen: routeStops.length, geometryKey: geometryKey.substring(0, 60) });
    // #endregion
    if (!isConnected || routeStops.length === 0) {
      actions.setRouteGeometry([]);
      return;
    }
    fetchGeometry(routeStops);

    return () => {
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, geometryKey, fetchGeometry]);

  return (
    <RouteMapPanelUI
      stops={routeStops}
      depot={null}
      routeGeometry={routeGeometry}
      highlightedSegment={highlightedSegment}
      insertionPreview={propInsertionPreview ?? insertionPreview}
      highlightedStopId={selectedCustomerId}
      selectedCandidate={effectiveCandidate}
      onSegmentHighlight={actions.highlightSegment}
      onStopClick={actions.selectCustomer}
    />
  );
}
