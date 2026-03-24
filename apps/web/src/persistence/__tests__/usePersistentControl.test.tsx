/**
 * Phase 4 — usePersistentControl tests.
 *
 * Covers: hydration, commit, debounce flush on unmount, navigation race.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { PersistenceProvider } from '../react/PersistenceProvider';
import { usePersistentControl } from '../react/usePersistentControl';
import { MemoryAdapter } from '../adapters/MemoryAdapter';
import { makeEnvelope, makeKey } from '../core/types';
import type { PersistenceProfile } from '../core/types';

function makeProfile(profileId: string, controlId: string, defaultValue: unknown): PersistenceProfile {
  return {
    profileId,
    controls: [{
      controlId,
      pluginId: 'text',
      defaultValue,
      writeMode: 'immediate' as const,
      validators: [],
    }],
    readPriority: ['session'],
    writeTargets: ['session'],
  };
}

function ControlConsumer({
  profileId,
  controlId,
  debounceMs,
}: {
  profileId: string;
  controlId: string;
  debounceMs?: number;
}) {
  const { value, setValue } = usePersistentControl<string>(profileId, controlId, debounceMs);
  return (
    <div>
      <span data-testid="value">{String(value ?? 'none')}</span>
      <button data-testid="set-btn" onClick={() => setValue('new-value')}>Set</button>
      <button data-testid="set-debounced" onClick={() => setValue('debounced-value')}>Debounce</button>
    </div>
  );
}

describe('usePersistentControl', () => {
  let sessionAdapter: MemoryAdapter;

  beforeEach(() => {
    sessionAdapter = new MemoryAdapter('session');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function wrap(profileId: string, controlId: string, defaultValue: unknown, debounceMs?: number) {
    const profile = makeProfile(profileId, controlId, defaultValue);
    return render(
      <PersistenceProvider userId="u1" profiles={[profile]} adapters={{ session: sessionAdapter }}>
        <ControlConsumer profileId={profileId} controlId={controlId} debounceMs={debounceMs} />
      </PersistenceProvider>,
    );
  }

  it('returns hydrated value from storage', () => {
    const key = makeKey({ userId: 'u1', profileId: 'p', controlId: 'c' });
    sessionAdapter.writeRaw(key, makeEnvelope('stored', 'session'));
    wrap('p', 'c', 'default');
    expect(screen.getByTestId('value').textContent).toBe('stored');
  });

  it('returns default when no stored value', () => {
    wrap('p', 'c', 'my-default');
    expect(screen.getByTestId('value').textContent).toBe('my-default');
  });

  it('setValue updates displayed value', async () => {
    wrap('p', 'c', '');
    await act(async () => { screen.getByTestId('set-btn').click(); });
    expect(screen.getByTestId('value').textContent).toBe('new-value');
  });

  it('setValue writes to storage', async () => {
    wrap('p', 'c', '');
    await act(async () => { screen.getByTestId('set-btn').click(); });
    const key = makeKey({ userId: 'u1', profileId: 'p', controlId: 'c' });
    expect(sessionAdapter.readRaw(key)?.value).toBe('new-value');
  });

  it('debounced control flushes on unmount', async () => {
    const { unmount } = wrap('p', 'c', '', 300);
    await act(async () => { screen.getByTestId('set-debounced').click(); });
    // Don't advance timers — unmount should flush
    unmount();
    const key = makeKey({ userId: 'u1', profileId: 'p', controlId: 'c' });
    expect(sessionAdapter.readRaw(key)?.value).toBe('debounced-value');
  });

  it('debounced setValue does NOT call commit immediately on each keystroke', async () => {
    const { unmount } = wrap('p', 'c', '', 300);
    const key = makeKey({ userId: 'u1', profileId: 'p', controlId: 'c' });

    // Click debounce button — should NOT write to storage yet
    await act(async () => { screen.getByTestId('set-debounced').click(); });

    // Before timer fires, storage must still be empty (no immediate commit)
    expect(sessionAdapter.readRaw(key)).toBeNull();

    // Advance timer — now it should write
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(sessionAdapter.readRaw(key)?.value).toBe('debounced-value');

    unmount();
  });

  it('rapid debounced setValue calls produce only one commit after settle', async () => {
    const profile = makeProfile('p', 'c', '');
    let commitCount = 0;

    // Wrap with a spy adapter
    const spyAdapter = new MemoryAdapter('session');
    const originalWrite = spyAdapter.write.bind(spyAdapter);
    spyAdapter.write = (key, env, ctx) => { commitCount++; originalWrite(key, env, ctx); };

    const { unmount } = render(
      <PersistenceProvider userId="u1" profiles={[profile]} adapters={{ session: spyAdapter }}>
        <ControlConsumer profileId="p" controlId="c" debounceMs={300} />
      </PersistenceProvider>,
    );

    // Simulate rapid typing (3 keystrokes)
    await act(async () => { screen.getByTestId('set-debounced').click(); });
    await act(async () => { screen.getByTestId('set-debounced').click(); });
    await act(async () => { screen.getByTestId('set-debounced').click(); });

    // Still no commit yet (debounce not settled)
    expect(commitCount).toBe(0);

    // Settle debounce
    await act(async () => { vi.advanceTimersByTime(300); });

    // Exactly one commit
    expect(commitCount).toBe(1);
    unmount();
  });

  it('non-debounced setValue still calls commit immediately (no regression)', async () => {
    wrap('p', 'c', '');
    const key = makeKey({ userId: 'u1', profileId: 'p', controlId: 'c' });

    await act(async () => { screen.getByTestId('set-btn').click(); });

    // Immediate commit — no timer needed
    expect(sessionAdapter.readRaw(key)?.value).toBe('new-value');
  });

  it('controlled component rerenders do not lose persisted value', async () => {
    const profile = makeProfile('p', 'c', '');
    const key = makeKey({ userId: 'u1', profileId: 'p', controlId: 'c' });
    sessionAdapter.writeRaw(key, makeEnvelope('persisted', 'session'));

    const { rerender } = render(
      <PersistenceProvider userId="u1" profiles={[profile]} adapters={{ session: sessionAdapter }}>
        <ControlConsumer profileId="p" controlId="c" />
      </PersistenceProvider>,
    );

    expect(screen.getByTestId('value').textContent).toBe('persisted');

    rerender(
      <PersistenceProvider userId="u1" profiles={[profile]} adapters={{ session: sessionAdapter }}>
        <ControlConsumer profileId="p" controlId="c" />
      </PersistenceProvider>,
    );

    expect(screen.getByTestId('value').textContent).toBe('persisted');
  });
});
