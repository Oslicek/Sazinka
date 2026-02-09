import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

describe('DeleteConfirmDialog', () => {
  it('renders anonymization warning text', () => {
    render(
      <DeleteConfirmDialog
        isOpen={true}
        customerName="ACME"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText(/bez možnosti Undo/i)).toBeInTheDocument();
    expect(screen.getByText(/anonymizována/i)).toBeInTheDocument();
  });

  it('calls onConfirm when delete is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <DeleteConfirmDialog
        isOpen={true}
        customerName="ACME"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Smazat' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
