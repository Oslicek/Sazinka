import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import { useRouteCacheStore } from '../stores/routeCacheStore';
import { useAutoSave } from '../hooks/useAutoSave';
import { 
  RouteContextHeader, 
  type RouteContext,
  type RouteMetrics,
  RouteMapPanel,
  type MapDepot,
  type SelectedCandidate,
  type MapInsertionPreview as InsertionPreview,
  CandidateDetail,
  type CandidateDetailData,
  VirtualizedInboxList,
  type VirtualizedInboxListRef,
  type CandidateRowData,
  MultiCrewTip,
  type CrewComparison,
  type SlotSuggestion,
  RouteDetailTimeline,
} from '../components/planner';
import { DraftModeBar } from '../components/planner/DraftModeBar';
import { ThreePanelLayout } from '../components/common';
import type { SavedRouteStop } from '../services/routeService';
import type { BreakSettings } from '@shared/settings';
import * as settingsService from '../services/settingsService';
import { calculateBreakPosition, createBreakStop } from '../utils/breakUtils';
import * as crewService from '../services/crewService';
import * as routeService from '../services/routeService';
import * as insertionService from '../services/insertionService';
import * as geometryService from '../services/geometryService';
import { getCallQueue, snoozeRevision, scheduleRevision, type CallQueueItem } from '../services/revisionService';
import { listCalendarItems } from '../services/calendarService';
import type { CalendarItem } from '@shared/calendar';
import { usePlannerShortcuts } from '../hooks/useKeyboardShortcuts';
import type { RouteWarning } from '@shared/route';
import {
  DEFAULT_FILTER_EXPRESSION,
  FILTER_PRESETS,
  applyFilterPreset,
  applyInboxFilters,
  buildFilterSummary,
  getActiveFilterCount,
  hasPhone,
  hasAdvancedCriteria,
  hasValidAddress,
  isScheduledCandidate,
  mapExpressionToCallQueueRequestV1,
  normalizeExpression,
  toggleToken,
  type FilterPresetId,
  type GroupOperator,
  type InboxFilterExpression,
  type ProblemToken,
  type TimeToken,
  type TriState,
} from './planningInboxFilters';
import styles from './PlanningInbox.module.css';

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
  _scheduled?: boolean;
  _scheduledDate?: string;
  _scheduledTimeStart?: string;
  _scheduledTimeEnd?: string;
}

const DEFAULT_BREAK_SETTINGS: BreakSettings = {
  breakEnabled: true,
  breakDurationMinutes: 45,
  breakEarliestTime: '11:30',
  breakLatestTime: '13:00',
  breakMinKm: 40,
  breakMaxKm: 120,
};

