import styles from './SlotSuggestions.module.css';

export type SlotStatus = 'ok' | 'tight' | 'conflict';

export interface SlotSuggestion {
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  status: SlotStatus;
  deltaKm: number;
  deltaMin: number;
  insertAfterIndex: number;
  insertBeforeName?: string;
  insertAfterName?: string;
}

interface SlotSuggestionsProps {
  slots: SlotSuggestion[];
  selectedSlotId?: string | null;
  onSelect?: (slot: SlotSuggestion) => void;
  maxVisible?: number;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const days = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
  const day = days[date.getDay()];
  return `${day} ${date.getDate()}.${date.getMonth() + 1}`;
}

function getStatusIcon(status: SlotStatus): string {
  switch (status) {
    case 'ok': return '✅';
    case 'tight': return '⚠️';
    case 'conflict': return '❌';
  }
}

function formatDelta(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(0)}`;
}

export function SlotSuggestions({
  slots,
  selectedSlotId,
  onSelect,
  maxVisible = 5,
}: SlotSuggestionsProps) {
  const visibleSlots = slots.slice(0, maxVisible);
  const hasMore = slots.length > maxVisible;

  if (visibleSlots.length === 0) {
    return (
      <div className={styles.empty}>
        Žádné dostupné sloty pro tento den/auto.
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {visibleSlots.map((slot, index) => (
          <button
            key={slot.id}
            type="button"
            className={`${styles.slot} ${styles[slot.status]} ${selectedSlotId === slot.id ? styles.selected : ''}`}
            onClick={() => onSelect?.(slot)}
            disabled={slot.status === 'conflict'}
            title={
              slot.status === 'conflict' 
                ? 'Nelze vložit - časový konflikt' 
                : `Vloží se za ${slot.insertAfterName || 'depo'}`
            }
          >
            <div className={styles.slotMain}>
              <span className={styles.keyHint}>{index + 1}</span>
              <span className={styles.date}>{formatDate(slot.date)}</span>
              <span className={styles.time}>{slot.timeStart}–{slot.timeEnd}</span>
              <span className={styles.statusIcon}>{getStatusIcon(slot.status)}</span>
            </div>
            <div className={styles.slotMeta}>
              <span className={styles.delta}>
                {formatDelta(slot.deltaMin)}min / {formatDelta(slot.deltaKm)}km
              </span>
            </div>
          </button>
        ))}
      </div>

      {hasMore && (
        <button type="button" className={styles.showMore}>
          Zobrazit dalších {slots.length - maxVisible} slotů
        </button>
      )}
    </div>
  );
}
