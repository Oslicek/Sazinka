import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Link, useSearch, useNavigate } from '@tanstack/react-router';
import maplibregl from 'maplibre-gl';
import { useNatsStore } from '../stores/natsStore';
import { useAutoSave } from '../hooks/useAutoSave';
import type { PlannedRouteStop } from '@shared/route';
import {
  splitGeometryIntoSegments,
  buildStraightLineSegments,
  getSegmentLabel,
} from '../utils/routeGeometry';
import * as settingsService from '../services/settingsService';
import { 
  listRevisions, 
  completeRevision, 
  getCallQueue,
  type Revision, 
  type CompleteRevisionRequest,
  type CallQueueItem,
} from '../services/revisionService';
import * as routeService from '../services/routeService';
import { listCrews, type Crew } from '../services/crewService';
import type { RouteJobStatusUpdate } from '../services/routeService';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableStopItem, DraftModeBar, AddFromInboxDrawer } from '../components/planner';
import type { InboxCandidate } from '../types';
import type { SlotSuggestion } from '../components/planner/SlotSuggestions';
import { getToken } from '@/utils/auth';
import styles from './Planner.module.css';

// Default depot location (Prague center) - fallback if no depot configured
const DEFAULT_DEPOT = { lat: 50.0755, lng: 14.4378 };

// Search params interface for URL sync
interface PlannerSearchParams {
  date?: string;
  crew?: string;
  highlight?: string;
}

// Extended stop with revision details
interface StopWithRevision extends Revision {
  order?: number;
  eta?: string;
  etd?: string;
}

