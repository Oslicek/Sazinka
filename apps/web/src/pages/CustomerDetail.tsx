import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import type { Customer, UpdateCustomerRequest } from '@shared/customer';
import { getCustomer, updateCustomer, deleteCustomer } from '../services/customerService';
import { AddressMap } from '../components/customers/AddressMap';
import { CustomerForm } from '../components/customers/CustomerForm';
import { DeleteConfirmDialog } from '../components/customers/DeleteConfirmDialog';
import { DeviceList } from '../components/devices';
import { CustomerTimeline } from '../components/timeline';
import { useNatsStore } from '../stores/natsStore';
import styles from './CustomerDetail.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

export function CustomerDetail() {
  const { customerId } = useParams({ strict: false }) as { customerId: string };
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Delete dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const handleEdit = useCallback(() => {
    setIsEditing(true);
    setError(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
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
      setIsEditing(false);
    } catch (err) {
      console.error('Failed to update customer:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se aktualizovat zákazníka');
    } finally {
      setIsSubmitting(false);
    }
  }, [isConnected]);

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
      // Navigate back to customer list after successful deletion
      navigate({ to: '/customers' });
    } catch (err) {
      console.error('Failed to delete customer:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se smazat zákazníka');
      setShowDeleteDialog(false);
    } finally {
      setIsDeleting(false);
    }
  }, [isConnected, customerId, navigate]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Načítám zákazníka...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link to="/customers" className={styles.backLink}>
            ← Zpět na seznam
          </Link>
        </div>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link to="/customers" className={styles.backLink}>
            ← Zpět na seznam
          </Link>
        </div>
        <div className={styles.error}>Zákazník nenalezen</div>
      </div>
    );
  }

  // Show edit form
  if (isEditing) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link to="/customers" className={styles.backLink}>
            ← Zpět na seznam
          </Link>
        </div>
        <CustomerForm
          customer={customer}
          onSubmit={handleSubmitEdit}
          onCancel={handleCancelEdit}
          isSubmitting={isSubmitting}
          userId={TEMP_USER_ID}
        />
        {error && <div className={styles.error}>{error}</div>}
      </div>
    );
  }

  const hasCoordinates = customer.lat !== undefined && customer.lng !== undefined;
  const isCompany = customer.type === 'company';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link to="/customers" className={styles.backLink}>
          ← Zpět na seznam
        </Link>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{customer.name}</h1>
          <span className={`${styles.typeBadge} ${isCompany ? styles.companyBadge : styles.personBadge}`}>
            {isCompany ? 'Firma' : 'Fyzická osoba'}
          </span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {customer.geocodeStatus === 'failed' && (
        <div className={styles.geocodeWarning}>
          <span className={styles.warningIcon}>⚠️</span>
          <div className={styles.warningContent}>
            <strong>Adresu nelze lokalizovat</strong>
            <p>Zadaná adresa nebyla nalezena. Zákazník nebude zahrnut do optimalizace tras.</p>
          </div>
        </div>
      )}

      <div className={styles.content}>
        {/* Left column - Customer info */}
        <div className={styles.infoColumn}>
          {/* Company info section */}
          {isCompany && (customer.contactPerson || customer.ico || customer.dic) && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Firemní údaje</h2>
              <div className={styles.companyInfo}>
                {customer.contactPerson && (
                  <p>
                    <span className={styles.label}>Kontaktní osoba:</span>
                    {customer.contactPerson}
                  </p>
                )}
                {customer.ico && (
                  <p>
                    <span className={styles.label}>IČO:</span>
                    {customer.ico}
                  </p>
                )}
                {customer.dic && (
                  <p>
                    <span className={styles.label}>DIČ:</span>
                    {customer.dic}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Address section */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Adresa</h2>
            <div className={styles.address}>
              <p>{customer.street}</p>
              <p>{customer.city} {customer.postalCode}</p>
              <p>{customer.country}</p>
            </div>
          </section>

          {/* Contact section */}
          {(customer.email || customer.phone) && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Kontakt</h2>
              <div className={styles.contact}>
                {customer.email && (
                  <p>
                    <span className={styles.label}>Email:</span>
                    <a href={`mailto:${customer.email}`} className={styles.link}>
                      {customer.email}
                    </a>
                  </p>
                )}
                {customer.phone && (
                  <p>
                    <span className={styles.label}>Telefon:</span>
                    <a href={`tel:${customer.phone}`} className={styles.link}>
                      {customer.phone}
                    </a>
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Notes section */}
          {customer.notes && (
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Poznámky</h2>
              <p className={styles.notes}>{customer.notes}</p>
            </section>
          )}

          {/* Metadata section */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Informace</h2>
            <div className={styles.metadata}>
              <p>
                <span className={styles.label}>Vytvořeno:</span>
                {new Date(customer.createdAt).toLocaleDateString('cs-CZ')}
              </p>
              <p>
                <span className={styles.label}>Aktualizováno:</span>
                {new Date(customer.updatedAt).toLocaleDateString('cs-CZ')}
              </p>
            </div>
          </section>
        </div>

        {/* Right column - Map */}
        <div className={styles.mapColumn}>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Poloha</h2>
            {hasCoordinates ? (
              <div className={styles.mapContainer}>
                <AddressMap
                  lat={customer.lat}
                  lng={customer.lng}
                  draggable={false}
                  displayName={`${customer.street}, ${customer.city}`}
                />
              </div>
            ) : (
              <div className={styles.noMap}>
                {customer.geocodeStatus === 'failed' ? (
                  <>
                    <p className={styles.noMapError}>⚠️ Adresu nelze lokalizovat</p>
                    <p className={styles.hint}>
                      Zkontrolujte a opravte adresu zákazníka.
                    </p>
                  </>
                ) : (
                  <>
                    <p>Poloha zákazníka není k dispozici.</p>
                    <p className={styles.hint}>
                      Upravte zákazníka a vyplňte adresu pro zobrazení na mapě.
                    </p>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Devices section - full width */}
      <section className={styles.section} style={{ marginTop: '1.5rem' }}>
        <DeviceList
          customerId={customer.id}
          userId={TEMP_USER_ID}
        />
      </section>

      {/* Timeline section - full width */}
      <section className={styles.section} style={{ marginTop: '1.5rem' }}>
        <CustomerTimeline customerId={customer.id} />
      </section>

      {/* Action buttons */}
      <div className={styles.actions}>
        <button className={styles.editButton} onClick={handleEdit}>
          Upravit zákazníka
        </button>
        <button className={styles.deleteButton} onClick={handleDeleteClick}>
          Smazat
        </button>
      </div>

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        isOpen={showDeleteDialog}
        customerName={customer.name}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}
