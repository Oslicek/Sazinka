/**
 * AddFromInboxDrawer - Drawer for adding candidates from inbox to the plan
 * 
 * Features:
 * - List of inbox candidates filtered for best fit
 * - Slot suggestions for selected candidate
 * - Add to route action
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { InboxCandidate } from '../../types';
import { formatDate } from '../../i18n/formatters';
import { SlotSuggestions, type SlotSuggestion } from './SlotSuggestions';
import styles from './AddFromInboxDrawer.module.css';

interface AddFromInboxDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  candidates: InboxCandidate[];
  selectedDate: string;
  crewId?: string;
  onAddToRoute: (candidateId: string, slot: SlotSuggestion) => Promise<void>;
  onFetchSlots?: (candidateId: string) => Promise<SlotSuggestion[]>;
  isLoading?: boolean;
}

export function AddFromInboxDrawer({
  isOpen,
  onClose,
  candidates,
  selectedDate,
  crewId,
  onAddToRoute,
  onFetchSlots,
  isLoading = false,
}: AddFromInboxDrawerProps) {
  const { t } = useTranslation('planner');
  const [selectedCandidate, setSelectedCandidate] = useState<InboxCandidate | null>(null);
  const [slots, setSlots] = useState<SlotSuggestion[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotSuggestion | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when drawer opens
  useEffect(() => {
    if (isOpen) {
      setSelectedCandidate(null);
      setSlots([]);
      setSelectedSlot(null);
      setError(null);
    }
  }, [isOpen]);

  // Fetch slots when candidate is selected
  useEffect(() => {
    if (!selectedCandidate || !onFetchSlots) return;

    const fetchSlots = async () => {
      setLoadingSlots(true);
      setError(null);
      try {
        const fetchedSlots = await onFetchSlots(selectedCandidate.id);
        setSlots(fetchedSlots);
      } catch (err) {
        console.error('Failed to fetch slots:', err);
        setError(t('add_drawer_fetch_error'));
        setSlots([]);
      } finally {
        setLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [selectedCandidate, onFetchSlots, t]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAddToRoute = useCallback(async () => {
    if (!selectedCandidate || !selectedSlot) return;

    setIsAdding(true);
    setError(null);
    try {
      await onAddToRoute(selectedCandidate.id, selectedSlot);
      // Reset selection after successful add
      setSelectedCandidate(null);
      setSlots([]);
      setSelectedSlot(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('add_drawer_add_error'));
    } finally {
      setIsAdding(false);
    }
  }, [selectedCandidate, selectedSlot, onAddToRoute, t]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      
      {/* Drawer */}
      <aside className={styles.drawer} role="dialog" aria-modal="true">
        {/* Header */}
        <header className={styles.header}>
          <h2 className={styles.title}>{t('add_drawer_title')}</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        {/* Content */}
        <div className={styles.content}>
          {/* Date info */}
          <div className={styles.dateInfo}>
            <span className={styles.dateLabel}>{t('add_drawer_plan_for')}</span>
            <span className={styles.dateValue}>{formatDate(selectedDate, 'short')}</span>
          </div>

          {/* Candidate list */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>
              {t('add_drawer_candidates', { count: candidates.length })}
            </h3>
            
            {isLoading ? (
              <div className={styles.loading}>{t('add_drawer_loading')}</div>
            ) : candidates.length === 0 ? (
              <div className={styles.empty}>{t('add_drawer_empty')}</div>
            ) : (
              <ul className={styles.candidateList}>
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className={`${styles.candidateItem} ${selectedCandidate?.id === candidate.id ? styles.selected : ''}`}
                      onClick={() => {
                        setSelectedCandidate(candidate);
                        setSelectedSlot(null);
                      }}
                    >
                      <div className={styles.candidateMain}>
                        <span className={styles.candidateName}>
                          {candidate.customerName}
                        </span>
                        <span className={styles.candidateDevice}>
                          {candidate.deviceName || candidate.deviceType}
                        </span>
                      </div>
                      <div className={styles.candidateMeta}>
                        <span className={styles.dueDate}>
                          {t('add_drawer_due')} {formatDate(candidate.dueDate, 'short')}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Slot selection (when candidate is selected) */}
          {selectedCandidate && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>{t('add_drawer_select_slot')}</h3>
              
              {loadingSlots ? (
                <div className={styles.loading}>
                  <div className={styles.spinner} />
                  <span>{t('add_drawer_calculating')}</span>
                </div>
              ) : error ? (
                <div className={styles.error}>{error}</div>
              ) : (
                <SlotSuggestions
                  slots={slots}
                  selectedSlotId={selectedSlot?.id || null}
                  onSelect={setSelectedSlot}
                  maxVisible={5}
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.addButton}
            onClick={handleAddToRoute}
            disabled={!selectedCandidate || !selectedSlot || isAdding}
          >
            {isAdding ? t('add_drawer_adding') : t('add_drawer_add_button')}
          </button>
        </footer>
      </aside>
    </>
  );
}
