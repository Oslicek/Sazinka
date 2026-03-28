import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { CollapseButton } from '../common';
import {
  FILTER_PRESETS,
  toggleToken,
  getActiveFilterCount,
  hasAdvancedCriteria,
  buildFilterSummary,
  applyFilterPreset,
  type InboxFilterExpression,
  type FilterPresetId,
  type GroupOperator,
  type TriState,
  type TimeToken,
  type ProblemToken,
} from '@/pages/planningInboxFilters';
import type { ScoringRuleSet } from '@/services/scoringService';
import { sortRuleSetsForDisplay } from '@/lib/scoringPresetOrder';
import styles from './InboxFilterBar.module.css';

interface InboxFilterBarProps {
  filters: InboxFilterExpression;
  onFiltersChange: (filters: InboxFilterExpression) => void;
  activePresetId: FilterPresetId | null;
  onPresetChange: (presetId: FilterPresetId) => void;
  selectedRuleSetId: string | null;
  onRuleSetChange: (id: string | null) => void;
  ruleSets: ScoringRuleSet[];
  isLoadingRuleSets: boolean;
  candidateCount: number;
  /** Optional controlled prop — if provided, InboxListPanel owns the open state */
  isAdvancedOpen?: boolean;
  /** Called when the expand/collapse button is clicked (controlled mode) */
  onToggleAdvanced?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export function InboxFilterBar({
  filters,
  onFiltersChange,
  activePresetId,
  onPresetChange,
  selectedRuleSetId,
  onRuleSetChange,
  ruleSets,
  isLoadingRuleSets,
  candidateCount,
  isAdvancedOpen: isAdvancedOpenProp,
  onToggleAdvanced,
  searchQuery = '',
  onSearchChange,
}: InboxFilterBarProps) {
  const { t } = useTranslation('planner');
  const [isAdvancedOpenState, setIsAdvancedOpenState] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Controlled if parent passes the prop; otherwise use internal state
  const isAdvancedOpen = isAdvancedOpenProp !== undefined ? isAdvancedOpenProp : isAdvancedOpenState;
  const handleToggleAdvanced = () => {
    if (onToggleAdvanced) onToggleAdvanced();
    else setIsAdvancedOpenState((prev) => !prev);
  };

  const handleSearchToggle = useCallback(() => {
    setIsSearchOpen((prev) => {
      if (prev && onSearchChange) onSearchChange('');
      return !prev;
    });
  }, [onSearchChange]);

  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus();
  }, [isSearchOpen]);

  const activeFilterCount = getActiveFilterCount(filters);
  const hasAdvancedActive = hasAdvancedCriteria(filters);
  const filterSummary = buildFilterSummary(filters);
  const sortedRuleSets = sortRuleSetsForDisplay(ruleSets);

  const clearFilters = useCallback(() => {
    onFiltersChange(applyFilterPreset('ALL'));
    onPresetChange('ALL');
  }, [onFiltersChange, onPresetChange]);

  const toggleTimeFilter = useCallback((value: TimeToken) => {
    onFiltersChange({
      ...filters,
      groups: {
        ...filters.groups,
        time: {
          ...filters.groups.time,
          enabled: true,
          selected: toggleToken(filters.groups.time.selected, value),
        },
      },
    });
  }, [filters, onFiltersChange]);

  const clearTimeFilters = useCallback(() => {
    onFiltersChange({
      ...filters,
      groups: {
        ...filters.groups,
        time: { ...filters.groups.time, enabled: false, selected: [] },
      },
    });
  }, [filters, onFiltersChange]);

  const toggleProblemFilter = useCallback((value: ProblemToken) => {
    onFiltersChange({
      ...filters,
      groups: {
        ...filters.groups,
        problems: {
          ...filters.groups.problems,
          enabled: true,
          selected: toggleToken(filters.groups.problems.selected, value),
        },
      },
    });
  }, [filters, onFiltersChange]);

  const setTriState = useCallback((field: 'hasTerm' | 'inRoute', value: TriState) => {
    onFiltersChange({
      ...filters,
      groups: { ...filters.groups, [field]: value },
    });
  }, [filters, onFiltersChange]);

  const setRootOperator = useCallback((value: 'AND' | 'OR') => {
    onFiltersChange({ ...filters, rootOperator: value });
  }, [filters, onFiltersChange]);

  const setGroupOperator = useCallback((group: 'time' | 'problems', value: GroupOperator) => {
    onFiltersChange({
      ...filters,
      groups: {
        ...filters.groups,
        [group]: { ...filters.groups[group], operator: value },
      },
    });
  }, [filters, onFiltersChange]);

  return (
    <div className={styles.filterPanel}>
      <div className={styles.filterPanelHeader}>
        <div className={styles.filterPresets}>
          {FILTER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`${styles.filterChip} ${activePresetId === preset.id ? styles.active : ''}`}
              onClick={() => onPresetChange(preset.id)}
            >
              {t(preset.label)}
            </button>
          ))}
        </div>
        <div className={styles.scoringSelector}>
          <label className={styles.scoringSelectorLabel}>{t('scoring_selector_label')}:</label>
          <select
            className={styles.scoringSelectorSelect}
            value={selectedRuleSetId ?? ''}
            onChange={(e) => onRuleSetChange(e.target.value || null)}
            disabled={isLoadingRuleSets}
          >
            {sortedRuleSets.map((rs) => {
              const displayName = rs.systemKey
                ? t(`scoring_preset_name_${rs.systemKey}`)
                : rs.name;
              return (
                <option key={rs.id} value={rs.id}>
                  {rs.isDefault ? `${t('scoring_default_marker')} ` : ''}{displayName}
                </option>
              );
            })}
          </select>
        </div>
        <button
          type="button"
          className={`${styles.searchToggle} ${isSearchOpen ? styles.active : ''}`}
          onClick={handleSearchToggle}
          title={t('inbox_search_toggle')}
          aria-label={t('inbox_search_toggle')}
          aria-expanded={isSearchOpen}
          data-testid="inbox-search-toggle"
        >
          <Search size={14} />
        </button>
        {isSearchOpen && (
          <input
            ref={searchInputRef}
            type="text"
            className={styles.searchInput}
            placeholder={t('inbox_search_placeholder')}
            aria-label={t('inbox_search_placeholder')}
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            data-testid="inbox-search-input"
          />
        )}
        <span className={styles.filterResults}>
          {candidateCount}
          {activeFilterCount > 0 && !isAdvancedOpen && hasAdvancedActive && (
            <span className={styles.advancedHint} title={t('filter_advanced_hint')}>*</span>
          )}
        </span>
        <button
          type="button"
          className={styles.filterResetButton}
          onClick={clearFilters}
          disabled={activeFilterCount === 0}
          title={t('filter_reset')}
        >
          Reset
        </button>
        <CollapseButton
          collapsed={!isAdvancedOpen}
          onClick={handleToggleAdvanced}
          title={isAdvancedOpen ? t('filter_collapse') : t('filter_expand')}
        />
      </div>

      {isAdvancedOpen && (
        <div className={styles.filterExpandedSection}>
          <div className={styles.filterGroup}>
            <span className={styles.filterGroupLabel}>{t('filter_new_revision')}</span>
            <div className={styles.filterChips}>
              <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('OVERDUE') ? styles.active : ''}`} onClick={() => toggleTimeFilter('OVERDUE')}>{t('filter_overdue')}</button>
              <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('DUE_IN_7_DAYS') ? styles.active : ''}`} onClick={() => toggleTimeFilter('DUE_IN_7_DAYS')}>{t('filter_due_7_days')}</button>
              <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.includes('DUE_IN_30_DAYS') ? styles.active : ''}`} onClick={() => toggleTimeFilter('DUE_IN_30_DAYS')}>{t('filter_due_30_days')}</button>
              <button type="button" className={`${styles.filterChip} ${filters.groups.time.selected.length === 0 ? styles.active : ''}`} onClick={() => clearTimeFilters()}>{t('filter_anytime')}</button>
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterGroupLabel}>{t('filter_appointment')}</span>
            <div className={styles.filterTriState}>
              <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'ANY' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'ANY')}>{t('filter_any')}</button>
              <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'YES' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'YES')}>{t('filter_has_term')}</button>
              <button type="button" className={`${styles.filterChip} ${filters.groups.hasTerm === 'NO' ? styles.active : ''}`} onClick={() => setTriState('hasTerm', 'NO')}>{t('filter_no_appointment')}</button>
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterGroupLabel}>{t('filter_route')}</span>
            <div className={styles.filterTriState}>
              <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'ANY' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'ANY')}>{t('filter_any')}</button>
              <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'YES' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'YES')}>{t('filter_in_route')}</button>
              <button type="button" className={`${styles.filterChip} ${filters.groups.inRoute === 'NO' ? styles.active : ''}`} onClick={() => setTriState('inRoute', 'NO')}>{t('filter_not_in_route')}</button>
            </div>
          </div>

          <div className={styles.advancedPanel}>
            <div className={styles.advancedPanelHeader}>{t('filter_advanced')}</div>

            <div className={styles.advancedRow}>
              <span className={styles.filterGroupLabel}>{t('filter_group_logic')}</span>
              <div className={styles.rootOperatorSwitch}>
                <button type="button" className={`${styles.operatorButton} ${filters.rootOperator === 'AND' ? styles.active : ''}`} onClick={() => setRootOperator('AND')}>AND</button>
                <button type="button" className={`${styles.operatorButton} ${filters.rootOperator === 'OR' ? styles.active : ''}`} onClick={() => setRootOperator('OR')}>OR</button>
              </div>
            </div>

            <div className={styles.advancedRow}>
              <span className={styles.filterGroupLabel}>{t('filter_revision_logic')}</span>
              <div className={styles.groupOperatorSwitch}>
                <button type="button" className={`${styles.operatorButton} ${filters.groups.time.operator === 'OR' ? styles.active : ''}`} onClick={() => setGroupOperator('time', 'OR')}>OR</button>
                <button type="button" className={`${styles.operatorButton} ${filters.groups.time.operator === 'AND' ? styles.active : ''}`} onClick={() => setGroupOperator('time', 'AND')}>AND</button>
              </div>
            </div>

            <div className={styles.filterGroup}>
              <span className={styles.filterGroupLabel}>{t('filter_problems_label')}</span>
              <div className={styles.groupOperatorSwitch}>
                <button type="button" className={`${styles.operatorButton} ${filters.groups.problems.operator === 'OR' ? styles.active : ''}`} onClick={() => setGroupOperator('problems', 'OR')}>OR</button>
                <button type="button" className={`${styles.operatorButton} ${filters.groups.problems.operator === 'AND' ? styles.active : ''}`} onClick={() => setGroupOperator('problems', 'AND')}>AND</button>
              </div>
              <div className={styles.filterChips}>
                <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('MISSING_PHONE') ? styles.active : ''}`} onClick={() => toggleProblemFilter('MISSING_PHONE')}>{t('filter_missing_phone')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('ADDRESS_ISSUE') ? styles.active : ''}`} onClick={() => toggleProblemFilter('ADDRESS_ISSUE')}>{t('filter_address_issue')}</button>
                <button type="button" className={`${styles.filterChip} ${filters.groups.problems.selected.includes('GEOCODE_FAILED') ? styles.active : ''}`} onClick={() => toggleProblemFilter('GEOCODE_FAILED')}>{t('filter_geocode_failed')}</button>
              </div>
            </div>

            <div className={styles.filterSummaryText}>{filterSummary}</div>
          </div>
        </div>
      )}
    </div>
  );
}
