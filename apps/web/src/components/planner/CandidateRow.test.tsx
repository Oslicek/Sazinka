import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CandidateRow, type CandidateRowData } from './CandidateRow';

function candidate(overrides: Partial<CandidateRowData> = {}): CandidateRowData {
  return {
    id: 'c1',
    customerName: 'Novák',
    city: 'Praha',
    daysUntilDue: 5,
    hasPhone: true,
    hasValidAddress: true,
    priority: 'upcoming',
    ...overrides,
  };
}

describe('CandidateRow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders candidate name', () => {
    render(<CandidateRow candidate={candidate()} />);
    expect(screen.getByText('Novák')).toBeInTheDocument();
  });

  describe('BUG-7: checkbox inside button is not clickable', () => {
    it('row element is not a native <button> when selectable (avoids nested interactive content)', () => {
      render(
        <CandidateRow
          candidate={candidate()}
          selectable
          checked={false}
          onCheckChange={vi.fn()}
        />
      );

      const row = screen.getByRole('button');
      expect(row.tagName).not.toBe('BUTTON');
    });

    it('clicking checkbox fires onCheckChange without firing row onClick', () => {
      const onClick = vi.fn();
      const onCheckChange = vi.fn();

      render(
        <CandidateRow
          candidate={candidate()}
          selectable
          checked={false}
          onClick={onClick}
          onCheckChange={onCheckChange}
        />
      );

      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      expect(onCheckChange).toHaveBeenCalledWith(true);
      expect(onClick).not.toHaveBeenCalled();
    });
  });
});
