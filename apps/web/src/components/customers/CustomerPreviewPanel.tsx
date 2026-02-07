/**
 * CustomerPreviewPanel - Full customer detail in the side panel
 *
 * Shows all information that was previously only on the detail page:
 * - Contact info (phone, email, contact person)
 * - Address with status + mini map
 * - Company info (IČO, DIČ)
 * - Device/revision stats
 * - Notes
 * - Tabbed content: Devices | Revisions
 * - Actions: Edit, Add to plan, open full page (small icon)
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Customer, CustomerListItem } from '@shared/customer';
import { getToken } from '@/utils/auth';
import { AddressMap } from './AddressMap';
import { AddressStatusChip } from './AddressStatusChip';
import { DeviceList } from '../devices';
import { CustomerTimeline } from '../timeline';
import styles from './CustomerPreviewPanel.module.css';

type TabId = 'devices' | 'revisions';

interface CustomerPreviewPanelProps {
  /** Lightweight list item – always available when a row is selected */
  customer: CustomerListItem | null;
  /** Full customer data – fetched on demand when selected */
  fullCustomer: Customer | null;
  isLoadingFull?: boolean;
  onClose: () => void;
  onEdit: (customer: CustomerListItem) => void;
  onAddToPlan?: (customer: CustomerListItem) => void;
}

// Copy to clipboard helper
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(console.error);
}

// Address status component (fallback when AddressStatusChip not suitable)
function AddressStatus({ status }: { status: string }) {
  const config: Record<string, { icon: string; label: string; className: string }> = {
    success: { icon: '✅', label: 'Ověřeno', className: styles.statusSuccess },
    pending: { icon: '⏳', label: 'Čeká na ověření', className: styles.statusPending },
    failed: { icon: '⚠', label: 'Nelze lokalizovat', className: styles.statusFailed },
  };

  const { icon, label, className } = config[status] || {
    icon: '⛔',
    label: 'Bez adresy',
    className: styles.statusMissing,
  };

  return (
    <span className={`${styles.addressStatus} ${className}`}>
      {icon} {label}
    </span>
  );
}

