import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearch, Link } from '@tanstack/react-router';
import type { 
  CreateCustomerRequest, 
  CustomerListItem,
  ListCustomersRequest,
  GeocodeStatus,
} from '@shared/customer';
import { 
  createCustomer, 
  listCustomersExtended,
  importCustomersBatch, 
  submitGeocodeJob, 
  subscribeToGeocodeJobStatus, 
  type GeocodeJobStatusUpdate,
} from '../services/customerService';
import { AddCustomerForm } from '../components/customers/AddCustomerForm';
import { ImportCustomersModal } from '../components/customers/ImportCustomersModal';
import { useNatsStore } from '../stores/natsStore';
import styles from './Customers.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

interface SearchParams {
  action?: string;
  geocodeStatus?: GeocodeStatus;
  hasOverdue?: boolean;
  sortBy?: ListCustomersRequest['sortBy'];
  sortOrder?: ListCustomersRequest['sortOrder'];
}

export function Customers() {
  const searchParams = useSearch({ strict: false }) as SearchParams;
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(searchParams?.action === 'new');
  const [showImport, setShowImport] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geocodeJob, setGeocodeJob] = useState<GeocodeJobStatusUpdate | null>(null);
  const geocodeUnsubscribeRef = useRef<(() => void) | null>(null);
  
  // Filters
  const [geocodeFilter, setGeocodeFilter] = useState<GeocodeStatus | ''>(searchParams?.geocodeStatus || '');
  const [revisionFilter, setRevisionFilter] = useState<string>(searchParams?.hasOverdue ? 'overdue' : '');
  const [sortBy, setSortBy] = useState<ListCustomersRequest['sortBy']>(searchParams?.sortBy || 'name');
  const [sortOrder, setSortOrder] = useState<ListCustomersRequest['sortOrder']>(searchParams?.sortOrder || 'asc');
  
  const isConnected = useNatsStore((s) => s.isConnected);

  // Build request options
  const requestOptions = useMemo<ListCustomersRequest>(() => {
    const options: ListCustomersRequest = {
      limit: 100,
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

  // Load customers when connected or filters change
  const loadCustomers = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      const result = await listCustomersExtended(TEMP_USER_ID, requestOptions);
      setCustomers(result.items);
      setTotal(result.total);
    } catch (err) {
      console.error('Failed to load customers:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst zákazníky');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, requestOptions]);

  useEffect(() => {
    if (isConnected) {
      loadCustomers();
    }
  }, [isConnected, loadCustomers]);

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
      throw err; // Re-throw so form knows it failed
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
    setError(null);  // Clear any previous error
    setShowForm(true);
  }, []);

  const handleShowImport = useCallback(() => {
    setError(null);
    setShowImport(true);
  }, []);

  const handleCloseImport = useCallback(() => {
    setShowImport(false);
    // Reload customers after import
    loadCustomers();
  }, [loadCustomers]);

  const handleImportBatch = useCallback(async (batch: CreateCustomerRequest[]) => {
    if (!isConnected) {
      throw new Error('Není připojení k serveru');
    }
    
    const result = await importCustomersBatch(TEMP_USER_ID, batch);
    return result;
  }, [isConnected]);

  // Calculate stats from loaded customers
  const stats = useMemo(() => {
    let overdueCount = 0;
    let geocodeFailed = 0;
    
    for (const customer of customers) {
      if (customer.overdueCount > 0) overdueCount++;
      if (customer.geocodeStatus === 'failed') geocodeFailed++;
    }
    
    return { overdueCount, geocodeFailed, total };
  }, [customers, total]);

  // Format next revision date
  const formatNextRevision = (date: string | null, overdueCount: number): { text: string; className: string } => {
    if (!date) {
      return { text: 'Bez revize', className: styles.revisionNone };
    }
    
    const dueDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (overdueCount > 0 || diffDays < 0) {
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

  return (
    <div className={styles.customers}>
      <div className={styles.header}>
        <h1>Zákazníci</h1>
        <div className={styles.headerActions}>
          <Link to="/customers/summary" className={styles.summaryButton}>
            Souhrnné informace
          </Link>
          <button className={styles.importButton} onClick={handleShowImport}>
            Import CSV
          </button>
          <button className="btn-primary" onClick={handleShowForm}>
            + Nový zákazník
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className={styles.statsBar}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{stats.total}</span>
          <span className={styles.statLabel}>celkem</span>
        </div>
        {stats.overdueCount > 0 && (
          <div className={`${styles.statItem} ${styles.statDanger}`}>
            <span className={styles.statValue}>{stats.overdueCount}</span>
            <span className={styles.statLabel}>po termínu</span>
          </div>
        )}
        {stats.geocodeFailed > 0 && (
          <div className={`${styles.statItem} ${styles.statWarning}`}>
            <span className={styles.statValue}>{stats.geocodeFailed}</span>
            <span className={styles.statLabel}>bez adresy</span>
          </div>
        )}
      </div>

      <ImportCustomersModal
        isOpen={showImport}
        onClose={handleCloseImport}
        onImportBatch={handleImportBatch}
      />

      {/* Toolbar with search and filters */}
      <div className={styles.toolbar}>
        <input
          type="text"
          placeholder="Hledat zákazníky..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
        
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
        
        <select 
          value={`${sortBy}-${sortOrder}`} 
          onChange={(e) => {
            const [newSortBy, newSortOrder] = e.target.value.split('-') as [ListCustomersRequest['sortBy'], ListCustomersRequest['sortOrder']];
            setSortBy(newSortBy);
            setSortOrder(newSortOrder);
          }}
          className={styles.filterSelect}
        >
          <option value="name-asc">Název A-Z</option>
          <option value="name-desc">Název Z-A</option>
          <option value="nextRevision-asc">Revize (nejdříve)</option>
          <option value="nextRevision-desc">Revize (nejpozději)</option>
          <option value="deviceCount-desc">Zařízení (nejvíce)</option>
          <option value="deviceCount-asc">Zařízení (nejméně)</option>
          <option value="city-asc">Město A-Z</option>
          <option value="createdAt-desc">Nejnovější</option>
        </select>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {geocodeJob && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <strong>Geokódování:</strong>{' '}
          {geocodeJob.status.type === 'queued' && 'čeká ve frontě'}
          {geocodeJob.status.type === 'processing' &&
            `zpracování ${geocodeJob.status.processed}/${geocodeJob.status.total}`}
          {geocodeJob.status.type === 'completed' &&
            `hotovo (${geocodeJob.status.succeeded}/${geocodeJob.status.total} úspěšně)`}
          {geocodeJob.status.type === 'failed' && `selhalo: ${geocodeJob.status.error}`}
        </div>
      )}

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
        <div className={styles.list}>
          {customers.map((customer) => {
            const revision = formatNextRevision(customer.nextRevisionDate, customer.overdueCount);
            
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
        </div>
      )}
    </div>
  );
}
