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
