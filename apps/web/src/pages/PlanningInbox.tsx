import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import { useRouteCacheStore } from '../stores/routeCacheStore';
import { 
  RouteContextHeader, 
  type RouteContext,
  type RouteMetrics,
  RouteMapPanel,
  type MapStop,
  type MapDepot,
  CandidateDetail,
  type CandidateDetailData,
  VirtualizedInboxList,
  type VirtualizedInboxListRef,
  type CandidateRowData,
  ProblemsSegment,
  type ProblemCandidate,
  type ProblemType,
  MultiVehicleTip,
  type VehicleComparison,
  type SlotSuggestion,
} from '../components/planner';
import { DraftModeBar } from '../components/planner/DraftModeBar';
import { ThreePanelLayout } from '../components/common';
import * as settingsService from '../services/settingsService';
import * as vehicleService from '../services/vehicleService';
import * as routeService from '../services/routeService';
import * as insertionService from '../services/insertionService';
import { getCallQueue, snoozeRevision, scheduleRevision, type CallQueueItem } from '../services/revisionService';
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
  suggestedSlots?: SlotSuggestion[];
}

// Helper to check if customer is overdue
function getDaysOverdue(item: CallQueueItem): number {
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

// Convert priority to CandidateRowData priority type
function toPriority(item: CallQueueItem): CandidateRowData['priority'] {
  if (item.daysUntilDue < 0) return 'overdue';
  if (item.daysUntilDue <= 7) return 'due_this_week';
  if (item.daysUntilDue <= 30) return 'due_soon';
  return 'upcoming';
}

export function PlanningInbox() {
  const { isConnected } = useNatsStore();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<VirtualizedInboxListRef>(null);
  
  // Route cache store
  const { 
    setRouteContext, 
    getCachedInsertion, 
    setCachedInsertions,
    incrementRouteVersion,
    invalidateCache,
  } = useRouteCacheStore();
  
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
  
  // Detail state
  const [slotSuggestions, setSlotSuggestions] = useState<SlotSuggestion[]>([]);
  const [isCalculatingSlots, setIsCalculatingSlots] = useState(false);
  
  // Draft mode state
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  // Multi-vehicle state (TODO: implement multi-vehicle comparison)
  const [vehicleComparisons, _setVehicleComparisons] = useState<VehicleComparison[]>([]);
  
  // Problems segment state
  const [isProblemsCollapsed, setIsProblemsCollapsed] = useState(false);
  
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
        const [settings, loadedVehicles] = await Promise.all([
          settingsService.getSettings(USER_ID),
          vehicleService.listVehicles(true),
        ]);
        
        const loadedDepots = settings.depots.map((d) => ({
          id: d.name,
          name: d.name,
          lat: d.lat,
          lng: d.lng,
        }));
        setDepots(loadedDepots);
        setVehicles(loadedVehicles);
        
        const primaryDepot = loadedDepots.find((d) => 
          settings.depots.find((sd) => sd.name === d.name && sd.isPrimary)
        ) || loadedDepots[0];
        
        const firstVehicle = loadedVehicles[0];
        
        if (primaryDepot && firstVehicle) {
          const initialContext = {
            date: new Date().toISOString().split('T')[0],
            vehicleId: firstVehicle.id,
            vehicleName: firstVehicle.name,
            depotId: primaryDepot.id,
            depotName: primaryDepot.name,
          };
          setContext(initialContext);
          setRouteContext(initialContext.date, initialContext.vehicleId);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    }
    
    loadSettings();
  }, [isConnected, setRouteContext]);

  // Load saved route for selected day
  useEffect(() => {
    if (!isConnected || !context?.date) return;
    
    const dateToLoad = context.date;
    
    async function loadRoute() {
      setIsLoadingRoute(true);
      try {
        const response = await routeService.getRoute(dateToLoad);
        
        if (response.route && response.stops.length > 0) {
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
          
          const totalMin = response.route.totalDurationMinutes ?? 0;
          const serviceMin = stops.length * 30;
          const travelMin = totalMin - serviceMin;
          const workingDayMin = 9 * 60;
          
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

  // Update route cache context when context changes
  useEffect(() => {
    if (context?.date && context?.vehicleId) {
      setRouteContext(context.date, context.vehicleId);
    }
  }, [context?.date, context?.vehicleId, setRouteContext]);

  // Calculate insertion when candidate is selected (route-aware mode)
  useEffect(() => {
    if (!isConnected || !isRouteAware || !selectedCandidateId || !context) return;
    
    const candidate = candidates.find((c) => c.customerId === selectedCandidateId);
    if (!candidate || !candidate.customerLat || !candidate.customerLng) {
      setSlotSuggestions([]);
      return;
    }
    
    // Check cache first
    const cached = getCachedInsertion(candidate.id);
    if (cached) {
      // Use cached result - would need to store full slot suggestions
      // For now, still calculate but this could be optimized
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
            id: candidate!.id,
            customerId: candidate!.customerId,
            coordinates: { lat: candidate!.customerLat!, lng: candidate!.customerLng! },
            serviceDurationMinutes: 30,
          },
          date: context!.date,
        });
        
        // Convert to SlotSuggestion format
        const suggestions: SlotSuggestion[] = response.allPositions.map((pos, idx) => ({
          id: `slot-${idx}`,
          date: context!.date,
          timeStart: pos.estimatedArrival ?? '',
          timeEnd: pos.estimatedDeparture ?? '',
          status: pos.status as 'ok' | 'tight' | 'conflict',
          deltaKm: pos.deltaKm,
          deltaMin: pos.deltaMin,
          insertAfterIndex: pos.insertAfterIndex,
          insertAfterName: pos.insertAfterName,
          insertBeforeName: pos.insertBeforeName,
        }));
        
        setSlotSuggestions(suggestions);
        
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
                    suggestedSlots: suggestions,
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
  }, [isConnected, isRouteAware, selectedCandidateId, routeStops, context, depots, getCachedInsertion]);

  // Load candidates based on segment
  const loadCandidates = useCallback(async () => {
    if (!isConnected) return;
    
    setIsLoadingCandidates(true);
    try {
      const response = await getCallQueue(USER_ID, {
        priorityFilter: segment === 'overdue' ? 'overdue' : 'all',
        geocodedOnly: isRouteAware,
        limit: 100,
      });
      
      const loadedCandidates: InboxCandidate[] = response.items.map((item) => ({
        ...item,
        deltaKm: undefined,
        deltaMin: undefined,
        slotStatus: undefined,
        suggestedSlots: undefined,
      }));
      
      setCandidates(loadedCandidates);
      setSlotSuggestions([]);
      
      setSegmentCounts({
        overdue: loadedCandidates.filter((c) => getDaysOverdue(c) > 0).length,
        thisWeek: loadedCandidates.filter((c) => c.daysUntilDue <= 7).length,
        thisMonth: loadedCandidates.filter((c) => c.daysUntilDue <= 30).length,
        all: loadedCandidates.length,
        snoozed: 0, // Would need backend support
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

  // Batch calculate insertion metrics for visible candidates
  useEffect(() => {
    if (!isConnected || !isRouteAware || !context || candidates.length === 0) return;
    
    const depot = depots.find((d) => d.id === context.depotId);
    if (!depot) return;
    
    const validCandidates = candidates.filter(
      (c) => c.customerLat !== null && c.customerLng !== null && c.deltaKm === undefined
    );
    
    if (validCandidates.length === 0) return;
    
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
        
        // Cache results
        const cacheResults = response.results.map((r) => ({
          candidateId: r.candidateId,
          bestDeltaKm: r.bestDeltaKm,
          bestDeltaMin: r.bestDeltaMin,
          bestInsertAfterIndex: r.bestInsertAfterIndex,
          status: r.status as 'ok' | 'tight' | 'conflict',
          isFeasible: r.isFeasible,
          calculatedAt: Date.now(),
        }));
        setCachedInsertions(cacheResults);
        
        // Update candidates
        const resultsMap = new Map(response.results.map((r) => [r.candidateId, r]));
        
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
      } catch (err) {
        console.error('Failed to calculate batch insertion:', err);
      }
    }
    
    calculateBatch();
  }, [isConnected, isRouteAware, context, candidates, routeStops, depots, setCachedInsertions]);

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

  // Convert selected candidate to CandidateDetailData
  const selectedCandidateDetail: CandidateDetailData | null = useMemo(() => {
    if (!selectedCandidate) return null;
    
    return {
      id: selectedCandidate.id,
      customerId: selectedCandidate.customerId,
      customerName: selectedCandidate.customerName,
      deviceType: selectedCandidate.deviceType ?? 'Zařízení',
      deviceName: selectedCandidate.deviceName ?? undefined,
      phone: selectedCandidate.customerPhone ?? undefined,
      street: selectedCandidate.customerStreet ?? '',
      city: selectedCandidate.customerCity ?? '',
      dueDate: selectedCandidate.dueDate ?? new Date().toISOString(),
      daysUntilDue: selectedCandidate.daysUntilDue,
      priority: toPriority(selectedCandidate),
      suggestedSlots: slotSuggestions,
      insertionInfo: slotSuggestions[0] ? {
        insertAfterIndex: slotSuggestions[0].insertAfterIndex,
        insertAfterName: slotSuggestions[0].insertAfterName ?? 'Depo',
        insertBeforeIndex: slotSuggestions[0].insertAfterIndex + 1,
        insertBeforeName: slotSuggestions[0].insertBeforeName ?? 'Depo',
        deltaKm: slotSuggestions[0].deltaKm,
        deltaMin: slotSuggestions[0].deltaMin,
        estimatedArrival: slotSuggestions[0].timeStart,
        estimatedDeparture: slotSuggestions[0].timeEnd,
      } : undefined,
    };
  }, [selectedCandidate, slotSuggestions]);

  // Sorted candidates for display (pre-ranked by insertion cost)
  const sortedCandidates = useMemo(() => {
    let filtered = [...candidates];
    
    // Filter by segment
    switch (segment) {
      case 'overdue':
        filtered = filtered.filter((c) => getDaysOverdue(c) > 0);
        break;
      case 'thisWeek':
        filtered = filtered.filter((c) => c.daysUntilDue <= 7);
        break;
      case 'thisMonth':
        filtered = filtered.filter((c) => c.daysUntilDue <= 30);
        break;
      case 'problems':
        filtered = filtered.filter((c) => !hasPhone(c) || !hasValidAddress(c));
        break;
      // 'all' and 'snoozed' show all
    }
    
    if (!isRouteAware) {
      return filtered.sort((a, b) => {
        const aOverdue = getDaysOverdue(a);
        const bOverdue = getDaysOverdue(b);
        if (aOverdue !== bOverdue) return bOverdue - aOverdue;
        return a.daysUntilDue - b.daysUntilDue;
      });
    }
    
    return filtered.sort((a, b) => {
      const aValid = hasValidAddress(a);
      const bValid = hasValidAddress(b);
      if (aValid !== bValid) return aValid ? -1 : 1;
      
      const aHasMetrics = a.deltaMin !== undefined;
      const bHasMetrics = b.deltaMin !== undefined;
      if (aHasMetrics !== bHasMetrics) return aHasMetrics ? -1 : 1;
      
      if (a.slotStatus && b.slotStatus) {
        const statusOrder = { ok: 0, tight: 1, conflict: 2 };
        const statusDiff = statusOrder[a.slotStatus] - statusOrder[b.slotStatus];
        if (statusDiff !== 0) return statusDiff;
      }
      
      if (a.deltaMin !== undefined && b.deltaMin !== undefined) {
        return a.deltaMin - b.deltaMin;
      }
      
      const aOverdue = getDaysOverdue(a);
      const bOverdue = getDaysOverdue(b);
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      return a.daysUntilDue - b.daysUntilDue;
    });
  }, [candidates, isRouteAware, segment]);

  // Convert to CandidateRowData for VirtualizedInboxList
  const candidateRowData: CandidateRowData[] = useMemo(() => {
    return sortedCandidates.map((c) => ({
      id: c.customerId,
      customerName: c.customerName,
      city: c.customerCity ?? '',
      deviceType: c.deviceType,
      daysUntilDue: c.daysUntilDue,
      hasPhone: hasPhone(c),
      hasValidAddress: hasValidAddress(c),
      priority: toPriority(c),
      deltaKm: c.deltaKm,
      deltaMin: c.deltaMin,
      slotStatus: c.slotStatus,
    }));
  }, [sortedCandidates]);

  // Problem candidates for ProblemsSegment
  const problemCandidates: ProblemCandidate[] = useMemo(() => {
    return candidates
      .filter((c) => !hasPhone(c) || !hasValidAddress(c))
      .map((c) => {
        const problems: ProblemType[] = [];
        if (!hasPhone(c)) problems.push('no_phone');
        if (!hasValidAddress(c)) {
          if (c.customerGeocodeStatus === 'failed') {
            problems.push('geocode_failed');
          } else if (!c.customerLat || !c.customerLng) {
            problems.push('no_coordinates');
          } else {
            problems.push('no_address');
          }
        }
        return {
          id: c.customerId,
          customerName: c.customerName,
          city: c.customerCity ?? '',
          problems,
        };
      });
  }, [candidates]);

  // Handle context changes
  const handleDateChange = (date: string) => {
    setContext((prev) => prev ? { ...prev, date } : null);
    invalidateCache();
  };

  const handleVehicleChange = (vehicleId: string) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    setContext((prev) => prev ? { 
      ...prev, 
      vehicleId, 
      vehicleName: vehicle?.name ?? '' 
    } : null);
    invalidateCache();
  };

  const handleDepotChange = (depotId: string) => {
    const depot = depots.find((d) => d.id === depotId);
    setContext((prev) => prev ? { 
      ...prev, 
      depotId, 
      depotName: depot?.name ?? '' 
    } : null);
    invalidateCache();
  };

  // Action handlers
  const handleSchedule = useCallback(async (candidateId: string, slot: SlotSuggestion) => {
    const candidate = candidates.find((c) => c.id === candidateId || c.customerId === candidateId);
    if (!candidate) return;
    
    try {
      await scheduleRevision(USER_ID, {
        id: candidate.id,
        scheduledDate: slot.date,
        timeWindowStart: slot.timeStart,
        timeWindowEnd: slot.timeEnd,
      });
      
      // Remove from list
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
      setSelectedCandidateId(null);
      setSlotSuggestions([]);
      
      // Invalidate route cache since route changed
      incrementRouteVersion();
      
      setHasChanges(true);
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to schedule:', err);
    }
  }, [candidates, incrementRouteVersion]);

  const handleSnooze = useCallback(async (candidateId: string) => {
    const candidate = candidates.find((c) => c.id === candidateId || c.customerId === candidateId);
    if (!candidate) return;
    
    // Snooze for 7 days by default
    const snoozeDate = new Date();
    snoozeDate.setDate(snoozeDate.getDate() + 7);
    
    try {
      await snoozeRevision(USER_ID, {
        id: candidate.id,
        snoozeUntil: snoozeDate.toISOString().split('T')[0],
      });
      
      // Remove from list
      setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
      setSelectedCandidateId(null);
      setSlotSuggestions([]);
    } catch (err) {
      console.error('Failed to snooze:', err);
    }
  }, [candidates]);

  const handleFixAddress = useCallback((candidateId: string) => {
    navigate({ to: '/customers/$customerId', params: { customerId: candidateId } });
  }, [navigate]);

  // Draft mode handlers
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      // Route changes are saved automatically via scheduleRevision
      // This would save any pending route optimizations
      setHasChanges(false);
      setLastSaved(new Date());
    } finally {
      setIsSaving(false);
    }
  }, []);

  const handleDiscard = useCallback(() => {
    // Reload candidates to discard local changes
    loadCandidates();
    setHasChanges(false);
  }, [loadCandidates]);

  // Keyboard shortcuts handlers
  const handleMoveUp = useCallback(() => {
    if (candidateRowData.length === 0) return;
    
    const currentIndex = selectedCandidateId 
      ? candidateRowData.findIndex((c) => c.id === selectedCandidateId)
      : -1;
    
    const newIndex = currentIndex <= 0 ? candidateRowData.length - 1 : currentIndex - 1;
    const newId = candidateRowData[newIndex].id;
    setSelectedCandidateId(newId);
    listRef.current?.scrollToIndex(newIndex);
  }, [candidateRowData, selectedCandidateId]);

  const handleMoveDown = useCallback(() => {
    if (candidateRowData.length === 0) return;
    
    const currentIndex = selectedCandidateId 
      ? candidateRowData.findIndex((c) => c.id === selectedCandidateId)
      : -1;
    
    const newIndex = currentIndex >= candidateRowData.length - 1 ? 0 : currentIndex + 1;
    const newId = candidateRowData[newIndex].id;
    setSelectedCandidateId(newId);
    listRef.current?.scrollToIndex(newIndex);
  }, [candidateRowData, selectedCandidateId]);

  const handleSelectSlot = useCallback((index: number) => {
    if (slotSuggestions.length > index && selectedCandidateId) {
      handleSchedule(selectedCandidateId, slotSuggestions[index]);
    }
  }, [slotSuggestions, selectedCandidateId, handleSchedule]);

  const handleScheduleShortcut = useCallback(() => {
    if (selectedCandidateId && slotSuggestions[0]) {
      handleSchedule(selectedCandidateId, slotSuggestions[0]);
    }
  }, [selectedCandidateId, slotSuggestions, handleSchedule]);

  const handleSnoozeShortcut = useCallback(() => {
    if (selectedCandidateId) {
      handleSnooze(selectedCandidateId);
    }
  }, [selectedCandidateId, handleSnooze]);

  const handleFixAddressShortcut = useCallback(() => {
    if (selectedCandidateId) {
      handleFixAddress(selectedCandidateId);
    }
  }, [selectedCandidateId, handleFixAddress]);

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
    onSchedule: handleScheduleShortcut,
    onSnooze: handleSnoozeShortcut,
    onFixAddress: handleFixAddressShortcut,
    onSearch: handleSearch,
    onEscape: handleEscape,
    enabled: true,
  });

  // Handle candidate selection
  const handleCandidateSelect = useCallback((id: string) => {
    setSelectedCandidateId(id);
  }, []);

  // Render inbox list panel
  const renderInboxList = () => (
    <div className={styles.inboxPanel}>
      <div className={styles.segmentTabs}>
        {([
          { key: 'overdue', label: 'Po termínu', count: segmentCounts.overdue },
          { key: 'thisWeek', label: 'Týden', count: segmentCounts.thisWeek },
          { key: 'thisMonth', label: '30 dní', count: segmentCounts.thisMonth },
          { key: 'all', label: 'Vše', count: segmentCounts.all },
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
      
      {/* Problems segment at top when viewing problems */}
      {segment === 'problems' && problemCandidates.length > 0 && (
        <ProblemsSegment
          candidates={problemCandidates}
          isCollapsed={isProblemsCollapsed}
          onToggleCollapse={() => setIsProblemsCollapsed(!isProblemsCollapsed)}
          onFixAddress={handleFixAddress}
          onViewCustomer={handleCandidateSelect}
        />
      )}
      
      {/* Multi-vehicle tip */}
      {isRouteAware && vehicleComparisons.length > 0 && (
        <MultiVehicleTip
          currentVehicle={context?.vehicleName ?? ''}
          comparisons={vehicleComparisons}
          onSwitchVehicle={(vehicleId) => handleVehicleChange(vehicleId)}
        />
      )}
      
      {/* Virtualized candidate list */}
      <VirtualizedInboxList
        ref={listRef}
        candidates={candidateRowData}
        selectedCandidateId={selectedCandidateId}
        isRouteAware={isRouteAware}
        onCandidateSelect={handleCandidateSelect}
        isLoading={isLoadingCandidates}
        emptyMessage={segment === 'problems' 
          ? 'Žádní problémový kandidáti' 
          : 'Žádní kandidáti v tomto segmentu'}
        className={styles.candidateList}
      />
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
      <CandidateDetail
        candidate={selectedCandidateDetail}
        isRouteAware={isRouteAware}
        onSchedule={handleSchedule}
        onSnooze={handleSnooze}
        onFixAddress={handleFixAddress}
        isLoading={isCalculatingSlots}
      />
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
      
      <DraftModeBar
        hasChanges={hasChanges}
        isSaving={isSaving}
        lastSaved={lastSaved}
        onSave={handleSave}
        onDiscard={handleDiscard}
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
