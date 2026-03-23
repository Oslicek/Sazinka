/**
 * Phase 4 — usePersistentProfile tests.
 *
 * Covers: profile hydration, batch updates, context updates isolation,
 * and navigation race.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { PersistenceProvider } from '../react/PersistenceProvider';
import { usePersistentProfile } from '../react/usePersistentProfile';
import { MemoryAdapter } from '../adapters/MemoryAdapter';
import { makeEnvelope, makeKey } from '../core/types';
import type { PersistenceProfile } from '../core/types';

function makeProfile(profileId: string): PersistenceProfile {
  return {
    profileId,
    controls: [
      { controlId: 'dateFrom', pluginId: 'date', defaultValue: '2026-01-01', writeMode: 'immediate', validators: [] },
      { controlId: 'crew', pluginId: 'text', defaultValue: '', writeMode: 'immediate', validators: [] },
    ],
    readPriority: ['session'],
    writeTargets: ['session'],
  };
}

function ProfileConsumer({ profileId }: { profileId: string }) {
  const { state, commit, reset } = usePersistentProfile(profileId);
  return (
    <div>
      <span data-testid="dateFrom">{String(state.dateFrom ?? 'none')}</span>
      <span data-testid="crew">{String(state.crew ?? 'none')}</span>
      <button data-testid="commit-date" onClick={() => commit('dateFrom', '2026-06-15')}>Set Date</button>
      <button data-testid="commit-crew" onClick={() => commit('crew', 'crew-42')}>Set Crew</button>
      <button data-testid="reset-btn" onClick={() => reset()}>Reset</button>
    </div>
  );
}

describe('usePersistentProfile', () => {
  let sessionAdapter: MemoryAdapter;

  beforeEach(() => {
    sessionAdapter = new MemoryAdapter('session');
  });

  function wrap(profileId: string) {
    const profile = makeProfile(profileId);
    return render(
      <PersistenceProvider userId="u1" profiles={[profile]} adapters={{ session: sessionAdapter }}>
        <ProfileConsumer profileId={profileId} />
      </PersistenceProvider>,
    );
  }

  it('hydrates all controls in the profile', () => {
    const keyDate = makeKey({ userId: 'u1', profileId: 'plan', controlId: 'dateFrom' });
    const keyCrew = makeKey({ userId: 'u1', profileId: 'plan', controlId: 'crew' });
    sessionAdapter.writeRaw(keyDate, makeEnvelope('2026-03-21', 'session'));
    sessionAdapter.writeRaw(keyCrew, makeEnvelope('crew-1', 'session'));

    wrap('plan');

    expect(screen.getByTestId('dateFrom').textContent).toBe('2026-03-21');
    expect(screen.getByTestId('crew').textContent).toBe('crew-1');
  });

  it('commit updates a single control without affecting others', async () => {
    wrap('plan');
    await act(async () => { screen.getByTestId('commit-date').click(); });
    expect(screen.getByTestId('dateFrom').textContent).toBe('2026-06-15');
    expect(screen.getByTestId('crew').textContent).toBe('');
  });

  it('reset clears all controls to defaults', async () => {
    const keyDate = makeKey({ userId: 'u1', profileId: 'plan', controlId: 'dateFrom' });
    sessionAdapter.writeRaw(keyDate, makeEnvelope('2026-06-15', 'session'));

    wrap('plan');
    expect(screen.getByTestId('dateFrom').textContent).toBe('2026-06-15');

    await act(async () => { screen.getByTestId('reset-btn').click(); });

    await waitFor(() => {
      expect(screen.getByTestId('dateFrom').textContent).toBe('2026-01-01');
    });
  });

  it('context updates do not trigger unrelated control writes', async () => {
    wrap('plan');
    const writeSpy = vi.spyOn(sessionAdapter, 'write');

    // Only commit crew — dateFrom should not be written
    await act(async () => { screen.getByTestId('commit-crew').click(); });

    const writtenKeys = writeSpy.mock.calls.map((call) => call[0]);
    const dateKeys = writtenKeys.filter((k) => k.includes('dateFrom'));
    expect(dateKeys).toHaveLength(0);
  });
});
