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
  type SelectedCandidate,
  CandidateDetail,
  type CandidateDetailData,
  VirtualizedInboxList,
  type VirtualizedInboxListRef,
  type CandidateRowData,
  ProblemsSegment,
  type ProblemCandidate,
  type ProblemType,
  MultiCrewTip,
  type CrewComparison,
  type SlotSuggestion,
  RouteStopList,
} from '../components/planner';
import { DraftModeBar } from '../components/planner/DraftModeBar';
import { ThreePanelLayout } from '../components/common';
import * as settingsService from '../services/settingsService';
import * as crewService from '../services/crewService';
import * as routeService from '../services/routeService';
import * as insertionService from '../services/insertionService';
import * as geometryService from '../services/geometryService';
import { getCallQueue, snoozeRevision, scheduleRevision, type CallQueueItem } from '../services/revisionService';
import { usePlannerShortcuts } from '../hooks/useKeyboardShortcuts';
import styles from './PlanningInbox.module.css';

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
  const sortedCandidatesRef = useRef<InboxCandidate[]>([]);
  
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
  const [crews, setCrews] = useState<crewService.Crew[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  
  // Route state
  const [routeStops, setRouteStops] = useState<MapStop[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [metrics, setMetrics] = useState<RouteMetrics | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const geometryUnsubRef = useRef<(() => void) | null>(null);
  
  // Inbox state - restore from sessionStorage
  const [segment, setSegment] = useState<InboxSegment>(() => {
    const saved = sessionStorage.getItem('planningInbox.segment');
    return (saved as InboxSegment) || 'thisWeek';
  });
  const [candidates, setCandidates] = useState<InboxCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(() => {
    return sessionStorage.getItem('planningInbox.selectedId');
  });
  
  // Detail state
  const [slotSuggestions, setSlotSuggestions] = useState<SlotSuggestion[]>([]);
  const [isCalculatingSlots, setIsCalculatingSlots] = useState(false);
  
  // Draft mode state
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  // Multi-crew state (TODO: implement multi-crew comparison)
  const [crewComparisons, _setCrewComparisons] = useState<CrewComparison[]>([]);
  
  // Route building state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [routeJobProgress, setRouteJobProgress] = useState<string | null>(null);
  
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

  // Load settings (crews, depots)
  useEffect(() => {
    if (!isConnected) return;
    
    async function loadSettings() {
      try {
        // Load settings and crews independently - don't let one failure block the other
        const [settingsResult, crewsResult] = await Promise.allSettled([
          settingsService.getSettings(),
          crewService.listCrews(true),
        ]);
        
        const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : null;
        const loadedVehicles = crewsResult.status === 'fulfilled' ? crewsResult.value : [];
        
        if (settingsResult.status === 'rejected') {
          console.warn('Failed to load settings:', settingsResult.reason);
        }
        if (crewsResult.status === 'rejected') {
          console.warn('Failed to load crews (worker may not be running):', crewsResult.reason);
        }
        
        const loadedDepots = settings ? settings.depots.map((d) => ({
          id: d.name,
          name: d.name,
          lat: d.lat,
          lng: d.lng,
        })) : [];
        setDepots(loadedDepots);
        setCrews(loadedVehicles);
        
        // Build initial context with whatever data we have
        const primaryDepot = loadedDepots.find((d) => 
          settings?.depots.find((sd) => sd.name === d.name && sd.isPrimary)
        ) || loadedDepots[0];
        
        const firstCrew = loadedVehicles[0];
        
        const initialContext: RouteContext = {
          date: new Date().toISOString().split('T')[0],
          crewId: firstCrew?.id ?? '',
          crewName: firstCrew?.name ?? '',
          depotId: primaryDepot?.id ?? '',
          depotName: primaryDepot?.name ?? '',
        };
        setContext(initialContext);
        
        if (initialContext.crewId) {
          setRouteContext(initialContext.date, initialContext.crewId);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
        // Still set a minimal context so the page is usable
        setContext({
          date: new Date().toISOString().split('T')[0],
          crewId: '',
          crewName: '',
          depotId: '',
          depotName: '',
        });
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

  // Fetch Valhalla route geometry when route stops change
  const fetchRouteGeometry = useCallback(async (stops: MapStop[], depot: { lat: number; lng: number } | null) => {
    if (stops.length < 1) {
      setRouteGeometry([]);
      return;
    }

    // Build locations: depot → stops → depot (or just stops if no depot)
    const locations = depot
      ? [
          { lat: depot.lat, lng: depot.lng },
          ...stops.map((s) => ({ lat: s.coordinates.lat, lng: s.coordinates.lng })),
          { lat: depot.lat, lng: depot.lng },
        ]
      : stops.map((s) => ({ lat: s.coordinates.lat, lng: s.coordinates.lng }));

    try {
      // Cancel previous subscription
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }

      console.log('[PlanningInbox] Submitting geometry job for', locations.length, 'locations');
      const jobResponse = await geometryService.submitGeometryJob(locations);
      console.log('[PlanningInbox] Geometry job submitted, jobId:', jobResponse.jobId);

      const unsubscribe = await geometryService.subscribeToGeometryJobStatus(
        jobResponse.jobId,
        (update) => {
          console.log('[PlanningInbox] Geometry job status update:', update);
          if (update.status.type === 'completed') {
            console.log('[PlanningInbox] Setting route geometry, coordinates count:', update.status.coordinates.length);
            setRouteGeometry(update.status.coordinates);
            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          } else if (update.status.type === 'failed') {
            console.warn('Geometry job failed:', update.status.error);
            // Keep existing geometry or clear it
            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          }
        },
      );

      geometryUnsubRef.current = unsubscribe;
    } catch (err) {
      console.warn('Failed to submit geometry job:', err);
    }
  }, []);

  // Trigger geometry fetch whenever route stops or depot change
  useEffect(() => {
    if (!isConnected || routeStops.length === 0) {
      setRouteGeometry([]);
      return;
    }

    const depot = depots.find((d) => d.id === context?.depotId) ?? null;

    fetchRouteGeometry(routeStops, depot);

    return () => {
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }
    };
  }, [isConnected, routeStops, context?.depotId, depots, fetchRouteGeometry]);

  // Update route cache context when context changes
  useEffect(() => {
    if (context?.date && context?.crewId) {
      setRouteContext(context.date, context.crewId);
    }
  }, [context?.date, context?.crewId, setRouteContext]);

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
      const response = await getCallQueue({
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

  // Selected candidate for map preview (before adding to route)
  const selectedCandidateForMap: SelectedCandidate | null = useMemo(() => {
    if (!selectedCandidate) return null;
    if (!selectedCandidate.customerLat || !selectedCandidate.customerLng) return null;
    return {
      id: selectedCandidate.customerId,
      name: selectedCandidate.customerName,
      coordinates: {
        lat: selectedCandidate.customerLat,
        lng: selectedCandidate.customerLng,
      },
    };
  }, [selectedCandidate]);

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

  // Keep ref in sync for use in callbacks
  sortedCandidatesRef.current = sortedCandidates;

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

  const handleCrewChange = (crewId: string) => {
    const crew = crews.find((v) => v.id === crewId);
    setContext((prev) => prev ? { 
      ...prev, 
      crewId, 
      crewName: crew?.name ?? '' 
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

  // Helper: after removing a candidate, select the next one in the list
  const selectNextCandidate = useCallback((removedId: string) => {
    const currentList = sortedCandidatesRef.current;
    const idx = currentList.findIndex((c) => c.customerId === removedId || c.id === removedId);
    if (idx >= 0 && currentList.length > 1) {
      const nextIdx = idx < currentList.length - 1 ? idx + 1 : idx - 1;
      const nextId = currentList[nextIdx].customerId;
      setSelectedCandidateId(nextId);
      sessionStorage.setItem('planningInbox.selectedId', nextId);
    } else {
      setSelectedCandidateId(null);
      sessionStorage.removeItem('planningInbox.selectedId');
    }
  }, []);

  // Action handlers
  const handleSchedule = useCallback(async (candidateId: string, slot: SlotSuggestion) => {
    const candidate = candidates.find((c) => c.id === candidateId || c.customerId === candidateId);
    if (!candidate) return;
    
    try {
      await scheduleRevision({
        id: candidate.id,
        scheduledDate: slot.date,
        timeWindowStart: slot.timeStart,
        timeWindowEnd: slot.timeEnd,
      });
      
      // Select next before removing
      selectNextCandidate(candidate.customerId);
      
      // Remove from list and update counts
      setCandidates((prev) => {
        const updated = prev.filter((c) => c.id !== candidate.id);
        setSegmentCounts({
          overdue: updated.filter((c) => getDaysOverdue(c) > 0).length,
          thisWeek: updated.filter((c) => c.daysUntilDue <= 7).length,
          thisMonth: updated.filter((c) => c.daysUntilDue <= 30).length,
          all: updated.length,
          snoozed: 0,
          problems: updated.filter((c) => !hasPhone(c) || !hasValidAddress(c)).length,
        });
        return updated;
      });
      setSlotSuggestions([]);
      
      // Invalidate route cache since route changed
      incrementRouteVersion();
      
      setHasChanges(true);
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to schedule:', err);
    }
  }, [candidates, incrementRouteVersion, selectNextCandidate]);

  const handleSnooze = useCallback(async (candidateId: string) => {
    const candidate = candidates.find((c) => c.id === candidateId || c.customerId === candidateId);
    if (!candidate) return;
    
    // Snooze for 7 days by default
    const snoozeDate = new Date();
    snoozeDate.setDate(snoozeDate.getDate() + 7);
    
    try {
      await snoozeRevision({
        id: candidate.id,
        snoozeUntil: snoozeDate.toISOString().split('T')[0],
      });
      
      // Select next before removing
      selectNextCandidate(candidate.customerId);
      
      // Remove from list and update counts
      setCandidates((prev) => {
        const updated = prev.filter((c) => c.id !== candidate.id);
        setSegmentCounts({
          overdue: updated.filter((c) => getDaysOverdue(c) > 0).length,
          thisWeek: updated.filter((c) => c.daysUntilDue <= 7).length,
          thisMonth: updated.filter((c) => c.daysUntilDue <= 30).length,
          all: updated.length,
          snoozed: 0,
          problems: updated.filter((c) => !hasPhone(c) || !hasValidAddress(c)).length,
        });
        return updated;
      });
      setSlotSuggestions([]);
    } catch (err) {
      console.error('Failed to snooze:', err);
    }
  }, [candidates]);

  const handleFixAddress = useCallback((candidateId: string) => {
    navigate({ to: '/customers/$customerId', params: { customerId: candidateId } });
  }, [navigate]);

  // Compute set of candidate IDs that are currently in the route
  const inRouteIds = useMemo(() => {
    return new Set(routeStops.map((s) => s.id));
  }, [routeStops]);

  // Route building: toggle checkbox selection
  const handleSelectionChange = useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // Route building: add selected candidates to route
  const handleAddSelectedToRoute = useCallback(() => {
    if (selectedIds.size === 0) return;

    const newStops: MapStop[] = [];
    selectedIds.forEach((customerId) => {
      // Skip if already in route
      if (inRouteIds.has(customerId)) return;

      const candidate = candidates.find((c) => c.customerId === customerId);
      if (!candidate || !candidate.customerLat || !candidate.customerLng) return;

      newStops.push({
        id: candidate.customerId,
        name: candidate.customerName,
        address: `${candidate.customerStreet ?? ''}, ${candidate.customerCity ?? ''}`.replace(/^, |, $/g, ''),
        coordinates: {
          lat: candidate.customerLat,
          lng: candidate.customerLng,
        },
        order: routeStops.length + newStops.length + 1,
      });
    });

    if (newStops.length > 0) {
      setRouteStops((prev) => [...prev, ...newStops]);
      setSelectedIds(new Set());
      setHasChanges(true);
      incrementRouteVersion();
    }
  }, [selectedIds, inRouteIds, candidates, routeStops.length, incrementRouteVersion]);

  // Route building: add single candidate from detail panel
  const handleAddToRoute = useCallback((candidateId: string) => {
    const candidate = candidates.find((c) => c.id === candidateId || c.customerId === candidateId);
    if (!candidate || !candidate.customerLat || !candidate.customerLng) return;
    if (inRouteIds.has(candidate.customerId)) return;

    const newStop: MapStop = {
      id: candidate.customerId,
      name: candidate.customerName,
      address: `${candidate.customerStreet ?? ''}, ${candidate.customerCity ?? ''}`.replace(/^, |, $/g, ''),
      coordinates: {
        lat: candidate.customerLat,
        lng: candidate.customerLng,
      },
      order: routeStops.length + 1,
    };

    setRouteStops((prev) => [...prev, newStop]);
    setHasChanges(true);
    incrementRouteVersion();
  }, [candidates, inRouteIds, routeStops.length, incrementRouteVersion]);

  // Route building: remove stop from route
  const handleRemoveFromRoute = useCallback((stopId: string) => {
    setRouteStops((prev) => {
      const filtered = prev.filter((s) => s.id !== stopId);
      // Renumber
      return filtered.map((s, i) => ({ ...s, order: i + 1 }));
    });
    setHasChanges(true);
    incrementRouteVersion();
  }, [incrementRouteVersion]);

  // Route building: optimize route via VRP solver
  const handleOptimizeRoute = useCallback(async () => {
    if (routeStops.length < 2 || !context) return;

    const depot = depots.find((d) => d.id === context.depotId);
    
    // Use first stop as fallback start location if no depot
    const startLocation = depot
      ? { lat: depot.lat, lng: depot.lng }
      : { lat: routeStops[0].coordinates.lat, lng: routeStops[0].coordinates.lng };

    setIsOptimizing(true);
    setRouteJobProgress('Odesílám do optimalizátoru...');

    try {
      const customerIds = routeStops.map((s) => s.id);
      const jobResponse = await routeService.submitRoutePlanJob({
        customerIds,
        date: context.date,
        startLocation,
      });

      setRouteJobProgress('Ve frontě...');

      // Subscribe to status updates
      const unsubscribe = await routeService.subscribeToRouteJobStatus(
        jobResponse.jobId,
        (update) => {
          switch (update.status.type) {
            case 'queued':
              setRouteJobProgress(`Ve frontě (pozice ${update.status.position})`);
              break;
            case 'processing':
              setRouteJobProgress(`Optimalizuji... ${update.status.progress}%`);
              break;
            case 'completed': {
              const result = update.status.result;
              if (result.stops && result.stops.length > 0) {
                const optimizedStops: MapStop[] = result.stops.map((s, i) => ({
                  id: s.customerId,
                  name: s.customerName,
                  address: s.address,
                  coordinates: s.coordinates,
                  order: i + 1,
                  eta: s.eta,
                  etd: s.etd,
                }));
                setRouteStops(optimizedStops);

                // Capture Valhalla geometry from VRP result
                if (result.geometry && result.geometry.length > 0) {
                  setRouteGeometry(result.geometry);
                }

                // Update metrics
                const totalMin = result.totalDurationMinutes ?? 0;
                const serviceMin = optimizedStops.length * 30;
                const travelMin = totalMin - serviceMin;
                const workingDayMin = 9 * 60;

                setMetrics({
                  distanceKm: result.totalDistanceKm ?? 0,
                  travelTimeMin: Math.max(0, travelMin),
                  serviceTimeMin: serviceMin,
                  loadPercent: Math.round((totalMin / workingDayMin) * 100),
                  slackMin: Math.max(0, workingDayMin - totalMin),
                  stopCount: optimizedStops.length,
                });
              }
              setRouteJobProgress(null);
              setIsOptimizing(false);
              setHasChanges(true);
              unsubscribe();
              break;
            }
            case 'failed':
              setRouteJobProgress(`Chyba: ${update.status.error}`);
              setIsOptimizing(false);
              setTimeout(() => setRouteJobProgress(null), 5000);
              unsubscribe();
              break;
          }
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to optimize route:', message, err);
      setRouteJobProgress(`Chyba: ${message}`);
      setIsOptimizing(false);
      setTimeout(() => setRouteJobProgress(null), 8000);
    }
  }, [routeStops, context, depots]);

  // Route building: save route to backend
  const handleSaveRoute = useCallback(async () => {
    if (routeStops.length === 0 || !context) return;

    setIsSaving(true);
    try {
      await routeService.saveRoute({
        date: context.date,
        stops: routeStops.map((s) => ({
          customerId: s.id,
          order: s.order ?? 0,
          eta: s.eta,
          etd: s.etd,
        })),
        totalDistanceKm: metrics?.distanceKm ?? 0,
        totalDurationMinutes: (metrics?.travelTimeMin ?? 0) + (metrics?.serviceTimeMin ?? 0),
        optimizationScore: 0,
      });
      setHasChanges(false);
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to save route:', err);
    } finally {
      setIsSaving(false);
    }
  }, [routeStops, context, metrics]);

  // Route building: clear all stops
  const handleClearRoute = useCallback(() => {
    setRouteStops([]);
    setRouteGeometry([]);
    setMetrics(null);
    setSelectedIds(new Set());
    setHasChanges(true);
    incrementRouteVersion();
  }, [incrementRouteVersion]);

  // Draft mode handlers — delegates to handleSaveRoute for the route,
  // then clears the unsaved-changes flag.
  const handleSave = useCallback(async () => {
    if (routeStops.length > 0 && context) {
      await handleSaveRoute();
    } else {
      // Nothing concrete to persist — just clear the flag
      setHasChanges(false);
      setLastSaved(new Date());
    }
  }, [routeStops, context, handleSaveRoute]);

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
    sessionStorage.setItem('planningInbox.selectedId', id);
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
            onClick={() => {
              setSegment(key);
              sessionStorage.setItem('planningInbox.segment', key);
            }}
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
      
      {/* Multi-crew tip */}
      {isRouteAware && crewComparisons.length > 0 && (
        <MultiCrewTip
          currentCrew={context?.crewName ?? ''}
          comparisons={crewComparisons}
          onSwitchCrew={(crewId) => handleCrewChange(crewId)}
        />
      )}
      
      {/* Add to route toolbar */}
      {selectedIds.size > 0 && (
        <div className={styles.selectionToolbar}>
          <span className={styles.selectionCount}>{selectedIds.size} vybráno</span>
          <button
            type="button"
            className={styles.addSelectedButton}
            onClick={handleAddSelectedToRoute}
          >
            ➕ Přidat do trasy
          </button>
          <button
            type="button"
            className={styles.clearSelectionButton}
            onClick={() => setSelectedIds(new Set())}
          >
            Zrušit výběr
          </button>
        </div>
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
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
        inRouteIds={inRouteIds}
      />
    </div>
  );

  // Render map panel with route stop list below
  const renderMapPanel = () => (
    <div className={styles.mapPanel}>
      <div className={styles.mapSection}>
        <RouteMapPanel
          stops={routeStops}
          depot={currentDepot}
          routeGeometry={routeGeometry}
          highlightedStopId={selectedCandidateId}
          selectedCandidate={selectedCandidateForMap}
          isLoading={isLoadingRoute}
        />
      </div>
      <div className={styles.routeStopSection}>
        <RouteStopList
          stops={routeStops}
          metrics={metrics}
          onRemoveStop={handleRemoveFromRoute}
          onOptimize={handleOptimizeRoute}
          onSave={handleSaveRoute}
          onClear={handleClearRoute}
          isOptimizing={isOptimizing}
          isSaving={isSaving}
          jobProgress={routeJobProgress}
        />
      </div>
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
        onAddToRoute={handleAddToRoute}
        onRemoveFromRoute={handleRemoveFromRoute}
        isInRoute={selectedCandidateId ? inRouteIds.has(selectedCandidateId) : false}
        routeDate={context?.date}
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
        onCrewChange={handleCrewChange}
        onDepotChange={handleDepotChange}
        crews={crews}
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
          center={renderDetailPanel()}
          right={renderMapPanel()}
          leftWidth={22}
          centerWidth={33}
          rightWidth={45}
          className={styles.splitLayout}
        />
      </div>
    </div>
  );
}
