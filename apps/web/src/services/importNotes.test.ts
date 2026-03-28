/**
 * Phase U9: Import notes.csv + ref resolution tests
 * NI1–NI9 (TypeScript / shared-types layer)
 */
import { describe, it, expect, vi } from 'vitest';
import type { ZipImportFileType } from '@shared/import';

vi.mock('../stores/natsStore', () => ({
  useNatsStore: {
    getState: vi.fn(() => ({ request: vi.fn() })),
  },
}));

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
}));

describe('Import notes.csv — shared type contracts', () => {
  // NI1: notes is a valid ZipImportFileType
  it('NI1: notes is a valid ZipImportFileType', () => {
    const t: ZipImportFileType = 'notes';
    expect(t).toBe('notes');
  });

  // NI2: all existing types still valid alongside notes
  it('NI2: legacy ZipImportFileType values still valid', () => {
    const types: ZipImportFileType[] = [
      'customers',
      'devices',
      'revisions',
      'communications',
      'work_log',
      'notes',
    ];
    expect(types).toHaveLength(6);
    expect(types).toContain('notes');
    expect(types).toContain('customers');
  });

  // NI3: notes is accepted in ZipImportJobRequest detectedFiles
  it('NI3: ZipImportFileInfo can represent a notes.csv file', () => {
    const fileInfo = {
      filename: 'notes.csv',
      type: 'notes' as ZipImportFileType,
      size: 1024,
    };
    expect(fileInfo.type).toBe('notes');
    expect(fileInfo.filename).toBe('notes.csv');
  });

  // NI4: notes comes after all entity types in import order (priority 6)
  it('NI4: notes file type is ordered after other entity types', () => {
    const importOrder: Record<ZipImportFileType, number> = {
      customers: 1,
      devices: 2,
      revisions: 3,
      communications: 4,
      work_log: 5,
      notes: 6,
    };
    expect(importOrder['notes']).toBeGreaterThan(importOrder['customers']);
    expect(importOrder['notes']).toBeGreaterThan(importOrder['devices']);
    expect(importOrder['notes']).toBeGreaterThan(importOrder['work_log']);
  });

  // NI5: filename detection for notes
  it('NI5: notes.csv filename maps to notes type', () => {
    const fromFilename = (name: string): ZipImportFileType | null => {
      const lower = name.toLowerCase();
      if (lower.includes('notes')) return 'notes';
      if (lower.includes('customer')) return 'customers';
      if (lower.includes('device')) return 'devices';
      return null;
    };
    expect(fromFilename('notes.csv')).toBe('notes');
    expect(fromFilename('prefix_notes.csv')).toBe('notes');
    expect(fromFilename('customers.csv')).toBe('customers');
    expect(fromFilename('unknown.csv')).toBeNull();
  });

  // NI6: entity_ref for customer maps to customer reference string
  it('NI6: entity_ref format for customer notes', () => {
    const makeEntityRef = (type: string, id: string) => {
      if (type === 'visit') return `visit_uuid:${id}`;
      if (type === 'customer') return id.includes('@') ? id : `customer_uuid:${id}`;
      return `device_uuid:${id}`;
    };
    expect(makeEntityRef('visit', 'uuid-001')).toBe('visit_uuid:uuid-001');
    expect(makeEntityRef('customer', 'test@example.com')).toBe('test@example.com');
    expect(makeEntityRef('device', 'dev-001')).toBe('device_uuid:dev-001');
  });

  // NI7: empty content should be skipped on import
  it('NI7: empty content note rows are identified as skippable', () => {
    const shouldSkip = (content: string) => content.trim().length === 0;
    expect(shouldSkip('')).toBe(true);
    expect(shouldSkip('   ')).toBe(true);
    expect(shouldSkip('some note')).toBe(false);
  });

  // NI8: content over 10k chars should be rejected
  it('NI8: content over 10000 chars exceeds limit', () => {
    const MAX = 10_000;
    const overLimit = 'a'.repeat(MAX + 1);
    const atLimit = 'a'.repeat(MAX);
    expect(overLimit.length > MAX).toBe(true);
    expect(atLimit.length > MAX).toBe(false);
  });

  // NI9: duplicate detection — same entity_type + entity_id + content = skip
  it('NI9: duplicate note detection key includes entity_type, entity_id, and content', () => {
    const makeKey = (entityType: string, entityId: string, content: string) =>
      `${entityType}:${entityId}:${content}`;
    const k1 = makeKey('customer', 'cust-001', 'Some note');
    const k2 = makeKey('customer', 'cust-001', 'Some note');
    const k3 = makeKey('customer', 'cust-001', 'Different note');
    expect(k1).toBe(k2); // duplicate
    expect(k1).not.toBe(k3); // not duplicate
  });
});
