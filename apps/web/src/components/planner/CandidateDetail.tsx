import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { SlotSuggestions, type SlotSuggestion } from './SlotSuggestions';
import { InsertionPreview, type InsertionInfo } from './InsertionPreview';
import styles from './CandidateDetail.module.css';

export interface CandidateDetailData {
  id: string;
  customerId: string;
  customerName: string;
  deviceType: string;
  deviceName?: string;
  phone?: string;
  email?: string;
  street: string;
  city: string;
  postalCode?: string;
  notes?: string;
  dueDate: string;
  daysUntilDue: number;
  priority: 'overdue' | 'due_this_week' | 'due_soon' | 'upcoming';
  // Route-aware data
  suggestedSlots?: SlotSuggestion[];
  insertionInfo?: InsertionInfo;
  // State flags
  isScheduled?: boolean;
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
}

export type SnoozeDuration = 1 | 7 | 14 | 30;

interface CandidateDetailProps {
  candidate: CandidateDetailData | null;
  isRouteAware?: boolean;
  onSchedule?: (candidateId: string, slot: SlotSuggestion) => void;
  onSnooze?: (candidateId: string, days: SnoozeDuration) => void;
  onFixAddress?: (candidateId: string) => void;
  isLoading?: boolean;
  /** Add candidate to the route */
  onAddToRoute?: (candidateId: string) => void;
  /** Remove candidate from the route */
  onRemoveFromRoute?: (candidateId: string) => void;
  /** Whether this candidate is already in the route */
  isInRoute?: boolean;
  /** Currently selected route date (for pre-filling the scheduling form) */
  routeDate?: string;
  /** Default service duration in minutes from settings (for auto-filling "Do" time) */
  defaultServiceDurationMinutes?: number;
}

