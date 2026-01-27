import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import type { Customer } from '@shared/customer';
import { getCustomer } from '../services/customerService';
import { AddressMap } from '../components/customers/AddressMap';
import { useNatsStore } from '../stores/natsStore';
import styles from './CustomerDetail.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

export function CustomerDetail() {
  const { customerId } = useParams({ strict: false }) as { customerId: string };
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const hasCoordinates = customer.lat !== undefined && customer.lng !== undefined;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link to="/customers" className={styles.backLink}>
          ← Zpět na seznam
        </Link>
        <h1 className={styles.title}>{customer.name}</h1>
      </div>

      <div className={styles.content}>
        {/* Left column - Customer info */}
        <div className={styles.infoColumn}>
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
                <p>Poloha zákazníka není k dispozici.</p>
                <p className={styles.hint}>
                  Upravte zákazníka a vyplňte adresu pro zobrazení na mapě.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Action buttons */}
      <div className={styles.actions}>
        <button className={styles.editButton} disabled>
          Upravit zákazníka
        </button>
        <button className={styles.deleteButton} disabled>
          Smazat
        </button>
      </div>
    </div>
  );
}
