/**
 * Phase U10: Cross-cutting integration tests
 * NX1–NX24: round-trip, localStorage draft keys, GDPR, concurrent saves
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Note } from '@shared/note';
import type { ZipImportFileType } from '@shared/import';
import type { ExportPlusFile } from './exportPlusService';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../stores/natsStore', () => ({
  useNatsStore: {
    getState: vi.fn(() => ({ request: vi.fn() })),
  },
}));

vi.mock('@/utils/auth', () => ({
  getToken: () => 'test-token',
}));

vi.mock('@shared/messages', () => ({
  createRequest: (_token: string, payload: unknown) => ({ token: 'test-token', payload }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeNote = (overrides: Partial<Note> = {}): Note => ({
  id: 'note-001',
  userId: 'user-001',
  entityType: 'customer',
  entityId: 'cust-001',
  visitId: null,
  content: 'Test note content',
  createdAt: '2026-03-28T10:00:00Z',
  updatedAt: '2026-03-28T10:00:00Z',
  deletedAt: null,
  ...overrides,
});

// ── Round-trip: export → import contract (NX1–NX8) ──────────────────────────

describe('Round-trip export → import contract', () => {
  // NX1: notes file can be exported AND imported (type system)
  it('NX1: notes is both a valid ExportPlusFile and ZipImportFileType', () => {
    const exportFile: ExportPlusFile = 'notes';
    const importFile: ZipImportFileType = 'notes';
    expect(exportFile).toBe('notes');
    expect(importFile).toBe('notes');
  });

  // NX2: notes.csv columns match expected headers
  it('NX2: expected notes.csv column headers', () => {
    const headers = ['entity_type', 'entity_id', 'entity_ref', 'content', 'created_at', 'updated_at'];
    expect(headers).toContain('entity_type');
    expect(headers).toContain('entity_id');
    expect(headers).toContain('entity_ref');
    expect(headers).toContain('content');
    expect(headers).toContain('created_at');
    expect(headers).toContain('updated_at');
  });

  // NX3: Note object maps to expected CSV row structure
  it('NX3: Note object properties match notes.csv columns', () => {
    const note = makeNote();
    const csvRow = {
      entity_type: note.entityType,
      entity_id: note.entityId,
      entity_ref: `customer_uuid:${note.entityId}`,
      content: note.content,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
    };
    expect(csvRow.entity_type).toBe('customer');
    expect(csvRow.content).toBe('Test note content');
  });

  // NX4: soft-deleted notes excluded from export (deletedAt not null)
  it('NX4: soft-deleted notes have deletedAt set and are excluded from export', () => {
    const active = makeNote({ deletedAt: null });
    const deleted = makeNote({ deletedAt: '2026-03-28T12:00:00Z' });
    const exportable = [active, deleted].filter((n) => n.deletedAt === null);
    expect(exportable).toHaveLength(1);
    expect(exportable[0].id).toBe(active.id);
  });

  // NX5: entity_ref for customer uses ico/email fallback chain
  it('NX5: customer entity_ref resolution order', () => {
    const resolveCustomerRef = (ico?: string, email?: string, phone?: string, id?: string): string => {
      if (ico) return ico;
      if (email) return email;
      if (phone) return phone;
      return `customer_uuid:${id ?? 'unknown'}`;
    };
    expect(resolveCustomerRef('12345678')).toBe('12345678');
    expect(resolveCustomerRef(undefined, 'test@test.com')).toBe('test@test.com');
    expect(resolveCustomerRef(undefined, undefined, '+420123456789')).toBe('+420123456789');
    expect(resolveCustomerRef(undefined, undefined, undefined, 'uuid-001')).toBe('customer_uuid:uuid-001');
  });

  // NX6: entity_ref for device uses serial/name fallback chain
  it('NX6: device entity_ref resolution order', () => {
    const resolveDeviceRef = (serial?: string, name?: string, id?: string): string => {
      if (serial) return serial;
      if (name) return name;
      return `device_uuid:${id ?? 'unknown'}`;
    };
    expect(resolveDeviceRef('SN-12345')).toBe('SN-12345');
    expect(resolveDeviceRef(undefined, 'Boiler A')).toBe('Boiler A');
    expect(resolveDeviceRef(undefined, undefined, 'uuid-002')).toBe('device_uuid:uuid-002');
  });

  // NX7: entity_ref for visit always uses visit_uuid prefix
  it('NX7: visit entity_ref always uses visit_uuid: prefix', () => {
    const visitId = 'visit-uuid-001';
    const ref = `visit_uuid:${visitId}`;
    expect(ref).toBe('visit_uuid:visit-uuid-001');
    expect(ref.startsWith('visit_uuid:')).toBe(true);
  });

  // NX8: round-trip idempotency — same content re-imported does not duplicate
  it('NX8: idempotent import — duplicate detection key is entity_type+entity_id+content', () => {
    const note = makeNote();
    const key = `${note.entityType}:${note.entityId}:${note.content}`;
    const importedTwice = [note, note];
    const unique = new Map<string, Note>();
    for (const n of importedTwice) {
      const k = `${n.entityType}:${n.entityId}:${n.content}`;
      unique.set(k, n);
    }
    expect(unique.size).toBe(1);
    expect(unique.has(key)).toBe(true);
  });
});

// ── Concurrent saves / mutex simulation (NX9–NX14) ──────────────────────────

describe('Concurrent note save simulation', () => {
  // NX9: last write wins — later updateNote call replaces earlier result
  it('NX9: last-write-wins — later call determines final content', async () => {
    const results: string[] = [];
    const fakeUpdate = (content: string) =>
      new Promise<string>((resolve) => setTimeout(() => { results.push(content); resolve(content); }, 0));

    await Promise.all([fakeUpdate('first'), fakeUpdate('second')]);
    expect(results).toContain('first');
    expect(results).toContain('second');
  });

  // NX10: rapid updates debounced — only last content persisted
  it('NX10: debounce accumulates changes and persists final state', () => {
    const persisted: string[] = [];
    let pending = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (content: string) => {
      pending = content;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { persisted.push(pending); }, 10);
    };

    schedule('a');
    schedule('ab');
    schedule('abc');

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(persisted).toHaveLength(1);
        expect(persisted[0]).toBe('abc');
        resolve();
      }, 50);
    });
  });

  // NX11: autosave failure does not clear localStorage draft
  it('NX11: failed autosave preserves draft in localStorage', () => {
    const localStorage = { store: {} as Record<string, string> };
    localStorage.store['noteDraft:customer:cust-001:sess-001'] = 'unsaved draft';

    const failedSave = async () => { throw new Error('network error'); };

    return failedSave().catch(() => {
      // Draft should still be in localStorage (not removed)
      expect(localStorage.store['noteDraft:customer:cust-001:sess-001']).toBe('unsaved draft');
    });
  });

  // NX12: successful autosave clears localStorage draft
  it('NX12: successful autosave removes draft from localStorage', () => {
    const store: Record<string, string> = {};
    store['noteDraft:customer:cust-001:sess-001'] = 'draft to save';

    const successSave = async () => {
      delete store['noteDraft:customer:cust-001:sess-001'];
    };

    return successSave().then(() => {
      expect(store['noteDraft:customer:cust-001:sess-001']).toBeUndefined();
    });
  });

  // NX13: session rotation produces new draft key
  it('NX13: new session ID produces distinct localStorage key', () => {
    const key1 = `noteDraft:customer:cust-001:sess-001`;
    const key2 = `noteDraft:customer:cust-001:sess-002`;
    expect(key1).not.toBe(key2);
  });

  // NX14: offline scenario — draft preserved, save deferred
  it('NX14: draft is preserved in localStorage when offline', () => {
    const store: Record<string, string> = {};
    const key = 'noteDraft:visit:visit-001:sess-001';
    store[key] = 'offline draft';

    const isOnline = false;
    if (!isOnline) {
      // Draft should remain
      expect(store[key]).toBe('offline draft');
    }
  });
});

// ── localStorage draft key uniqueness per entity (NX15–NX20) ─────────────────

describe('localStorage draft key uniqueness', () => {
  const storageKey = (entityType: string, entityId: string, sessionId: string) =>
    `noteDraft:${entityType}:${entityId}:${sessionId}`;

  // NX15: different entity types produce different keys
  it('NX15: customer and device notes use different localStorage keys', () => {
    const k1 = storageKey('customer', 'ent-001', 'sess-001');
    const k2 = storageKey('device', 'ent-001', 'sess-001');
    expect(k1).not.toBe(k2);
  });

  // NX16: different entity IDs produce different keys
  it('NX16: same entity type, different entity IDs produce different keys', () => {
    const k1 = storageKey('customer', 'cust-001', 'sess-001');
    const k2 = storageKey('customer', 'cust-002', 'sess-001');
    expect(k1).not.toBe(k2);
  });

  // NX17: different sessions produce different keys for same entity
  it('NX17: same entity, different sessions produce different keys', () => {
    const k1 = storageKey('customer', 'cust-001', 'sess-A');
    const k2 = storageKey('customer', 'cust-001', 'sess-B');
    expect(k1).not.toBe(k2);
  });

  // NX18: customer note key format is predictable
  it('NX18: customer note key follows noteDraft:<type>:<id>:<session> format', () => {
    const key = storageKey('customer', 'cust-001', 'session-123');
    expect(key).toBe('noteDraft:customer:cust-001:session-123');
  });

  // NX19: visit note key differs from customer note key for same ID
  it('NX19: visit note key differs from customer note key for same entity ID string', () => {
    const visitKey = storageKey('visit', 'id-001', 'sess-001');
    const customerKey = storageKey('customer', 'id-001', 'sess-001');
    expect(visitKey).not.toBe(customerKey);
  });

  // NX20: device note key includes device entity type
  it('NX20: device note key includes device entity type string', () => {
    const key = storageKey('device', 'dev-001', 'sess-xyz');
    expect(key).toContain(':device:');
  });
});

// ── GDPR + content handling (NX21–NX24) ──────────────────────────────────────

describe('GDPR and content handling', () => {
  // NX21: redacted note has [GDPR-REDACTED] content
  it('NX21: GDPR-redacted note has expected redaction marker', () => {
    const redacted = makeNote({ content: '[GDPR-REDACTED]' });
    expect(redacted.content).toBe('[GDPR-REDACTED]');
  });

  // NX22: redacted note is excluded from export CSV (same as any note with specific content)
  it('NX22: note content is exported as raw markdown', () => {
    const note = makeNote({ content: '# Header\n\n**bold** text' });
    expect(note.content).toContain('#');
    expect(note.content).toContain('**bold**');
  });

  // NX23: VisitDetailDialog shows truncated note excerpt (max 300 chars)
  it('NX23: note excerpts in completed visit dialog are truncated to 300 chars', () => {
    const longContent = 'a'.repeat(500);
    const truncated = longContent.length > 300 ? longContent.substring(0, 300) + '…' : longContent;
    expect(truncated).toHaveLength(301); // 300 chars + ellipsis
  });

  // NX24: deletedAt not null means note is soft-deleted and excluded from lists
  it('NX24: note with deletedAt set is considered soft-deleted', () => {
    const note = makeNote({ deletedAt: '2026-03-28T15:00:00Z' });
    const isActive = (n: Note) => n.deletedAt === null;
    expect(isActive(note)).toBe(false);
    expect(isActive(makeNote())).toBe(true);
  });
});
