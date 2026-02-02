import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import type { CustomerSummary as CustomerSummaryType } from '@shared/customer';
import { getCustomerSummary } from '../services/customerService';
import { useNatsStore } from '../stores/natsStore';
import styles from './CustomerSummary.module.css';

// Temporary user ID until auth is implemented
const TEMP_USER_ID = '00000000-0000-0000-0000-000000000001';

interface StatCardProps {
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  subtitle?: string;
}

function StatCard({ label, value, variant = 'default', subtitle }: StatCardProps) {
  return (
    <div className={`${styles.statCard} ${styles[variant]}`}>
      <div className={styles.statValue}>{value.toLocaleString('cs-CZ')}</div>
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

  const loadSummary = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const data = await getCustomerSummary(TEMP_USER_ID);
      setSummary(data);
    } catch (err) {
      console.error('Failed to load customer summary:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst souhrn');
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
            ← Zpět na zákazníky
          </Link>
          <h1>Souhrnné informace</h1>
        </div>
        <div className={styles.error}>Není připojení k serveru</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link to="/customers" className={styles.backLink}>
            ← Zpět na zákazníky
          </Link>
          <h1>Souhrnné informace</h1>
        </div>
        <div className={styles.loading}>Načítám souhrn...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <Link to="/customers" className={styles.backLink}>
            ← Zpět na zákazníky
          </Link>
          <h1>Souhrnné informace</h1>
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
          ← Zpět na zákazníky
        </Link>
        <h1>Souhrnné informace</h1>
        <p className={styles.subtitle}>Přehled zákazníků, zařízení a revizí</p>
      </div>

      {/* Main KPIs */}
      <section className={styles.section}>
        <h2>Základní přehled</h2>
        <div className={styles.statsGrid}>
          <StatCard
            label="Zákazníků celkem"
            value={summary.totalCustomers}
          />
          <StatCard
            label="Zařízení celkem"
            value={summary.totalDevices}
          />
          <StatCard
            label="Revizí naplánováno"
            value={summary.revisionsScheduled}
            variant="success"
          />
        </div>
      </section>

      {/* Revision Status */}
      <section className={styles.section}>
        <h2>Stav revizí</h2>
        <div className={styles.statsGrid}>
          <StatCard
            label="Po termínu"
            value={summary.revisionsOverdue}
            variant={summary.revisionsOverdue > 0 ? 'danger' : 'default'}
            subtitle="Vyžaduje okamžitou pozornost"
          />
          <StatCard
            label="Tento týden"
            value={summary.revisionsDueThisWeek}
            variant={summary.revisionsDueThisWeek > 0 ? 'warning' : 'default'}
            subtitle="V následujících 7 dnech"
          />
          <StatCard
            label="Naplánováno"
            value={summary.revisionsScheduled}
            variant="success"
            subtitle="Připraveno k provedení"
          />
        </div>
      </section>

      {/* Geocoding Status */}
      <section className={styles.section}>
        <h2>Stav geokódování</h2>
        <div className={styles.statsGrid}>
          <StatCard
            label="Úspěšně geokódováno"
            value={summary.geocodeSuccess}
            variant="success"
          />
          <StatCard
            label="Čeká na geokódování"
            value={summary.geocodePending}
            variant={summary.geocodePending > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Selhalo"
            value={summary.geocodeFailed}
            variant={summary.geocodeFailed > 0 ? 'danger' : 'default'}
            subtitle="Nelze lokalizovat"
          />
        </div>
      </section>

      {/* Contact Information */}
      <section className={styles.section}>
        <h2>Kontaktní údaje</h2>
        <div className={styles.statsGrid}>
          <StatCard
            label="Bez telefonu"
            value={summary.customersWithoutPhone}
            variant={summary.customersWithoutPhone > 0 ? 'warning' : 'default'}
            subtitle="Chybí telefonní číslo"
          />
          <StatCard
            label="Bez e-mailu"
            value={summary.customersWithoutEmail}
            variant={summary.customersWithoutEmail > 0 ? 'warning' : 'default'}
            subtitle="Chybí e-mailová adresa"
          />
        </div>
      </section>

      {/* Quick Actions */}
      <section className={styles.section}>
        <h2>Rychlé akce</h2>
        <div className={styles.actions}>
          {summary.revisionsOverdue > 0 && (
            <Link to="/customers" search={{ hasOverdue: true }} className={styles.actionButton}>
              Zobrazit zákazníky s revizemi po termínu ({summary.revisionsOverdue})
            </Link>
          )}
          {summary.geocodeFailed > 0 && (
            <Link to="/customers" search={{ geocodeStatus: 'failed' }} className={styles.actionButton}>
              Zobrazit zákazníky s chybnou adresou ({summary.geocodeFailed})
            </Link>
          )}
          <Link to="/queue" className={styles.actionButton}>
            Přejít do fronty k obvolání
          </Link>
        </div>
      </section>
    </div>
  );
}
