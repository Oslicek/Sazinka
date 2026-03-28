import { describe, it, expect } from 'vitest';
import { validateInboxSearch } from '../inboxSearch';

describe('validateInboxSearch', () => {
  it('R1-1: empty object returns {}', () => {
    expect(validateInboxSearch({})).toEqual({});
  });

  it('R1-2: valid string id returns { customerId }', () => {
    expect(validateInboxSearch({ customerId: 'abc-123' })).toEqual({ customerId: 'abc-123' });
  });

  it('R1-3: non-string id returns {}', () => {
    expect(validateInboxSearch({ customerId: 42 })).toEqual({});
    expect(validateInboxSearch({ customerId: true })).toEqual({});
    expect(validateInboxSearch({ customerId: null })).toEqual({});
  });

  it('R1-4: empty string id returns {}', () => {
    expect(validateInboxSearch({ customerId: '' })).toEqual({});
  });

  it('R1-5: whitespace-only id returns {}', () => {
    expect(validateInboxSearch({ customerId: '   ' })).toEqual({});
  });

  it('R1-6: trims valid id with surrounding spaces', () => {
    expect(validateInboxSearch({ customerId: '  abc-123  ' })).toEqual({ customerId: 'abc-123' });
  });
});
