import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import { useRouteCacheStore } from '../stores/routeCacheStore';
import { useAutoSave } from '../hooks/useAutoSave';
import { 
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
  PlanningTimeline,
  TimelineViewToggle,
  type TimelineView,
  type CandidateForInsertion,
  type GapInsertionInfo,
  RouteSummaryStats,
  RouteSummaryActions,
  ArrivalBufferBar,
} from '../components/planner';
import { DraftModeBar } from '../components/planner/DraftModeBar';
import { CollapseButton, ThreePanelLayout } from '../components/common';
import type { SavedRouteStop } from '../services/routeService';
import { recalculateRoute, type RecalcStopInput } from '../services/routeService';
import type { BreakSettings } from '@shared/settings';
import { insertStopAtPosition, findChronologicalPosition } from '../components/planner/insertStop';
import * as settingsService from '../services/settingsService';
import { calculateBreakPosition, createBreakStop } from '../utils/breakUtils';
import { logger } from '../utils/logger';
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
import { getMonthNames, getWeekdayNames } from '@/i18n/formatters';
import { updateCustomer } from '../services/customerService';
import type { CustomerUpdateFields } from '../components/planner/CandidateDetail';
import styles from './PlanningInbox.module.css';

/** Parse "HH:MM" or "HH:MM:SS" to total minutes from midnight. */
function parseTimeMins(t: string): number {
  const p = t.split(':').map(Number);
  return (p[0] ?? 0) * 60 + (p[1] ?? 0);
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

// Format minutes as "Xh Ymm"
function formatMinutesHm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? `${h}h` : `${h}h ${mm.toString().padStart(2, '0')}min`;
}

// Convert priority to CandidateRowData priority type
function toPriority(item: CallQueueItem): CandidateRowData['priority'] {
  if (item.daysUntilDue < 0) return 'overdue';
  if (item.daysUntilDue <= 7) return 'due_this_week';
  if (item.daysUntilDue <= 30) return 'due_soon';
  return 'upcoming';
}

