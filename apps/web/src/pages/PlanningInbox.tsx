import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import { 
  RouteContextHeader, 
  type RouteContext,
  type RouteMetrics,
  RouteMapPanel,
  type MapStop,
  type MapDepot,
} from '../components/planner';
import { ThreePanelLayout } from '../components/common';
import * as settingsService from '../services/settingsService';
import * as vehicleService from '../services/vehicleService';
import * as routeService from '../services/routeService';
import * as insertionService from '../services/insertionService';
import { getCallQueue, type CallQueueItem } from '../services/revisionService';
import { usePlannerShortcuts } from '../hooks/useKeyboardShortcuts';
import styles from './PlanningInbox.module.css';

// Mock user ID for development
const USER_ID = '00000000-0000-0000-0000-000000000001';

type InboxSegment = 'overdue' | 'thisWeek' | 'thisMonth' | 'all' | 'snoozed' | 'problems';

interface Depot {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface InboxCandidate extends CallQueueItem {
  deltaKm?: number;
  deltaMin?: number;
  slotStatus?: 'ok' | 'tight' | 'conflict';
  isCalculating?: boolean;
}

// Helper to check if customer is overdue
function getDaysOverdue(item: CallQueueItem): number {
  // daysUntilDue is negative when overdue
  return item.daysUntilDue < 0 ? Math.abs(item.daysUntilDue) : 0;
}

// Helper to check if has phone
function hasPhone(item: CallQueueItem): boolean {
  return item.customerPhone !== null && item.customerPhone.trim() !== '';
}

// Helper to check if has valid address
function hasValidAddress(item: CallQueueItem): boolean {
  return item.customerGeocodeStatus === 'success' && 
         item.customerLat !== null && 
         item.customerLng !== null;
}

export function PlanningInbox() {
  const { isConnected } = useNatsStore();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Route context state
  const [context, setContext] = useState<RouteContext | null>(null);
  const [isRouteAware, setIsRouteAware] = useState(true);
  const [vehicles, setVehicles] = useState<vehicleService.Vehicle[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  
  // Route state
  const [routeStops, setRouteStops] = useState<MapStop[]>([]);
  const [metrics, setMetrics] = useState<RouteMetrics | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  
  // Inbox state
  const [segment, setSegment] = useState<InboxSegment>('thisWeek');
  const [candidates, setCandidates] = useState<InboxCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  
  // Insertion calculation state
  const [slotSuggestions, setSlotSuggestions] = useState<insertionService.InsertionPosition[]>([]);
  const [isCalculatingSlots, setIsCalculatingSlots] = useState(false);
  
  // Segment counts
  const [segmentCounts, setSegmentCounts] = useState<Record<InboxSegment, number>>({
    overdue: 0,
    thisWeek: 0,
    thisMonth: 0,
    all: 0,
    snoozed: 0,
    problems: 0,
  });

  // Load settings (vehicles, depots)
  useEffect(() => {
    if (!isConnected) return;
    
    async function loadSettings() {
      try {
        // Load settings and vehicles in parallel
        const [settings, loadedVehicles] = await Promise.all([
          settingsService.getSettings(USER_ID),
          vehicleService.listVehicles(true),
        ]);
        
        // Convert depots to our format
        const loadedDepots = settings.depots.map((d) => ({
          id: d.name, // Use name as ID for now
          name: d.name,
          lat: d.lat,
          lng: d.lng,
        }));
        setDepots(loadedDepots);
        setVehicles(loadedVehicles);
        
        // Set initial context with today's date, first vehicle, and primary depot
        const primaryDepot = loadedDepots.find((d) => 
          settings.depots.find((sd) => sd.name === d.name && sd.isPrimary)
        ) || loadedDepots[0];
        
        const firstVehicle = loadedVehicles[0];
        
        if (primaryDepot && firstVehicle) {
          setContext({
            date: new Date().toISOString().split('T')[0],
            vehicleId: firstVehicle.id,
            vehicleName: firstVehicle.name,
            depotId: primaryDepot.id,
            depotName: primaryDepot.name,
          });
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    }
    
    loadSettings();
  }, [isConnected]);

  // Load saved route for selected day
  useEffect(() => {
    if (!isConnected || !context?.date) return;
    
    const dateToLoad = context.date;
    
    async function loadRoute() {
      setIsLoadingRoute(true);
      try {
        const response = await routeService.getRoute(dateToLoad);
        
        if (response.route && response.stops.length > 0) {
          // Convert to MapStop format
          const stops: MapStop[] = response.stops.map((stop) => ({
            id: stop.customerId,
            name: stop.customerName,
            address: stop.address,
            coordinates: {
              lat: stop.customerLat ?? 0,
              lng: stop.customerLng ?? 0,
            },
            order: stop.stopOrder,
            eta: stop.estimatedArrival ?? undefined,
            etd: stop.estimatedDeparture ?? undefined,
          }));
          setRouteStops(stops);
          
          // Set metrics from route
          const totalMin = response.route.totalDurationMinutes ?? 0;
          const serviceMin = stops.length * 30; // Assume 30 min per stop
          const travelMin = totalMin - serviceMin;
          const workingDayMin = 9 * 60; // 9 hours
          
          setMetrics({
            distanceKm: response.route.totalDistanceKm ?? 0,
            travelTimeMin: Math.max(0, travelMin),
            serviceTimeMin: serviceMin,
            loadPercent: Math.round((totalMin / workingDayMin) * 100),
            slackMin: Math.max(0, workingDayMin - totalMin),
            stopCount: stops.length,
          });
        } else {
          setRouteStops([]);
          setMetrics(null);
        }
      } catch (err) {
        console.error('Failed to load route:', err);
        setRouteStops([]);
        setMetrics(null);
      } finally {
        setIsLoadingRoute(false);
      }
    }
    
    loadRoute();
  }, [isConnected, context?.date]);

  // Calculate insertion when candidate is selected (route-aware mode)
  useEffect(() => {
    if (!isConnected || !isRouteAware || !selectedCandidateId || !context) return;
    
    const candidate = candidates.find((c) => c.customerId === selectedCandidateId);
    if (!candidate || !candidate.customerLat || !candidate.customerLng) {
      setSlotSuggestions([]);
      return;
    }
    
    const depot = depots.find((d) => d.id === context.depotId);
    if (!depot) {
      setSlotSuggestions([]);
      return;
    }
    
    async function calculateInsertion() {
      setIsCalculatingSlots(true);
      try {
        const response = await insertionService.calculateInsertion({
          routeStops: routeStops.map((stop) => ({
            id: stop.id,
            name: stop.name,
            coordinates: stop.coordinates,
            arrivalTime: stop.eta,
            departureTime: stop.etd,
          })),
          depot: { lat: depot!.lat, lng: depot!.lng },
          candidate: {
            id: candidate!.id, // revision ID
            customerId: candidate!.customerId,
            coordinates: { lat: candidate!.customerLat!, lng: candidate!.customerLng! },
            serviceDurationMinutes: 30, // Default, could come from settings
          },
          date: context!.date,
        });
        
        setSlotSuggestions(response.allPositions);
        
        // Update candidate with best insertion metrics
        if (response.bestPosition) {
          setCandidates((prev) => 
            prev.map((c) => 
              c.customerId === selectedCandidateId
                ? {
                    ...c,
                    deltaKm: response.bestPosition!.deltaKm,
                    deltaMin: response.bestPosition!.deltaMin,
                    slotStatus: response.bestPosition!.status as 'ok' | 'tight' | 'conflict',
                  }
                : c
            )
          );
        }
      } catch (err) {
        console.error('Failed to calculate insertion:', err);
        setSlotSuggestions([]);
      } finally {
        setIsCalculatingSlots(false);
      }
    }
    
    calculateInsertion();
  }, [isConnected, isRouteAware, selectedCandidateId, routeStops, context, depots, candidates]);

  // Load candidates based on segment
  const loadCandidates = useCallback(async () => {
    if (!isConnected) return;
    
    setIsLoadingCandidates(true);
    try {
      // For now, load from call queue with filters based on segment
      const response = await getCallQueue(USER_ID, {
        priorityFilter: segment === 'overdue' ? 'overdue' : 'all',
        geocodedOnly: isRouteAware,
        limit: 50,
      });
      
      // Transform to inbox candidates - metrics will be calculated when selected
      const loadedCandidates: InboxCandidate[] = response.items.map((item) => ({
        ...item,
        // Metrics will be populated when candidate is selected
        deltaKm: undefined,
        deltaMin: undefined,
        slotStatus: undefined,
      }));
      
      setCandidates(loadedCandidates);
      setSlotSuggestions([]);
      
      // Update segment counts
      setSegmentCounts({
        overdue: loadedCandidates.filter((c) => getDaysOverdue(c) > 0).length,
        thisWeek: loadedCandidates.length,
        thisMonth: loadedCandidates.length,
        all: loadedCandidates.length,
        snoozed: 0,
        problems: loadedCandidates.filter((c) => !hasPhone(c) || !hasValidAddress(c)).length,
      });
    } catch (err) {
      console.error('Failed to load candidates:', err);
      setCandidates([]);
    } finally {
      setIsLoadingCandidates(false);
    }
  }, [isConnected, segment, isRouteAware]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Batch calculate insertion metrics for all candidates with valid coordinates
  useEffect(() => {
    if (!isConnected || !isRouteAware || !context || candidates.length === 0) return;
    
    const depot = depots.find((d) => d.id === context.depotId);
    if (!depot) return;
    
    // Filter candidates with valid coordinates
    const validCandidates = candidates.filter(
      (c) => c.customerLat !== null && c.customerLng !== null
    );
    
    if (validCandidates.length === 0) return;
    
    // Skip if all candidates already have metrics calculated
    const needsCalculation = validCandidates.some((c) => c.deltaKm === undefined);
    if (!needsCalculation) return;
    
    async function calculateBatch() {
      try {
        const response = await insertionService.calculateBatchInsertion({
          routeStops: routeStops.map((stop) => ({
            id: stop.id,
            name: stop.name,
            coordinates: stop.coordinates,
            arrivalTime: stop.eta,
            departureTime: stop.etd,
          })),
          depot: { lat: depot!.lat, lng: depot!.lng },
          candidates: validCandidates.map((c) => ({
            id: c.id,
            customerId: c.customerId,
            coordinates: { lat: c.customerLat!, lng: c.customerLng! },
            serviceDurationMinutes: 30,
          })),
          date: context!.date,
          bestOnly: true,
        });
        
        // Update candidates with batch results
        const resultsMap = new Map(
          response.results.map((r) => [r.candidateId, r])
        );
        
        setCandidates((prev) =>
          prev.map((c) => {
            const result = resultsMap.get(c.id);
            if (result) {
              return {
                ...c,
                deltaKm: result.bestDeltaKm,
                deltaMin: result.bestDeltaMin,
                slotStatus: result.status as 'ok' | 'tight' | 'conflict',
              };
            }
            return c;
          })
        );
        
        console.log(`Batch insertion calculated for ${response.results.length} candidates in ${response.processingTimeMs}ms`);
      } catch (err) {
        console.error('Failed to calculate batch insertion:', err);
      }
    }
    
    calculateBatch();
  }, [isConnected, isRouteAware, context, candidates, routeStops, depots]);

  // Get current depot for map
  const currentDepot: MapDepot | null = useMemo(() => {
    if (!context?.depotId) return null;
    const depot = depots.find((d) => d.id === context.depotId);
    return depot ? { lat: depot.lat, lng: depot.lng, name: depot.name } : null;
  }, [context?.depotId, depots]);

  // Selected candidate
  const selectedCandidate = useMemo(() => 
    candidates.find((c) => c.customerId === selectedCandidateId),
    [candidates, selectedCandidateId]
  );

  // Sorted candidates for display (pre-ranked by insertion cost)
  const sortedCandidates = useMemo(() => {
    if (!isRouteAware) {
      // Without route-aware mode, sort by due date only
      return [...candidates].sort((a, b) => {
        const aOverdue = getDaysOverdue(a);
        const bOverdue = getDaysOverdue(b);
        if (aOverdue !== bOverdue) return bOverdue - aOverdue; // More overdue first
        return a.daysUntilDue - b.daysUntilDue; // Sooner due first
      });
    }
    
    // With route-aware mode, sort by insertion metrics
    return [...candidates].sort((a, b) => {
      // Problems last (no coordinates)
      const aValid = hasValidAddress(a);
      const bValid = hasValidAddress(b);
      if (aValid !== bValid) return aValid ? -1 : 1;
      
      // Candidates with calculated metrics first
      const aHasMetrics = a.deltaMin !== undefined;
      const bHasMetrics = b.deltaMin !== undefined;
      if (aHasMetrics !== bHasMetrics) return aHasMetrics ? -1 : 1;
      
      // Sort by status (ok > tight > conflict)
      if (a.slotStatus && b.slotStatus) {
        const statusOrder = { ok: 0, tight: 1, conflict: 2 };
        const statusDiff = statusOrder[a.slotStatus] - statusOrder[b.slotStatus];
        if (statusDiff !== 0) return statusDiff;
      }
      
      // Sort by delta time
      if (a.deltaMin !== undefined && b.deltaMin !== undefined) {
        return a.deltaMin - b.deltaMin;
      }
      
      // Fallback to due date
      const aOverdue = getDaysOverdue(a);
      const bOverdue = getDaysOverdue(b);
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      return a.daysUntilDue - b.daysUntilDue;
    });
  }, [candidates, isRouteAware]);

  // Handle context changes
  const handleDateChange = (date: string) => {
    setContext((prev) => prev ? { ...prev, date } : null);
  };

  const handleVehicleChange = (vehicleId: string) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    setContext((prev) => prev ? { 
      ...prev, 
      vehicleId, 
      vehicleName: vehicle?.name ?? '' 
    } : null);
  };

  const handleDepotChange = (depotId: string) => {
    const depot = depots.find((d) => d.id === depotId);
    setContext((prev) => prev ? { 
      ...prev, 
      depotId, 
      depotName: depot?.name ?? '' 
    } : null);
  };

  // Format delta values
  const formatDelta = (value: number | undefined, unit: string) => {
    if (value === undefined) return null;
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}${unit}`;
  };

  // Get status icon
  const getStatusIcon = (status?: 'ok' | 'tight' | 'conflict') => {
    switch (status) {
      case 'ok': return '✅';
      case 'tight': return '⚠️';
      case 'conflict': return '❌';
      default: return '';
    }
  };

  // Keyboard shortcuts handlers
  const handleMoveUp = useCallback(() => {
    if (sortedCandidates.length === 0) return;
    
    const currentIndex = selectedCandidateId 
      ? sortedCandidates.findIndex((c) => c.customerId === selectedCandidateId)
      : -1;
    
    const newIndex = currentIndex <= 0 ? sortedCandidates.length - 1 : currentIndex - 1;
    setSelectedCandidateId(sortedCandidates[newIndex].customerId);
  }, [sortedCandidates, selectedCandidateId]);

  const handleMoveDown = useCallback(() => {
    if (sortedCandidates.length === 0) return;
    
    const currentIndex = selectedCandidateId 
      ? sortedCandidates.findIndex((c) => c.customerId === selectedCandidateId)
      : -1;
    
    const newIndex = currentIndex >= sortedCandidates.length - 1 ? 0 : currentIndex + 1;
    setSelectedCandidateId(sortedCandidates[newIndex].customerId);
  }, [sortedCandidates, selectedCandidateId]);

  const handleSelectSlot = useCallback((index: number) => {
    if (slotSuggestions.length > index) {
      // TODO: Implement slot selection action (schedule visit)
      console.log('Selected slot:', slotSuggestions[index]);
    }
  }, [slotSuggestions]);

  const handleSchedule = useCallback(() => {
    if (selectedCandidate) {
      // TODO: Open schedule dialog
      console.log('Schedule:', selectedCandidate.customerName);
    }
  }, [selectedCandidate]);

  const handleSnooze = useCallback(() => {
    if (selectedCandidate) {
      // TODO: Open snooze dialog
      console.log('Snooze:', selectedCandidate.customerName);
    }
  }, [selectedCandidate]);

  const handleFixAddress = useCallback(() => {
    if (selectedCandidate) {
      navigate({ to: '/customers/$customerId', params: { customerId: selectedCandidate.customerId } });
    }
  }, [selectedCandidate, navigate]);

  const handleSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const handleEscape = useCallback(() => {
    setSelectedCandidateId(null);
    setSlotSuggestions([]);
  }, []);

  // Register keyboard shortcuts
  usePlannerShortcuts({
    onMoveUp: handleMoveUp,
    onMoveDown: handleMoveDown,
    onSelectSlot: handleSelectSlot,
    onSchedule: handleSchedule,
    onSnooze: handleSnooze,
    onFixAddress: handleFixAddress,
    onSearch: handleSearch,
    onEscape: handleEscape,
    enabled: true,
  });

  // Render inbox list
  const renderInboxList = () => (
    <div className={styles.inboxPanel}>
      <div className={styles.segmentTabs}>
        {([
          { key: 'overdue', label: 'Po termínu', count: segmentCounts.overdue },
          { key: 'thisWeek', label: 'Týden', count: segmentCounts.thisWeek },
          { key: 'thisMonth', label: '30 dní', count: segmentCounts.thisMonth },
          { key: 'all', label: 'Vše', count: segmentCounts.all },
          { key: 'snoozed', label: 'Odložené', count: segmentCounts.snoozed },
          { key: 'problems', label: 'Problémy', count: segmentCounts.problems },
        ] as const).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            className={`${styles.segmentTab} ${segment === key ? styles.active : ''}`}
            onClick={() => setSegment(key)}
          >
            {label}
            {count > 0 && <span className={styles.count}>({count})</span>}
          </button>
        ))}
      </div>
      
      <div className={styles.candidateList}>
        {isLoadingCandidates ? (
          <div className={styles.loading}>Načítám...</div>
        ) : candidates.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>📭</span>
            <p>Žádní kandidáti v tomto segmentu</p>
          </div>
        ) : (
          sortedCandidates.map((candidate) => {
            const daysOverdue = getDaysOverdue(candidate);
            return (
              <button
                key={candidate.customerId}
                type="button"
                className={`${styles.candidateRow} ${selectedCandidateId === candidate.customerId ? styles.selected : ''}`}
                onClick={() => setSelectedCandidateId(candidate.customerId)}
              >
                <div className={styles.candidateMain}>
                  <span className={styles.candidateName}>{candidate.customerName}</span>
                  <span className={styles.candidateCity}>{candidate.customerCity}</span>
                </div>
                
                {isRouteAware && (
                  <div className={styles.candidateMetrics}>
                    {formatDelta(candidate.deltaKm, 'km') && (
                      <span className={styles.deltaKm}>{formatDelta(candidate.deltaKm, 'km')}</span>
                    )}
                    {formatDelta(candidate.deltaMin, 'min') && (
                      <span className={styles.deltaMin}>{formatDelta(candidate.deltaMin, 'min')}</span>
                    )}
                    <span className={styles.statusIcon}>{getStatusIcon(candidate.slotStatus)}</span>
                  </div>
                )}
                
                <div className={styles.candidateMeta}>
                  {daysOverdue > 0 && (
                    <span className={styles.overdue}>+{daysOverdue}d</span>
                  )}
                  {!hasPhone(candidate) && <span className={styles.warning}>📵</span>}
                  {!hasValidAddress(candidate) && <span className={styles.warning}>📍</span>}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  // Render map panel
  const renderMapPanel = () => (
    <div className={styles.mapPanel}>
      <RouteMapPanel
        stops={routeStops}
        depot={currentDepot}
        highlightedStopId={selectedCandidateId}
        isLoading={isLoadingRoute}
      />
    </div>
  );

  // Render detail panel
  const renderDetailPanel = () => (
    <div className={styles.detailPanel}>
      {selectedCandidate ? (
        <>
          <div className={styles.detailHeader}>
            <h3>{selectedCandidate.customerName}</h3>
            <span className={styles.customerType}>
              {selectedCandidate.deviceType}
            </span>
          </div>
          
          <div className={styles.detailSection}>
            <h4>Kontakt</h4>
            {selectedCandidate.customerPhone && (
              <a href={`tel:${selectedCandidate.customerPhone}`} className={styles.phone}>
                📞 {selectedCandidate.customerPhone}
              </a>
            )}
            <p className={styles.address}>{selectedCandidate.customerStreet}</p>
            <p className={styles.city}>{selectedCandidate.customerCity}</p>
          </div>
          
          {isRouteAware && (
            <div className={styles.detailSection}>
              <h4>Doporučené sloty</h4>
              <div className={styles.slotSuggestions}>
                {isCalculatingSlots ? (
                  <span className={styles.calculating}>Počítám...</span>
                ) : slotSuggestions.length > 0 ? (
                  slotSuggestions.slice(0, 5).map((slot, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`${styles.slotChip} ${styles[slot.status]}`}
                      title={`Vloží se mezi: ${slot.insertAfterName} → ${slot.insertBeforeName}\n+${slot.deltaMin.toFixed(0)}min / +${slot.deltaKm.toFixed(1)}km`}
                    >
                      {slot.estimatedArrival}–{slot.estimatedDeparture} {getStatusIcon(slot.status as 'ok' | 'tight' | 'conflict')}
                    </button>
                  ))
                ) : hasValidAddress(selectedCandidate) ? (
                  <span className={styles.noSlots}>Žádné sloty - zkuste jiný den</span>
                ) : (
                  <span className={styles.noSlots}>⚠️ Nelze vypočítat - chybí adresa</span>
                )}
              </div>
            </div>
          )}
          
          <div className={styles.detailActions}>
            <button type="button" className="btn-primary">
              Domluvit termín
            </button>
            <button type="button" className="btn-secondary">
              Odložit
            </button>
          </div>
          
          <div className={styles.detailLinks}>
            <Link 
              to="/customers/$customerId" 
              params={{ customerId: selectedCandidate.customerId }}
              className={styles.detailLink}
            >
              Zobrazit detail zákazníka →
            </Link>
          </div>
        </>
      ) : (
        <div className={styles.noSelection}>
          <span className={styles.noSelectionIcon}>👆</span>
          <p>Vyberte kandidáta ze seznamu</p>
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.page}>
      <RouteContextHeader
        context={context}
        metrics={metrics}
        isRouteAware={isRouteAware}
        onRouteAwareToggle={setIsRouteAware}
        onDateChange={handleDateChange}
        onVehicleChange={handleVehicleChange}
        onDepotChange={handleDepotChange}
        vehicles={vehicles}
        depots={depots}
        isLoading={isLoadingRoute}
      />
      
      <div className={styles.content}>
        <ThreePanelLayout
          left={renderInboxList()}
          center={renderMapPanel()}
          right={renderDetailPanel()}
          leftWidth={28}
          centerWidth={42}
          rightWidth={30}
          className={styles.splitLayout}
        />
      </div>
    </div>
  );
}
