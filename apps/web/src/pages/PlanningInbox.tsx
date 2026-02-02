import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
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
import { getCallQueue, type CallQueueItem } from '../services/revisionService';
import styles from './PlanningInbox.module.css';

// Mock user ID for development
const USER_ID = '00000000-0000-0000-0000-000000000001';

type InboxSegment = 'overdue' | 'thisWeek' | 'thisMonth' | 'all' | 'snoozed' | 'problems';

interface Vehicle {
  id: string;
  name: string;
}

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
  
  // Route context state
  const [context, setContext] = useState<RouteContext | null>(null);
  const [isRouteAware, setIsRouteAware] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  
  // Route state
  const [routeStops] = useState<MapStop[]>([]);
  const [metrics] = useState<RouteMetrics | null>(null);
  const [isLoadingRoute] = useState(false);
  
  // Inbox state
  const [segment, setSegment] = useState<InboxSegment>('thisWeek');
  const [candidates, setCandidates] = useState<InboxCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  
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
        const settings = await settingsService.getSettings(USER_ID);
        
        // Convert depots to our format
        const loadedDepots = settings.depots.map((d) => ({
          id: d.name, // Use name as ID for now
          name: d.name,
          lat: d.lat,
          lng: d.lng,
        }));
        setDepots(loadedDepots);
        
        // Mock vehicles for now (could come from settings later)
        setVehicles([
          { id: '1', name: 'Auto 1' },
          { id: '2', name: 'Auto 2' },
        ]);
        
        // Set initial context with today's date and primary depot
        const primaryDepot = loadedDepots.find((d) => 
          settings.depots.find((sd) => sd.name === d.name && sd.isPrimary)
        ) || loadedDepots[0];
        
        if (primaryDepot) {
          setContext({
            date: new Date().toISOString().split('T')[0],
            vehicleId: '1',
            vehicleName: 'Auto 1',
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
      
      // Transform to inbox candidates
      const loadedCandidates: InboxCandidate[] = response.items.map((item) => ({
        ...item,
        // These would be calculated by the backend in the real implementation
        deltaKm: isRouteAware ? Math.random() * 10 + 1 : undefined,
        deltaMin: isRouteAware ? Math.random() * 15 + 2 : undefined,
        slotStatus: isRouteAware 
          ? (['ok', 'tight', 'conflict'] as const)[Math.floor(Math.random() * 3)]
          : undefined,
      }));
      
      setCandidates(loadedCandidates);
      
      // Update segment counts (mock for now)
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
          candidates.map((candidate) => {
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
                {/* Mock slot suggestions - would come from backend */}
                <button type="button" className={`${styles.slotChip} ${styles.ok}`}>
                  10:00–12:00 ✅
                </button>
                <button type="button" className={`${styles.slotChip} ${styles.tight}`}>
                  12:00–14:00 ⚠️
                </button>
                <button type="button" className={`${styles.slotChip} ${styles.conflict}`}>
                  8:00–10:00 ❌
                </button>
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
