/**
 * VisitDetail page - Detail of a single visit
 *
 * Shows visit information, customer location, timeline, and work items performed
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import type { Visit } from '@shared/visit';
import type { VisitWorkItem } from '@shared/workItem';
import {
  getVisit,
  updateVisit,
  completeVisit,
  getVisitStatusLabel,
  getVisitTypeLabel,
  getVisitResultLabel,
} from '../services/visitService';
import { getWorkTypeLabel, getWorkTypeIcon } from '../services/workItemService';
import { useNatsStore } from '../stores/natsStore';
import styles from './VisitDetail.module.css';

interface VisitData {
  visit: Visit;
  customerName: string | null;
  customerStreet: string | null;
  customerCity: string | null;
  customerPostalCode: string | null;
  customerPhone: string | null;
  customerLat: number | null;
  customerLng: number | null;
  workItems: Array<{
    id: string;
    visitId: string;
    deviceId?: string | null;
    revisionId?: string | null;
    crewId?: string | null;
    workType: string;
    durationMinutes?: number | null;
    result?: string | null;
    resultNotes?: string | null;
    findings?: string | null;
    requiresFollowUp: boolean;
    followUpReason?: string | null;
    createdAt: string;
  }>;
}

export function VisitDetail() {
  const { t } = useTranslation('pages');
  const { visitId } = useParams({ strict: false }) as { visitId: string };
  const navigate = useNavigate();
  const isConnected = useNatsStore((s) => s.isConnected);

  const [data, setData] = useState<VisitData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dialogs
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);

  // Edit dialog state
  const [editTimeStart, setEditTimeStart] = useState('');
  const [editTimeEnd, setEditTimeEnd] = useState('');

  // Complete dialog state
  const [completeResult, setCompleteResult] = useState<'successful' | 'partial' | 'failed' | 'customer_absent' | 'rescheduled'>('successful');
  const [completeNotes, setCompleteNotes] = useState('');
  const [requiresFollowUp, setRequiresFollowUp] = useState(false);
  const [followUpReason, setFollowUpReason] = useState('');

  // Map
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  const loadVisit = useCallback(async () => {
    if (!isConnected) {
      setError(t('visit_error_connection'));
      setIsLoading(false);
      return;
    }

    if (!visitId) {
      setError(t('visit_error_no_id'));
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const response = await getVisit(visitId);
      setData(response);
      
      // Initialize edit dialog values
      if (response.visit.scheduledTimeStart) {
        setEditTimeStart(response.visit.scheduledTimeStart);
      }
      if (response.visit.scheduledTimeEnd) {
        setEditTimeEnd(response.visit.scheduledTimeEnd);
      }
    } catch (err) {
      console.error('Failed to load visit:', err);
      setError(err instanceof Error ? err.message : t('visit_error_load'));
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, visitId]);

  useEffect(() => {
    loadVisit();
  }, [loadVisit]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current || !data?.customerLat || !data?.customerLng) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [data.customerLng, data.customerLat],
      zoom: 14,
    });

    new maplibregl.Marker({ color: '#3b82f6' })
      .setLngLat([data.customerLng, data.customerLat])
      .addTo(map.current);

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [data?.customerLat, data?.customerLng]);

  // Edit handler
  const handleEdit = useCallback(async () => {
    if (!data) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await updateVisit({
        id: data.visit.id,
        scheduledTimeStart: editTimeStart || undefined,
        scheduledTimeEnd: editTimeEnd || undefined,
      });
      setShowEditDialog(false);
      await loadVisit();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('visit_error_save'));
    } finally {
      setIsSubmitting(false);
    }
  }, [data, editTimeStart, editTimeEnd, loadVisit]);

  // Complete handler
  const handleComplete = useCallback(async () => {
    if (!data) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await completeVisit({
        id: data.visit.id,
        result: completeResult,
        resultNotes: completeNotes || undefined,
        requiresFollowUp,
        followUpReason: requiresFollowUp ? followUpReason : undefined,
      });
      setShowCompleteDialog(false);
      await loadVisit();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('visit_error_complete'));
    } finally {
      setIsSubmitting(false);
    }
  }, [data, completeResult, completeNotes, requiresFollowUp, followUpReason, loadVisit]);

  // Cancel handler
  const handleCancel = useCallback(async () => {
    if (!data) return;
    if (!confirm(t('visit_confirm_cancel'))) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await updateVisit({
        id: data.visit.id,
        status: 'cancelled',
      });
      await loadVisit();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('visit_error_cancel'));
    } finally {
      setIsSubmitting(false);
    }
  }, [data, loadVisit]);

  // Format time
  const formatTime = (time: string | null | undefined): string => {
    if (!time) return '--:--';
    return time.substring(0, 5);
  };

  // Format date
  const formatDate = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  // Calculate duration
  const calculateDuration = (start: string | null | undefined, end: string | null | undefined): string | null => {
    if (!start || !end) return null;
    const startMinutes = parseInt(start.substring(0, 2)) * 60 + parseInt(start.substring(3, 5));
    const endMinutes = parseInt(end.substring(0, 2)) * 60 + parseInt(end.substring(3, 5));
    const duration = endMinutes - startMinutes;
    const hours = Math.floor(duration / 60);
    const minutes = duration % 60;
    return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>{t('visit_loading')}</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <h2>{t('visit_error')}</h2>
          <p>{error}</p>
          <Link to="/worklog" className={styles.backButton}>{t('visit_back_worklog')}</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>🔍</span>
          <h2>{t('visit_not_found')}</h2>
          <p>{t('visit_not_found_desc')}</p>
          <Link to="/worklog" className={styles.backButton}>{t('visit_back_worklog')}</Link>
        </div>
      </div>
    );
  }

  const { visit } = data;
  const scheduledDuration = calculateDuration(visit.scheduledTimeStart, visit.scheduledTimeEnd);
  const actualDuration = calculateDuration(visit.actualArrival, visit.actualDeparture);

  return (
    <div className={styles.container}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.breadcrumb}>
          <Link to="/worklog" className={styles.backLink}>{t('visit_breadcrumb_worklog')}</Link>
          {data.customerName && (
            <>
              <span className={styles.breadcrumbSeparator}>/</span>
              <Link 
                to="/customers/$customerId" 
                params={{ customerId: visit.customerId }}
                className={styles.backLink}
              >
                {data.customerName}
              </Link>
            </>
          )}
        </div>

        <div className={styles.titleRow}>
          <div className={styles.titleSection}>
            <h1 className={styles.title}>
              {getVisitTypeLabel(visit.visitType)} {t('visit_title_at')} {data.customerName || t('visit_customer')}
            </h1>
            <span className={`${styles.statusBadge} ${styles[`status-${visit.status}`]}`}>
              {getVisitStatusLabel(visit.status)}
            </span>
          </div>

          <div className={styles.headerMeta}>
            <span className={styles.metaItem}>
              📅 {formatDate(visit.scheduledDate)}
            </span>
            {visit.scheduledTimeStart && visit.scheduledTimeEnd && (
              <span className={styles.metaItem}>
                🕐 {formatTime(visit.scheduledTimeStart)} – {formatTime(visit.scheduledTimeEnd)}
              </span>
            )}
            {scheduledDuration && (
              <span className={styles.metaItem}>
                ⏱️ {scheduledDuration}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className={styles.errorBanner}>
          <span>⚠️</span>
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Main content */}
      <div className={styles.content}>
        {/* Left column */}
        <div className={styles.mainColumn}>
          {/* Basic info card */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{t('visit_basic_info')}</h3>
            <div className={styles.cardContent}>
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>{t('visit_customer')}</span>
                  <Link 
                    to="/customers/$customerId" 
                    params={{ customerId: visit.customerId }}
                    className={styles.customerLink}
                  >
                    {data.customerName || '—'}
                  </Link>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>{t('visit_type')}</span>
                  <span className={styles.detailValue}>{getVisitTypeLabel(visit.visitType)}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>{t('visit_date')}</span>
                  <span className={styles.detailValue}>{formatDate(visit.scheduledDate)}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>{t('visit_status')}</span>
                  <span className={`${styles.statusBadge} ${styles[`status-${visit.status}`]}`}>
                    {getVisitStatusLabel(visit.status)}
                  </span>
                </div>
                {visit.result && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>{t('visit_result')}</span>
                    <span className={styles.detailValue}>{getVisitResultLabel(visit.result)}</span>
                  </div>
                )}
              </div>

              {data.customerStreet && data.customerCity && (
                <div className={styles.addressSection}>
                  <span className={styles.detailLabel}>{t('visit_address')}</span>
                  <p className={styles.address}>
                    {data.customerStreet}
                    <br />
                    {data.customerPostalCode && `${data.customerPostalCode} `}
                    {data.customerCity}
                  </p>
                </div>
              )}

              {data.customerPhone && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>{t('visit_phone')}</span>
                  <a href={`tel:${data.customerPhone}`} className={styles.phoneLink}>
                    📞 {data.customerPhone}
                  </a>
                </div>
              )}

              {visit.resultNotes && (
                <div className={styles.notesSection}>
                  <span className={styles.detailLabel}>{t('visit_notes')}</span>
                  <p className={styles.notes}>{visit.resultNotes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Map */}
          {data.customerLat && data.customerLng && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>{t('visit_location')}</h3>
              <div ref={mapContainer} className={styles.map} />
            </div>
          )}

          {/* Timeline */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{t('visit_timeline')}</h3>
            <div className={styles.timeline}>
              <div className={styles.timelineItem}>
                <span className={styles.timelineLabel}>{t('visit_scheduled_time')}</span>
                <span className={styles.timelineValue}>
                  {formatTime(visit.scheduledTimeStart)} – {formatTime(visit.scheduledTimeEnd)}
                  {scheduledDuration && <span className={styles.duration}> ({scheduledDuration})</span>}
                </span>
              </div>
              {visit.actualArrival && (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineLabel}>{t('visit_arrival')}</span>
                  <span className={styles.timelineValue}>{formatTime(visit.actualArrival)}</span>
                </div>
              )}
              {visit.actualDeparture && (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineLabel}>{t('visit_departure')}</span>
                  <span className={styles.timelineValue}>{formatTime(visit.actualDeparture)}</span>
                </div>
              )}
              {actualDuration && (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineLabel}>{t('visit_actual_duration')}</span>
                  <span className={styles.timelineValue}>{actualDuration}</span>
                </div>
              )}
            </div>
          </div>

          {/* Work items */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{t('visit_work_items')} ({data.workItems.length})</h3>
            {data.workItems.length === 0 ? (
              <p className={styles.placeholder}>{t('visit_no_work_items')}</p>
            ) : (
              <div className={styles.workItemsList}>
                {data.workItems.map((item) => (
                  <Link
                    key={item.id}
                    to="/work-items/$workItemId"
                    params={{ workItemId: item.id }}
                    className={styles.workItemCard}
                  >
                    <div className={styles.workItemHeader}>
                      <span className={styles.workItemIcon}>{getWorkTypeIcon(item.workType)}</span>
                      <span className={styles.workItemType}>{getWorkTypeLabel(item.workType)}</span>
                      {item.result && (
                        <span className={`${styles.workItemBadge} ${styles[`result-${item.result}`]}`}>
                          {item.result}
                        </span>
                      )}
                    </div>
                    {item.durationMinutes && (
                      <span className={styles.workItemDuration}>⏱️ {item.durationMinutes} min</span>
                    )}
                    {item.resultNotes && (
                      <p className={styles.workItemNotes}>{item.resultNotes}</p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Photos placeholder */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{t('visit_photos')}</h3>
            <p className={styles.placeholder}>
              {t('visit_photos_placeholder')}
            </p>
          </div>
        </div>

        {/* Right column - Actions panel */}
        <div className={styles.actionsPanel}>
          <h3 className={styles.panelTitle}>{t('visit_actions')}</h3>

          <div className={styles.actions}>
            {visit.status === 'planned' && (
              <>
                <button 
                  className={styles.actionButton}
                  onClick={() => setShowEditDialog(true)}
                  disabled={isSubmitting}
                >
                  {t('visit_edit_time')}
                </button>
                <button 
                  className={styles.actionButton}
                  onClick={() => setShowCompleteDialog(true)}
                  disabled={isSubmitting}
                >
                  {t('visit_complete')}
                </button>
              </>
            )}
            {visit.status !== 'cancelled' && (
              <button 
                className={`${styles.actionButton} ${styles.actionDanger}`}
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {t('visit_cancel')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      {showEditDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowEditDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>{t('visit_edit_dialog_title')}</h3>
            <div className={styles.dialogRow}>
              <div className={styles.dialogField}>
                <label>{t('visit_time_from')}</label>
                <input 
                  type="time" 
                  value={editTimeStart} 
                  onChange={e => setEditTimeStart(e.target.value)}
                />
              </div>
              <div className={styles.dialogField}>
                <label>{t('visit_time_to')}</label>
                <input 
                  type="time" 
                  value={editTimeEnd} 
                  onChange={e => setEditTimeEnd(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.dialogActions}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowEditDialog(false)}
                disabled={isSubmitting}
              >
                {t('common:cancel')}
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleEdit}
                disabled={isSubmitting}
              >
                {isSubmitting ? t('common:loading') : t('common:save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Dialog */}
      {showCompleteDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowCompleteDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>{t('visit_complete_dialog_title')}</h3>
            <div className={styles.dialogField}>
              <label>{t('visit_complete_result')}</label>
              <select 
                value={completeResult} 
                onChange={e => setCompleteResult(e.target.value as any)}
              >
                <option value="successful">{t('visit_result_successful')}</option>
                <option value="partial">{t('visit_result_partial')}</option>
                <option value="failed">{t('visit_result_failed')}</option>
                <option value="customer_absent">{t('visit_result_customer_absent')}</option>
                <option value="rescheduled">{t('visit_result_rescheduled')}</option>
              </select>
            </div>
            <div className={styles.dialogField}>
              <label>{t('visit_complete_notes')}</label>
              <textarea 
                value={completeNotes} 
                onChange={e => setCompleteNotes(e.target.value)}
                placeholder={t('visit_complete_notes_placeholder')}
                rows={3}
              />
            </div>
            <div className={styles.dialogField}>
              <label className={styles.checkboxLabel}>
                <input 
                  type="checkbox" 
                  checked={requiresFollowUp} 
                  onChange={e => setRequiresFollowUp(e.target.checked)}
                />
                <span>{t('visit_complete_follow_up')}</span>
              </label>
            </div>
            {requiresFollowUp && (
              <div className={styles.dialogField}>
                <label>{t('visit_complete_follow_up_reason')}</label>
                <textarea 
                  value={followUpReason} 
                  onChange={e => setFollowUpReason(e.target.value)}
                  placeholder={t('visit_complete_follow_up_placeholder')}
                  rows={2}
                />
              </div>
            )}
            <div className={styles.dialogActions}>
              <button 
                className={styles.cancelButton}
                onClick={() => setShowCompleteDialog(false)}
                disabled={isSubmitting}
              >
                {t('common:cancel')}
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleComplete}
                disabled={isSubmitting}
              >
                {isSubmitting ? t('common:loading') : t('visit_complete_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
