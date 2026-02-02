import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import maplibregl from 'maplibre-gl';
import { useNatsStore } from '../stores/natsStore';
import { v4 as uuidv4 } from 'uuid';
import type { RoutePlanResponse, PlannedRouteStop } from '@sazinka/shared-types';
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
import { SortableStopItem } from '../components/planner';
import styles from './Planner.module.css';

// Mock user ID for development
const USER_ID = '00000000-0000-0000-0000-000000000001';

// Default depot location (Prague center) - fallback if no depot configured
const DEFAULT_DEPOT = { lat: 50.0755, lng: 14.4378 };

interface NatsSuccessResponse<T> {
  id: string;
  timestamp: string;
  payload: T;
}

interface NatsErrorResponse {
  id: string;
  timestamp: string;
  error: {
    code: string;
    message: string;
  };
}

type NatsResponse<T> = NatsSuccessResponse<T> | NatsErrorResponse;

function isErrorResponse<T>(response: NatsResponse<T>): response is NatsErrorResponse {
  return 'error' in response;
}

// Extended stop with revision details
interface StopWithRevision extends Revision {
  order?: number;
  eta?: string;
  etd?: string;
}

export function Planner() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stops, setStops] = useState<PlannedRouteStop[]>([]);
  const [scheduledRevisions, setScheduledRevisions] = useState<StopWithRevision[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [optimizationScore, setOptimizationScore] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [routeWarnings, setRouteWarnings] = useState<string[]>([]);
  // These values are set when optimizing but currently not displayed in UI
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_algorithmName, setAlgorithmName] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_solveTimeMs, setSolveTimeMs] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  
  // Depot state
  const [depot, setDepot] = useState<{ lat: number; lng: number; name?: string } | null>(null);
  const [depotLoading, setDepotLoading] = useState(true);
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  
  // Scheduled revisions loading
  const [scheduledLoading, setScheduledLoading] = useState(false);
  
  // Call queue preview
  const [queuePreview, setQueuePreview] = useState<CallQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  
  // Drag/drop state
  const [lockedStops, setLockedStops] = useState<Set<string>>(new Set());
  const [isManuallyReordered, setIsManuallyReordered] = useState(false);
  
  // Route persistence state
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [hasSavedRoute, setHasSavedRoute] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const { request, isConnected } = useNatsStore();
  
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
  
  // Load user's primary depot from settings
  useEffect(() => {
    if (!isConnected) return;
    
    async function loadDepot() {
      try {
        const settings = await settingsService.getSettings(USER_ID);
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
      const response = await listRevisions(USER_ID, {
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
      const response = await getCallQueue(USER_ID, { 
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

  // Clear markers helper
  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    
    if (map.current?.getLayer('route-line')) {
      map.current.removeLayer('route-line');
    }
    if (map.current?.getSource('route')) {
      map.current.removeSource('route');
    }
  }, []);

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

    // Draw route line
    if (plannedStops.length > 0 && depot) {
      const coordinates: [number, number][] = geometry.length > 0
        ? geometry
        : [
            [depot.lng, depot.lat],
            ...plannedStops.map(s => [s.coordinates.lng, s.coordinates.lat] as [number, number]),
            [depot.lng, depot.lat],
          ];

      map.current.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates,
          },
        },
      });

      map.current.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
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

      const bounds = new maplibregl.LngLatBounds();
      coordinates.forEach(coord => bounds.extend(coord));
      map.current.fitBounds(bounds, { padding: 50 });
    }
  }, [clearMarkers, depot]);

  // Optimize route with VRP solver
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

    try {
      const customerIds = [...new Set(scheduledRevisions.map(r => r.customerId))];
      
      const planResponse = await request<any, NatsResponse<RoutePlanResponse>>(
        'sazinka.route.plan',
        {
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          userId: USER_ID,
          payload: {
            startLocation: { lat: depot.lat, lng: depot.lng },
            customerIds,
            date: selectedDate,
          },
        },
        60000
      );

      if (isErrorResponse(planResponse)) {
        throw new Error(planResponse.error.message || 'Nepodařilo se optimalizovat trasu');
      }

      const result = planResponse.payload;
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

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    } finally {
      setIsLoading(false);
    }
  };

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
      await completeRevision(USER_ID, data);
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
                  <td class="time">${isPlannedStop ? `${stop.eta} - ${stop.etd}` : formatTime(stop.scheduledTimeStart)}</td>
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
  const handleClearRoute = () => {
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
  };

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

  // Save the current route
  const handleSaveRoute = useCallback(async () => {
    if (stops.length === 0) return;
    
    setIsSaving(true);
    try {
      const saveStops = stops.map((stop) => routeService.toSaveRouteStop(stop));

      await routeService.saveRoute({
        date: selectedDate,
        stops: saveStops,
        totalDistanceKm: totalDistance,
        totalDurationMinutes: totalDuration,
        optimizationScore: optimizationScore,
      });
      
      setLastSaved(new Date());
      setHasSavedRoute(true);
    } catch (e) {
      console.error('Failed to save route:', e);
      setError('Nepodařilo se uložit trasu');
    } finally {
      setIsSaving(false);
    }
  }, [stops, selectedDate, totalDistance, totalDuration, optimizationScore]);

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
      upcoming: 'Nadcházející',
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
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className={styles.dateInput}
          />
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
                          {formatTime(revision.scheduledTimeStart)}
                          {revision.scheduledTimeEnd && ` - ${formatTime(revision.scheduledTimeEnd)}`}
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
          {scheduledRevisions.length > 0 && stops.length === 0 && (
            <button 
              className={styles.optimizeButton}
              onClick={handleOptimizeRoute}
              disabled={isLoading || !isConnected || !depot}
            >
              {isLoading ? 'Optimalizuji...' : '🚀 Optimalizovat trasu'}
            </button>
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
      </div>
    </div>
  );
}
