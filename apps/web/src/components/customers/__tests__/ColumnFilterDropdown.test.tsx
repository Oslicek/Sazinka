/**
 * Phase 4C — ColumnFilterDropdown wrapper tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ColumnFilterDropdown } from '../ColumnFilterDropdown';
import type { ColumnFilter } from '@shared/customer';
import type { CustomerServiceDeps } from '@/services/customerService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
  getUserId: () => 'test-user-id',
  hasRole: () => true,
}));

// Stub the child dropdowns so we can assert which one renders
vi.mock('../ChecklistFilterDropdown', () => ({
  ChecklistFilterDropdown: ({ columnId }: { columnId: string }) => (
    <div data-testid="checklist-dropdown" data-column={columnId} />
  ),
}));

vi.mock('../DateRangeFilterDropdown', () => ({
  DateRangeFilterDropdown: ({ columnId }: { columnId: string }) => (
    <div data-testid="date-range-dropdown" data-column={columnId} />
  ),
}));

const defaultProps = {
  columnId: 'city',
  onApply: vi.fn(),
  onClear: vi.fn(),
  onClose: vi.fn(),
};

describe('ColumnFilterDropdown', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders ChecklistFilterDropdown for checklist columns', () => {
    for (const col of ['name', 'type', 'city', 'street', 'postalCode', 'phone', 'email', 'geocodeStatus', 'deviceCount']) {
      const { unmount } = render(<ColumnFilterDropdown {...defaultProps} columnId={col} />);
      expect(screen.getByTestId('checklist-dropdown')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders DateRangeFilterDropdown for dateRange columns', () => {
    for (const col of ['createdAt', 'nextRevision']) {
      const { unmount } = render(<ColumnFilterDropdown {...defaultProps} columnId={col} />);
      expect(screen.getByTestId('date-range-dropdown')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders nothing for unknown column', () => {
    const { container } = render(<ColumnFilterDropdown {...defaultProps} columnId="unknown_col" />);
    expect(container.firstChild).toBeNull();
  });

  it('passes columnId to the child dropdown', () => {
    render(<ColumnFilterDropdown {...defaultProps} columnId="city" />);
    expect(screen.getByTestId('checklist-dropdown')).toHaveAttribute('data-column', 'city');
  });

  it('passes initial checklist filter to ChecklistFilterDropdown (edit mode)', () => {
    const currentFilter: ColumnFilter = { type: 'checklist', column: 'city', values: ['Praha'] };
    // We just verify no crash and checklist is rendered
    render(
      <ColumnFilterDropdown {...defaultProps} columnId="city" currentFilter={currentFilter} />
    );
    expect(screen.getByTestId('checklist-dropdown')).toBeInTheDocument();
  });

  it('passes initial dateRange filter to DateRangeFilterDropdown (edit mode)', () => {
    const currentFilter: ColumnFilter = { type: 'dateRange', column: 'createdAt', from: '2024-01-01' };
    render(
      <ColumnFilterDropdown {...defaultProps} columnId="createdAt" currentFilter={currentFilter} />
    );
    expect(screen.getByTestId('date-range-dropdown')).toBeInTheDocument();
  });
});
