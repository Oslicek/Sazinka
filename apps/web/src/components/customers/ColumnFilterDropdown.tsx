import type { ColumnFilter, ColumnDistinctRequest, ChecklistFilter, DateRangeFilter } from '@shared/customer';
import type { CustomerServiceDeps } from '@/services/customerService';
import { getFilterType } from '@/lib/customerColumns';
import { ChecklistFilterDropdown } from './ChecklistFilterDropdown';
import { DateRangeFilterDropdown } from './DateRangeFilterDropdown';

export interface ColumnFilterDropdownProps {
  columnId: string;
  /** The current active filter for this column (for edit-mode pre-population). */
  currentFilter?: ColumnFilter | null;
  /** Context filters for narrowing distinct values (for the checklist dropdown). */
  contextRequest?: Omit<ColumnDistinctRequest, 'column'>;
  onApply: (filter: ColumnFilter) => void;
  onClear: () => void;
  onClose: () => void;
  /** Injectable service deps for testing (passed to ChecklistFilterDropdown). */
  deps?: CustomerServiceDeps;
}

/**
 * Wrapper that renders the correct filter dropdown based on the column's filterType.
 * - 'checklist' columns → ChecklistFilterDropdown
 * - 'dateRange' columns → DateRangeFilterDropdown
 */
export function ColumnFilterDropdown({
  columnId,
  currentFilter,
  contextRequest,
  onApply,
  onClear,
  onClose,
  deps,
}: ColumnFilterDropdownProps) {
  const filterType = getFilterType(columnId);

  if (filterType === 'checklist') {
    return (
      <ChecklistFilterDropdown
        columnId={columnId}
        currentFilter={currentFilter?.type === 'checklist' ? (currentFilter as ChecklistFilter) : null}
        contextRequest={contextRequest}
        onApply={onApply}
        onClear={onClear}
        onClose={onClose}
        deps={deps}
      />
    );
  }

  if (filterType === 'dateRange') {
    return (
      <DateRangeFilterDropdown
        columnId={columnId}
        currentFilter={currentFilter?.type === 'dateRange' ? (currentFilter as DateRangeFilter) : null}
        onApply={onApply}
        onClear={onClear}
        onClose={onClose}
      />
    );
  }

  // Unknown column — render nothing
  return null;
}