export function CustomerPreviewPanel({
  customer,
  fullCustomer,
  isLoadingFull = false,
  onClose,
  onEdit,
  onAddToPlan,
}: CustomerPreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('devices');

  if (!customer) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>👆</span>
          <p>Vyberte zákazníka ze seznamu</p>
          <p className={styles.emptyHint}>
            Použijte klávesy ↑↓ pro navigaci
          </p>
        </div>
      </div>
    );
  }

  // Use full data when available, fall back to list item
  const c = fullCustomer ?? customer;
  const isCompany = c.type === 'company';
  const hasCoordinates = c.lat !== undefined && c.lat !== null
    && c.lng !== undefined && c.lng !== null;
  const fullAddress = [c.street, c.city, c.postalCode]
    .filter(Boolean)
    .join(', ');

  // Fields only available on full Customer
  const contactPerson = fullCustomer?.contactPerson;
  const ico = fullCustomer?.ico;
  const dic = fullCustomer?.dic;
  const notes = fullCustomer?.notes;
  const createdAt = fullCustomer?.createdAt;
  const updatedAt = fullCustomer?.updatedAt;

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.nameRow}>
            <h3 className={styles.name}>{c.name}</h3>
            <Link
              to="/customers/$customerId"
              params={{ customerId: c.id }}
              className={styles.openFullIcon}
              title="Otevřít na celou stránku"
            >
              ↗
            </Link>
          </div>
          <span className={styles.typeBadge}>
            {isCompany ? 'Firma' : 'Osoba'}
          </span>
        </div>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          title="Zavřít (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Scrollable content area */}
      <div className={styles.scrollContent}>
        {/* Contact section */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Kontakt</h4>

          {isCompany && contactPerson && (
            <div className={styles.contactItem}>
              <span className={styles.contactIcon}>👤</span>
              <span className={styles.contactText}>{contactPerson}</span>
            </div>
          )}

          {c.phone ? (
            <div className={styles.contactItem}>
              <a href={`tel:${c.phone}`} className={styles.contactLink}>
                📞 {c.phone}
              </a>
              <button
                type="button"
                className={styles.copyButton}
                onClick={() => copyToClipboard(c.phone!)}
                title="Kopírovat"
              >
                📋
              </button>
            </div>
          ) : (
            <p className={styles.missingInfo}>📵 Chybí telefon</p>
          )}

          {c.email && (
            <div className={styles.contactItem}>
              <a href={`mailto:${c.email}`} className={styles.contactLink}>
                ✉️ {c.email}
              </a>
              <button
                type="button"
                className={styles.copyButton}
                onClick={() => copyToClipboard(c.email!)}
                title="Kopírovat"
              >
                📋
              </button>
            </div>
          )}
        </section>

        {/* Address section */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Adresa</h4>
          <AddressStatus status={c.geocodeStatus} />
          <p className={styles.address}>{fullAddress || 'Adresa nevyplněna'}</p>

          {hasCoordinates && (
            <div className={styles.mapContainer}>
              <AddressMap
                lat={c.lat!}
                lng={c.lng!}
                draggable={false}
                autoCenter={true}
              />
            </div>
          )}
        </section>

        {/* Company info */}
        {isCompany && (ico || dic) && (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Firemní údaje</h4>
            {ico && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>IČO:</span>
                <span className={styles.infoValue}>{ico}</span>
              </div>
            )}
            {dic && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>DIČ:</span>
                <span className={styles.infoValue}>{dic}</span>
              </div>
            )}
          </section>
        )}

        {/* Stats section */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Přehled</h4>
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{customer.deviceCount}</span>
              <span className={styles.statLabel}>zařízení</span>
            </div>
            {customer.neverServicedCount > 0 && (
              <div className={`${styles.statItem} ${styles.statWarning}`}>
                <span className={styles.statValue}>{customer.neverServicedCount}</span>
                <span className={styles.statLabel}>bez revize</span>
              </div>
            )}
            {customer.overdueCount > 0 && (
              <div className={`${styles.statItem} ${styles.statDanger}`}>
                <span className={styles.statValue}>{customer.overdueCount}</span>
                <span className={styles.statLabel}>po termínu</span>
              </div>
            )}
          </div>
          {customer.nextRevisionDate && (
            <p className={styles.nextRevision}>
              Příští revize: {new Date(customer.nextRevisionDate).toLocaleDateString('cs-CZ')}
            </p>
          )}
        </section>

        {/* Notes */}
        {notes && (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Poznámky</h4>
            <p className={styles.notes}>{notes}</p>
          </section>
        )}

        {/* Metadata */}
        {createdAt && (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Informace</h4>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Vytvořeno:</span>
              <span className={styles.infoValue}>
                {new Date(createdAt).toLocaleDateString('cs-CZ')}
              </span>
            </div>
            {updatedAt && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>Aktualizováno:</span>
                <span className={styles.infoValue}>
                  {new Date(updatedAt).toLocaleDateString('cs-CZ')}
                </span>
              </div>
            )}
          </section>
        )}

        {/* Tabbed content: Devices | Revisions */}
        {fullCustomer && (
          <section className={styles.tabSection}>
            <nav className={styles.tabNav}>
              <button
                type="button"
                className={`${styles.tab} ${activeTab === 'devices' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('devices')}
              >
                🔧 Zařízení
              </button>
              <button
                type="button"
                className={`${styles.tab} ${activeTab === 'revisions' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('revisions')}
              >
                📋 Historie
              </button>
            </nav>
            <div className={styles.tabContent}>
              {activeTab === 'devices' && (
                <DeviceList
                  customerId={fullCustomer.id}
                  userId={getToken()}
                />
              )}
              {activeTab === 'revisions' && (
                <CustomerTimeline customerId={fullCustomer.id} />
              )}
            </div>
          </section>
        )}

        {/* Loading indicator for full data */}
        {isLoadingFull && !fullCustomer && (
          <div className={styles.loadingFull}>
            <div className={styles.spinnerSmall} />
            <span>Načítám detail...</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => onEdit(customer)}
        >
          ✎ Upravit
        </button>
        {onAddToPlan && hasCoordinates && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => onAddToPlan(customer)}
          >
            ➕ Do plánu
          </button>
        )}
      </div>

      {/* Keyboard hint */}
      <div className={styles.keyboardHint}>
        <span><kbd>Esc</kbd> Zavřít</span>
      </div>
    </div>
  );
}
