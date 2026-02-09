/**
 * Planner page - Route planning overview
 * 
 * Left panel: filters (date/range, crew, depot) + route list + route detail timeline
 * Right panel: map with route visualization
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import * as geometryService from '../services/geometryService';
import * as settingsService from '../services/settingsService';
import * as routeService from '../services/routeService';
import type { SavedRoute, SavedRouteStop } from '../services/routeService';
import { listCrews, type Crew } from '../services/crewService';
import type { Depot } from '@shared/settings';
import { RouteListPanel, RouteDetailTimeline, RouteMapPanel, type MapDepot } from '../components/planner';
import { PlannerFilters } from '../components/shared/PlannerFilters';
import styles from './Planner.module.css';

// Default depot location (Prague center) - fallback
const DEFAULT_DEPOT = { lat: 50.0755, lng: 14.4378 };

interface PlannerSearchParams {
  date?: string;
  crew?: string;
  depot?: string;
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
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedRouteStops, setSelectedRouteStops] = useState<SavedRouteStop[]>([]);
  const [depot, setDepot] = useState<{ lat: number; lng: number; name?: string } | null>(null);

  // --- Loading ---
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [isLoadingStops, setIsLoadingStops] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Map highlighting ---
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const geometryUnsubRef = useRef<(() => void) | null>(null);

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
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('Failed to load route stops:', detail);
        setError(`Nepodařilo se načíst zastávky trasy: ${detail}`);
        setSelectedRouteStops([]);
      } finally {
        setIsLoadingStops(false);
      }
    }
    loadStops();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouteId, isConnected]);

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

    try {
      // Cancel previous subscription
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }

      const jobResponse = await geometryService.submitGeometryJob(locations);

      const unsubscribe = await geometryService.subscribeToGeometryJobStatus(
        jobResponse.jobId,
        (update) => {
          if (update.status.type === 'completed') {
            const geometry = update.status.coordinates as [number, number][];
            setRouteGeometry(geometry);

            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          } else if (update.status.type === 'failed') {
            console.warn('Geometry job failed:', update.status.error);
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
      setRouteGeometry([]);
    }
  }, [depot]);

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
    setHighlightedSegment((prev) => (prev === segmentIndex ? null : segmentIndex));
  }, []);

  // ─── Route selection ─────────────────────────────────────────────

  const handleSelectRoute = useCallback((routeId: string) => {
    setSelectedRouteId(routeId);
    setHighlightedSegment(null);
    setHighlightedStopId(null);
  }, []);

  // ─── Selected route object ──────────────────────────────────────

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) ?? null;

  // ─── Get depot for selected route ────────────────────────────────

  const selectedRouteDepot: { name: string; lat: number; lng: number } | null = (() => {
    if (selectedRoute?.crewId) {
      const crew = crews.find((c) => c.id === selectedRoute.crewId);
      if (crew?.homeDepotId) {
        const crewDepot = depots.find((d) => d.id === crew.homeDepotId);
        if (crewDepot) return { lat: crewDepot.lat, lng: crewDepot.lng, name: crewDepot.name };
      }
    }
    if (depot) return { lat: depot.lat, lng: depot.lng, name: depot.name || 'Depo' };
    return null;
  })();

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
