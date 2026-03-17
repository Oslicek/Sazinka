import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { InboxFilterBar } from '../InboxFilterBar';
import {
  DEFAULT_FILTER_EXPRESSION,
  createEmptyExpression,
  type InboxFilterExpression,
  type FilterPresetId,
} from '@/pages/planningInboxFilters';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const defaultProps = {
  filters: DEFAULT_FILTER_EXPRESSION,
  onFiltersChange: vi.fn(),
  activePresetId: null as FilterPresetId | null,
  onPresetChange: vi.fn(),
  selectedRuleSetId: null as string | null,
  onRuleSetChange: vi.fn(),
  ruleSets: [
    { id: 'rs-1', name: 'Default', isDefault: true, isArchived: false },
    { id: 'rs-2', name: 'Custom', isDefault: false, isArchived: false },
  ],
  isLoadingRuleSets: false,
  candidateCount: 42,
};

describe('InboxFilterBar', () => {
  it('renders filter preset buttons', () => {
    render(<InboxFilterBar {...defaultProps} />);

    expect(screen.getByText('filter_all')).toBeInTheDocument();
    expect(screen.getByText('filter_urgent')).toBeInTheDocument();
    expect(screen.getByText('filter_this_week')).toBeInTheDocument();
    expect(screen.getByText('filter_this_month')).toBeInTheDocument();
    expect(screen.getByText('filter_has_term')).toBeInTheDocument();
    expect(screen.getByText('filter_problems')).toBeInTheDocument();
  });

  it('renders scoring selector with rule sets', () => {
    render(<InboxFilterBar {...defaultProps} />);

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(select).toHaveDisplayValue(/Default/);
  });

  it('renders candidate count', () => {
    render(<InboxFilterBar {...defaultProps} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('calls onPresetChange when preset clicked', () => {
    const onPresetChange = vi.fn();
    render(<InboxFilterBar {...defaultProps} onPresetChange={onPresetChange} />);

    fireEvent.click(screen.getByText('filter_urgent'));
    expect(onPresetChange).toHaveBeenCalledWith('URGENT');
  });

  it('calls onRuleSetChange when selector changes', () => {
    const onRuleSetChange = vi.fn();
    render(<InboxFilterBar {...defaultProps} onRuleSetChange={onRuleSetChange} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rs-2' } });
    expect(onRuleSetChange).toHaveBeenCalledWith('rs-2');
  });

  it('highlights active preset', () => {
    render(<InboxFilterBar {...defaultProps} activePresetId="URGENT" />);
    const urgentBtn = screen.getByText('filter_urgent');
    expect(urgentBtn.className).toMatch(/active/);
  });

  it('renders reset button disabled when no active filters', () => {
    render(<InboxFilterBar {...defaultProps} filters={createEmptyExpression()} />);
    expect(screen.getByText('Reset')).toBeDisabled();
  });

  it('shows advanced filters when expand button clicked', () => {
    render(<InboxFilterBar {...defaultProps} />);

    expect(screen.queryByText('filter_new_revision')).not.toBeInTheDocument();

    const expandBtn = screen.getByRole('button', { name: /filter_expand/i });
    fireEvent.click(expandBtn);

    expect(screen.getByText('filter_new_revision')).toBeInTheDocument();
    expect(screen.getByText('filter_appointment')).toBeInTheDocument();
    expect(screen.getByText('filter_route')).toBeInTheDocument();
  });

  it('calls onFiltersChange when time filter toggled in advanced panel', () => {
    const onFiltersChange = vi.fn();
    render(<InboxFilterBar {...defaultProps} onFiltersChange={onFiltersChange} />);

    fireEvent.click(screen.getByRole('button', { name: /filter_expand/i }));
    fireEvent.click(screen.getByText('filter_overdue'));

    expect(onFiltersChange).toHaveBeenCalled();
    const newFilters: InboxFilterExpression = onFiltersChange.mock.calls[0][0];
    expect(newFilters.groups.time.selected).toContain('OVERDUE');
  });

  it('calls onFiltersChange when appointment tristate changed', () => {
    const onFiltersChange = vi.fn();
    render(<InboxFilterBar {...defaultProps} onFiltersChange={onFiltersChange} />);

    fireEvent.click(screen.getByRole('button', { name: /filter_expand/i }));
    // "filter_has_term" appears in both presets and advanced panel; pick the one in the tristate section
    const hasTermButtons = screen.getAllByText('filter_has_term');
    fireEvent.click(hasTermButtons[hasTermButtons.length - 1]);

    expect(onFiltersChange).toHaveBeenCalled();
    const newFilters: InboxFilterExpression = onFiltersChange.mock.calls[0][0];
    expect(newFilters.groups.hasTerm).toBe('YES');
  });
});
