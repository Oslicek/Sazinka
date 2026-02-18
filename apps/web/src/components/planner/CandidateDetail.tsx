import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/i18n/formatters';
import { listDevices } from '@/services/deviceService';
import { listVisits, getVisit, getVisitStatusLabel, getVisitResultLabel } from '@/services/visitService';
import { DEVICE_TYPE_KEYS, type Device } from '@shared/device';
import type { Visit } from '@shared/visit';
import { useNatsStore } from '@/stores/natsStore';
import { resolveRevisionDuration } from '@/utils/resolveRevisionDuration';
import { CustomerTimeline } from '../timeline';
import { SlotSuggestions, type SlotSuggestion } from './SlotSuggestions';
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
  /** Default service duration for this device type (minutes), used as second-level fallback */
  deviceTypeDefaultDurationMinutes?: number;
  // Route-aware data
  suggestedSlots?: SlotSuggestion[];
  // State flags
  isScheduled?: boolean;
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  /** Whether the candidate has valid geocoded coordinates */
  hasCoordinates?: boolean;
}

export type SnoozeDuration = 1 | 7 | 14 | 30;

export interface CustomerUpdateFields {
  customerId: string;
  phone?: string;
  email?: string;
  street?: string;
  city?: string;
  postalCode?: string;
}

