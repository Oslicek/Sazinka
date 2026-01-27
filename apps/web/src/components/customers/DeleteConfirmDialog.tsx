/**
 * Confirmation dialog for deleting a customer
 */

import { useCallback } from 'react';
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
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isDeleting) {
      onCancel();
    }
  }, [onCancel, isDeleting]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.dialog}>
        <div className={styles.icon}>⚠️</div>
        
        <h2 className={styles.title}>Smazat zákazníka?</h2>
        
        <p className={styles.message}>
          Opravdu chcete smazat zákazníka <strong>{customerName}</strong>?
        </p>
        
        <p className={styles.warning}>
          Tato akce je nevratná. Všechna data zákazníka budou trvale odstraněna.
        </p>

        <div className={styles.actions}>
          <button
            type="button"
            onClick={onCancel}
            className={styles.cancelButton}
            disabled={isDeleting}
          >
            Zrušit
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={styles.deleteButton}
            disabled={isDeleting}
          >
            {isDeleting ? 'Mazání...' : 'Smazat'}
          </button>
        </div>
      </div>
    </div>
  );
}
