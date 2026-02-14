import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { CustomerSummary as CustomerSummaryType } from '@shared/customer';
import { getCustomerSummary } from '../services/customerService';
import { useNatsStore } from '../stores/natsStore';
import { getToken } from '@/utils/auth';
import { formatNumber } from '@/i18n/formatters';
import styles from './CustomerSummary.module.css';

interface StatCardProps {
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  subtitle?: string;
}

function StatCard({ label, value, variant = 'default', subtitle }: StatCardProps) {
  return (
    <div className={`${styles.statCard} ${styles[variant]}`}>
      <div className={styles.statValue}>{formatNumber(value, 0)}</div>
      <div className={styles.statLabel}>{label}</div>
      {subtitle && <div className={styles.statSubtitle}>{subtitle}</div>}
    </div>
  );
}

export function CustomerSummary() {
  const [summary, setSummary] = useState<CustomerSummaryType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isConnected = useNatsStore((s) => s.isConnected);
  const { t } = useTranslation('customers');

  const loadSummary = useCallback(async () => {
    if (!isConnected) {
      setError(t('error_not_connected'));
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await getCustomerSummary();
      setSummary(data);
    } catch (err) {
      console.error('Failed to load customer summary:', err);
      setError(err instanceof Error ? err.message : t('error_summary_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [isConnected]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  if (!isConnected) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link to="/customers" className={styles.backLink}>
            {t('back_to_customers')}
          </Link>
          <h1>{t('summary_title')}</h1>
        </div>
        <div className={styles.error}>{t('error_not_connected')}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link to="/customers" className={styles.backLink}>
            {t('back_to_customers')}
          </Link>
          <h1>{t('summary_title')}</h1>
        </div>
        <div className={styles.loading}>{t('loading_summary')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link to="/customers" className={styles.backLink}>
            {t('back_to_customers')}
          </Link>
          <h1>{t('summary_title')}</h1>
        </div>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link to="/customers" className={styles.backLink}>
          {t('back_to_customers')}
        </Link>
        <h1>{t('summary_title')}</h1>
        <p className={styles.subtitle}>{t('summary_subtitle')}</p>
      </div>

      {/* Main KPIs */}
      <section className={styles.section}>
        <h2>{t('summary_basic')}</h2>
        <div className={styles.statsGrid}>
          <StatCard
            label={t('summary_total_customers')}
            value={summary.totalCustomers}
          />
          <StatCard
            label={t('summary_total_devices')}
            value={summary.totalDevices}
          />
          <StatCard
            label={t('summary_revisions_scheduled')}
            value={summary.revisionsScheduled}
            variant="success"
          />
        </div>
      </section>

      {/* Revision Status */}
      <section className={styles.section}>
        <h2>{t('summary_revision_status')}</h2>
        <div className={styles.statsGrid}>
          <StatCard
            label={t('summary_overdue')}
            value={summary.revisionsOverdue}
            variant={summary.revisionsOverdue > 0 ? 'danger' : 'default'}
            subtitle={t('summary_overdue_subtitle')}
          />
          <StatCard
            label={t('summary_this_week')}
            value={summary.revisionsDueThisWeek}
            variant={summary.revisionsDueThisWeek > 0 ? 'warning' : 'default'}
            subtitle={t('summary_this_week_subtitle')}
          />
          <StatCard
            label={t('summary_scheduled')}
            value={summary.revisionsScheduled}
            variant="success"
            subtitle={t('summary_scheduled_subtitle')}
          />
        </div>
      </section>

      {/* Geocoding Status */}
      <section className={styles.section}>
        <h2>{t('summary_geocoding_status')}</h2>
        <div className={styles.statsGrid}>
          <StatCard
            label={t('summary_geocode_success')}
            value={summary.geocodeSuccess}
            variant="success"
          />
          <StatCard
            label={t('summary_geocode_pending')}
            value={summary.geocodePending}
            variant={summary.geocodePending > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label={t('summary_geocode_failed')}
            value={summary.geocodeFailed}
            variant={summary.geocodeFailed > 0 ? 'danger' : 'default'}
            subtitle={t('summary_geocode_failed_subtitle')}
          />
        </div>
      </section>

      {/* Contact Information */}
      <section className={styles.section}>
        <h2>{t('summary_contact_info')}</h2>
        <div className={styles.statsGrid}>
          <StatCard
            label={t('summary_no_phone')}
            value={summary.customersWithoutPhone}
            variant={summary.customersWithoutPhone > 0 ? 'warning' : 'default'}
            subtitle={t('summary_no_phone_subtitle')}
          />
          <StatCard
            label={t('summary_no_email')}
            value={summary.customersWithoutEmail}
            variant={summary.customersWithoutEmail > 0 ? 'warning' : 'default'}
            subtitle={t('summary_no_email_subtitle')}
          />
        </div>
      </section>

      {/* Quick Actions */}
      <section className={styles.section}>
        <h2>{t('summary_quick_actions')}</h2>
        <div className={styles.actions}>
          {summary.revisionsOverdue > 0 && (
            <Link to="/customers" search={{ hasOverdue: true }} className={styles.actionButton}>
              {t('summary_show_overdue', { count: summary.revisionsOverdue })}
            </Link>
          )}
          {summary.geocodeFailed > 0 && (
            <Link to="/customers" search={{ geocodeStatus: 'failed' }} className={styles.actionButton}>
              {t('summary_show_geocode_failed', { count: summary.geocodeFailed })}
            </Link>
          )}
          <Link to="/queue" className={styles.actionButton}>
            {t('summary_go_to_queue')}
          </Link>
        </div>
      </section>
    </div>
  );
}