interface CandidateDetailProps {
  candidate: CandidateDetailData | null;
  onSchedule?: (candidateId: string, slot: SlotSuggestion) => void;
  onSnooze?: (candidateId: string, days: SnoozeDuration) => void;
  onUpdateCustomer?: (fields: CustomerUpdateFields) => Promise<void>;
  isLoading?: boolean;
  /** Add candidate to the route. Second arg is the service duration chosen by the dispatcher. */
  onAddToRoute?: (candidateId: string, serviceDurationMinutes?: number) => void;
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
  onSchedule,
  onSnooze,
  onUpdateCustomer,
  isLoading,
  onAddToRoute,
  onRemoveFromRoute,
  isInRoute = false,
  routeDate,
  defaultServiceDurationMinutes = 60,
}: CandidateDetailProps) {
  const { t } = useTranslation('planner');
  // Inline scheduling form state
  const [isScheduling, setIsScheduling] = useState(false);
  const [schedDate, setSchedDate] = useState('');
  const [schedTimeStart, setSchedTimeStart] = useState('08:00');
  const [schedTimeEnd, setSchedTimeEnd] = useState('12:00');
  const [schedNotes, setSchedNotes] = useState('');

  // Service duration (time needed) — shown under "Domluvený termín" when window is flexible
  // Priority: stop override (set by user) → device type default → global default
  const [serviceDurationMinutes, setServiceDurationMinutes] = useState<number>(() =>
    resolveRevisionDuration(null, candidate?.deviceTypeDefaultDurationMinutes, defaultServiceDurationMinutes)
  );
  
  // Snooze dropdown state
  const [showSnoozeDropdown, setShowSnoozeDropdown] = useState(false);
  const [defaultSnoozeDays, setDefaultSnoozeDays] = useState<SnoozeDuration>(() => {
    const saved = localStorage.getItem('sazinka.snooze.defaultDays');
    return (saved ? parseInt(saved) : 7) as SnoozeDuration;
  });

  // Devices and visits
  const [devices, setDevices] = useState<Device[]>([]);
  const [lastVisit, setLastVisit] = useState<Visit | null>(null);
  const [lastVisitNotes, setLastVisitNotes] = useState<string | null>(null);
  const [isLoadingExtra, setIsLoadingExtra] = useState(false);
  const isConnected = useNatsStore((s) => s.isConnected);

  // Reset service duration when candidate changes to reflect device type default
  useEffect(() => {
    setServiceDurationMinutes(
      resolveRevisionDuration(null, candidate?.deviceTypeDefaultDurationMinutes, defaultServiceDurationMinutes)
    );
  }, [candidate?.id, candidate?.deviceTypeDefaultDurationMinutes, defaultServiceDurationMinutes]);

  useEffect(() => {
    if (!candidate?.customerId || !isConnected) {
      setDevices([]);
      setLastVisit(null);
      setLastVisitNotes(null);
      return;
    }
    let cancelled = false;
    setIsLoadingExtra(true);
    Promise.all([
      listDevices(candidate.customerId).catch(() => ({ items: [] as Device[] })),
      listVisits({ customerId: candidate.customerId, status: 'completed', limit: 1 }).catch(() => ({ visits: [] as Visit[], total: 0 })),
    ]).then(async ([devResp, visitResp]) => {
      if (cancelled) return;
      setDevices(devResp.items ?? []);
      const visits = visitResp.visits ?? [];
      if (visits.length > 0) {
        const visit = visits[0];
        setLastVisit(visit);
        // Fetch full visit details to get work item notes
        try {
          const full = await getVisit(visit.id);
          if (cancelled) return;
          // Collect all notes: visit resultNotes + work item resultNotes + findings
          const allNotes: string[] = [];
          if (full.visit.resultNotes) allNotes.push(full.visit.resultNotes);
          for (const wi of full.workItems ?? []) {
            if (wi.resultNotes) allNotes.push(wi.resultNotes);
            if (wi.findings) allNotes.push(wi.findings);
            if (wi.requiresFollowUp && wi.followUpReason) allNotes.push(`⚠ ${wi.followUpReason}`);
          }
          setLastVisitNotes(allNotes.length > 0 ? allNotes.join('\n') : null);
        } catch {
          // If getVisit fails, just use the visit-level notes
          setLastVisitNotes(visit.resultNotes ?? null);
        }
      } else {
        setLastVisit(null);
        setLastVisitNotes(null);
      }
    }).finally(() => {
      if (!cancelled) setIsLoadingExtra(false);
    });
    return () => { cancelled = true; };
  }, [candidate?.customerId, isConnected]);

  // Inline editing states
  const [editingContact, setEditingContact] = useState(false);
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editingAddress, setEditingAddress] = useState(false);
  const [editStreet, setEditStreet] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const startEditContact = useCallback(() => {
    if (!candidate) return;
    setEditPhone(candidate.phone ?? '');
    setEditEmail(candidate.email ?? '');
    setEditingContact(true);
  }, [candidate]);

  const startEditAddress = useCallback(() => {
    if (!candidate) return;
    setEditStreet(candidate.street ?? '');
    setEditCity(candidate.city ?? '');
    setEditPostalCode(candidate.postalCode ?? '');
    setEditingAddress(true);
  }, [candidate]);

  const saveContact = useCallback(async () => {
    if (!candidate || !onUpdateCustomer) return;
    setIsSaving(true);
    try {
      await onUpdateCustomer({
        customerId: candidate.customerId,
        phone: editPhone,
        email: editEmail,
      });
      setEditingContact(false);
    } catch {
      // Error is handled by the parent
    } finally {
      setIsSaving(false);
    }
  }, [candidate, onUpdateCustomer, editPhone, editEmail]);

  const saveAddress = useCallback(async () => {
    if (!candidate || !onUpdateCustomer) return;
    setIsSaving(true);
    try {
      await onUpdateCustomer({
        customerId: candidate.customerId,
        street: editStreet,
        city: editCity,
        postalCode: editPostalCode,
      });
      setEditingAddress(false);
    } catch {
      // Error is handled by the parent
    } finally {
      setIsSaving(false);
    }
  }, [candidate, onUpdateCustomer, editStreet, editCity, editPostalCode]);

  // Helper: add minutes to time string "HH:MM" → "HH:MM"
  const addMinutesToTime = (time: string, minutes: number): string => {
    const [h, m] = time.split(':').map(Number);
    const totalMin = h * 60 + m + minutes;
    const newH = Math.floor(totalMin / 60) % 24;
    const newM = totalMin % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  };

  // Compute whether the agreed window is "flexible" (wider than needed)
  const windowInfo = useMemo(() => {
    if (!candidate?.isScheduled || !candidate.scheduledTimeStart || !candidate.scheduledTimeEnd) {
      return null;
    }
    const parseMin = (t: string) => {
      const [h, m] = t.substring(0, 5).split(':').map(Number);
      return h * 60 + m;
    };
    const startMin = parseMin(candidate.scheduledTimeStart);
    const endMin = parseMin(candidate.scheduledTimeEnd);
    const windowLength = endMin - startMin;
    if (windowLength <= 0) return null;
    return { startMin, endMin, windowLength, isFlexible: windowLength > defaultServiceDurationMinutes };
  }, [candidate?.scheduledTimeStart, candidate?.scheduledTimeEnd, defaultServiceDurationMinutes]);

  // Reset scheduling form when candidate changes, pre-fill with existing appointment
  useEffect(() => {
    setIsScheduling(false);
    if (candidate?.isScheduled && candidate.scheduledDate) {
      // Pre-fill with existing appointment data
      setSchedDate(candidate.scheduledDate.substring(0, 10));
      setSchedTimeStart(candidate.scheduledTimeStart?.substring(0, 5) ?? '08:00');
      setSchedTimeEnd(candidate.scheduledTimeEnd?.substring(0, 5) ?? addMinutesToTime(candidate.scheduledTimeStart?.substring(0, 5) ?? '08:00', defaultServiceDurationMinutes));
    } else {
      setSchedDate(routeDate ?? new Date().toISOString().split('T')[0]);
      setSchedTimeStart('08:00');
      setSchedTimeEnd(addMinutesToTime('08:00', defaultServiceDurationMinutes));
    }
    setSchedNotes('');
    setShowSnoozeDropdown(false);
    setServiceDurationMinutes(defaultServiceDurationMinutes);
    setEditingContact(false);
    setEditingAddress(false);
  }, [candidate?.id, routeDate, defaultServiceDurationMinutes]);
  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{t('candidate_loading')}</span>
        </div>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>👆</span>
          <p>{t('candidate_empty')}</p>
          <p className={styles.emptyHint}>
            {t('candidate_empty_hint')}
          </p>
        </div>
      </div>
    );
  }

  const daysOverdue = candidate.daysUntilDue < 0 ? Math.abs(candidate.daysUntilDue) : 0;
  const dueDateFormatted = formatDate(candidate.dueDate);

  const handleSnoozeSelect = (days: SnoozeDuration) => {
    setDefaultSnoozeDays(days);
    localStorage.setItem('sazinka.snooze.defaultDays', days.toString());
    setShowSnoozeDropdown(false);
    onSnooze?.(candidate.id, days);
  };

  const getSnoozeDurationLabel = (days: SnoozeDuration): string => {
    switch (days) {
      case 1: return t('candidate_snooze_duration_1');
      case 7: return t('candidate_snooze_duration_7');
      case 14: return t('candidate_snooze_duration_14');
      case 30: return t('candidate_snooze_duration_30');
    }
  };

  const formatPhoneDisplay = (phone: string): string => {
    const compact = phone.replace(/\s+/g, '');
    if (compact.startsWith('+420')) {
      const localDigits = compact.slice(4).replace(/\D/g, '');
      const groups = localDigits.match(/.{1,3}/g) ?? [];
      return groups.length > 0 ? `+420 ${groups.join(' ')}` : '+420';
    }
    return phone;
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header} data-testid="candidate-header">
        <h3 className={styles.name}>{candidate.customerName}</h3>
        <div className={styles.badges}>
          <span className={styles.deviceBadge}>{candidate.deviceType}</span>
          {candidate.priority === 'overdue' && (
            <span className={styles.overdueBadge}>{t('candidate_overdue_badge', { days: daysOverdue })}</span>
          )}
        </div>
      </div>

      {/* State Flags */}
      <div className={styles.stateFlags} data-testid="state-flags">
        <div className={`${styles.stateFlag} ${candidate.isScheduled ? styles.stateFlagYes : styles.stateFlagNo}`}>
          <span className={styles.stateFlagLabel}>{t('candidate_state_appointment')}</span>
          <span className={styles.stateFlagValue}>{candidate.isScheduled ? t('candidate_state_yes') : t('candidate_state_no')}</span>
        </div>
        <div className={`${styles.stateFlag} ${isInRoute ? styles.stateFlagYes : styles.stateFlagNo}`}>
          <span className={styles.stateFlagLabel}>{t('candidate_state_in_route')}</span>
          <span className={styles.stateFlagValue}>{isInRoute ? t('candidate_state_yes') : t('candidate_state_no')}</span>
        </div>
      </div>

      {/* Domluvený termín — always visible when scheduled, with service duration input */}
      {candidate.isScheduled && candidate.scheduledDate && (
        <section className={styles.sectionNoBottomBorder}>
          <h4 className={styles.sectionTitle}>{t('candidate_agreed_appointment')}</h4>
          <div className={styles.appointmentRow}>
            <div className={styles.appointmentLine}>
              <button
                type="button"
                className={styles.scheduledAppointmentButton}
                onClick={() => setIsScheduling(true)}
                title={t('candidate_click_to_change')}
              >
                📅 {formatDate(candidate.scheduledDate)}
                {candidate.scheduledTimeStart && candidate.scheduledTimeEnd && (
                  <span className={styles.scheduledTime}>
                    {' '}🕐 {candidate.scheduledTimeStart.substring(0, 5)} – {candidate.scheduledTimeEnd.substring(0, 5)}
                  </span>
                )}
              </button>
              {/* Service duration — inline on same line when non-flexible */}
              {windowInfo && !windowInfo.isFlexible && (
                <span className={styles.durationBadge}>
                  {t('candidate_planned_duration', { minutes: windowInfo.windowLength })}
                </span>
              )}
            </div>
            {/* Flexible window: editable duration input on its own row */}
            {windowInfo?.isFlexible && (
              <div className={styles.serviceDurationInline}>
                <div className={styles.serviceDurationInput}>
                  <input
                    type="number"
                    min={1}
                    max={windowInfo.windowLength}
                    value={serviceDurationMinutes}
                    onChange={(e) => {
                      const v = Number.parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v > 0) {
                        setServiceDurationMinutes(Math.min(v, windowInfo.windowLength));
                      }
                    }}
                    className={styles.scheduleInput}
                  />
                  <span className={styles.serviceDurationUnit}>min</span>
                </div>
                <span className={styles.serviceDurationHint}>
                  {t('candidate_window_info', { window: windowInfo.windowLength, service: serviceDurationMinutes })}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Actions — compact buttons right after scheduled appointment */}
      {!isScheduling && (
        <div className={styles.actionsCompact} data-testid="candidate-actions">
          <button
            type="button"
            className={styles.actionButtonCompact}
            onClick={() => setIsScheduling(true)}
          >
            📅 {candidate.isScheduled ? t('candidate_change_appointment') : t('candidate_make_appointment')}
          </button>
          {isInRoute ? (
            <button
              type="button"
              className={styles.actionButtonCompact}
              onClick={() => onRemoveFromRoute?.(candidate.customerId)}
            >
              ✕ {t('candidate_remove_from_route')}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.actionButtonCompact} ${candidate.hasCoordinates === false ? styles.disabledAction : ''}`}
              onClick={() => onAddToRoute?.(candidate.id, windowInfo?.isFlexible ? serviceDurationMinutes : undefined)}
              disabled={candidate.hasCoordinates === false}
              title={candidate.hasCoordinates === false ? t('candidate_fix_address_first') : undefined}
            >
              ➕ {t('candidate_add_to_route')}
            </button>
          )}
          <div className={styles.snoozeButtonWrapper}>
            <button
              type="button"
              className={styles.snoozePrimaryButtonCompact}
              onClick={() => handleSnoozeSelect(defaultSnoozeDays)}
              title={t('candidate_snooze', { duration: getSnoozeDurationLabel(defaultSnoozeDays) })}
            >
              ⏰ {t('candidate_snooze', { duration: getSnoozeDurationLabel(defaultSnoozeDays) })}
            </button>
            <button
              type="button"
              className={styles.snoozeDropdownToggle}
              onClick={() => setShowSnoozeDropdown(!showSnoozeDropdown)}
              aria-haspopup="true"
              aria-expanded={showSnoozeDropdown}
              title={t('candidate_snooze_show_more')}
            >
              ▼
            </button>
            {showSnoozeDropdown && (
              <div className={styles.snoozeDropdown}>
                <button type="button" className={styles.snoozeOption} onClick={() => handleSnoozeSelect(1)}>{t('candidate_snooze_1_day')}</button>
                <button type="button" className={styles.snoozeOption} onClick={() => handleSnoozeSelect(7)}>{t('candidate_snooze_1_week')}</button>
                <button type="button" className={styles.snoozeOption} onClick={() => handleSnoozeSelect(14)}>{t('candidate_snooze_2_weeks')}</button>
                <button type="button" className={styles.snoozeOption} onClick={() => handleSnoozeSelect(30)}>{t('candidate_snooze_1_month')}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Revize nejpozději */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('candidate_due_date')}</h4>
        <p className={styles.dueDate}>
          <span className={candidate.priority === 'overdue' ? styles.overdueText : ''}>
            {dueDateFormatted}
          </span>
          {candidate.daysUntilDue > 0 && (
            <span className={styles.daysRemaining}>
              {t('candidate_days_remaining', { days: candidate.daysUntilDue })}
            </span>
          )}
        </p>
      </section>

      {/* Kontakt */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>{t('candidate_contact')}</h4>
          {onUpdateCustomer && !editingContact && (
            <button
              type="button"
              className={styles.sectionEditButton}
              onClick={startEditContact}
              title={t('candidate_edit_contact')}
              aria-label={t('candidate_edit_contact')}
            >
              ✏️
            </button>
          )}
        </div>
        {editingContact ? (
          <div className={styles.inlineEditForm}>
            <label className={styles.inlineEditLabel}>
              📞 {t('candidate_phone')}
              <input
                type="tel"
                className={styles.inlineEditInput}
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                autoFocus
              />
            </label>
            <label className={styles.inlineEditLabel}>
              ✉️ {t('candidate_email')}
              <input
                type="email"
                className={styles.inlineEditInput}
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </label>
            <div className={styles.inlineEditActions}>
              <button type="button" className={styles.inlineEditSave} onClick={saveContact} disabled={isSaving}>
                {isSaving ? '⏳' : '✓'} {t('candidate_edit_save')}
              </button>
              <button type="button" className={styles.inlineEditCancel} onClick={() => setEditingContact(false)} disabled={isSaving}>
                {t('candidate_edit_cancel')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {candidate.phone ? (
              <div className={styles.contactItem}>
                <a href={`tel:${candidate.phone}`} className={styles.phoneLink}>
                  📞 {formatPhoneDisplay(candidate.phone)}
                </a>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => navigator.clipboard.writeText(formatPhoneDisplay(candidate.phone!)).catch(console.error)}
                  title={t('candidate_copy')}
                >
                  📋
                </button>
              </div>
            ) : (
              <span className={styles.missingInfo}>📵 {t('candidate_missing_phone')}</span>
            )}
            {candidate.email ? (
              <div className={styles.contactItem}>
                <a href={`mailto:${candidate.email}`} className={styles.emailLink}>
                  ✉️ {candidate.email}
                </a>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => navigator.clipboard.writeText(candidate.email!).catch(console.error)}
                  title={t('candidate_copy')}
                >
                  📋
                </button>
              </div>
            ) : (
              <span className={styles.missingInfo}>✉️ {t('candidate_missing_email')}</span>
            )}
          </>
        )}
      </section>

      {/* Adresa */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>{t('candidate_address')}</h4>
          {onUpdateCustomer && !editingAddress && (
            <button
              type="button"
              className={styles.sectionEditButton}
              onClick={startEditAddress}
              title={t('candidate_edit_address')}
              aria-label={t('candidate_edit_address')}
            >
              ✏️
            </button>
          )}
        </div>
        {editingAddress ? (
          <div className={styles.inlineEditForm}>
            <label className={styles.inlineEditLabel}>
              {t('candidate_street')}
              <input
                type="text"
                className={styles.inlineEditInput}
                value={editStreet}
                onChange={(e) => setEditStreet(e.target.value)}
                autoFocus
              />
            </label>
            <label className={styles.inlineEditLabel}>
              {t('candidate_city')}
              <input
                type="text"
                className={styles.inlineEditInput}
                value={editCity}
                onChange={(e) => setEditCity(e.target.value)}
              />
            </label>
            <label className={styles.inlineEditLabel}>
              {t('candidate_postal_code')}
              <input
                type="text"
                className={styles.inlineEditInput}
                value={editPostalCode}
                onChange={(e) => setEditPostalCode(e.target.value)}
              />
            </label>
            <div className={styles.inlineEditActions}>
              <button type="button" className={styles.inlineEditSave} onClick={saveAddress} disabled={isSaving}>
                {isSaving ? '⏳' : '✓'} {t('candidate_edit_save')}
              </button>
              <button type="button" className={styles.inlineEditCancel} onClick={() => setEditingAddress(false)} disabled={isSaving}>
                {t('candidate_edit_cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.addressRow}>
            <div className={styles.addressText}>
              <p className={styles.address}>{candidate.street}</p>
              <p className={styles.address}>{candidate.city}</p>
              <p className={styles.address}>{candidate.postalCode ? candidate.postalCode.replace(/\s/g, '').replace(/^(\d{3})(\d+)$/, '$1 $2') : ''}</p>
            </div>
            {candidate.hasCoordinates === false ? (
              <span className={styles.addressNotLocated}>⚠ {t('candidate_geocode_error')}</span>
            ) : candidate.hasCoordinates && (
              <span className={styles.addressLocated}>✅ {t('candidate_address_located')}</span>
            )}
          </div>
        )}
      </section>

      {/* Last visit note — prominent banner */}
      {lastVisitNotes && (
        <div className={styles.lastVisitBanner}>
          <div className={styles.lastVisitBannerHeader}>
            <span className={styles.lastVisitBannerIcon}>📝</span>
            <span className={styles.lastVisitBannerTitle}>{t('candidate_visit_note', { defaultValue: 'Poznámka z poslední návštěvy' })}</span>
            {lastVisit && (
              <span className={styles.lastVisitBannerMeta}>
                {formatDate(lastVisit.scheduledDate)}
              </span>
            )}
          </div>
          <p className={styles.lastVisitBannerNotes}>{lastVisitNotes}</p>
          {lastVisit?.requiresFollowUp && lastVisit.followUpReason && (
            <div className={styles.lastVisitFollowUp}>
              <span className={styles.followUpIcon}>⚠</span>
              <span>{lastVisit.followUpReason}</span>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {candidate.notes && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('candidate_notes')}</h4>
          <p className={styles.notes}>{candidate.notes}</p>
        </section>
      )}

      {/* Devices */}
      <section className={styles.section}>
        <h4 className={styles.sectionTitle}>{t('candidate_devices', { defaultValue: 'Zařízení' })} ({devices.length})</h4>
        {isLoadingExtra ? (
          <span className={styles.loadingText}>{t('candidate_loading')}</span>
        ) : devices.length === 0 ? (
          <span className={styles.missingInfo}>{t('candidate_no_devices', { defaultValue: 'Žádná zařízení' })}</span>
        ) : (
          <div className={styles.deviceList}>
            {devices.map((dev) => (
              <div key={dev.id} className={styles.deviceItem}>
                <span className={styles.deviceType}>{t(DEVICE_TYPE_KEYS[dev.deviceType])}</span>
                {dev.deviceName && <span className={styles.deviceName}>{dev.deviceName}</span>}
                {dev.nextDueDate && (
                  <span className={
                    new Date(dev.nextDueDate) < new Date()
                      ? styles.deviceDueOverdue
                      : styles.deviceDue
                  }>
                    {formatDate(dev.nextDueDate)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Full history timeline */}
      <section className={styles.section}>
        <CustomerTimeline customerId={candidate.customerId} />
      </section>

      {/* Links */}
      <div className={styles.links}>
        <Link
          to="/customers/$customerId"
          params={{ customerId: candidate.customerId }}
          className={styles.link}
        >
          {t('candidate_view_detail')}
        </Link>
      </div>

      {/* Slot suggestions — only for unscheduled candidates */}
      {!candidate.isScheduled && candidate.suggestedSlots && candidate.suggestedSlots.length > 0 && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('candidate_suggested_slots')}</h4>
          <SlotSuggestions
            slots={candidate.suggestedSlots}
            onSelect={(slot) => onSchedule?.(candidate.id, slot)}
          />
        </section>
      )}

      {/* Inline scheduling form */}
      {isScheduling && (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>{t('candidate_schedule_title')}</h4>
          <div className={styles.scheduleForm}>
            <label className={styles.scheduleLabel}>
              {t('candidate_schedule_date')}
              <input
                type="date"
                className={styles.scheduleInput}
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
              />
            </label>
            <div className={styles.scheduleRow}>
              <label className={styles.scheduleLabel}>
                {t('candidate_schedule_from')}
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
                {t('candidate_schedule_to')}
                <input
                  type="time"
                  className={styles.scheduleInput}
                  value={schedTimeEnd}
                  onChange={(e) => setSchedTimeEnd(e.target.value)}
                />
              </label>
            </div>
            <label className={styles.scheduleLabel}>
              {t('candidate_schedule_note')}
              <input
                type="text"
                className={styles.scheduleInput}
                placeholder={t('candidate_schedule_note_placeholder')}
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
                {t('candidate_schedule_confirm')}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsScheduling(false)}
              >
                {t('candidate_schedule_cancel')}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Keyboard shortcuts hint */}
      <div className={styles.shortcuts}>
        <span><kbd>D</kbd> {t('candidate_shortcut_schedule')}</span>
        <span><kbd>O</kbd> {t('candidate_shortcut_snooze')}</span>
        <span><kbd>1-5</kbd> {t('candidate_shortcut_slot')}</span>
      </div>
    </div>
  );
}