export function CandidateDetail({
  candidate,
  isRouteAware = true,
  onSchedule,
  onSnooze,
  onFixAddress,
  isLoading,
  onAddToRoute,
  onRemoveFromRoute,
  isInRoute = false,
  routeDate,
  defaultServiceDurationMinutes = 30,
}: CandidateDetailProps) {
  // Inline scheduling form state
  const [isScheduling, setIsScheduling] = useState(false);
  const [schedDate, setSchedDate] = useState('');
  const [schedTimeStart, setSchedTimeStart] = useState('08:00');
  const [schedTimeEnd, setSchedTimeEnd] = useState('12:00');
  const [schedNotes, setSchedNotes] = useState('');
  
  // Snooze dropdown state
  const [showSnoozeDropdown, setShowSnoozeDropdown] = useState(false);
  const [defaultSnoozeDays, setDefaultSnoozeDays] = useState<SnoozeDuration>(() => {
    const saved = localStorage.getItem('sazinka.snooze.defaultDays');
    return (saved ? parseInt(saved) : 7) as SnoozeDuration;
  });

  // Helper: add minutes to time string "HH:MM" → "HH:MM"
  const addMinutesToTime = (time: string, minutes: number): string => {
    const [h, m] = time.split(':').map(Number);
    const totalMin = h * 60 + m + minutes;
    const newH = Math.floor(totalMin / 60) % 24;
    const newM = totalMin % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  };

  // Reset scheduling form when candidate changes
  useEffect(() => {
    setIsScheduling(false);
    setSchedDate(routeDate ?? new Date().toISOString().split('T')[0]);
    setSchedTimeStart('08:00');
    setSchedTimeEnd(addMinutesToTime('08:00', defaultServiceDurationMinutes));
    setSchedNotes('');
    setShowSnoozeDropdown(false);
  }, [candidate?.id, routeDate, defaultServiceDurationMinutes]);
  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Načítám...</span>
        </div>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>👆</span>
          <p>Vyberte kandidáta ze seznamu</p>
          <p className={styles.emptyHint}>
            Použijte klávesy ↑↓ pro navigaci
          </p>
        </div>
      </div>
    );
  }

  const daysOverdue = candidate.daysUntilDue < 0 ? Math.abs(candidate.daysUntilDue) : 0;
  const dueDateFormatted = new Date(candidate.dueDate).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });

  const handleSnoozeSelect = (days: SnoozeDuration) => {
    setDefaultSnoozeDays(days);
    localStorage.setItem('sazinka.snooze.defaultDays', days.toString());
    setShowSnoozeDropdown(false);
    onSnooze?.(candidate.id, days);
  };

  const getSnoozeDurationLabel = (days: SnoozeDuration): string => {
    switch (days) {
      case 1: return 'o den';
      case 7: return 'o týden';
      case 14: return 'o 2 týdny';
      case 30: return 'o měsíc';
    }
  };

  return (
    <div className={styles.container}>
      {/* State Flags */}
      <div className={styles.stateFlags} data-testid="state-flags">
        <div className={`${styles.stateFlag} ${candidate.isScheduled ? styles.stateFlagYes : styles.stateFlagNo}`}>
          <span className={styles.stateFlagLabel}>Termín:</span>
          <span className={styles.stateFlagValue}>{candidate.isScheduled ? 'Ano' : 'Ne'}</span>
        </div>
        <div className={`${styles.stateFlag} ${isInRoute ? styles.stateFlagYes : styles.stateFlagNo}`}>
          <span className={styles.stateFlagLabel}>V trase:</span>
          <span className={styles.stateFlagValue}>{isInRoute ? 'Ano' : 'Ne'}</span>
        </div>
      </div>

      {/* Actions - moved to top */}
      {!isScheduling && (
        <div className={styles.actions} data-testid="candidate-actions">
          {candidate.suggestedSlots?.length ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => {
                onSchedule?.(candidate.id, candidate.suggestedSlots![0]);
              }}
            >
              📅 {candidate.isScheduled ? 'Změnit termín' : 'Domluvit termín'}
            </button>
          ) : (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setIsScheduling(true)}
            >
              📅 {candidate.isScheduled ? 'Změnit termín' : 'Domluvit termín'}
            </button>
          )}
          {isInRoute ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onRemoveFromRoute?.(candidate.id)}
            >
              ✕ Odebrat z trasy
            </button>
          ) : (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => onAddToRoute?.(candidate.id)}
            >
              ➕ Přidat do trasy
            </button>
          )}
          <div className={styles.snoozeButtonWrapper}>
            <button
              type="button"
              className={styles.snoozePrimaryButton}
              onClick={() => handleSnoozeSelect(defaultSnoozeDays)}
              title={`Odložit ${getSnoozeDurationLabel(defaultSnoozeDays)}`}
            >
              ⏰ Odložit {getSnoozeDurationLabel(defaultSnoozeDays)}
            </button>
            <button
              type="button"
              className={styles.snoozeDropdownToggle}
              onClick={() => setShowSnoozeDropdown(!showSnoozeDropdown)}
              aria-haspopup="true"
              aria-expanded={showSnoozeDropdown}
              title="Zobrazit další možnosti"
            >
              ▼
            </button>
            {showSnoozeDropdown && (
              <div className={styles.snoozeDropdown}>
                <button
                  type="button"
                  className={styles.snoozeOption}
                  onClick={() => handleSnoozeSelect(1)}
                >
                  Odložit o den
                </button>
                <button
                  type="button"
                  className={styles.snoozeOption}
                  onClick={() => handleSnoozeSelect(7)}
                >
                  Odložit o týden
                </button>
                <button
                  type="button"
                  className={styles.snoozeOption}
                  onClick={() => handleSnoozeSelect(14)}
                >
                  Odložit o 2 týdny
                </button>
                <button
                  type="button"
                  className={styles.snoozeOption}
                  onClick={() => handleSnoozeSelect(30)}
                >
                  Odložit o měsíc
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className={styles.header} data-testid="candidate-header">
        <h3 className={styles.name}>{candidate.customerName}</h3>
        <div className={styles.badges}>
          <span className={styles.deviceBadge}>{candidate.deviceType}</span>
          {candidate.priority === 'overdue' && (
            <span className={styles.overdueBadge}>+{daysOverdue}d po termínu</span>
          )}
        </div>
      </div>

      {/* Contact section */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Kontakt</h4>
        
        {candidate.phone ? (
          <a href={`tel:${candidate.phone}`} className={styles.phoneLink}>
            📞 {candidate.phone}
          </a>
        ) : (
          <span className={styles.missingInfo}>📵 Chybí telefon</span>
        )}

        {candidate.email ? (
          <a href={`mailto:${candidate.email}`} className={styles.emailLink}>
            ✉️ {candidate.email}
          </a>
        ) : (
          <span className={styles.missingInfo}>✉️ Chybí email</span>
        )}
      </section>

      {/* Address section */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Adresa</h4>
        <p className={styles.address}>{candidate.street}</p>
        <p className={styles.address}>
          {candidate.postalCode && `${candidate.postalCode} `}{candidate.city}
        </p>
        {onFixAddress && (
          <button
            type="button"
            className={styles.fixAddressButton}
            onClick={() => onFixAddress(candidate.id)}
          >
            Opravit adresu
          </button>
        )}
      </section>

      {/* Scheduled appointment section */}
      {candidate.isScheduled && candidate.scheduledDate && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Domluvený termín</h4>
          <p className={styles.scheduledAppointment}>
            📅 {new Date(candidate.scheduledDate).toLocaleDateString('cs-CZ', {
              day: 'numeric',
              month: 'numeric',
              year: 'numeric',
            })}
            {candidate.scheduledTimeStart && candidate.scheduledTimeEnd && (
              <span className={styles.scheduledTime}>
                {' '}🕐 {candidate.scheduledTimeStart.substring(0, 5)} – {candidate.scheduledTimeEnd.substring(0, 5)}
              </span>
            )}
          </p>
        </section>
      )}

      {/* Due date section */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>Revize nejpozději</h4>
        <p className={styles.dueDate}>
          <span className={candidate.priority === 'overdue' ? styles.overdueText : ''}>
            {dueDateFormatted}
          </span>
          {candidate.daysUntilDue > 0 && (
            <span className={styles.daysRemaining}>
              (za {candidate.daysUntilDue} dní)
            </span>
          )}
        </p>
      </section>

      {/* Slot suggestions (route-aware) */}
      {isRouteAware && candidate.suggestedSlots && candidate.suggestedSlots.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Doporučené sloty</h4>
          <SlotSuggestions
            slots={candidate.suggestedSlots}
            onSelect={(slot) => onSchedule?.(candidate.id, slot)}
          />
        </section>
      )}

      {/* Insertion preview (route-aware) */}
      {isRouteAware && candidate.insertionInfo && (
        <section className={styles.section}>
          <InsertionPreview info={candidate.insertionInfo} />
        </section>
      )}


      {/* Notes */}
      {candidate.notes && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Poznámky</h4>
          <p className={styles.notes}>{candidate.notes}</p>
        </section>
      )}

      {/* Inline scheduling form */}
      {isScheduling && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Naplánovat termín</h4>
          <div className={styles.scheduleForm}>
            <label className={styles.scheduleLabel}>
              Datum
              <input
                type="date"
                className={styles.scheduleInput}
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
              />
            </label>
            <div className={styles.scheduleRow}>
              <label className={styles.scheduleLabel}>
                Od
                <input
                  type="time"
                  className={styles.scheduleInput}
                  value={schedTimeStart}
                  onChange={(e) => {
                    const newStart = e.target.value;
                    setSchedTimeStart(newStart);
                    if (newStart) {
                      setSchedTimeEnd(addMinutesToTime(newStart, defaultServiceDurationMinutes));
                    }
                  }}
                />
              </label>
              <label className={styles.scheduleLabel}>
                Do
                <input
                  type="time"
                  className={styles.scheduleInput}
                  value={schedTimeEnd}
                  onChange={(e) => setSchedTimeEnd(e.target.value)}
                />
              </label>
            </div>
            <label className={styles.scheduleLabel}>
              Poznámka
              <input
                type="text"
                className={styles.scheduleInput}
                placeholder="Volitelná poznámka"
                value={schedNotes}
                onChange={(e) => setSchedNotes(e.target.value)}
              />
            </label>
            <div className={styles.scheduleActions}>
              <button
                type="button"
                className="btn-primary"
                disabled={!schedDate}
                onClick={() => {
                  const slot: SlotSuggestion = {
                    id: `manual-${Date.now()}`,
                    date: schedDate,
                    timeStart: schedTimeStart,
                    timeEnd: schedTimeEnd,
                    status: 'ok',
                    deltaKm: 0,
                    deltaMin: 0,
                    insertAfterIndex: -1,
                  };
                  onSchedule?.(candidate.id, slot);
                  setIsScheduling(false);
                }}
              >
                Potvrdit
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsScheduling(false)}
              >
                Zrušit
              </button>
            </div>
          </div>
        </section>
      )}


      {/* Links */}
      <div className={styles.links}>
        <Link
          to="/customers/$customerId"
          params={{ customerId: candidate.customerId }}
          className={styles.link}
        >
          Zobrazit detail zákazníka →
        </Link>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className={styles.shortcuts}>
        <span><kbd>D</kbd> Domluvit</span>
        <span><kbd>O</kbd> Odložit</span>
        <span><kbd>1-5</kbd> Vybrat slot</span>
      </div>
    </div>
  );
}
