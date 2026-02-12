/**
 * ScheduledTimeWarning — modal dialog shown when a stop with an agreed time
 * is being moved to a different position via drag-and-drop.
 */

import styles from './ScheduledTimeWarning.module.css';

interface ScheduledTimeWarningProps {
  customerName: string;
  scheduledTimeStart: string;
  scheduledTimeEnd: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatTime(time: string): string {
  return time.substring(0, 5);
}

export function ScheduledTimeWarning({
  customerName,
  scheduledTimeStart,
  scheduledTimeEnd,
  onConfirm,
  onCancel,
}: ScheduledTimeWarningProps) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon}>!</div>
        <h3 className={styles.title}>Dohodnutý termín</h3>
        <p className={styles.message}>
          Návštěva u <strong>{customerName}</strong> má dohodnutý termín{' '}
          <strong>{formatTime(scheduledTimeStart)} – {formatTime(scheduledTimeEnd)}</strong>.
        </p>
        <p className={styles.warning}>
          Přesunutí vyžaduje novou komunikaci se zákazníkem a potvrzení nového času.
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>
            Zrušit
          </button>
          <button type="button" className={styles.confirmButton} onClick={onConfirm}>
            Přesto přesunout
          </button>
        </div>
      </div>
    </div>
  );
}
