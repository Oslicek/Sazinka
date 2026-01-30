import { useState, useCallback, useEffect } from 'react';
import { useSearch, Link } from '@tanstack/react-router';
import type { Customer, CreateCustomerRequest, ImportIssue } from '@shared/customer';
import { createCustomer, listCustomers, importCustomersBatch } from '../services/customerService';
import { AddCustomerForm } from '../components/customers/AddCustomerForm';
import { ImportCustomersModal } from '../components/customers/ImportCustomersModal';
import { useNatsStore } from '../stores/natsStore';
import styles from './Customers.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

export function Customers() {
  const searchParams = useSearch({ strict: false }) as { action?: string };
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(searchParams?.action === 'new');
  const [showImport, setShowImport] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const isConnected = useNatsStore((s) => s.isConnected);

  // Load customers when connected
  const loadCustomers = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      return;
    }
    
    try {
      setIsLoading(true);
      setError(null);
      const result = await listCustomers(TEMP_USER_ID, { limit: 100 });
      setCustomers(result.items);
    } catch (err) {
      console.error('Failed to load customers:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst zákazníky');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected]);

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
      setCustomers((prev) => [...prev, newCustomer]);
      setShowForm(false);
    } catch (err) {
      console.error('Failed to create customer:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se vytvořit zákazníka');
      throw err; // Re-throw so form knows it failed
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected]);

  const handleCancel = useCallback(() => {
    setShowForm(false);
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

  // Filter customers by search
  const filteredCustomers = customers.filter((customer) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      customer.name.toLowerCase().includes(searchLower) ||
      customer.city.toLowerCase().includes(searchLower) ||
      customer.street.toLowerCase().includes(searchLower) ||
      customer.email?.toLowerCase().includes(searchLower) ||
      customer.phone?.includes(search)
    );
  });

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
          userId={TEMP_USER_ID}
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
          <button className={styles.importButton} onClick={handleShowImport}>
            📥 Import CSV
          </button>
          <button className="btn-primary" onClick={handleShowForm}>
            + Nový zákazník
          </button>
        </div>
      </div>

      <ImportCustomersModal
        isOpen={showImport}
        onClose={handleCloseImport}
        onImportBatch={handleImportBatch}
      />

      <div className={styles.toolbar}>
        <input
          type="text"
          placeholder="Hledat zákazníky..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {isLoading ? (
        <div className="card">
          <p className={styles.loading}>Načítám zákazníky...</p>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="card">
          <p className={styles.empty}>
            {customers.length === 0 ? (
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
              'Žádní zákazníci neodpovídají vyhledávání.'
            )}
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {filteredCustomers.map((customer) => (
            <Link
              key={customer.id}
              to={`/customers/${customer.id}`}
              className={`${styles.customerCard} ${customer.geocodeStatus === 'failed' ? styles.geocodeFailed : ''}`}
            >
              <div className={styles.customerInfo}>
                <h3 className={styles.customerName}>
                  {customer.name}
                  {customer.geocodeStatus === 'failed' && (
                    <span className={styles.geocodeWarning} title="Adresu nelze lokalizovat">
                      ⚠️
                    </span>
                  )}
                </h3>
                <p className={styles.customerAddress}>
                  {customer.street}, {customer.city} {customer.postalCode}
                </p>
                {customer.geocodeStatus === 'failed' && (
                  <p className={styles.geocodeError}>
                    ⚠️ Adresu nelze lokalizovat
                  </p>
                )}
                {(customer.email || customer.phone) && (
                  <p className={styles.customerContact}>
                    {customer.email && <span>{customer.email}</span>}
                    {customer.email && customer.phone && <span> • </span>}
                    {customer.phone && <span>{customer.phone}</span>}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