// Helper to check if customer is overdue
function getDaysOverdue(item: CallQueueItem): number {
  return item.daysUntilDue < 0 ? Math.abs(item.daysUntilDue) : 0;
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
  const [defaultServiceDurationMinutes, setDefaultServiceDurationMinutes] = useState(30);
  const [breakSettings, setBreakSettings] = useState<BreakSettings | null>(null);
  const [enforceDrivingBreakRule, setEnforceDrivingBreakRule] = useState<boolean>(() => {
    const raw = localStorage.getItem('planningInbox.enforceDrivingBreakRule');
    return raw === null ? true : raw === 'true';
  });
  
  // Route state
  const [routeStops, setRouteStops] = useState<SavedRouteStop[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [routeWarnings, setRouteWarnings] = useState<RouteWarning[]>([]);
  const [breakWarnings, setBreakWarnings] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<RouteMetrics | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const geometryUnsubRef = useRef<(() => void) | null>(null);
  
  // Inbox state - restore from sessionStorage
  const [filters, setFilters] = useState<InboxFilterExpression>(() => {
    const raw = sessionStorage.getItem('planningInbox.filters');
    if (!raw) return DEFAULT_FILTER_EXPRESSION;

    try {
      return normalizeExpression(JSON.parse(raw));
    } catch {
      return DEFAULT_FILTER_EXPRESSION;
    }
  });
  const [candidates, setCandidates] = useState<InboxCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(() => {
    return sessionStorage.getItem('planningInbox.selectedId');
  });
  
  // Map/timeline highlighting state
  const [highlightedSegment, setHighlightedSegment] = useState<number | null>(null);
  
  // Detail state
  const [slotSuggestions, setSlotSuggestions] = useState<SlotSuggestion[]>([]);
  const [isCalculatingSlots, setIsCalculatingSlots] = useState(false);
  
  // Confirmation state - shows after scheduling
  const [scheduledConfirmation, setScheduledConfirmation] = useState<{
    candidateId: string;
    candidateName: string;
    date: string;
    timeStart: string;
    timeEnd: string;
  } | null>(null);
  
  // Day overview state - shows all visits for scheduled day in right panel
  const [dayOverview, setDayOverview] = useState<{
    date: string;
    items: CalendarItem[];
    isLoading: boolean;
  } | null>(null);
  const dayOverviewGeometryUnsubRef = useRef<(() => void) | null>(null);
  const [dayOverviewGeometry, setDayOverviewGeometry] = useState<[number, number][]>([]);
  const [dayOverviewStops, setDayOverviewStops] = useState<SavedRouteStop[]>([]);
  
  // Draft mode state (auto-save)
  const [hasChanges, setHasChanges] = useState(false);
  
  // Multi-crew state (TODO: implement multi-crew comparison)
  const [crewComparisons, _setCrewComparisons] = useState<CrewComparison[]>([]);
  
  // Route building state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [routeJobProgress, setRouteJobProgress] = useState<string | null>(null);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [activePresetId, setActivePresetId] = useState<FilterPresetId | null>(null);

  useEffect(() => {
    localStorage.setItem('planningInbox.enforceDrivingBreakRule', String(enforceDrivingBreakRule));
  }, [enforceDrivingBreakRule]);
  
  // Auto-save route
  const autoSaveFn = useCallback(async () => {
    if (routeStops.length === 0 || !context) return;
    // Sanitize: convert empty/invalid UUID strings to undefined so they are omitted from JSON
    const sanitizeUuid = (v: string | null | undefined): string | undefined =>
      v && v.length >= 8 ? v : undefined;
    await routeService.saveRoute({
      date: context.date,
      depotId: sanitizeUuid(context.depotId) ?? null,
      stops: routeStops.map((s, index) => ({
        customerId: s.stopType === 'customer' ? (s.customerId ?? undefined) : undefined,
        revisionId: sanitizeUuid(s.revisionId),
        order: s.stopOrder ?? index + 1,
        eta: s.estimatedArrival || undefined,
        etd: s.estimatedDeparture || undefined,
        stopType: s.stopType,
        breakDurationMinutes: s.stopType === 'break' ? (s.breakDurationMinutes ?? undefined) : undefined,
        breakTimeStart: s.stopType === 'break' ? (s.breakTimeStart ?? undefined) : undefined,
      })),
      totalDistanceKm: metrics?.distanceKm ?? 0,
      totalDurationMinutes: (metrics?.travelTimeMin ?? 0) + (metrics?.serviceTimeMin ?? 0),
      optimizationScore: 0,
    });
    setHasChanges(false);
  }, [routeStops, context, metrics]);

  const { isSaving, lastSaved, saveError, retry: retrySave } = useAutoSave({
    saveFn: autoSaveFn,
    hasChanges,
    debounceMs: 1500,
    enabled: routeStops.length > 0 && !!context,
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
        
        // Store default service duration and break settings
        if (settings?.workConstraints?.defaultServiceDurationMinutes) {
          setDefaultServiceDurationMinutes(settings.workConstraints.defaultServiceDurationMinutes);
        }
        setBreakSettings(settings?.breakSettings ?? DEFAULT_BREAK_SETTINGS);
        
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
        const response = await routeService.getRoute({ date: dateToLoad });
        
        if (response.route && response.stops.length > 0) {
          setRouteStops(response.stops);
          
          const totalMin = response.route.totalDurationMinutes ?? 0;
          const serviceMin = response.stops.length * 30;
          const travelMin = totalMin - serviceMin;
          const workingDayMin = 9 * 60;
          
          setMetrics({
            distanceKm: response.route.totalDistanceKm ?? 0,
            travelTimeMin: Math.max(0, travelMin),
            serviceTimeMin: serviceMin,
            loadPercent: Math.round((totalMin / workingDayMin) * 100),
            slackMin: Math.max(0, workingDayMin - totalMin),
            stopCount: response.stops.length,
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
  const fetchRouteGeometry = useCallback(async (stops: SavedRouteStop[], depot: { lat: number; lng: number } | null) => {
    if (stops.length < 1) {
      setRouteGeometry([]);
      return;
    }

    // Build locations: depot → stops → depot (or just stops if no depot)
    const locations = depot
      ? [
          { lat: depot.lat, lng: depot.lng },
          ...stops.map((s) => ({ lat: s.customerLat ?? 0, lng: s.customerLng ?? 0 })),
          { lat: depot.lat, lng: depot.lng },
        ]
      : stops.map((s) => ({ lat: s.customerLat ?? 0, lng: s.customerLng ?? 0 }));

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

  // Cleanup day overview geometry subscription on unmount
  useEffect(() => {
    return () => {
      if (dayOverviewGeometryUnsubRef.current) {
        dayOverviewGeometryUnsubRef.current();
        dayOverviewGeometryUnsubRef.current = null;
      }
    };
  }, []);

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
            name: stop.customerName,
            coordinates: { lat: stop.customerLat!, lng: stop.customerLng! },
            arrivalTime: stop.estimatedArrival ?? undefined,
            departureTime: stop.estimatedDeparture ?? undefined,
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

  // Load candidates (filtering is applied client-side via advanced filters)
  const loadCandidates = useCallback(async () => {
    if (!isConnected) return;
    
    setIsLoadingCandidates(true);
    try {
      const backendFilters = mapExpressionToCallQueueRequestV1(filters, isRouteAware);
      const response = await getCallQueue({
        ...backendFilters,
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
    } catch (err) {
      console.error('Failed to load candidates:', err);
      setCandidates([]);
    } finally {
      setIsLoadingCandidates(false);
    }
  }, [isConnected, isRouteAware, filters]);

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
            name: stop.customerName,
            coordinates: { lat: stop.customerLat!, lng: stop.customerLng! },
            arrivalTime: stop.estimatedArrival ?? undefined,
            departureTime: stop.estimatedDeparture ?? undefined,
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

  // Selected candidate (from candidates list or fallback from route stops)
  const selectedCandidate = useMemo(() => 
    candidates.find((c) => c.customerId === selectedCandidateId),
    [candidates, selectedCandidateId]
  );

  // Convert selected candidate to CandidateDetailData
  // Falls back to route stop data when the candidate is not in the current filter/segment
  const selectedCandidateDetail: CandidateDetailData | null = useMemo(() => {
    if (selectedCandidate) {
      // Full candidate data available from call queue
      const isScheduled = isScheduledCandidate(selectedCandidate);
      
      return {
        id: selectedCandidate.id,
        customerId: selectedCandidate.customerId,
        customerName: selectedCandidate.customerName,
        deviceType: selectedCandidate.deviceType ?? 'Zařízení',
        deviceName: selectedCandidate.deviceName ?? undefined,
        phone: selectedCandidate.customerPhone ?? undefined,
        email: selectedCandidate.customerEmail ?? undefined,
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
        isScheduled,
        scheduledDate: selectedCandidate._scheduledDate,
        scheduledTimeStart: selectedCandidate._scheduledTimeStart,
        scheduledTimeEnd: selectedCandidate._scheduledTimeEnd,
      };
    }

    // Fallback: candidate not in current list but is a route stop (clicked from timeline)
    if (selectedCandidateId) {
      const routeStop = routeStops.find((s) => s.customerId === selectedCandidateId);
      if (routeStop) {
        const isScheduled = routeStop.revisionStatus === 'scheduled' || routeStop.revisionStatus === 'confirmed';
        const addressParts = routeStop.address?.split(',').map((p) => p.trim()) ?? [];
        return {
          id: routeStop.revisionId ?? routeStop.id,
          customerId: routeStop.customerId,
          customerName: routeStop.customerName,
          deviceType: 'Zařízení',
          phone: routeStop.customerPhone ?? undefined,
          email: routeStop.customerEmail ?? undefined,
          street: addressParts[0] ?? '',
          city: addressParts[1] ?? '',
          dueDate: routeStop.scheduledDate ?? new Date().toISOString(),
          daysUntilDue: 0,
          priority: 'upcoming' as const,
          isScheduled,
          scheduledDate: routeStop.scheduledDate ?? undefined,
          scheduledTimeStart: routeStop.scheduledTimeStart ?? undefined,
          scheduledTimeEnd: routeStop.scheduledTimeEnd ?? undefined,
        };
      }
    }

    return null;
  }, [selectedCandidate, selectedCandidateId, routeStops, slotSuggestions]);

  // Selected candidate for map preview (before adding to route)
  const selectedCandidateForMap: SelectedCandidate | null = useMemo(() => {
    if (selectedCandidate) {
      if (!selectedCandidate.customerLat || !selectedCandidate.customerLng) return null;
      return {
        id: selectedCandidate.customerId,
        name: selectedCandidate.customerName,
        coordinates: {
          lat: selectedCandidate.customerLat,
          lng: selectedCandidate.customerLng,
        },
      };
    }
    // Fallback from route stops
    if (selectedCandidateId) {
      const routeStop = routeStops.find((s) => s.customerId === selectedCandidateId);
      if (routeStop?.customerLat && routeStop?.customerLng) {
        return {
          id: routeStop.customerId,
          name: routeStop.customerName,
          coordinates: {
            lat: routeStop.customerLat,
            lng: routeStop.customerLng,
          },
        };
      }
    }
    return null;
  }, [selectedCandidate, selectedCandidateId, routeStops]);

  // Insertion preview for map (dashed line showing where candidate will be inserted)
  const insertionPreviewForMap: InsertionPreview | null = useMemo(() => {
    if (!selectedCandidate || !slotSuggestions[0]) return null;
    if (!selectedCandidate.customerLat || !selectedCandidate.customerLng) return null;
    if (routeStops.length === 0) return null;

    return {
      candidateId: selectedCandidate.customerId,
      candidateName: selectedCandidate.customerName,
      coordinates: {
        lat: selectedCandidate.customerLat,
        lng: selectedCandidate.customerLng,
      },
      insertAfterIndex: slotSuggestions[0].insertAfterIndex,
      insertBeforeIndex: slotSuggestions[0].insertAfterIndex + 1,
    };
  }, [selectedCandidate, slotSuggestions, routeStops.length]);

  // Compute set of customer IDs that are currently in the route
  const inRouteIds = useMemo(() => {
    return new Set(routeStops.map((s) => s.customerId));
  }, [routeStops]);

  // Sorted candidates for display (pre-ranked by insertion cost)
  const sortedCandidates = useMemo(() => {
    const filtered = applyInboxFilters(candidates, filters, inRouteIds) as InboxCandidate[];
    
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
      
      const aOverdue = Math.max(0, -a.daysUntilDue);
      const bOverdue = Math.max(0, -b.daysUntilDue);
      if (aOverdue !== bOverdue) return bOverdue - aOverdue;
      return a.daysUntilDue - b.daysUntilDue;
    });
  }, [candidates, filters, inRouteIds, isRouteAware]);

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
      isScheduled: isScheduledCandidate(c),
      isInRoute: inRouteIds.has(c.customerId),
    }));
  }, [sortedCandidates, inRouteIds]);

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

  // Load day overview - all items scheduled for a specific day
  const loadDayOverview = useCallback(async (date: string) => {
    setDayOverview({ date, items: [], isLoading: true });
    setDayOverviewStops([]);
    setDayOverviewGeometry([]);
    
    try {
      const response = await listCalendarItems({
        startDate: date,
        endDate: date,
        viewMode: 'scheduled',
        types: ['revision', 'visit'],
        status: ['scheduled', 'in_progress'],
      });
      
      setDayOverview({ date, items: response.items, isLoading: false });
      
      // Build map stops from items that have coordinates
      // We need to look up coordinates from candidates list
      const stops: SavedRouteStop[] = [];
      for (const item of response.items) {
        if (!item.customerId) continue;
        // Try to find coordinates from candidates
        const cand = candidates.find((c) => c.customerId === item.customerId);
        if (cand?.customerLat && cand?.customerLng) {
          stops.push({
            id: crypto.randomUUID(),
            routeId: '',
            revisionId: item.id,
            stopOrder: stops.length + 1,
            estimatedArrival: null,
            estimatedDeparture: null,
            distanceFromPreviousKm: null,
            durationFromPreviousMinutes: null,
            status: 'draft',
            customerId: item.customerId,
            customerName: item.customerName || item.title,
            address: cand.customerStreet ? `${cand.customerStreet}, ${cand.customerCity}` : (cand.customerCity || ''),
            customerLat: cand.customerLat,
            customerLng: cand.customerLng,
            customerPhone: cand.customerPhone ?? null,
            customerEmail: cand.customerEmail ?? null,
            scheduledDate: null,
            scheduledTimeStart: null,
            scheduledTimeEnd: null,
            revisionStatus: null,
          });
        }
      }
      setDayOverviewStops(stops);
      
      // Fetch route geometry if we have 2+ stops
      if (stops.length >= 2) {
        const locations = stops.map((s) => ({ lat: s.customerLat ?? 0, lng: s.customerLng ?? 0 }));
        
        try {
          if (dayOverviewGeometryUnsubRef.current) {
            dayOverviewGeometryUnsubRef.current();
            dayOverviewGeometryUnsubRef.current = null;
          }
          
          const jobResponse = await geometryService.submitGeometryJob(locations);
          const unsubscribe = await geometryService.subscribeToGeometryJobStatus(
            jobResponse.jobId,
            (update) => {
              if (update.status.type === 'completed') {
                setDayOverviewGeometry(update.status.coordinates);
                if (dayOverviewGeometryUnsubRef.current) {
                  dayOverviewGeometryUnsubRef.current();
                  dayOverviewGeometryUnsubRef.current = null;
                }
              } else if (update.status.type === 'failed') {
                if (dayOverviewGeometryUnsubRef.current) {
                  dayOverviewGeometryUnsubRef.current();
                  dayOverviewGeometryUnsubRef.current = null;
                }
              }
            },
          );
          dayOverviewGeometryUnsubRef.current = unsubscribe;
        } catch (err) {
          console.warn('Failed to get day overview geometry:', err);
        }
      }
    } catch (err) {
      console.error('Failed to load day overview:', err);
      setDayOverview({ date, items: [], isLoading: false });
    }
  }, [candidates]);

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
      
      setSlotSuggestions([]);
      
      // Mark candidate as scheduled in list with time info (don't show confirmation screen)
      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidate.id
            ? { 
                ...c, 
                _scheduled: true,
                status: 'scheduled',
                _scheduledDate: slot.date,
                _scheduledTimeStart: slot.timeStart,
                _scheduledTimeEnd: slot.timeEnd,
              } as InboxCandidate
            : c
        )
      );
      
      // Update route stop if this candidate is already in the route
      setRouteStops((prev) =>
        prev.map((stop) =>
          stop.customerId === candidate.customerId
            ? {
                ...stop,
                scheduledDate: slot.date,
                scheduledTimeStart: slot.timeStart,
                scheduledTimeEnd: slot.timeEnd,
                revisionStatus: 'scheduled',
              }
            : stop
        )
      );
      
      // Move to next candidate automatically
      selectNextCandidate(candidate.customerId);
      
      // Invalidate route cache since route changed
      incrementRouteVersion();
      
      setHasChanges(true);
    } catch (err) {
      console.error('Failed to schedule:', err);
    }
  }, [candidates, incrementRouteVersion, loadDayOverview]);
  
  // Dismiss confirmation and move on to next candidate
  const handleDismissConfirmation = useCallback(() => {
    const confirmedId = scheduledConfirmation?.candidateId;
    setScheduledConfirmation(null);
    setDayOverview(null);
    setDayOverviewStops([]);
    setDayOverviewGeometry([]);
    
    if (dayOverviewGeometryUnsubRef.current) {
      dayOverviewGeometryUnsubRef.current();
      dayOverviewGeometryUnsubRef.current = null;
    }
    
    if (confirmedId) {
      // Now select next and remove the scheduled candidate
      selectNextCandidate(confirmedId);
      
      setCandidates((prev) => {
        const updated = prev.filter((c) => c.customerId !== confirmedId);
        return updated;
      });
    }
  }, [scheduledConfirmation, selectNextCandidate]);

  const handleSnooze = useCallback(async (candidateId: string, days: number) => {
    const candidate = candidates.find((c) => c.id === candidateId || c.customerId === candidateId);
    if (!candidate) return;
    
    // Snooze for specified number of days
    const snoozeDate = new Date();
    snoozeDate.setDate(snoozeDate.getDate() + days);
    
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
        return updated;
      });
      setSlotSuggestions([]);
    } catch (err) {
      console.error('Failed to snooze:', err);
    }
  }, [candidates, selectNextCandidate]);

  const handleFixAddress = useCallback((candidateId: string) => {
    navigate({ to: '/customers/$customerId', params: { customerId: candidateId } });
  }, [navigate]);

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

    const newStops: SavedRouteStop[] = [];
    selectedIds.forEach((customerId) => {
      // Skip if already in route
      if (inRouteIds.has(customerId)) return;

      const candidate = candidates.find((c) => c.customerId === customerId);
      if (!candidate || !candidate.customerLat || !candidate.customerLng) return;

      newStops.push({
        id: crypto.randomUUID(),
        routeId: '',
        revisionId: candidate.id,
        stopOrder: routeStops.length + newStops.length + 1,
        estimatedArrival: null,
        estimatedDeparture: null,
        distanceFromPreviousKm: null,
        durationFromPreviousMinutes: null,
        status: 'draft',
        stopType: 'customer',
        customerId: candidate.customerId,
        customerName: candidate.customerName,
        address: `${candidate.customerStreet ?? ''}, ${candidate.customerCity ?? ''}`.replace(/^, |, $/g, ''),
        customerLat: candidate.customerLat,
        customerLng: candidate.customerLng,
        customerPhone: candidate.customerPhone ?? null,
        customerEmail: candidate.customerEmail ?? null,
        scheduledDate: candidate._scheduledDate ?? null,
        scheduledTimeStart: candidate._scheduledTimeStart ?? null,
        scheduledTimeEnd: candidate._scheduledTimeEnd ?? null,
        revisionStatus: candidate.status ?? null,
      });
    });

    if (newStops.length > 0) {
      setRouteStops((prev) => {
        const updated = [...prev, ...newStops];
        
        // Auto-insert break if enabled and we have enough stops
        if (breakSettings?.breakEnabled && updated.filter(s => s.stopType === 'customer').length >= 2) {
          const existingBreak = updated.find(s => s.stopType === 'break');
          const customerStops = updated.filter(s => s.stopType === 'customer');
          
          if (!existingBreak) {
            const effectiveBreakSettings: BreakSettings = {
              ...breakSettings,
              breakDurationMinutes: enforceDrivingBreakRule
                ? Math.max(breakSettings.breakDurationMinutes, 45)
                : breakSettings.breakDurationMinutes,
            };
            // Calculate break position
            const breakResult = calculateBreakPosition(
              customerStops,
              effectiveBreakSettings,
              context?.workingHoursStart || '08:00',
              {
                enforceDrivingBreakRule,
                maxDrivingMinutes: 270,
                requiredBreakMinutes: 45,
              }
            );
            
            if (breakResult.warnings.length > 0) {
              setBreakWarnings(breakResult.warnings);
              console.warn('Break insertion warnings:', breakResult.warnings);
            } else {
              setBreakWarnings([]);
            }
            
            // Create break stop
            const breakStop: SavedRouteStop = {
              ...createBreakStop('', breakResult.position + 1, effectiveBreakSettings, breakResult.estimatedTime),
              id: crypto.randomUUID(),
            };
            
            // Insert break at calculated position and renumber
            const withBreak = [
              ...customerStops.slice(0, breakResult.position),
              breakStop,
              ...customerStops.slice(breakResult.position),
            ];
            
            return withBreak.map((s, i) => ({ ...s, stopOrder: i + 1 }));
          }
        }
        
        return updated;
      });
      setSelectedIds(new Set());
      setHasChanges(true);
      incrementRouteVersion();
    }
  }, [selectedIds, inRouteIds, candidates, routeStops.length, breakSettings, context, enforceDrivingBreakRule, incrementRouteVersion]);

  // Route building: add single candidate from detail panel
  const handleAddToRoute = useCallback((candidateId: string) => {
    const candidate = candidates.find((c) => c.id === candidateId || c.customerId === candidateId);
    if (!candidate || !candidate.customerLat || !candidate.customerLng) return;
    if (inRouteIds.has(candidate.customerId)) return;

    const newStop: SavedRouteStop = {
      id: crypto.randomUUID(), // Generate new UUID for route_stop
      routeId: '', // Will be set properly on save
      revisionId: candidate.id,
      stopOrder: routeStops.length + 1,
      estimatedArrival: null, // Will be calculated by optimizer
      estimatedDeparture: null,
      distanceFromPreviousKm: null, // Will be calculated
      durationFromPreviousMinutes: null, // Will be calculated
      status: 'draft',
      stopType: 'customer',
      customerId: candidate.customerId,
      customerName: candidate.customerName,
      address: `${candidate.customerStreet ?? ''}, ${candidate.customerCity ?? ''}`.replace(/^, |, $/g, ''),
      customerLat: candidate.customerLat,
      customerLng: candidate.customerLng,
      customerPhone: candidate.customerPhone ?? null,
      customerEmail: candidate.customerEmail ?? null,
      scheduledDate: candidate._scheduledDate ?? null,
      scheduledTimeStart: candidate._scheduledTimeStart ?? null,
      scheduledTimeEnd: candidate._scheduledTimeEnd ?? null,
      revisionStatus: candidate.status ?? null,
    };

    setRouteStops((prev) => {
      const updated = [...prev, newStop];
      
      // Auto-insert break if enabled and we have enough stops
      if (breakSettings?.breakEnabled && updated.filter(s => s.stopType === 'customer').length >= 2) {
        const existingBreak = updated.find(s => s.stopType === 'break');
        const customerStops = updated.filter(s => s.stopType === 'customer');
        
        if (!existingBreak) {
          const effectiveBreakSettings: BreakSettings = {
            ...breakSettings,
            breakDurationMinutes: enforceDrivingBreakRule
              ? Math.max(breakSettings.breakDurationMinutes, 45)
              : breakSettings.breakDurationMinutes,
          };
          // Calculate break position
          const breakResult = calculateBreakPosition(
            customerStops,
            effectiveBreakSettings,
            context?.workingHoursStart || '08:00',
            {
              enforceDrivingBreakRule,
              maxDrivingMinutes: 270,
              requiredBreakMinutes: 45,
            }
          );
          
          if (breakResult.warnings.length > 0) {
            setBreakWarnings(breakResult.warnings);
            console.warn('Break insertion warnings:', breakResult.warnings);
          } else {
            setBreakWarnings([]);
          }
          
          // Create break stop
          const breakStop: SavedRouteStop = {
            ...createBreakStop('', breakResult.position + 1, effectiveBreakSettings, breakResult.estimatedTime),
            id: crypto.randomUUID(),
          };
          
          // Insert break at calculated position and renumber
          const withBreak = [
            ...customerStops.slice(0, breakResult.position),
            breakStop,
            ...customerStops.slice(breakResult.position),
          ];
          
          return withBreak.map((s, i) => ({ ...s, stopOrder: i + 1 }));
        }
      }
      
      return updated;
    });
    setHasChanges(true);
    incrementRouteVersion();
  }, [candidates, inRouteIds, routeStops.length, breakSettings, context, enforceDrivingBreakRule, incrementRouteVersion]);

  // Route building: remove stop from route
  const handleRemoveFromRoute = useCallback((stopId: string) => {
    setRouteStops((prev) => {
      const filtered = prev.filter((s) => s.id !== stopId && s.customerId !== stopId);
      // Renumber
      return filtered.map((s, i) => ({ ...s, stopOrder: i + 1 }));
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
      : { lat: routeStops[0].customerLat ?? 0, lng: routeStops[0].customerLng ?? 0 };

    setIsOptimizing(true);
    setRouteJobProgress('Odesílám do optimalizátoru...');

    try {
      const customerIds = routeStops.map((s) => s.customerId);
      const jobResponse = await routeService.submitRoutePlanJob({
        customerIds,
        date: context.date,
        startLocation,
        crewId: context.crewId || undefined,
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
                const optimizedStops: SavedRouteStop[] = result.stops.map((s, i) => {
                  const isBreak = s.stopType === 'break';
                  // Find original stop to preserve data
                  const original = isBreak
                    ? routeStops.find((rs) => rs.stopType === 'break')
                    : routeStops.find((rs) => rs.customerId === s.customerId);
                  return {
                    id: original?.id ?? crypto.randomUUID(),
                    routeId: original?.routeId ?? '',
                    revisionId: original?.revisionId ?? null,
                    stopOrder: i + 1,
                    estimatedArrival: s.eta,
                    estimatedDeparture: s.etd,
                    distanceFromPreviousKm: null, // Will be calculated
                    durationFromPreviousMinutes: null, // Will be calculated
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
                setRouteStops(optimizedStops);

                // Store solver warnings (LATE_ARRIVAL, INSUFFICIENT_BUFFER, etc.)
                setRouteWarnings(result.warnings ?? []);

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

  // Route building: clear all stops
  const handleClearRoute = useCallback(() => {
    setRouteStops([]);
    setBreakWarnings([]);
    setRouteGeometry([]);
    setMetrics(null);
    setSelectedIds(new Set());
    setHasChanges(true);
    incrementRouteVersion();
  }, [incrementRouteVersion]);

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
      // Use default snooze duration from localStorage (7 days if not set)
      const defaultDays = parseInt(localStorage.getItem('sazinka.snooze.defaultDays') || '7');
      handleSnooze(selectedCandidateId, defaultDays);
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

  useEffect(() => {
    sessionStorage.setItem('planningInbox.filters', JSON.stringify(filters));
  }, [filters]);

  const setRootOperator = useCallback((value: 'AND' | 'OR') => {
    setActivePresetId(null);
    setFilters((prev) => ({ ...prev, rootOperator: value }));
  }, []);

  const setGroupOperator = useCallback((group: 'time' | 'problems', value: GroupOperator) => {
    setActivePresetId(null);
    setFilters((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        [group]: {
          ...prev.groups[group],
          operator: value,
        },
      },
    }));
  }, []);

  const toggleTimeFilter = useCallback((value: TimeToken) => {
    setActivePresetId(null);
    setFilters((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        time: (() => {
          const selected = toggleToken(prev.groups.time.selected, value);
          return {
            ...prev.groups.time,
            selected,
            enabled: selected.length > 0,
          };
        })(),
      },
    }));
  }, []);

  const toggleProblemFilter = useCallback((value: ProblemToken) => {
    setActivePresetId(null);
    setFilters((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        problems: (() => {
          const selected = toggleToken(prev.groups.problems.selected, value);
          return {
            ...prev.groups.problems,
            selected,
            enabled: selected.length > 0,
          };
        })(),
      },
    }));
  }, []);

  const setTriState = useCallback((field: 'hasTerm' | 'inRoute', value: TriState) => {
    setActivePresetId(null);
    setFilters((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        [field]: value,
      },
    }));
  }, []);

  const applyPreset = useCallback((presetId: FilterPresetId) => {
    setFilters((prev) => applyFilterPreset(presetId, prev));
    setActivePresetId(presetId);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(applyFilterPreset('ALL'));
    setActivePresetId('ALL');
  }, []);

  const activeFilterCount = getActiveFilterCount(filters);
  const filterSummary = buildFilterSummary(filters);
  const hasAdvancedActive = hasAdvancedCriteria(filters);

  // Render inbox list panel
  const renderInboxList = () => (
    <div className={styles.inboxPanel}>
      <div className={styles.filterPanel}>
        <div className={styles.filterPanelHeader}>
          <span className={styles.filterSummary}>
            Filtry {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
          </span>
          {!isAdvancedFiltersOpen && hasAdvancedActive && (
            <span className={styles.advancedHint}>pokročilé podmínky aktivní</span>
          )}
          <span className={styles.filterResults}>{sortedCandidates.length} výsledků</span>
          <button
            type="button"
            className={styles.advancedToggleButton}
            onClick={() => setIsAdvancedFiltersOpen((prev) => !prev)}
          >
            {isAdvancedFiltersOpen ? 'Skrýt pokročilé' : 'Pokročilé'}
          </button>
          <button
            type="button"
            className={styles.filterResetButton}
            onClick={clearFilters}
            disabled={activeFilterCount === 0}
          >
            Reset
          </button>
        </div>

        <div className={styles.filterPresets}>
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`${styles.filterChip} ${activePresetId === preset.id ? styles.active : ''}`}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterGroupLabel}>Čas/Priorita</span>
          <div className={styles.filterChips}>
            <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('OVERDUE') ? styles.active : ''}`} onClick={() => toggleTimeFilter('OVERDUE')}>Po termínu</button>
            <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('DUE_IN_7_DAYS') ? styles.active : ''}`} onClick={() => toggleTimeFilter('DUE_IN_7_DAYS')}>Do 7 dnů</button>
            <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('DUE_IN_30_DAYS') ? styles.active : ''}`} onClick={() => toggleTimeFilter('DUE_IN_30_DAYS')}>Do 30 dnů</button>
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterGroupLabel}>Termín</span>
          <div className={styles.filterTriState}>
            <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'ANY' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'ANY')}>Neřešit</button>
            <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'YES' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'YES')}>Má termín</button>
            <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'NO' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'NO')}>Nemá termín</button>
          </div>
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterGroupLabel}>Trasa</span>
          <div className={styles.filterTriState}>
            <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'ANY' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'ANY')}>Neřešit</button>
            <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'YES' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'YES')}>V trase</button>
            <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'NO' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'NO')}>Není v trase</button>
          </div>
        </div>

        {isAdvancedFiltersOpen && (
          <div className={styles.advancedPanel}>
            <div className={styles.advancedPanelHeader}>Pokročilé filtry</div>

            <div className={styles.advancedRow}>
              <span className={styles.filterGroupLabel}>Logika mezi skupinami</span>
              <div className={styles.rootOperatorSwitch}>
                <button
                  type="button"
                  className={`${styles.operatorButton} ${filters.rootOperator === 'AND' ? styles.active : ''}`}
                  onClick={() => setRootOperator('AND')}
                >
                  AND
                </button>
                <button
                  type="button"
                  className={`${styles.operatorButton} ${filters.rootOperator === 'OR' ? styles.active : ''}`}
                  onClick={() => setRootOperator('OR')}
                >
                  OR
                </button>
              </div>
            </div>

            <div className={styles.advancedRow}>
              <span className={styles.filterGroupLabel}>Logika časových podmínek</span>
              <div className={styles.groupOperatorSwitch}>
                <button
                  type="button"
                  className={`${styles.operatorButton} ${filters.groups.time.operator === 'OR' ? styles.active : ''}`}
                  onClick={() => setGroupOperator('time', 'OR')}
                >
                  OR
                </button>
                <button
                  type="button"
                  className={`${styles.operatorButton} ${filters.groups.time.operator === 'AND' ? styles.active : ''}`}
                  onClick={() => setGroupOperator('time', 'AND')}
                >
                  AND
                </button>
              </div>
            </div>

            <div className={styles.filterGroup}>
              <span className={styles.filterGroupLabel}>Problémy</span>
              <div className={styles.groupOperatorSwitch}>
                <button
                  type="button"
                  className={`${styles.operatorButton} ${filters.groups.problems.operator === 'OR' ? styles.active : ''}`}
                  onClick={() => setGroupOperator('problems', 'OR')}
                >
                  OR
                </button>
                <button
                  type="button"
                  className={`${styles.operatorButton} ${filters.groups.problems.operator === 'AND' ? styles.active : ''}`}
                  onClick={() => setGroupOperator('problems', 'AND')}
                >
                  AND
                </button>
              </div>
              <div className={styles.filterChips}>
                <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('MISSING_PHONE') ? styles.active : ''}`} onClick={() => toggleProblemFilter('MISSING_PHONE')}>Chybí telefon</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('ADDRESS_ISSUE') ? styles.active : ''}`} onClick={() => toggleProblemFilter('ADDRESS_ISSUE')}>Problém s adresou</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('GEOCODE_FAILED') ? styles.active : ''}`} onClick={() => toggleProblemFilter('GEOCODE_FAILED')}>Geokód selhal</button>
              </div>
            </div>

            <div className={styles.filterSummaryText}>{filterSummary}</div>
          </div>
        )}
      </div>

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
        emptyMessage={'Žádní kandidáti pro vybrané filtry'}
        className={styles.candidateList}
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
        inRouteIds={inRouteIds}
      />
    </div>
  );

  // Render map panel with route stop list below
  const renderMapPanel = () => {
    // When we have a day overview (after scheduling), show day overview instead
    if (dayOverview && scheduledConfirmation) {
      const overviewDate = new Date(dayOverview.date + 'T00:00:00');
      const sortedItems = [...dayOverview.items].sort((a, b) => {
        const ta = a.timeStart || '99:99';
        const tb = b.timeStart || '99:99';
        if (ta !== tb) return ta.localeCompare(tb);
        return (a.customerName || '').localeCompare(b.customerName || '');
      });
      
      return (
        <div className={styles.mapPanel}>
          {/* Prominent date banner */}
          <div className={styles.dayOverviewBanner}>
            <div className={styles.dayOverviewCalendarCard}>
              <span className={styles.dayOverviewCalMonth}>
                {overviewDate.toLocaleDateString('cs-CZ', { month: 'long' })}
              </span>
              <span className={styles.dayOverviewCalDay}>
                {overviewDate.getDate()}
              </span>
              <span className={styles.dayOverviewCalWeekday}>
                {overviewDate.toLocaleDateString('cs-CZ', { weekday: 'long' })}
              </span>
            </div>
            <div className={styles.dayOverviewBannerInfo}>
              <span className={styles.dayOverviewBannerYear}>
                {overviewDate.getFullYear()}
              </span>
              <span className={styles.dayOverviewBannerCount}>
                {dayOverview.items.length} {dayOverview.items.length === 1 ? 'návštěva' : dayOverview.items.length >= 2 && dayOverview.items.length <= 4 ? 'návštěvy' : 'návštěv'}
              </span>
            </div>
          </div>
          
          {/* Visit list */}
          <div className={styles.dayOverviewList}>
            <div className={styles.dayOverviewListHeader}>Naplánované návštěvy</div>
            {dayOverview.isLoading ? (
              <div className={styles.dayOverviewLoading}>Načítám přehled dne...</div>
            ) : sortedItems.length === 0 ? (
              <div className={styles.dayOverviewEmpty}>Na tento den nejsou naplánované žádné návštěvy.</div>
            ) : (
              sortedItems.map((item) => {
                const isJustScheduled = item.customerId === scheduledConfirmation.candidateId;
                return (
                  <div 
                    key={item.id}
                    className={`${styles.dayOverviewItem} ${isJustScheduled ? styles.dayOverviewItemHighlighted : ''}`}
                  >
                    <div className={styles.dayOverviewItemTimeBlock}>
                      <span className={styles.dayOverviewItemTimeStart}>
                        {item.timeStart ? item.timeStart.substring(0, 5) : '--:--'}
                      </span>
                      {item.timeEnd && (
                        <span className={styles.dayOverviewItemTimeEnd}>
                          {item.timeEnd.substring(0, 5)}
                        </span>
                      )}
                    </div>
                    <div className={styles.dayOverviewItemContent}>
                      <span className={styles.dayOverviewItemName}>{item.customerName || item.title}</span>
                      <span className={styles.dayOverviewItemType}>
                        {item.type === 'revision' ? 'Revize' : 'Návštěva'}
                        {item.subtitle ? ` · ${item.subtitle}` : ''}
                      </span>
                    </div>
                    {isJustScheduled && (
                      <span className={styles.dayOverviewItemBadge}>nově</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          
          {/* Map with day stops */}
          <div className={styles.dayOverviewMap}>
            <RouteMapPanel
              stops={dayOverviewStops}
              depot={null}
              routeGeometry={dayOverviewGeometry}
              highlightedStopId={scheduledConfirmation.candidateId}
              selectedCandidate={null}
              isLoading={dayOverview.isLoading}
            />
          </div>
        </div>
      );
    }
    
    return (
      <div className={styles.mapPanel}>
        <div className={styles.mapSection}>
          <RouteMapPanel
            stops={routeStops}
            depot={currentDepot}
            routeGeometry={routeGeometry}
            highlightedStopId={selectedCandidateId}
            highlightedSegment={highlightedSegment}
            selectedCandidate={selectedCandidateForMap}
            insertionPreview={insertionPreviewForMap}
            onSegmentHighlight={setHighlightedSegment}
            isLoading={isLoadingRoute}
          />
        </div>
        <div className={styles.routeStopSection}>
          <RouteDetailTimeline
            stops={routeStops}
            depot={currentDepot ? { ...currentDepot, name: currentDepot.name ?? 'Depo' } : null}
            selectedStopId={selectedCandidateId}
            highlightedSegment={highlightedSegment}
            onStopClick={(customerId) => {
              setSelectedCandidateId(customerId);
              setHighlightedSegment(null);
            }}
            onSegmentClick={setHighlightedSegment}
            onRemoveStop={handleRemoveFromRoute}
            onOptimize={handleOptimizeRoute}
            onDeleteRoute={handleClearRoute}
            deleteRouteLabel="Vyčistit"
            isOptimizing={isOptimizing}
            isSaving={isSaving}
            metrics={metrics}
            warnings={routeWarnings}
          />
        </div>
      </div>
    );
  };

  // Render detail panel
  const renderDetailPanel = () => (
    <div className={styles.detailPanel}>
      {scheduledConfirmation && scheduledConfirmation.candidateId === selectedCandidateId ? (
        <div className={styles.confirmation}>
          <div className={styles.confirmationIcon}>✓</div>
          <h3 className={styles.confirmationTitle}>Naplánováno</h3>
          <p className={styles.confirmationName}>{scheduledConfirmation.candidateName}</p>
          
          <div className={styles.confirmationDate}>
            <div className={styles.calendarCard}>
              <span className={styles.calendarMonth}>
                {new Date(scheduledConfirmation.date + 'T00:00:00').toLocaleDateString('cs-CZ', { month: 'long' })}
              </span>
              <span className={styles.calendarDay}>
                {new Date(scheduledConfirmation.date + 'T00:00:00').getDate()}
              </span>
              <span className={styles.calendarWeekday}>
                {new Date(scheduledConfirmation.date + 'T00:00:00').toLocaleDateString('cs-CZ', { weekday: 'long' })}
              </span>
            </div>
            {(scheduledConfirmation.timeStart || scheduledConfirmation.timeEnd) && (
              <div className={styles.confirmationTime}>
                {scheduledConfirmation.timeStart?.substring(0, 5) || '--:--'}
                {' – '}
                {scheduledConfirmation.timeEnd?.substring(0, 5) || '--:--'}
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.confirmationButton}
            onClick={handleDismissConfirmation}
          >
            Další zákazník →
          </button>
        </div>
      ) : (
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
          defaultServiceDurationMinutes={defaultServiceDurationMinutes}
        />
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
        saveError={saveError}
        onRetry={retrySave}
      />
      {breakWarnings.length > 0 && (
        <div className={styles.breakWarnings}>
          {breakWarnings.map((warning, index) => (
            <div key={`${warning}-${index}`} className={styles.breakWarningItem}>
              ⚠️ {warning}
            </div>
          ))}
        </div>
      )}
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
