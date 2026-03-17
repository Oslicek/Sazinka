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
export function RouteMapPanel() {
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
        actions.setRouteStops(stops);
      })
      .catch(() => { if (!cancelled) actions.setRouteStops([]); });
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
      insertionPreview={insertionPreview}
      highlightedStopId={selectedCustomerId}
      onSegmentHighlight={actions.highlightSegment}
      onStopClick={actions.selectCustomer}
    />
  );
}
