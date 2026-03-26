/**
 * Phase 4B — DateRangeFilterDropdown component tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DateRangeFilterDropdown } from '../DateRangeFilterDropdown';
import type { DateRangeFilter } from '@shared/customer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const defaultProps = {
  columnId: 'createdAt',
  onApply: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
};

describe('DateRangeFilterDropdown', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders two date inputs (From and To)', () => {
    render(<DateRangeFilterDropdown {...defaultProps} />);
    expect(screen.getByLabelText('filter_date_from')).toBeInTheDocument();
    expect(screen.getByLabelText('filter_date_to')).toBeInTheDocument();
  });

  it('Apply button calls onApply with { from, to } when both set', () => {
    const onApply = vi.fn();
    render(<DateRangeFilterDropdown {...defaultProps} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('filter_date_from'), { target: { value: '2024-01-01' } });
    fireEvent.change(screen.getByLabelText('filter_date_to'), { target: { value: '2024-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'filter_apply' }));

    expect(onApply).toHaveBeenCalledWith({
      type: 'dateRange',
      column: 'createdAt',
      from: '2024-01-01',
      to: '2024-12-31',
    });
  });

  it('Apply button calls onApply with only from when to is empty (open-ended)', () => {
    const onApply = vi.fn();
    render(<DateRangeFilterDropdown {...defaultProps} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('filter_date_from'), { target: { value: '2024-06-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'filter_apply' }));

    expect(onApply).toHaveBeenCalledWith({
      type: 'dateRange',
      column: 'createdAt',
      from: '2024-06-01',
    });
  });

  it('Apply button calls onApply with only to when from is empty (open-ended)', () => {
    const onApply = vi.fn();
    render(<DateRangeFilterDropdown {...defaultProps} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('filter_date_to'), { target: { value: '2024-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'filter_apply' }));

    expect(onApply).toHaveBeenCalledWith({
      type: 'dateRange',
      column: 'createdAt',
      to: '2024-12-31',
    });
  });

  it('Apply button is disabled when both inputs are empty', () => {
    render(<DateRangeFilterDropdown {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'filter_apply' })).toBeDisabled();
  });

  it('Apply is disabled when from > to (invalid range)', () => {
    render(<DateRangeFilterDropdown {...defaultProps} />);

    fireEvent.change(screen.getByLabelText('filter_date_from'), { target: { value: '2024-12-31' } });
    fireEvent.change(screen.getByLabelText('filter_date_to'), { target: { value: '2024-01-01' } });

    expect(screen.getByRole('button', { name: 'filter_apply' })).toBeDisabled();
  });

  it('shows validation error when from > to', () => {
    render(<DateRangeFilterDropdown {...defaultProps} />);

    fireEvent.change(screen.getByLabelText('filter_date_from'), { target: { value: '2024-12-31' } });
    fireEvent.change(screen.getByLabelText('filter_date_to'), { target: { value: '2024-01-01' } });

    expect(screen.getByTestId('date-range-error')).toBeInTheDocument();
    expect(screen.getByTestId('date-range-error')).toHaveTextContent('filter_date_range_invalid');
  });

  it('same day from = to is valid (inclusive single day)', () => {
    const onApply = vi.fn();
    render(<DateRangeFilterDropdown {...defaultProps} onApply={onApply} />);

    fireEvent.change(screen.getByLabelText('filter_date_from'), { target: { value: '2024-06-15' } });
    fireEvent.change(screen.getByLabelText('filter_date_to'), { target: { value: '2024-06-15' } });

    expect(screen.getByRole('button', { name: 'filter_apply' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'filter_apply' }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2024-06-15', to: '2024-06-15' })
    );
  });

  it('Clear button calls onClear and onClose', () => {
    const onClear = vi.fn();
    const onClose = vi.fn();
    render(<DateRangeFilterDropdown {...defaultProps} onClear={onClear} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'filter_clear' }));
    expect(onClear).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('pre-populates from an existing filter (edit mode)', () => {
    const currentFilter: DateRangeFilter = {
      type: 'dateRange',
      column: 'createdAt',
      from: '2024-03-01',
      to: '2024-03-31',
    };
    render(<DateRangeFilterDropdown {...defaultProps} currentFilter={currentFilter} />);

    expect(screen.getByLabelText('filter_date_from')).toHaveValue('2024-03-01');
    expect(screen.getByLabelText('filter_date_to')).toHaveValue('2024-03-31');
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<DateRangeFilterDropdown {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('has role="dialog" with aria-label', () => {
    render(<DateRangeFilterDropdown {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label');
  });
});
