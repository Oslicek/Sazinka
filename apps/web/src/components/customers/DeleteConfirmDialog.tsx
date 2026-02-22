/**
 * Confirmation dialog for deleting a customer
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import styles from './DeleteConfirmDialog.module.css';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  customerName: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDeleting?: boolean;
}

export function DeleteConfirmDialog({
  isOpen,
  customerName,
  onConfirm,
  onCancel,
  isDeleting = false,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation('customers');

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isDeleting) {
      onCancel();
    }
  }, [onCancel, isDeleting]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.dialog}>
        <div className={styles.icon}><AlertTriangle size={24} /></div>
        
        <h2 className={styles.title}>{t('delete_title')}</h2>
        
        <p
          className={styles.message}
          dangerouslySetInnerHTML={{ __html: t('delete_confirm', { name: customerName }) }}
        />
        
        <p className={styles.warning}>
          {t('delete_warning')}
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            onClick={onCancel}
            className={styles.cancelButton}
            disabled={isDeleting}
          >
            {t('delete_cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={styles.deleteButton}
            disabled={isDeleting}
          >
            {isDeleting ? t('delete_deleting') : t('delete_confirm_button')}
          </button>
        </div>
      </div>
    </div>
  );
}
