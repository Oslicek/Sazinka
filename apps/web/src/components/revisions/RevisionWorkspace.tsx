/**
 * RevisionWorkspace - 2-column layout for revision detail
 * 
 * Layout:
 * - Left column: customer info, device info, address status
 * - Right column: visit detail, CTA actions, tabs (Progress | Communication | History)
 */

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import type { Revision } from '@shared/revision';
import { REVISION_STATUS_KEYS, REVISION_RESULT_KEYS } from '@shared/revision';

import { formatDate, formatTime } from '../../i18n/formatters';
import { RevisionStatusActions } from './RevisionStatusActions';
import styles from './RevisionWorkspace.module.css';

export type RevisionTabId = 'progress' | 'communication' | 'history';

interface RevisionWorkspaceProps {
  revision: Revision;
  onSchedule: () => void;
  onReschedule: () => void;
  onSnooze: () => void;
  onComplete: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  tabs?: {
    progress?: ReactNode;
    communication?: ReactNode;
    history?: ReactNode;
  };
  activeTab?: RevisionTabId;
  onTabChange?: (tab: RevisionTabId) => void;
}

export function RevisionWorkspace({
  revision,
  onSchedule,
  onReschedule,
  onSnooze,
  onComplete,
  onCancel,
  isSubmitting = false,
  tabs = {},
  activeTab: controlledActiveTab,
  onTabChange,
}: RevisionWorkspaceProps) {
  const { t } = useTranslation('common');
  const [internalActiveTab, setInternalActiveTab] = useState<RevisionTabId>('progress');
  const activeTab = controlledActiveTab ?? internalActiveTab;

  const handleTabChange = (tab: RevisionTabId) => {
    if (onTabChange) {
      onTabChange(tab);
    } else {
      setInternalActiveTab(tab);
    }
  };

  const fullAddress = [revision.customerStreet, revision.customerCity, revision.customerPostalCode]
    .filter(Boolean)
    .join(', ');

  // Build Google Maps URL from address
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;

  return (
    <div className={styles.workspace}>
      {/* Left column - Customer & Device info */}
      <aside className={styles.leftColumn}>
        {/* Customer card */}
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>{t('customer')}</h3>
          <p className={styles.customerName}>{revision.customerName || t('revision_ws_unknown_customer')}</p>
          
          {revision.customerPhone && (
            <div className={styles.contactItem}>
              <a href={`tel:${revision.customerPhone}`} className={styles.contactLink}>
                📞 {revision.customerPhone}
              </a>
            </div>
          )}
          
          {/* Email available via customer detail */}
          
          <div className={styles.cardActions}>
            <Link 
              to="/customers/$customerId" 
              params={{ customerId: revision.customerId }}
              className={styles.cardAction}
            >
              👤 {t('revision_ws_customer_detail')}
            </Link>
          </div>
        </section>

        {/* Address card */}
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>{t('revision_ws_address')}</h3>
          {/* Geocode status available on the Customer entity */}
          <p className={styles.address}>{fullAddress || t('revision_ws_no_address')}</p>
          
          {fullAddress && (
            <a 
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.cardAction}
            >
              🧭 {t('revision_ws_navigate')}
            </a>
          )}
        </section>

        {/* Device card */}
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>{t('device')}</h3>
          <p className={styles.deviceName}>{revision.deviceName || revision.deviceType || t('revision_ws_unknown_device')}</p>
          {revision.deviceType && revision.deviceName && (
            <p className={styles.deviceType}>{revision.deviceType}</p>
          )}
          <div className={styles.cardActions}>
            <Link 
              to="/customers/$customerId"
              params={{ customerId: revision.customerId }}
              search={{ tab: 'devices' }}
              className={styles.cardAction}
            >
              🔧 {t('revision_ws_device_detail')}
            </Link>
          </div>
        </section>
      </aside>

      {/* Right column - Visit details & Actions */}
      <main className={styles.rightColumn}>
        {/* Status & Actions header */}
        <div className={styles.statusHeader}>
          <div className={styles.statusInfo}>
            <span className={`${styles.statusBadge} ${styles[`status-${revision.status}`]}`}>
              {REVISION_STATUS_KEYS[revision.status as keyof typeof REVISION_STATUS_KEYS] ? t(REVISION_STATUS_KEYS[revision.status as keyof typeof REVISION_STATUS_KEYS]) : revision.status}
            </span>
            {revision.result && (
              <span className={`${styles.resultBadge} ${styles[`result-${revision.result}`]}`}>
                {REVISION_RESULT_KEYS[revision.result as keyof typeof REVISION_RESULT_KEYS] ? t(REVISION_RESULT_KEYS[revision.result as keyof typeof REVISION_RESULT_KEYS]) : revision.result}
              </span>
            )}
          </div>
          <RevisionStatusActions
            revision={revision}
            onSchedule={onSchedule}
            onReschedule={onReschedule}
            onSnooze={onSnooze}
            onComplete={onComplete}
            onCancel={onCancel}
            isSubmitting={isSubmitting}
            variant="header"
          />
        </div>

        {/* Visit details card */}
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>{t('revision_ws_visit_detail')}</h3>
          <div className={styles.detailGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>{t('revision_ws_due_date')}:</span>
              <span className={styles.detailValue}>
                {formatDate(revision.dueDate)}
              </span>
            </div>
            {revision.scheduledDate && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>{t('revision_ws_scheduled_for')}:</span>
                <span className={styles.detailValue}>
                  {formatDate(revision.scheduledDate)}
                </span>
              </div>
            )}
            {revision.scheduledTimeStart && revision.scheduledTimeEnd && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>{t('revision_ws_time_window')}:</span>
                <span className={styles.detailValue}>
                  {revision.scheduledTimeStart.substring(0, 5)} - {revision.scheduledTimeEnd.substring(0, 5)}
                </span>
              </div>
            )}
            {revision.durationMinutes && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>{t('revision_ws_duration')}:</span>
                <span className={styles.detailValue}>{revision.durationMinutes} min</span>
              </div>
            )}
            {revision.completedAt && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>{t('revision_ws_completed')}:</span>
                <span className={styles.detailValue}>
                  {formatDate(revision.completedAt)} {formatTime(revision.completedAt)}
                </span>
              </div>
            )}
          </div>
          {revision.findings && (
            <div className={styles.findings}>
              <span className={styles.detailLabel}>{t('revision_ws_notes')}:</span>
              <p>{revision.findings}</p>
            </div>
          )}
        </section>

        {/* Tabs */}
        {(tabs.progress || tabs.communication || tabs.history) && (
          <>
            <nav className={styles.tabNav}>
              {tabs.progress && (
                <button
                  type="button"
                  className={`${styles.tab} ${activeTab === 'progress' ? styles.tabActive : ''}`}
                  onClick={() => handleTabChange('progress')}
                >
                  📋 {t('revision_ws_tab_progress')}
                </button>
              )}
              {tabs.communication && (
                <button
                  type="button"
                  className={`${styles.tab} ${activeTab === 'communication' ? styles.tabActive : ''}`}
                  onClick={() => handleTabChange('communication')}
                >
                  💬 {t('revision_ws_tab_communication')}
                </button>
              )}
              {tabs.history && (
                <button
                  type="button"
                  className={`${styles.tab} ${activeTab === 'history' ? styles.tabActive : ''}`}
                  onClick={() => handleTabChange('history')}
                >
                  📜 {t('revision_ws_tab_history')}
                </button>
              )}
            </nav>
            <div className={styles.tabContent}>
              {activeTab === 'progress' && tabs.progress}
              {activeTab === 'communication' && tabs.communication}
              {activeTab === 'history' && tabs.history}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
