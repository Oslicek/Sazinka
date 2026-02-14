import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

describe('DeleteConfirmDialog', () => {
  it('renders warning text', () => {
    render(
      <DeleteConfirmDialog
        isOpen={true}
        customerName="ACME"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByText('delete_title')).toBeInTheDocument();
    expect(screen.getByText('delete_warning')).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'delete_confirm_button' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
