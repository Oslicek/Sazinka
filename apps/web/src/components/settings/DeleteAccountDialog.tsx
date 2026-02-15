import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { deleteCompanyData, deleteAccount } from '@/services/settingsService';
import { submitExportJob, subscribeExportJob, downloadExportJob } from '@/services/exportPlusService';
import { useAuthStore } from '@/stores/authStore';
import styles from './DeleteAccountDialog.module.css';

type DeleteLevel = 1 | 2;

// ============================================================================
// Danger Zone Section (rendered inside Settings → Import/Export tab)
// ============================================================================

export function DangerZoneSection() {
  const { t } = useTranslation('settings');
  const [dialogLevel, setDialogLevel] = useState<DeleteLevel | null>(null);

  return (
    <>
      <section className={styles.dangerZone}>
        <h3 className={styles.dangerZoneTitle}>
          ⚠️ {t('danger_zone')}
        </h3>

        {/* Level 1: Delete data, keep account */}
        <div className={styles.dangerOption}>
          <div>
            <h4 className={styles.dangerOptionTitle}>{t('delete_data_title')}</h4>
            <p className={styles.dangerOptionDesc}>{t('delete_data_desc')}</p>
          </div>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => setDialogLevel(1)}
          >
            ⛔ {t('delete_data_button')}
          </button>
        </div>

        {/* Level 2: Delete everything including account */}
        <div className={styles.dangerOption}>
          <div>
            <h4 className={styles.dangerOptionTitle}>{t('delete_all_title')}</h4>
            <p className={styles.dangerOptionDesc}>{t('delete_all_desc')}</p>
          </div>
          <button
            type="button"
            className={styles.deleteButton}
            onClick={() => setDialogLevel(2)}
          >
            ⛔ {t('delete_all_button')}
          </button>
        </div>
      </section>

      {dialogLevel !== null && (
        <DeleteAccountDialog
          level={dialogLevel}
          onClose={() => setDialogLevel(null)}
        />
      )}
    </>
  );
}

// ============================================================================
// Two-step Delete Dialog (works for both levels)
// ============================================================================

type DialogStep = 'warning' | 'pin' | 'deleting';

interface DeleteAccountDialogProps {
  level: DeleteLevel;
  onClose: () => void;
}

function DeleteAccountDialog({ level, onClose }: DeleteAccountDialogProps) {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const [step, setStep] = useState<DialogStep>('warning');
  const [pin] = useState(() => generatePin());
  const [pinInput, setPinInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<'idle' | 'exporting' | 'done' | 'error'>('idle');
  const unsubRef = useRef<(() => void) | null>(null);

  const pinMatches = pinInput.trim() === pin;

  function generatePin(): string {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  // Cleanup export subscription on unmount
  useEffect(() => {
    return () => { unsubRef.current?.(); };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'deleting') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, step]);

  // Handle data export download — full flow: submit → subscribe → download file
  const handleDownload = useCallback(async () => {
    setDownloadState('exporting');
    try {
      unsubRef.current?.();
      const result = await submitExportJob({
        scope: 'all_workers_combined',
        selectedFiles: ['customers', 'devices', 'revisions', 'communications', 'work_log', 'routes'],
        filters: {},
        userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        userTimeZoneOffsetMinutes: new Date().getTimezoneOffset(),
      });

      unsubRef.current = await subscribeExportJob(result.jobId, async (update) => {
        if (update.status.type === 'completed') {
          try {
            const { filename, blob } = await downloadExportJob(update.jobId);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            setDownloadState('done');
          } catch {
            setDownloadState('error');
          }
          unsubRef.current?.();
        }
        if (update.status.type === 'failed') {
          setDownloadState('error');
          unsubRef.current?.();
        }
      });
    } catch {
      setDownloadState('error');
    }
  }, []);

  // Handle final deletion
  const handleDelete = useCallback(async () => {
    setStep('deleting');
    setError(null);
    try {
      if (level === 1) {
        await deleteCompanyData();
        // Data wiped — reload settings page to reflect empty state
        window.location.reload();
      } else {
        await deleteAccount();
        // Account gone — logout and redirect
        logout();
        navigate({ to: '/login', replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('delete_error'));
      setStep('pin');
    }
  }, [level, logout, navigate, t]);

  // Prevent clicks on overlay from closing during deletion
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && step !== 'deleting') {
        onClose();
      }
    },
    [onClose, step]
  );

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        {step === 'warning' && (
          <WarningStep
            t={t}
            level={level}
            downloadState={downloadState}
            onClose={onClose}
            onContinue={() => setStep('pin')}
            onDownload={handleDownload}
          />
        )}
        {step === 'pin' && (
          <PinStep
            t={t}
            level={level}
            pin={pin}
            pinInput={pinInput}
            onPinChange={setPinInput}
            pinMatches={pinMatches}
            error={error}
            onClose={onClose}
            onConfirm={handleDelete}
          />
        )}
        {step === 'deleting' && <DeletingStep t={t} level={level} />}
      </div>
    </div>
  );
}

