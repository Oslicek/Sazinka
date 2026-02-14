import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  suggestSlotsV2,
  validateSlot,
  formatSlotTime,
  getStatusColor,
  groupSuggestionsByCrew,
  type CrewSlotSuggestion,
  type SlotWarning,
  type SuggestSlotsV2Response,
  type ValidateSlotResponse,
} from '../services/slotService';
import { listCrews, type Crew } from '../services/crewService';
import { getToken } from '@/utils/auth';
import { DEVICE_TYPE_KEYS } from '@shared/device';
import styles from './CallQueue.module.css';

// Priority colors (labels resolved via i18n)
const PRIORITY_COLORS: Record<string, string> = {
  overdue: '#ef4444',
  due_this_week: '#f97316',
  due_soon: '#eab308',
  upcoming: '#22c55e',
};

const PRIORITY_LABEL_KEYS: Record<string, string> = {
  overdue: 'callqueue_stat_overdue',
  due_this_week: 'callqueue_stat_due_soon',
  due_soon: 'callqueue_stat_due_soon',
  upcoming: 'callqueue_filter_upcoming',
};

export function CallQueue() {
  const { t } = useTranslation('pages');
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
  const [selectedCrewId, setSelectedCrewId] = useState<string>('');

  // Crews
  const [crews, setCrews] = useState<Crew[]>([]);

  // Slot suggestions (v2 — multi-crew)
  const [v2Response, setV2Response] = useState<SuggestSlotsV2Response | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  // Validation
  const [validation, setValidation] = useState<ValidateSlotResponse | null>(null);
  const [validating, setValidating] = useState(false);
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Confirmation warnings
  const [showWarningConfirm, setShowWarningConfirm] = useState(false);

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

  // Load crews once when connected
  useEffect(() => {
    if (!isConnected) return;
    listCrews(true).then(setCrews).catch(() => setCrews([]));
  }, [isConnected]);

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
      setV2Response(null);
      return;
    }

    setLoadingSlots(true);
    setValidation(null);
    try {
      const response = await suggestSlotsV2({
        date,
        customerId: selectedItem.customerId,
        serviceDurationMinutes: scheduleDuration,
        crewIds: selectedCrewId ? [selectedCrewId] : undefined,
        maxPerCrew: 3,
      });
      setV2Response(response);
    } catch (err) {
      console.error('Failed to load slot suggestions:', err);
      setV2Response(null);
    } finally {
      setLoadingSlots(false);
    }
  }, [selectedItem, scheduleDuration, selectedCrewId]);

  // Debounced validation when manually editing time inputs
  const triggerValidation = useCallback((crewId: string, timeStart: string, timeEnd: string) => {
    if (validateTimerRef.current) clearTimeout(validateTimerRef.current);
    if (!selectedItem || !scheduleDate || !crewId || !timeStart || !timeEnd) {
      setValidation(null);
      return;
    }
    setValidating(true);
    validateTimerRef.current = setTimeout(async () => {
      try {
        const result = await validateSlot({
          date: scheduleDate,
          customerId: selectedItem.customerId,
          crewId,
          timeStart,
          timeEnd,
        });
        setValidation(result);
      } catch {
        setValidation(null);
      } finally {
        setValidating(false);
      }
    }, 500);
  }, [selectedItem, scheduleDate]);

  const handleSchedule = async () => {
    if (!selectedItem || !scheduleDate) return;

    // If there are validation errors, show warning confirmation first
    if (validation && !validation.feasible && !showWarningConfirm) {
      setShowWarningConfirm(true);
      return;
    }

    try {
      await scheduleRevision({
        id: selectedItem.id,
        scheduledDate: scheduleDate,
        timeWindowStart: scheduleTimeStart || undefined,
        timeWindowEnd: scheduleTimeEnd || undefined,
        durationMinutes: scheduleDuration,
        assignedCrewId: selectedCrewId || undefined,
      });

      const scheduledDateValue = scheduleDate;

      setShowScheduleModal(false);
      setSelectedItem(null);
      setScheduleDate('');
      setScheduleTimeStart('');
      setScheduleTimeEnd('');
      setSelectedCrewId('');
      setV2Response(null);
      setValidation(null);
      setShowWarningConfirm(false);

      navigate({ to: '/planner', search: { date: scheduledDateValue } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule revision');
    }
  };

  const selectSlot = (slot: CrewSlotSuggestion) => {
    setScheduleTimeStart(formatSlotTime(slot.startTime));
    setScheduleTimeEnd(formatSlotTime(slot.endTime));
    setSelectedCrewId(slot.crewId);
    setValidation(null);
    setShowWarningConfirm(false);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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
      const subject = encodeURIComponent(t('callqueue_email_subject', { name: customerName }));
      const body = encodeURIComponent(t('callqueue_email_body'));
      window.open(`mailto:${email}?subject=${subject}&body=${body}`, '_self');
    }
  };

  if (!isConnected) {
    return (
      <div className={styles.container}>
        <div className={styles.disconnected}>
          <p>{t('callqueue_connecting')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{t('callqueue_title')}</h1>
        <p className={styles.subtitle}>{t('callqueue_subtitle')}</p>
      </header>

      {/* Stats */}
      <div className={styles.stats}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{stats.total}</span>
          <span className={styles.statLabel}>{t('callqueue_stat_total')}</span>
        </div>
        <div className={`${styles.statCard} ${styles.statOverdue}`}>
          <span className={styles.statValue}>{stats.overdueCount}</span>
          <span className={styles.statLabel}>{t('callqueue_stat_overdue')}</span>
        </div>
        <div className={`${styles.statCard} ${styles.statDueSoon}`}>
          <span className={styles.statValue}>{stats.dueSoonCount}</span>
          <span className={styles.statLabel}>{t('callqueue_stat_due_soon')}</span>
        </div>
      </div>

      {/* Filters */}
      <div className={styles.filters}>
        <select
          value={filters.priorityFilter || 'all'}
          onChange={(e) => setFilters({ ...filters, priorityFilter: e.target.value as CallQueueRequest['priorityFilter'] })}
          className={styles.filterSelect}
        >
          <option value="all">{t('callqueue_filter_all')}</option>
          <option value="overdue">{t('callqueue_filter_overdue')}</option>
          <option value="due_soon">{t('callqueue_filter_due_soon')}</option>
          <option value="upcoming">{t('callqueue_filter_upcoming')}</option>
        </select>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={filters.geocodedOnly || false}
            onChange={(e) => setFilters({ ...filters, geocodedOnly: e.target.checked })}
          />
          {t('callqueue_geocoded_only')}
        </label>
        <button onClick={loadQueue} className={styles.refreshButton} disabled={loading}>
          {loading ? t('callqueue_loading') : t('callqueue_refresh')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className={styles.error}>
          <p>{error}</p>
          <button onClick={() => setError(null)}>{t('common:close')}</button>
        </div>
      )}

      {/* Queue List */}
      <div className={styles.queueList}>
        {queue.length === 0 && !loading && (
          <div className={styles.emptyState}>
            <p>{t('callqueue_empty')}</p>
          </div>
        )}

        {queue.map((item) => (
          <div key={item.id} className={styles.queueItem}>
            <div className={styles.itemHeader}>
              <span
                className={styles.priorityBadge}
                style={{ backgroundColor: PRIORITY_COLORS[item.priority] || '#888' }}
              >
                {t(PRIORITY_LABEL_KEYS[item.priority] || item.priority)}
              </span>
              <span className={styles.daysUntilDue}>
                {item.daysUntilDue < 0
                  ? t('callqueue_days_overdue', { count: Math.abs(item.daysUntilDue) })
                  : item.daysUntilDue === 0
                  ? t('callqueue_days_today')
                  : t('callqueue_days_until', { count: item.daysUntilDue })}
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
                    {t('callqueue_geocode_warning_short')}
                  </p>
                )}
                <p className={styles.deviceInfo}>
                  <span className={styles.deviceType}>
                    {DEVICE_TYPE_KEYS[item.deviceType as keyof typeof DEVICE_TYPE_KEYS] ? t(DEVICE_TYPE_KEYS[item.deviceType as keyof typeof DEVICE_TYPE_KEYS]) : item.deviceType}
                  </span>
                  {item.deviceName && <span className={styles.deviceName}>{item.deviceName}</span>}
                </p>
              </div>

              <div className={styles.contactInfo}>
                <button
                  className={styles.phoneButton}
                  onClick={() => openPhoneCall(item.customerPhone)}
                  disabled={!item.customerPhone}
                  title={item.customerPhone ? formatPhone(item.customerPhone) : t('callqueue_phone_unavailable')}
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
                <p className={styles.dueDate}>{t('callqueue_due_date')} {formatDate(item.dueDate)}</p>
                {item.lastContactAt && (
                  <p className={styles.lastContact}>
                    {t('callqueue_last_contact')} {formatDate(item.lastContactAt)}
                  </p>
                )}
                {item.contactAttempts > 0 && (
                  <p className={styles.contactAttempts}>
                    {t('callqueue_attempts')} {item.contactAttempts}
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
                {t('callqueue_schedule')}
              </button>
              <button
                className={`${styles.actionButton} ${styles.snoozeButton}`}
                onClick={() => {
                  setSelectedItem(item);
                  setShowSnoozeModal(true);
                }}
              >
                {t('callqueue_snooze')}
              </button>
              <Link
                to="/revisions/$revisionId"
                params={{ revisionId: item.id }}
                className={`${styles.actionButton} ${styles.detailButton}`}
              >
                {t('callqueue_detail')}
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Snooze Modal */}
      {showSnoozeModal && selectedItem && (
        <div className={styles.modalOverlay} onClick={() => setShowSnoozeModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2>{t('callqueue_snooze_title')}</h2>
            <p className={styles.modalSubtitle}>{selectedItem.customerName}</p>

            <div className={styles.formGroup}>
              <label>{t('callqueue_snooze_until')}</label>
              <input
                type="date"
                value={snoozeDate}
                onChange={(e) => setSnoozeDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div className={styles.formGroup}>
              <label>{t('callqueue_snooze_reason')}</label>
              <select value={snoozeReason} onChange={(e) => setSnoozeReason(e.target.value)}>
                <option value="">{t('callqueue_snooze_select')}</option>
                <option value="customer_unavailable">{t('callqueue_snooze_unavailable')}</option>
                <option value="customer_on_vacation">{t('callqueue_snooze_vacation')}</option>
                <option value="callback_requested">{t('callqueue_snooze_callback')}</option>
                <option value="no_answer">{t('callqueue_snooze_no_answer')}</option>
                <option value="other">{t('callqueue_snooze_other')}</option>
              </select>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.cancelButton} onClick={() => setShowSnoozeModal(false)}>
                {t('common:cancel')}
              </button>
              <button
                className={styles.confirmButton}
                onClick={handleSnooze}
                disabled={!snoozeDate}
              >
                {t('callqueue_snooze')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Modal */}
      {showScheduleModal && selectedItem && (
        <div className={styles.modalOverlay} onClick={() => setShowScheduleModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2>{t('callqueue_schedule_title')}</h2>
            <p className={styles.modalSubtitle}>{selectedItem.customerName}</p>
            {selectedItem.customerGeocodeStatus === 'failed' && (
              <div className={styles.modalWarning}>
                {t('callqueue_geocode_warning')}
              </div>
            )}

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>{t('callqueue_date')}</label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => {
                    setScheduleDate(e.target.value);
                    setValidation(null);
                    setShowWarningConfirm(false);
                    loadSlotSuggestions(e.target.value);
                  }}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div className={styles.formGroup}>
                <label>{t('callqueue_crew')}</label>
                <select
                  value={selectedCrewId}
                  onChange={(e) => {
                    setSelectedCrewId(e.target.value);
                    setValidation(null);
                    setShowWarningConfirm(false);
                    if (scheduleDate) loadSlotSuggestions(scheduleDate);
                  }}
                >
                  <option value="">{t('callqueue_all_crews')}</option>
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Smart Slot Suggestions — grouped by crew */}
            {scheduleDate && (
              <div className={styles.slotSuggestions}>
                <label>{t('callqueue_suggested_slots')}</label>
                {loadingSlots ? (
                  <div className={styles.loadingSlots}>{t('callqueue_loading_slots')}</div>
                ) : v2Response && v2Response.suggestions.length > 0 ? (
                  <div className={styles.crewSlotGroups}>
                    {Array.from(groupSuggestionsByCrew(v2Response.suggestions)).map(([crewId, group]) => (
                      <div key={crewId} className={styles.crewGroup}>
                        <div className={styles.crewGroupHeader}>
                          <span className={styles.crewGroupName}>{group.crewName}</span>
                          <span className={styles.crewGroupLoad}>{group.dayLoadPercent}% dne</span>
                        </div>
                        <div className={styles.slotList}>
                          {group.suggestions.map((slot, index) => (
                            <button
                              key={index}
                              type="button"
                              className={`${styles.slotButton} ${
                                selectedCrewId === slot.crewId &&
                                scheduleTimeStart === formatSlotTime(slot.startTime) &&
                                scheduleTimeEnd === formatSlotTime(slot.endTime)
                                  ? styles.slotButtonSelected
                                  : ''
                              }`}
                              onClick={() => selectSlot(slot)}
                              title={slot.reason}
                            >
                              <span className={styles.slotTime}>
                                {formatSlotTime(slot.startTime)} - {formatSlotTime(slot.endTime)}
                              </span>
                              <span
                                className={styles.slotScore}
                                style={{ color: getStatusColor(slot.status) }}
                              >
                                {slot.score}%
                              </span>
                              <span
                                className={styles.slotStatusBadge}
                                style={{ backgroundColor: getStatusColor(slot.status) }}
                              >
                                {slot.status === 'ok' ? 'OK' : slot.status === 'tight' ? t('callqueue_slot_tight') : t('callqueue_slot_conflict')}
                              </span>
                              {slot.deltaTravelMinutes > 0 && (
                                <span className={styles.slotDelta}>+{slot.deltaTravelMinutes}min</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.noSlots}>{t('callqueue_no_slots')}</div>
                )}
                {/* Global warnings from v2 */}
                {v2Response && v2Response.warnings.length > 0 && (
                  <div className={styles.slotWarnings}>
                    {v2Response.warnings.map((w, i) => (
                      <div key={i} className={`${styles.warningItem} ${w.severity === 'error' ? styles.warningError : styles.warningWarn}`}>
                        {w.severity === 'error' ? '❌' : '⚠️'} {w.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label>{t('callqueue_time_from')}</label>
                <input
                  type="time"
                  value={scheduleTimeStart}
                  className={validation && !validation.feasible ? styles.inputError : ''}
                  onChange={(e) => {
                    setScheduleTimeStart(e.target.value);
                    setShowWarningConfirm(false);
                    triggerValidation(selectedCrewId, e.target.value, scheduleTimeEnd);
                  }}
                />
              </div>
              <div className={styles.formGroup}>
                <label>{t('callqueue_time_to')}</label>
                <input
                  type="time"
                  value={scheduleTimeEnd}
                  className={validation && !validation.feasible ? styles.inputError : ''}
                  onChange={(e) => {
                    setScheduleTimeEnd(e.target.value);
                    setShowWarningConfirm(false);
                    triggerValidation(selectedCrewId, scheduleTimeStart, e.target.value);
                  }}
                />
              </div>
            </div>

            {/* Validation result */}
            {validating && <div className={styles.loadingSlots}>{t('callqueue_validating')}</div>}
            {validation && validation.warnings.length > 0 && (
              <div className={styles.validationWarnings}>
                {validation.warnings.map((w, i) => (
                  <div key={i} className={`${styles.warningItem} ${w.severity === 'error' ? styles.warningError : styles.warningWarn}`}>
                    {w.severity === 'error' ? '❌' : '⚠️'} {w.message}
                    {w.conflictingCustomer && <span className={styles.conflictName}> ({w.conflictingCustomer})</span>}
                  </div>
                ))}
                {validation.estimatedArrival && (
                  <div className={styles.validationMeta}>
                    {t('callqueue_estimated_arrival')} {formatSlotTime(validation.estimatedArrival)}
                    {validation.slackBeforeMinutes != null && ` | ${t('callqueue_slack_before')} ${validation.slackBeforeMinutes} min`}
                    {validation.slackAfterMinutes != null && ` | ${t('callqueue_slack_after')} ${validation.slackAfterMinutes} min`}
                  </div>
                )}
              </div>
            )}

            <div className={styles.formGroup}>
              <label>{t('callqueue_expected_duration')}</label>
              <select
                value={scheduleDuration}
                onChange={(e) => {
                  setScheduleDuration(Number(e.target.value));
                  if (scheduleDate) loadSlotSuggestions(scheduleDate);
                }}
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
                <option value={120}>120 min</option>
              </select>
            </div>

            {/* Warning confirmation */}
            {showWarningConfirm && validation && !validation.feasible && (
              <div className={styles.warningConfirmBox}>
                <p>{t('callqueue_warning_conflicts')}</p>
                <div className={styles.warningConfirmActions}>
                  <button
                    className={styles.warningConfirmBtn}
                    onClick={() => {
                      setShowWarningConfirm(false);
                      // Force schedule despite warnings
                      (async () => {
                        try {
                          await scheduleRevision({
                            id: selectedItem.id,
                            scheduledDate: scheduleDate,
                            timeWindowStart: scheduleTimeStart || undefined,
                            timeWindowEnd: scheduleTimeEnd || undefined,
                            durationMinutes: scheduleDuration,
                            assignedCrewId: selectedCrewId || undefined,
                          });
                          const d = scheduleDate;
                          setShowScheduleModal(false);
                          setSelectedItem(null);
                          setScheduleDate('');
                          setScheduleTimeStart('');
                          setScheduleTimeEnd('');
                          setSelectedCrewId('');
                          setV2Response(null);
                          setValidation(null);
                          setShowWarningConfirm(false);
                          navigate({ to: '/planner', search: { date: d } });
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to schedule revision');
                        }
                      })();
                    }}
                  >
                    {t('callqueue_force_schedule')}
                  </button>
                  <button
                    className={styles.cancelButton}
                    onClick={() => setShowWarningConfirm(false)}
                  >
                    {t('callqueue_pick_other')}
                  </button>
                </div>
              </div>
            )}

            <div className={styles.modalActions}>
              <button className={styles.cancelButton} onClick={() => {
                setShowScheduleModal(false);
                setShowWarningConfirm(false);
                setValidation(null);
                setV2Response(null);
              }}>
                {t('common:cancel')}
              </button>
              <button
                className={styles.confirmButton}
                onClick={handleSchedule}
                disabled={!scheduleDate}
              >
                {t('callqueue_schedule_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
