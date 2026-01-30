import { useState, useEffect, useCallback } from 'react';
import { useNatsStore } from '../../stores/natsStore';
import * as communicationService from '../../services/communicationService';
import * as visitService from '../../services/visitService';
import type { Communication, Visit } from '@sazinka/shared-types';
import styles from './CustomerTimeline.module.css';

interface TimelineItem {
  id: string;
  type: 'communication' | 'visit';
  date: string;
  data: Communication | Visit;
}

interface CustomerTimelineProps {
  customerId: string;
}

export function CustomerTimeline({ customerId }: CustomerTimelineProps) {
  // Get isConnected safely - handle both real store and mock scenarios
  let isConnected = false;
  try {
    const store = useNatsStore();
    isConnected = store?.isConnected ?? false;
  } catch {
    // In tests, store might be mocked differently
    isConnected = false;
  }
  
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState<'communication' | 'visit' | null>(null);
  const [serviceAvailable, setServiceAvailable] = useState(true);

  // Load timeline data
  const loadTimeline = useCallback(async () => {
    if (!isConnected) {
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const [communications, visits] = await Promise.all([
        communicationService.listCustomerCommunications(customerId, 20).catch(() => []),
        visitService.listCustomerVisits(customerId, 20).catch(() => []),
      ]);

      // Combine and sort by date
      const combined: TimelineItem[] = [
        ...communications.map((c) => ({
          id: c.id,
          type: 'communication' as const,
          date: c.createdAt,
          data: c,
        })),
        ...visits.map((v) => ({
          id: v.id,
          type: 'visit' as const,
          date: v.scheduledDate,
          data: v,
        })),
      ];

      combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setItems(combined);
      setServiceAvailable(true);
    } catch (e) {
      console.error('Failed to load timeline:', e);
      // Don't show error if services are just not available yet
      setServiceAvailable(false);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [customerId, isConnected]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  // Add communication
  const handleAddCommunication = async (data: {
    commType: string;
    direction: string;
    content: string;
    subject?: string;
  }) => {
    try {
      await communicationService.createCommunication({
        customerId,
        commType: data.commType as 'call' | 'note' | 'email_sent',
        direction: data.direction as 'outbound' | 'inbound',
        content: data.content,
        subject: data.subject,
      });
      setShowAddForm(null);
      loadTimeline();
    } catch (e) {
      console.error('Failed to add communication:', e);
    }
  };

  // Add visit
  const handleAddVisit = async (data: {
    scheduledDate: string;
    visitType: string;
    scheduledTimeStart?: string;
  }) => {
    try {
      await visitService.createVisit({
        customerId,
        scheduledDate: data.scheduledDate,
        visitType: data.visitType as 'revision' | 'consultation' | 'follow_up',
        scheduledTimeStart: data.scheduledTimeStart,
      });
      setShowAddForm(null);
      loadTimeline();
    } catch (e) {
      console.error('Failed to add visit:', e);
    }
  };

  if (loading) {
    return <div className={styles.loading}>Načítám historii...</div>;
  }

  // Don't show buttons if services aren't available
  const canAddItems = isConnected && serviceAvailable;

  return (
    <div className={styles.timeline}>
      <div className={styles.header}>
        <h3>Historie</h3>
        {canAddItems && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setShowAddForm('communication')}
            >
              + Komunikace
            </button>
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setShowAddForm('visit')}
            >
              + Návštěva
            </button>
          </div>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* Add Forms */}
      {showAddForm === 'communication' && (
        <AddCommunicationForm
          onSubmit={handleAddCommunication}
          onCancel={() => setShowAddForm(null)}
        />
      )}

      {showAddForm === 'visit' && (
        <AddVisitForm
          onSubmit={handleAddVisit}
          onCancel={() => setShowAddForm(null)}
        />
      )}

      {/* Timeline Items */}
      {items.length === 0 ? (
        <p className={styles.empty}>
          {!isConnected 
            ? 'Čekám na připojení...' 
            : !serviceAvailable 
              ? 'Historie zatím není k dispozici.' 
              : 'Zatím žádná historie.'}
        </p>
      ) : (
        <div className={styles.items}>
          {items.map((item) => (
            <TimelineItemCard key={`${item.type}-${item.id}`} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

// Timeline Item Card
function TimelineItemCard({ item }: { item: TimelineItem }) {
  if (item.type === 'communication') {
    const comm = item.data as Communication;
    return (
      <div className={`${styles.item} ${styles.communication}`}>
        <div className={styles.itemIcon}>
          {communicationService.getCommunicationTypeIcon(comm.commType)}
        </div>
        <div className={styles.itemContent}>
          <div className={styles.itemHeader}>
            <span className={styles.itemType}>
              {communicationService.getCommunicationTypeLabel(comm.commType)}
            </span>
            <span className={styles.itemDate}>
              {new Date(comm.createdAt).toLocaleDateString('cs-CZ')}
            </span>
          </div>
          {comm.subject && <strong>{comm.subject}</strong>}
          <p className={styles.itemText}>{comm.content}</p>
          {comm.durationMinutes && (
            <small>Trvání: {comm.durationMinutes} min</small>
          )}
        </div>
      </div>
    );
  }

  const visit = item.data as Visit;
  return (
    <div className={`${styles.item} ${styles.visit}`}>
      <div className={styles.itemIcon}>
        {visitService.getVisitStatusIcon(visit.status)}
      </div>
      <div className={styles.itemContent}>
        <div className={styles.itemHeader}>
          <span className={styles.itemType}>
            {visitService.getVisitTypeLabel(visit.visitType)}
          </span>
          <span className={styles.itemDate}>
            {visit.scheduledDate}
            {visit.scheduledTimeStart && ` ${visit.scheduledTimeStart}`}
          </span>
        </div>
        <span className={`${styles.statusBadge} ${styles[`status-${visit.status}`]}`}>
          {visitService.getVisitStatusLabel(visit.status)}
        </span>
        {visit.result && (
          <p className={styles.itemText}>
            Výsledek: {visitService.getVisitResultLabel(visit.result)}
          </p>
        )}
        {visit.resultNotes && <p className={styles.itemText}>{visit.resultNotes}</p>}
      </div>
    </div>
  );
}

// Add Communication Form
function AddCommunicationForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { commType: string; direction: string; content: string; subject?: string }) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    commType: 'note',
    direction: 'outbound',
    subject: '',
    content: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.content.trim()) return;
    onSubmit(formData);
  };

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <h4>Nová komunikace</h4>
      
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Typ</label>
          <select
            value={formData.commType}
            onChange={(e) => setFormData({ ...formData, commType: e.target.value })}
          >
            <option value="note">Poznámka</option>
            <option value="call">Telefonát</option>
            <option value="email_sent">Odeslaný e-mail</option>
            <option value="email_received">Přijatý e-mail</option>
            <option value="sms">SMS</option>
          </select>
        </div>
        <div className={styles.formGroup}>
          <label>Směr</label>
          <select
            value={formData.direction}
            onChange={(e) => setFormData({ ...formData, direction: e.target.value })}
          >
            <option value="outbound">Odchozí</option>
            <option value="inbound">Příchozí</option>
          </select>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>Předmět (volitelné)</label>
        <input
          type="text"
          value={formData.subject}
          onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
        />
      </div>

      <div className={styles.formGroup}>
        <label>Obsah *</label>
        <textarea
          rows={3}
          value={formData.content}
          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          required
        />
      </div>

      <div className={styles.formActions}>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Zrušit
        </button>
        <button type="submit" className="btn-primary">
          Přidat
        </button>
      </div>
    </form>
  );
}

// Add Visit Form
// Note: "Revize" is not available here - revisions must be added via device card
function AddVisitForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (data: { scheduledDate: string; visitType: string; scheduledTimeStart?: string }) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    scheduledDate: new Date().toISOString().slice(0, 10),
    scheduledTimeStart: '',
    visitType: 'consultation',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.scheduledDate) return;
    onSubmit({
      ...formData,
      scheduledTimeStart: formData.scheduledTimeStart || undefined,
    });
  };

  return (
    <form className={styles.addForm} onSubmit={handleSubmit}>
      <h4>Nová návštěva</h4>
      
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>Datum *</label>
          <input
            type="date"
            value={formData.scheduledDate}
            onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label>Čas (volitelné)</label>
          <input
            type="time"
            value={formData.scheduledTimeStart}
            onChange={(e) => setFormData({ ...formData, scheduledTimeStart: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>Typ návštěvy</label>
        <select
          value={formData.visitType}
          onChange={(e) => setFormData({ ...formData, visitType: e.target.value })}
        >
          <option value="consultation">Konzultace</option>
          <option value="installation">Instalace</option>
          <option value="repair">Oprava</option>
          <option value="follow_up">Následná návštěva</option>
        </select>
      </div>

      <p className={styles.hint}>
        Pro přidání revize použijte kartu konkrétního zařízení.
      </p>

      <div className={styles.formActions}>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Zrušit
        </button>
        <button type="submit" className="btn-primary">
          Přidat
        </button>
      </div>
    </form>
  );
}

export default CustomerTimeline;
