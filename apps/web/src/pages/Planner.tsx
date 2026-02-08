/**
 * Planner page - Route planning overview
 * 
 * Left panel: filters (date/range, crew, depot) + route list + route detail timeline
 * Right panel: map with route visualization
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearch, useNavigate } from '@tanstack/react-router';
import maplibregl from 'maplibre-gl';
import { useNatsStore } from '../stores/natsStore';
import {
  buildStraightLineSegments,
} from '../utils/routeGeometry';
import * as settingsService from '../services/settingsService';
import * as routeService from '../services/routeService';
import type { SavedRoute, SavedRouteStop } from '../services/routeService';
import { listCrews, type Crew } from '../services/crewService';
import type { Depot } from '@shared/settings';
import { RouteListPanel, RouteDetailTimeline } from '../components/planner';
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

  // --- Map ---
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  const [highlightedStopId, setHighlightedStopId] = useState<string | null>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segmentClickHandlerRef = useRef<((e: any) => void) | null>(null);
  const segmentEnterHandlerRef = useRef<(() => void) | null>(null);
  const segmentLeaveHandlerRef = useRef<(() => void) | null>(null);

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
        const currentStillExists = selectedRouteId && response.routes.some((r) => r.id === selectedRouteId);
        if (!currentStillExists) {
          setSelectedRouteId(response.routes[0].id);
        }
      } else {
        setSelectedRouteId(null);
        setSelectedRouteStops([]);
      }
    } catch (err) {
      console.error('Failed to load routes:', err);
      setError('Nepodařilo se načíst cesty');
      setRoutes([]);
    } finally {
      setIsLoadingRoutes(false);
    }
  }, [isConnected, dateFrom, dateTo, isDateRange, filterCrewId, filterDepotId, selectedRouteId]);

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

    const selectedRoute = routes.find((r) => r.id === selectedRouteId);
    if (!selectedRoute) return;

    async function loadStops() {
      setIsLoadingStops(true);
      try {
        const result = await routeService.getRoute(selectedRoute!.date);
        // The getRoute endpoint returns stops for user's route on that date.
        // If multiple routes exist for the date, we need stops for the specific route.
        // For now, use the stops returned.
        setSelectedRouteStops(result.stops);
      } catch (err) {
        console.error('Failed to load route stops:', err);
        setSelectedRouteStops([]);
      } finally {
        setIsLoadingStops(false);
      }
    }
    loadStops();
  }, [selectedRouteId, routes, isConnected]);

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

  // ─── Map: initialize ─────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainer.current || map.current || !depot) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [depot.lng, depot.lat],
      zoom: 11,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    depotMarkerRef.current = new maplibregl.Marker({ color: '#22c55e' })
      .setLngLat([depot.lng, depot.lat])
      .setPopup(new maplibregl.Popup().setHTML(`<strong>Depo</strong><br/>${depot.name || 'Výchozí místo'}`))
      .addTo(map.current);

    return () => {
      map.current?.remove();
      map.current = null;
      depotMarkerRef.current = null;
    };
  }, [depot]);

  // ─── Map: clear markers & route lines ─────────────────────────────

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (map.current) {
      if (segmentClickHandlerRef.current) {
        map.current.off('click', 'route-hit-area', segmentClickHandlerRef.current);
        segmentClickHandlerRef.current = null;
      }
      if (segmentEnterHandlerRef.current) {
        map.current.off('mouseenter', 'route-hit-area', segmentEnterHandlerRef.current);
        segmentEnterHandlerRef.current = null;
      }
      if (segmentLeaveHandlerRef.current) {
        map.current.off('mouseleave', 'route-hit-area', segmentLeaveHandlerRef.current);
        segmentLeaveHandlerRef.current = null;
      }

      for (const layerId of ['route-highlight', 'route-hit-area', 'route-line']) {
        if (map.current.getLayer(layerId)) map.current.removeLayer(layerId);
      }
      if (map.current.getSource('route-segments')) {
        map.current.removeSource('route-segments');
      }
    }
    setHighlightedSegment(null);
  }, []);

  // ─── Map: draw route stops ───────────────────────────────────────

  const drawRouteOnMap = useCallback((stops: SavedRouteStop[]) => {
    if (!map.current || !depot) return;
    clearMarkers();

    if (stops.length === 0) return;

    // Add markers
    stops.forEach((stop, index) => {
      if (!stop.customerLat || !stop.customerLng) return;

      const marker = new maplibregl.Marker({ color: '#3b82f6' })
        .setLngLat([stop.customerLng, stop.customerLat])
        .setPopup(
          new maplibregl.Popup().setHTML(`
            <strong>${index + 1}. ${stop.customerName}</strong><br/>
            ${stop.address}<br/>
            <small>ETA: ${stop.estimatedArrival?.substring(0, 5) || '--:--'} | ETD: ${stop.estimatedDeparture?.substring(0, 5) || '--:--'}</small>
          `)
        )
        .addTo(map.current!);

      const el = marker.getElement();
      const label = document.createElement('div');
      label.className = styles.markerLabel;
      label.textContent = String(index + 1);
      el.appendChild(label);

      markersRef.current.push(marker);
    });

    // Draw route segments
    const waypoints = stops
      .filter((s) => s.customerLat && s.customerLng)
      .map((s) => ({
        coordinates: { lat: s.customerLat!, lng: s.customerLng! },
        name: s.customerName,
      }));

    if (waypoints.length === 0) return;

    const segments = buildStraightLineSegments(waypoints, depot);

    const features = segments.map((coords, index) => ({
      type: 'Feature' as const,
      properties: { segmentIndex: index },
      geometry: { type: 'LineString' as const, coordinates: coords },
    }));

    map.current.addSource('route-segments', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    map.current.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route-segments',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#3b82f6', 'line-width': 4, 'line-opacity': 0.8 },
    });

    map.current.addLayer({
      id: 'route-hit-area',
      type: 'line',
      source: 'route-segments',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': 'transparent', 'line-width': 20, 'line-opacity': 0 },
    });

    map.current.addLayer({
      id: 'route-highlight',
      type: 'line',
      source: 'route-segments',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#f59e0b', 'line-width': 6, 'line-opacity': 0.9 },
      filter: ['==', ['get', 'segmentIndex'], -1],
    });

    // Click handler
    segmentClickHandlerRef.current = (e) => {
      const feat = e.features;
      if (feat && feat.length > 0) {
        const clickedIndex = feat[0].properties?.segmentIndex;
        if (typeof clickedIndex === 'number') {
          setHighlightedSegment((prev) => (prev === clickedIndex ? null : clickedIndex));
        }
      }
    };
    map.current.on('click', 'route-hit-area', segmentClickHandlerRef.current);

    segmentEnterHandlerRef.current = () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    };
    segmentLeaveHandlerRef.current = () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    };
    map.current.on('mouseenter', 'route-hit-area', segmentEnterHandlerRef.current);
    map.current.on('mouseleave', 'route-hit-area', segmentLeaveHandlerRef.current);

    // Fit bounds
    const allCoords = segments.flat();
    const bounds = new maplibregl.LngLatBounds();
    allCoords.forEach((coord) => bounds.extend(coord));
    map.current.fitBounds(bounds, { padding: 50 });
  }, [clearMarkers, depot]);

  // ─── Redraw map when stops change ────────────────────────────────

  useEffect(() => {
    drawRouteOnMap(selectedRouteStops);
  }, [selectedRouteStops, drawRouteOnMap]);

  // ─── Update highlight layer ──────────────────────────────────────

  useEffect(() => {
    if (!map.current || !map.current.getLayer('route-highlight')) return;
    if (highlightedSegment !== null) {
      map.current.setFilter('route-highlight', ['==', ['get', 'segmentIndex'], highlightedSegment]);
    } else {
      map.current.setFilter('route-highlight', ['==', ['get', 'segmentIndex'], -1]);
    }
  }, [highlightedSegment]);

  // ─── Fly to stop on map ──────────────────────────────────────────

  const handleStopClick = useCallback((customerId: string, _index: number) => {
    setHighlightedStopId(customerId);
    const stop = selectedRouteStops.find((s) => s.customerId === customerId);
    if (stop?.customerLat && stop?.customerLng && map.current) {
      map.current.flyTo({ center: [stop.customerLng, stop.customerLat], zoom: 14, duration: 800 });
    }
  }, [selectedRouteStops]);

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
        <div className={styles.filtersSection}>
          <div className={styles.filterRow}>
            <div className={styles.dateFilter}>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => handleDateFromChange(e.target.value)}
                className={styles.dateInput}
              />
              {isDateRange && (
                <>
                  <span className={styles.dateSeparator}>–</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => handleDateToChange(e.target.value)}
                    className={styles.dateInput}
                  />
                </>
              )}
              <button
                type="button"
                className={`${styles.rangeToggle} ${isDateRange ? styles.rangeToggleActive : ''}`}
                onClick={handleToggleRange}
                title={isDateRange ? 'Jeden den' : 'Rozsah'}
              >
                {isDateRange ? '1' : '...'}
              </button>
            </div>
          </div>

          <div className={styles.filterRow}>
            <select
              value={filterCrewId}
              onChange={(e) => handleCrewFilterChange(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="">Posádka: Vše</option>
              {crews.map((crew) => (
                <option key={crew.id} value={crew.id}>{crew.name}</option>
              ))}
            </select>

            <select
              value={filterDepotId}
              onChange={(e) => handleDepotFilterChange(e.target.value)}
              className={styles.filterSelect}
            >
              <option value="">Depo: Vše</option>
              {depots.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>

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
                route={selectedRoute}
                stops={selectedRouteStops}
                depot={selectedRouteDepot}
                selectedStopId={highlightedStopId}
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
        <div ref={mapContainer} className={styles.map} />
      </div>
    </div>
  );
}
