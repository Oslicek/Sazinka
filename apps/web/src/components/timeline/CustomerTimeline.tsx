import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNatsStore } from '../../stores/natsStore';
import * as communicationService from '../../services/communicationService';
import * as visitService from '../../services/visitService';
import type { Communication } from '@shared/communication';
import type { Visit } from '@shared/visit';
import { formatDate } from '../../i18n/formatters';
import { Mail, Phone, FileText, MessageSquare, Upload, Download, Calendar, RefreshCw, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { TimeInput } from '../common/TimeInput';
import { VisitDetailDialog } from './VisitDetailDialog';
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
  const { t } = useTranslation('customers');
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
  const [selectedVisit, setSelectedVisit] = useState<Visit | null>(null);

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
    return <div className={styles.loading}>{t('timeline_loading')}</div>;
  }

  // Don't show buttons if services aren't available
  const canAddItems = isConnected && serviceAvailable;

  return (
    <div className={styles.timeline}>
      <div className={styles.header}>
        <h3>{t('timeline_title')}</h3>
        {canAddItems && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setShowAddForm('communication')}
            >
              + {t('timeline_add_communication')}
            </button>
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setShowAddForm('visit')}
            >
              + {t('timeline_add_visit')}
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
            ? t('timeline_waiting_connection') 
            : !serviceAvailable 
              ? t('timeline_not_available') 
              : t('timeline_empty')}
        </p>
      ) : (
        <div className={styles.items}>
          {items.map((item) => (
            <TimelineItemCard 
              key={`${item.type}-${item.id}`} 
              item={item}
              onVisitClick={(visit) => setSelectedVisit(visit)}
            />
          ))}
        </div>
      )}

      {/* Visit detail dialog */}
      {selectedVisit && (
        <VisitDetailDialog
          visit={selectedVisit}
          onClose={() => setSelectedVisit(null)}
          onSaved={() => {
            setSelectedVisit(null);
            loadTimeline();
          }}
        />
      )}
    </div>
  );
}

function getCommunicationIcon(type: string) {
  switch (type) {
    case 'email_sent': return <Upload size={14} />;
    case 'email_received': return <Download size={14} />;
    case 'call': return <Phone size={14} />;
    case 'note': return <FileText size={14} />;
    case 'sms': return <MessageSquare size={14} />;
    default: return <Mail size={14} />;
  }
}

function getVisitIcon(status: string) {
  switch (status) {
    case 'planned': return <Calendar size={14} />;
    case 'in_progress': return <RefreshCw size={14} />;
    case 'completed': return <CheckCircle2 size={14} />;
    case 'cancelled': return <XCircle size={14} />;
    case 'rescheduled': return <RotateCcw size={14} />;
    default: return <Calendar size={14} />;
  }
}

// Timeline Item Card
function TimelineItemCard({ 
  item, 
  onVisitClick 
}: { 
  item: TimelineItem; 
  onVisitClick: (visit: Visit) => void;
}) {
  const { t } = useTranslation('customers');
  
  if (item.type === 'communication') {
    const comm = item.data as Communication;
    return (
      <div className={`${styles.item} ${styles.communication}`}>
        <div className={styles.itemIcon}>
          {getCommunicationIcon(comm.commType)}
        </div>
        <div className={styles.itemContent}>
          <div className={styles.itemHeader}>
            <span className={styles.itemType}>
              {communicationService.getCommunicationTypeLabel(comm.commType)}
            </span>
            <span className={styles.itemDate}>
              {formatDate(comm.createdAt)}
            </span>
          </div>
          {comm.subject && <strong>{comm.subject}</strong>}
          <p className={styles.itemText}>{comm.content}</p>
          {comm.durationMinutes && (
            <small>{t('timeline_duration', { minutes: comm.durationMinutes })}</small>
          )}
        </div>
      </div>
    );
  }

  const visit = item.data as Visit;
  return (
    <div 
      className={`${styles.item} ${styles.visit} ${styles.clickable}`}
      onClick={() => onVisitClick(visit)}
      role="button"
      tabIndex={0}
    >
      <div className={styles.itemIcon}>
        {getVisitIcon(visit.status)}
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
            {t('timeline_result')}: {visitService.getVisitResultLabel(visit.result)}
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
  const { t } = useTranslation('customers');
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
      <h4>{t('timeline_new_communication')}</h4>
      
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>{t('timeline_comm_type')}</label>
          <select
            value={formData.commType}
            onChange={(e) => setFormData({ ...formData, commType: e.target.value })}
          >
            <option value="note">{t('timeline_comm_note')}</option>
            <option value="call">{t('timeline_comm_call')}</option>
            <option value="email_sent">{t('timeline_comm_email_sent')}</option>
            <option value="email_received">{t('timeline_comm_email_received')}</option>
            <option value="sms">{t('timeline_comm_sms')}</option>
          </select>
        </div>
        <div className={styles.formGroup}>
          <label>{t('timeline_comm_direction')}</label>
          <select
            value={formData.direction}
            onChange={(e) => setFormData({ ...formData, direction: e.target.value })}
          >
            <option value="outbound">{t('timeline_comm_outbound')}</option>
            <option value="inbound">{t('timeline_comm_inbound')}</option>
          </select>
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>{t('timeline_comm_subject')}</label>
        <input
          type="text"
          value={formData.subject}
          onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
        />
      </div>

      <div className={styles.formGroup}>
        <label>{t('timeline_comm_content')} *</label>
        <textarea
          rows={3}
          value={formData.content}
          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          required
        />
      </div>

      <div className={styles.formActions}>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('timeline_cancel')}
        </button>
        <button type="submit" className="btn-primary">
          {t('timeline_add')}
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
  const { t } = useTranslation('customers');
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
      <h4>{t('timeline_new_visit')}</h4>
      
      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>{t('timeline_visit_date')} *</label>
          <input
            type="date"
            value={formData.scheduledDate}
            onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label>{t('timeline_visit_time')}</label>
          <TimeInput
            value={formData.scheduledTimeStart}
            onChange={(v) => setFormData({ ...formData, scheduledTimeStart: v })}
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>{t('timeline_visit_type')}</label>
        <select
          value={formData.visitType}
          onChange={(e) => setFormData({ ...formData, visitType: e.target.value })}
        >
          <option value="consultation">{t('timeline_visit_consultation')}</option>
          <option value="installation">{t('timeline_visit_installation')}</option>
          <option value="repair">{t('timeline_visit_repair')}</option>
          <option value="follow_up">{t('timeline_visit_follow_up')}</option>
        </select>
      </div>

      <p className={styles.hint}>
        {t('timeline_revision_hint')}
      </p>

      <div className={styles.formActions}>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('timeline_cancel')}
        </button>
        <button type="submit" className="btn-primary">
          {t('timeline_add')}
        </button>
      </div>
    </form>
  );
}

export default CustomerTimeline;
