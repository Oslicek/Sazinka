import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DetachButton } from '../DetachButton';

describe('DetachButton', () => {
  it('renders a button with accessible label', () => {
    render(<DetachButton onDetach={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Open in new window' });
    expect(btn).toBeInTheDocument();
  });

  it('calls onDetach callback on click', () => {
    const onDetach = vi.fn();
    render(<DetachButton onDetach={onDetach} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onDetach).toHaveBeenCalledOnce();
  });

  it('passes data-testid to the button element', () => {
    render(<DetachButton onDetach={vi.fn()} data-testid="detach-map" />);
    expect(screen.getByTestId('detach-map')).toBeInTheDocument();
  });

  it('passes className to the button element', () => {
    render(<DetachButton onDetach={vi.fn()} className="custom-class" />);
    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });
});
