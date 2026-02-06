import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearch } from '@tanstack/react-router';
import type { Customer, UpdateCustomerRequest } from '@shared/customer';
import { 
  getCustomer, 
  updateCustomer, 
  deleteCustomer, 
  submitGeocodeJob, 
  subscribeToGeocodeJobStatus,
  type GeocodeJobStatusUpdate,
} from '../services/customerService';
import { listCrews, type Crew as CrewData } from '../services/crewService';
import { listDepots } from '../services/settingsService';
import type { Depot } from '@shared/settings';
import * as routeService from '../services/routeService';
import * as insertionService from '../services/insertionService';
import { CustomerWorkspace, type TabId } from '../components/customers/CustomerWorkspace';
import { CustomerHeader } from '../components/customers/CustomerHeader';
import { CustomerEditDrawer } from '../components/customers/CustomerEditDrawer';
import { DeleteConfirmDialog } from '../components/customers/DeleteConfirmDialog';
import { ScheduleDialog, type ScheduleTarget, type Crew } from '../components/common/ScheduleDialog';
import type { SlotSuggestion } from '../components/planner/SlotSuggestions';
import { DeviceList } from '../components/devices';
import { CustomerTimeline } from '../components/timeline';
import { useNatsStore } from '../stores/natsStore';
import styles from './CustomerDetail.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

// Default mock crews (fallback when none in database)
const DEFAULT_CREWS: Crew[] = [
  { id: 'default-1', name: 'Posádka 1', licensePlate: '1A1 1234' },
  { id: 'default-2', name: 'Posádka 2', licensePlate: '2B2 5678' },
];

interface SearchParams {
  edit?: boolean;
  tab?: TabId;
}

