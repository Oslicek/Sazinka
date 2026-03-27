/**
 * Planner page - Route planning overview
 * 
 * Left panel: filters (date/range, crew, depot) + route list + route detail timeline
 * Right panel: map with route visualization
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import { useAuthStore } from '../stores/authStore';
import * as geometryService from '../services/geometryService';
import * as settingsService from '../services/settingsService';
import * as routeService from '../services/routeService';
import type { SavedRoute, SavedRouteStop } from '../services/routeService';
import { listCrews, type Crew } from '../services/crewService';
import type { BreakSettings, Depot } from '@shared/settings';
import type { RouteWarning } from '@shared/route';
import { validateBreak } from '../utils/breakUtils';
import { logger } from '../utils/logger';
import { calculateMetrics } from '../utils/routeMetrics';
import { buildGoogleMapsUrl, buildMapyCzUrl } from '../utils/routeExport';
import type { ExportTarget } from '../components/planner/RouteSummaryActions';
import { buildPrintHtml } from '../utils/routePrint';
import { RouteListPanel, RouteDetailTimeline, RouteMapPanel, type RouteMetrics, PlanningTimeline, TimelineViewToggle, type TimelineView, RouteSummaryStats, RouteSummaryActions, ArrivalBufferBar } from '../components/planner';
import { useLastVisitComment } from '../hooks/useLastVisitComment';
import { PlannerFilters } from '../components/shared/PlannerFilters';
import { AlertTriangle } from 'lucide-react';
import styles from './Plan.module.css';
import { PanelStateProvider } from '../contexts/PanelStateContext';
import { usePanelState } from '../hooks/usePanelState';
import { useDetachState } from '../hooks/useDetachState';
import { CustomerDetailPanel } from '../panels/CustomerDetailPanel';
import { RouteMapPanel as RouteMapPanelSelfSufficient } from '../panels/RouteMapPanel';
import { MapPanelShell } from '../components/layout';
import { PersistenceProvider } from '../persistence/react/PersistenceProvider';
import { usePersistentControl } from '../persistence/react/usePersistentControl';
import { sessionAdapter } from '../persistence/adapters/singletons';
import { planProfile, PLAN_PROFILE_ID, TIMELINE_VIEWS } from '../persistence/profiles/planProfile';
import { resolveValue } from '../persistence/react/resolveValue';

// Default depot location (Prague center) - fallback
const DEFAULT_DEPOT = { lat: 50.0755, lng: 14.4378 };

interface PlannerSearchParams {
  date?: string;
  crew?: string;
  depot?: string;
}

export function Plan() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return (
    <PersistenceProvider
      userId={userId}
      profiles={[planProfile]}
      adapters={{ session: sessionAdapter }}
    >
      <PanelStateProvider activePageContext="plan" enableChannel isSourceOfTruth={true}>
        <PlanInner />
      </PanelStateProvider>
    </PersistenceProvider>
  );
}

function PlanInner() {
  const { state, actions } = usePanelState();
  const { t } = useTranslation('planner');
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as PlannerSearchParams;
  const { isConnected } = useNatsStore();
  const { isDetached, detach, canDetach } = useDetachState();

  // --- Filters (URL > UPP > today) ---
  const today = new Date().toISOString().split('T')[0];
  const { value: uppDateFrom, setValue: setUppDateFrom } = usePersistentControl<string>(PLAN_PROFILE_ID, 'dateFrom');
  const { value: uppDateTo, setValue: setUppDateTo } = usePersistentControl<string>(PLAN_PROFILE_ID, 'dateTo');
  const { value: uppIsDateRange, setValue: setUppIsDateRange } = usePersistentControl<boolean>(PLAN_PROFILE_ID, 'isDateRange');
  const { value: uppCrew, setValue: setUppCrew } = usePersistentControl<string>(PLAN_PROFILE_ID, 'crew');
  const { value: uppDepot, setValue: setUppDepot } = usePersistentControl<string>(PLAN_PROFILE_ID, 'depot');

  const dateFrom = resolveValue<string>(searchParams?.date, uppDateFrom || undefined, today) ?? today;
  const dateTo = resolveValue<string>(searchParams?.date, uppDateTo || undefined, today) ?? today;
  const isDateRange = resolveValue<boolean>(undefined, uppIsDateRange, false) ?? false;
  const filterCrewId = resolveValue<string>(searchParams?.crew, uppCrew, '') ?? '';
  const filterDepotId = resolveValue<string>(searchParams?.depot, uppDepot, '') ?? '';

  // Sync URL params to UPP on mount so they survive navigation
  const didSyncRef = useRef(false);
  useEffect(() => {
    if (didSyncRef.current) return;
    didSyncRef.current = true;
    if (searchParams?.date) setUppDateFrom(searchParams.date);
    if (searchParams?.crew) setUppCrew(searchParams.crew);
    if (searchParams?.depot) setUppDepot(searchParams.depot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDateFrom = (v: string) => setUppDateFrom(v);
  const setDateTo = (v: string) => setUppDateTo(v);
  const setIsDateRange = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(isDateRange) : v;
    setUppIsDateRange(next);
  };
  const setFilterCrewId = (v: string) => setUppCrew(v);
  const setFilterDepotId = (v: string) => setUppDepot(v);

  // --- Data ---
  const [crews, setCrews] = useState<Crew[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [breakSettings, setBreakSettings] = useState<BreakSettings | null>(null);
  const [defaultWorkingHoursStart, setDefaultWorkingHoursStart] = useState<string | null>(null);
  const [defaultWorkingHoursEnd, setDefaultWorkingHoursEnd] = useState<string | null>(null);
  const [breakWarnings, setBreakWarnings] = useState<string[]>([]);
  const [manuallyAdjustedBreakIds, setManuallyAdjustedBreakIds] = useState<Set<string>>(new Set());
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const { value: _uppSelectedRouteId, setValue: setSelectedRouteId } =
    usePersistentControl<string | null>(PLAN_PROFILE_ID, 'selectedRouteId');
  const selectedRouteId: string | null =
    typeof _uppSelectedRouteId === 'string' ? _uppSelectedRouteId : null;

  const [selectedRouteStops, setSelectedRouteStops] = useState<SavedRouteStop[]>([]);

  const { value: _uppTimelineView, setValue: setUppTimelineView } =
    usePersistentControl<string>(PLAN_PROFILE_ID, 'timelineView');
  const timelineView: TimelineView = (TIMELINE_VIEWS as readonly string[]).includes(_uppTimelineView)
    ? (_uppTimelineView as TimelineView)
    : 'planning';
  const setTimelineView = (v: TimelineView) => setUppTimelineView(v);
  const [metrics, setMetrics] = useState<RouteMetrics | null>(null);
  const [depot, setDepot] = useState<{ lat: number; lng: number; name?: string } | null>(null);

  // --- Loading ---
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [isLoadingStops, setIsLoadingStops] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Resizable layout ---
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('planner.sidebarWidth');
    return saved ? parseInt(saved, 10) : 420;
  });
  const [routeListHeight, setRouteListHeight] = useState(() => {
    const saved = localStorage.getItem('planner.routeListHeight');
    return saved ? parseInt(saved, 10) : 200;
  });
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidth = Math.max(300, Math.min(800, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth((w) => { localStorage.setItem('planner.sidebarWidth', String(w)); return w; });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  const handleRouteListResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = routeListHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.max(80, Math.min(500, startHeight + delta));
      setRouteListHeight(newHeight);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setRouteListHeight((h) => { localStorage.setItem('planner.routeListHeight', String(h)); return h; });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [routeListHeight]);

  // --- Map highlighting ---
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [returnToDepotLeg, setReturnToDepotLeg] = useState<{ distanceKm: number | null; durationMinutes: number | null } | null>(null);
  const [depotDeparture, setDepotDeparture] = useState<string | null>(null);
  const geometryUnsubRef = useRef<(() => void) | null>(null);
  const activeGeometryJobRef = useRef<string | null>(null);

  const { notes: lvcNotes, visit: lvcVisit } = useLastVisitComment(highlightedStopId);
  const lastVisitComment = lvcNotes != null || lvcVisit != null ? { notes: lvcNotes, visit: lvcVisit } : undefined;

  // --- Route warnings (from optimization) ---
  // Note: Saved routes don't have warnings stored in DB yet, so this will be empty
  // TODO: Store warnings in DB when route is saved from optimization
  const [routeWarnings] = useState<RouteWarning[]>([]);

  // --- Arrival buffer (route-level) ---
  const [routeBufferPercent, setRouteBufferPercent] = useState(10);
  const [routeBufferFixedMinutes, setRouteBufferFixedMinutes] = useState(0);

  // --- Print / Export ---
  const [exportWarning, setExportWarning] = useState<string | null>(null);

  // ─── CustomerDetailPanel visibility ──────────────────────────────

  const [isDetailOpen, setIsDetailOpen] = useState(false);

  useEffect(() => {
    if (state.selectedCustomerId) setIsDetailOpen(true);
  }, [state.selectedCustomerId]);

  // ─── Derive routeContext from selected route / filters ──────────────
  const derivedRouteContext = useMemo(() => {
    const route = routes.find(r => r.id === selectedRouteId);
    const date = route?.date ?? dateFrom;
    const crewId = route?.crewId ?? filterCrewId;
    const depotId = (() => {
      if (crewId) {
        const crew = crews.find(c => c.id === crewId);
        if (crew?.homeDepotId) return crew.homeDepotId;
      }
      return filterDepotId;
    })();
    if (!date || !crewId || !depotId) return null;
    const crewName = crews.find(c => c.id === crewId)?.name ?? '';
    const depotName = depots.find(d => d.id === depotId)?.name ?? '';
    return { date, crewId, crewName, depotId, depotName };
  }, [selectedRouteId, routes, dateFrom, filterCrewId, filterDepotId, crews, depots]);

  // ─── Bridge: sync local state → PanelStateContext (single batched effect) ──
  // Consolidated into one effect to produce at most one context setState per
  // render cycle, preventing cascading re-renders (React error #185).
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const prevBridgeRef = useRef({
    selectedRouteStops, routeGeometry, returnToDepotLeg,
    depotDeparture, routeWarnings, breakWarnings, metrics,
    routeBufferPercent, routeBufferFixedMinutes,
    // Seed from PanelState (null) rather than local UPP value so the forward bridge
    // fires on the first render and pushes the persisted selection into PanelState.
    selectedRouteId: state.selectedRouteId,
    highlightedSegment,
    derivedRouteContext,
  });

  useEffect(() => {
    const prev = prevBridgeRef.current;
    const a = actionsRef.current;

    if (prev.selectedRouteStops !== selectedRouteStops) a.setRouteStops(selectedRouteStops);
    if (prev.derivedRouteContext !== derivedRouteContext) a.setRouteContext(derivedRouteContext);
    if (prev.routeGeometry !== routeGeometry) a.setRouteGeometry(routeGeometry);
    if (prev.returnToDepotLeg !== returnToDepotLeg) {
      if (!returnToDepotLeg || returnToDepotLeg.distanceKm === null || returnToDepotLeg.durationMinutes === null) {
        a.setReturnToDepotLeg(null);
      } else {
        a.setReturnToDepotLeg({ distanceKm: returnToDepotLeg.distanceKm, durationMinutes: returnToDepotLeg.durationMinutes });
      }
    }
    if (prev.depotDeparture !== depotDeparture) a.setDepotDeparture(depotDeparture);
    if (prev.routeWarnings !== routeWarnings) a.setRouteWarnings(routeWarnings);
    if (prev.breakWarnings !== breakWarnings) a.setBreakWarnings(breakWarnings);
    if (prev.metrics !== metrics) a.setMetrics(metrics);
    if (prev.routeBufferPercent !== routeBufferPercent || prev.routeBufferFixedMinutes !== routeBufferFixedMinutes) {
      a.setRouteBuffer(routeBufferPercent, routeBufferFixedMinutes);
    }
    if (prev.selectedRouteId !== selectedRouteId) a.selectRoute(selectedRouteId);
    if (prev.highlightedSegment !== highlightedSegment) a.highlightSegment(highlightedSegment);

    prevBridgeRef.current = {
      selectedRouteStops, routeGeometry, returnToDepotLeg,
      depotDeparture, routeWarnings, breakWarnings, metrics,
      routeBufferPercent, routeBufferFixedMinutes,
      selectedRouteId, highlightedSegment,
      derivedRouteContext,
    };
  });

  // Context → local (bidirectional): only when context provides a non-null value from
  // an external source (e.g. detached map). Ignoring null guards the persisted
  // selection from being overwritten by PanelState's initial null on first render.
  useEffect(() => {
    if (state.selectedRouteId !== null && state.selectedRouteId !== prevBridgeRef.current.selectedRouteId) {
      setSelectedRouteId(state.selectedRouteId);
      prevBridgeRef.current = { ...prevBridgeRef.current, selectedRouteId: state.selectedRouteId };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedRouteId]);

  useEffect(() => {
    if (state.highlightedSegment !== prevBridgeRef.current.highlightedSegment) {
      setHighlightedSegment(state.highlightedSegment);
      prevBridgeRef.current = { ...prevBridgeRef.current, highlightedSegment: state.highlightedSegment };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.highlightedSegment]);

  // ─── Load settings (crews, depots, user preferences) ─────────────

  useEffect(() => {
    if (!isConnected) return;

    async function loadSettings() {
      try {
        setIsLoadingSettings(true);
        const [settings, crewList] = await Promise.all([
          settingsService.getSettings(),
          listCrews(true),
        ]);

        setCrews(crewList);
        setDepots(settings.depots);
        setBreakSettings(settings.breakSettings ?? null);
        setDefaultWorkingHoursStart(settings.workConstraints?.workingHoursStart ?? null);
        setDefaultWorkingHoursEnd(settings.workConstraints?.workingHoursEnd ?? null);

        // Apply user preferences as default filter values (only if no URL params)
        const prefs = settings.preferences;
        if (!searchParams?.crew && prefs?.defaultCrewId) {
          setFilterCrewId(prefs.defaultCrewId);
        }
        if (!searchParams?.depot && prefs?.defaultDepotId) {
          setFilterDepotId(prefs.defaultDepotId);
        }

        // Initialize buffer from user preferences
        if (prefs?.lastArrivalBufferPercent != null) {
          setRouteBufferPercent(prefs.lastArrivalBufferPercent);
        }
        if (prefs?.lastArrivalBufferFixedMinutes != null) {
          setRouteBufferFixedMinutes(prefs.lastArrivalBufferFixedMinutes);
        }

        // Set depot for map
        const primaryDepot = settings.depots.find((d) => d.isPrimary) || settings.depots[0];
        if (primaryDepot) {
          setDepot({ lat: primaryDepot.lat, lng: primaryDepot.lng, name: primaryDepot.name });
        } else {
          setDepot(DEFAULT_DEPOT);
        }
      } catch (err) {
        logger.warn('Failed to load settings:', err);
        setDepot(DEFAULT_DEPOT);
      } finally {
        setIsLoadingSettings(false);
      }
    }
    loadSettings();
  // Intentionally run once after connectivity change; search params are read as initial defaults.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // ─── Load routes when filters change ─────────────────────────────

  const selectedRouteIdRef = useRef(selectedRouteId);
  selectedRouteIdRef.current = selectedRouteId;

  const loadRoutes = useCallback(async () => {
    if (!isConnected) return;

    setIsLoadingRoutes(true);
    setError(null);
    try {
      const effectiveDateTo = isDateRange ? dateTo : dateFrom;
      const response = await routeService.listRoutes({
        dateFrom,
        dateTo: effectiveDateTo,
        crewId: filterCrewId || null,
        depotId: filterDepotId || null,
      });
      setRoutes(response.routes);

      // Auto-select first route if current selection is not in results
      if (response.routes.length > 0) {
        const currentStillExists = selectedRouteIdRef.current && response.routes.some((r) => r.id === selectedRouteIdRef.current);
        if (!currentStillExists) {
          setSelectedRouteId(response.routes[0].id);
        }
      } else {
        setSelectedRouteId(null);
        setSelectedRouteStops([]);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      logger.error('Failed to load routes:', detail);
      setError(t('load_routes_error', { detail }));
      setRoutes([]);
    } finally {
      setIsLoadingRoutes(false);
    }
  }, [isConnected, dateFrom, dateTo, isDateRange, filterCrewId, filterDepotId]);

  useEffect(() => {
    if (!isLoadingSettings) {
      loadRoutes();
    }
  }, [loadRoutes, isLoadingSettings]);

  // ─── Load stops when selected route changes ──────────────────────

  useEffect(() => {
    if (!selectedRouteId || !isConnected) {
      setSelectedRouteStops([]);
      return;
    }

    async function loadStops() {
      if (!selectedRouteId) {
        setSelectedRouteStops([]);
        setIsLoadingStops(false);
        return;
      }
      setIsLoadingStops(true);
      try {
        const result = await routeService.getRoute({ routeId: selectedRouteId });
        setSelectedRouteStops(result.stops);
        const loadedReturnLeg =
          result.route?.returnToDepotDistanceKm != null || result.route?.returnToDepotDurationMinutes != null
            ? { distanceKm: result.route.returnToDepotDistanceKm ?? null, durationMinutes: result.route.returnToDepotDurationMinutes ?? null }
            : null;
        setReturnToDepotLeg(loadedReturnLeg);
        // Compute depot departure from first stop's arrival minus travel time
        if (result.stops.length > 0) {
          const firstStop = result.stops[0];
          if (firstStop.estimatedArrival && firstStop.durationFromPreviousMinutes) {
            const [hh, mm] = firstStop.estimatedArrival.slice(0, 5).split(':').map(Number);
            const depMin = hh * 60 + mm - Math.round(firstStop.durationFromPreviousMinutes);
            const dH = Math.floor(Math.max(0, depMin) / 60) % 24;
            const dM = Math.max(0, depMin) % 60;
            setDepotDeparture(`${String(dH).padStart(2, '0')}:${String(dM).padStart(2, '0')}`);
          } else {
            setDepotDeparture(null);
          }
        } else {
          setDepotDeparture(null);
        }
        setMetrics(
          calculateMetrics(result.stops, {
            distanceKm: result.route?.totalDistanceKm,
            durationMinutes: result.route?.totalDurationMinutes,
          }, loadedReturnLeg)
        );
        setManuallyAdjustedBreakIds(new Set());
        setBreakWarnings([]);

        // Set depot from route if available
        if (result.route?.depotId && depots.length > 0) {
          const routeDepot = depots.find(d => d.id === result.route!.depotId);
          if (routeDepot) {
            setDepot({ lat: routeDepot.lat, lng: routeDepot.lng, name: routeDepot.name });
          }
        }

        // Initialize buffer from loaded route
        if (result.route?.arrivalBufferPercent != null) {
          setRouteBufferPercent(result.route.arrivalBufferPercent);
        }
        if (result.route?.arrivalBufferFixedMinutes != null) {
          setRouteBufferFixedMinutes(result.route.arrivalBufferFixedMinutes);
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.error('Failed to load route stops:', detail);
        setError(t('load_stops_error', { detail }));
        setSelectedRouteStops([]);
        setReturnToDepotLeg(null);
        setMetrics(null);
      } finally {
        setIsLoadingStops(false);
      }
    }
    loadStops();
  // Keep `loadStops` local to this effect to avoid dependency churn from route-derived callbacks.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouteId, isConnected, depots]);

  // ─── URL sync ────────────────────────────────────────────────────

  const handleDateFromChange = useCallback((value: string) => {
    setDateFrom(value);
    if (!isDateRange) setDateTo(value);
    navigate({
      to: '/plan',
      search: { date: value, crew: filterCrewId || undefined, depot: filterDepotId || undefined } as Record<string, string | undefined>,
      replace: true,
    });
  }, [isDateRange, filterCrewId, filterDepotId, navigate]);

  const handleDateToChange = useCallback((value: string) => {
    setDateTo(value);
  }, []);

  const handleToggleRange = useCallback(() => {
    setIsDateRange((prev) => {
      if (prev) {
        // Collapsing range: set dateTo = dateFrom
        setDateTo(dateFrom);
      }
      return !prev;
    });
  }, [dateFrom]);

  const handleCrewFilterChange = useCallback((value: string) => {
    setFilterCrewId(value);
  }, []);

  const handleDepotFilterChange = useCallback((value: string) => {
    setFilterDepotId(value);
  }, []);

  // ─── Fetch Valhalla geometry ────────────────────────────────────

  const fetchGeometry = useCallback(async (stops: SavedRouteStop[]) => {
    if (!depot || stops.length === 0) {
      setRouteGeometry([]);
      return;
    }

    const waypoints = stops
      .filter((s) => s.customerLat && s.customerLng)
      .map((s) => ({
        lat: s.customerLat!,
        lng: s.customerLng!,
      }));

    if (waypoints.length === 0) {
      setRouteGeometry([]);
      return;
    }

    // Build locations: depot → stops → depot
    const locations = [
      { lat: depot.lat, lng: depot.lng },
      ...waypoints,
      { lat: depot.lat, lng: depot.lng },
    ];

    try {
      // Cancel previous subscription
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }

      const jobResponse = await geometryService.submitGeometryJob(locations);
      activeGeometryJobRef.current = jobResponse.jobId;

      const unsubscribe = await geometryService.subscribeToGeometryJobStatus(
        jobResponse.jobId,
        (update) => {
          if (update.status.type === 'completed') {
            const geometry = update.status.coordinates as [number, number][];
            const last = geometry[geometry.length - 1] ?? null;
            const isRouteEndingNearDepot = last
              ? Math.sqrt(
                ((last[0] - depot.lng) * 111.32) ** 2 +
                ((last[1] - depot.lat) * 111.32) ** 2
              ) < 1
              : null;
            const isStaleJob = activeGeometryJobRef.current !== jobResponse.jobId;
            if (isStaleJob || isRouteEndingNearDepot === null) {
              // No-op: evaluate stale-state and endpoint sanity for future handling.
            }
            setRouteGeometry(geometry);

            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          } else if (update.status.type === 'failed') {
            logger.warn('Geometry job failed:', update.status.error);
            setRouteGeometry([]);
            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          }
        },
      );

      geometryUnsubRef.current = unsubscribe;
    } catch (err) {
      logger.warn('Failed to fetch route geometry:', err);
      setRouteGeometry([]);
    }
  }, [depot, selectedRouteId]);

  // ─── Fetch geometry when stops change ────────────────────────────

  useEffect(() => {
    fetchGeometry(selectedRouteStops);

    return () => {
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }
    };
  }, [selectedRouteStops, fetchGeometry]);

  // ─── Handle stop click (timeline → map) ──────────────────────────

  const handleStopClick = useCallback((customerId: string, _index: number) => {
    setHighlightedStopId(customerId);
    actions.selectCustomer(customerId);
  }, [actions]);

  const handleSegmentClick = useCallback((segmentIndex: number) => {
    setHighlightedSegment((prev) => (prev === segmentIndex ? null : segmentIndex));
  }, []);

  const handleReorder = useCallback((newStops: SavedRouteStop[]) => {
    setSelectedRouteStops(newStops);
  }, []);

  const handleRemoveStop = useCallback((stopId: string) => {
    setManuallyAdjustedBreakIds((prev) => {
      const next = new Set(prev);
      next.delete(stopId);
      return next;
    });
    setSelectedRouteStops((prev) =>
      prev
        .filter((s) => s.id !== stopId)
        .map((s, idx) => ({ ...s, stopOrder: idx + 1 }))
    );
    setReturnToDepotLeg(null);
  }, []);

  const handleAddBreak = useCallback(() => {
    setSelectedRouteStops((prev) => {
      const breakCount = prev.filter((s) => s.stopType === 'break').length;
      const insertAt = Math.max(1, Math.floor(prev.length / 2));
      const breakDurationMinutes = breakSettings?.breakDurationMinutes ?? 30;
      const breakStop: SavedRouteStop = {
        id: crypto.randomUUID(),
        routeId: selectedRouteId ?? '',
        revisionId: null,
        stopOrder: insertAt + 1,
        estimatedArrival: null,
        estimatedDeparture: null,
        distanceFromPreviousKm: null,
        durationFromPreviousMinutes: null,
        status: 'draft',
        stopType: 'break',
        customerId: null,
        customerName: `Pauza ${breakCount + 1}`,
        address: null,
        customerLat: null,
        customerLng: null,
        customerPhone: null,
        customerEmail: null,
        scheduledDate: null,
        scheduledTimeStart: null,
        scheduledTimeEnd: null,
        revisionStatus: null,
        breakDurationMinutes,
        breakTimeStart: null,
      };

      const next = [...prev];
      next.splice(insertAt, 0, breakStop);
      return next.map((s, idx) => ({ ...s, stopOrder: idx + 1 }));
    });
    setReturnToDepotLeg(null);
  }, [selectedRouteId, breakSettings]);

  const handleUpdateBreak = useCallback((stopId: string, patch: { breakTimeStart?: string; breakDurationMinutes?: number }) => {
    setManuallyAdjustedBreakIds((prev) => {
      const next = new Set(prev);
      next.add(stopId);
      return next;
    });
    setSelectedRouteStops((prev) =>
      prev.map((s) => {
        if (s.id !== stopId || s.stopType !== 'break') return s;
        const breakTimeStart = patch.breakTimeStart ?? s.breakTimeStart ?? '12:00';
        const breakDurationMinutes = patch.breakDurationMinutes ?? s.breakDurationMinutes ?? 30;
        const [h, m] = breakTimeStart.split(':').map(Number);
        const total = h * 60 + m + breakDurationMinutes;
        const depH = Math.floor(total / 60) % 24;
        const depM = total % 60;
        const estimatedDeparture = `${String(depH).padStart(2, '0')}:${String(depM).padStart(2, '0')}`;
        return {
          ...s,
          breakTimeStart,
          breakDurationMinutes,
          estimatedArrival: breakTimeStart,
          estimatedDeparture,
        };
      })
    );
    setReturnToDepotLeg(null);
  }, []);

  // Override: update travel duration for a stop
  const handleUpdateTravelDuration = useCallback((stopId: string, minutes: number) => {
    setSelectedRouteStops((prev) =>
      prev.map((s) =>
        s.id === stopId ? { ...s, overrideTravelDurationMinutes: minutes } : s
      )
    );
  }, []);

  // Override: reset travel duration override for a stop
  const handleResetTravelDuration = useCallback((stopId: string) => {
    setSelectedRouteStops((prev) =>
      prev.map((s) =>
        s.id === stopId ? { ...s, overrideTravelDurationMinutes: undefined } : s
      )
    );
  }, []);

  // Override: update service duration for a stop
  const handleUpdateServiceDuration = useCallback((stopId: string, minutes: number) => {
    setSelectedRouteStops((prev) =>
      prev.map((s) =>
        s.id === stopId ? { ...s, overrideServiceDurationMinutes: minutes } : s
      )
    );
  }, []);

  // Override: reset service duration override for a stop
  const handleResetServiceDuration = useCallback((stopId: string) => {
    setSelectedRouteStops((prev) =>
      prev.map((s) =>
        s.id === stopId ? { ...s, overrideServiceDurationMinutes: undefined } : s
      )
    );
  }, []);

  const handleBufferChange = useCallback((percent: number, fixedMinutes: number) => {
    setRouteBufferPercent(percent);
    setRouteBufferFixedMinutes(fixedMinutes);
    // Note: In Planner, buffer changes are informational — route is already saved.
    // The buffer will be persisted when the route is next saved/optimized.
  }, []);

  useEffect(() => {
    const selectedRoute = routes.find((r) => r.id === selectedRouteId);
    setMetrics(
      calculateMetrics(selectedRouteStops, {
        distanceKm: selectedRoute?.totalDistanceKm ?? null,
        durationMinutes: selectedRoute?.totalDurationMinutes ?? null,
      }, returnToDepotLeg)
    );
  }, [selectedRouteStops, routes, selectedRouteId, returnToDepotLeg]);

  // ─── Route selection ─────────────────────────────────────────────

  const handleSelectRoute = useCallback((routeId: string) => {
    setSelectedRouteId(routeId);
    setHighlightedSegment(null);
    setHighlightedStopId(null);
  }, []);

  // ─── Delete route ──────────────────────────────────────────────

  const handleDeleteRoute = useCallback(async () => {
    if (!selectedRouteId) return;
    if (!window.confirm('Opravdu chcete smazat tuto trasu?')) return;

    try {
      await routeService.deleteRoute(selectedRouteId);
      setSelectedRouteId(null);
      setSelectedRouteStops([]);
      setReturnToDepotLeg(null);
      setRouteGeometry([]);
      // Reload route list
      loadRoutes();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(t('delete_route_error', { detail }));
    }
  }, [selectedRouteId, loadRoutes]);

  useEffect(() => {
    if (!breakSettings) {
      setBreakWarnings([]);
      return;
    }
    if (manuallyAdjustedBreakIds.size === 0) {
      setBreakWarnings([]);
      return;
    }
    const warnings: string[] = [];
    let cumulativeKm = 0;
    for (const stop of selectedRouteStops) {
      cumulativeKm += stop.distanceFromPreviousKm ?? 0;
      if (stop.stopType === 'break' && manuallyAdjustedBreakIds.has(stop.id)) {
        const ws = validateBreak(stop, breakSettings, cumulativeKm);
        warnings.push(...ws);
      }
    }
    setBreakWarnings(Array.from(new Set(warnings)));
  }, [selectedRouteStops, breakSettings, manuallyAdjustedBreakIds]);

  // ─── Selected route object ──────────────────────────────────────

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) ?? null;

  // ─── Get depot for selected route ────────────────────────────────

  const selectedRouteDepot: { name: string; lat: number; lng: number } | null = useMemo(() => {
    if (selectedRoute?.crewId) {
      const crew = crews.find((c) => c.id === selectedRoute.crewId);
      if (crew?.homeDepotId) {
        const crewDepot = depots.find((d) => d.id === crew.homeDepotId);
        if (crewDepot) return { lat: crewDepot.lat, lng: crewDepot.lng, name: crewDepot.name };
      }
    }
    if (depot) return { lat: depot.lat, lng: depot.lng, name: depot.name || 'Depo' };
    return null;
  }, [selectedRoute?.crewId, crews, depots, depot]);

  useEffect(() => {
    actions.setMapDepot(selectedRouteDepot);
  }, [selectedRouteDepot, actions]);

  const selectedRouteCrew = selectedRoute?.crewId ? crews.find((c) => c.id === selectedRoute.crewId) : null;
  const routeStartTime = (selectedRouteCrew?.workingHoursStart ?? defaultWorkingHoursStart)?.slice(0, 5) ?? null;
  const routeEndTime = (selectedRouteCrew?.workingHoursEnd ?? defaultWorkingHoursEnd)?.slice(0, 5) ?? null;

  // Actual route start/end derived from timeline data
  const actualRouteStart = depotDeparture?.slice(0, 5) ?? routeStartTime;
  const actualRouteEnd = useMemo(() => {
    if (selectedRouteStops.length === 0) return routeEndTime;
    const lastStop = selectedRouteStops[selectedRouteStops.length - 1];
    const lastDeparture = lastStop.estimatedDeparture ?? lastStop.estimatedArrival;
    if (!lastDeparture) return routeEndTime;
    const returnMin = returnToDepotLeg?.durationMinutes ?? 0;
    if (returnMin <= 0) return lastDeparture.slice(0, 5);
    // Parse HH:MM and add return travel time
    const [hh, mm] = lastDeparture.slice(0, 5).split(':').map(Number);
    const totalMin = hh * 60 + mm + Math.round(returnMin);
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  }, [selectedRouteStops, returnToDepotLeg, routeEndTime]);

  // ─── canPrint / canExport ─────────────────────────────────────────────────

  const canPrint = selectedRouteStops.length > 0 && (state.mapReady === true);
  const canExport = selectedRouteStops.some(
    (s) => s.stopType === 'customer' && s.customerLat !== null && s.customerLng !== null,
  );

  // ─── Print handler ────────────────────────────────────────────────────────

  const handlePrint = useCallback(() => {
    if (selectedRouteStops.length === 0) return;
    const dataUrl = actions.captureMap() ?? '';

    const routeTitle = [selectedRoute?.date, selectedRouteDepot?.name]
      .filter(Boolean)
      .join(' · ');

    const totalMin = metrics
      ? metrics.travelTimeMin + metrics.serviceTimeMin
      : null;

    const html = buildPrintHtml({
      title: routeTitle || t('print_route_title_fallback'),
      mapImageDataUrl: dataUrl,
      labels: {
        depot: t('print_label_depot'),
        departure: t('print_label_departure'),
        return: t('print_label_return'),
        totalTime: t('print_label_total_time'),
        workTime: t('print_label_work_time'),
        travelTime: t('print_label_travel_time'),
        distance: t('print_label_distance'),
        stops: t('print_label_stops'),
        colOrder: t('print_col_order'),
        colName: t('print_col_name'),
        colAddress: t('print_col_address'),
        colEta: t('print_col_eta'),
        colEtd: t('print_col_etd'),
        colService: t('print_col_service'),
        generated: t('print_label_generated'),
      },
      stops: selectedRouteStops.map((s, i) => {
        const durMin = s.overrideServiceDurationMinutes ?? s.serviceDurationMinutes;
        return {
          order: i + 1,
          name: s.customerName ?? '',
          address: s.address ?? '',
          eta: s.estimatedArrival?.slice(0, 5) ?? null,
          etd: s.estimatedDeparture?.slice(0, 5) ?? null,
          serviceDuration: durMin != null ? `${durMin} min` : null,
          stopType: s.stopType as 'customer' | 'break',
        };
      }),
      depot: selectedRouteDepot ? { name: selectedRouteDepot.name } : null,
      depotDeparture: depotDeparture,
      returnTime: actualRouteEnd ?? null,
      stats: {
        totalTime: totalMin !== null
          ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`
          : null,
        workTime: metrics
          ? `${Math.floor(metrics.serviceTimeMin / 60)}h ${metrics.serviceTimeMin % 60}m`
          : null,
        travelTime: metrics
          ? `${Math.floor(metrics.travelTimeMin / 60)}h ${metrics.travelTimeMin % 60}m`
          : null,
        distance: metrics ? `${metrics.distanceKm.toFixed(1)} km` : null,
        stopCount: selectedRouteStops.filter((s) => s.stopType !== 'break').length,
      },
    });

    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.onload = () => { win.print(); };
  }, [selectedRouteStops, selectedRouteDepot, selectedRoute, depotDeparture, actualRouteEnd, metrics, actions, t]);

  // ─── Export to Google Maps handler ───────────────────────────────────────

  const handleExport = useCallback((target: ExportTarget) => {
    const exportParams = {
      depot: selectedRouteDepot
        ? { lat: selectedRouteDepot.lat, lng: selectedRouteDepot.lng }
        : null,
      stops: selectedRouteStops.map((s) => ({
        customerLat: s.customerLat,
        customerLng: s.customerLng,
        stopType: s.stopType as 'customer' | 'break',
      })),
    };

    const result = target === 'mapy_cz'
      ? buildMapyCzUrl(exportParams)
      : buildGoogleMapsUrl(exportParams);

    if (result.url) {
      window.open(result.url, '_blank', 'noopener,noreferrer');
    }

    if (result.warnings.length > 0) {
      const msgs = result.warnings.map((w) => t(`export_gmaps_warning_${w.toLowerCase()}`));
      setExportWarning(msgs.join(' '));
    } else {
      setExportWarning(null);
    }
  }, [selectedRouteStops, selectedRouteDepot, t]);

  const handleOptimizeRoute = useCallback(async () => {
    if (!selectedRoute || selectedRouteStops.length < 2) return;

    const customerStops = selectedRouteStops.filter((s) => s.stopType === 'customer' && s.customerId);
    if (customerStops.length < 2) return;

    const startLocation = selectedRouteDepot
      ? { lat: selectedRouteDepot.lat, lng: selectedRouteDepot.lng }
      : { lat: customerStops[0].customerLat ?? 0, lng: customerStops[0].customerLng ?? 0 };

    setIsOptimizing(true);
    setError(null);

    // Extract time windows from saved route stops
    const timeWindows = customerStops
      .filter((s) => s.scheduledTimeStart && s.scheduledTimeEnd)
      .map((s) => ({
        customerId: s.customerId!,
        start: s.scheduledTimeStart!,
        end: s.scheduledTimeEnd!,
      }));

    try {
      const jobResponse = await routeService.submitRoutePlanJob({
        customerIds: customerStops.map((s) => s.customerId!),
        date: selectedRoute.date,
        startLocation,
        crewId: selectedRoute.crewId || undefined,
        timeWindows: timeWindows.length > 0 ? timeWindows : undefined,
      });

      const unsubscribe = await routeService.subscribeToRouteJobStatus(jobResponse.jobId, (update) => {
        switch (update.status.type) {
          case 'completed': {
            const result = update.status.result;
            if (result.stops && result.stops.length > 0) {
              const originalStops = selectedRouteStops;
              const optimizedStops: SavedRouteStop[] = result.stops.map((s, i) => {
                const isBreak = s.stopType === 'break';
                const original = isBreak
                  ? originalStops.find((rs) => rs.stopType === 'break')
                  : originalStops.find((rs) => rs.customerId === s.customerId);
                return {
                  id: original?.id ?? crypto.randomUUID(),
                  routeId: original?.routeId ?? selectedRoute.id,
                  revisionId: original?.revisionId ?? null,
                  stopOrder: i + 1,
                  estimatedArrival: s.eta,
                  estimatedDeparture: s.etd,
                  distanceFromPreviousKm: s.distanceFromPreviousKm ?? null,
                  durationFromPreviousMinutes: s.durationFromPreviousMinutes ?? null,
                  status: original?.status ?? 'draft',
                  stopType: isBreak ? 'break' : 'customer',
                  customerId: isBreak ? null : s.customerId,
                  customerName: isBreak ? 'Pauza' : s.customerName,
                  address: isBreak ? '' : s.address,
                  customerLat: isBreak ? null : s.coordinates.lat,
                  customerLng: isBreak ? null : s.coordinates.lng,
                  customerPhone: original?.customerPhone ?? null,
                  customerEmail: original?.customerEmail ?? null,
                  scheduledDate: original?.scheduledDate ?? null,
                  scheduledTimeStart: original?.scheduledTimeStart ?? null,
                  scheduledTimeEnd: original?.scheduledTimeEnd ?? null,
                  revisionStatus: original?.revisionStatus ?? null,
                  breakDurationMinutes: isBreak ? (s.breakDurationMinutes ?? 30) : undefined,
                  breakTimeStart: isBreak ? (s.breakTimeStart ?? s.eta) : undefined,
                };
              });

              // Re-attach unassigned stops at the end with a warning
              const unassignedIds = new Set(result.unassigned ?? []);
              if (unassignedIds.size > 0) {
                const unassignedOriginals = originalStops.filter(
                  (rs) => rs.customerId && unassignedIds.has(rs.customerId)
                );
                let order = optimizedStops.length;
                for (const orig of unassignedOriginals) {
                  order++;
                  optimizedStops.push({
                    ...orig,
                    stopOrder: order,
                    estimatedArrival: null,
                    estimatedDeparture: null,
                    distanceFromPreviousKm: null,
                    durationFromPreviousMinutes: null,
                    status: 'unassigned',
                  });
                }
                const names = unassignedOriginals.map((rs) => rs.customerName).join(', ');
                setError(t('optimizer_unassigned_planner', { names }));
              }

              setSelectedRouteStops(optimizedStops);
              setReturnToDepotLeg({
                distanceKm: result.returnToDepotDistanceKm ?? null,
                durationMinutes: result.returnToDepotDurationMinutes ?? null,
              });
              if (result.geometry && result.geometry.length > 0) {
                setRouteGeometry(result.geometry);
              }
            }
            setIsOptimizing(false);
            unsubscribe();
            break;
          }
          case 'failed':
            setError(t('optimize_failed_planner', { detail: update.status.error }));
            setIsOptimizing(false);
            unsubscribe();
            break;
          default:
            break;
        }
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(t('optimize_error', { detail }));
      setIsOptimizing(false);
    }
  }, [selectedRoute, selectedRouteStops, selectedRouteDepot]);

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className={styles.planner}>
      <div className={styles.sidebar} ref={sidebarRef} style={{ width: sidebarWidth }}>
        {/* Filters */}
        <PlannerFilters
          dateFrom={dateFrom}
          dateTo={dateTo}
          isDateRange={isDateRange}
          filterCrewId={filterCrewId}
          filterDepotId={filterDepotId}
          crews={crews}
          depots={depots}
          onDateFromChange={handleDateFromChange}
          onDateToChange={handleDateToChange}
          onToggleRange={handleToggleRange}
          onCrewChange={handleCrewFilterChange}
          onDepotChange={handleDepotFilterChange}
        />

        {/* Error */}
        {error && (
          <div className={styles.error}>
            {error}
            <button type="button" onClick={() => setError(null)}>x</button>
          </div>
        )}
        {breakWarnings.length > 0 && (
          <div className={styles.warningBox}>
            {breakWarnings.map((w, i) => (
              <div key={`${w}-${i}`}><AlertTriangle size={14} /> {w}</div>
            ))}
          </div>
        )}

        {/* Route list */}
        <div className={styles.routeListSection} style={{ height: routeListHeight, minHeight: 80, maxHeight: 500 }}>
          <div className={styles.sectionHeader}>
            <h3>{t('planned_routes', { count: routes.length })}</h3>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={loadRoutes}
              disabled={isLoadingRoutes}
              title={t('refresh')}
            >
              {isLoadingRoutes ? '...' : '\u21BB'}
            </button>
          </div>
          <RouteListPanel
            routes={routes}
            selectedRouteId={selectedRouteId}
            onSelectRoute={handleSelectRoute}
            isLoading={isLoadingRoutes}
          />
        </div>
        {/* Resize handle for route list height */}
        <div className={styles.routeListResizer} onMouseDown={handleRouteListResizeStart} />

        {/* Route detail timeline */}
        {selectedRoute && (
          <div className={styles.routeDetailSection}>
            <div className={styles.sectionHeader}>
              <h3>Detail trasy</h3>
              <TimelineViewToggle value={timelineView} onChange={setTimelineView} />
            </div>

            {/* Stats + action buttons bar */}
            <div className={styles.routeSummaryBar}>
              <RouteSummaryStats
                routeStartTime={actualRouteStart}
                routeEndTime={actualRouteEnd}
                metrics={metrics}
                stopCount={selectedRouteStops.filter(s => s.stopType !== 'break').length}
              />
              <RouteSummaryActions
                onOptimize={handleOptimizeRoute}
                onAddBreak={handleAddBreak}
                onDeleteRoute={handleDeleteRoute}
                isOptimizing={isOptimizing}
                canOptimize={selectedRouteStops.length >= 2}
                deleteLabel="Smazat trasu"
                onPrint={handlePrint}
                onExport={handleExport}
                canPrint={canPrint}
                canExport={canExport}
              />
            </div>

            {/* Export warning banner */}
            {exportWarning && (
              <div role="status" className={styles.exportWarningBanner}>
                {exportWarning}
                <button type="button" onClick={() => setExportWarning(null)}>×</button>
              </div>
            )}

            {/* Arrival buffer bar — between actions and timeline */}
            <ArrivalBufferBar
              percent={routeBufferPercent}
              fixedMinutes={routeBufferFixedMinutes}
              onChange={handleBufferChange}
            />

            {isLoadingStops ? (
              <div className={styles.loading}>{t('loading_stops')}</div>
            ) : timelineView === 'compact' ? (
              <RouteDetailTimeline
                stops={selectedRouteStops}
                depot={selectedRouteDepot}
                selectedStopId={highlightedStopId}
                highlightedSegment={highlightedSegment}
                onStopClick={handleStopClick}
                onSegmentClick={handleSegmentClick}
                onRemoveStop={handleRemoveStop}
                onUpdateBreak={handleUpdateBreak}
                onUpdateTravelDuration={handleUpdateTravelDuration}
                onResetTravelDuration={handleResetTravelDuration}
                onUpdateServiceDuration={handleUpdateServiceDuration}
                onResetServiceDuration={handleResetServiceDuration}
                warnings={routeWarnings}
                routeStartTime={routeStartTime}
                routeEndTime={routeEndTime}
                returnToDepotDistanceKm={returnToDepotLeg?.distanceKm ?? null}
                returnToDepotDurationMinutes={returnToDepotLeg?.durationMinutes ?? null}
                lastVisitComment={lastVisitComment}
              />
            ) : (
              <PlanningTimeline
                stops={selectedRouteStops}
                depot={selectedRouteDepot}
                selectedStopId={highlightedStopId}
                onStopClick={handleStopClick}
                routeStartTime={routeStartTime}
                routeEndTime={routeEndTime}
                depotDeparture={depotDeparture}
                onReorder={handleReorder}
                onRemoveStop={handleRemoveStop}
                onUpdateBreak={handleUpdateBreak}
                onUpdateTravelDuration={handleUpdateTravelDuration}
                onResetTravelDuration={handleResetTravelDuration}
                onUpdateServiceDuration={handleUpdateServiceDuration}
                onResetServiceDuration={handleResetServiceDuration}
                warnings={routeWarnings}
                returnToDepotDistanceKm={returnToDepotLeg?.distanceKm ?? null}
                returnToDepotDurationMinutes={returnToDepotLeg?.durationMinutes ?? null}
                lastVisitComment={lastVisitComment}
              />
            )}
          </div>
        )}

        {/* Connection status */}
        {!isConnected && (
          <div className={styles.connectionStatus}>
            Neni pripojeno k serveru
          </div>
        )}
      </div>

      {/* Sidebar/Map resize handle */}
      <div className={styles.sidebarResizer} onMouseDown={handleSidebarResizeStart} />

      {/* Map — self-sufficient panel, detachable */}
      {!isDetached('map') && (
        <div className={styles.mapWrapper}>
          <MapPanelShell
            panelName="map"
            canDetach={canDetach}
            onDetach={() => detach('map')}
          >
            <RouteMapPanelSelfSufficient />
          </MapPanelShell>
        </div>
      )}

      {/* Customer detail panel — opens when a stop/customer is selected */}
      <CustomerDetailPanel
        mode="plan"
        isOpen={isDetailOpen}
        routeStops={selectedRouteStops}
      />
    </div>
  );
}
