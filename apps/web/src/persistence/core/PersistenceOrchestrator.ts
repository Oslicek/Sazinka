/**
 * PersistenceOrchestrator — central facade for the UPP.
 *
 * Coordinates adapters, plugins, precedence, and profile management.
 * Pages interact exclusively through this class.
 */
import { resolvePrecedence } from './precedence';
import { makeEnvelope, makeKey, isValidEnvelope } from './types';
import type {
  PersistenceAdapter,
  PersistenceProfile,
  HydrationContext,
  HydratedState,
  ChannelId,
} from './types';

interface OrchestratorOptions {
  adapters: Partial<Record<ChannelId, PersistenceAdapter>>;
}

export class PersistenceOrchestrator {
  private adapters: Partial<Record<ChannelId, PersistenceAdapter>>;

  constructor({ adapters }: OrchestratorOptions) {
    this.adapters = adapters;
  }

  hydrateProfile(profile: PersistenceProfile, ctx: HydrationContext): HydratedState {
    const state: HydratedState = {};

    for (const control of profile.controls) {
      if (ctx.userId === null) {
        state[control.controlId] = control.defaultValue;
        continue;
      }

      const key = makeKey({
        userId: ctx.userId,
        profileId: profile.profileId,
        controlId: control.controlId,
      });

      const envelopes = profile.readPriority
        .map((channelId) => this.adapters[channelId]?.read(key, ctx) ?? null)
        .filter((e): e is NonNullable<typeof e> => e !== null && isValidEnvelope(e));

      const resolved = resolvePrecedence(envelopes);
      const raw = resolved !== null ? resolved.value : control.defaultValue;
      state[control.controlId] = control.sanitize ? (control.sanitize as (v: unknown) => unknown)(raw) : raw;
    }

    return state;
  }

  commit(
    profile: PersistenceProfile,
    controlId: string,
    value: unknown,
    ctx: HydrationContext,
  ): void {
    if (ctx.userId === null) return;

    const control = profile.controls.find((c) => c.controlId === controlId);
    const sanitized = control?.sanitize
      ? (control.sanitize as (v: unknown) => unknown)(value)
      : value;

    const key = makeKey({
      userId: ctx.userId,
      profileId: profile.profileId,
      controlId,
    });

    // No-op if value hasn't changed (check first writeTarget)
    const firstTarget = profile.writeTargets[0];
    if (firstTarget) {
      const existing = this.adapters[firstTarget]?.read(key, ctx);
      if (isValidEnvelope(existing) && existing.value === sanitized) return;
    }

    const envelope = makeEnvelope(sanitized, profile.writeTargets[0] ?? 'session');
    for (const channelId of profile.writeTargets) {
      const adapter = this.adapters[channelId];
      if (adapter) {
        adapter.write(key, { ...envelope, source: channelId }, ctx);
      }
    }
  }

  clear(
    profile: PersistenceProfile,
    controlId: string,
    ctx: HydrationContext,
  ): void {
    if (ctx.userId === null) return;

    const key = makeKey({
      userId: ctx.userId,
      profileId: profile.profileId,
      controlId,
    });

    for (const channelId of profile.writeTargets) {
      this.adapters[channelId]?.remove(key, ctx);
    }
  }

  resetProfile(profile: PersistenceProfile, ctx: HydrationContext): void {
    for (const control of profile.controls) {
      this.clear(profile, control.controlId, ctx);
    }
  }
}
