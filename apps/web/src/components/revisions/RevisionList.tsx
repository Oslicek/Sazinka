import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Revision, RevisionDisplayStatus, RevisionResult } from '@shared/revision';
import { REVISION_STATUS_KEYS, REVISION_RESULT_KEYS } from '@shared/revision';
import type { DeviceType } from '@shared/device';
import { DEVICE_TYPE_KEYS } from '@shared/device';
import { listRevisions, deleteRevision, type ListRevisionsFilters } from '../../services/revisionService';
import { useNatsStore } from '../../stores/natsStore';
import { RevisionForm } from './RevisionForm';
import { CompleteRevisionDialog } from './CompleteRevisionDialog';
import styles from './RevisionList.module.css';

interface RevisionListProps {
  customerId?: string;
  deviceId?: string;
  onRevisionSelect?: (revision: Revision) => void;
}

export function RevisionList({ 
  customerId, 
  deviceId, 
  onRevisionSelect,
}: RevisionListProps) {
  const { t } = useTranslation('common');
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRevision, setEditingRevision] = useState<Revision | null>(null);
  const [completingRevision, setCompletingRevision] = useState<Revision | null>(null);
  const [deletingRevisionId, setDeletingRevisionId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  
  const isConnected = useNatsStore((s) => s.isConnected);

  const loadRevisions = useCallback(async () => {
    if (!isConnected) {
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      const filters: ListRevisionsFilters = {
        customerId,
        deviceId,
        status: statusFilter || undefined,
        limit: 50,
      };
      
      const response = await listRevisions(filters);
      setRevisions(response.items);
    } catch (err) {
      console.error('Failed to load revisions:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst revize');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, customerId, deviceId, statusFilter]);

  useEffect(() => {
    loadRevisions();
  }, [loadRevisions]);

  const handleAddClick = useCallback(() => {
    setEditingRevision(null);
    setShowForm(true);
  }, []);

  const handleEditClick = useCallback((revision: Revision) => {
    setEditingRevision(revision);
    setShowForm(true);
  }, []);

  const handleCompleteClick = useCallback((revision: Revision) => {
    setCompletingRevision(revision);
  }, []);

  const handleFormClose = useCallback(() => {
    setShowForm(false);
    setEditingRevision(null);
  }, []);

  const handleFormSuccess = useCallback(() => {
    setShowForm(false);
    setEditingRevision(null);
    loadRevisions();
  }, [loadRevisions]);

  const handleCompleteClose = useCallback(() => {
    setCompletingRevision(null);
  }, []);

  const handleCompleteSuccess = useCallback(() => {
    setCompletingRevision(null);
    loadRevisions();
  }, [loadRevisions]);

  const handleDeleteClick = useCallback(async (revision: Revision) => {
    if (!confirm('Opravdu chcete smazat tuto revizi?')) {
      return;
    }

    try {
      setDeletingRevisionId(revision.id);
      setError(null);
      await deleteRevision(revision.id);
      loadRevisions();
    } catch (err) {
      console.error('Failed to delete revision:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se smazat revizi');
    } finally {
      setDeletingRevisionId(null);
    }
  }, [loadRevisions]);

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('cs-CZ');
    } catch {
      return dateStr;
    }
  };

  const formatTime = (timeStr: string | undefined) => {
    if (!timeStr) return '';
    return timeStr.substring(0, 5); // HH:MM
  };

  const getStatusClass = (status: RevisionDisplayStatus) => {
    switch (status) {
      case 'overdue': return styles.statusOverdue;
      case 'due_soon': return styles.statusDueSoon;
      case 'scheduled': return styles.statusScheduled;
      case 'confirmed': return styles.statusConfirmed;
      case 'completed': return styles.statusCompleted;
      case 'cancelled': return styles.statusCancelled;
      default: return styles.statusUpcoming;
    }
  };

  const getResultClass = (result: RevisionResult | undefined) => {
    if (!result) return '';
    switch (result) {
      case 'passed': return styles.resultPassed;
      case 'failed': return styles.resultFailed;
      case 'conditional': return styles.resultConditional;
      default: return '';
    }
  };

  if (showForm) {
    return (
      <RevisionForm
        customerId={customerId}
        deviceId={deviceId}
        revision={editingRevision ?? undefined}
        onSuccess={handleFormSuccess}
        onCancel={handleFormClose}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>Revize</h3>
        <div className={styles.headerActions}>
          <select 
            className={styles.filterSelect}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">Všechny stavy</option>
            <option value="upcoming">Plánovaná</option>
            <option value="due_soon">Brzy</option>
            <option value="overdue">Po termínu</option>
            <option value="scheduled">Naplánováno</option>
            <option value="completed">Dokončeno</option>
          </select>
          {(customerId && deviceId) && (
            <button 
              className={styles.addButton} 
              onClick={handleAddClick}
              disabled={!isConnected}
            >
              + Nová revize
            </button>
          )}
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {isLoading ? (
        <div className={styles.loading}>Načítám revize...</div>
      ) : revisions.length === 0 ? (
        <div className={styles.empty}>
          <p>Žádné revize</p>
          <p className={styles.emptyHint}>
            {customerId && deviceId 
              ? 'Vytvořte první revizi pro toto zařízení.'
              : 'Žádné revize odpovídající filtrům.'}
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {revisions.map((revision) => (
            <div 
              key={revision.id} 
              className={styles.revisionCard}
              onClick={() => onRevisionSelect?.(revision)}
            >
              <div className={styles.revisionInfo}>
                <div className={styles.revisionHeader}>
                  <span className={`${styles.statusBadge} ${getStatusClass(revision.status as RevisionDisplayStatus)}`}>
                    {REVISION_STATUS_KEYS[revision.status as RevisionDisplayStatus] ? t(REVISION_STATUS_KEYS[revision.status as RevisionDisplayStatus]) : revision.status}
                  </span>
                  {revision.result && (
                    <span className={`${styles.resultBadge} ${getResultClass(revision.result as RevisionResult)}`}>
                      {REVISION_RESULT_KEYS[revision.result as RevisionResult] ? t(REVISION_RESULT_KEYS[revision.result as RevisionResult]) : revision.result}
                    </span>
                  )}
                </div>
                {revision.deviceType && (
                  <div className={styles.deviceInfo}>
                    <span className={styles.deviceType}>
                      {DEVICE_TYPE_KEYS[revision.deviceType as DeviceType] ? t(DEVICE_TYPE_KEYS[revision.deviceType as DeviceType]) : revision.deviceType}
                    </span>
                    {revision.deviceName && <span className={styles.deviceName}>{revision.deviceName}</span>}
                  </div>
                )}
                <div className={styles.revisionDates}>
                  <span className={styles.dueDate}>
                    Termín: <strong>{formatDate(revision.dueDate)}</strong>
                  </span>
                  {revision.scheduledDate && (
                    <span className={styles.scheduledDate}>
                      Naplánováno: {formatDate(revision.scheduledDate)}
                      {revision.scheduledTimeStart && (
                        <> {formatTime(revision.scheduledTimeStart ?? undefined)}-{formatTime(revision.scheduledTimeEnd ?? undefined)}</>
                      )}
                    </span>
                  )}
                </div>
                {revision.completedAt && (
                  <div className={styles.completedInfo}>
                    Dokončeno: {formatDate(revision.completedAt)}
                    {revision.durationMinutes && (
                      <> ({revision.durationMinutes} min)</>
                    )}
                  </div>
                )}
                {revision.findings && (
                  <div className={styles.findings}>
                    {revision.findings}
                  </div>
                )}
              </div>
              <div className={styles.revisionActions}>
                {revision.status !== 'completed' && revision.status !== 'cancelled' && (
                  <>
                    <button
                      className={styles.completeButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCompleteClick(revision);
                      }}
                      disabled={deletingRevisionId === revision.id}
                    >
                      Dokončit
                    </button>
                    <button
                      className={styles.editButton}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditClick(revision);
                      }}
                      disabled={deletingRevisionId === revision.id}
                    >
                      Upravit
                    </button>
                  </>
                )}
                <button
                  className={styles.deleteButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(revision);
                  }}
                  disabled={deletingRevisionId === revision.id}
                >
                  {deletingRevisionId === revision.id ? 'Mažu...' : 'Smazat'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {completingRevision && (
        <CompleteRevisionDialog
          revision={completingRevision}
          onSuccess={handleCompleteSuccess}
          onCancel={handleCompleteClose}
        />
      )}
    </div>
  );
}
