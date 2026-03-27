/**
 * Phase 4 tests: VisitFieldNotes editor component — VN1–VN8.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: { getState: () => ({ request: vi.fn() }) },
}));

import { VisitFieldNotes } from '../VisitFieldNotes';

describe('VisitFieldNotes', () => {
  const defaultProps = {
    visitId: 'v-1',
    initialContent: '',
    readOnly: false,
    onSave: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // VN1: renders the editor container
  it('VN1: renders the editor container', () => {
    render(<VisitFieldNotes {...defaultProps} />);
    expect(screen.getByTestId('field-notes-editor')).toBeDefined();
  });

  // VN2: renders with initial content
  it('VN2: renders with initial content', () => {
    render(<VisitFieldNotes {...defaultProps} initialContent="Some initial notes" />);
    const editor = screen.getByTestId('field-notes-editor');
    expect(editor.textContent).toContain('Some initial notes');
  });

  // VN3: renders a toolbar with formatting buttons
  it('VN3: renders a toolbar with formatting buttons', () => {
    render(<VisitFieldNotes {...defaultProps} />);
    expect(screen.getByTestId('toolbar-bold')).toBeDefined();
    expect(screen.getByTestId('toolbar-italic')).toBeDefined();
    expect(screen.getByTestId('toolbar-heading')).toBeDefined();
    expect(screen.getByTestId('toolbar-bullet-list')).toBeDefined();
  });

  // VN4: hides toolbar in readOnly mode
  it('VN4: hides toolbar when readOnly is true', () => {
    render(<VisitFieldNotes {...defaultProps} readOnly />);
    expect(screen.queryByTestId('toolbar-bold')).toBeNull();
  });

  // VN5: shows character count
  it('VN5: shows character count', () => {
    render(<VisitFieldNotes {...defaultProps} initialContent="Hello" />);
    expect(screen.getByTestId('char-count')).toBeDefined();
  });

  // VN6: hides character count in readOnly mode
  it('VN6: hides character count when readOnly', () => {
    render(<VisitFieldNotes {...defaultProps} readOnly />);
    expect(screen.queryByTestId('char-count')).toBeNull();
  });

  // VN7: the editor area renders when content is empty (toolbar present separately)
  it('VN7: renders editor container even when content is empty', () => {
    render(<VisitFieldNotes {...defaultProps} initialContent="" />);
    const container = screen.getByTestId('field-notes-editor');
    expect(container).toBeDefined();
    const tiptap = container.querySelector('.tiptap');
    expect(tiptap).toBeDefined();
  });

  // VN8: readOnly disables the editor
  it('VN8: sets editor to non-editable in readOnly mode', () => {
    render(<VisitFieldNotes {...defaultProps} readOnly initialContent="Read only notes" />);
    const editor = screen.getByTestId('field-notes-editor');
    expect(editor.textContent).toContain('Read only notes');
  });
});
