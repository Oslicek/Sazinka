import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetachButton } from '../DetachButton';

describe('DetachButton', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a button', () => {
    render(<DetachButton panelUrl="/inbox/map" windowName="sazinka-inbox-map" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls window.open with correct url and windowName on click', () => {
    const mockWin = { closed: false, focus: vi.fn() } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWin);

    render(<DetachButton panelUrl="/inbox/map" windowName="sazinka-inbox-map" />);
    fireEvent.click(screen.getByRole('button'));

    expect(openSpy).toHaveBeenCalledWith('/inbox/map', 'sazinka-inbox-map', expect.any(String));
  });

  it('calls onDetach callback after opening window', () => {
    const mockWin = { closed: false, focus: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(mockWin);
    const onDetach = vi.fn();

    render(
      <DetachButton panelUrl="/inbox/map" windowName="sazinka-inbox-map" onDetach={onDetach} />,
    );
    fireEvent.click(screen.getByRole('button'));

    expect(onDetach).toHaveBeenCalledOnce();
  });

  it('does not open duplicate window if same windowName is already open', () => {
    const mockWin = { closed: false, focus: vi.fn() } as unknown as Window;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockWin);

    render(<DetachButton panelUrl="/inbox/map" windowName="sazinka-inbox-map" />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(mockWin.focus).toHaveBeenCalledTimes(1);
  });
});
