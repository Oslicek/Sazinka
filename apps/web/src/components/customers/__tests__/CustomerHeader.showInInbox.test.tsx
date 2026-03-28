/**
 * Phase 2 (RED → GREEN) — CustomerHeader "Show in Inbox" action tests.
 *
 * H2-1: renders "Show in Inbox" link
 * H2-2: link href contains /inbox and customerId=
 * H2-3: visible when customer has no coordinates
 * H2-4: visible for company customer
 * H2-5: action order — "Show in Inbox" appears after Add-to-plan and before Edit
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { Customer } from '@shared/customer';
import { CustomerHeader } from '../CustomerHeader';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  }) => {
    const params = search ? new URLSearchParams(search).toString() : '';
    const href = params ? `${to}?${params}` : to;
    return <a href={href}>{children}</a>;
  },
}));

const baseCustomer: Customer = {
  id: 'cust-1',
  userId: 'user-1',
  type: 'person',
  name: 'Jan Novák',
  street: 'Hlavní 1',
  city: 'Praha',
  postalCode: '10000',
  country: 'CZ',
  geocodeStatus: 'success',
  lat: 50.08,
  lng: 14.43,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('CustomerHeader – Show in Inbox action', () => {
  it('H2-1: renders "Show in Inbox" link', () => {
    render(<CustomerHeader customer={baseCustomer} onEdit={vi.fn()} onAddToPlan={vi.fn()} />);
    expect(screen.getByRole('link', { name: /action_show_in_inbox/i })).toBeTruthy();
  });

  it('H2-2: link href contains /inbox and customerId=cust-1', () => {
    render(<CustomerHeader customer={baseCustomer} onEdit={vi.fn()} onAddToPlan={vi.fn()} />);
    const link = screen.getByRole('link', { name: /action_show_in_inbox/i });
    expect(link.getAttribute('href')).toContain('/inbox');
    expect(link.getAttribute('href')).toContain('customerId=cust-1');
  });

  it('H2-3: still visible when customer has no coordinates', () => {
    const noCoords = { ...baseCustomer, lat: undefined, lng: undefined };
    render(<CustomerHeader customer={noCoords} onEdit={vi.fn()} />);
    expect(screen.getByRole('link', { name: /action_show_in_inbox/i })).toBeTruthy();
  });

  it('H2-4: still visible for company customer', () => {
    const company = { ...baseCustomer, type: 'company' as const };
    render(<CustomerHeader customer={company} onEdit={vi.fn()} onAddToPlan={vi.fn()} />);
    expect(screen.getByRole('link', { name: /action_show_in_inbox/i })).toBeTruthy();
  });

  it('H2-5: Show in Inbox appears after Add-to-plan and before Edit', () => {
    render(<CustomerHeader customer={baseCustomer} onEdit={vi.fn()} onAddToPlan={vi.fn()} />);
    const actions = screen.getByTestId('customer-header-actions');
    const els = Array.from(actions.querySelectorAll('a[href*="inbox"], button'));
    const inboxIdx = els.findIndex(el => el.getAttribute('href')?.includes('/inbox'));
    const editIdx = els.findIndex(el => el.textContent?.includes('header_edit'));
    const addIdx = els.findIndex(el => el.textContent?.includes('header_add_to_plan'));
    expect(inboxIdx).toBeGreaterThan(addIdx);
    expect(inboxIdx).toBeLessThan(editIdx);
  });
});