export function Planner() {
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as PlannerSearchParams;
  
  // Initialize date from URL or default to today
  const today = new Date().toISOString().split('T')[0];
  const initialDate = searchParams?.date || today;
  
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  // Store map event handler refs so we can remove them on cleanup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const segmentClickHandlerRef = useRef<((e: any) => void) | null>(null);
  const segmentEnterHandlerRef = useRef<(() => void) | null>(null);
  const segmentLeaveHandlerRef = useRef<(() => void) | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stops, setStops] = useState<PlannedRouteStop[]>([]);
  const [scheduledRevisions, setScheduledRevisions] = useState<StopWithRevision[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [optimizationScore, setOptimizationScore] = useState(0);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [routeWarnings, setRouteWarnings] = useState<string[]>([]);
  // These values are set when optimizing but currently not displayed in UI
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_algorithmName, setAlgorithmName] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_solveTimeMs, setSolveTimeMs] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  
  // Segment highlight state (index of highlighted segment, or null)
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  
  // Depot state
  const [depot, setDepot] = useState<{ lat: number; lng: number; name?: string } | null>(null);
  const [depotLoading, setDepotLoading] = useState(true);
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  
  // Crew state
  const [crews, setCrews] = useState<Crew[]>([]);
  const [crewsLoading, setCrewsLoading] = useState(true);
  const [selectedCrew, setSelectedCrew] = useState<string>(searchParams?.crew || '');
  
  // Scheduled revisions loading
  const [scheduledLoading, setScheduledLoading] = useState(false);
  
  // Call queue preview
  const [queuePreview, setQueuePreview] = useState<CallQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  
  // Drag/drop state
  const [lockedStops, setLockedStops] = useState<Set<string>>(new Set());
  const [isManuallyReordered, setIsManuallyReordered] = useState(false);
  
  // Route persistence state (auto-save)
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [hasSavedRoute, setHasSavedRoute] = useState(false);
  
  const autoSaveFn = useCallback(async () => {
    if (stops.length === 0) return;
    const saveStops = stops.map((stop) => routeService.toSaveRouteStop(stop));
    await routeService.saveRoute({
      date: selectedDate,
      stops: saveStops,
      totalDistanceKm: totalDistance,
      totalDurationMinutes: totalDuration,
      optimizationScore: optimizationScore,
    });
    setHasSavedRoute(true);
    setIsManuallyReordered(false);
  }, [stops, selectedDate, totalDistance, totalDuration, optimizationScore]);

  const { isSaving, lastSaved, saveError, retry: retrySave } = useAutoSave({
    saveFn: autoSaveFn,
    hasChanges: isManuallyReordered && stops.length > 0,
    debounceMs: 1500,
    enabled: stops.length > 0,
  });

  // Route job state (async optimization)
  const [routeJob, setRouteJob] = useState<RouteJobStatusUpdate | null>(null);
  const routeJobUnsubscribeRef = useRef<(() => void) | null>(null);
  
  // Add from inbox drawer
  const [showInboxDrawer, setShowInboxDrawer] = useState(false);
  const [inboxCandidates, setInboxCandidates] = useState<InboxCandidate[]>([]);
  const [loadingInboxCandidates, setLoadingInboxCandidates] = useState(false);

  const { isConnected } = useNatsStore();
  
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  // Sync date with URL
  const handleDateChange = useCallback((newDate: string) => {
    setSelectedDate(newDate);
    // Update URL without full navigation
    navigate({ 
      to: '/planner',
      search: { date: newDate, crew: selectedCrew || undefined } as Record<string, string | undefined>,
      replace: true,
    });
  }, [navigate, selectedCrew]);

  // Sync crew with URL
  const handleCrewChange = useCallback((crewId: string) => {
    setSelectedCrew(crewId);
    navigate({ 
      to: '/planner',
      search: { date: selectedDate, crew: crewId } as Record<string, string | undefined>,
      replace: true,
    });
  }, [navigate, selectedDate]);

  // Update date when URL changes (e.g., from RevisionDetail "Open in planner" link)
  useEffect(() => {
    if (searchParams?.date && searchParams.date !== selectedDate) {
      setSelectedDate(searchParams.date);
    }
  }, [searchParams?.date, selectedDate]);

  // Update crew when URL changes
  useEffect(() => {
    if (searchParams?.crew && searchParams.crew !== selectedCrew) {
      setSelectedCrew(searchParams.crew);
    }
  }, [searchParams?.crew, selectedCrew]);

  // Load crews
  useEffect(() => {
    if (!isConnected) return;
    
    async function loadCrewsAsync() {
      try {
        setCrewsLoading(true);
        const crewList = await listCrews(true);
        setCrews(crewList);
        
        // Auto-select first crew if none selected
        if (!selectedCrew && crewList.length > 0) {
          const firstCrewId = crewList[0].id;
          setSelectedCrew(firstCrewId);
          navigate({ 
            to: '/planner',
            search: { date: selectedDate, crew: firstCrewId } as Record<string, string | undefined>,
            replace: true,
          });
        }
      } catch (err) {
        console.warn('Failed to load crews:', err);
        setCrews([]);
      } finally {
        setCrewsLoading(false);
      }
    }
    loadCrewsAsync();
  }, [isConnected, selectedCrew, navigate, selectedDate]);

  // Load user's primary depot from settings
  useEffect(() => {
    if (!isConnected) return;
    
    async function loadDepot() {
      try {
        const settings = await settingsService.getSettings();
        const primaryDepot = settings.depots.find(d => d.isPrimary) || settings.depots[0];
        if (primaryDepot) {
          setDepot({ lat: primaryDepot.lat, lng: primaryDepot.lng, name: primaryDepot.name });
        } else {
          setDepot(DEFAULT_DEPOT);
        }
      } catch (err) {
        console.warn('Failed to load depot, using default:', err);
        setDepot(DEFAULT_DEPOT);
      } finally {
        setDepotLoading(false);
      }
    }
    loadDepot();
  }, [isConnected]);

  // Load scheduled revisions when date changes
  const loadScheduledRevisions = useCallback(async () => {
    if (!isConnected) return;
    
    setScheduledLoading(true);
    try {
      const response = await listRevisions({
        fromDate: selectedDate,
        toDate: selectedDate,
        dateType: 'scheduled',
        limit: 50,
      });
      
      // Sort by scheduled time
      const sorted = response.items.sort((a, b) => {
        if (!a.scheduledTimeStart && !b.scheduledTimeStart) return 0;
        if (!a.scheduledTimeStart) return 1;
        if (!b.scheduledTimeStart) return -1;
        return a.scheduledTimeStart.localeCompare(b.scheduledTimeStart);
      });
      
      setScheduledRevisions(sorted);
    } catch (err) {
      console.error('Failed to load scheduled revisions:', err);
      setScheduledRevisions([]);
    } finally {
      setScheduledLoading(false);
    }
  }, [isConnected, selectedDate]);

  useEffect(() => {
    loadScheduledRevisions();
  }, [loadScheduledRevisions]);

  // Load call queue preview (only customers with valid coordinates)
  const loadQueuePreview = useCallback(async () => {
    if (!isConnected) return;
    
    setQueueLoading(true);
    try {
      const response = await getCallQueue({ 
        priorityFilter: 'all', 
        geocodedOnly: true,  // Only show customers with valid coordinates
        limit: 5 
      });
      setQueuePreview(response.items);
    } catch (err) {
      console.error('Failed to load queue preview:', err);
      setQueuePreview([]);
    } finally {
      setQueueLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    loadQueuePreview();
  }, [loadQueuePreview]);

  // Initialize map only after depot is loaded
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
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: [depot.lng, depot.lat],
      zoom: 11,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add depot marker
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

  // splitGeometryIntoSegments, buildStraightLineSegments, getSegmentLabel
  // are imported from '../utils/routeGeometry' (shared with RouteMapPanel)

  // Clear markers helper
  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    
    if (map.current) {
      // Remove event handlers before removing layers
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

      // Remove route layers and sources
      for (const layerId of ['route-highlight', 'route-hit-area', 'route-line']) {
        if (map.current.getLayer(layerId)) {
          map.current.removeLayer(layerId);
        }
      }
      if (map.current.getSource('route-segments')) {
        map.current.removeSource('route-segments');
      }
    }
    setHighlightedSegment(null);
  }, []);

  // getSegmentLabel is imported from shared utility

  // Add markers for stops
  const addStopMarkers = useCallback((plannedStops: PlannedRouteStop[], geometry: [number, number][] = []) => {
    if (!map.current) return;

    clearMarkers();

    plannedStops.forEach((stop, index) => {
      const marker = new maplibregl.Marker({ 
        color: '#3b82f6',
      })
        .setLngLat([stop.coordinates.lng, stop.coordinates.lat])
        .setPopup(
          new maplibregl.Popup().setHTML(`
            <strong>${index + 1}. ${stop.customerName}</strong><br/>
            ${stop.address}<br/>
            <small>ETA: ${stop.eta} | ETD: ${stop.etd}</small>
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

    // Draw route as segmented lines
    if (plannedStops.length > 0 && depot) {
      let segments: [number, number][][];

      const waypoints = plannedStops.map(s => ({
        coordinates: s.coordinates,
        name: s.customerName,
      }));

      if (geometry.length > 0) {
        segments = splitGeometryIntoSegments(geometry, waypoints, depot);
      } else {
        segments = buildStraightLineSegments(waypoints, depot);
      }

      // Build GeoJSON FeatureCollection with each segment as a Feature
      const features = segments.map((coords, index) => ({
        type: 'Feature' as const,
        properties: { segmentIndex: index },
        geometry: {
          type: 'LineString' as const,
          coordinates: coords,
        },
      }));

      map.current.addSource('route-segments', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features,
        },
      });

      // Base route line (all segments)
      map.current.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-segments',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#3b82f6',
          'line-width': 4,
          'line-opacity': 0.8,
        },
      });

      // Wider invisible hit area for easier clicking
      map.current.addLayer({
        id: 'route-hit-area',
        type: 'line',
        source: 'route-segments',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': 'transparent',
          'line-width': 20,
          'line-opacity': 0,
        },
      });

      // Highlight layer (only shows the selected segment)
      map.current.addLayer({
        id: 'route-highlight',
        type: 'line',
        source: 'route-segments',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#f59e0b',
          'line-width': 6,
          'line-opacity': 0.9,
        },
        // Initially hide all segments (no segment selected)
        filter: ['==', ['get', 'segmentIndex'], -1],
      });

      // Click handler: toggle segment highlight
      segmentClickHandlerRef.current = (e) => {
        const feat = e.features;
        if (feat && feat.length > 0) {
          const clickedIndex = feat[0].properties?.segmentIndex;
          if (typeof clickedIndex === 'number') {
            setHighlightedSegment(prev => prev === clickedIndex ? null : clickedIndex);
          }
        }
      };
      map.current.on('click', 'route-hit-area', segmentClickHandlerRef.current);

      // Cursor pointer on hover
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
      allCoords.forEach(coord => bounds.extend(coord));
      map.current.fitBounds(bounds, { padding: 50 });
    }
  }, [clearMarkers, depot]);

  // Update highlight layer filter when selected segment changes
  useEffect(() => {
    if (!map.current) return;
    if (!map.current.getLayer('route-highlight')) return;

    if (highlightedSegment !== null) {
      map.current.setFilter('route-highlight', ['==', ['get', 'segmentIndex'], highlightedSegment]);
    } else {
      map.current.setFilter('route-highlight', ['==', ['get', 'segmentIndex'], -1]);
    }
  }, [highlightedSegment]);

  // Optimize route with VRP solver (async via job queue)
  const handleOptimizeRoute = async () => {
    if (!isConnected) {
      setError('Není připojeno k serveru');
      return;
    }

    if (!depot) {
      setError('Depo není načteno');
      return;
    }

    if (scheduledRevisions.length === 0) {
      setError('Žádné revize k optimalizaci');
      return;
    }

    setIsLoading(true);
    setError(null);
    setRouteJob(null);

    try {
      const customerIds = [...new Set(scheduledRevisions.map(r => r.customerId))];
      
      // Submit job to queue
      const jobResponse = await routeService.submitRoutePlanJob({
        customerIds,
        date: selectedDate,
        startLocation: { lat: depot.lat, lng: depot.lng },
      });
      
      // Set initial queued status
      setRouteJob({
        jobId: jobResponse.jobId,
        timestamp: new Date().toISOString(),
        status: { 
          type: 'queued', 
          position: jobResponse.position,
          estimatedWaitSeconds: jobResponse.estimatedWaitSeconds,
        },
      });
      
      // Cleanup previous subscription
      if (routeJobUnsubscribeRef.current) {
        routeJobUnsubscribeRef.current();
      }
      
      // Subscribe to status updates
      const unsubscribe = await routeService.subscribeToRouteJobStatus(
        jobResponse.jobId,
        (update) => {
          setRouteJob(update);
          
          // Handle completion
          if (update.status.type === 'completed') {
            const result = update.status.result;
            const geometry = result.geometry || [];
            
            setStops(result.stops);
            setTotalDistance(result.totalDistanceKm);
            setTotalDuration(result.totalDurationMinutes);
            setOptimizationScore(result.optimizationScore);
            setAlgorithmName(result.algorithm);
            setSolveTimeMs(result.solveTimeMs);
            setRouteWarnings(result.warnings.map((w: { message: string }) => w.message));
            setRouteGeometry(geometry);
            setIsManuallyReordered(false);
            
            addStopMarkers(result.stops, geometry);
            setIsLoading(false);
            
            // Cleanup subscription
            if (routeJobUnsubscribeRef.current) {
              routeJobUnsubscribeRef.current();
              routeJobUnsubscribeRef.current = null;
            }
          }
          
          // Handle failure
          if (update.status.type === 'failed') {
            setError(update.status.error);
            setIsLoading(false);
            
            // Cleanup subscription
            if (routeJobUnsubscribeRef.current) {
              routeJobUnsubscribeRef.current();
              routeJobUnsubscribeRef.current = null;
            }
          }
        }
      );
      
      routeJobUnsubscribeRef.current = unsubscribe;
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
      setIsLoading(false);
    }
  };
  
  // Cleanup route job subscription on unmount
  useEffect(() => {
    return () => {
      if (routeJobUnsubscribeRef.current) {
        routeJobUnsubscribeRef.current();
      }
    };
  }, []);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isManuallyReordered && stops.length > 0) {
        e.preventDefault();
        e.returnValue = 'Máte neuložené změny. Opravdu chcete odejít?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isManuallyReordered, stops.length]);

  // Load inbox candidates for add from inbox drawer
  const loadInboxCandidates = useCallback(async () => {
    if (!isConnected) return;

    setLoadingInboxCandidates(true);
    try {
      const response = await getCallQueue({
        priorityFilter: 'all',
        geocodedOnly: true,
        limit: 20,
      });
      // Map CallQueueItem to InboxCandidate
      const candidates: InboxCandidate[] = response.items.map((item) => ({
        id: item.id,
        customerId: item.customerId,
        customerName: item.customerName,
        deviceId: item.deviceId || '',
        deviceName: item.deviceName || '',
        deviceType: item.deviceType || '',
        dueDate: item.dueDate,
        priority: item.priority,
        lat: item.customerLat!,
        lng: item.customerLng!,
        status: 'upcoming',
        snoozedUntil: null,
      }));
      setInboxCandidates(candidates);
    } catch (err) {
      console.error('Failed to load inbox candidates:', err);
      setInboxCandidates([]);
    } finally {
      setLoadingInboxCandidates(false);
    }
  }, [isConnected]);

  // Open inbox drawer
  const handleOpenInboxDrawer = useCallback(() => {
    loadInboxCandidates();
    setShowInboxDrawer(true);
  }, [loadInboxCandidates]);

  // Add candidate to route (placeholder)
  const handleAddFromInbox = useCallback(async (candidateId: string, _slot: SlotSuggestion) => {
    console.log('Adding candidate to route:', candidateId, _slot);
    // TODO: Implement actual add to route logic
    // This would insert the candidate at the optimal position in the stops array
    setShowInboxDrawer(false);
    loadScheduledRevisions();
  }, [loadScheduledRevisions]);

  // Mark revision as done
  const handleMarkDone = useCallback(async (revisionId: string) => {
    const result = prompt('Výsledek revize (passed/conditional/failed):', 'passed');
    if (!result) return;

    const validResults = ['passed', 'conditional', 'failed'];
    const normalizedResult = result.toLowerCase();
    const finalResult = validResults.includes(normalizedResult) 
      ? normalizedResult as 'passed' | 'conditional' | 'failed'
      : 'passed';

    try {
      const data: CompleteRevisionRequest = {
        id: revisionId,
        result: finalResult,
      };
      await completeRevision(data);
      loadScheduledRevisions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se dokončit revizi');
    }
  }, [loadScheduledRevisions]);

  // Navigation helpers
  const openNavigation = useCallback((address: string) => {
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`, '_blank');
  }, []);

  const callCustomer = useCallback((phone: string) => {
    window.location.href = `tel:${phone}`;
  }, []);

  // Google Maps export - single route
  const generateGoogleMapsRoute = useCallback(() => {
    const stopsToExport = stops.length > 0 ? stops : scheduledRevisions;
    if (stopsToExport.length === 0) return;
    
    const maxWaypoints = 9;
    const waypoints = stopsToExport.slice(0, maxWaypoints).map(stop => {
      const address = 'address' in stop 
        ? stop.address 
        : `${stop.customerStreet || ''}, ${stop.customerCity || ''} ${stop.customerPostalCode || ''}`.trim();
      return encodeURIComponent(address);
    });
    
    if (waypoints.length === 0) return;
    
    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const waypointsParam = waypoints.length > 2 
      ? waypoints.slice(1, -1).join('|') 
      : '';
    
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    if (waypointsParam) {
      url += `&waypoints=${waypointsParam}`;
    }
    url += '&travelmode=driving';
    
    window.open(url, '_blank');
  }, [stops, scheduledRevisions]);

  // Google Maps export - segmented routes
  const generateSegmentedRoutes = useMemo(() => {
    const stopsToExport = stops.length > 0 ? stops : scheduledRevisions;
    if (stopsToExport.length === 0) return [];
    
    const segmentSize = 8;
    const segments: { name: string; url: string }[] = [];
    
    for (let i = 0; i < stopsToExport.length; i += segmentSize) {
      const segment = stopsToExport.slice(i, i + segmentSize);
      const waypoints = segment.map(stop => {
        const address = 'address' in stop 
          ? stop.address 
          : `${stop.customerStreet || ''}, ${stop.customerCity || ''} ${stop.customerPostalCode || ''}`.trim();
        return encodeURIComponent(address);
      });
      
      if (waypoints.length === 0) continue;
      
      const origin = waypoints[0];
      const destination = waypoints[waypoints.length - 1];
      const waypointsParam = waypoints.length > 2 
        ? waypoints.slice(1, -1).join('|') 
        : '';
      
      let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
      if (waypointsParam) {
        url += `&waypoints=${waypointsParam}`;
      }
      url += '&travelmode=driving';
      
      const segmentNumber = Math.floor(i / segmentSize) + 1;
      const totalSegments = Math.ceil(stopsToExport.length / segmentSize);
      segments.push({
        name: `Trasa ${segmentNumber}/${totalSegments}`,
        url,
      });
    }
    
    return segments;
  }, [stops, scheduledRevisions]);

  // Print day plan
  const printDayPlan = useCallback(() => {
    const stopsToExport = stops.length > 0 ? stops : scheduledRevisions;
    if (stopsToExport.length === 0) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      const days = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
      const dayName = days[date.getDay()];
      return `${dayName} ${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
    };

    const formatTime = (time: string | undefined) => {
      if (!time) return '-';
      return time.substring(0, 5);
    };

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Plán dne - ${formatDate(selectedDate)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h1 { font-size: 18px; margin-bottom: 5px; }
          .date { color: #666; margin-bottom: 20px; }
          .stats { margin-bottom: 15px; font-size: 12px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
          th { background: #f5f5f5; }
          .time { white-space: nowrap; }
          .phone { white-space: nowrap; }
          @media print {
            body { padding: 0; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <h1>Plán dne</h1>
        <div class="date">${formatDate(selectedDate)}</div>
        ${totalDistance > 0 ? `<div class="stats">Vzdálenost: ${totalDistance.toFixed(1)} km | Čas: ${Math.round(totalDuration)} min</div>` : ''}
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th class="time">Čas</th>
              <th>Zákazník</th>
              <th>Adresa</th>
              <th class="phone">Telefon</th>
              <th>Zařízení</th>
            </tr>
          </thead>
          <tbody>
            ${stopsToExport.map((stop, index) => {
              const isPlannedStop = 'address' in stop;
              return `
                <tr>
                  <td>${index + 1}</td>
                  <td class="time">${isPlannedStop ? `${stop.eta} - ${stop.etd}` : formatTime(stop.scheduledTimeStart ?? undefined)}</td>
                  <td>${isPlannedStop ? stop.customerName : (stop.customerName || '-')}</td>
                  <td>${isPlannedStop ? stop.address : `${stop.customerStreet || ''}${stop.customerCity ? `, ${stop.customerCity}` : ''}${stop.customerPostalCode ? ` ${stop.customerPostalCode}` : ''}`}</td>
                  <td class="phone">${isPlannedStop ? '-' : (stop.customerPhone || '-')}</td>
                  <td>${isPlannedStop ? '-' : (stop.deviceType || '-')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  }, [stops, scheduledRevisions, selectedDate, totalDistance, totalDuration]);

  // Clear route
  const handleClearRoute = useCallback(() => {
    clearMarkers();
    setStops([]);
    setTotalDistance(0);
    setTotalDuration(0);
    setOptimizationScore(0);
    setAlgorithmName('');
    setSolveTimeMs(0);
    setRouteWarnings([]);
    setRouteGeometry([]);
    setError(null);
    setLockedStops(new Set());
    setIsManuallyReordered(false);
  }, [clearMarkers]);

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setStops((items) => {
        const oldIndex = items.findIndex((item) => item.customerId === active.id);
        const newIndex = items.findIndex((item) => item.customerId === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
      setIsManuallyReordered(true);
    }
  }, []);

  // Toggle lock on a stop
  const handleLockToggle = useCallback((customerId: string) => {
    setLockedStops((prev) => {
      const next = new Set(prev);
      if (next.has(customerId)) {
        next.delete(customerId);
      } else {
        next.add(customerId);
      }
      return next;
    });
  }, []);

  // Check if a saved route exists for the selected date
  const checkSavedRoute = useCallback(async () => {
    if (!isConnected) return;
    try {
      const result = await routeService.getRoute(selectedDate);
      setHasSavedRoute(result.route !== null);
    } catch (e) {
      setHasSavedRoute(false);
    }
  }, [selectedDate, isConnected]);

  useEffect(() => {
    checkSavedRoute();
  }, [checkSavedRoute]);

  // Save the current route manually (triggers auto-save)
  const handleSaveRoute = useCallback(async () => {
    if (stops.length === 0) return;
    
    try {
      await autoSaveFn();
      setHasSavedRoute(true);
    } catch (e) {
      console.error('Failed to save route:', e);
      setError('Nepodařilo se uložit trasu');
    }
  }, [autoSaveFn]);

  // Discard changes and reload saved route
  const handleDiscardChanges = useCallback(async () => {
    if (!confirm('Zahodit neuložené změny?')) return;
    
    try {
      const result = await routeService.getRoute(selectedDate);
      
      if (result.route && result.stops.length > 0) {
        const loadedStops = result.stops.map(routeService.toPlannedRouteStop);
        
        setStops(loadedStops);
        setTotalDistance(result.route.totalDistanceKm ?? 0);
        setTotalDuration(result.route.totalDurationMinutes ?? 0);
        setOptimizationScore(result.route.optimizationScore ?? 0);
        setIsManuallyReordered(false);
        setLockedStops(new Set());
        
        addStopMarkers(loadedStops, []);
      } else {
        // No saved route, just clear
        handleClearRoute();
      }
    } catch (e) {
      console.error('Failed to discard changes:', e);
      setError('Nepodařilo se načíst uloženou trasu');
    }
  }, [selectedDate, addStopMarkers, handleClearRoute]);

  // Load a saved route
  const handleLoadRoute = useCallback(async () => {
    setIsLoadingSaved(true);
    try {
      const result = await routeService.getRoute(selectedDate);
      
      if (result.route && result.stops.length > 0) {
        const loadedStops = result.stops.map(routeService.toPlannedRouteStop);
        
        setStops(loadedStops);
        setTotalDistance(result.route.totalDistanceKm ?? 0);
        setTotalDuration(result.route.totalDurationMinutes ?? 0);
        setOptimizationScore(result.route.optimizationScore ?? 0);
        setAlgorithmName('Uložená trasa');
        setIsManuallyReordered(false);
        setLockedStops(new Set());
        
        addStopMarkers(loadedStops, []);
      } else {
        setError('Pro tento den není uložena žádná trasa');
      }
    } catch (e) {
      console.error('Failed to load route:', e);
      setError('Nepodařilo se načíst trasu');
    } finally {
      setIsLoadingSaved(false);
    }
  }, [selectedDate, addStopMarkers]);

  // Format helpers
  const formatDuration = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours} h`;
    return `${hours} h ${mins} min`;
  };

  const formatTime = (time: string | undefined) => {
    if (!time) return '-';
    return time.substring(0, 5);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const days = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
    const dayName = days[date.getDay()];
    return `${dayName} ${date.getDate()}. ${date.getMonth() + 1}. ${date.getFullYear()}`;
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'completed': return styles.statusCompleted;
      case 'confirmed': return styles.statusConfirmed;
      case 'scheduled': return styles.statusScheduled;
      default: return '';
    }
  };

  const getStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      upcoming: 'Čeká',
      scheduled: 'Naplánováno',
      confirmed: 'Potvrzeno',
      completed: 'Hotovo',
      cancelled: 'Zrušeno',
    };
    return labels[status] || status;
  };

  const getPriorityLabel = (priority: string): string => {
    const labels: Record<string, string> = {
      overdue: 'Po termínu',
      due_this_week: 'Tento týden',
      due_soon: 'Brzy',
      upcoming: 'Plánovaná',
    };
    return labels[priority] || priority;
  };

  // Progress tracking
  const completedCount = scheduledRevisions.filter(r => r.status === 'completed').length;
  const hasStopsOrRevisions = stops.length > 0 || scheduledRevisions.length > 0;

  return (
    <div className={styles.planner}>
      <div className={styles.sidebar}>
        {/* Header */}
        <div className={styles.header}>
          <h2>Plán dne</h2>
          <div className={styles.headerControls}>
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className={styles.dateInput}
            />
            <select
              value={selectedCrew}
              onChange={(e) => handleCrewChange(e.target.value)}
              className={styles.crewSelect}
              disabled={crewsLoading}
            >
              {crewsLoading ? (
                <option value="">Načítám...</option>
              ) : crews.length === 0 ? (
                <option value="">Žádné posádky</option>
              ) : (
                crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Date info and progress */}
        <div className={styles.dateInfo}>
          <span className={styles.dateLabel}>{formatDate(selectedDate)}</span>
          {scheduledRevisions.length > 0 && (
            <span className={styles.progress}>
              {completedCount}/{scheduledRevisions.length} hotovo
            </span>
          )}
        </div>

        {/* Depot info */}
        <div className={styles.depotInfo}>
          <span className={styles.depotLabel}>Depo:</span>
          <span className={styles.depotName}>
            {depotLoading ? 'Načítám...' : (depot?.name || 'Praha (výchozí)')}
          </span>
        </div>

        {/* Draft mode banner */}
        <DraftModeBar
          hasChanges={isManuallyReordered && stops.length > 0}
          isSaving={isSaving}
          lastSaved={lastSaved}
          onSave={handleSaveRoute}
          onDiscard={handleDiscardChanges}
        />

        {/* Export buttons */}
        {hasStopsOrRevisions && (
          <div className={styles.exportSection}>
            {generateSegmentedRoutes.length <= 1 ? (
              <button 
                className={styles.exportButton}
                onClick={generateGoogleMapsRoute}
              >
                🗺️ Google Maps
              </button>
            ) : (
              <div className={styles.segmentButtons}>
                <span className={styles.segmentLabel}>Navigace:</span>
                {generateSegmentedRoutes.map((segment, index) => (
                  <button
                    key={index}
                    className={styles.segmentButton}
                    onClick={() => window.open(segment.url, '_blank')}
                  >
                    {segment.name}
                  </button>
                ))}
              </div>
            )}
            <button 
              className={styles.printButton}
              onClick={printDayPlan}
            >
              🖨️ Tisk
            </button>
          </div>
        )}

        {/* Statistics */}
        {(totalDistance > 0 || totalDuration > 0) && (
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Vzdálenost</span>
              <span className={styles.statValue}>{totalDistance.toFixed(1)} km</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Čas</span>
              <span className={styles.statValue}>{formatDuration(totalDuration)}</span>
            </div>
            {optimizationScore > 0 && (
              <div className={styles.stat}>
                <span className={styles.statLabel}>Skóre</span>
                <span className={styles.statValue}>{optimizationScore}%</span>
              </div>
            )}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className={styles.error}>
            {error}
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* Warnings */}
        {routeWarnings.length > 0 && (
          <div className={styles.warning}>
            {routeWarnings.map((warning, index) => (
              <div key={index}>{warning}</div>
            ))}
          </div>
        )}

        {/* Optimized stops with drag/drop */}
        {stops.length > 0 ? (
          <div className={styles.stopsSection}>
            <div className={styles.sectionHeader}>
              <h3>Optimalizovaná trasa ({stops.length})</h3>
              {isManuallyReordered && (
                <span className={styles.reorderedBadge}>Upraveno</span>
              )}
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={stops.map(s => s.customerId)}
                strategy={verticalListSortingStrategy}
              >
                <ul className={styles.stopList}>
                  {stops.map((stop, index) => (
                    <SortableStopItem
                      key={stop.customerId}
                      stop={stop}
                      index={index}
                      isLocked={lockedStops.has(stop.customerId)}
                      onLockToggle={handleLockToggle}
                      onNavigate={() => openNavigation(stop.address)}
                      onMarkDone={() => {
                        // Find revision ID by customer ID
                        const rev = scheduledRevisions.find(r => r.customerId === stop.customerId);
                        if (rev) handleMarkDone(rev.id);
                      }}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </div>
        ) : (
          /* Scheduled revisions list */
          <div className={styles.stopsSection}>
            <div className={styles.sectionHeader}>
              <h3>Naplánované návštěvy ({scheduledRevisions.length})</h3>
              <button 
                className={styles.refreshButton}
                onClick={loadScheduledRevisions}
                disabled={scheduledLoading}
                title="Obnovit"
              >
                ↻
              </button>
            </div>
            
            {scheduledLoading ? (
              <div className={styles.loading}>Načítám...</div>
            ) : scheduledRevisions.length === 0 ? (
              <div className={styles.empty}>
                Žádné naplánované návštěvy pro tento den.
              </div>
            ) : (
              <ul className={styles.revisionList}>
                {scheduledRevisions.map((revision, index) => (
                  <li 
                    key={revision.id} 
                    className={`${styles.revisionItem} ${getStatusClass(revision.status)}`}
                  >
                    <div className={styles.stopNumber}>{index + 1}</div>
                    
                    <div className={styles.revisionContent}>
                      <div className={styles.revisionHeader}>
                        <span className={styles.timeWindow}>
                          {formatTime(revision.scheduledTimeStart ?? undefined)}
                          {revision.scheduledTimeEnd && ` - ${formatTime(revision.scheduledTimeEnd ?? undefined)}`}
                        </span>
                        <span className={`${styles.statusBadge} ${getStatusClass(revision.status)}`}>
                          {getStatusLabel(revision.status)}
                        </span>
                      </div>
                      
                      <Link 
                        to="/revisions/$revisionId" 
                        params={{ revisionId: revision.id }} 
                        className={styles.customerLink}
                      >
                        <div className={styles.customerName}>
                          {revision.customerName || `Revize #${revision.id.substring(0, 8)}`}
                        </div>
                      </Link>
                      
                      <div className={styles.address}>
                        {revision.customerStreet || 'Adresa neuvedena'}
                        {revision.customerCity && `, ${revision.customerCity}`}
                        {revision.customerPostalCode && ` ${revision.customerPostalCode}`}
                      </div>
                      
                      {revision.deviceType && (
                        <div className={styles.device}>
                          {revision.deviceType} {revision.deviceName && `- ${revision.deviceName}`}
                        </div>
                      )}
                      
                      <div className={styles.revisionLinks}>
                        <Link 
                          to="/revisions/$revisionId" 
                          params={{ revisionId: revision.id }} 
                          className={styles.linkButton}
                        >
                          Detail
                        </Link>
                        <Link 
                          to="/customers/$customerId" 
                          params={{ customerId: revision.customerId }} 
                          className={styles.linkButton}
                        >
                          Zákazník
                        </Link>
                      </div>
                    </div>
                    
                    <div className={styles.revisionActions}>
                      <button
                        className={styles.actionButton}
                        onClick={() => openNavigation(
                          `${revision.customerStreet || ''}, ${revision.customerCity || ''} ${revision.customerPostalCode || ''}`.trim()
                        )}
                        title="Navigovat"
                      >
                        🧭
                      </button>
                      {revision.customerPhone && (
                        <button
                          className={styles.actionButton}
                          onClick={() => callCustomer(revision.customerPhone!)}
                          title="Zavolat"
                        >
                          📞
                        </button>
                      )}
                      {revision.status !== 'completed' && (
                        <button
                          className={`${styles.actionButton} ${styles.doneButton}`}
                          onClick={() => handleMarkDone(revision.id)}
                          title="Hotovo"
                        >
                          ✅
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Route actions */}
        <div className={styles.routeActions}>
          {/* Add from inbox button */}
          <button 
            className={styles.addFromInboxButton}
            onClick={handleOpenInboxDrawer}
            disabled={!isConnected}
          >
            ➕ Přidat z fronty
          </button>
          
          {scheduledRevisions.length > 0 && stops.length === 0 && (
            <>
              <button 
                className={styles.optimizeButton}
                onClick={handleOptimizeRoute}
                disabled={isLoading || !isConnected || !depot}
              >
                {isLoading ? 'Optimalizuji...' : '🚀 Optimalizovat trasu'}
              </button>
              {routeJob && isLoading && (
                <div className={styles.jobProgress}>
                  {routeJob.status.type === 'queued' && (
                    <span>Ve frontě (pozice {routeJob.status.position})...</span>
                  )}
                  {routeJob.status.type === 'processing' && (
                    <span>{routeJob.status.message} ({routeJob.status.progress}%)</span>
                  )}
                </div>
              )}
            </>
          )}
          
          {stops.length > 0 && (
            <>
              <button 
                className={styles.saveButton}
                onClick={handleSaveRoute}
                disabled={isSaving}
                title={lastSaved ? `Uloženo: ${lastSaved.toLocaleTimeString()}` : ''}
              >
                {isSaving ? 'Ukládám...' : '💾 Uložit'}
              </button>
              <button 
                className={styles.clearButton}
                onClick={handleClearRoute}
              >
                🗑️ Vyčistit
              </button>
            </>
          )}
          
          {hasSavedRoute && stops.length === 0 && (
            <button 
              className={styles.loadButton}
              onClick={handleLoadRoute}
              disabled={isLoadingSaved}
            >
              {isLoadingSaved ? 'Načítám...' : '📂 Načíst uloženou'}
            </button>
          )}
        </div>

        {/* Call Queue Preview */}
        <div className={styles.queuePreview}>
          <div className={styles.queueHeader}>
            <h3>Fronta k obvolání</h3>
            <Link to="/queue" className={styles.queueLink}>
              Otevřít →
            </Link>
          </div>
          
          {queueLoading ? (
            <div className={styles.loading}>Načítám...</div>
          ) : queuePreview.length === 0 ? (
            <div className={styles.emptyQueue}>Fronta je prázdná</div>
          ) : (
            <ul className={styles.queueList}>
              {queuePreview.map((item) => (
                <li key={item.id} className={styles.queueItem}>
                  <div className={styles.queueItemInfo}>
                    <span className={styles.queueCustomer}>{item.customerName}</span>
                    <span className={`${styles.queuePriority} ${styles[`priority-${item.priority}`]}`}>
                      {getPriorityLabel(item.priority)}
                    </span>
                  </div>
                  <Link 
                    to="/revisions/$revisionId" 
                    params={{ revisionId: item.id }}
                    className={styles.queueAction}
                  >
                    Naplánovat
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Connection status */}
        {!isConnected && (
          <div className={styles.connectionStatus}>
            ⚠️ Není připojeno k serveru
          </div>
        )}
      </div>

      <div className={styles.mapWrapper}>
        <div ref={mapContainer} className={styles.map} />
        {highlightedSegment !== null && stops.length > 0 && (
          <div className={styles.segmentInfo}>
            <span className={styles.segmentInfoLabel}>
              Segment: {(() => {
                const { fromName, toName } = getSegmentLabel(
                  highlightedSegment,
                  stops.map(s => ({ name: s.customerName })),
                  depot?.name || 'Depo',
                );
                return `${fromName} → ${toName}`;
              })()}
            </span>
            <button 
              className={styles.segmentInfoClose} 
              onClick={() => setHighlightedSegment(null)}
              title="Zrušit zvýraznění"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Add from inbox drawer */}
      <AddFromInboxDrawer
        isOpen={showInboxDrawer}
        onClose={() => setShowInboxDrawer(false)}
        candidates={inboxCandidates}
        selectedDate={selectedDate}
        onAddToRoute={handleAddFromInbox}
        isLoading={loadingInboxCandidates}
      />
    </div>
  );
}