export function CustomerDetail() {
  const { customerId } = useParams({ strict: false }) as { customerId: string };
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as SearchParams;
  
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [geocodeJob, setGeocodeJob] = useState<GeocodeJobStatusUpdate | null>(null);
  const geocodeUnsubscribeRef = useRef<(() => void) | null>(null);
  
  // Edit drawer (replaces full-page form)
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(searchParams?.edit ?? false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Active tab
  const [activeTab, setActiveTab] = useState<TabId>(searchParams?.tab || 'devices');
  
  // Delete dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Schedule dialog
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [depots, setDepots] = useState<Depot[]>([]);

  const isConnected = useNatsStore((s) => s.isConnected);

  const loadCustomer = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    if (!customerId) {
      setError('ID zákazníka není zadáno');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await getCustomer(TEMP_USER_ID, customerId);
      setCustomer(data);
    } catch (err) {
      console.error('Failed to load customer:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst zákazníka');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, customerId]);

  useEffect(() => {
    loadCustomer();
  }, [loadCustomer]);

  useEffect(() => {
    return () => {
      if (geocodeUnsubscribeRef.current) {
        geocodeUnsubscribeRef.current();
        geocodeUnsubscribeRef.current = null;
      }
    };
  }, []);

  const handleOpenEditDrawer = useCallback(() => {
    setIsEditDrawerOpen(true);
    setError(null);
  }, []);

  const handleCloseEditDrawer = useCallback(() => {
    setIsEditDrawerOpen(false);
  }, []);

  const handleSubmitEdit = useCallback(async (data: UpdateCustomerRequest) => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const updated = await updateCustomer(TEMP_USER_ID, data as UpdateCustomerRequest);
      setCustomer(updated);
      setIsEditDrawerOpen(false);

      const addressChanged = Boolean(data.street || data.city || data.postalCode);
      const hasCoords = data.lat !== undefined && data.lng !== undefined;
      if (addressChanged && !hasCoords) {
        const job = await submitGeocodeJob(TEMP_USER_ID, [updated.id]);
        setGeocodeJob({
          jobId: job.jobId,
          timestamp: new Date().toISOString(),
          status: { type: 'queued', position: 1 },
        });
        if (geocodeUnsubscribeRef.current) {
          geocodeUnsubscribeRef.current();
        }
        const unsubscribe = await subscribeToGeocodeJobStatus(job.jobId, (update) => {
          setGeocodeJob(update);
          if (update.status.type === 'completed' || update.status.type === 'failed') {
            loadCustomer();
            if (geocodeUnsubscribeRef.current) {
              geocodeUnsubscribeRef.current();
              geocodeUnsubscribeRef.current = null;
            }
          }
        });
        geocodeUnsubscribeRef.current = unsubscribe;
      }
    } catch (err) {
      console.error('Failed to update customer:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se aktualizovat zákazníka');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, loadCustomer]);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteDialog(true);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setShowDeleteDialog(false);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!isConnected || !customerId) {
      setError('Není připojení k serveru');
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);
      await deleteCustomer(TEMP_USER_ID, customerId);
      navigate({ to: '/customers' });
    } catch (err) {
      console.error('Failed to delete customer:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se smazat zákazníka');
      setShowDeleteDialog(false);
    } finally {
      setIsDeleting(false);
    }
  }, [isConnected, customerId, navigate]);

  // Handle "Add to Plan" action - open schedule dialog
  const handleAddToPlan = useCallback(async () => {
    if (customer?.lat && customer?.lng) {
      // Always start with default crews, then try to fetch from backend
      setCrews(DEFAULT_CREWS);
      
      // Load crews and depots when opening dialog
      try {
        const [crewList, depotList] = await Promise.all([
          listCrews(true),
          listDepots(TEMP_USER_ID),
        ]);
        // Use fetched crews if available, otherwise keep defaults
        if (crewList.length > 0) {
          setCrews(crewList.map((crew: CrewData) => ({
            id: crew.id,
            name: crew.name,
            licensePlate: undefined,
          })));
        }
        setDepots(depotList);
      } catch (err) {
        console.error('Failed to load crews/depots:', err);
        // Keep defaults on error (already set above)
      }
      setShowScheduleDialog(true);
    }
  }, [customer?.lat, customer?.lng]);

  // Fetch slot suggestions for the schedule dialog
  const handleFetchSlots = useCallback(async (
    _targetId: string,
    date: string,
    _crewId: string
  ): Promise<SlotSuggestion[]> => {
    if (!customer?.lat || !customer?.lng) {
      return [];
    }

    try {
      // Get the current route for the selected date
      const routeResponse = await routeService.getRoute(date);
      
      // Get depot coordinates (use first depot or default)
      const depot = depots[0];
      const depotCoords = depot 
        ? { lat: depot.lat, lng: depot.lng }
        : { lat: 49.1951, lng: 16.6068 }; // Default: Brno

      // Convert route stops to insertion format
      const routeStops: insertionService.RouteStop[] = routeResponse.stops?.map(stop => ({
        id: stop.customerId || stop.id,
        name: stop.customerName || 'Unknown',
        coordinates: { lat: stop.customerLat ?? 0, lng: stop.customerLng ?? 0 },
        arrivalTime: stop.estimatedArrival ?? undefined,
        departureTime: stop.estimatedDeparture ?? undefined,
      })) || [];

      // Calculate insertion positions
      const insertionResponse = await insertionService.calculateInsertion({
        routeStops,
        depot: depotCoords,
        candidate: {
          id: customer.id,
          customerId: customer.id,
          coordinates: { lat: customer.lat, lng: customer.lng },
          serviceDurationMinutes: 30,
        },
        date,
      });

      // Convert to SlotSuggestion format
      const suggestions: SlotSuggestion[] = insertionResponse.allPositions.map((pos, idx) => ({
        id: `slot-${idx}`,
        date,
        timeStart: pos.estimatedArrival ?? '',
        timeEnd: pos.estimatedDeparture ?? '',
        status: pos.status as 'ok' | 'tight' | 'conflict',
        deltaKm: pos.deltaKm,
        deltaMin: pos.deltaMin,
        insertAfterIndex: pos.insertAfterIndex,
        insertAfterName: pos.insertAfterName,
        insertBeforeName: pos.insertBeforeName,
      }));

      // Return suggestions or default slots if empty
      if (suggestions.length > 0) {
        return suggestions;
      }
      
      // Return default time slots when no route exists
      return [
        { id: 'slot-morning', date, timeStart: '08:00', timeEnd: '08:30', status: 'ok' as const, deltaKm: 0, deltaMin: 0, insertAfterIndex: -1, insertAfterName: 'Start', insertBeforeName: 'Konec' },
        { id: 'slot-midmorning', date, timeStart: '10:00', timeEnd: '10:30', status: 'ok' as const, deltaKm: 0, deltaMin: 0, insertAfterIndex: -1, insertAfterName: 'Start', insertBeforeName: 'Konec' },
        { id: 'slot-afternoon', date, timeStart: '14:00', timeEnd: '14:30', status: 'ok' as const, deltaKm: 0, deltaMin: 0, insertAfterIndex: -1, insertAfterName: 'Start', insertBeforeName: 'Konec' },
      ];
    } catch (err) {
      console.error('Failed to fetch slots:', err);
      // Return a default slot if route calculation fails
      return [{
        id: 'default-slot',
        date,
        timeStart: '08:00',
        timeEnd: '08:30',
        status: 'ok',
        deltaKm: 0,
        deltaMin: 0,
        insertAfterIndex: -1,
        insertAfterName: 'Start',
        insertBeforeName: 'Konec',
      }];
    }
  }, [customer?.id, customer?.lat, customer?.lng, depots]);

  // Handle schedule from dialog
  const handleSchedule = useCallback(async (
    _targetId: string,
    _date: string,
    _crewId: string,
    _slot: SlotSuggestion
  ) => {
    setIsScheduling(true);
    try {
      // TODO: Call actual scheduling API
      console.log('Scheduling visit:', { _targetId, _date, _crewId, _slot });
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 500));
      setShowScheduleDialog(false);
    } finally {
      setIsScheduling(false);
    }
  }, []);

  // Schedule target for dialog
  const scheduleTarget: ScheduleTarget | null = customer ? {
    id: customer.id,
    name: 'Nová návštěva',
    customerName: customer.name,
    lat: customer.lat || 0,
    lng: customer.lng || 0,
  } : null;

  // Handle tab change
  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
  }, []);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Načítám zákazníka...</span>
        </div>
      </div>
    );
  }

  if (error && !customer) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <h2>Chyba</h2>
          <p>{error}</p>
          <button onClick={() => navigate({ to: '/customers' })} className={styles.backButton}>
            ← Zpět na seznam
          </button>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>🔍</span>
          <h2>Zákazník nenalezen</h2>
          <p>Požadovaný zákazník neexistuje nebo byl smazán.</p>
          <button onClick={() => navigate({ to: '/customers' })} className={styles.backButton}>
            ← Zpět na seznam
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header with CTAs */}
      <CustomerHeader
        customer={customer}
        onEdit={handleOpenEditDrawer}
        onAddToPlan={handleAddToPlan}
        onDelete={handleDeleteClick}
      />

      {/* Error banner */}
      {error && (
        <div className={styles.errorBanner}>
          <span>⚠️</span>
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Geocoding progress */}
      {geocodeJob && geocodeJob.status.type !== 'completed' && (
        <div className={styles.infoBanner}>
          <span>ℹ️</span>
          <span>
            {geocodeJob.status.type === 'queued' && 'Geokódování: čeká ve frontě'}
            {geocodeJob.status.type === 'processing' &&
              `Geokódování: ${geocodeJob.status.processed}/${geocodeJob.status.total}`}
            {geocodeJob.status.type === 'failed' && `Geokódování selhalo: ${geocodeJob.status.error}`}
          </span>
        </div>
      )}

      {/* Address warning */}
      {customer.geocodeStatus === 'failed' && (
        <div className={styles.warningBanner}>
          <span>⚠️</span>
          <span>Adresu nelze lokalizovat. Zákazník nebude zahrnut do optimalizace tras.</span>
          <button onClick={handleOpenEditDrawer}>Opravit adresu</button>
        </div>
      )}

      {/* Main workspace with sidebar and tabs */}
      <CustomerWorkspace
        customer={customer}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        tabs={{
          devices: (
            <DeviceList
              customerId={customer.id}
              userId={TEMP_USER_ID}
            />
          ),
          revisions: (
            <CustomerTimeline customerId={customer.id} />
          ),
        }}
      />

      {/* Edit drawer (slides in from right) */}
      <CustomerEditDrawer
        customer={customer}
        isOpen={isEditDrawerOpen}
        onClose={handleCloseEditDrawer}
        onSubmit={handleSubmitEdit}
        isSubmitting={isSubmitting}
        onGeocodeCompleted={loadCustomer}
      />

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteDialog}
        customerName={customer.name}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isDeleting={isDeleting}
      />

      {/* Schedule dialog (route-aware) */}
      <ScheduleDialog
        isOpen={showScheduleDialog}
        onClose={() => setShowScheduleDialog(false)}
        target={scheduleTarget}
        crews={crews}
        onSchedule={handleSchedule}
        onFetchSlots={handleFetchSlots}
        isSubmitting={isScheduling}
      />
    </div>
  );
}
