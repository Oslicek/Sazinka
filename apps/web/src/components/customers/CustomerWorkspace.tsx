/**
 * CustomerWorkspace - 2-column layout for customer detail
 * 
 * Layout:
 * - Left sticky sidebar: contact info, address + status chip, mini map, notes
 * - Right content: tabs (Devices | Revisions | Communication)
 */

import { useState, type ReactNode } from 'react';
import type { Customer } from '@shared/customer';
import { AddressMap } from './AddressMap';
import { AddressStatusChip } from './AddressStatusChip';
import styles from './CustomerWorkspace.module.css';

export type TabId = 'devices' | 'revisions' | 'communication';

interface CustomerWorkspaceProps {
  customer: Customer;
  /** Tab content renderers */
  tabs: {
    devices: ReactNode;
    revisions: ReactNode;
    communication?: ReactNode;
  };
  /** Active tab (controlled) */
  activeTab?: TabId;
  /** Callback when tab changes */
  onTabChange?: (tab: TabId) => void;
}

export function CustomerWorkspace({
  customer,
  tabs,
  activeTab: controlledActiveTab,
  onTabChange,
}: CustomerWorkspaceProps) {
  const [internalActiveTab, setInternalActiveTab] = useState<TabId>('devices');
  const activeTab = controlledActiveTab ?? internalActiveTab;

  const handleTabChange = (tab: TabId) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalActiveTab(tab);
    }
  };

  const hasCoordinates = customer.lat !== undefined && customer.lng !== undefined;
  const isCompany = customer.type === 'company';
  const fullAddress = [customer.street, customer.city, customer.postalCode]
    .filter(Boolean)
    .join(', ');

  return (
    <div className={styles.workspace}>
      {/* Left sticky sidebar */}
      <aside className={styles.sidebar}>
        {/* Contact section */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Kontakt</h3>
          
          {isCompany && customer.contactPerson && (
            <div className={styles.contactItem}>
              <span className={styles.contactIcon}>👤</span>
              <span className={styles.contactText}>{customer.contactPerson}</span>
            </div>
          )}
          
          {customer.phone && (
            <div className={styles.contactItem}>
              <span className={styles.contactIcon}>📞</span>
              <a href={`tel:${customer.phone}`} className={styles.contactLink}>
                {customer.phone}
              </a>
              <button
                type="button"
                className={styles.copyButton}
                onClick={() => navigator.clipboard.writeText(customer.phone!)}
                title="Kopírovat"
              >
                📋
              </button>
            </div>
          )}
          
          {customer.email && (
            <div className={styles.contactItem}>
              <span className={styles.contactIcon}>✉️</span>
              <a href={`mailto:${customer.email}`} className={styles.contactLink}>
                {customer.email}
              </a>
              <button
                type="button"
                className={styles.copyButton}
                onClick={() => navigator.clipboard.writeText(customer.email!)}
                title="Kopírovat"
              >
                📋
              </button>
            </div>
          )}

          {!customer.phone && !customer.email && (
            <p className={styles.emptyText}>Kontakt nevyplněn</p>
          )}
        </section>

        {/* Address section */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Adresa</h3>
          <AddressStatusChip status={customer.geocodeStatus} />
          <p className={styles.address}>{fullAddress || 'Adresa nevyplněna'}</p>
          
          {hasCoordinates && (
            <div className={styles.mapContainer}>
              <AddressMap
                lat={customer.lat}
                lng={customer.lng}
                draggable={false}
                displayName={fullAddress}
              />
            </div>
          )}
          
          {!hasCoordinates && (
            <div className={styles.noMap}>
              {customer.geocodeStatus === 'failed' ? (
                <span>⚠️ Adresu nelze lokalizovat</span>
              ) : (
                <span>🗺️ Mapa není k dispozici</span>
              )}
            </div>
          )}
        </section>

        {/* Company info */}
        {isCompany && (customer.ico || customer.dic) && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Firemní údaje</h3>
            {customer.ico && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>IČO:</span>
                <span className={styles.infoValue}>{customer.ico}</span>
              </div>
            )}
            {customer.dic && (
              <div className={styles.infoRow}>
                <span className={styles.infoLabel}>DIČ:</span>
                <span className={styles.infoValue}>{customer.dic}</span>
              </div>
            )}
          </section>
        )}

        {/* Notes section */}
        {customer.notes && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Poznámky</h3>
            <p className={styles.notes}>{customer.notes}</p>
          </section>
        )}

        {/* Metadata */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Informace</h3>
          <div className={styles.metadata}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Vytvořeno:</span>
              <span className={styles.infoValue}>
                {new Date(customer.createdAt).toLocaleDateString('cs-CZ')}
              </span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Aktualizováno:</span>
              <span className={styles.infoValue}>
                {new Date(customer.updatedAt).toLocaleDateString('cs-CZ')}
              </span>
            </div>
          </div>
        </section>
      </aside>

      {/* Right content with tabs */}
      <main className={styles.content}>
        {/* Tab navigation */}
        <nav className={styles.tabNav}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'devices' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('devices')}
          >
            🔧 Zařízení
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'revisions' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('revisions')}
          >
            📋 Zakázky & Návštěvy
          </button>
          {tabs.communication && (
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'communication' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('communication')}
            >
              💬 Komunikace
            </button>
          )}
        </nav>

        {/* Tab content */}
        <div className={styles.tabContent}>
          {activeTab === 'devices' && tabs.devices}
          {activeTab === 'revisions' && tabs.revisions}
          {activeTab === 'communication' && tabs.communication}
        </div>
      </main>
    </div>
  );
}