// ============================================================================
// Step 1: Warning + Export Offer
// ============================================================================

interface WarningStepProps {
  t: (key: string, opts?: Record<string, string>) => string;
  level: DeleteLevel;
  downloadState: 'idle' | 'exporting' | 'done' | 'error';
  onClose: () => void;
  onContinue: () => void;
  onDownload: () => void;
}

function WarningStep({ t, level, downloadState, onClose, onContinue, onDownload }: WarningStepProps) {
  const title = level === 1 ? t('delete_data_dialog_title') : t('delete_dialog_title');

  return (
    <>
      <div className={styles.dialogHeader}>
        ⛔ {title}
      </div>
      <div className={styles.dialogBody}>
        <p className={styles.warningText}>{t('delete_dialog_warning')}</p>
        <ul className={styles.deleteList}>
          <li>{t('delete_dialog_item_customers')}</li>
          <li>{t('delete_dialog_item_devices')}</li>
          <li>{t('delete_dialog_item_routes')}</li>
          <li>{t('delete_dialog_item_comms')}</li>
          <li>{t('delete_dialog_item_settings')}</li>
          {level === 2 && <li>{t('delete_dialog_item_accounts')}</li>}
        </ul>

        <div className={styles.irreversibleBox}>
          <p>⛔ {t('delete_dialog_irreversible')}</p>
          {level === 1 && <p>{t('delete_account_preserved')}</p>}
        </div>

        <p className={styles.downloadHint}>{t('delete_dialog_download_hint')}</p>
        <button
          type="button"
          className={styles.downloadButton}
          onClick={onDownload}
          disabled={downloadState === 'exporting'}
        >
          {downloadState === 'exporting' && '⏳ '}
          {downloadState === 'done' && '✅ '}
          {downloadState === 'error' && '❌ '}
          {downloadState === 'idle' && '📥 '}
          {downloadState === 'exporting'
            ? t('delete_dialog_download_exporting')
            : downloadState === 'done'
              ? t('delete_dialog_download_done')
              : t('delete_dialog_download_btn')}
        </button>
      </div>
      <div className={styles.dialogFooter}>
        <button type="button" className={styles.cancelButton} onClick={onClose}>
          {t('cancel', { ns: 'common' })}
        </button>
        <button
          type="button"
          className={styles.continueButton}
          onClick={onContinue}
        >
          {t('delete_dialog_continue')} →
        </button>
      </div>
    </>
  );
}

// ============================================================================
// Step 2: PIN Confirmation
// ============================================================================

interface PinStepProps {
  t: (key: string, opts?: Record<string, string>) => string;
  level: DeleteLevel;
  pin: string;
  pinInput: string;
  onPinChange: (value: string) => void;
  pinMatches: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

function PinStep({ t, level, pin, pinInput, onPinChange, pinMatches, error, onClose, onConfirm }: PinStepProps) {
  const confirmButton = level === 1 ? t('delete_data_confirm_button') : t('delete_confirm_button');

  return (
    <>
      <div className={styles.dialogHeader}>
        ⛔ {t('delete_confirm_title')}
      </div>
      <div className={styles.dialogBody}>
        <p className={styles.pinInstruction}>{t('delete_confirm_instruction')}</p>

        <div className={styles.pinDisplay}>
          <span className={styles.pinCode}>{pin}</span>
        </div>

        <label className={styles.pinInputLabel}>{t('delete_confirm_input_label')}</label>
        <input
          type="text"
          className={styles.pinInput}
          value={pinInput}
          onChange={(e) => onPinChange(e.target.value)}
          maxLength={4}
          autoFocus
          inputMode="numeric"
          pattern="[0-9]*"
        />

        {error && (
          <div className={styles.irreversibleBox}>
            <p>{error}</p>
          </div>
        )}
      </div>
      <div className={styles.dialogFooter}>
        <button type="button" className={styles.cancelButton} onClick={onClose}>
          {t('cancel', { ns: 'common' })}
        </button>
        <button
          type="button"
          className={styles.continueButton}
          onClick={onConfirm}
          disabled={!pinMatches}
        >
          ⛔ {confirmButton}
        </button>
      </div>
    </>
  );
}

// ============================================================================
// Deleting State
// ============================================================================

interface DeletingStepProps {
  t: (key: string) => string;
  level: DeleteLevel;
}

function DeletingStep({ t, level }: DeletingStepProps) {
  const title = level === 1 ? t('delete_data_dialog_title') : t('delete_dialog_title');

  return (
    <>
      <div className={styles.dialogHeader}>
        ⏳ {title}
      </div>
      <div className={styles.dialogBody}>
        <div className={styles.deleting}>
          <div className={styles.deletingSpinner} />
          <p className={styles.deletingText}>
            {level === 1 ? t('delete_data_button') : t('delete_all_button')}...
          </p>
        </div>
      </div>
    </>
  );
}

export default DeleteAccountDialog;
