import { useEffect, useMemo, useState } from 'react';
import type { Customer } from '@shared/customer';
import { listCustomers } from '@/services/customerService';
import { createVisit } from '@/services/visitService';
import styles from './QuickVisitDialog.module.css';

interface QuickVisitDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const VISIT_TYPE_OPTIONS = [
  { value: 'revision', label: 'Revize' },
  { value: 'consultation', label: 'Konzultace' },
  { value: 'installation', label: 'Instalace' },
  { value: 'repair', label: 'Oprava' },
  { value: 'follow_up', label: 'Následná návštěva' },
] as const;

export function QuickVisitDialog({ open, onClose, onCreated }: QuickVisitDialogProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [scheduledTimeStart, setScheduledTimeStart] = useState('');
  const [visitType, setVisitType] = useState<(typeof VISIT_TYPE_OPTIONS)[number]['value']>('consultation');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadCustomers() {
      try {
        setIsLoadingCustomers(true);
        setError(null);
        const response = await listCustomers({ limit: 1000, offset: 0 });
        if (!cancelled) {
          setCustomers(response.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Nepodařilo se načíst zákazníky');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCustomers(false);
        }
      }
    }

    void loadCustomers();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((customer) => {
      const name = customer.name?.toLowerCase() || '';
      const city = customer.city?.toLowerCase() || '';
      const street = customer.street?.toLowerCase() || '';
      return name.includes(query) || city.includes(query) || street.includes(query);
    });
  }, [customers, search]);

  const handleClose = () => {
    if (isSubmitting) return;
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId || !scheduledDate) return;
    try {
      setIsSubmitting(true);
      setError(null);
      await createVisit({
        customerId,
        scheduledDate,
        scheduledTimeStart: scheduledTimeStart || undefined,
        visitType,
      });
      onCreated();
      onClose();
      setSearch('');
      setCustomerId('');
      setScheduledTimeStart('');
      setVisitType('consultation');
      setScheduledDate(new Date().toISOString().slice(0, 10));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nepodařilo se vytvořit záznam');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.title}>Rychlý záznam</h3>
        <p className={styles.subtitle}>Vytvoří novou návštěvu v Záznamu práce.</p>

        {error && <div className={styles.error}>{error}</div>}

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Zákazník *</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Hledat zákazníka..."
              disabled={isLoadingCustomers || isSubmitting}
            />
          </label>

          <label className={styles.field}>
            <span>Vybraný zákazník *</span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              disabled={isLoadingCustomers || isSubmitting}
              required
            >
              <option value="">{isLoadingCustomers ? 'Načítám zákazníky...' : 'Vyberte zákazníka'}</option>
              {filteredCustomers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} {customer.city ? `(${customer.city})` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.row}>
            <label className={styles.field}>
              <span>Datum *</span>
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                disabled={isSubmitting}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Čas (volitelně)</span>
              <input
                type="time"
                value={scheduledTimeStart}
                onChange={(e) => setScheduledTimeStart(e.target.value)}
                disabled={isSubmitting}
              />
            </label>
          </div>

          <label className={styles.field}>
            <span>Typ návštěvy</span>
            <select
              value={visitType}
              onChange={(e) => setVisitType(e.target.value as (typeof VISIT_TYPE_OPTIONS)[number]['value'])}
              disabled={isSubmitting}
            >
              {VISIT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={handleClose} disabled={isSubmitting}>
              Zrušit
            </button>
            <button type="submit" className={styles.submitBtn} disabled={isSubmitting || isLoadingCustomers}>
              {isSubmitting ? 'Ukládám...' : 'Uložit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
