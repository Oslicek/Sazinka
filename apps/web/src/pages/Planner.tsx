/**
 * Planner page - Route planning overview
 * 
 * Left panel: filters (date/range, crew, depot) + route list + route detail timeline
 * Right panel: map with route visualization
 */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import * as geometryService from '../services/geometryService';
import * as settingsService from '../services/settingsService';
import * as routeService from '../services/routeService';
import type { SavedRoute, SavedRouteStop } from '../services/routeService';
import { listCrews, type Crew } from '../services/crewService';
import type { BreakSettings, Depot } from '@shared/settings';
import type { RouteWarning } from '@shared/route';
import { validateBreak } from '../utils/breakUtils';
import { RouteListPanel, RouteDetailTimeline, RouteMapPanel, type MapDepot, type RouteMetrics } from '../components/planner';
import { PlannerFilters } from '../components/shared/PlannerFilters';
import styles from './Planner.module.css';

// Default depot location (Prague center) - fallback
const DEFAULT_DEPOT = { lat: 50.0755, lng: 14.4378 };

interface PlannerSearchParams {
  date?: string;
  crew?: string;
  depot?: string;
}

function parseHm(time: string | null | undefined): number | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function calculateMetrics(
  stops: SavedRouteStop[],
  routeTotals?: { distanceKm?: number | null; durationMinutes?: number | null }
): RouteMetrics | null {
  if (stops.length === 0) return null;

  const summedDistanceKm = stops.reduce((sum, stop) => sum + (stop.distanceFromPreviousKm ?? 0), 0);
  const distanceKm =
    summedDistanceKm > 0
      ? summedDistanceKm
      : Math.max(0, routeTotals?.distanceKm ?? 0);
  const rawTravelTimeMin = stops.reduce((sum, stop) => sum + (stop.durationFromPreviousMinutes ?? 0), 0);
  const breakMin = stops
    .filter((s) => s.stopType === 'break')
    .reduce((sum, s) => sum + (s.breakDurationMinutes ?? 0), 0);
  const customerServiceMin = stops.filter((s) => s.stopType === 'customer').length * 30;
  const nonTravelMin = customerServiceMin + breakMin;

  const firstArrival = parseHm(stops[0].estimatedArrival);
  const lastDeparture = parseHm(stops[stops.length - 1].estimatedDeparture);
  let totalMin = 0;

  // Prefer persisted route totals when available so Planner matches Inbox
  // for the same saved route.
  if ((routeTotals?.durationMinutes ?? 0) > 0) {
    totalMin = routeTotals?.durationMinutes ?? 0;
  } else if (firstArrival != null && lastDeparture != null) {
    totalMin = lastDeparture - firstArrival;
    if (totalMin < 0) totalMin += 24 * 60;
  } else {
    totalMin = rawTravelTimeMin + nonTravelMin;
  }

  // Saved/optimized routes can miss per-segment durations in UI model.
  // In that case estimate driving as total minus non-driving blocks.
  const travelTimeMin = rawTravelTimeMin > 0
    ? rawTravelTimeMin
    : Math.max(0, totalMin - nonTravelMin);
  const serviceTimeMin = Math.max(0, totalMin - travelTimeMin);
  const workingDayMin = 9 * 60;

  return {
    distanceKm,
    travelTimeMin: Math.max(0, Math.round(travelTimeMin)),
    serviceTimeMin: Math.max(0, Math.round(serviceTimeMin)),
    loadPercent: Math.round((totalMin / workingDayMin) * 100),
    slackMin: Math.max(0, workingDayMin - totalMin),
    stopCount: stops.length,
  };
}

