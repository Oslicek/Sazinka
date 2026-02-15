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
import { useTranslation } from 'react-i18next';
import type { Customer, CustomerListItem } from '@shared/customer';
import { AddressMap } from './AddressMap';
import { AddressStatusChip } from './AddressStatusChip';
import { DeviceList } from '../devices';
import { CustomerTimeline } from '../timeline';
import { formatDate } from '../../i18n/formatters';
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
function AddressStatus({ status, t }: { status: string; t: (key: string) => string }) {
  const config: Record<string, { icon: string; labelKey: string; className: string }> = {
    success: { icon: '✅', labelKey: 'address_status_verified', className: styles.statusSuccess },
    pending: { icon: '⏳', labelKey: 'address_status_pending', className: styles.statusPending },
    failed: { icon: '⚠', labelKey: 'address_status_failed', className: styles.statusFailed },
  };

  const { icon, labelKey, className } = config[status] || {
    icon: '⛔',
    labelKey: 'address_status_missing',
    className: styles.statusMissing,
  };

  return (
    <span className={`${styles.addressStatus} ${className}`}>
      {icon} {t(labelKey)}
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
  const { t } = useTranslation('customers');

  if (!customer) {
    return (
      <div className={styles.panel}>
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}>👆</span>
          <p>{t('preview_select_customer')}</p>
          <p className={styles.emptyHint}>
            {t('preview_keyboard_hint')}
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
              title={t('preview_open_full_page')}
            >
              ↗
            </Link>
          </div>
          <span className={styles.typeBadge}>
            {isCompany ? t('type_company') : t('type_person')}
          </span>
        </div>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          title={t('preview_close_esc')}
        >
          ✕
        </button>
      </div>

      {/* Scrollable content area */}
      <div className={styles.scrollContent}>
        {/* Contact section */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('preview_contact')}</h4>

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
                title={t('preview_copy')}
              >
                📋
              </button>
            </div>
          ) : (
            <p className={styles.missingInfo}>📵 {t('preview_missing_phone')}</p>
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
                title={t('preview_copy')}
              >
                📋
              </button>
            </div>
          )}
        </section>

        {/* Address section */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('preview_address')}</h4>
          <div className={styles.addressRow}>
            <p className={styles.address}>{fullAddress || t('preview_address_empty')}</p>
            <AddressStatus status={c.geocodeStatus} t={t} />
          </div>

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
            <h4 className={styles.sectionTitle}>{t('preview_company_info')}</h4>
            {ico && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{t('form_ico')}:</span>
                <span className={styles.infoValue}>{ico}</span>
              </div>
            )}
            {dic && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{t('form_dic')}:</span>
                <span className={styles.infoValue}>{dic}</span>
              </div>
            )}
          </section>
        )}

        {/* Stats section */}
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('preview_overview')}</h4>
          <div className={styles.stats}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{customer.deviceCount}</span>
              <span className={styles.statLabel}>{t('preview_devices_count')}</span>
            </div>
            {customer.neverServicedCount > 0 && (
              <div className={`${styles.statItem} ${styles.statWarning}`}>
                <span className={styles.statValue}>{customer.neverServicedCount}</span>
                <span className={styles.statLabel}>{t('preview_never_serviced')}</span>
              </div>
            )}
            {customer.overdueCount > 0 && (
              <div className={`${styles.statItem} ${styles.statDanger}`}>
                <span className={styles.statValue}>{customer.overdueCount}</span>
                <span className={styles.statLabel}>{t('preview_overdue')}</span>
              </div>
            )}
          </div>
          {customer.nextRevisionDate && (
            <p className={styles.nextRevision}>
              {t('preview_next_revision')} {formatDate(customer.nextRevisionDate)}
            </p>
          )}
        </section>

        {/* Notes */}
        {notes && (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('preview_notes')}</h4>
            <p className={styles.notes}>{notes}</p>
          </section>
        )}

        {/* Metadata */}
        {createdAt && (
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>{t('preview_info')}</h4>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>{t('preview_created')}</span>
              <span className={styles.infoValue}>
                {formatDate(createdAt)}
              </span>
            </div>
            {updatedAt && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>{t('preview_updated')}</span>
                <span className={styles.infoValue}>
                  {formatDate(updatedAt)}
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
                🔧 {t('preview_devices_tab')}
              </button>
              <button
                type="button"
                className={`${styles.tab} ${activeTab === 'revisions' ? styles.tabActive : ''}`}
                onClick={() => setActiveTab('revisions')}
              >
                📋 {t('preview_history_tab')}
              </button>
            </nav>
            <div className={styles.tabContent}>
              {activeTab === 'devices' && (
                <DeviceList
                  customerId={fullCustomer.id}
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
            <span>{t('preview_loading_detail')}</span>
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
          ✎ {t('preview_edit')}
        </button>
        {onAddToPlan && hasCoordinates && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => onAddToPlan(customer)}
          >
            ➕ {t('preview_add_to_plan')}
          </button>
        )}
      </div>

      {/* Keyboard hint */}
      <div className={styles.keyboardHint}>
        <span><kbd>Esc</kbd> {t('preview_close')}</span>
      </div>
    </div>
  );
}
