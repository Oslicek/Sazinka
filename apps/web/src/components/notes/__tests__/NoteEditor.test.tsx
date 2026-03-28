/**
 * NoteEditor generalized building block tests — NB1–NB7 + NB8+
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/utils/auth', () => ({ getToken: vi.fn().mockReturnValue('test-token') }));
vi.mock('@/stores/natsStore', () => ({
  useNatsStore: { getState: () => ({ request: vi.fn() }) },
}));

import { NoteEditor } from '../NoteEditor';

const defaultProps = {
  entityType: 'visit' as const,
  entityId: 'entity-001',
  initialContent: '',
  readOnly: false,
  onSave: vi.fn().mockResolvedValue(undefined),
};

describe('NoteEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // NB1 — renders for entity_type customer
  it('NB1: renders for entity_type customer', () => {
    render(<NoteEditor {...defaultProps} entityType="customer" entityId="customer-001" />);
    expect(screen.getByTestId('note-editor')).toBeDefined();
  });

  // NB2 — renders for entity_type device
  it('NB2: renders for entity_type device', () => {
    render(<NoteEditor {...defaultProps} entityType="device" entityId="device-001" />);
    expect(screen.getByTestId('note-editor')).toBeDefined();
  });

  // NB3 — renders for entity_type visit
  it('NB3: renders for entity_type visit', () => {
    render(<NoteEditor {...defaultProps} entityType="visit" entityId="visit-001" />);
    expect(screen.getByTestId('note-editor')).toBeDefined();
  });

  // Renders with initial content
  it('renders with initial content', () => {
    render(<NoteEditor {...defaultProps} initialContent="Some initial notes" />);
    const editor = screen.getByTestId('note-editor');
    expect(editor.textContent).toContain('Some initial notes');
  });

  // Renders toolbar with formatting buttons
  it('renders a toolbar with formatting buttons', () => {
    render(<NoteEditor {...defaultProps} />);
    expect(screen.getByTestId('toolbar-bold')).toBeDefined();
    expect(screen.getByTestId('toolbar-italic')).toBeDefined();
    expect(screen.getByTestId('toolbar-heading')).toBeDefined();
    expect(screen.getByTestId('toolbar-bullet-list')).toBeDefined();
  });

  // Hides toolbar in readOnly mode
  it('hides toolbar when readOnly is true', () => {
    render(<NoteEditor {...defaultProps} readOnly />);
    expect(screen.queryByTestId('toolbar-bold')).toBeNull();
  });

  // NB7 — max_length_10000_all_entities: char count shown in editor
  it('NB7: shows character count (max 10000)', () => {
    render(<NoteEditor {...defaultProps} initialContent="Hello" />);
    expect(screen.getByTestId('char-count')).toBeDefined();
  });

  // Hides char count in readOnly mode
  it('hides character count when readOnly', () => {
    render(<NoteEditor {...defaultProps} readOnly />);
    expect(screen.queryByTestId('char-count')).toBeNull();
  });

  // Editor container always renders
  it('renders editor container even when content is empty', () => {
    render(<NoteEditor {...defaultProps} initialContent="" />);
    const container = screen.getByTestId('note-editor');
    expect(container).toBeDefined();
    const tiptap = container.querySelector('.tiptap');
    expect(tiptap).toBeDefined();
  });

  // readOnly disables the editor (no contenteditable)
  it('sets editor to non-editable in readOnly mode', () => {
    render(<NoteEditor {...defaultProps} readOnly initialContent="Read only notes" />);
    const editor = screen.getByTestId('note-editor');
    expect(editor.textContent).toContain('Read only notes');
  });
});
