/**
 * CustomerPreviewPanel - Side panel showing customer details
 * 
 * Features:
 * - Contact info with copy to clipboard
 * - Address with status badge
 * - Mini map (optional)
 * - CTA buttons: Open detail, Edit, Add to plan
 */

import { Link } from '@tanstack/react-router';
import type { CustomerListItem } from '@shared/customer';
import { AddressMap } from './AddressMap';
import styles from './CustomerPreviewPanel.module.css';

interface CustomerPreviewPanelProps {
  customer: CustomerListItem | null;
  onClose: () => void;
  onEdit: (customer: CustomerListItem) => void;
  onAddToPlan?: (customer: CustomerListItem) => void;
}

// Copy to clipboard helper
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(console.error);
}

// Address status component
function AddressStatus({ status }: { status: string }) {
  const config: Record<string, { icon: string; label: string; className: string }> = {
    success: { icon: '✅', label: 'Ověřeno', className: styles.statusSuccess },
    pending: { icon: '⏳', label: 'Čeká na ověření', className: styles.statusPending },
    failed: { icon: '⚠', label: 'Nelze lokalizovat', className: styles.statusFailed },
  };
  
  const { icon, label, className } = config[status] || { 
    icon: '⛔', 
    label: 'Bez adresy', 
    className: styles.statusMissing 
  };
  
  return (
    <span className={`${styles.addressStatus} ${className}`}>
      {icon} {label}
    </span>
  );
}

export function CustomerPreviewPanel({
  customer,
  onClose,
  onEdit,
  onAddToPlan,
}: CustomerPreviewPanelProps) {
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

  const hasCoordinates = customer.lat !== null && customer.lng !== null;
  const fullAddress = [customer.street, customer.city, customer.postalCode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <h3 className={styles.name}>{customer.name}</h3>
          <span className={styles.typeBadge}>
            {customer.type === 'company' ? 'Firma' : 'Osoba'}
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

      {/* Contact section */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Kontakt</h4>
        
        {customer.phone ? (
          <div className={styles.contactItem}>
            <a href={`tel:${customer.phone}`} className={styles.contactLink}>
              📞 {customer.phone}
            </a>
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => copyToClipboard(customer.phone!)}
              title="Kopírovat"
            >
              📋
            </button>
          </div>
        ) : (
          <p className={styles.missingInfo}>📵 Chybí telefon</p>
        )}

        {customer.email && (
          <div className={styles.contactItem}>
            <a href={`mailto:${customer.email}`} className={styles.contactLink}>
              ✉️ {customer.email}
            </a>
            <button
              type="button"
              className={styles.copyButton}
              onClick={() => copyToClipboard(customer.email!)}
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
        <AddressStatus status={customer.geocodeStatus} />
        <p className={styles.address}>{fullAddress || 'Adresa nevyplněna'}</p>
        
        {hasCoordinates && (
          <div className={styles.mapContainer}>
            <AddressMap
              lat={customer.lat!}
              lng={customer.lng!}
              draggable={false}
              autoCenter={true}
            />
          </div>
        )}
      </section>

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

      {/* Actions */}
      <div className={styles.actions}>
        <Link
          to="/customers/$customerId"
          params={{ customerId: customer.id }}
          className={`${styles.actionButton} ${styles.primary}`}
        >
          Otevřít detail
        </Link>
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
        <span><kbd>Enter</kbd> Otevřít</span>
        <span><kbd>Esc</kbd> Zavřít</span>
      </div>
    </div>
  );
}
