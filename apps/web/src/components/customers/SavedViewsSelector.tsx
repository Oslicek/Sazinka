/**
 * SavedViewsSelector - Dropdown for saved filter views
 * 
 * Predefined views:
 * - Bez adresy (geocodeStatus: failed)
 * - Nelze lokalizovat (geocodeStatus: failed | pending)
 * - Po termínu (hasOverdue: true)
 * - Firmy (type: company)
 */

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './SavedViewsSelector.module.css';

export interface SavedView {
  id: string;
  nameKey: string;
  filters: {
    geocodeStatus?: 'success' | 'failed' | 'pending' | '';
    revisionFilter?: 'overdue' | 'week' | 'month' | '';
    type?: 'company' | 'person' | '';
  };
}

// Predefined saved views
const PREDEFINED_VIEWS: SavedView[] = [
  {
    id: 'all',
    nameKey: 'saved_view_all',
    filters: {},
  },
  {
    id: 'no-address',
    nameKey: 'saved_view_no_address',
    filters: { geocodeStatus: 'failed' },
  },
  {
    id: 'pending-geocode',
    nameKey: 'saved_view_pending_geocode',
    filters: { geocodeStatus: 'pending' },
  },
  {
    id: 'overdue',
    nameKey: 'saved_view_overdue',
    filters: { revisionFilter: 'overdue' },
  },
  {
    id: 'due-week',
    nameKey: 'saved_view_due_week',
    filters: { revisionFilter: 'week' },
  },
  {
    id: 'companies',
    nameKey: 'saved_view_companies',
    filters: { type: 'company' },
  },
];

interface SavedViewsSelectorProps {
  currentFilters: SavedView['filters'];
  onSelectView: (view: SavedView) => void;
}

export function SavedViewsSelector({
  currentFilters,
  onSelectView,
}: SavedViewsSelectorProps) {
  const { t } = useTranslation('customers');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Find current matching view
  const currentView = PREDEFINED_VIEWS.find(view => {
    const f = view.filters;
    return (
      (f.geocodeStatus || '') === (currentFilters.geocodeStatus || '') &&
      (f.revisionFilter || '') === (currentFilters.revisionFilter || '') &&
      (f.type || '') === (currentFilters.type || '')
    );
  }) || PREDEFINED_VIEWS[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className={styles.container} ref={dropdownRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span className={styles.icon}>📋</span>
        <span className={styles.label}>{t(currentView.nameKey)}</span>
        <span className={`${styles.arrow} ${isOpen ? styles.arrowOpen : ''}`}>▾</span>
      </button>

      {isOpen && (
        <div className={styles.dropdown} role="listbox">
          <div className={styles.dropdownHeader}>{t('saved_views_header')}</div>
          {PREDEFINED_VIEWS.map(view => (
            <button
              key={view.id}
              type="button"
              className={`${styles.option} ${view.id === currentView.id ? styles.selected : ''}`}
              onClick={() => {
                onSelectView(view);
                setIsOpen(false);
              }}
              role="option"
              aria-selected={view.id === currentView.id}
            >
              <span className={styles.optionIcon}>
                {getViewIcon(view.id)}
              </span>
              <span className={styles.optionName}>{t(view.nameKey)}</span>
              {view.id === currentView.id && (
                <span className={styles.checkmark}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getViewIcon(viewId: string): string {
  switch (viewId) {
    case 'all': return '👥';
    case 'no-address': return '⚠';
    case 'pending-geocode': return '⏳';
    case 'overdue': return '🔴';
    case 'due-week': return '🟡';
    case 'companies': return '🏢';
    default: return '📋';
  }
}
