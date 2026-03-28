/**
 * Phase 2 (RED → GREEN) — CustomerPreviewPanel "Show in Inbox" action tests.
 *
 * P2-1: renders action when customer is selected
 * P2-2: link href includes customerId
 * P2-3: link absent when customer === null (empty state)
 * P2-4: coexists with edit/add actions; relative order consistent with header
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { CustomerListItem } from '@shared/customer';
import { CustomerPreviewPanel } from '../CustomerPreviewPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
    params?: Record<string, string>;
  }) => {
    const qs = search ? new URLSearchParams(search).toString() : '';
    let href = to;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        href = href.replace(`$${k}`, v);
      });
    }
    if (qs) href = `${href}?${qs}`;
    return <a href={href}>{children}</a>;
  },
}));

vi.mock('../AddressMap', () => ({
  AddressMap: () => <div data-testid="address-map" />,
}));

vi.mock('../AddressStatusChip', () => ({
  AddressStatusChip: () => <span data-testid="address-status-chip" />,
}));

vi.mock('../../devices', () => ({
  DeviceList: () => <div data-testid="device-list" />,
}));

vi.mock('../../timeline', () => ({
  CustomerTimeline: () => <div data-testid="customer-timeline" />,
}));

vi.mock('../../../i18n/formatters', () => ({
  formatDate: (d: string) => d,
}));

const baseItem: CustomerListItem = {
  id: 'cust-2',
  userId: 'user-1',
  type: 'person',
  name: 'Jana Nováková',
  street: 'Druhá 2',
  city: 'Brno',
  postalCode: '60200',
  lat: 49.19,
  lng: 16.61,
  geocodeStatus: 'success',
  createdAt: '2024-01-01T00:00:00Z',
  deviceCount: 2,
  nextRevisionDate: null,
  overdueCount: 0,
  neverServicedCount: 0,
};

describe('CustomerPreviewPanel – Show in Inbox action', () => {
  it('P2-1: renders "Show in Inbox" link when customer is selected', () => {
    render(
      <CustomerPreviewPanel
        customer={baseItem}
        fullCustomer={null}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(screen.getByRole('link', { name: /action_show_in_inbox/i })).toBeTruthy();
  });

  it('P2-2: link href includes customerId=cust-2', () => {
    render(
      <CustomerPreviewPanel
        customer={baseItem}
        fullCustomer={null}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    const link = screen.getByRole('link', { name: /action_show_in_inbox/i });
    expect(link.getAttribute('href')).toContain('customerId=cust-2');
  });

  it('P2-3: link absent when customer === null', () => {
    render(
      <CustomerPreviewPanel
        customer={null}
        fullCustomer={null}
        onClose={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(screen.queryByRole('link', { name: /action_show_in_inbox/i })).toBeNull();
  });

  it('P2-4: coexists with edit/add actions at consistent relative index', () => {
    render(
      <CustomerPreviewPanel
        customer={baseItem}
        fullCustomer={null}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onAddToPlan={vi.fn()}
      />
    );
    const actionsEl = screen.getByTestId('customer-preview-actions');
    const els = Array.from(actionsEl.querySelectorAll('a, button'));
    const inboxIdx = els.findIndex(el => el.getAttribute('href')?.includes('/inbox'));
    const editIdx = els.findIndex(el => el.textContent?.includes('preview_edit'));
    const addIdx = els.findIndex(el => el.textContent?.includes('preview_add_to_plan'));
    // All three are present
    expect(inboxIdx).toBeGreaterThanOrEqual(0);
    expect(editIdx).toBeGreaterThanOrEqual(0);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    // Inbox after add-to-plan, before edit (matching header order)
    expect(inboxIdx).toBeGreaterThan(addIdx);
    expect(inboxIdx).toBeLessThan(editIdx);
  });
});
