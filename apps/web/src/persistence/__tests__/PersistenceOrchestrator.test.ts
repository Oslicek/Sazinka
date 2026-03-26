/**
 * Phase 1 — PersistenceOrchestrator tests.
 *
 * Tests the central orchestrator that coordinates adapters, plugins,
 * precedence, and profile management.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PersistenceOrchestrator } from '../core/PersistenceOrchestrator';
import { MemoryAdapter } from '../adapters/MemoryAdapter';
import { makeEnvelope, makeKey, type ChannelId } from '../core/types';
import type { PersistenceProfile, ControlSpec, HydrationContext } from '../core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(
  profileId: string,
  controls: ControlSpec[],
  readPriority: ChannelId[] = ['url', 'session', 'local', 'server'],
  writeTargets: ChannelId[] = ['session'],
): PersistenceProfile {
  return { profileId, controls, readPriority, writeTargets };
}

function makeControl(
  controlId: string,
  defaultValue: unknown,
  overrides: Partial<ControlSpec> = {},
): ControlSpec {
  return {
    controlId,
    pluginId: 'text',
    defaultValue,
    writeMode: 'immediate',
    validators: [],
    ...overrides,
  };
}

function makeCtx(userId = 'user-1'): HydrationContext {
  return { userId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PersistenceOrchestrator', () => {
  let sessionAdapter: MemoryAdapter;
  let localAdapter: MemoryAdapter;
  let urlAdapter: MemoryAdapter;
  let orchestrator: PersistenceOrchestrator;

  beforeEach(() => {
    sessionAdapter = new MemoryAdapter('session');
    localAdapter = new MemoryAdapter('local');
    urlAdapter = new MemoryAdapter('url');
    orchestrator = new PersistenceOrchestrator({
      adapters: { session: sessionAdapter, local: localAdapter, url: urlAdapter },
    });
  });

  // ── Hydration ──────────────────────────────────────────────────────────────

  it('hydrateProfile returns default values when no storage data exists', () => {
    const profile = makeProfile('test', [
      makeControl('dateFrom', '2026-01-01'),
      makeControl('crew', ''),
    ]);
    const result = orchestrator.hydrateProfile(profile, makeCtx());
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.crew).toBe('');
  });

  it('hydrateProfile returns stored value over default', () => {
    const profile = makeProfile('test', [makeControl('dateFrom', '2026-01-01')]);
    const ctx = makeCtx();
    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'dateFrom' });
    sessionAdapter.writeRaw(key, makeEnvelope('2026-06-15', 'session'));

    const result = orchestrator.hydrateProfile(profile, ctx);
    expect(result.dateFrom).toBe('2026-06-15');
  });

  it('hydrateProfile respects readPriority: url over session', () => {
    const profile = makeProfile('test', [makeControl('dateFrom', 'default')], ['url', 'session']);
    const ctx = makeCtx();
    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'dateFrom' });
    sessionAdapter.writeRaw(key, makeEnvelope('from-session', 'session'));
    urlAdapter.writeRaw(key, makeEnvelope('from-url', 'url'));

    const result = orchestrator.hydrateProfile(profile, ctx);
    expect(result.dateFrom).toBe('from-url');
  });

  it('hydrateProfile falls back to default for unknown channel in readPriority', () => {
    const profile = makeProfile(
      'test',
      [makeControl('x', 'default')],
      ['url' as ChannelId, 'nonexistent' as ChannelId],
    );
    const result = orchestrator.hydrateProfile(profile, makeCtx());
    expect(result.x).toBe('default');
  });

  it('hydrateProfile ignores invalid envelope version', () => {
    const profile = makeProfile('test', [makeControl('val', 'default')]);
    const ctx = makeCtx();
    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'val' });
    sessionAdapter.writeRaw(key, { v: 99, ts: Date.now(), value: 'bad', source: 'session' } as never);

    const result = orchestrator.hydrateProfile(profile, ctx);
    expect(result.val).toBe('default');
  });

  // ── Commit ─────────────────────────────────────────────────────────────────

  it('commit writes value to all writeTargets', () => {
    const profile = makeProfile('test', [makeControl('crew', '')], ['session'], ['session', 'local']);
    const ctx = makeCtx();
    orchestrator.commit(profile, 'crew', 'crew-42', ctx);

    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'crew' });
    const sessionVal = sessionAdapter.readRaw(key);
    const localVal = localAdapter.readRaw(key);
    expect(sessionVal?.value).toBe('crew-42');
    expect(localVal?.value).toBe('crew-42');
  });

  it('commit is a no-op when new value equals current value (equals check)', () => {
    const profile = makeProfile('test', [makeControl('crew', 'crew-1')]);
    const ctx = makeCtx();
    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'crew' });
    sessionAdapter.writeRaw(key, makeEnvelope('crew-1', 'session'));

    const writeSpy = vi.spyOn(sessionAdapter, 'write');
    orchestrator.commit(profile, 'crew', 'crew-1', ctx);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('commit writes when value changes', () => {
    const profile = makeProfile('test', [makeControl('crew', 'crew-1')]);
    const ctx = makeCtx();
    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'crew' });
    sessionAdapter.writeRaw(key, makeEnvelope('crew-1', 'session'));

    const writeSpy = vi.spyOn(sessionAdapter, 'write');
    orchestrator.commit(profile, 'crew', 'crew-2', ctx);
    expect(writeSpy).toHaveBeenCalledOnce();
  });

  it('commit applies sanitize before writing when control has a sanitizer', () => {
    const sanitize = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : 'default');
    const profile = makeProfile('test', [makeControl('tag', 'default', { sanitize })]);
    const ctx = makeCtx();
    orchestrator.commit(profile, 'tag', '  HELLO  ', ctx);

    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'tag' });
    expect(sessionAdapter.readRaw(key)?.value).toBe('hello');
  });

  it('commit sanitize no-op check uses sanitized value', () => {
    const sanitize = (v: unknown) => (typeof v === 'string' ? v.trim() : 'default');
    const profile = makeProfile('test', [makeControl('tag', 'default', { sanitize })]);
    const ctx = makeCtx();
    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'tag' });
    sessionAdapter.writeRaw(key, makeEnvelope('hello', 'session'));

    const writeSpy = vi.spyOn(sessionAdapter, 'write');
    orchestrator.commit(profile, 'tag', '  hello  ', ctx);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  // ── Clear ──────────────────────────────────────────────────────────────────

  it('clear removes value from all writeTargets', () => {
    const profile = makeProfile('test', [makeControl('crew', '')], ['session'], ['session', 'local']);
    const ctx = makeCtx();
    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'crew' });
    sessionAdapter.writeRaw(key, makeEnvelope('crew-1', 'session'));
    localAdapter.writeRaw(key, makeEnvelope('crew-1', 'local'));

    orchestrator.clear(profile, 'crew', ctx);

    expect(sessionAdapter.readRaw(key)).toBeNull();
    expect(localAdapter.readRaw(key)).toBeNull();
  });

  // ── resetProfile ───────────────────────────────────────────────────────────

  it('resetProfile clears all controls for that profile only', () => {
    const profile = makeProfile('test', [makeControl('a', ''), makeControl('b', '')]);
    const otherProfile = makeProfile('other', [makeControl('x', '')]);
    const ctx = makeCtx();

    const keyA = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'a' });
    const keyB = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'b' });
    const keyX = makeKey({ userId: ctx.userId, profileId: 'other', controlId: 'x' });

    sessionAdapter.writeRaw(keyA, makeEnvelope('val-a', 'session'));
    sessionAdapter.writeRaw(keyB, makeEnvelope('val-b', 'session'));
    sessionAdapter.writeRaw(keyX, makeEnvelope('val-x', 'session'));

    orchestrator.resetProfile(profile, ctx);

    expect(sessionAdapter.readRaw(keyA)).toBeNull();
    expect(sessionAdapter.readRaw(keyB)).toBeNull();
    expect(sessionAdapter.readRaw(keyX)?.value).toBe('val-x'); // other profile untouched
  });

  // ── User isolation ─────────────────────────────────────────────────────────

  it('userA cannot read userB values (namespace isolation)', () => {
    const profile = makeProfile('test', [makeControl('val', 'default')]);
    const ctxA = makeCtx('user-a');
    const ctxB = makeCtx('user-b');

    const keyA = makeKey({ userId: 'user-a', profileId: 'test', controlId: 'val' });
    sessionAdapter.writeRaw(keyA, makeEnvelope('alice-value', 'session'));

    const resultB = orchestrator.hydrateProfile(profile, ctxB);
    expect(resultB.val).toBe('default'); // user-b gets default, not alice's value
  });

  it('different users can store different values for the same control', () => {
    const profile = makeProfile('test', [makeControl('val', 'default')]);
    const ctxA = makeCtx('user-a');
    const ctxB = makeCtx('user-b');

    orchestrator.commit(profile, 'val', 'alice', ctxA);
    orchestrator.commit(profile, 'val', 'bob', ctxB);

    const resultA = orchestrator.hydrateProfile(profile, ctxA);
    const resultB = orchestrator.hydrateProfile(profile, ctxB);
    expect(resultA.val).toBe('alice');
    expect(resultB.val).toBe('bob');
  });

  // ── Deferred hydration ─────────────────────────────────────────────────────

  it('hydrateProfile with null userId returns defaults (deferred hydration)', () => {
    const profile = makeProfile('test', [makeControl('val', 'default')]);
    const result = orchestrator.hydrateProfile(profile, { userId: null });
    expect(result.val).toBe('default');
  });

  // ── Newest timestamp tie-breaker ───────────────────────────────────────────

  it('newest timestamp wins when two session envelopes exist for same key', () => {
    const profile = makeProfile('test', [makeControl('val', 'default')], ['session']);
    const ctx = makeCtx();
    const key = makeKey({ userId: ctx.userId, profileId: 'test', controlId: 'val' });

    // Write older value first, then newer
    sessionAdapter.writeRaw(key, { v: 1, ts: Date.now() - 5000, value: 'old', source: 'session' });
    // Overwrite with newer
    sessionAdapter.writeRaw(key, { v: 1, ts: Date.now(), value: 'new', source: 'session' });

    const result = orchestrator.hydrateProfile(profile, ctx);
    expect(result.val).toBe('new');
  });
});
