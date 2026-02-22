/**
 * AddressStatusChip - Badge showing address geocode status
 * 
 * Statuses:
 * - success (verified) - green
 * - pending - yellow
 * - failed (unlocatable) - red
 * - missing - gray
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, AlertTriangle } from 'lucide-react';
import styles from './AddressStatusChip.module.css';

type GeoStatus = 'success' | 'pending' | 'failed' | 'missing' | string;

interface AddressStatusChipProps {
  status: GeoStatus;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<string, { icon: ReactNode; labelKey: string; className: string }> = {
  success: { icon: <Check size={14} />, labelKey: 'address_status_verified', className: styles.success },
  pending: { icon: '⏳', labelKey: 'address_status_pending', className: styles.pending },
  failed: { icon: <AlertTriangle size={14} />, labelKey: 'address_status_failed', className: styles.failed },
  missing: { icon: '⛔', labelKey: 'address_status_missing', className: styles.missing },
};

export function AddressStatusChip({ status, showLabel = true }: AddressStatusChipProps) {
  const { t } = useTranslation('customers');
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.missing;
  
  return (
    <span className={`${styles.chip} ${config.className}`} title={t(config.labelKey)}>
      <span className={styles.icon}>{config.icon}</span>
      {showLabel && <span className={styles.label}>{t(config.labelKey)}</span>}
    </span>
  );
}
