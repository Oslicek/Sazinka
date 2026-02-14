/**
 * ScheduledTimeWarning — modal dialog shown when a stop with an agreed time
 * is being moved to a different position via drag-and-drop.
 */

import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('planner');
  const timeStr = `${formatTime(scheduledTimeStart)} – ${formatTime(scheduledTimeEnd)}`;
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.icon}>!</div>
        <h3 className={styles.title}>{t('scheduled_warning_title')}</h3>
        <p
          className={styles.message}
          dangerouslySetInnerHTML={{
            __html: t('scheduled_warning_message', { name: customerName, time: timeStr }),
          }}
        />
        <p className={styles.warning}>{t('scheduled_warning_note')}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onCancel}>
            {t('scheduled_warning_cancel')}
          </button>
          <button type="button" className={styles.confirmButton} onClick={onConfirm}>
            {t('scheduled_warning_confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
