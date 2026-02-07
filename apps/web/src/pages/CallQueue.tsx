import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useNatsStore } from '../stores/natsStore';
import {
  getCallQueue,
  snoozeRevision,
  scheduleRevision,
  type CallQueueItem,
  type CallQueueRequest,
  type CallQueueResponse,
} from '../services/revisionService';
import {
  suggestSlots,
  formatSlotTime,
  type SuggestedSlot,
} from '../services/slotService';
import { getToken } from '@/utils/auth';
import styles from './CallQueue.module.css';

// Device type labels
const DEVICE_TYPE_LABELS: Record<string, string> = {
  gas_boiler: 'Plynový kotel',
  chimney: 'Komín',
  fireplace: 'Krb',
  stove: 'Kamna',
  heat_pump: 'Tepelné čerpadlo',
  other: 'Jiné',
};

// Priority labels and colors
const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  overdue: { label: 'Po termínu', color: '#ef4444' },
  due_this_week: { label: 'Tento týden', color: '#f97316' },
  due_soon: { label: 'Brzy', color: '#eab308' },
  upcoming: { label: 'Plánovaná', color: '#22c55e' },
};

export function CallQueue() {
  const navigate = useNavigate();
  const { isConnected } = useNatsStore();
  const [queue, setQueue] = useState<CallQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, overdueCount: 0, dueSoonCount: 0 });
  
  // Filters
  const [filters, setFilters] = useState<CallQueueRequest>({
    priorityFilter: 'all',
    limit: 50,
  });
  
  // Selected item for actions
  const [selectedItem, setSelectedItem] = useState<CallQueueItem | null>(null);
  const [showSnoozeModal, setShowSnoozeModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  
  // Snooze form
  const [snoozeDate, setSnoozeDate] = useState('');
  const [snoozeReason, setSnoozeReason] = useState('');
  
  // Schedule form
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTimeStart, setScheduleTimeStart] = useState('');
  const [scheduleTimeEnd, setScheduleTimeEnd] = useState('');
  const [scheduleDuration, setScheduleDuration] = useState(30);
  
  // Slot suggestions
  const [suggestedSlots, setSuggestedSlots] = useState<SuggestedSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const loadQueue = useCallback(async () => {
    if (!isConnected) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response: CallQueueResponse = await getCallQueue(filters);
      setQueue(response.items);
      setStats({
        total: response.total,
        overdueCount: response.overdueCount,
        dueSoonCount: response.dueSoonCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load call queue');
    } finally {
      setLoading(false);
    }
  }, [isConnected, filters]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleSnooze = async () => {
    if (!selectedItem || !snoozeDate) return;
    
    try {
      await snoozeRevision({
        id: selectedItem.id,
        snoozeUntil: snoozeDate,
        reason: snoozeReason || undefined,
      });
      setShowSnoozeModal(false);
      setSelectedItem(null);
      setSnoozeDate('');
      setSnoozeReason('');
      loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to snooze revision');
    }
  };

  const loadSlotSuggestions = useCallback(async (date: string) => {
    if (!selectedItem || !date) {
      setSuggestedSlots([]);
      return;
    }
    
    setLoadingSlots(true);
    try {
      const response = await suggestSlots({
        date,
        customerCoordinates: {
          lat: selectedItem.customerLat || 50.0,
          lng: selectedItem.customerLng || 14.4,
        },
        serviceDurationMinutes: scheduleDuration,
        maxSuggestions: 5,
      });
      setSuggestedSlots(response.slots);
    } catch (err) {
      console.error('Failed to load slot suggestions:', err);
      setSuggestedSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }, [selectedItem, scheduleDuration]);

  const handleSchedule = async () => {
    if (!selectedItem || !scheduleDate) return;
    
    try {
      await scheduleRevision({
        id: selectedItem.id,
        scheduledDate: scheduleDate,
        timeWindowStart: scheduleTimeStart || undefined,
        timeWindowEnd: scheduleTimeEnd || undefined,
        durationMinutes: scheduleDuration,
      });
      
      const scheduledDateValue = scheduleDate;
      
      setShowScheduleModal(false);
      setSelectedItem(null);
      setScheduleDate('');
      setScheduleTimeStart('');
      setScheduleTimeEnd('');
      setSuggestedSlots([]);
      
      // Navigate to planner for the scheduled date
      navigate({ to: '/planner', search: { date: scheduledDateValue } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule revision');
    }
  };

  const selectSlot = (slot: SuggestedSlot) => {
    setScheduleTimeStart(formatSlotTime(slot.startTime));
    setScheduleTimeEnd(formatSlotTime(slot.endTime));
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatPhone = (phone: string | null) => {
    if (!phone) return '-';
    // Simple formatting for Czech phone numbers
    return phone.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  };

  const openPhoneCall = (phone: string | null) => {
    if (phone) {
      window.open(`tel:${phone}`, '_self');
    }
  };

  const openEmailClient = (email: string | null, customerName: string) => {
    if (email) {
      const subject = encodeURIComponent(`Domluvení termínu revize - ${customerName}`);
      const body = encodeURIComponent(`Dobrý den,\n\nrádi bychom s Vámi domluvili termín revize.\n\nS pozdravem`);
      window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_self');
    }
  };

  if (!isConnected) {
    return (
      <div className={styles.container}>
        <div className={styles.disconnected}>
          <p>Připojování k serveru...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Fronta k obvolání</h1>
        <p className={styles.subtitle}>Zákazníci k telefonickému kontaktu</p>
      </header>

      {/* Stats */}
      <div className={styles.stats}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.total}</span>
          <span className={styles.statLabel}>Celkem</span>
        </div>
        <div className={`${styles.statCard} ${styles.statOverdue}`}>
          <span className={styles.statValue}>{stats.overdueCount}</span>
          <span className={styles.statLabel}>Po termínu</span>
        </div>
        <div className={`${styles.statCard} ${styles.statDueSoon}`}>
          <span className={styles.statValue}>{stats.dueSoonCount}</span>
          <span className={styles.statLabel}>Tento týden</span>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <select
          value={filters.priorityFilter || 'all'}
          onChange={(e) => setFilters({ ...filters, priorityFilter: e.target.value as CallQueueRequest['priorityFilter'] })}
          className={styles.filterSelect}
        >
          <option value="all">Všechny</option>
          <option value="overdue">Po termínu</option>
          <option value="due_soon">Tento týden</option>
          <option value="upcoming">Plánovaná</option>
        </select>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={filters.geocodedOnly || false}
            onChange={(e) => setFilters({ ...filters, geocodedOnly: e.target.checked })}
          />
          Jen s adresou
        </label>
        <button onClick={loadQueue} className={styles.refreshButton} disabled={loading}>
          {loading ? 'Načítání...' : 'Obnovit'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={() => setError(null)}>Zavřít</button>
        </div>
      )}

      {/* Queue List */}
      <div className={styles.queueList}>
        {queue.length === 0 && !loading && (
          <div className={styles.emptyState}>
            <p>Žádné revize k obvolání</p>
          </div>
        )}

        {queue.map((item) => (
          <div key={item.id} className={styles.queueItem}>
            <div className={styles.itemHeader}>
              <span
                className={styles.priorityBadge}
                style={{ backgroundColor: PRIORITY_CONFIG[item.priority]?.color || '#888' }}
              >
                {PRIORITY_CONFIG[item.priority]?.label || item.priority}
              </span>
              <span className={styles.daysUntilDue}>
                {item.daysUntilDue < 0
                  ? `${Math.abs(item.daysUntilDue)} dní po termínu`
                  : item.daysUntilDue === 0
                  ? 'Dnes'
                  : `za ${item.daysUntilDue} dní`}
              </span>
            </div>

            <div className={styles.itemContent}>
              <div className={styles.customerInfo}>
                <Link to="/revisions/$revisionId" params={{ revisionId: item.id }} className={styles.customerNameLink}>
                  <h3 className={styles.customerName}>{item.customerName}</h3>
                </Link>
                <p className={styles.customerAddress}>
                  {item.customerStreet}, {item.customerCity} {item.customerPostalCode}
                </p>
                {item.customerGeocodeStatus === 'failed' && (
                  <p className={styles.geocodeWarning}>
                    ⚠️ Adresu nelze geolokovat
                  </p>
                )}
                <p className={styles.deviceInfo}>
                  <span className={styles.deviceType}>
                    {DEVICE_TYPE_LABELS[item.deviceType] || item.deviceType}
                  </span>
                  {item.deviceName && <span className={styles.deviceName}>{item.deviceName}</span>}
                </p>
              </div>

              <div className={styles.contactInfo}>
                <button
                  className={styles.phoneButton}
                  onClick={() => openPhoneCall(item.customerPhone)}
                  disabled={!item.customerPhone}
                  title={item.customerPhone ? formatPhone(item.customerPhone) : 'Telefon není k dispozici'}
                >
                  📞 {formatPhone(item.customerPhone)}
                </button>
                {item.customerEmail && (
                  <button
                    className={styles.emailButton}
                    onClick={() => openEmailClient(item.customerEmail, item.customerName)}
                    title={item.customerEmail}
                  >
                    ✉️ Email
                  </button>
                )}
              </div>

              <div className={styles.itemMeta}>
                <p className={styles.dueDate}>Termín: {formatDate(item.dueDate)}</p>
                {item.lastContactAt && (
                  <p className={styles.lastContact}>
                    Poslední kontakt: {formatDate(item.lastContactAt)}
                  </p>
                )}
                {item.contactAttempts > 0 && (
                  <p className={styles.contactAttempts}>
                    Pokusů: {item.contactAttempts}
                  </p>
                )}
              </div>
            </div>

            <div className={styles.itemActions}>
              <button
                className={styles.actionButton}
                onClick={() => {
                  setSelectedItem(item);
                  setShowScheduleModal(true);
                }}
              >
                📅 Naplánovat
              </button>
              <button
                className={`${styles.actionButton} ${styles.snoozeButton}`}
                onClick={() => {
                  setSelectedItem(item);
                  setShowSnoozeModal(true);
                }}
              >
                ⏰ Odložit
              </button>
              <Link
                to="/revisions/$revisionId"
                params={{ revisionId: item.id }}
                className={`${styles.actionButton} ${styles.detailButton}`}
              >
                📋 Detail
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Snooze Modal */}
      {showSnoozeModal && selectedItem && (
        <div className={styles.modalOverlay} onClick={() => setShowSnoozeModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2>Odložit kontaktování</h2>
            <p className={styles.modalSubtitle}>{selectedItem.customerName}</p>

            <div className={styles.formGroup}>
              <label>Odložit do:</label>
              <input
                type="date"
                value={snoozeDate}
                onChange={(e) => setSnoozeDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div className={styles.formGroup}>
              <label>Důvod (volitelný):</label>
              <select value={snoozeReason} onChange={(e) => setSnoozeReason(e.target.value)}>
                <option value="">-- Vyberte --</option>
                <option value="customer_unavailable">Zákazník nedostupný</option>
                <option value="customer_on_vacation">Zákazník na dovolené</option>
                <option value="callback_requested">Zákazník si přeje zavolat později</option>
                <option value="no_answer">Nezvedá</option>
                <option value="other">Jiný důvod</option>
              </select>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.cancelButton} onClick={() => setShowSnoozeModal(false)}>
                Zrušit
              </button>
              <button
                className={styles.confirmButton}
                onClick={handleSnooze}
                disabled={!snoozeDate}
              >
                Odložit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && selectedItem && (
        <div className={styles.modalOverlay} onClick={() => setShowScheduleModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2>Naplánovat návštěvu</h2>
            <p className={styles.modalSubtitle}>{selectedItem.customerName}</p>
            {selectedItem.customerGeocodeStatus === 'failed' && (
              <div className={styles.modalWarning}>
                Adresu nelze geolokovat, je třeba ji upřesnit!
              </div>
            )}

            <div className={styles.formGroup}>
              <label>Datum:</label>
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => {
                  setScheduleDate(e.target.value);
                  loadSlotSuggestions(e.target.value);
                }}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Smart Slot Suggestions */}
            {scheduleDate && (
              <div className={styles.slotSuggestions}>
                <label>Doporučené sloty:</label>
                {loadingSlots ? (
                  <div className={styles.loadingSlots}>Načítám...</div>
                ) : suggestedSlots.length > 0 ? (
                  <div className={styles.slotList}>
                    {suggestedSlots.map((slot, index) => (
                      <button
                        key={index}
                        type="button"
                        className={styles.slotButton}
                        onClick={() => selectSlot(slot)}
                        title={slot.reason}
                      >
                        <span className={styles.slotTime}>
                          {formatSlotTime(slot.startTime)} - {formatSlotTime(slot.endTime)}
                        </span>
                        <span 
                          className={styles.slotScore}
                          style={{ 
                            color: slot.score >= 80 ? 'var(--color-success)' : 
                                   slot.score >= 60 ? 'var(--color-warning)' : 'var(--color-error)'
                          }}
                        >
                          {slot.score}%
                        </span>
                        {slot.deltaTravelMinutes > 0 && (
                          <span className={styles.slotDelta}>+{slot.deltaTravelMinutes}min</span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={styles.noSlots}>Žádné návrhy pro tento den</div>
                )}
              </div>
            )}

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>Časové okno od:</label>
                <input
                  type="time"
                  value={scheduleTimeStart}
                  onChange={(e) => setScheduleTimeStart(e.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label>do:</label>
                <input
                  type="time"
                  value={scheduleTimeEnd}
                  onChange={(e) => setScheduleTimeEnd(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label>Předpokládaná doba (min):</label>
              <select
                value={scheduleDuration}
                onChange={(e) => setScheduleDuration(Number(e.target.value))}
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
                <option value={120}>120 min</option>
              </select>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.cancelButton} onClick={() => setShowScheduleModal(false)}>
                Zrušit
              </button>
              <button
                className={styles.confirmButton}
                onClick={handleSchedule}
                disabled={!scheduleDate}
              >
                Naplánovat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
