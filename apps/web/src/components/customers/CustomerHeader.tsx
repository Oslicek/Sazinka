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
import { useTranslation } from 'react-i18next';
import { Phone, Map, Plus, Pencil, Trash2 } from 'lucide-react';
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
  const { t } = useTranslation('customers');
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
          {t('header_back')}
        </Link>
      </div>
      
      <div className={styles.titleRow}>
        <div className={styles.titleSection}>
          <h1 className={styles.title}>{customer.name}</h1>
          <span className={`${styles.typeBadge} ${isCompany ? styles.company : styles.person}`}>
            {isCompany ? t('type_company') : t('type_person_full')}
          </span>
        </div>
        
        <div className={styles.actions}>
          {/* Call button */}
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className={`${styles.actionButton} ${styles.primary}`}>
              <Phone size={14} /> {t('header_call')}
            </a>
          )}
          
          {/* Navigate button */}
          <a 
            href={mapsUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className={styles.actionButton}
          >
            <Map size={14} /> {t('header_navigate')}
          </a>
          
          {/* Add to plan button */}
          {onAddToPlan && hasCoordinates && (
            <button
              type="button"
              className={styles.actionButton}
              onClick={onAddToPlan}
            >
              <Plus size={14} /> {t('header_add_to_plan')}
            </button>
          )}
          
          {/* Edit button */}
          <button
            type="button"
            className={styles.actionButton}
            onClick={onEdit}
          >
            <Pencil size={14} /> {t('header_edit')}
          </button>
          
          {/* Delete button */}
          {onDelete && (
            <button
              type="button"
              className={`${styles.actionButton} ${styles.danger}`}
              onClick={onDelete}
              title={t('header_delete_title')}
              aria-label={t('header_delete_title')}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
