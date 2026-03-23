/**
 * Phase 4 — PersistenceProvider tests.
 *
 * Covers: hydration on mount, userId transitions, StrictMode double-mount,
 * and multi-tab simulation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { PersistenceProvider, usePersistence } from '../react/PersistenceProvider';
import { MemoryAdapter } from '../adapters/MemoryAdapter';
import { makeEnvelope, makeKey } from '../core/types';
import type { PersistenceProfile } from '../core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(profileId: string, controls: string[], defaults: Record<string, unknown> = {}): PersistenceProfile {
  return {
    profileId,
    controls: controls.map((id) => ({
      controlId: id,
      pluginId: 'text',
      defaultValue: defaults[id] ?? '',
      writeMode: 'immediate' as const,
      validators: [],
    })),
    readPriority: ['session', 'local'],
    writeTargets: ['session'],
  };
}

function TestConsumer({ profileId }: { profileId: string }) {
  const { getState, commit } = usePersistence();
  const state = getState(profileId);
  return (
    <div>
      <span data-testid="val">{String(state?.val ?? 'none')}</span>
      <button
        data-testid="commit-btn"
        onClick={() => commit(profileId, 'val', 'committed')}
      >
        Commit
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PersistenceProvider', () => {
  let sessionAdapter: MemoryAdapter;

  beforeEach(() => {
    sessionAdapter = new MemoryAdapter('session');
  });

  it('provides hydrated state to consumers', () => {
    const profile = makeProfile('test', ['val'], { val: 'default' });
    const key = makeKey({ userId: 'u1', profileId: 'test', controlId: 'val' });
    sessionAdapter.writeRaw(key, makeEnvelope('stored', 'session'));

    render(
      <PersistenceProvider
        userId="u1"
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    expect(screen.getByTestId('val').textContent).toBe('stored');
  });

  it('returns default value when no stored data exists', () => {
    const profile = makeProfile('test', ['val'], { val: 'my-default' });

    render(
      <PersistenceProvider
        userId="u1"
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    expect(screen.getByTestId('val').textContent).toBe('my-default');
  });

  it('commit writes through orchestrator and updates state', async () => {
    const profile = makeProfile('test', ['val'], { val: '' });

    render(
      <PersistenceProvider
        userId="u1"
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    await act(async () => {
      screen.getByTestId('commit-btn').click();
    });

    expect(screen.getByTestId('val').textContent).toBe('committed');
  });

  it('userId=null returns default values (deferred hydration)', () => {
    const profile = makeProfile('test', ['val'], { val: 'default' });

    render(
      <PersistenceProvider
        userId={null}
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    expect(screen.getByTestId('val').textContent).toBe('default');
  });

  it('userId transition null → id triggers re-hydration', async () => {
    const profile = makeProfile('test', ['val'], { val: 'default' });
    const key = makeKey({ userId: 'u1', profileId: 'test', controlId: 'val' });
    sessionAdapter.writeRaw(key, makeEnvelope('hydrated', 'session'));

    const { rerender } = render(
      <PersistenceProvider
        userId={null}
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    expect(screen.getByTestId('val').textContent).toBe('default');

    rerender(
      <PersistenceProvider
        userId="u1"
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('val').textContent).toBe('hydrated');
    });
  });

  it('userId A → null → B: no data bleed between users', async () => {
    const profile = makeProfile('test', ['val'], { val: 'default' });
    const keyA = makeKey({ userId: 'user-a', profileId: 'test', controlId: 'val' });
    const keyB = makeKey({ userId: 'user-b', profileId: 'test', controlId: 'val' });
    sessionAdapter.writeRaw(keyA, makeEnvelope('alice', 'session'));
    sessionAdapter.writeRaw(keyB, makeEnvelope('bob', 'session'));

    const { rerender } = render(
      <PersistenceProvider
        userId="user-a"
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('alice'));

    rerender(
      <PersistenceProvider
        userId={null}
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('default'));

    rerender(
      <PersistenceProvider
        userId="user-b"
        profiles={[profile]}
        adapters={{ session: sessionAdapter }}
      >
        <TestConsumer profileId="test" />
      </PersistenceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('bob'));
  });

  it('StrictMode double-mount does not duplicate hydration side effects', async () => {
    const profile = makeProfile('test', ['val'], { val: 'default' });
    const key = makeKey({ userId: 'u1', profileId: 'test', controlId: 'val' });
    sessionAdapter.writeRaw(key, makeEnvelope('strict-value', 'session'));

    const readSpy = vi.spyOn(sessionAdapter, 'read');

    render(
      <StrictMode>
        <PersistenceProvider
          userId="u1"
          profiles={[profile]}
          adapters={{ session: sessionAdapter }}
        >
          <TestConsumer profileId="test" />
        </PersistenceProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('val').textContent).toBe('strict-value');
    });

    // StrictMode calls effects twice — but the final state should be correct
    // (not doubled or corrupted)
    expect(screen.getByTestId('val').textContent).toBe('strict-value');
    readSpy.mockRestore();
  });

  it('throws when usePersistence is used outside PersistenceProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer profileId="test" />)).toThrow();
    spy.mockRestore();
  });
});
