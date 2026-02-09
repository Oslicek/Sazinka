/**
 * CustomerHeader - Header with customer name and CTA actions
 * 
 * CTAs:
 * - Call (primary phone)
 * - Navigate (open in maps)
 * - Add to plan (route-aware)
 * - Edit
 */

import { Link } from '@tanstack/react-router';
import type { Customer } from '@shared/customer';
import styles from './CustomerHeader.module.css';

interface CustomerHeaderProps {
  customer: Customer;
  onEdit: () => void;
  onAddToPlan?: () => void;
  onDelete?: () => void;
}

export function CustomerHeader({
  customer,
  onEdit,
  onAddToPlan,
  onDelete,
}: CustomerHeaderProps) {
  const isCompany = customer.type === 'company';
  const hasCoordinates = customer.lat !== undefined && customer.lng !== undefined;
  
  // Build Google Maps URL
  const mapsUrl = hasCoordinates
    ? `https://www.google.com/maps/dir/?api=1&destination=${customer.lat},${customer.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${customer.street}, ${customer.city} ${customer.postalCode}`
      )}`;

  return (
    <header className={styles.header}>
      <div className={styles.breadcrumb}>
        <Link to="/customers" className={styles.backLink}>
          ← Zákazníci
        </Link>
      </div>
      
      <div className={styles.titleRow}>
        <div className={styles.titleSection}>
          <h1 className={styles.title}>{customer.name}</h1>
          <span className={`${styles.typeBadge} ${isCompany ? styles.company : styles.person}`}>
            {isCompany ? 'Firma' : 'Fyzická osoba'}
          </span>
        </div>
        
        <div className={styles.actions}>
          {/* Call button */}
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className={`${styles.actionButton} ${styles.primary}`}>
              📞 Volat
            </a>
          )}
          
          {/* Navigate button */}
          <a 
            href={mapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className={styles.actionButton}
          >
            🗺️ Navigovat
          </a>
          
          {/* Add to plan button */}
          {onAddToPlan && hasCoordinates && (
            <button
              type="button"
              className={styles.actionButton}
              onClick={onAddToPlan}
            >
              ➕ Do plánu
            </button>
          )}
          
          {/* Edit button */}
          <button
            type="button"
            className={styles.actionButton}
            onClick={onEdit}
          >
            ✎ Upravit
          </button>
          
          {/* Delete button */}
          {onDelete && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.danger}`}
              onClick={onDelete}
              title="Smazat zákazníka (anonymizace)"
              aria-label="Smazat zákazníka (anonymizace)"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
