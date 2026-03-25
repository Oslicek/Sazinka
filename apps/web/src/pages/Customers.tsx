import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearch, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/i18n/formatters';
import type { 
  CreateCustomerRequest,
  Customer,
  CustomerListItem,
  ListCustomersRequest,
  GeocodeStatus,
  CustomerSummary,
} from '@shared/customer';
import { 
  createCustomer,
  getCustomer,
  listCustomersExtended,
  getCustomerSummary,
  submitGeocodeJob, 
  subscribeToGeocodeJobStatus, 
  type GeocodeJobStatusUpdate,
} from '../services/customerService';
import type { UpdateCustomerRequest } from '@shared/customer';
import { AddCustomerForm } from '../components/customers/AddCustomerForm';
import { CustomerTable } from '../components/customers/CustomerTable';
import { CustomerPreviewPanel } from '../components/customers/CustomerPreviewPanel';
import { CustomerEditDrawer } from '../components/customers/CustomerEditDrawer';
import { CustomerFilterBar } from '../components/customers/CustomerFilterBar';
import { AdvancedFilterPanel } from '../components/customers/AdvancedFilterPanel';
import { MobileFilterSheet } from '../components/customers/MobileFilterSheet';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { SplitView } from '../components/common/SplitView';
import { useNatsStore } from '../stores/natsStore';
import { useAuthStore } from '../stores/authStore';
import { updateCustomer } from '../services/customerService';
import { AlertTriangle } from 'lucide-react';
import styles from './Customers.module.css';
import { PersistenceProvider } from '../persistence/react/PersistenceProvider';
import { usePersistentControl } from '../persistence/react/usePersistentControl';
import { sessionAdapter, localAdapter } from '../persistence/adapters/singletons';
import { customersProfile, CUSTOMERS_PROFILE_ID } from '../persistence/profiles/customersProfile';
import { customersGridProfile, CUSTOMERS_GRID_PROFILE_ID } from '../persistence/profiles/customersGridProfile';
import {
  DEFAULT_SORT_MODEL,
  DEFAULT_VISIBLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  sanitizeSortModel,
  sanitizeVisibleColumns,
  sanitizeColumnOrder,
} from '../lib/customerColumns';
import type { SortEntry } from '../lib/customerColumns';

/** Page size for infinite scroll */
const PAGE_SIZE = 100;

interface SearchParams {
  /** Navigation intent: 'new' opens the add-customer form */
  action?: string;
}

