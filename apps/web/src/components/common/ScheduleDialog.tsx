/**
 * ScheduleDialog - Route-aware scheduling dialog
 * 
 * Used from CustomerDetail and RevisionDetail for:
 * - Selecting date and crew (posádka)
 * - Viewing slot suggestions with insertion costs
 * - Scheduling a visit/revision
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { SlotSuggestions, type SlotSuggestion } from '../planner/SlotSuggestions';
import styles from './ScheduleDialog.module.css';

export interface ScheduleTarget {
  id: string;
  name: string;
  customerName: string;
  lat: number;
  lng: number;
}

export interface Crew {
  id: string;
  name: string;
  licensePlate?: string;
}

interface ScheduleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  target: ScheduleTarget | null;
  crews: Crew[];
  onSchedule: (targetId: string, date: string, crewId: string, slot: SlotSuggestion) => Promise<void>;
  /** Optional function to fetch slot suggestions */
  onFetchSlots?: (targetId: string, date: string, crewId: string) => Promise<SlotSuggestion[]>;
  isSubmitting?: boolean;
}

// Generate next 7 days
function getNextDays(count: number = 7): { date: string; label: string }[] {
  const days = [];
  const today = new Date();
  const dayNames = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  
  for (let i = 0; i < count; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    
    const dayName = dayNames[date.getDay()];
    const dateStr = date.toISOString().split('T')[0];
    const label = i === 0 
      ? 'Dnes' 
      : i === 1 
        ? 'Zítra' 
        : `${dayName} ${date.getDate()}.${date.getMonth() + 1}`;
    
    days.push({ date: dateStr, label });
  }
  
  return days;
}

export function ScheduleDialog({
  isOpen,
  onClose,
  target,
  crews,
  onSchedule,
  onFetchSlots,
  isSubmitting = false,
}: ScheduleDialogProps) {
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedCrew, setSelectedCrew] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<SlotSuggestion | null>(null);
  const [slots, setSlots] = useState<SlotSuggestion[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableDays = useMemo(() => getNextDays(7), []);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedDate(availableDays[0]?.date || '');
      setSelectedCrew(crews[0]?.id || '');
      setSelectedSlot(null);
      setSlots([]);
      setError(null);
    }
  }, [isOpen, availableDays, crews]);

  // Fetch slots when date or crew changes
  useEffect(() => {
    if (!isOpen || !target || !selectedDate || !selectedCrew || !onFetchSlots) {
      return;
    }

    const fetchSlots = async () => {
      try {
        setIsLoadingSlots(true);
        setError(null);
        setSelectedSlot(null);
        const fetchedSlots = await onFetchSlots(target.id, selectedDate, selectedCrew);
        setSlots(fetchedSlots);
      } catch (err) {
        console.error('Failed to fetch slots:', err);
        setError('Nepodařilo se načíst dostupné termíny');
        setSlots([]);
      } finally {
        setIsLoadingSlots(false);
      }
    };

    fetchSlots();
  }, [isOpen, target, selectedDate, selectedCrew, onFetchSlots]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
      
      // Number keys to select slot
      if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1;
        if (slots[index] && slots[index].status !== 'conflict') {
          setSelectedSlot(slots[index]);
        }
      }
      
      // Enter to confirm
      if (e.key === 'Enter' && selectedSlot && !isSubmitting) {
        handleConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, slots, selectedSlot, isSubmitting, onClose]);

  const handleConfirm = useCallback(async () => {
    if (!target || !selectedSlot) return;

    try {
      setError(null);
      await onSchedule(target.id, selectedDate, selectedCrew, selectedSlot);
      onClose();
    } catch (err) {
      console.error('Failed to schedule:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se naplánovat');
    }
  }, [target, selectedDate, selectedCrew, selectedSlot, onSchedule, onClose]);

  if (!isOpen || !target) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className={styles.backdrop} 
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden="true"
      />
      
      {/* Dialog */}
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Naplánovat termín">
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <h2 className={styles.title}>Přidat do plánu</h2>
            <p className={styles.subtitle}>
              {target.name} • {target.customerName}
            </p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={isSubmitting}
          >
            ✕
          </button>
        </header>

        {/* Content */}
        <div className={styles.content}>
          {/* Date selection */}
          <section className={styles.section}>
            <label className={styles.label}>Den</label>
            <div className={styles.dateGrid}>
              {availableDays.map(({ date, label }) => (
                <button
                  key={date}
                  type="button"
                  className={`${styles.dateButton} ${selectedDate === date ? styles.selected : ''}`}
                  onClick={() => setSelectedDate(date)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* Crew selection */}
          <section className={styles.section}>
            <label className={styles.label}>Posádka</label>
            <div className={styles.crewGrid}>
              {crews.map((crew) => (
                <button
                  key={crew.id}
                  type="button"
                  className={`${styles.crewButton} ${selectedCrew === crew.id ? styles.selected : ''}`}
                  onClick={() => setSelectedCrew(crew.id)}
                >
                  <span className={styles.crewName}>{crew.name}</span>
                  {crew.licensePlate && (
                    <span className={styles.crewPlate}>{crew.licensePlate}</span>
                  )}
                </button>
              ))}
              {crews.length === 0 && (
                <p className={styles.noVehicles}>Žádné dostupné posádky</p>
              )}
            </div>
          </section>

          {/* Slot suggestions */}
          <section className={styles.section}>
            <label className={styles.label}>Dostupné termíny</label>
            {isLoadingSlots ? (
              <div className={styles.loading}>
                <div className={styles.spinner} />
                <span>Počítám optimální pozice...</span>
              </div>
            ) : error ? (
              <div className={styles.error}>{error}</div>
            ) : onFetchSlots ? (
              <SlotSuggestions
                slots={slots}
                selectedSlotId={selectedSlot?.id || null}
                onSelect={setSelectedSlot}
                maxVisible={5}
              />
            ) : (
              <p className={styles.hint}>Výběr termínu není k dispozici</p>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={onClose}
            disabled={isSubmitting}
          >
            Zrušit
          </button>
          <button
            type="button"
            className={styles.confirmButton}
            onClick={handleConfirm}
            disabled={!selectedSlot || isSubmitting}
          >
            {isSubmitting ? 'Ukládám...' : 'Naplánovat'}
          </button>
        </footer>
      </div>
    </>
  );
}
