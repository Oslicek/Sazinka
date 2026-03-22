import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArrivalBufferBar } from './ArrivalBufferBar';

describe('ArrivalBufferBar', () => {
  it('expands on click and calls onChange with edited values on save', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ArrivalBufferBar percent={10} fixedMinutes={5} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /buffer_info/i }));

    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs.length).toBe(2);

    await user.clear(inputs[0]);
    await user.type(inputs[0], '25');
    await user.clear(inputs[1]);
    await user.type(inputs[1], '12');

    await user.click(screen.getByRole('button', { name: 'buffer_save' }));

    expect(onChange).toHaveBeenCalledWith(25, 12);
    expect(screen.queryByRole('button', { name: 'buffer_save' })).not.toBeInTheDocument();
  });

  it('cancel restores props and does not call onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ArrivalBufferBar percent={10} fixedMinutes={5} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /buffer_info/i }));

    const inputs = screen.getAllByRole('spinbutton');
    await user.clear(inputs[0]);
    await user.type(inputs[0], '99');

    await user.click(screen.getByRole('button', { name: 'buffer_cancel' }));

    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /buffer_info/i }));
    const inputsAfter = screen.getAllByRole('spinbutton');
    expect(inputsAfter[0]).toHaveValue(10);
    expect(inputsAfter[1]).toHaveValue(5);
  });

  it('syncs local edit state when props change while collapsed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    const { rerender } = render(<ArrivalBufferBar percent={10} fixedMinutes={5} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /buffer_info/i }));
    await user.click(screen.getByRole('button', { name: 'buffer_cancel' }));

    rerender(<ArrivalBufferBar percent={20} fixedMinutes={8} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /buffer_info/i }));
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs[0]).toHaveValue(20);
    expect(inputs[1]).toHaveValue(8);
  });
});