function CustomersInner() {
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as SearchParams;

  // UPP controls — customers.filters (session) — 6 controls
  const { value: uppSearch, setValue: setUppSearch } = usePersistentControl<string>(
    CUSTOMERS_PROFILE_ID, 'search', 300,
  );
  const { value: uppViewMode, setValue: setViewMode } = usePersistentControl<'table' | 'cards'>(CUSTOMERS_PROFILE_ID, 'viewMode');
  const { value: uppGeocodeFilter, setValue: setGeocodeFilter } = usePersistentControl<GeocodeStatus | ''>(CUSTOMERS_PROFILE_ID, 'geocodeFilter');
  const { value: uppRevisionFilter, setValue: setRevisionFilter } = usePersistentControl<string>(CUSTOMERS_PROFILE_ID, 'revisionFilter');
  const { value: uppTypeFilter, setValue: setTypeFilter } = usePersistentControl<'company' | 'person' | ''>(CUSTOMERS_PROFILE_ID, 'typeFilter');

  // UPP controls — customers.grid (local) — sortModel, visibleColumns, columnOrder
  const { value: uppSortModel, setValue: setUppSortModel } = usePersistentControl<SortEntry[]>(
    CUSTOMERS_GRID_PROFILE_ID, 'sortModel',
  );
  const { value: uppVisibleColumns, setValue: setUppVisibleColumns } = usePersistentControl<string[]>(
    CUSTOMERS_GRID_PROFILE_ID, 'visibleColumns',
  );
  const { value: uppColumnOrder, setValue: setUppColumnOrder } = usePersistentControl<string[]>(
    CUSTOMERS_GRID_PROFILE_ID, 'columnOrder',
  );

  // Memoize to avoid new-reference churn on every render
  const sortModel: SortEntry[] = useMemo(
    () => sanitizeSortModel(uppSortModel ?? DEFAULT_SORT_MODEL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(uppSortModel)],
  );
  const visibleColumns: string[] = useMemo(
    () => sanitizeVisibleColumns(uppVisibleColumns ?? DEFAULT_VISIBLE_COLUMNS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(uppVisibleColumns)],
  );
  const columnOrder: string[] = useMemo(
    () => sanitizeColumnOrder(uppColumnOrder ?? DEFAULT_COLUMN_ORDER),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(uppColumnOrder)],
  );

  // UPP-only state (no URL coupling)
  const [localSearch, setLocalSearch] = useState<string>(uppSearch ?? '');
  const search = localSearch;
  const viewMode: 'table' | 'cards' = (uppViewMode === 'cards') ? 'cards' : 'table';
  const geocodeFilter: GeocodeStatus | '' = (uppGeocodeFilter as GeocodeStatus | '') ?? '';
  const revisionFilter: string = uppRevisionFilter ?? '';
  const typeFilter: 'company' | 'person' | '' = (uppTypeFilter as 'company' | 'person' | '') ?? '';

  const setSearch = useCallback((v: string) => { setLocalSearch(v); setUppSearch(v); }, [setUppSearch]);
  const setSortModel = useCallback((m: SortEntry[]) => setUppSortModel(sanitizeSortModel(m)), [setUppSortModel]);
  const setVisibleColumns = useCallback((cols: string[]) => setUppVisibleColumns(sanitizeVisibleColumns(cols)), [setUppVisibleColumns]);
  const setColumnOrder = useCallback((order: string[]) => setUppColumnOrder(sanitizeColumnOrder(order)), [setUppColumnOrder]);
  const handleResetColumns = useCallback(() => {
    setUppVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
    setUppColumnOrder(DEFAULT_COLUMN_ORDER);
  }, [setUppVisibleColumns, setUppColumnOrder]);

  const [showForm, setShowForm] = useState(searchParams?.action === 'new');

  // UPP control for advanced filters open state
  const { value: uppIsAdvancedFiltersOpen, setValue: setUppIsAdvancedFiltersOpen } =
    usePersistentControl<boolean>(CUSTOMERS_PROFILE_ID, 'isAdvancedFiltersOpen');
  const isAdvancedFiltersOpen = uppIsAdvancedFiltersOpen === true;
  const setIsAdvancedFiltersOpen = useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof open === 'function' ? open(isAdvancedFiltersOpen) : open;
      setUppIsAdvancedFiltersOpen(next);
    },
    [isAdvancedFiltersOpen, setUppIsAdvancedFiltersOpen],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortContractError, setSortContractError] = useState<string | null>(null);
  const [geocodeJob, setGeocodeJob] = useState<GeocodeJobStatusUpdate | null>(null);
  const geocodeUnsubscribeRef = useRef<(() => void) | null>(null);
  
  // Server-side summary stats (accurate across all customers)
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  
  // UPP: persist selected customer ID
  const { value: uppSelectedCustomerId, setValue: setUppSelectedCustomerId } =
    usePersistentControl<string | null>(CUSTOMERS_PROFILE_ID, 'selectedCustomerId');
  const selectedCustomerId: string | null =
    typeof uppSelectedCustomerId === 'string' ? uppSelectedCustomerId : null;

  // Selected customer for preview panel
  const [selectedCustomer, setSelectedCustomerState] = useState<CustomerListItem | null>(null);
  // Ref used by loadCustomers to read current selection without adding it to deps
  const selectedCustomerRef = useRef<CustomerListItem | null>(null);
  selectedCustomerRef.current = selectedCustomer;

  // Combined setter: update both local state and persisted ID
  const setSelectedCustomer = useCallback(
    (customer: CustomerListItem | null) => {
      setSelectedCustomerState(customer);
      setUppSelectedCustomerId(customer?.id ?? null);
    },
    [setUppSelectedCustomerId],
  );
  // Stable ref so loadCustomers can call the latest setter without adding it to deps
  const setSelectedCustomerRef = useRef(setSelectedCustomer);
  setSelectedCustomerRef.current = setSelectedCustomer;

  const [fullCustomer, setFullCustomer] = useState<Customer | null>(null);
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  
  // Edit drawer state
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  
  const isConnected = useNatsStore((s) => s.isConnected);
  const { t } = useTranslation('customers');
  const { isMobileUi } = useBreakpoint();

  // Build request options (without offset — managed separately)
  const requestOptions = useMemo<ListCustomersRequest>(() => {
    const options: ListCustomersRequest = {
      limit: PAGE_SIZE,
      sortModel,
    };
    
    if (search) {
      options.search = search;
    }
    
    if (geocodeFilter) {
      options.geocodeStatus = geocodeFilter;
    }
    
    if (revisionFilter === 'overdue') {
      options.hasOverdue = true;
    } else if (revisionFilter === 'week') {
      options.nextRevisionWithinDays = 7;
    } else if (revisionFilter === 'month') {
      options.nextRevisionWithinDays = 30;
    }

    if (typeFilter) {
      options.customerType = typeFilter as 'company' | 'person';
    }
    
    return options;
  }, [search, geocodeFilter, revisionFilter, typeFilter, sortModel]);

  // Load first page + summary when connected or filters change
  const loadCustomers = useCallback(async () => {
    if (!isConnected) {
      setError(t('error_not_connected'));
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Fetch first page and summary in parallel
      const [result, summaryResult] = await Promise.all([
        listCustomersExtended({ ...requestOptions, offset: 0 }),
        getCustomerSummary().catch(() => null),
      ]);

      setSortContractError(null);
      setCustomers(result.items);
      setTotal(result.total);
      if (summaryResult) setSummary(summaryResult);
      
      // Clear selection if the selected customer is no longer in the list
      const cur = selectedCustomerRef.current;
      if (cur && !result.items.some((c) => c.id === cur.id)) {
        setSelectedCustomerRef.current(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('error_load_failed');
      if (msg.includes('SORT_CONTRACT_ERROR')) {
        setSortContractError(msg);
      } else {
        console.error('Failed to load customers:', err);
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, requestOptions]);

  useEffect(() => {
    if (isConnected) {
      loadCustomers();
    }
  }, [isConnected, loadCustomers]);

  // Restore persisted selection when customers are first loaded
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current || !selectedCustomerId || selectedCustomer || customers.length === 0) return;
    hasRestoredRef.current = true;
    const found = customers.find((c) => c.id === selectedCustomerId);
    if (found) {
      setSelectedCustomerState(found); // bypass combined setter — UPP ID is already correct
    } else {
      setUppSelectedCustomerId(null); // persisted customer no longer exists → clear
    }
  }, [customers, selectedCustomerId, selectedCustomer, setUppSelectedCustomerId]);

  // Load next page (infinite scroll)
  const loadMore = useCallback(async () => {
    if (!isConnected || isLoadingMore || customers.length >= total) return;
    
    try {
      setIsLoadingMore(true);
      const result = await listCustomersExtended({
        ...requestOptions,
        offset: customers.length,
      });
      setCustomers(prev => [...prev, ...result.items]);
      setTotal(result.total);
    } catch (err) {
      console.error('Failed to load more customers:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isConnected, isLoadingMore, customers.length, total, requestOptions]);

  const handleAddCustomer = useCallback(async (data: CreateCustomerRequest) => {
    if (!isConnected) {
      setError(t('error_not_connected'));
      throw new Error('Not connected');
    }
    
    try {
      setIsSubmitting(true);
      setError(null);
      const newCustomer = await createCustomer(data);
      setShowForm(false);

      // Trigger async geocoding if coordinates are missing
      if (!newCustomer.lat || !newCustomer.lng) {
        const job = await submitGeocodeJob([newCustomer.id]);
        setGeocodeJob({
          jobId: job.jobId,
          timestamp: new Date().toISOString(),
          status: { type: 'queued', position: 1 },
        });
        // Subscribe to job status updates
        if (geocodeUnsubscribeRef.current) {
          geocodeUnsubscribeRef.current();
        }
        const unsubscribe = await subscribeToGeocodeJobStatus(job.jobId, (update) => {
          setGeocodeJob(update);
          if (update.status.type === 'completed' || update.status.type === 'failed') {
            loadCustomers();
            if (geocodeUnsubscribeRef.current) {
              geocodeUnsubscribeRef.current();
              geocodeUnsubscribeRef.current = null;
            }
          }
        });
        geocodeUnsubscribeRef.current = unsubscribe;
      } else {
        // Reload the list to show the new customer
        loadCustomers();
      }
    } catch (err) {
      console.error('Failed to create customer:', err);
      setError(err instanceof Error ? err.message : t('error_create_failed'));
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected, loadCustomers]);

  const handleCancel = useCallback(() => {
    setShowForm(false);
  }, []);

  useEffect(() => {
    return () => {
      if (geocodeUnsubscribeRef.current) {
        geocodeUnsubscribeRef.current();
        geocodeUnsubscribeRef.current = null;
      }
    };
  }, []);

  const handleShowForm = useCallback(() => {
    setError(null);
    setShowForm(true);
  }, []);

  // Fetch full customer when selection changes
  useEffect(() => {
    if (!isConnected || !selectedCustomer) {
      setFullCustomer(null);
      return;
    }

    let cancelled = false;
    setIsLoadingFull(true);

    getCustomer(selectedCustomer.id)
      .then((data) => {
        if (!cancelled) {
          setFullCustomer(data);
        }
      })
      .catch((err) => {
        console.error('Failed to load full customer:', err);
        if (!cancelled) setFullCustomer(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingFull(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isConnected, selectedCustomer?.id]);

  // Handle customer selection
  const handleSelectCustomer = useCallback((customer: CustomerListItem | null) => {
    setSelectedCustomer(customer);
  }, []);

  // Handle double click to navigate to detail
  const handleOpenDetail = useCallback((customer: CustomerListItem) => {
    navigate({ to: '/customers/$customerId', params: { customerId: customer.id } });
  }, [navigate]);

  // Handle edit from preview panel — open drawer inline
  const handleEdit = useCallback((_customer: CustomerListItem) => {
    if (fullCustomer) {
      setIsEditDrawerOpen(true);
    }
  }, [fullCustomer]);

  // Handle edit submit
  const handleEditSubmit = useCallback(async (data: UpdateCustomerRequest) => {
    if (!isConnected || !fullCustomer) return;

    try {
      setIsEditSubmitting(true);
      const updated = await updateCustomer(data);
      setFullCustomer(updated);
      setIsEditDrawerOpen(false);

      // Trigger geocoding if address changed
      const addressChanged = Boolean(data.street || data.city || data.postalCode);
      const hasCoords = data.lat !== undefined && data.lng !== undefined;
      if (addressChanged && !hasCoords) {
        const job = await submitGeocodeJob([updated.id]);
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
            loadCustomers();
            // Refresh full customer
            getCustomer(updated.id)
              .then(setFullCustomer)
              .catch(console.error);
            if (geocodeUnsubscribeRef.current) {
              geocodeUnsubscribeRef.current();
              geocodeUnsubscribeRef.current = null;
            }
          }
        });
        geocodeUnsubscribeRef.current = unsubscribe;
      } else {
        loadCustomers();
      }
    } catch (err) {
      console.error('Failed to update customer:', err);
      setError(err instanceof Error ? err.message : t('error_update_failed'));
    } finally {
      setIsEditSubmitting(false);
    }
  }, [isConnected, fullCustomer, loadCustomers]);

  const handleEditGeocodeCompleted = useCallback(() => {
    if (fullCustomer) {
      getCustomer(fullCustomer.id)
        .then(setFullCustomer)
        .catch(console.error);
    }
    loadCustomers();
  }, [fullCustomer, loadCustomers]);

  // Handle saved view selection
  const isNonDefaultSort = useMemo(
    () => JSON.stringify(sortModel) !== JSON.stringify(DEFAULT_SORT_MODEL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(sortModel)],
  );

  const handleResetSort = useCallback(() => {
    setSortModel(DEFAULT_SORT_MODEL);
  }, [setSortModel]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (search) count++;
    if (geocodeFilter) count++;
    if (revisionFilter) count++;
    if (typeFilter) count++;
    return count;
  }, [search, geocodeFilter, revisionFilter, typeFilter]);

  const handleClearAllFilters = useCallback(() => {
    setSearch('');
    setGeocodeFilter('');
    setRevisionFilter('');
    setTypeFilter('');
  }, [setSearch, setGeocodeFilter, setRevisionFilter, setTypeFilter]);

  // Stats: use server summary when available, fall back to loaded data
  const stats = useMemo(() => {
    // Always compute from loaded data as baseline
    let overdueCount = 0;
    let neverServicedCount = 0;
    let geocodeFailed = 0;
    let geocodePending = 0;
    
    for (const customer of customers) {
      if (customer.overdueCount > 0) overdueCount++;
      if (customer.neverServicedCount > 0) neverServicedCount++;
      if (customer.geocodeStatus === 'failed') geocodeFailed++;
      if (customer.geocodeStatus === 'pending') geocodePending++;
    }
    
    return {
      total: summary?.totalCustomers ?? total,
      // Use server counts when available (exact), otherwise loaded-data counts
      overdueCount: summary?.customersWithOverdue ?? overdueCount,
      neverServicedCount: summary?.customersNeverServiced ?? neverServicedCount,
      geocodeFailed: summary?.geocodeFailed ?? geocodeFailed,
      geocodePending: summary?.geocodePending ?? geocodePending,
    };
  }, [summary, customers, total]);

  // Format revision status for cards view
  const formatRevisionStatus = (date: string | null, overdueCount: number, neverServicedCount: number): { text: string; className: string } => {
    // Never serviced takes priority
    if (neverServicedCount > 0) {
      return { text: t('revision_no_revision', { count: neverServicedCount }), className: styles.revisionWarning };
    }
    
    // Has overdue devices
    if (overdueCount > 0) {
      return { text: t('revision_overdue_count', { count: overdueCount }), className: styles.revisionOverdue };
    }
    
    if (!date) {
      // No upcoming revision date. If no warnings either, all devices are properly serviced.
      if (neverServicedCount === 0 && overdueCount === 0) {
        return { text: t('revision_ok'), className: styles.revisionNone };
      }
      return { text: t('revision_no_revision_plain'), className: styles.revisionNone };
    }
    
    const dueDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return { 
        text: t('revision_overdue_days', { days: Math.abs(diffDays) }), 
        className: styles.revisionOverdue 
      };
    } else if (diffDays <= 7) {
      return { 
        text: t('revision_in_days', { days: diffDays }), 
        className: styles.revisionSoon 
      };
    } else if (diffDays <= 30) {
      return { 
        text: formatDate(dueDate, 'short'), 
        className: styles.revisionUpcoming 
      };
    }
    
    return { 
      text: formatDate(dueDate, 'short'), 
      className: '' 
    };
  };

  // Show connection error
  if (!isConnected) {
    return (
      <div className={styles.customers}>
        <div className={styles.header}>
          <h1>{t('title')}</h1>
        </div>
        <div className={styles.error}>{t('error_not_connected')}</div>
      </div>
    );
  }

  if (showForm) {
    return (
      <div className={styles.customers}>
        <AddCustomerForm
          onSubmit={handleAddCustomer}
          onCancel={handleCancel}
          isSubmitting={isSubmitting}
        />
        {error && <div className={styles.error}>{error}</div>}
      </div>
    );
  }

  // Table view content (left panel)
  const tableContent = (
    <div className={styles.tablePanel}>
      {/* Toolbar — desktop: inline filter bar; mobile: trigger + sheet */}
      {isMobileUi ? (
        <MobileFilterSheet
          isMobile={isMobileUi}
          search={search}
          onSearchChange={setSearch}
          geocodeFilter={geocodeFilter}
          onGeocodeFilterChange={setGeocodeFilter}
          revisionFilter={revisionFilter as '' | 'overdue' | 'week' | 'month'}
          onRevisionFilterChange={setRevisionFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          sortModel={sortModel}
          onSortModelChange={setSortModel}
          visibleColumns={visibleColumns}
          columnOrder={columnOrder}
          onVisibleColumnsChange={setVisibleColumns}
          onColumnOrderChange={setColumnOrder}
          onResetColumns={handleResetColumns}
        />
      ) : (
        <CustomerFilterBar
          search={search}
          onSearchChange={setSearch}
          geocodeFilter={geocodeFilter}
          onGeocodeFilterChange={setGeocodeFilter}
          revisionFilter={revisionFilter as '' | 'overdue' | 'week' | 'month'}
          onRevisionFilterChange={setRevisionFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          activeFilterCount={activeFilterCount}
          onClearAllFilters={handleClearAllFilters}
          isAdvancedOpen={isAdvancedFiltersOpen}
          onToggleAdvanced={() => setIsAdvancedFiltersOpen((o) => !o)}
          sortModel={sortModel}
          onSortModelChange={setSortModel}
          visibleColumns={visibleColumns}
          columnOrder={columnOrder}
          onVisibleColumnsChange={setVisibleColumns}
          onColumnOrderChange={setColumnOrder}
          onResetColumns={handleResetColumns}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      )}

      {/* Advanced filter panel */}
      <AdvancedFilterPanel
        isOpen={isAdvancedFiltersOpen}
        onClose={() => setIsAdvancedFiltersOpen(false)}
        activeAdvancedCount={0}
        onClearAdvanced={() => {}}
      />

      {/* Loaded / total count */}
      {!isLoading && customers.length > 0 && customers.length < total && (
        <div className={styles.loadedCount}>
          {t('loaded_count', { loaded: customers.length, total })}
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {sortContractError && (
        <div
          role="alert"
          data-testid="sort-contract-error-banner"
          className={styles.error}
        >
          <AlertTriangle size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {t('error_load_failed')}: {sortContractError}
        </div>
      )}

      {geocodeJob && (
        <div className={styles.geocodeStatus}>
          <strong>{t('geocoding_label')}</strong>{' '}
          {geocodeJob.status.type === 'queued' && t('geocoding_queued')}
          {geocodeJob.status.type === 'processing' &&
            t('geocoding_processing', { processed: geocodeJob.status.processed, total: geocodeJob.status.total })}
          {geocodeJob.status.type === 'completed' &&
            t('geocoding_completed', { succeeded: geocodeJob.status.succeeded, total: geocodeJob.status.total })}
          {geocodeJob.status.type === 'failed' && t('geocoding_failed', { error: geocodeJob.status.error })}
        </div>
      )}

      {/* Empty state — shown for both table and cards view when 0 results */}
      {!isLoading && customers.length === 0 && (
        <div className="card">
          <p className={styles.empty}>
            {activeFilterCount === 0 && !isNonDefaultSort ? (
              <>
                {t('no_customers_yet')}
                <br />
                <button
                  className="btn-primary"
                  style={{ marginTop: '1rem' }}
                  onClick={handleShowForm}
                >
                  {t('add_first_customer')}
                </button>
              </>
            ) : (
              <>
                {activeFilterCount > 0 && t('no_customers_match')}
                {activeFilterCount > 0 && (
                  <button
                    data-testid="empty-clear-filters-btn"
                    className="btn-secondary"
                    style={{ marginTop: '1rem', display: 'block' }}
                    onClick={handleClearAllFilters}
                  >
                    {t('filter_clear_all')}
                  </button>
                )}
                {isNonDefaultSort && (
                  <button
                    data-testid="empty-reset-sort-btn"
                    className="btn-secondary"
                    style={{ marginTop: '0.5rem', display: 'block' }}
                    onClick={handleResetSort}
                  >
                    {t('sort_reset')}
                  </button>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {/* Table or Cards */}
      {viewMode === 'table' ? (
        <CustomerTable
          customers={customers}
          selectedId={selectedCustomer?.id || null}
          onSelectCustomer={handleSelectCustomer}
          onDoubleClick={handleOpenDetail}
          isLoading={isLoading}
          onEndReached={loadMore}
          isLoadingMore={isLoadingMore}
          totalCount={total}
          sortModel={sortModel}
          onSortModelChange={setSortModel}
          visibleColumns={visibleColumns}
          columnOrder={columnOrder}
        />
      ) : (
        // Cards view (mobile-friendly)
        <div className={styles.list}>
          {isLoading ? (
            <div className="card">
              <p className={styles.loading}>{t('loading_customers')}</p>
            </div>
          ) : customers.length === 0 ? (
            <div />
          ) : (
            <>
              {customers.map((customer) => {
                const revision = formatRevisionStatus(customer.nextRevisionDate, customer.overdueCount, customer.neverServicedCount);
                
                return (
                  <Link
                    key={customer.id}
                    to="/customers/$customerId"
                    params={{ customerId: customer.id }}
                    className={`${styles.customerCard} ${customer.geocodeStatus === 'failed' ? styles.geocodeFailed : ''}`}
                  >
                    <div className={styles.customerMain}>
                      <div className={styles.customerHeader}>
                        <h3 className={styles.customerName}>
                          {customer.name}
                          <span className={styles.customerType}>
                            {customer.type === 'company' ? t('type_company') : t('type_person')}
                          </span>
                        </h3>
                        {customer.geocodeStatus === 'failed' && (
                          <span title={t('filter_address_failed')}><AlertTriangle size={14} className={styles.geocodeWarning} /></span>
                        )}
                      </div>
                      <p className={styles.customerAddress}>
                        {customer.street}, {customer.city} {customer.postalCode}
                      </p>
                      {(customer.email || customer.phone) && (
                        <p className={styles.customerContact}>
                          {customer.phone && <span>{customer.phone}</span>}
                          {customer.email && customer.phone && <span> • </span>}
                          {customer.email && <span>{customer.email}</span>}
                        </p>
                      )}
                    </div>
                    
                    <div className={styles.customerMeta}>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>{t('meta_devices')}</span>
                        <span className={styles.metaValue}>{customer.deviceCount}</span>
                      </div>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>{t('meta_next_revision')}</span>
                        <span className={`${styles.metaValue} ${revision.className}`}>
                          {revision.text}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
              {customers.length < total && (
                <button
                  type="button"
                  className={styles.loadMoreButton}
                  onClick={loadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? t('loading_more') : t('load_more', { remaining: total - customers.length })}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  // Preview panel content (right panel)
  const previewContent = (
    <CustomerPreviewPanel
      customer={selectedCustomer}
      fullCustomer={fullCustomer}
      isLoadingFull={isLoadingFull}
      onClose={() => { setSelectedCustomer(null); setFullCustomer(null); }}
      onEdit={handleEdit}
    />
  );

  return (
    <div className={styles.customers}>
      <div className={styles.header}>
        <h1>{t('title')}</h1>
        <div className={styles.headerActions}>
          <Link to="/customers/summary" className={styles.summaryButton}>
            {t('summary_link')}
          </Link>
          <button className="btn-primary" onClick={handleShowForm}>
            {t('new_customer')}
          </button>
        </div>
      </div>

      {/* Quick Stats (from server summary) */}
      <div className={styles.statsBar}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{stats.total}</span>
          <span className={styles.statLabel}>{t('stat_total')}</span>
        </div>
        {stats.neverServicedCount > 0 && (
          <div className={`${styles.statItem} ${styles.statWarning}`}>
            <span className={styles.statValue}>{stats.neverServicedCount}</span>
            <span className={styles.statLabel}>{t('stat_no_revision')}</span>
          </div>
        )}
        {stats.overdueCount > 0 && (
          <div className={`${styles.statItem} ${styles.statDanger}`}>
            <span className={styles.statValue}>{stats.overdueCount}</span>
            <span className={styles.statLabel}>{t('stat_overdue')}</span>
          </div>
        )}
        {stats.geocodeFailed > 0 && (
          <div className={`${styles.statItem} ${styles.statWarning}`}>
            <span className={styles.statValue}>{stats.geocodeFailed}</span>
            <span className={styles.statLabel}>{t('stat_geocode_failed')}</span>
          </div>
        )}
        {stats.geocodePending > 0 && (
          <div className={`${styles.statItem} ${styles.statInfo}`}>
            <span className={styles.statValue}>{stats.geocodePending}</span>
            <span className={styles.statLabel}>{t('stat_geocode_pending')}</span>
          </div>
        )}
      </div>

      {/* Edit drawer (inline, no navigation) */}
      {fullCustomer && (
        <CustomerEditDrawer
          customer={fullCustomer}
          isOpen={isEditDrawerOpen}
          onClose={() => setIsEditDrawerOpen(false)}
          onSubmit={handleEditSubmit}
          isSubmitting={isEditSubmitting}
          onGeocodeCompleted={handleEditGeocodeCompleted}
        />
      )}

      {/* Split view: Table + Preview Panel */}
      <div className={styles.content}>
        <SplitView
          panels={[
            { 
              id: 'table', 
              content: tableContent, 
              defaultWidth: 70,
              minWidth: 50,
              maxWidth: 85,
            },
            { 
              id: 'preview', 
              content: previewContent, 
              defaultWidth: 30,
              minWidth: 15,
              maxWidth: 50,
            },
          ]}
          resizable={true}
        />
      </div>
    </div>
  );
}

export function Customers() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  return (
    <PersistenceProvider
      userId={userId}
      profiles={[customersProfile, customersGridProfile]}
      adapters={{ session: sessionAdapter, local: localAdapter }}
    >
      <CustomersInner />
    </PersistenceProvider>
  );
}
