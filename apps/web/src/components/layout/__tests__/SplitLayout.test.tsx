import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitLayout } from '../SplitLayout';

beforeEach(() => {
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
});

describe('SplitLayout', () => {
  it('renders two panels side by side', () => {
    render(<SplitLayout left={<div>Left</div>} right={<div>Right</div>} />);
    expect(screen.getByText('Left')).toBeInTheDocument();
    expect(screen.getByText('Right')).toBeInTheDocument();
  });

  it('left panel takes leftWidth percentage', () => {
    const { container } = render(
      <SplitLayout left={<div>Left</div>} right={<div>Right</div>} leftWidth={40} />
    );
    const leftPane = container.querySelector('[class*="leftPane"]') as HTMLElement;
    expect(leftPane.style.width).toBe('40%');
  });

  it('right panel takes remaining width (flex: 1)', () => {
    const { container } = render(
      <SplitLayout left={<div>Left</div>} right={<div>Right</div>} />
    );
    const rightPane = container.querySelector('[class*="rightPane"]') as HTMLElement;
    expect(rightPane).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <SplitLayout left={<div>L</div>} right={<div>R</div>} className="my-class" />
    );
    expect(container.firstChild).toHaveClass('my-class');
  });

  it('supports custom split ratio (e.g., 40/60)', () => {
    const { container } = render(
      <SplitLayout left={<div>Left</div>} right={<div>Right</div>} leftWidth={40} />
    );
    const leftPane = container.querySelector('[class*="leftPane"]') as HTMLElement;
    expect(leftPane.style.width).toBe('40%');
  });

  it('renders children in correct order (left then right)', () => {
    const { container } = render(
      <SplitLayout left={<div>Left</div>} right={<div>Right</div>} />
    );
    const panes = container.querySelectorAll('[class*="leftPane"], [class*="rightPane"]');
    expect(panes[0]).toHaveTextContent('Left');
    expect(panes[1]).toHaveTextContent('Right');
  });

  it('shows drag handle when resizable=true', () => {
    const { container } = render(
      <SplitLayout left={<div>Left</div>} right={<div>Right</div>} resizable={true} />
    );
    expect(container.querySelector('[class*="divider"]')).toBeInTheDocument();
  });

  it('hides drag handle when resizable=false', () => {
    const { container } = render(
      <SplitLayout left={<div>Left</div>} right={<div>Right</div>} resizable={false} />
    );
    expect(container.querySelector('[class*="divider"]')).not.toBeInTheDocument();
  });

  it('allows resizing via drag handle when resizable=true', () => {
    const { container } = render(
      <SplitLayout left={<div>Left</div>} right={<div>Right</div>} leftWidth={50} resizable={true} />
    );

    const divider = container.querySelector('[class*="divider"]') as HTMLElement;
    expect(divider).toBeInTheDocument();

    const leftPane = container.querySelector('[class*="leftPane"]') as HTMLElement;
    expect(leftPane.style.width).toBe('50%');

    // Simulate drag: mousedown on divider, mousemove 80px right, mouseup
    fireEvent.mouseDown(divider, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 480 });
    fireEvent.mouseUp(document);

    // Width should have changed from 50%
    expect(leftPane.style.width).not.toBe('50%');
  });
});
