/**
 * VirtualizedInboxList tests — Virtuoso is mocked to render all rows in document order.
 */
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CandidateRowData } from './CandidateRow';
import { VirtualizedInboxList } from './VirtualizedInboxList';

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
    components,
  }: {
    data: CandidateRowData[];
    itemContent: (index: number, item: CandidateRowData) => ReactNode;
    components?: { Footer?: () => ReactNode };
  }) => (
    <div data-testid="virtuoso-mock">
      {data.map((item, index) => (
        <div key={item.id} data-index={index}>
          {itemContent(index, item)}
        </div>
      ))}
      {components?.Footer ? <components.Footer /> : null}
    </div>
  ),
}));

function row(id: string, name: string): CandidateRowData {
  return {
    id,
    customerName: name,
    city: 'City',
    daysUntilDue: 5,
    hasPhone: true,
    hasValidAddress: true,
    priority: 'upcoming',
  };
}

describe('VirtualizedInboxList', () => {
  const candidates = [row('a', 'Alpha'), row('b', 'Beta'), row('c', 'Gamma')];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no candidates', () => {
    render(
      <VirtualizedInboxList
        candidates={[]}
        selectedCandidateId={null}
        onCandidateSelect={vi.fn()}
        emptyMessage="Nothing here"
      />
    );

    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('calls onCandidateSelect when a row is clicked', async () => {
    const onCandidateSelect = vi.fn();

    render(
      <VirtualizedInboxList
        candidates={candidates}
        selectedCandidateId={null}
        onCandidateSelect={onCandidateSelect}
      />
    );

    await screen.findByText('Beta');
    fireEvent.click(screen.getByText('Beta'));

    expect(onCandidateSelect).toHaveBeenCalledWith('b');
  });

  it('ArrowDown moves selection to next candidate', () => {
    const onCandidateSelect = vi.fn();

    render(
      <VirtualizedInboxList
        candidates={candidates}
        selectedCandidateId="a"
        onCandidateSelect={onCandidateSelect}
      />
    );

    const firstRow = screen.getByRole('button', { name: /Alpha/i });
    fireEvent.keyDown(firstRow, { key: 'ArrowDown' });

    expect(onCandidateSelect).toHaveBeenCalledWith('b');
  });

  it('ArrowUp moves selection to previous candidate', () => {
    const onCandidateSelect = vi.fn();

    render(
      <VirtualizedInboxList
        candidates={candidates}
        selectedCandidateId="b"
        onCandidateSelect={onCandidateSelect}
      />
    );

    const secondRow = screen.getByRole('button', { name: /Beta/i });
    fireEvent.keyDown(secondRow, { key: 'ArrowUp' });

    expect(onCandidateSelect).toHaveBeenCalledWith('a');
  });

  it('calls onSelectionChange when checkbox toggled', async () => {
    const onSelectionChange = vi.fn();

    render(
      <VirtualizedInboxList
        candidates={candidates}
        selectedCandidateId={null}
        onCandidateSelect={vi.fn()}
        selectable
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
      />
    );

    const checkbox = screen.getAllByRole('checkbox')[1];
    fireEvent.click(checkbox);

    expect(onSelectionChange).toHaveBeenCalledWith('b', true);
  });

  it('shows load more when hasMore and onLoadMore', () => {
    const onLoadMore = vi.fn();

    render(
      <VirtualizedInboxList
        candidates={candidates}
        selectedCandidateId={null}
        onCandidateSelect={vi.fn()}
        hasMore
        onLoadMore={onLoadMore}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'inbox_load_more' }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('shows loading footer when isLoading', () => {
    render(
      <VirtualizedInboxList
        candidates={candidates}
        selectedCandidateId={null}
        onCandidateSelect={vi.fn()}
        isLoading
      />
    );

    expect(screen.getByText('inbox_loading')).toBeInTheDocument();
  });
});
