import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelineViewToggle } from './TimelineViewToggle';

describe('TimelineViewToggle', () => {
  it('calls onChange with compact when compact button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TimelineViewToggle value="planning" onChange={onChange} />);

    await user.click(screen.getByTitle('view_compact'));
    expect(onChange).toHaveBeenCalledWith('compact');
  });

  it('calls onChange with planning when planning button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TimelineViewToggle value="compact" onChange={onChange} />);

    await user.click(screen.getByTitle('view_planning'));
    expect(onChange).toHaveBeenCalledWith('planning');
  });

  it('marks active button via class for current value', () => {
    const { container } = render(<TimelineViewToggle value="compact" onChange={vi.fn()} />);

    const buttons = container.querySelectorAll('button');
    expect(buttons[0].className).toMatch(/active/);
    expect(buttons[1].className).not.toMatch(/active/);
  });
});
