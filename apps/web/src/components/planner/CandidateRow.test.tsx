import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CandidateRow, type CandidateRowData } from './CandidateRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

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

  describe('BUG-13: disabled checkbox tooltip', () => {
    it('disabled checkbox shows tooltip on click', () => {
      const onClick = vi.fn();
      render(
        <CandidateRow
          candidate={candidate({ disableCheckbox: true })}
          selectable
          checked={false}
          onClick={onClick}
        />
      );

      const wrapper = screen.getByRole('presentation');
      fireEvent.click(wrapper);

      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      expect(screen.getByRole('tooltip')).toHaveTextContent('candidate_row_checkbox_disabled');
      expect(onClick).not.toHaveBeenCalled();
    });

    it('tooltip disappears after timeout', () => {
      vi.useFakeTimers();
      render(
        <CandidateRow
          candidate={candidate({ disableCheckbox: true })}
          selectable
          checked={false}
        />
      );

      const wrapper = screen.getByRole('presentation');
      fireEvent.click(wrapper);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      vi.useRealTimers();
    });

    it('enabled checkbox has no wrapper and no tooltip', () => {
      render(
        <CandidateRow
          candidate={candidate({ disableCheckbox: false })}
          selectable
          checked={false}
        />
      );

      expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });
});
