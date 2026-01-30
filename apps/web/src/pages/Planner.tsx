import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useNatsStore } from '../stores/natsStore';
import { v4 as uuidv4 } from 'uuid';
import type { RoutePlanResponse, PlannedRouteStop } from '@sazinka/shared-types';
import * as settingsService from '../services/settingsService';
import { getSuggestedRevisions, type RevisionSuggestion } from '../services/revisionService';
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

// Job Status types for queue workflow
interface JobSubmitResponse {
  jobId: string;
  position: number;
  estimatedWaitSeconds: number;
}

interface JobStatusQueued {
  type: 'queued';
  position: number;
  estimatedWaitSeconds: number;
}

interface JobStatusProcessing {
  type: 'processing';
  progress: number;
  message: string;
}

interface JobStatusCompleted {
  type: 'completed';
  result: RoutePlanResponse;
}

interface JobStatusFailed {
  type: 'failed';
  error: string;
}

type JobStatus = JobStatusQueued | JobStatusProcessing | JobStatusCompleted | JobStatusFailed;

interface JobStatusUpdate {
  jobId: string;
  timestamp: string;
  status: JobStatus;
}

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

export function Planner() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stops, setStops] = useState<PlannedRouteStop[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [optimizationScore, setOptimizationScore] = useState(0);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [routeWarnings, setRouteWarnings] = useState<string[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [algorithmName, setAlgorithmName] = useState('');
  const [solveTimeMs, setSolveTimeMs] = useState(0);
  const [solverLog, setSolverLog] = useState<string[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  
  // Job queue state
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  
  // Depot state
  const [depot, setDepot] = useState<{ lat: number; lng: number; name?: string } | null>(null);
  const [depotLoading, setDepotLoading] = useState(true);
  const depotMarkerRef = useRef<maplibregl.Marker | null>(null);
  
  // Smart suggestions state
  const [suggestions, setSuggestions] = useState<RevisionSuggestion[]>([]);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(new Set());
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [totalCandidates, setTotalCandidates] = useState(0);
  
  // Drag/drop state
  const [lockedStops, setLockedStops] = useState<Set<string>>(new Set());
  const [isManuallyReordered, setIsManuallyReordered] = useState(false);

  const { request, subscribe, isConnected } = useNatsStore();
  
  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  // Load user's primary depot from settings (wait for NATS connection)
  useEffect(() => {
    if (!isConnected) return;
    
    async function loadDepot() {
      try {
        const settings = await settingsService.getSettings(USER_ID);
        const primaryDepot = settings.depots.find(d => d.isPrimary) || settings.depots[0];
        if (primaryDepot) {
          setDepot({ lat: primaryDepot.lat, lng: primaryDepot.lng, name: primaryDepot.name });
        } else {
          // No depot configured, use default
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

  // Load smart suggestions when date changes
  const loadSuggestions = useCallback(async () => {
    if (!isConnected) return;
    
    setSuggestionsLoading(true);
    try {
      const response = await getSuggestedRevisions(USER_ID, selectedDate, 20);
      setSuggestions(response.suggestions);
      setTotalCandidates(response.totalCandidates);
      // Auto-select top 10 by default
      const topIds = response.suggestions.slice(0, 10).map(s => s.id);
      setSelectedSuggestionIds(new Set(topIds));
    } catch (err) {
      console.error('Failed to load suggestions:', err);
      setSuggestions([]);
      setTotalCandidates(0);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [isConnected, selectedDate]);

  // Load suggestions on date change
  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  // Toggle suggestion selection
  const toggleSuggestion = useCallback((id: string) => {
    setSelectedSuggestionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Select all / none helpers
  const selectAllSuggestions = useCallback(() => {
    setSelectedSuggestionIds(new Set(suggestions.map(s => s.id)));
  }, [suggestions]);

  const deselectAllSuggestions = useCallback(() => {
    setSelectedSuggestionIds(new Set());
  }, []);

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
    
    // Also remove route line if exists
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

      // Add number label
      const el = marker.getElement();
      const label = document.createElement('div');
      label.className = styles.markerLabel;
      label.textContent = String(index + 1);
      el.appendChild(label);

      markersRef.current.push(marker);
    });

    // Draw route line
    if (plannedStops.length > 0 && depot) {
      // Use real road geometry if available, otherwise straight lines
      const coordinates: [number, number][] = geometry.length > 0
        ? geometry
        : [
            [depot.lng, depot.lat],
            ...plannedStops.map(s => [s.coordinates.lng, s.coordinates.lat] as [number, number]),
            [depot.lng, depot.lat], // Return to depot
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

      // Fit map to show all stops
      const bounds = new maplibregl.LngLatBounds();
      coordinates.forEach(coord => bounds.extend(coord));
      map.current.fitBounds(bounds, { padding: 50 });
    }
  }, [clearMarkers, depot]);

  // Plan route with selected suggestions
  const handlePlanRoute = async () => {
    if (!isConnected) {
      setError('Není připojeno k serveru');
      return;
    }

    if (!depot) {
      setError('Depo není načteno');
      return;
    }

    if (selectedSuggestionIds.size === 0) {
      setError('Vyberte alespoň jednu revizi k naplánování');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get customer IDs from selected suggestions
      const selectedSuggestions = suggestions.filter(s => selectedSuggestionIds.has(s.id));
      const customerIds = [...new Set(selectedSuggestions.map(s => s.customerId))]; // Unique customer IDs
      
      if (customerIds.length === 0) {
        setError('Žádní zákazníci k naplánování');
        setIsLoading(false);
        return;
      }

      // Plan route
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
        60000 // 60s timeout for route planning
      );

      if (isErrorResponse(planResponse)) {
        throw new Error(planResponse.error.message || 'Nepodařilo se naplánovat trasu');
      }

      const result = planResponse.payload;
      
      const geometry = result.geometry || [];
      
      setStops(result.stops);
      setTotalDistance(result.totalDistanceKm);
      setTotalDuration(result.totalDurationMinutes);
      setOptimizationScore(result.optimizationScore);
      setAlgorithmName(result.algorithm);
      setSolveTimeMs(result.solveTimeMs);
      setRouteWarnings(result.warnings.map(w => w.message));
      setUnassignedCount(result.unassigned.length);
      setSolverLog(result.solverLog);
      setRouteGeometry(geometry);

      // Update map with geometry passed directly (state is async)
      addStopMarkers(result.stops, geometry);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    } finally {
      setIsLoading(false);
    }
  };

  // Clean up job subscription on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  // Handle job status update callback
  const handleJobStatusUpdate = useCallback((update: JobStatusUpdate) => {
    if (update.jobId !== jobId) return;
    
    setJobStatus(update.status);
    
    if (update.status.type === 'completed') {
      const result = update.status.result;
      const geometry = result.geometry || [];
      
      setStops(result.stops);
      setTotalDistance(result.totalDistanceKm);
      setTotalDuration(result.totalDurationMinutes);
      setOptimizationScore(result.optimizationScore);
      setAlgorithmName(result.algorithm);
      setSolveTimeMs(result.solveTimeMs);
      setRouteWarnings(result.warnings.map(w => w.message));
      setUnassignedCount(result.unassigned.length);
      setSolverLog(result.solverLog);
      setRouteGeometry(geometry);
      addStopMarkers(result.stops, geometry);
      
      setIsLoading(false);
      setJobId(null);
      setJobStatus(null);
      
      // Unsubscribe
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    } else if (update.status.type === 'failed') {
      setError(update.status.error);
      setIsLoading(false);
      setJobId(null);
      setJobStatus(null);
      
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    }
  }, [jobId, addStopMarkers]);

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
    setUnassignedCount(0);
    setSolverLog([]);
    setRouteGeometry([]);
    setError(null);
    setJobId(null);
    setJobStatus(null);
    setLockedStops(new Set());
    setIsManuallyReordered(false);
    
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  };

  const formatDuration = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins} min`;
    if (mins === 0) return `${hours} h`;
    return `${hours} h ${mins} min`;
  };

  const formatSolveTime = (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return '–';
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(1)} s`;
  };

  // Priority reason labels
  const getPriorityLabel = (reason: string): string => {
    const labels: Record<string, string> = {
      overdue: 'Po termínu',
      due_this_week: 'Tento týden',
      due_soon: 'Brzy',
      due_this_month: 'Tento měsíc',
      upcoming: 'Nadcházející',
    };
    return labels[reason] || reason;
  };

  // Handle drag end - reorder stops
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

  // Job Status Indicator component
  const JobStatusIndicator = () => {
    if (!jobStatus) return null;

    switch (jobStatus.type) {
      case 'queued':
        return (
          <div className={styles.jobStatus}>
            <div className={styles.jobStatusIcon}>⏳</div>
            <div className={styles.jobStatusText}>
              <strong>Ve frontě</strong>
              <span>Pozice: {jobStatus.position}</span>
              <span>Odhadovaný čas: ~{jobStatus.estimatedWaitSeconds}s</span>
            </div>
          </div>
        );
      case 'processing':
        return (
          <div className={styles.jobStatus}>
            <div className={styles.jobStatusIcon}>⚙️</div>
            <div className={styles.jobStatusText}>
              <strong>Zpracování...</strong>
              <div className={styles.progressBar}>
                <div 
                  className={styles.progressFill} 
                  style={{ width: `${jobStatus.progress}%` }}
                />
              </div>
              <span>{jobStatus.message}</span>
            </div>
          </div>
        );
      case 'completed':
        return (
          <div className={styles.jobStatusSuccess}>
            <div className={styles.jobStatusIcon}>✅</div>
            <span>Dokončeno!</span>
          </div>
        );
      case 'failed':
        return (
          <div className={styles.jobStatusError}>
            <div className={styles.jobStatusIcon}>❌</div>
            <span>{jobStatus.error}</span>
          </div>
        );
    }
  };

  return (
    <div className={styles.planner}>
      <div className={styles.sidebar}>
        <h2>Plánování trasy</h2>
        
        <div className={styles.dateSelector}>
          <label>Datum</label>
          <input 
            type="date" 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>

        <div className={styles.depotInfo}>
          <label>Výchozí depo</label>
          <span className={styles.depotName}>
            {depotLoading ? 'Načítám...' : (depot?.name || 'Praha (výchozí)')}
          </span>
        </div>

        {/* Smart Suggestions */}
        <div className={styles.suggestions}>
          <div className={styles.suggestionsHeader}>
            <h3>Doporučené revize ({selectedSuggestionIds.size}/{suggestions.length})</h3>
            <div className={styles.suggestionsActions}>
              <button 
                type="button" 
                className={styles.selectButton}
                onClick={selectAllSuggestions}
                disabled={suggestionsLoading}
              >
                Vše
              </button>
              <button 
                type="button" 
                className={styles.selectButton}
                onClick={deselectAllSuggestions}
                disabled={suggestionsLoading}
              >
                Nic
              </button>
              <button 
                type="button" 
                className={styles.refreshButton}
                onClick={loadSuggestions}
                disabled={suggestionsLoading}
                title="Obnovit doporučení"
              >
                ↻
              </button>
            </div>
          </div>
          
          {suggestionsLoading ? (
            <div className={styles.loading}>Načítám doporučení...</div>
          ) : suggestions.length === 0 ? (
            <p className={styles.empty}>
              Žádné revize k naplánování pro vybraný den.
            </p>
          ) : (
            <>
              <ul className={styles.suggestionList}>
                {suggestions.map((suggestion) => (
                  <li 
                    key={suggestion.id} 
                    className={`${styles.suggestionItem} ${selectedSuggestionIds.has(suggestion.id) ? styles.selected : ''}`}
                    onClick={() => toggleSuggestion(suggestion.id)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSuggestionIds.has(suggestion.id)}
                      onChange={() => toggleSuggestion(suggestion.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className={styles.suggestionInfo}>
                      <div className={styles.suggestionCustomer}>
                        <strong>{suggestion.customerName}</strong>
                        <span className={`${styles.priorityBadge} ${styles[`priority-${suggestion.priorityReason}`]}`}>
                          {getPriorityLabel(suggestion.priorityReason)}
                        </span>
                      </div>
                      <small>{suggestion.customerStreet}, {suggestion.customerCity}</small>
                      <small className={styles.dueInfo}>
                        Termín: {suggestion.dueDate}
                        {suggestion.daysUntilDue < 0 && (
                          <span className={styles.overdue}> ({Math.abs(suggestion.daysUntilDue)} dnů po termínu)</span>
                        )}
                        {suggestion.daysUntilDue >= 0 && suggestion.daysUntilDue <= 7 && (
                          <span className={styles.dueSoon}> (za {suggestion.daysUntilDue} dnů)</span>
                        )}
                      </small>
                    </div>
                    <div className={styles.priorityScore}>{suggestion.priorityScore}</div>
                  </li>
                ))}
              </ul>
              {totalCandidates > suggestions.length && (
                <p className={styles.moreAvailable}>
                  + {totalCandidates - suggestions.length} dalších kandidátů
                </p>
              )}
            </>
          )}
        </div>

        {/* Planned stops with drag/drop */}
        {stops.length > 0 && (
          <div className={styles.stops}>
            <div className={styles.stopsHeader}>
              <h3>Naplánovaná trasa ({stops.length} zastávek)</h3>
              {isManuallyReordered && (
                <span className={styles.reorderedBadge}>Ručně upraveno</span>
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
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </div>
        )}

        {error && (
          <div className={styles.error}>
            {error}
          </div>
        )}

        {!error && (routeWarnings.length > 0 || unassignedCount > 0) && (
          <div className={styles.warning}>
            {unassignedCount > 0 && (
              <div>
                {unassignedCount} zákazníků nebylo přiřazeno k trase.
              </div>
            )}
            {routeWarnings.length > 0 && (
              <ul>
                {routeWarnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {solverLog.length > 0 && (
          <div className={styles.solverLog}>
            <div className={styles.solverLogTitle}>Log solveru</div>
            <pre>
              {solverLog.join('\n')}
            </pre>
          </div>
        )}

        {jobStatus && <JobStatusIndicator />}

        <div className={styles.actions}>
          <button 
            className="btn-primary w-full"
            onClick={handlePlanRoute}
            disabled={isLoading || !isConnected || !depot || selectedSuggestionIds.size === 0}
          >
            {isLoading ? 'Plánování...' : `Naplánovat trasu (${selectedSuggestionIds.size})`}
          </button>
          {stops.length > 0 && (
            <button 
              className="btn-secondary w-full"
              onClick={handleClearRoute}
              style={{ marginTop: '0.5rem' }}
            >
              Vyčistit
            </button>
          )}
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Celková vzdálenost</span>
            <span className={styles.statValue}>{totalDistance.toFixed(1)} km</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Odhadovaný čas</span>
            <span className={styles.statValue}>{formatDuration(totalDuration)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Algoritmus</span>
            <span className={styles.statValue}>{algorithmName || '—'}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Doba výpočtu</span>
            <span className={styles.statValue}>{formatSolveTime(solveTimeMs)}</span>
          </div>
          {optimizationScore > 0 && (
            <div className={styles.stat}>
              <span className={styles.statLabel}>Skóre optimalizace</span>
              <span className={styles.statValue}>{optimizationScore}%</span>
            </div>
          )}
        </div>

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
