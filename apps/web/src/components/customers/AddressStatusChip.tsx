/**
 * AddressStatusChip - Badge showing address geocode status
 * 
 * Statuses:
 * - success (verified) - green
 * - pending - yellow
 * - failed (unlocatable) - red
 * - missing - gray
 */

import styles from './AddressStatusChip.module.css';

type GeoStatus = 'success' | 'pending' | 'failed' | 'missing' | string;

interface AddressStatusChipProps {
  status: GeoStatus;
  showLabel?: boolean;
}

const STATUS_CONFIG: Record<string, { icon: string; label: string; className: string }> = {
  success: { icon: '✅', label: 'Ověřeno', className: styles.success },
  pending: { icon: '⏳', label: 'Čeká na ověření', className: styles.pending },
  failed: { icon: '⚠', label: 'Nelze lokalizovat', className: styles.failed },
  missing: { icon: '⛔', label: 'Chybí adresa', className: styles.missing },
};

export function AddressStatusChip({ status, showLabel = true }: AddressStatusChipProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.missing;
  
  return (
    <span className={`${styles.chip} ${config.className}`} title={config.label}>
      <span className={styles.icon}>{config.icon}</span>
      {showLabel && <span className={styles.label}>{config.label}</span>}
    </span>
  );
}
