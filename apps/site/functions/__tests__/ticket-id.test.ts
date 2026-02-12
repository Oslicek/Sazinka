import { describe, expect, test } from 'vitest';
import { generateTicketId } from '../lib/ticket-id';

describe('generateTicketId', () => {
  test('uses format REQ-YYYY-NNNNNN', () => {
    const id = generateTicketId(123);
    expect(id).toMatch(/^REQ-\d{4}-\d{6}$/);
  });

  test('pads sequence with zeros', () => {
    expect(generateTicketId(1)).toMatch(/-000001$/);
    expect(generateTicketId(42)).toMatch(/-000042$/);
  });
});