export function PlanningInbox() {
  const { t } = useTranslation('planner');
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
  const [crews, setCrews] = useState<crewService.Crew[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [defaultServiceDurationMinutes, setDefaultServiceDurationMinutes] = useState(30);
  const [defaultWorkingHoursStart, setDefaultWorkingHoursStart] = useState<string | null>(null);
  const [defaultWorkingHoursEnd, setDefaultWorkingHoursEnd] = useState<string | null>(null);
  const [breakSettings, setBreakSettings] = useState<BreakSettings | null>(null);
  const [enforceDrivingBreakRule, setEnforceDrivingBreakRule] = useState<boolean>(() => {
    const raw = localStorage.getItem('planningInbox.enforceDrivingBreakRule');
    return raw === null ? true : raw === 'true';
  });
  
  // Timeline view toggle (planning = proportional, compact = classic)
  const [timelineView, setTimelineView] = useState<TimelineView>('planning');
  
  // Map collapse/expand state
  const [mapMode, setMapMode] = useState<'normal' | 'collapsed' | 'fullscreen'>('normal');
  const [mapHeight, setMapHeight] = useState(280);
  const mapResizeRef = useRef<{ startY: number; startH: number } | null>(null);

  // Route state
  const [routeStops, setRouteStops] = useState<SavedRouteStop[]>([]);
  const [loadedRouteId, setLoadedRouteId] = useState<string | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][]>([]);
  const [returnToDepotLeg, setReturnToDepotLeg] = useState<{ distanceKm: number | null; durationMinutes: number | null } | null>(null);
  /** Computed depot departure (backward-calculated from first scheduled stop). */
  const [depotDeparture, setDepotDeparture] = useState<string | null>(null);
  const [routeWarnings, setRouteWarnings] = useState<RouteWarning[]>([]);
  const [breakWarnings, setBreakWarnings] = useState<string[]>([]);
  const [isBreakManuallyAdjusted, setIsBreakManuallyAdjusted] = useState(false);
  const [metrics, setMetrics] = useState<RouteMetrics | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const geometryUnsubRef = useRef<(() => void) | null>(null);
  /** Stops waiting for recalculation after route load. */
  const pendingRecalcStopsRef = useRef<SavedRouteStop[] | null>(null);
  
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
  
  // Route-level arrival buffer state (initialized from user preferences, overridden by saved route)
  const [routeBufferPercent, setRouteBufferPercent] = useState(10);
  const [routeBufferFixedMinutes, setRouteBufferFixedMinutes] = useState(0);
  
  // Multi-crew state (TODO: implement multi-crew comparison)
  const [crewComparisons, _setCrewComparisons] = useState<CrewComparison[]>([]);
  
  // Route building state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [routeJobProgress, setRouteJobProgress] = useState<string | null>(null);
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [activePresetId, setActivePresetId] = useState<FilterPresetId | null>(null);

  // Map resize drag handlers
  const handleMapResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    mapResizeRef.current = { startY: e.clientY, startH: mapHeight };
    const onMove = (ev: MouseEvent) => {
      if (!mapResizeRef.current) return;
      const delta = ev.clientY - mapResizeRef.current.startY;
      const newH = Math.max(120, Math.min(600, mapResizeRef.current.startH + delta));
      setMapHeight(newH);
    };
    const onUp = () => {
      mapResizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [mapHeight]);

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
      crewId: sanitizeUuid(context.crewId) ?? null,
      depotId: sanitizeUuid(context.depotId) ?? null,
      stops: routeStops.map((s, index) => ({
        customerId: s.stopType === 'customer' ? (s.customerId ?? undefined) : undefined,
        revisionId: sanitizeUuid(s.revisionId),
        order: s.stopOrder ?? index + 1,
        eta: s.estimatedArrival || undefined,
        etd: s.estimatedDeparture || undefined,
        distanceFromPreviousKm: s.distanceFromPreviousKm ?? undefined,
        durationFromPreviousMinutes: s.durationFromPreviousMinutes ?? undefined,
        stopType: s.stopType,
        breakDurationMinutes: s.stopType === 'break' ? (s.breakDurationMinutes ?? 45) : undefined,
        breakTimeStart: s.stopType === 'break' ? (s.breakTimeStart ?? s.estimatedArrival ?? '12:00') : undefined,
        status: s.status === 'unassigned' ? 'unassigned' : undefined,
        serviceDurationMinutes: s.serviceDurationMinutes ?? undefined,
      })),
      totalDistanceKm: metrics?.distanceKm ?? 0,
      totalDurationMinutes: (metrics?.travelTimeMin ?? 0) + (metrics?.serviceTimeMin ?? 0),
      optimizationScore: 0,
      returnToDepotDistanceKm: returnToDepotLeg?.distanceKm ?? null,
      returnToDepotDurationMinutes: returnToDepotLeg?.durationMinutes ?? null,
      arrivalBufferPercent: routeBufferPercent,
      arrivalBufferFixedMinutes: routeBufferFixedMinutes,
    });
    setHasChanges(false);
  }, [routeStops, context, metrics, returnToDepotLeg, routeBufferPercent, routeBufferFixedMinutes]);

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
          logger.warn('Failed to load settings:', settingsResult.reason);
        }
        if (crewsResult.status === 'rejected') {
          logger.warn('Failed to load crews (worker may not be running):', crewsResult.reason);
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
        setDefaultWorkingHoursStart(settings?.workConstraints?.workingHoursStart ?? null);
        setDefaultWorkingHoursEnd(settings?.workConstraints?.workingHoursEnd ?? null);
        setBreakSettings(settings?.breakSettings ?? DEFAULT_BREAK_SETTINGS);
        
        // Initialize route buffer from user's last-used preferences
        if (settings?.preferences?.lastArrivalBufferPercent !== undefined) {
          setRouteBufferPercent(settings.preferences.lastArrivalBufferPercent);
        }
        if (settings?.preferences?.lastArrivalBufferFixedMinutes !== undefined) {
          setRouteBufferFixedMinutes(settings.preferences.lastArrivalBufferFixedMinutes);
        }
        
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
        logger.error('Failed to load settings:', err);
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

  // Fetch Valhalla route geometry when route stops change
  const fetchRouteGeometry = useCallback(async (stops: SavedRouteStop[], depot: { lat: number; lng: number } | null) => {
    // Only use customer stops with valid coordinates for geometry routing.
    // Break stops have null coordinates and would corrupt Valhalla's route.
    const routableStops = stops.filter(
      (s) => s.stopType !== 'break' && s.customerLat != null && s.customerLng != null
    );

    if (routableStops.length < 1) {
      setRouteGeometry([]);
      return;
    }

    // Build locations: depot → stops → depot (or just stops if no depot)
    const locations = depot
      ? [
          { lat: depot.lat, lng: depot.lng },
          ...routableStops.map((s) => ({ lat: s.customerLat!, lng: s.customerLng! })),
          { lat: depot.lat, lng: depot.lng },
        ]
      : routableStops.map((s) => ({ lat: s.customerLat!, lng: s.customerLng! }));

    try {
      // Cancel previous subscription
      if (geometryUnsubRef.current) {
        geometryUnsubRef.current();
        geometryUnsubRef.current = null;
      }

      logger.info('[PlanningInbox] Submitting geometry job for', locations.length, 'locations');
      const jobResponse = await geometryService.submitGeometryJob(locations);
      logger.info('[PlanningInbox] Geometry job submitted, jobId:', jobResponse.jobId);

      const unsubscribe = await geometryService.subscribeToGeometryJobStatus(
        jobResponse.jobId,
        (update) => {
          logger.info('[PlanningInbox] Geometry job status update:', update);
          if (update.status.type === 'completed') {
            logger.info('[PlanningInbox] Setting route geometry, coordinates count:', update.status.coordinates.length);
            setRouteGeometry(update.status.coordinates);
            if (geometryUnsubRef.current) {
              geometryUnsubRef.current();
              geometryUnsubRef.current = null;
            }
          } else if (update.status.type === 'failed') {
            logger.warn('Geometry job failed:', update.status.error);
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
      logger.warn('Failed to submit geometry job:', err);
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

  // Calculate insertion when candidate is selected
  useEffect(() => {
    if (!isConnected || !selectedCandidateId || !context) return;
    
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
          routeStops: routeStops
            .filter((s) => s.stopType === 'customer' && s.customerLat && s.customerLng)
            .map((stop) => ({
              id: stop.id,
              name: stop.customerName ?? '',
              coordinates: { lat: stop.customerLat!, lng: stop.customerLng! },
              arrivalTime: stop.estimatedArrival ?? undefined,
              departureTime: stop.estimatedDeparture ?? undefined,
              timeWindowStart: stop.scheduledTimeStart ?? undefined,
              timeWindowEnd: stop.scheduledTimeEnd ?? undefined,
            })),
          depot: { lat: depot!.lat, lng: depot!.lng },
          candidate: {
            id: candidate!.id,
            customerId: candidate!.customerId,
            coordinates: { lat: candidate!.customerLat!, lng: candidate!.customerLng! },
            serviceDurationMinutes: defaultServiceDurationMinutes,
          },
          date: context!.date,
          workdayStart: defaultWorkingHoursStart ?? undefined,
          workdayEnd: defaultWorkingHoursEnd ?? undefined,
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
        logger.error('Failed to calculate insertion:', err);
        setSlotSuggestions([]);
      } finally {
        setIsCalculatingSlots(false);
      }
    }
    
    calculateInsertion();
  }, [isConnected, selectedCandidateId, routeStops, context, depots, getCachedInsertion, defaultServiceDurationMinutes, defaultWorkingHoursStart, defaultWorkingHoursEnd]);

  // Load candidates (filtering is applied client-side via advanced filters)
  const loadCandidates = useCallback(async () => {
    if (!isConnected) return;
    
    setIsLoadingCandidates(true);
    try {
      const backendFilters = mapExpressionToCallQueueRequestV1(filters, false);
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
        // Populate local scheduled fields from backend data
        _scheduledDate: item.scheduledDate ?? undefined,
        _scheduledTimeStart: item.scheduledTimeStart ?? undefined,
        _scheduledTimeEnd: item.scheduledTimeEnd ?? undefined,
      }));
      
      setCandidates(loadedCandidates);
      setSlotSuggestions([]);
    } catch (err) {
      logger.error('Failed to load candidates:', err);
      setCandidates([]);
    } finally {
      setIsLoadingCandidates(false);
    }
  }, [isConnected, filters]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Load saved route for selected day
  useEffect(() => {
    if (!isConnected || !context?.date) return;
    
    const dateToLoad = context.date;
    
    async function loadRoute() {
      setIsLoadingRoute(true);
      try {
        const response = await routeService.getRoute({ date: dateToLoad });
        setLoadedRouteId(response.route?.id ?? null);
        
        if (response.route && response.stops.length > 0) {
          setRouteStops(response.stops);
          setReturnToDepotLeg(
            response.route.returnToDepotDistanceKm != null || response.route.returnToDepotDurationMinutes != null
              ? { distanceKm: response.route.returnToDepotDistanceKm ?? null, durationMinutes: response.route.returnToDepotDurationMinutes ?? null }
              : null
          );
          
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

          // Override buffer from saved route
          if (response.route.arrivalBufferPercent !== undefined) {
            setRouteBufferPercent(response.route.arrivalBufferPercent);
          }
          if (response.route.arrivalBufferFixedMinutes !== undefined) {
            setRouteBufferFixedMinutes(response.route.arrivalBufferFixedMinutes);
          }

          // Mark that we need to recalculate ETAs for the loaded route
          pendingRecalcStopsRef.current = response.stops;
        } else {
          setRouteStops([]);
          setLoadedRouteId(null);
          setReturnToDepotLeg(null);
          setMetrics(null);
        }
      } catch (err) {
        logger.error('Failed to load route:', err);
        setRouteStops([]);
        setLoadedRouteId(null);
        setReturnToDepotLeg(null);
        setMetrics(null);
      } finally {
        setIsLoadingRoute(false);
      }
    }
    
    loadRoute();
    // Also reload candidates to ensure route stop data is in sync with latest candidate info
    loadCandidates();
  }, [isConnected, context?.date, loadCandidates]);

  // Batch calculate insertion metrics for visible candidates
  useEffect(() => {
    if (!isConnected || !context || candidates.length === 0) return;
    
    const depot = depots.find((d) => d.id === context.depotId);
    if (!depot) return;
    
    const validCandidates = candidates.filter(
      (c) => c.customerLat !== null && c.customerLng !== null && c.deltaKm === undefined
    );
    
    if (validCandidates.length === 0) return;
    
    async function calculateBatch() {
      try {
        const response = await insertionService.calculateBatchInsertion({
          routeStops: routeStops
            .filter((s) => s.stopType === 'customer' && s.customerLat && s.customerLng)
            .map((stop) => ({
              id: stop.id,
              name: stop.customerName ?? '',
              coordinates: { lat: stop.customerLat!, lng: stop.customerLng! },
              arrivalTime: stop.estimatedArrival ?? undefined,
              departureTime: stop.estimatedDeparture ?? undefined,
            })),
          depot: { lat: depot!.lat, lng: depot!.lng },
          candidates: validCandidates.map((c) => ({
            id: c.id,
            customerId: c.customerId,
            coordinates: { lat: c.customerLat!, lng: c.customerLng! },
            serviceDurationMinutes: defaultServiceDurationMinutes,
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
        logger.error('Failed to calculate batch insertion:', err);
      }
    }
    
    calculateBatch();
  }, [isConnected, context, candidates, routeStops, depots, setCachedInsertions]);

  // Get current depot for map
  const currentDepot: MapDepot | null = useMemo(() => {
    if (!context?.depotId) return null;
    const depot = depots.find((d) => d.id === context.depotId);
    return depot ? { lat: depot.lat, lng: depot.lng, name: depot.name } : null;
  }, [context?.depotId, depots]);

  const currentCrew = useMemo(
    () => (context?.crewId ? crews.find((c) => c.id === context.crewId) ?? null : null),
    [context?.crewId, crews]
  );
  const routeStartTime = (currentCrew?.workingHoursStart ?? defaultWorkingHoursStart)?.slice(0, 5) ?? null;
  const routeEndTime = (currentCrew?.workingHoursEnd ?? defaultWorkingHoursEnd)?.slice(0, 5) ?? null;

  // Actual route start/end derived from timeline data
  const actualRouteStart = depotDeparture?.slice(0, 5) ?? routeStartTime;
  const actualRouteEnd = useMemo(() => {
    if (routeStops.length === 0) return routeEndTime;
    const lastStop = routeStops[routeStops.length - 1];
    const lastDeparture = lastStop.estimatedDeparture ?? lastStop.estimatedArrival;
    if (!lastDeparture) return routeEndTime;
    const returnMin = returnToDepotLeg?.durationMinutes ?? 0;
    if (returnMin <= 0) return lastDeparture.slice(0, 5);
    // Parse HH:MM and add return travel time
    const [hh, mm] = lastDeparture.slice(0, 5).split(':').map(Number);
    const totalMin = hh * 60 + mm + Math.round(returnMin);
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
  }, [routeStops, returnToDepotLeg, routeEndTime]);

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
        deviceType: selectedCandidate.deviceType ?? t('device_fallback'),
        deviceName: selectedCandidate.deviceName ?? undefined,
        phone: selectedCandidate.customerPhone ?? undefined,
        email: selectedCandidate.customerEmail ?? undefined,
        street: selectedCandidate.customerStreet ?? '',
        city: selectedCandidate.customerCity ?? '',
        postalCode: selectedCandidate.customerPostalCode ?? undefined,
        dueDate: selectedCandidate.dueDate ?? new Date().toISOString(),
        daysUntilDue: selectedCandidate.daysUntilDue,
        priority: toPriority(selectedCandidate),
        suggestedSlots: slotSuggestions,
        isScheduled,
        scheduledDate: selectedCandidate._scheduledDate,
        scheduledTimeStart: selectedCandidate._scheduledTimeStart,
        scheduledTimeEnd: selectedCandidate._scheduledTimeEnd,
        hasCoordinates: !!(selectedCandidate.customerLat && selectedCandidate.customerLng),
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
          deviceType: t('device_fallback'),
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
  // Only shown for candidates NOT yet in the route (in-route stops already have numbered markers)
  const selectedCandidateForMap: SelectedCandidate | null = useMemo(() => {
    if (selectedCandidate) {
      if (!selectedCandidate.customerLat || !selectedCandidate.customerLng) return null;
      // Don't show preview marker for candidates already in the route
      if (routeStops.some((s) => s.customerId === selectedCandidate.customerId)) return null;
      return {
        id: selectedCandidate.customerId,
        name: selectedCandidate.customerName,
        coordinates: {
          lat: selectedCandidate.customerLat,
          lng: selectedCandidate.customerLng,
        },
      };
    }
    return null;
  }, [selectedCandidate, routeStops]);

  // Insertion preview for map (dashed line showing where candidate will be inserted)
  // Only shown for candidates NOT yet in the route
  const insertionPreviewForMap: InsertionPreview | null = useMemo(() => {
    if (!selectedCandidate || !slotSuggestions[0]) return null;
    if (!selectedCandidate.customerLat || !selectedCandidate.customerLng) return null;
    if (routeStops.length === 0) return null;
    // Don't show insertion preview for candidates already in the route
    if (routeStops.some((s) => s.customerId === selectedCandidate.customerId)) return null;

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
  }, [selectedCandidate, slotSuggestions, routeStops]);

  // Candidate insertion info for PlanningTimeline gap zones
  // Disabled: automatic previews clutter the timeline and confuse users.
  // Gap zones remain clickable to insert the selected candidate.
  const candidateForInsertion: CandidateForInsertion | null = null;

  // Compute set of customer IDs that are currently in the route
  const inRouteIds = useMemo(() => {
    return new Set(routeStops.map((s) => s.customerId));
  }, [routeStops]);

  // Sorted candidates for display (pre-ranked by insertion cost)
  // The currently selected candidate is always kept in the list even if it
  // no longer matches the active filters — it will be removed once the user
  // clicks on a different candidate.
  const sortedCandidates = useMemo(() => {
    const filtered = applyInboxFilters(candidates, filters, inRouteIds) as InboxCandidate[];
    
    // Ensure the currently selected candidate stays in the list
    if (selectedCandidateId && !filtered.some((c) => c.customerId === selectedCandidateId)) {
      const selected = candidates.find((c) => c.customerId === selectedCandidateId);
      if (selected) {
        filtered.unshift(selected);
      }
    }
    
    return filtered.sort((a, b) => {
      // Pin selected candidate at top
      if (a.customerId === selectedCandidateId) return -1;
      if (b.customerId === selectedCandidateId) return 1;
      
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
  }, [candidates, filters, inRouteIds, selectedCandidateId]);

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
      disableCheckbox: !hasValidAddress(c),
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
          logger.warn('Failed to get day overview geometry:', err);
        }
      }
    } catch (err) {
      logger.error('Failed to load day overview:', err);
      setDayOverview({ date, items: [], isLoading: false });
    }
  }, [candidates]);

  // Quick-recalculate ETAs for the current route after insert/reorder.
  // Fires in the background – updates stops in-place when the response arrives.
  const triggerRecalculate = useCallback(async (stopsSnapshot: SavedRouteStop[], bufferOverride?: { percent: number; fixed: number }) => {
    const depot = currentDepot;
    if (!depot || stopsSnapshot.length === 0) return;

    // Build recalc input from the stops snapshot
    const recalcStops: RecalcStopInput[] = stopsSnapshot.map((s) => ({
      coordinates: { lat: s.customerLat ?? 0, lng: s.customerLng ?? 0 },
      stopType: s.stopType,
      scheduledTimeStart: s.scheduledTimeStart ?? undefined,
      scheduledTimeEnd: s.scheduledTimeEnd ?? undefined,
      serviceDurationMinutes: s.serviceDurationMinutes ?? undefined,
      breakDurationMinutes: s.breakDurationMinutes ?? undefined,
      id: s.id,
      customerId: s.customerId ?? undefined,
      customerName: s.customerName ?? undefined,
    }));

    try {
      const bufferPct = bufferOverride?.percent ?? routeBufferPercent;
      const bufferFixed = bufferOverride?.fixed ?? routeBufferFixedMinutes;
      const result = await recalculateRoute({
        depot: { lat: depot.lat, lng: depot.lng },
        stops: recalcStops,
        workdayStart: routeStartTime || undefined,
        workdayEnd: routeEndTime || undefined,
        defaultServiceDurationMinutes,
        arrivalBufferPercent: bufferPct,
        arrivalBufferFixedMinutes: bufferFixed,
      });

      // Merge recalculated times back into stops
      setRouteStops((prev) => {
        // Build a lookup by id for quick matching
        const resultMap = new Map(result.stops.map((r) => [r.id, r]));
        const updated = prev.map((stop) => {
          const recalced = resultMap.get(stop.id);
          if (!recalced) return stop;
          return {
            ...stop,
            estimatedArrival: recalced.estimatedArrival,
            estimatedDeparture: recalced.estimatedDeparture,
            distanceFromPreviousKm: recalced.distanceFromPreviousKm,
            durationFromPreviousMinutes: recalced.durationFromPreviousMinutes,
            serviceDurationMinutes: recalced.serviceDurationMinutes,
          };
        });
        return updated;
      });

      // Update return-to-depot leg
      setReturnToDepotLeg({
        distanceKm: result.returnToDepotDistanceKm,
        durationMinutes: result.returnToDepotDurationMinutes,
      });

      // Update depot departure (backward-calculated from first scheduled stop)
      setDepotDeparture(result.depotDeparture ?? null);

      // Update metrics from recalculation result
      const workingDayMin = 9 * 60; // TODO: use actual working hours
      const totalMin = result.totalTravelMinutes + result.totalServiceMinutes;
      setMetrics({
        distanceKm: result.totalDistanceKm ?? 0,
        travelTimeMin: result.totalTravelMinutes,
        serviceTimeMin: result.totalServiceMinutes,
        loadPercent: Math.round((totalMin / workingDayMin) * 100),
        slackMin: Math.max(0, workingDayMin - totalMin),
        stopCount: result.stops.length,
      });

      setHasChanges(true);
    } catch (err) {
      logger.error('Route recalculation failed:', err);
      // Non-fatal: the route still exists, just with stale ETAs
    }
  }, [currentDepot, routeStartTime, routeEndTime, defaultServiceDurationMinutes, routeBufferPercent, routeBufferFixedMinutes]);

  // Auto-recalculate when working hours or depot changes (but not on initial load)
  const prevWorkingHoursRef = useRef<{ start: string | null; end: string | null; depotId: string | null }>({
    start: null,
    end: null,
    depotId: null,
  });

  useEffect(() => {
    const prev = prevWorkingHoursRef.current;
    const curr = { start: routeStartTime, end: routeEndTime, depotId: currentDepot?.id ?? null };

    // Only recalculate if parameters changed AND we have stops AND we're not on initial load
    const paramsChanged = prev.start !== curr.start || prev.end !== curr.end || prev.depotId !== curr.depotId;
    const notInitialLoad = prev.start !== null || prev.end !== null || prev.depotId !== null;

    if (routeStops.length > 0 && currentDepot && paramsChanged && notInitialLoad) {
      // Use the current routeStops snapshot
      const stopsSnapshot = [...routeStops];
      triggerRecalculate(stopsSnapshot);
    }

    prevWorkingHoursRef.current = curr;
  }, [routeStartTime, routeEndTime, currentDepot?.id, routeStops.length, triggerRecalculate]);

  // Auto-recalculate ETAs when a route was just loaded from the database
  useEffect(() => {
    const pending = pendingRecalcStopsRef.current;
    if (pending && pending.length > 0 && currentDepot) {
      pendingRecalcStopsRef.current = null;
      triggerRecalculate(pending);
    }
  }, [triggerRecalculate, currentDepot]);

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
      const updatedStops = await new Promise<SavedRouteStop[]>((resolve) => {
        setRouteStops((prev) => {
          const updated = prev.map((stop) =>
            stop.customerId === candidate.customerId
              ? {
                  ...stop,
                  scheduledDate: slot.date,
                  scheduledTimeStart: slot.timeStart,
                  scheduledTimeEnd: slot.timeEnd,
                  revisionStatus: 'scheduled',
                }
              : stop
          );
          resolve(updated);
          return updated;
        });
      });
      
      // Recalculate ETAs if this candidate was in the route
      if (updatedStops.some((s) => s.customerId === candidate.customerId)) {
        triggerRecalculate(updatedStops);
      }
      
      // Reload candidates to ensure list is in sync with backend
      loadCandidates();
      
      // Stay on the current candidate (don't auto-advance)
      // The candidate remains visible even if it no longer matches filters,
      // and will be removed from the list when the user clicks a different candidate.
      
      // Invalidate route cache since route changed
      incrementRouteVersion();
      
      setHasChanges(true);
    } catch (err) {
      logger.error('Failed to schedule:', err);
    }
  }, [candidates, incrementRouteVersion, loadDayOverview, triggerRecalculate, loadCandidates]);
  
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
      logger.error('Failed to snooze:', err);
    }
  }, [candidates, selectNextCandidate]);

  const handleUpdateCustomer = useCallback(async (fields: CustomerUpdateFields) => {
    await updateCustomer({ id: fields.customerId, phone: fields.phone, email: fields.email, street: fields.street, city: fields.city, postalCode: fields.postalCode });
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.customerId !== fields.customerId) return c;
        return {
          ...c,
          ...(fields.phone !== undefined && { customerPhone: fields.phone }),
          ...(fields.email !== undefined && { customerEmail: fields.email }),
          ...(fields.street !== undefined && { customerStreet: fields.street }),
          ...(fields.city !== undefined && { customerCity: fields.city }),
          ...(fields.postalCode !== undefined && { customerPostalCode: fields.postalCode }),
        };
      })
    );
  }, []);

  // Route building: toggle checkbox selection
  const handleSelectionChange = useCallback((id: string, selected: boolean) => {
    if (selected) {
      const candidate = sortedCandidatesRef.current.find((c) => c.customerId === id);
      if (!candidate || !hasValidAddress(candidate)) {
        return;
      }
    }

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

  // For batch insertion, use default service duration (no per-candidate override)
  // For single-candidate insertion from detail panel, the override comes via handleAddToRoute arg.

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
        // Use slot-picker override first, then fall back to already-agreed appointment
        scheduledDate: candidate._scheduledDate ?? candidate.scheduledDate ?? null,
        scheduledTimeStart: candidate._scheduledTimeStart ?? candidate.scheduledTimeStart ?? null,
        scheduledTimeEnd: candidate._scheduledTimeEnd ?? candidate.scheduledTimeEnd ?? null,
        serviceDurationMinutes: defaultServiceDurationMinutes,
        revisionStatus: candidate.status ?? null,
      });
    });

    if (newStops.length > 0) {
      setRouteStops((prev) => {
        // Merge new stops into existing list in chronological order
        // First, strip any existing break – we'll recalculate its position
        const prevCustomers = prev.filter(s => s.stopType === 'customer');

        // Sort all customer stops (existing + new) by scheduledTimeStart
        const allCustomers = [...prevCustomers, ...newStops].sort((a, b) => {
          const aMin = a.scheduledTimeStart ? parseTimeMins(a.scheduledTimeStart) : Infinity;
          const bMin = b.scheduledTimeStart ? parseTimeMins(b.scheduledTimeStart) : Infinity;
          return aMin - bMin;
        });

        // Auto-insert / reposition break if enabled and enough customer stops
        if (breakSettings?.breakEnabled && allCustomers.length >= 2) {
          const effectiveBreakSettings: BreakSettings = {
            ...breakSettings,
            breakDurationMinutes: enforceDrivingBreakRule
              ? Math.max(breakSettings.breakDurationMinutes, 45)
              : breakSettings.breakDurationMinutes,
          };
          const breakResult = calculateBreakPosition(
            allCustomers,
            effectiveBreakSettings,
            routeStartTime || '08:00',
            {
              enforceDrivingBreakRule,
              maxDrivingMinutes: 270,
              requiredBreakMinutes: 45,
            }
          );

          setBreakWarnings(breakResult.warnings);
          setIsBreakManuallyAdjusted(false);

          const existingBreak = prev.find(s => s.stopType === 'break');
          const breakStop: SavedRouteStop = {
            ...createBreakStop('', breakResult.position + 1, effectiveBreakSettings, breakResult.estimatedTime, { floating: true }),
            id: existingBreak?.id ?? crypto.randomUUID(),
          };

          const withBreak = [
            ...allCustomers.slice(0, breakResult.position),
            breakStop,
            ...allCustomers.slice(breakResult.position),
          ];

          return withBreak.map((s, i) => ({ ...s, stopOrder: i + 1 }));
        }

        return allCustomers.map((s, i) => ({ ...s, stopOrder: i + 1 }));
      });
      setReturnToDepotLeg(null);
      setSelectedIds(new Set());
      setHasChanges(true);
      incrementRouteVersion();

      // Trigger recalculation for the new stops
      setRouteStops((current) => {
        if (current.length > 0) {
          if (currentDepot) {
            triggerRecalculate(current);
          } else {
            pendingRecalcStopsRef.current = current;
          }
        }
        return current; // no mutation, just read
      });
    }
  }, [selectedIds, inRouteIds, candidates, routeStops.length, breakSettings, context, enforceDrivingBreakRule, incrementRouteVersion, triggerRecalculate, currentDepot, defaultServiceDurationMinutes]);

  // Route building: add single candidate from detail panel
  const handleAddToRoute = useCallback((candidateId: string, serviceDurationOverride?: number, insertAfterIndex?: number) => {
    const candidate = candidates.find((c) => c.id === candidateId || c.customerId === candidateId);
    if (!candidate || !candidate.customerLat || !candidate.customerLng) return;
    if (inRouteIds.has(candidate.customerId)) return;
    const resolvedServiceDurationMinutes = serviceDurationOverride ?? defaultServiceDurationMinutes;

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
      // Use slot-picker override first, then fall back to already-agreed appointment
      scheduledDate: candidate._scheduledDate ?? candidate.scheduledDate ?? null,
      scheduledTimeStart: candidate._scheduledTimeStart ?? candidate.scheduledTimeStart ?? null,
      scheduledTimeEnd: candidate._scheduledTimeEnd ?? candidate.scheduledTimeEnd ?? null,
      serviceDurationMinutes: resolvedServiceDurationMinutes,
      revisionStatus: candidate.status ?? null,
    };

    // Use insertAfterIndex when provided (from slot suggestions / PlanningTimeline gaps),
    // otherwise find the correct chronological position by scheduledTimeStart.
    let finalStops: SavedRouteStop[] = [];

    setRouteStops((prev) => {
      // Determine where to insert the new customer stop
      const insertIdx = insertAfterIndex !== undefined
        ? insertAfterIndex
        : findChronologicalPosition(prev, newStop);
      const updated = insertStopAtPosition(prev, newStop, insertIdx);

      // Separate customer stops from breaks – we always recalculate break position
      const customerStops = updated.filter(s => s.stopType === 'customer');

      // Auto-insert / reposition break if enabled and we have enough customer stops
      if (breakSettings?.breakEnabled && customerStops.length >= 2) {
        const effectiveBreakSettings: BreakSettings = {
          ...breakSettings,
          breakDurationMinutes: enforceDrivingBreakRule
            ? Math.max(breakSettings.breakDurationMinutes, 45)
            : breakSettings.breakDurationMinutes,
        };
        // Calculate optimal break position from scratch (on customer stops only)
        const breakResult = calculateBreakPosition(
          customerStops,
          effectiveBreakSettings,
          routeStartTime || '08:00',
          {
            enforceDrivingBreakRule,
            maxDrivingMinutes: 270,
            requiredBreakMinutes: 45,
          }
        );

        setBreakWarnings(breakResult.warnings);
        setIsBreakManuallyAdjusted(false);

        // Preserve existing break id if one already existed, otherwise create new
        const existingBreak = updated.find(s => s.stopType === 'break');
        const breakStop: SavedRouteStop = {
          ...createBreakStop('', breakResult.position + 1, effectiveBreakSettings, breakResult.estimatedTime, { floating: true }),
          id: existingBreak?.id ?? crypto.randomUUID(),
        };

        const withBreak = [
          ...customerStops.slice(0, breakResult.position),
          breakStop,
          ...customerStops.slice(breakResult.position),
        ];

        finalStops = withBreak.map((s, i) => ({ ...s, stopOrder: i + 1 }));
        return finalStops;
      }

      finalStops = updated;
      return updated;
    });
    setReturnToDepotLeg(null);
    setHasChanges(true);
    incrementRouteVersion();

    // Fire quick recalculation in the background to get updated ETAs.
    // Use the finalStops snapshot directly (not state).
    // If depot is not ready yet, queue for the pending-recalc effect.
    if (finalStops.length > 0) {
      if (currentDepot) {
        triggerRecalculate(finalStops);
      } else {
        pendingRecalcStopsRef.current = finalStops;
      }
    }
  }, [candidates, inRouteIds, routeStops.length, breakSettings, enforceDrivingBreakRule, incrementRouteVersion, triggerRecalculate, routeStartTime, currentDepot, defaultServiceDurationMinutes]);

  // Route building: reorder stops via drag-and-drop
  const handleReorder = useCallback((newStops: SavedRouteStop[]) => {
    setRouteStops(newStops);
    setHasChanges(true);
    incrementRouteVersion();
    // Auto-recalculate ETAs after reorder
    triggerRecalculate(newStops);
  }, [incrementRouteVersion, triggerRecalculate]);

  // Route building: update arrival buffer
  const handleBufferChange = useCallback((percent: number, fixedMinutes: number) => {
    setRouteBufferPercent(percent);
    setRouteBufferFixedMinutes(fixedMinutes);
    setHasChanges(true);
    if (routeStops.length > 0) {
      triggerRecalculate(routeStops, { percent, fixed: fixedMinutes });
    }
  }, [routeStops, triggerRecalculate]);

  // Route building: remove stop from route
  const handleRemoveFromRoute = useCallback(async (stopId: string) => {
    let remaining: SavedRouteStop[] = [];
    setRouteStops((prev) => {
      const filtered = prev.filter((s) => s.id !== stopId && s.customerId !== stopId);
      remaining = filtered.map((s, i) => ({ ...s, stopOrder: i + 1 }));
      return remaining;
    });
    setReturnToDepotLeg(null);
    incrementRouteVersion();

    // If no stops remain, delete the route from backend instead of relying on auto-save
    if (remaining.length === 0 && loadedRouteId) {
      try {
        await routeService.deleteRoute(loadedRouteId);
        setLoadedRouteId(null);
        setHasChanges(false);
      } catch (err) {
        logger.error('Failed to delete route after removing last stop:', err);
        setHasChanges(true);
      }
    } else {
      setHasChanges(true);
      // Auto-recalculate ETAs for the remaining stops
      triggerRecalculate(remaining);
    }
  }, [loadedRouteId, incrementRouteVersion, triggerRecalculate]);

  // Route building: optimize route via VRP solver
  const handleOptimizeRoute = useCallback(async () => {
    if (routeStops.length < 2 || !context) return;
    const customerStops = routeStops
      .filter((s) => s.stopType === 'customer' && !!s.customerId);
    const customerIds = customerStops.map((s) => s.customerId as string);
    if (customerIds.length < 2) return;

    const depot = depots.find((d) => d.id === context.depotId);
    
    // Use first stop as fallback start location if no depot
    const startLocation = depot
      ? { lat: depot.lat, lng: depot.lng }
      : { lat: routeStops[0].customerLat ?? 0, lng: routeStops[0].customerLng ?? 0 };

    // Extract time windows from saved route stops so the optimizer
    // can respect the agreed schedule even when revisions table doesn't
    // have matching records.
    const timeWindows = customerStops
      .filter((s) => s.scheduledTimeStart && s.scheduledTimeEnd)
      .map((s) => ({
        customerId: s.customerId as string,
        start: s.scheduledTimeStart!,
        end: s.scheduledTimeEnd!,
      }));

    setIsOptimizing(true);
    setRouteJobProgress(t('optimizer_sending'));

    try {
      const jobResponse = await routeService.submitRoutePlanJob({
        customerIds,
        date: context.date,
        startLocation,
        crewId: context.crewId || undefined,
        timeWindows: timeWindows.length > 0 ? timeWindows : undefined,
        arrivalBufferPercent: routeBufferPercent,
        arrivalBufferFixedMinutes: routeBufferFixedMinutes,
      });

      setRouteJobProgress(t('optimizer_queued'));

      // Subscribe to status updates
      const unsubscribe = await routeService.subscribeToRouteJobStatus(
        jobResponse.jobId,
        (update) => {
          switch (update.status.type) {
            case 'queued':
              setRouteJobProgress(t('optimizer_queued_position', { position: update.status.position }));
              break;
            case 'processing':
              setRouteJobProgress(t('optimizer_progress', { progress: update.status.progress }));
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
                    distanceFromPreviousKm: s.distanceFromPreviousKm ?? null,
                    durationFromPreviousMinutes: s.durationFromPreviousMinutes ?? null,
                    status: original?.status ?? 'draft',
                    stopType: isBreak ? 'break' : 'customer',
                    customerId: isBreak ? null : s.customerId,
                    customerName: isBreak ? t('timeline_break') : s.customerName,
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
                // Re-attach unassigned stops at the end with a warning
                const unassignedIds = new Set(result.unassigned ?? []);
                if (unassignedIds.size > 0) {
                  const unassignedOriginals = routeStops.filter(
                    (rs) => rs.customerId && unassignedIds.has(rs.customerId)
                  );
                  let order = optimizedStops.length;
                  for (const orig of unassignedOriginals) {
                    order++;
                    optimizedStops.push({
                      ...orig,
                      stopOrder: order,
                      estimatedArrival: null,
                      estimatedDeparture: null,
                      distanceFromPreviousKm: null,
                      durationFromPreviousMinutes: null,
                      status: 'unassigned',
                    });
                  }
                }

                setRouteStops(optimizedStops);
                setReturnToDepotLeg({
                  distanceKm: result.returnToDepotDistanceKm ?? null,
                  durationMinutes: result.returnToDepotDurationMinutes ?? null,
                });

                // Store solver warnings (LATE_ARRIVAL, INSUFFICIENT_BUFFER, etc.)
                const allWarnings = [...(result.warnings ?? [])];
                if (unassignedIds.size > 0) {
                  const names = routeStops
                    .filter((rs) => rs.customerId && unassignedIds.has(rs.customerId))
                    .map((rs) => rs.customerName)
                    .join(', ');
                  allWarnings.push({
                    warningType: 'UNASSIGNED_STOPS',
                    message: t('optimizer_unassigned', { names }),
                    stopIndex: null,
                  });
                }
                setRouteWarnings(allWarnings);

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
      logger.error('Failed to optimize route:', message, err);
      setRouteJobProgress(`Chyba: ${message}`);
      setIsOptimizing(false);
      setTimeout(() => setRouteJobProgress(null), 8000);
    }
  }, [routeStops, context, depots]);

  // Route building: add floating break manually
  const handleAddBreak = useCallback(() => {
    if (!breakSettings) return;
    setRouteStops((prev) => {
      const existingBreak = prev.find((s) => s.stopType === 'break');
      if (existingBreak) return prev;

      const customerStops = prev.filter((s) => s.stopType === 'customer');
      const effectiveBreakSettings: BreakSettings = {
        ...breakSettings,
        breakDurationMinutes: enforceDrivingBreakRule
          ? Math.max(breakSettings.breakDurationMinutes, 45)
          : breakSettings.breakDurationMinutes,
      };

      const breakResult = calculateBreakPosition(
        customerStops,
        effectiveBreakSettings,
        routeStartTime || '08:00',
        {
          enforceDrivingBreakRule,
          maxDrivingMinutes: 270,
          requiredBreakMinutes: 45,
        }
      );

      setBreakWarnings(breakResult.warnings);
      setIsBreakManuallyAdjusted(false);

      const breakStop: SavedRouteStop = {
        ...createBreakStop('', breakResult.position + 1, effectiveBreakSettings, breakResult.estimatedTime, { floating: true }),
        id: crypto.randomUUID(),
      };

      const withBreak = [
        ...customerStops.slice(0, breakResult.position),
        breakStop,
        ...customerStops.slice(breakResult.position),
      ];
      return withBreak.map((s, i) => ({ ...s, stopOrder: i + 1 }));
    });
    setHasChanges(true);
    incrementRouteVersion();
  }, [breakSettings, context, enforceDrivingBreakRule, incrementRouteVersion]);

  // Route building: update break start time or duration
  const handleUpdateBreak = useCallback((stopId: string, patch: { breakTimeStart?: string; breakDurationMinutes?: number }) => {
    setIsBreakManuallyAdjusted(true);
    setRouteStops((prev) =>
      prev.map((s) => {
        if (s.id !== stopId || s.stopType !== 'break') return s;
        const breakTimeStart = patch.breakTimeStart ?? s.breakTimeStart ?? '12:00';
        const breakDurationMinutes = patch.breakDurationMinutes ?? s.breakDurationMinutes ?? 30;
        const [h, m] = breakTimeStart.split(':').map(Number);
        const total = h * 60 + m + breakDurationMinutes;
        const depH = Math.floor(total / 60) % 24;
        const depM = total % 60;
        const estimatedDeparture = `${String(depH).padStart(2, '0')}:${String(depM).padStart(2, '0')}`;
        return {
          ...s,
          breakTimeStart,
          breakDurationMinutes,
          estimatedArrival: breakTimeStart,
          estimatedDeparture,
        };
      })
    );
    setHasChanges(true);
    incrementRouteVersion();
  }, [incrementRouteVersion]);

  // Route building: clear all stops and delete route from backend
  const handleClearRoute = useCallback(async () => {
    // If we have a saved route, delete it from the backend
    if (loadedRouteId) {
      try {
        await routeService.deleteRoute(loadedRouteId);
        setLoadedRouteId(null);
      } catch (err) {
        logger.error('Failed to delete route:', err);
      }
    }
    setRouteStops([]);
    setReturnToDepotLeg(null);
    setBreakWarnings([]);
    setRouteGeometry([]);
    setMetrics(null);
    setSelectedIds(new Set());
    setHasChanges(false); // Nothing to save — route is deleted
    incrementRouteVersion();
  }, [loadedRouteId, incrementRouteVersion]);

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

  const clearTimeFilters = useCallback(() => {
    setActivePresetId(null);
    setFilters((prev) => ({
      ...prev,
      groups: {
        ...prev.groups,
        time: { ...prev.groups.time, selected: [], enabled: false },
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
        {/* Always-visible row: presets + count + reset + expand toggle */}
        <div className={styles.filterPanelHeader}>
          <div className={styles.filterPresets}>
            {FILTER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`${styles.filterChip} ${activePresetId === preset.id ? styles.active : ''}`}
                onClick={() => applyPreset(preset.id)}
              >
                {t(preset.label)}
              </button>
            ))}
          </div>
          <span className={styles.filterResults}>
            {sortedCandidates.length}
            {activeFilterCount > 0 && !isAdvancedFiltersOpen && hasAdvancedActive && (
              <span className={styles.advancedHint} title={t('filter_advanced_hint')}>*</span>
            )}
          </span>
          <button
            type="button"
            className={styles.filterResetButton}
            onClick={clearFilters}
            disabled={activeFilterCount === 0}
            title={t('filter_reset')}
          >
            Reset
          </button>
          <CollapseButton
            collapsed={!isAdvancedFiltersOpen}
            onClick={() => setIsAdvancedFiltersOpen((prev) => !prev)}
            title={isAdvancedFiltersOpen ? t('filter_collapse') : t('filter_expand')}
          />
        </div>

        {/* Expandable section: detailed filters */}
        {isAdvancedFiltersOpen && (
          <div className={styles.filterExpandedSection}>
            <div className={styles.filterGroup}>
              <span className={styles.filterGroupLabel}>{t('filter_new_revision')}</span>
              <div className={styles.filterChips}>
                <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('OVERDUE') ? styles.active : ''}`} onClick={() => toggleTimeFilter('OVERDUE')}>{t('filter_overdue')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('DUE_IN_7_DAYS') ? styles.active : ''}`} onClick={() => toggleTimeFilter('DUE_IN_7_DAYS')}>{t('filter_due_7_days')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('DUE_IN_30_DAYS') ? styles.active : ''}`} onClick={() => toggleTimeFilter('DUE_IN_30_DAYS')}>{t('filter_due_30_days')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.length === 0 ? styles.active : ''}`} onClick={() => clearTimeFilters()}>{t('filter_anytime')}</button>
              </div>
            </div>

            <div className={styles.filterGroup}>
              <span className={styles.filterGroupLabel}>{t('filter_appointment')}</span>
              <div className={styles.filterTriState}>
                <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'ANY' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'ANY')}>{t('filter_any')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'YES' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'YES')}>{t('filter_has_term')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'NO' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'NO')}>{t('filter_no_appointment')}</button>
              </div>
            </div>

            <div className={styles.filterGroup}>
              <span className={styles.filterGroupLabel}>{t('filter_route')}</span>
              <div className={styles.filterTriState}>
                <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'ANY' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'ANY')}>{t('filter_any')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'YES' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'YES')}>{t('filter_in_route')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'NO' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'NO')}>{t('filter_not_in_route')}</button>
              </div>
            </div>

            <div className={styles.advancedPanel}>
              <div className={styles.advancedPanelHeader}>{t('filter_advanced')}</div>

              <div className={styles.advancedRow}>
                <span className={styles.filterGroupLabel}>{t('filter_group_logic')}</span>
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
                <span className={styles.filterGroupLabel}>{t('filter_revision_logic')}</span>
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
                <span className={styles.filterGroupLabel}>{t('filter_problems_label')}</span>
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
                  <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('MISSING_PHONE') ? styles.active : ''}`} onClick={() => toggleProblemFilter('MISSING_PHONE')}>{t('filter_missing_phone')}</button>
                  <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('ADDRESS_ISSUE') ? styles.active : ''}`} onClick={() => toggleProblemFilter('ADDRESS_ISSUE')}>{t('filter_address_issue')}</button>
                  <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('GEOCODE_FAILED') ? styles.active : ''}`} onClick={() => toggleProblemFilter('GEOCODE_FAILED')}>{t('filter_geocode_failed')}</button>
                </div>
              </div>

              <div className={styles.filterSummaryText}>{filterSummary}</div>
            </div>
          </div>
        )}
      </div>

      {/* Multi-crew tip */}
      {crewComparisons.length > 0 && (
        <MultiCrewTip
          currentCrew={context?.crewName ?? ''}
          comparisons={crewComparisons}
          onSwitchCrew={(crewId) => handleCrewChange(crewId)}
        />
      )}
      
      {/* Add to route toolbar */}
      {selectedIds.size > 0 && (
        <div className={styles.selectionToolbar}>
          <span className={styles.selectionCount}>{t('selected_count', { count: selectedIds.size })}</span>
          <button
            type="button"
            className={styles.addSelectedButton}
            onClick={handleAddSelectedToRoute}
          >
            ➕ {t('add_to_route')}
          </button>
          <button
            type="button"
            className={styles.clearSelectionButton}
            onClick={() => setSelectedIds(new Set())}
          >
            {t('cancel_selection')}
          </button>
        </div>
      )}
      
      {/* Virtualized candidate list */}
      <VirtualizedInboxList
        ref={listRef}
        candidates={candidateRowData}
        selectedCandidateId={selectedCandidateId}
        onCandidateSelect={handleCandidateSelect}
        isLoading={isLoadingCandidates}
        emptyMessage={t('empty_filtered')}
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
                {getMonthNames('long')[overviewDate.getMonth()]}
              </span>
              <span className={styles.dayOverviewCalDay}>
                {overviewDate.getDate()}
              </span>
              <span className={styles.dayOverviewCalWeekday}>
                {getWeekdayNames('long')[(overviewDate.getDay() + 6) % 7]}
              </span>
            </div>
            <div className={styles.dayOverviewBannerInfo}>
              <span className={styles.dayOverviewBannerYear}>
                {overviewDate.getFullYear()}
              </span>
              <span className={styles.dayOverviewBannerCount}>
                {t('day_overview_visits', { count: dayOverview.items.length })}
              </span>
            </div>
          </div>
          
          {/* Visit list */}
          <div className={styles.dayOverviewList}>
            <div className={styles.dayOverviewListHeader}>{t('day_overview_planned')}</div>
            {dayOverview.isLoading ? (
              <div className={styles.dayOverviewLoading}>{t('day_overview_loading')}</div>
            ) : sortedItems.length === 0 ? (
              <div className={styles.dayOverviewEmpty}>{t('day_overview_empty')}</div>
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
                        {item.type === 'revision' ? t('day_overview_type_revision') : t('day_overview_type_visit')}
                        {item.subtitle ? ` · ${item.subtitle}` : ''}
                      </span>
                    </div>
                    {isJustScheduled && (
                      <span className={styles.dayOverviewItemBadge}>{t('day_overview_badge_new')}</span>
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
              debugSource="inbox-day-overview"
              debugRouteId={null}
              selectedCandidate={null}
              isLoading={dayOverview.isLoading}
            />
          </div>
        </div>
      );
    }
    
    return (
      <div className={`${styles.mapPanel} ${mapMode === 'fullscreen' ? styles.mapPanelFullscreen : ''}`}>
        {mapMode !== 'collapsed' && (
          <div className={`${styles.mapSection} ${mapMode === 'fullscreen' ? styles.mapSectionFullscreen : ''}`} style={mapMode === 'normal' ? { height: mapHeight } : undefined}>
            <RouteMapPanel
              stops={routeStops}
              depot={currentDepot}
              routeGeometry={routeGeometry}
              highlightedStopId={selectedCandidateId}
              highlightedSegment={highlightedSegment}
              debugSource="inbox-main"
              debugRouteId={loadedRouteId}
              selectedCandidate={selectedCandidateForMap}
              insertionPreview={insertionPreviewForMap}
              onSegmentHighlight={setHighlightedSegment}
              isLoading={isLoadingRoute}
            />
            <div className={styles.mapControls}>
              <button
                type="button"
                className={styles.mapControlButton}
                onClick={() => setMapMode(mapMode === 'fullscreen' ? 'normal' : 'fullscreen')}
                title={mapMode === 'fullscreen' ? t('map_shrink') : t('map_fullscreen')}
              >
                {mapMode === 'fullscreen' ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9,1 13,1 13,5" /><polyline points="5,13 1,13 1,9" />
                    <line x1="13" y1="1" x2="8.5" y2="5.5" /><line x1="1" y1="13" x2="5.5" y2="8.5" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="10,4 14,0" /><polyline points="4,10 0,14" />
                    <polyline points="10,1 13,1 13,4" /><polyline points="4,13 1,13 1,10" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className={styles.mapControlButton}
                onClick={() => setMapMode('collapsed')}
                title={t('map_hide')}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="2,5 7,1 12,5" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {mapMode === 'collapsed' && (
          <div className={styles.mapCollapsedBar}>
            <span className={styles.mapCollapsedLabel}>{t('map_label')}</span>
            <CollapseButton
              collapsed={true}
              onClick={() => setMapMode('normal')}
              title={t('map_show')}
            />
          </div>
        )}
        {mapMode === 'normal' && (
          <div className={styles.mapResizeHandle} onMouseDown={handleMapResizeStart} title={t('map_resize')} />
        )}
        {mapMode !== 'fullscreen' && (
        <div className={styles.routeStopSection}>
          {contextSelectorsJsx}

          {/* Stats + action buttons bar — above timeline */}
          <div className={styles.routeSummaryBar}>
            <RouteSummaryStats
              routeStartTime={actualRouteStart}
              routeEndTime={actualRouteEnd}
              metrics={metrics}
              stopCount={routeStops.filter(s => s.stopType !== 'break').length}
            />
            <RouteSummaryActions
              onOptimize={handleOptimizeRoute}
              onAddBreak={handleAddBreak}
              onDeleteRoute={handleClearRoute}
              isOptimizing={isOptimizing}
              canOptimize={routeStops.length >= 2}
              deleteLabel="Smazat trasu"
            />
          </div>

          {/* Arrival buffer bar — between actions and timeline */}
          <ArrivalBufferBar
            percent={routeBufferPercent}
            fixedMinutes={routeBufferFixedMinutes}
            onChange={handleBufferChange}
          />

          {timelineView === 'compact' ? (
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
              onReorder={handleReorder}
              onRemoveStop={handleRemoveFromRoute}
              onUpdateBreak={handleUpdateBreak}
              isSaving={isSaving}
              warnings={routeWarnings}
              routeStartTime={routeStartTime}
              routeEndTime={routeEndTime}
              depotDeparture={depotDeparture}
              returnToDepotDistanceKm={returnToDepotLeg?.distanceKm ?? null}
              returnToDepotDurationMinutes={returnToDepotLeg?.durationMinutes ?? null}
            />
          ) : (
            <PlanningTimeline
              stops={routeStops}
              depot={currentDepot ? { ...currentDepot, name: currentDepot.name ?? 'Depo' } : null}
              selectedStopId={selectedCandidateId}
              onStopClick={(customerId) => {
                setSelectedCandidateId(customerId);
                setHighlightedSegment(null);
              }}
              onReorder={handleReorder}
              onRemoveStop={handleRemoveFromRoute}
              onUpdateBreak={handleUpdateBreak}
              isSaving={isSaving}
              routeStartTime={routeStartTime}
              routeEndTime={routeEndTime}
              depotDeparture={depotDeparture}
              returnToDepotDistanceKm={returnToDepotLeg?.distanceKm ?? null}
              returnToDepotDurationMinutes={returnToDepotLeg?.durationMinutes ?? null}
              candidateForInsertion={candidateForInsertion}
              onInsertCandidate={(insertAfterIndex) => {
                if (selectedCandidate) {
                  handleAddToRoute(selectedCandidate.customerId, insertAfterIndex);
                }
              }}
            />
          )}
        </div>
        )}
      </div>
    );
  };

  // Render detail panel
  const renderDetailPanel = () => (
    <div className={styles.detailPanel}>
      {scheduledConfirmation && scheduledConfirmation.candidateId === selectedCandidateId ? (
        <div className={styles.confirmation}>
          <div className={styles.confirmationIcon}>✓</div>
          <h3 className={styles.confirmationTitle}>{t('confirmation_title')}</h3>
          <p className={styles.confirmationName}>{scheduledConfirmation.candidateName}</p>
          
          <div className={styles.confirmationDate}>
            <div className={styles.calendarCard}>
              <span className={styles.calendarMonth}>
                {getMonthNames('long')[new Date(scheduledConfirmation.date + 'T00:00:00').getMonth()]}
              </span>
              <span className={styles.calendarDay}>
                {new Date(scheduledConfirmation.date + 'T00:00:00').getDate()}
              </span>
              <span className={styles.calendarWeekday}>
                {getWeekdayNames('long')[(new Date(scheduledConfirmation.date + 'T00:00:00').getDay() + 6) % 7]}
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
            {t('confirmation_next')}
          </button>
        </div>
      ) : (
        <CandidateDetail
          candidate={selectedCandidateDetail}
          onSchedule={handleSchedule}
          onSnooze={handleSnooze}
          onUpdateCustomer={handleUpdateCustomer}
          isLoading={isCalculatingSlots}
          onAddToRoute={(candidateId, serviceDurationMinutes) =>
            handleAddToRoute(candidateId, serviceDurationMinutes)
          }
          onRemoveFromRoute={handleRemoveFromRoute}
          isInRoute={selectedCandidateId ? inRouteIds.has(selectedCandidateId) : false}
          routeDate={context?.date}
          defaultServiceDurationMinutes={defaultServiceDurationMinutes}
        />
      )}
    </div>
  );

  // Context selectors JSX for the right column
  const contextSelectorsJsx = (
    <div className={styles.contextSelectorsRow}>
      <div className={styles.selector}>
        <label htmlFor="route-date">{t('context_day')}</label>
        <input
          id="route-date"
          type="date"
          value={context?.date ?? ''}
          onChange={(e) => handleDateChange(e.target.value)}
          className={styles.dateInput}
        />
      </div>

      <div className={styles.selector}>
        <label htmlFor="route-crew">{t('context_crew')}</label>
        <select
          id="route-crew"
          value={context?.crewId ?? ''}
          onChange={(e) => handleCrewChange(e.target.value)}
          className={styles.select}
        >
          <option value="">{t('context_crew_select')}</option>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>{crew.name}</option>
          ))}
        </select>
      </div>

      <div className={styles.selector}>
        <label htmlFor="route-depot">{t('context_depot')}</label>
        <select
          id="route-depot"
          value={context?.depotId ?? ''}
          onChange={(e) => handleDepotChange(e.target.value)}
          className={styles.select}
        >
          <option value="">{t('context_depot_select')}</option>
          {depots.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      <div className={styles.timelineToggleInline}>
        <TimelineViewToggle value={timelineView} onChange={setTimelineView} />
      </div>
    </div>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('page_title')}</h1>
        <DraftModeBar
          hasChanges={hasChanges}
          isSaving={isSaving}
          lastSaved={lastSaved}
          saveError={saveError}
          onRetry={retrySave}
        />
      </header>
      {isBreakManuallyAdjusted && breakWarnings.length > 0 && (
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
