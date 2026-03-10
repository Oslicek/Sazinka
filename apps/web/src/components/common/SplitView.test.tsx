/**
 * Phase 12 — SplitView touch resize tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitView } from './SplitView';

const defaultPanels = [
  { id: 'left', content: <div>Left</div>, defaultWidth: 50, minWidth: 20, maxWidth: 80 },
  { id: 'right', content: <div>Right</div>, defaultWidth: 50, minWidth: 20, maxWidth: 80 },
];

describe('SplitView — mouse resize (existing behaviour)', () => {
  it('renders panels', () => {
    render(<SplitView panels={defaultPanels} />);
    expect(screen.getByText('Left')).toBeInTheDocument();
    expect(screen.getByText('Right')).toBeInTheDocument();
  });

  it('renders resizer between panels', () => {
    render(<SplitView panels={defaultPanels} />);
    expect(document.querySelector('[class*="resizer"]')).toBeInTheDocument();
  });

  it('does not render resizer when resizable=false', () => {
    render(<SplitView panels={defaultPanels} resizable={false} />);
    expect(document.querySelector('[class*="resizer"]')).not.toBeInTheDocument();
  });

  it('starts mouse resize on mousedown', () => {
    render(<SplitView panels={defaultPanels} />);
    const resizer = document.querySelector('[class*="resizer"]')!;
    // Should not throw
    fireEvent.mouseDown(resizer, { clientX: 400 });
    fireEvent.mouseMove(document, { clientX: 450 });
    fireEvent.mouseUp(document);
  });
});

describe('SplitView — touch resize (Phase 12)', () => {
  beforeEach(() => {
    // Mock getBoundingClientRect for the container
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

  it('resizer has onTouchStart handler', () => {
    render(<SplitView panels={defaultPanels} />);
    const resizer = document.querySelector('[class*="resizer"]')!;
    // Verify touch event doesn't throw
    expect(() => {
      fireEvent.touchStart(resizer, {
        touches: [{ clientX: 400, clientY: 0 }],
      });
    }).not.toThrow();
  });

  it('resizes panels on touchmove', () => {
    const { container } = render(<SplitView panels={defaultPanels} />);
    const resizer = container.querySelector('[class*="resizer"]')!;

    fireEvent.touchStart(resizer, {
      touches: [{ clientX: 400, clientY: 0 }],
    });

    // Dispatch touchmove on document (where the listener is attached)
    fireEvent.touchMove(document, {
      touches: [{ clientX: 480, clientY: 0 }],
    });

    fireEvent.touchEnd(document);

    // The inner panel div should have an inline width style set
    const innerPanels = container.querySelectorAll('[class*="panel_"]');
    const leftInner = innerPanels[0] as HTMLElement;
    expect(leftInner.style.width).not.toBe('');
  });

  it('stops resizing on touchend', () => {
    const { container } = render(<SplitView panels={defaultPanels} />);
    const resizer = container.querySelector('[class*="resizer"]')!;

    fireEvent.touchStart(resizer, {
      touches: [{ clientX: 400, clientY: 0 }],
    });

    // Move once to set a width
    fireEvent.touchMove(document, {
      touches: [{ clientX: 480, clientY: 0 }],
    });

    // End the gesture
    fireEvent.touchEnd(document);

    // Width after end
    const innerPanels = container.querySelectorAll('[class*="panel_"]');
    const leftInner = innerPanels[0] as HTMLElement;
    const widthAfterEnd = leftInner.style.width;

    // Move again — should NOT change width (listener was removed)
    fireEvent.touchMove(document, {
      touches: [{ clientX: 600, clientY: 0 }],
    });

    expect(leftInner.style.width).toBe(widthAfterEnd);
  });
});