export function Planner() {
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as PlannerSearchParams;
  const { isConnected } = useNatsStore();

  // --- Filters ---
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(searchParams?.date || today);
  const [dateTo, setDateTo] = useState(searchParams?.date || today);
  const [isDateRange, setIsDateRange] = useState(false);
  const [filterCrewId, setFilterCrewId] = useState<string>(searchParams?.crew || '');
  const [filterDepotId, setFilterDepotId] = useState<string>(searchParams?.depot || '');

  // --- Data ---
  const [crews, setCrews] = useState<Crew[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [breakSettings, setBreakSettings] = useState<BreakSettings | null>(null);
  const [defaultWorkingHoursStart, setDefaultWorkingHoursStart] = useState<string | null>(null);
  const [defaultWorkingHoursEnd, setDefaultWorkingHoursEnd] = useState<string | null>(null);
  const [breakWarnings, setBreakWarnings] = useState<string[]>([]);
  const [manuallyAdjustedBreakIds, setManuallyAdjustedBreakIds] = useState<Set<string>>(new Set());
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedRouteStops, setSelectedRouteStops] = useState<SavedRouteStop[]>([]);
  const [metrics, setMetrics] = useState<RouteMetrics | null>(null);
  const [depot, setDepot] = useState<{ lat: number; lng: number; name?: string } | null>(null);

  // --- Loading ---
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [isLoadingStops, setIsLoadingStops] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Map highlighting ---
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [returnToDepotLeg, setReturnToDepotLeg] = useState<{ distanceKm: number | null; durationMinutes: number | null } | null>(null);
  const geometryUnsubRef = useRef<(() => void) | null>(null);
  const activeGeometryJobRef = useRef<string | null>(null);

  // --- Route warnings (from optimization) ---
  // Note: Saved routes don't have warnings stored in DB yet, so this will be empty
  // TODO: Store warnings in DB when route is saved from optimization
  const [routeWarnings] = useState<RouteWarning[]>([]);

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

        // Set depot for map
        const primaryDepot = settings.depots.find((d) => d.isPrimary) || settings.depots[0];
        if (primaryDepot) {
          setDepot({ lat: primaryDepot.lat, lng: primaryDepot.lng, name: primaryDepot.name });
        } else {
          setDepot(DEFAULT_DEPOT);
        }
      } catch (err) {
        console.warn('Failed to load settings:', err);
        setDepot(DEFAULT_DEPOT);
      } finally {
        setIsLoadingSettings(false);
      }
    }
    loadSettings();
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
      console.error('Failed to load routes:', detail);
      setError(`Nepodařilo se načíst cesty: ${detail}`);
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
        console.log('[Planner] Route stops loaded:', result.stops.map(s => ({
          name: s.customerName,
          revisionId: s.revisionId,
          revisionStatus: s.revisionStatus,
          scheduledTimeStart: s.scheduledTimeStart,
          scheduledTimeEnd: s.scheduledTimeEnd,
          distanceKm: s.distanceFromPreviousKm,
          durationMin: s.durationFromPreviousMinutes,
        })));
        setSelectedRouteStops(result.stops);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-7',hypothesisId:'H14',location:'Planner.tsx:loadStops',message:'planner loaded route by routeId',data:{routeId:selectedRouteId,date:result.route?.date ?? null,stops:result.stops.map((s,i)=>({i,id:s.id,customerId:s.customerId,name:s.customerName,lng:s.customerLng,lat:s.customerLat,stopOrder:s.stopOrder,address:s.address}))},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        setReturnToDepotLeg(
          result.route?.returnToDepotDistanceKm != null || result.route?.returnToDepotDurationMinutes != null
            ? { distanceKm: result.route.returnToDepotDistanceKm ?? null, durationMinutes: result.route.returnToDepotDurationMinutes ?? null }
            : null
        );
        setMetrics(
          calculateMetrics(result.stops, {
            distanceKm: result.route?.totalDistanceKm,
            durationMinutes: result.route?.totalDurationMinutes,
          })
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
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('Failed to load route stops:', detail);
        setError(`Nepodařilo se načíst zastávky trasy: ${detail}`);
        setSelectedRouteStops([]);
        setReturnToDepotLeg(null);
        setMetrics(null);
      } finally {
        setIsLoadingStops(false);
      }
    }
    loadStops();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouteId, isConnected, depots]);

  // ─── URL sync ────────────────────────────────────────────────────

  const handleDateFromChange = useCallback((value: string) => {
    setDateFrom(value);
    if (!isDateRange) setDateTo(value);
    navigate({
      to: '/planner',
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
    const geometryRunRouteId = selectedRouteId;

    try {
      // Cancel previous subscription
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }

      const jobResponse = await geometryService.submitGeometryJob(locations);
      activeGeometryJobRef.current = jobResponse.jobId;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-6',hypothesisId:'H12',location:'Planner.tsx:fetchGeometry-submit',message:'geometry job submitted',data:{routeId:geometryRunRouteId,jobId:jobResponse.jobId,locationsCount:locations.length,stopsCount:stops.length,waypointsCount:waypoints.length,stops:stops.map((s,i)=>({i,id:s.id,customerId:s.customerId,name:s.customerName,lng:s.customerLng,lat:s.customerLat,stopOrder:s.stopOrder})),locations},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      const unsubscribe = await geometryService.subscribeToGeometryJobStatus(
        jobResponse.jobId,
        (update) => {
          if (update.status.type === 'completed') {
            const geometry = update.status.coordinates as [number, number][];
            const first = geometry[0] ?? null;
            const last = geometry[geometry.length - 1] ?? null;
            const distanceToDepotKm = last
              ? Math.sqrt(
                ((last[0] - depot.lng) * 111.32) ** 2 +
                ((last[1] - depot.lat) * 111.32) ** 2
              )
              : null;
            const isStaleJob = activeGeometryJobRef.current !== jobResponse.jobId;
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-2',hypothesisId:isStaleJob?'H7':'H6',location:'Planner.tsx:fetchGeometry-completed',message:'geometry job completed',data:{routeId:geometryRunRouteId,jobId:jobResponse.jobId,isStaleJob,geometryPoints:geometry.length,first,last,depot:{lat:depot.lat,lng:depot.lng},distanceToDepotKm},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            setRouteGeometry(geometry);

            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          } else if (update.status.type === 'failed') {
            console.warn('Geometry job failed:', update.status.error);
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-2',hypothesisId:'H6',location:'Planner.tsx:fetchGeometry-failed',message:'geometry job failed',data:{routeId:geometryRunRouteId,jobId:jobResponse.jobId,error:update.status.error},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
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
      console.warn('Failed to fetch route geometry:', err);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-2',hypothesisId:'H6',location:'Planner.tsx:fetchGeometry-error',message:'geometry request failed before completion',data:{routeId:geometryRunRouteId,error:err instanceof Error ? err.message : String(err)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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
  }, []);

  const handleSegmentClick = useCallback((segmentIndex: number) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/9aaba2f3-fc9a-42ee-ad9d-d660c5a30902',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:'pre-fix-1',hypothesisId:'H2',location:'Planner.tsx:handleSegmentClick',message:'timeline segment click',data:{segmentIndex},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setHighlightedSegment((prev) => (prev === segmentIndex ? null : segmentIndex));
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

  useEffect(() => {
    const selectedRoute = routes.find((r) => r.id === selectedRouteId);
    setMetrics(
      calculateMetrics(selectedRouteStops, {
        distanceKm: selectedRoute?.totalDistanceKm ?? null,
        durationMinutes: selectedRoute?.totalDurationMinutes ?? null,
      })
    );
  }, [selectedRouteStops, routes, selectedRouteId]);

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
      setError(`Nepodařilo se smazat trasu: ${detail}`);
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

  const selectedRouteCrew = selectedRoute?.crewId ? crews.find((c) => c.id === selectedRoute.crewId) : null;
  const routeStartTime = (selectedRouteCrew?.workingHoursStart ?? defaultWorkingHoursStart)?.slice(0, 5) ?? null;
  const routeEndTime = (selectedRouteCrew?.workingHoursEnd ?? defaultWorkingHoursEnd)?.slice(0, 5) ?? null;

  const handleOptimizeRoute = useCallback(async () => {
    if (!selectedRoute || selectedRouteStops.length < 2) return;

    const customerStops = selectedRouteStops.filter((s) => s.stopType === 'customer' && s.customerId);
    if (customerStops.length < 2) return;

    const startLocation = selectedRouteDepot
      ? { lat: selectedRouteDepot.lat, lng: selectedRouteDepot.lng }
      : { lat: customerStops[0].customerLat ?? 0, lng: customerStops[0].customerLng ?? 0 };

    setIsOptimizing(true);
    setError(null);

    try {
      const jobResponse = await routeService.submitRoutePlanJob({
        customerIds: customerStops.map((s) => s.customerId!),
        date: selectedRoute.date,
        startLocation,
        crewId: selectedRoute.crewId || undefined,
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
            setError(`Optimalizace selhala: ${update.status.error}`);
            setIsOptimizing(false);
            unsubscribe();
            break;
          default:
            break;
        }
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Nepodařilo se optimalizovat trasu: ${detail}`);
      setIsOptimizing(false);
    }
  }, [selectedRoute, selectedRouteStops, selectedRouteDepot]);

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className={styles.planner}>
      <div className={styles.sidebar}>
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
              <div key={`${w}-${i}`}>⚠️ {w}</div>
            ))}
          </div>
        )}

        {/* Route list */}
        <div className={styles.routeListSection}>
          <div className={styles.sectionHeader}>
            <h3>Naplánované cesty ({routes.length})</h3>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={loadRoutes}
              disabled={isLoadingRoutes}
              title="Obnovit"
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

        {/* Route detail timeline */}
        {selectedRoute && (
          <div className={styles.routeDetailSection}>
            <div className={styles.sectionHeader}>
              <h3>Detail trasy</h3>
              {selectedRoute.totalDistanceKm != null && selectedRoute.totalDistanceKm > 0 && (
                <span className={styles.routeStats}>
                  {Math.round(selectedRoute.totalDistanceKm)} km
                  {selectedRoute.totalDurationMinutes != null && selectedRoute.totalDurationMinutes > 0 && (
                    <> &middot; {Math.floor(selectedRoute.totalDurationMinutes / 60)}h{(selectedRoute.totalDurationMinutes % 60).toString().padStart(2, '0')}</>
                  )}
                </span>
              )}
            </div>
            {isLoadingStops ? (
              <div className={styles.loading}>Nacitam zastávky...</div>
            ) : (
              <RouteDetailTimeline
                stops={selectedRouteStops}
                depot={selectedRouteDepot}
                selectedStopId={highlightedStopId}
                highlightedSegment={highlightedSegment}
                onStopClick={handleStopClick}
                onSegmentClick={handleSegmentClick}
                onRemoveStop={handleRemoveStop}
                onAddBreak={handleAddBreak}
                onOptimize={handleOptimizeRoute}
                onUpdateBreak={handleUpdateBreak}
                onDeleteRoute={handleDeleteRoute}
                isOptimizing={isOptimizing}
                metrics={metrics}
                warnings={routeWarnings}
                routeStartTime={routeStartTime}
                routeEndTime={routeEndTime}
                returnToDepotDistanceKm={returnToDepotLeg?.distanceKm ?? null}
                returnToDepotDurationMinutes={returnToDepotLeg?.durationMinutes ?? null}
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

      {/* Map */}
      <div className={styles.mapWrapper}>
        <RouteMapPanel
          stops={selectedRouteStops}
          depot={selectedRouteDepot}
          routeGeometry={routeGeometry}
          highlightedStopId={highlightedStopId}
          highlightedSegment={highlightedSegment}
          debugSource="planner"
          debugRouteId={selectedRouteId}
          onStopClick={(stopId) => {
            setHighlightedStopId(stopId);
          }}
          onSegmentHighlight={setHighlightedSegment}
          isLoading={isLoadingStops}
        />
      </div>
    </div>
  );
}
