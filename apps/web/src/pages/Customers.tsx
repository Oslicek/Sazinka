import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearch, Link, useNavigate } from '@tanstack/react-router';
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
import { SavedViewsSelector, type SavedView } from '../components/customers/SavedViewsSelector';
import { SplitView } from '../components/common/SplitView';
import { useNatsStore } from '../stores/natsStore';
import { updateCustomer } from '../services/customerService';
import styles from './Customers.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

/** Page size for infinite scroll */
const PAGE_SIZE = 100;

interface SearchParams {
  action?: string;
  geocodeStatus?: GeocodeStatus;
  hasOverdue?: boolean;
  sortBy?: ListCustomersRequest['sortBy'];
  sortOrder?: ListCustomersRequest['sortOrder'];
  view?: 'table' | 'cards';
}

export function Customers() {
  const navigate = useNavigate();
  const searchParams = useSearch({ strict: false }) as SearchParams;
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(searchParams?.action === 'new');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geocodeJob, setGeocodeJob] = useState<GeocodeJobStatusUpdate | null>(null);
  const geocodeUnsubscribeRef = useRef<(() => void) | null>(null);
  
  // Server-side summary stats (accurate across all customers)
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  
  // Selected customer for preview panel
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerListItem | null>(null);
  const [fullCustomer, setFullCustomer] = useState<Customer | null>(null);
  const [isLoadingFull, setIsLoadingFull] = useState(false);
  
  // Edit drawer state
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);
  
  // View mode: table (desktop) or cards (mobile)
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(searchParams?.view || 'table');
  
  // Filters
  const [geocodeFilter, setGeocodeFilter] = useState<GeocodeStatus | ''>(searchParams?.geocodeStatus || '');
  const [revisionFilter, setRevisionFilter] = useState<string>(searchParams?.hasOverdue ? 'overdue' : '');
  const [typeFilter, setTypeFilter] = useState<'company' | 'person' | ''>('');
  const [sortBy, setSortBy] = useState<ListCustomersRequest['sortBy']>(searchParams?.sortBy || 'name');
  const [sortOrder, setSortOrder] = useState<ListCustomersRequest['sortOrder']>(searchParams?.sortOrder || 'asc');
  
  const isConnected = useNatsStore((s) => s.isConnected);

  // Build request options (without offset — managed separately)
  const requestOptions = useMemo<ListCustomersRequest>(() => {
    const options: ListCustomersRequest = {
      limit: PAGE_SIZE,
      sortBy,
      sortOrder,
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
    
    return options;
  }, [search, geocodeFilter, revisionFilter, sortBy, sortOrder]);

  // Load first page + summary when connected or filters change
  const loadCustomers = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      
      // Fetch first page and summary in parallel
      const [result, summaryResult] = await Promise.all([
        listCustomersExtended(TEMP_USER_ID, { ...requestOptions, offset: 0 }),
        getCustomerSummary(TEMP_USER_ID).catch(() => null),
      ]);
      
      setCustomers(result.items);
      setTotal(result.total);
      if (summaryResult) setSummary(summaryResult);
      
      // Clear selection if the selected customer is no longer in the list
      if (selectedCustomer && !result.items.some(c => c.id === selectedCustomer.id)) {
        setSelectedCustomer(null);
      }
    } catch (err) {
      console.error('Failed to load customers:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst zákazníky');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, requestOptions, selectedCustomer]);

  useEffect(() => {
    if (isConnected) {
      loadCustomers();
    }
  }, [isConnected, loadCustomers]);

  // Load next page (infinite scroll)
  const loadMore = useCallback(async () => {
    if (!isConnected || isLoadingMore || customers.length >= total) return;
    
    try {
      setIsLoadingMore(true);
      const result = await listCustomersExtended(TEMP_USER_ID, {
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
      setError('Není připojení k serveru');
      throw new Error('Not connected');
    }
    
    try {
      setIsSubmitting(true);
      setError(null);
      const newCustomer = await createCustomer(TEMP_USER_ID, data);
      setShowForm(false);

      // Trigger async geocoding if coordinates are missing
      if (!newCustomer.lat || !newCustomer.lng) {
        const job = await submitGeocodeJob(TEMP_USER_ID, [newCustomer.id]);
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
      setError(err instanceof Error ? err.message : 'Nepodařilo se vytvořit zákazníka');
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

    getCustomer(TEMP_USER_ID, selectedCustomer.id)
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
      const updated = await updateCustomer(TEMP_USER_ID, data);
      setFullCustomer(updated);
      setIsEditDrawerOpen(false);

      // Trigger geocoding if address changed
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
            loadCustomers();
            // Refresh full customer
            getCustomer(TEMP_USER_ID, updated.id)
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
      setError(err instanceof Error ? err.message : 'Nepodařilo se aktualizovat zákazníka');
    } finally {
      setIsEditSubmitting(false);
    }
  }, [isConnected, fullCustomer, loadCustomers]);

  const handleEditGeocodeCompleted = useCallback(() => {
    if (fullCustomer) {
      getCustomer(TEMP_USER_ID, fullCustomer.id)
        .then(setFullCustomer)
        .catch(console.error);
    }
    loadCustomers();
  }, [fullCustomer, loadCustomers]);

  // Handle saved view selection
  const handleSelectView = useCallback((view: SavedView) => {
    setGeocodeFilter(view.filters.geocodeStatus || '');
    setRevisionFilter(view.filters.revisionFilter || '');
    setTypeFilter(view.filters.type || '');
  }, []);

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
      return { text: `Bez revize (${neverServicedCount} zař.)`, className: styles.revisionWarning };
    }
    
    // Has overdue devices
    if (overdueCount > 0) {
      return { text: `Po termínu (${overdueCount} zař.)`, className: styles.revisionOverdue };
    }
    
    if (!date) {
      // No upcoming revision date. If no warnings either, all devices are properly serviced.
      if (neverServicedCount === 0 && overdueCount === 0) {
        return { text: 'V pořádku', className: styles.revisionNone };
      }
      return { text: 'Bez revize', className: styles.revisionNone };
    }
    
    const dueDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
      return { 
        text: `Po termínu (${Math.abs(diffDays)} dní)`, 
        className: styles.revisionOverdue 
      };
    } else if (diffDays <= 7) {
      return { 
        text: `Za ${diffDays} dní`, 
        className: styles.revisionSoon 
      };
    } else if (diffDays <= 30) {
      return { 
        text: dueDate.toLocaleDateString('cs-CZ'), 
        className: styles.revisionUpcoming 
      };
    }
    
    return { 
      text: dueDate.toLocaleDateString('cs-CZ'), 
      className: '' 
    };
  };

  // Show connection error
  if (!isConnected) {
    return (
      <div className={styles.customers}>
        <div className={styles.header}>
          <h1>Zákazníci</h1>
        </div>
        <div className={styles.error}>Není připojení k serveru</div>
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
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input
          type="text"
          placeholder="Hledat zákazníky..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
        
        <SavedViewsSelector
          currentFilters={{
            geocodeStatus: geocodeFilter || undefined,
            revisionFilter: revisionFilter as 'overdue' | 'week' | 'month' | '' || undefined,
            type: typeFilter || undefined,
          }}
          onSelectView={handleSelectView}
        />
        
        <div className={styles.filterRow}>
          <select 
            value={geocodeFilter} 
            onChange={(e) => setGeocodeFilter(e.target.value as GeocodeStatus | '')}
            className={styles.filterSelect}
          >
            <option value="">Adresa: vše</option>
            <option value="success">Úspěšně ověřená</option>
            <option value="failed">Nelze ověřit</option>
            <option value="pending">Čeká na ověření</option>
          </select>
          
          <select 
            value={revisionFilter} 
            onChange={(e) => setRevisionFilter(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">Revize: vše</option>
            <option value="overdue">Po termínu</option>
            <option value="week">Do 7 dní</option>
            <option value="month">Do 30 dní</option>
          </select>
        </div>
        
        <div className={styles.viewToggle}>
          <button 
            type="button"
            className={`${styles.viewButton} ${viewMode === 'table' ? styles.active : ''}`}
            onClick={() => setViewMode('table')}
            title="Tabulka"
          >
            ☰
          </button>
          <button 
            type="button"
            className={`${styles.viewButton} ${viewMode === 'cards' ? styles.active : ''}`}
            onClick={() => setViewMode('cards')}
            title="Karty"
          >
            ▦
          </button>
        </div>
      </div>

      {/* Loaded / total count */}
      {!isLoading && customers.length > 0 && customers.length < total && (
        <div className={styles.loadedCount}>
          Zobrazeno {customers.length} z {total} zákazníků
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {geocodeJob && (
        <div className={styles.geocodeStatus}>
          <strong>Geokódování:</strong>{' '}
          {geocodeJob.status.type === 'queued' && 'čeká ve frontě'}
          {geocodeJob.status.type === 'processing' &&
            `zpracování ${geocodeJob.status.processed}/${geocodeJob.status.total}`}
          {geocodeJob.status.type === 'completed' &&
            `hotovo (${geocodeJob.status.succeeded}/${geocodeJob.status.total} úspěšně)`}
          {geocodeJob.status.type === 'failed' && `selhalo: ${geocodeJob.status.error}`}
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
        />
      ) : (
        // Cards view (mobile-friendly)
        <div className={styles.list}>
          {isLoading ? (
            <div className="card">
              <p className={styles.loading}>Načítám zákazníky...</p>
            </div>
          ) : customers.length === 0 ? (
            <div className="card">
              <p className={styles.empty}>
                {total === 0 && !search && !geocodeFilter && !revisionFilter ? (
                  <>
                    Zatím nemáte žádné zákazníky.
                    <br />
                    <button
                      className="btn-primary"
                      style={{ marginTop: '1rem' }}
                      onClick={handleShowForm}
                    >
                      + Přidat prvního zákazníka
                    </button>
                  </>
                ) : (
                  'Žádní zákazníci neodpovídají zadaným filtrům.'
                )}
              </p>
            </div>
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
                            {customer.type === 'company' ? 'Firma' : 'Osoba'}
                          </span>
                        </h3>
                        {customer.geocodeStatus === 'failed' && (
                          <span className={styles.geocodeWarning} title="Adresu nelze lokalizovat">
                            ⚠️
                          </span>
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
                        <span className={styles.metaLabel}>Zařízení</span>
                        <span className={styles.metaValue}>{customer.deviceCount}</span>
                      </div>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>Příští revize</span>
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
                  {isLoadingMore ? 'Načítám...' : `Načíst další (${total - customers.length} zbývá)`}
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
        <h1>Zákazníci</h1>
        <div className={styles.headerActions}>
          <Link to="/customers/summary" className={styles.summaryButton}>
            Souhrnné informace
          </Link>
          <button className="btn-primary" onClick={handleShowForm}>
            + Nový zákazník
          </button>
        </div>
      </div>

      {/* Quick Stats (from server summary) */}
      <div className={styles.statsBar}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{stats.total}</span>
          <span className={styles.statLabel}>celkem</span>
        </div>
        {stats.neverServicedCount > 0 && (
          <div className={`${styles.statItem} ${styles.statWarning}`}>
            <span className={styles.statValue}>{stats.neverServicedCount}</span>
            <span className={styles.statLabel}>bez revize</span>
          </div>
        )}
        {stats.overdueCount > 0 && (
          <div className={`${styles.statItem} ${styles.statDanger}`}>
            <span className={styles.statValue}>{stats.overdueCount}</span>
            <span className={styles.statLabel}>po termínu</span>
          </div>
        )}
        {stats.geocodeFailed > 0 && (
          <div className={`${styles.statItem} ${styles.statWarning}`}>
            <span className={styles.statValue}>{stats.geocodeFailed}</span>
            <span className={styles.statLabel}>adresa bez polohy na mapě</span>
          </div>
        )}
        {stats.geocodePending > 0 && (
          <div className={`${styles.statItem} ${styles.statInfo}`}>
            <span className={styles.statValue}>{stats.geocodePending}</span>
            <span className={styles.statLabel}>adresa neověřená</span>
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
