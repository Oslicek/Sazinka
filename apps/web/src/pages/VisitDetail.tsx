/**
 * VisitDetail page - Detail of a single visit
 *
 * Shows visit information, customer location, timeline, and work items performed
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from '@tanstack/react-router';
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
      setError('Není připojení k serveru');
      setIsLoading(false);
      return;
    }

    if (!visitId) {
      setError('ID návštěvy není zadáno');
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
      setError(err instanceof Error ? err.message : 'Nepodařilo se načíst návštěvu');
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
      setError(err instanceof Error ? err.message : 'Nepodařilo se uložit změny');
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
      setError(err instanceof Error ? err.message : 'Nepodařilo se dokončit návštěvu');
    } finally {
      setIsSubmitting(false);
    }
  }, [data, completeResult, completeNotes, requiresFollowUp, followUpReason, loadVisit]);

  // Cancel handler
  const handleCancel = useCallback(async () => {
    if (!data) return;
    if (!confirm('Opravdu chcete zrušit tuto návštěvu?')) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await updateVisit({
        id: data.visit.id,
        status: 'cancelled',
      });
      await loadVisit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se zrušit návštěvu');
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
    return d.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
          <span>Načítám návštěvu...</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>⚠️</span>
          <h2>Chyba</h2>
          <p>{error}</p>
          <Link to="/worklog" className={styles.backButton}>← Zpět na záznam práce</Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <span className={styles.errorIcon}>🔍</span>
          <h2>Návštěva nenalezena</h2>
          <p>Požadovaná návštěva neexistuje nebo byla smazána.</p>
          <Link to="/worklog" className={styles.backButton}>← Zpět na záznam práce</Link>
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
          <Link to="/worklog" className={styles.backLink}>← Záznam práce</Link>
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
              {getVisitTypeLabel(visit.visitType)} u {data.customerName || 'zákazníka'}
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
            <h3 className={styles.cardTitle}>Základní informace</h3>
            <div className={styles.cardContent}>
              <div className={styles.detailGrid}>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Zákazník</span>
                  <Link 
                    to="/customers/$customerId" 
                    params={{ customerId: visit.customerId }}
                    className={styles.customerLink}
                  >
                    {data.customerName || '—'}
                  </Link>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Typ návštěvy</span>
                  <span className={styles.detailValue}>{getVisitTypeLabel(visit.visitType)}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Datum</span>
                  <span className={styles.detailValue}>{formatDate(visit.scheduledDate)}</span>
                </div>
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Stav</span>
                  <span className={`${styles.statusBadge} ${styles[`status-${visit.status}`]}`}>
                    {getVisitStatusLabel(visit.status)}
                  </span>
                </div>
                {visit.result && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Výsledek</span>
                    <span className={styles.detailValue}>{getVisitResultLabel(visit.result)}</span>
                  </div>
                )}
              </div>

              {data.customerStreet && data.customerCity && (
                <div className={styles.addressSection}>
                  <span className={styles.detailLabel}>Adresa</span>
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
                  <span className={styles.detailLabel}>Telefon</span>
                  <a href={`tel:${data.customerPhone}`} className={styles.phoneLink}>
                    📞 {data.customerPhone}
                  </a>
                </div>
              )}

              {visit.resultNotes && (
                <div className={styles.notesSection}>
                  <span className={styles.detailLabel}>Poznámky</span>
                  <p className={styles.notes}>{visit.resultNotes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Map */}
          {data.customerLat && data.customerLng && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Poloha</h3>
              <div ref={mapContainer} className={styles.map} />
            </div>
          )}

          {/* Timeline */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Časová osa</h3>
            <div className={styles.timeline}>
              <div className={styles.timelineItem}>
                <span className={styles.timelineLabel}>Naplánovaný čas</span>
                <span className={styles.timelineValue}>
                  {formatTime(visit.scheduledTimeStart)} – {formatTime(visit.scheduledTimeEnd)}
                  {scheduledDuration && <span className={styles.duration}> ({scheduledDuration})</span>}
                </span>
              </div>
              {visit.actualArrival && (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineLabel}>Příjezd</span>
                  <span className={styles.timelineValue}>{formatTime(visit.actualArrival)}</span>
                </div>
              )}
              {visit.actualDeparture && (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineLabel}>Odjezd</span>
                  <span className={styles.timelineValue}>{formatTime(visit.actualDeparture)}</span>
                </div>
              )}
              {actualDuration && (
                <div className={styles.timelineItem}>
                  <span className={styles.timelineLabel}>Skutečná délka</span>
                  <span className={styles.timelineValue}>{actualDuration}</span>
                </div>
              )}
            </div>
          </div>

          {/* Work items */}
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>Provedené úkony ({data.workItems.length})</h3>
            {data.workItems.length === 0 ? (
              <p className={styles.placeholder}>Zatím nebyly přidány žádné úkony.</p>
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
            <h3 className={styles.cardTitle}>Fotografie</h3>
            <p className={styles.placeholder}>
              Sekce pro fotografie z návštěvy bude implementována v budoucnu.
            </p>
          </div>
        </div>

        {/* Right column - Actions panel */}
        <div className={styles.actionsPanel}>
          <h3 className={styles.panelTitle}>Akce</h3>

          <div className={styles.actions}>
            {visit.status === 'planned' && (
              <>
                <button 
                  className={styles.actionButton}
                  onClick={() => setShowEditDialog(true)}
                  disabled={isSubmitting}
                >
                  ✏️ Upravit čas
                </button>
                <button 
                  className={styles.actionButton}
                  onClick={() => setShowCompleteDialog(true)}
                  disabled={isSubmitting}
                >
                  ✅ Dokončit návštěvu
                </button>
              </>
            )}
            {visit.status !== 'cancelled' && (
              <button 
                className={`${styles.actionButton} ${styles.actionDanger}`}
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                ❌ Zrušit návštěvu
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      {showEditDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowEditDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>Upravit čas návštěvy</h3>
            <div className={styles.dialogRow}>
              <div className={styles.dialogField}>
                <label>Čas od</label>
                <input 
                  type="time" 
                  value={editTimeStart} 
                  onChange={e => setEditTimeStart(e.target.value)}
                />
              </div>
              <div className={styles.dialogField}>
                <label>Čas do</label>
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
                Zrušit
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleEdit}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Ukládám...' : 'Uložit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Complete Dialog */}
      {showCompleteDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowCompleteDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <h3>Dokončit návštěvu</h3>
            <div className={styles.dialogField}>
              <label>Výsledek *</label>
              <select 
                value={completeResult} 
                onChange={e => setCompleteResult(e.target.value as any)}
              >
                <option value="successful">Úspěšně</option>
                <option value="partial">Částečně</option>
                <option value="failed">Neúspěšně</option>
                <option value="customer_absent">Zákazník nepřítomen</option>
                <option value="rescheduled">Přeplánováno</option>
              </select>
            </div>
            <div className={styles.dialogField}>
              <label>Poznámky</label>
              <textarea 
                value={completeNotes} 
                onChange={e => setCompleteNotes(e.target.value)}
                placeholder="Poznámky k návštěvě..."
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
                <span>Vyžaduje následnou návštěvu</span>
              </label>
            </div>
            {requiresFollowUp && (
              <div className={styles.dialogField}>
                <label>Důvod následné návštěvy</label>
                <textarea 
                  value={followUpReason} 
                  onChange={e => setFollowUpReason(e.target.value)}
                  placeholder="Proč je potřeba další návštěva..."
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
                Zrušit
              </button>
              <button 
                className={styles.confirmButton}
                onClick={handleComplete}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Ukládám...' : 'Dokončit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
