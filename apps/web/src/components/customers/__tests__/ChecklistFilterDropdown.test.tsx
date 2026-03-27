/**
 * Phase 4A — ChecklistFilterDropdown component tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ChecklistFilterDropdown } from '../ChecklistFilterDropdown';
import type { ChecklistFilter } from '@shared/customer';
import type { CustomerServiceDeps } from '@/services/customerService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}(${JSON.stringify(opts)})` : key,
  }),
}));

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeps(values: string[], extra?: Partial<{ total: number; hasMore: boolean }>): CustomerServiceDeps {
  return {
    request: vi.fn().mockResolvedValue({
      payload: {
        column: 'city',
        values,
        total: extra?.total ?? values.length,
        hasMore: extra?.hasMore ?? false,
      },
    }),
  };
}

function makeErrorDeps(message = 'fetch failed'): CustomerServiceDeps {
  return {
    request: vi.fn().mockRejectedValue(new Error(message)),
  };
}

const defaultProps = {
  columnId: 'city',
  onApply: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ChecklistFilterDropdown', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state while fetching', async () => {
    // Never resolves
    const deps: CustomerServiceDeps = { request: vi.fn(() => new Promise(() => {})) };
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    expect(screen.getByTestId('checklist-loading')).toBeInTheDocument();
  });

  it('renders a checkbox for each distinct value', async () => {
    const deps = makeDeps(['Brno', 'Ostrava', 'Praha']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
  });

  it('toggles value in/out of selection on checkbox click', async () => {
    const deps = makeDeps(['Praha', 'Brno']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    const checkbox = screen.getAllByRole('checkbox')[0];
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('BUG-10: selected row exposes visible selected-state marker', async () => {
    const deps = makeDeps(['Praha', 'Brno']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    const checkbox = screen.getAllByRole('checkbox')[0];
    const row = screen.getByText('Praha').closest('label');
    expect(row).toHaveAttribute('data-selected', 'false');

    fireEvent.click(checkbox);
    expect(row).toHaveAttribute('data-selected', 'true');
  });

  it('BUG-10: multiple checked values are all visibly marked selected', async () => {
    const deps = makeDeps(['Praha', 'Brno', 'Ostrava']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]); // Praha
    fireEvent.click(checkboxes[1]); // Brno

    expect(screen.getByText('Praha').closest('label')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('Brno').closest('label')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('Ostrava').closest('label')).toHaveAttribute('data-selected', 'false');
  });

  it('search input filters visible checkboxes', async () => {
    const deps = makeDeps(['Praha', 'Brno', 'Ostrava']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'pra' } });

    // Only Praha should remain visible
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(1);
  });

  it('Select all selects all visible values', async () => {
    const deps = makeDeps(['Praha', 'Brno', 'Ostrava']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'filter_select_all' }));
    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => expect(cb).toBeChecked());
  });

  it('Deselect all deselects all values', async () => {
    const deps = makeDeps(['Praha', 'Brno']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    // Select all first, then deselect
    fireEvent.click(screen.getByRole('button', { name: 'filter_select_all' }));
    fireEvent.click(screen.getByRole('button', { name: 'filter_deselect_all' }));
    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => expect(cb).not.toBeChecked());
  });

  it('Select all when search narrows list only selects visible rows', async () => {
    const deps = makeDeps(['Praha', 'Brno', 'Ostrava']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    // Narrow to only Praha
    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'pra' } });
    fireEvent.click(screen.getByRole('button', { name: 'filter_select_all' }));

    // Clear search, apply — should have 1 value
    fireEvent.change(searchInput, { target: { value: '' } });
    const onApply = vi.fn();
    // Check the Apply button calls onApply with only Praha
    const applyBtn = screen.getByRole('button', { name: 'filter_apply' });
    const onApplyProp = vi.fn();
    // Re-render with spy
    render(
      <ChecklistFilterDropdown
        {...defaultProps}
        deps={deps}
        onApply={onApplyProp}
      />
    );
    await waitFor(() => expect(screen.queryAllByTestId('checklist-loading')).toHaveLength(0));
    const si2 = screen.getAllByRole('textbox')[1];
    fireEvent.change(si2, { target: { value: 'pra' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'filter_select_all' })[1]);
    fireEvent.change(si2, { target: { value: '' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'filter_apply' })[1]);
    expect(onApplyProp).toHaveBeenCalledWith(
      expect.objectContaining({ values: ['Praha'] })
    );
    void onApply;
  });

  it('Apply button calls onApply with selected values array', async () => {
    const onApply = vi.fn();
    const deps = makeDeps(['Praha', 'Brno']);
    render(<ChecklistFilterDropdown {...defaultProps} onApply={onApply} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('checkbox')[0]); // Praha
    fireEvent.click(screen.getByRole('button', { name: 'filter_apply' }));

    expect(onApply).toHaveBeenCalledWith({ type: 'checklist', column: 'city', values: ['Praha'] });
  });

  it('Apply button is disabled when nothing selected', async () => {
    const deps = makeDeps(['Praha']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'filter_apply' })).toBeDisabled();
  });

  it('Clear button calls onClear and onClose', async () => {
    const onClear = vi.fn();
    const onClose = vi.fn();
    const deps = makeDeps(['Praha']);
    render(
      <ChecklistFilterDropdown {...defaultProps} onClear={onClear} onClose={onClose} deps={deps} />
    );
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'filter_clear' }));
    expect(onClear).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('displays i18n label for type=company', async () => {
    const deps = makeDeps(['company', 'person']);
    render(<ChecklistFilterDropdown {...defaultProps} columnId="type" deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    expect(screen.getByText('customer_type_company')).toBeInTheDocument();
    expect(screen.getByText('customer_type_person')).toBeInTheDocument();
  });

  it('displays i18n label for geocodeStatus values', async () => {
    const deps = makeDeps(['success', 'pending', 'failed']);
    render(<ChecklistFilterDropdown {...defaultProps} columnId="geocodeStatus" deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    expect(screen.getByText('geocode_status_success')).toBeInTheDocument();
    expect(screen.getByText('geocode_status_pending')).toBeInTheDocument();
    expect(screen.getByText('geocode_status_failed')).toBeInTheDocument();
  });

  it('handles empty string values gracefully', async () => {
    const deps = makeDeps(['Praha', '']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    expect(screen.getByText('filter_empty_value')).toBeInTheDocument();
  });

  it('shows no-results message when search matches nothing', async () => {
    const deps = makeDeps(['Praha', 'Brno']);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'xyz_no_match' } });
    expect(screen.getByTestId('checklist-no-results')).toBeInTheDocument();
  });

  it('pre-selects values from existing filter (edit mode)', async () => {
    const currentFilter: ChecklistFilter = { type: 'checklist', column: 'city', values: ['Praha'] };
    const deps = makeDeps(['Praha', 'Brno']);
    render(
      <ChecklistFilterDropdown {...defaultProps} currentFilter={currentFilter} deps={deps} />
    );
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    const checkboxes = screen.getAllByRole('checkbox');
    // Praha (first) should be pre-checked
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    const deps = makeDeps(['Praha']);
    render(<ChecklistFilterDropdown {...defaultProps} onClose={onClose} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error UI on fetch failure', async () => {
    const deps = makeErrorDeps('network error');
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.getByTestId('checklist-error')).toBeInTheDocument());
    expect(screen.getByTestId('checklist-error')).toHaveTextContent('network error');
  });

  it('has aria-label and role attributes for accessibility', async () => {
    const deps = makeDeps([]);
    render(<ChecklistFilterDropdown {...defaultProps} deps={deps} />);
    await waitFor(() => expect(screen.queryByTestId('checklist-loading')).not.toBeInTheDocument());

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label');
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-label');
  });
});
