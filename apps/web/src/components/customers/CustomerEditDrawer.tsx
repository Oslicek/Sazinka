/**
 * CustomerEditDrawer - Right drawer for editing customer
 * 
 * Features:
 * - Slides in from right
 * - Contains CustomerForm
 * - Detail page stays visible underneath
 * - Keyboard support (Escape to close)
 */

import { useEffect, useCallback } from 'react';
import type { Customer, UpdateCustomerRequest, CreateCustomerRequest } from '@shared/customer';
import { CustomerForm } from './CustomerForm';
import styles from './CustomerEditDrawer.module.css';

interface CustomerEditDrawerProps {
  customer: Customer;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: UpdateCustomerRequest) => Promise<void>;
  isSubmitting?: boolean;
  onGeocodeCompleted?: () => void;
}

export function CustomerEditDrawer({
  customer,
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  onGeocodeCompleted,
}: CustomerEditDrawerProps) {
  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isSubmitting]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle submit wrapper
  const handleSubmit = useCallback(async (data: CreateCustomerRequest | UpdateCustomerRequest) => {
    await onSubmit(data as UpdateCustomerRequest);
  }, [onSubmit]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className={styles.backdrop} 
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden="true"
      />
      
      {/* Drawer */}
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Upravit zákazníka">
        <header className={styles.header}>
          <h2 className={styles.title}>Upravit zákazníka</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={isSubmitting}
            title="Zavřít (Esc)"
          >
            ✕
          </button>
        </header>
        
        <div className={styles.content}>
          <CustomerForm
            customer={customer}
            onSubmit={handleSubmit}
            onCancel={onClose}
            isSubmitting={isSubmitting}
            onGeocodeCompleted={onGeocodeCompleted}
          />
        </div>
      </aside>
    </>
  );
}
