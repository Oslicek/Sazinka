import { describe, it, expect } from 'vitest';
import { inboxItemToCallQueueItem, inboxResponseToCallQueueResponse } from './inboxAdapter';
import type { InboxItem, InboxResponse } from '@shared/inbox';

function makeInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'cust-1',
    name: 'Test Customer',
    phone: '+420 111 222 333',
    email: 'test@example.com',
    street: 'Hlavní 1',
    city: 'Praha',
    postalCode: '11000',
    lat: 50.08,
    lng: 14.43,
    geocodeStatus: 'success',
    customerCreatedAt: '2025-01-01T00:00:00Z',
    lifecycleState: 'active',
    lifecycleRank: 2,
    nextActionKind: null,
    nextActionLabelKey: null,
    nextActionLabelFallback: null,
    nextActionDue: '2026-03-15',
    nextActionNote: null,
    totalCommunications: 3,
    lastContactAt: '2026-03-01T10:00:00Z',
    urgencyScore: 42,
    ...overrides,
  };
}

describe('inboxItemToCallQueueItem', () => {
  it('maps email to customerEmail', () => {
    const result = inboxItemToCallQueueItem(makeInboxItem({ email: 'user@example.com' }));
    expect(result.customerEmail).toBe('user@example.com');
  });

  it('maps null email to null customerEmail', () => {
    const result = inboxItemToCallQueueItem(makeInboxItem({ email: null }));
    expect(result.customerEmail).toBeNull();
  });

  it('maps street to customerStreet', () => {
    const result = inboxItemToCallQueueItem(makeInboxItem({ street: 'Masarykova 5' }));
    expect(result.customerStreet).toBe('Masarykova 5');
  });

  it('maps null street to empty customerStreet', () => {
    const result = inboxItemToCallQueueItem(makeInboxItem({ street: null }));
    expect(result.customerStreet).toBe('');
  });

  it('maps phone to customerPhone', () => {
    const result = inboxItemToCallQueueItem(makeInboxItem({ phone: '+420 999 888 777' }));
    expect(result.customerPhone).toBe('+420 999 888 777');
  });

  it('maps basic fields correctly', () => {
    const item = makeInboxItem();
    const result = inboxItemToCallQueueItem(item);
    expect(result.customerId).toBe('cust-1');
    expect(result.customerName).toBe('Test Customer');
    expect(result.customerCity).toBe('Praha');
    expect(result.customerPostalCode).toBe('11000');
    expect(result.customerLat).toBe(50.08);
    expect(result.customerLng).toBe(14.43);
  });
});

describe('inboxResponseToCallQueueResponse', () => {
  it('converts all items and preserves counts', () => {
    const resp: InboxResponse = {
      items: [makeInboxItem(), makeInboxItem({ id: 'cust-2', name: 'Other', email: null })],
      total: 2,
      overdueCount: 1,
      dueSoonCount: 0,
    };
    const result = inboxResponseToCallQueueResponse(resp);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].customerEmail).toBe('test@example.com');
    expect(result.items[1].customerEmail).toBeNull();
    expect(result.total).toBe(2);
    expect(result.overdueCount).toBe(1);
    expect(result.dueSoonCount).toBe(0);
  });
});
