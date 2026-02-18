import { describe, it, expect } from 'vitest';
import { resolveRevisionDuration } from './resolveRevisionDuration';

describe('resolveRevisionDuration', () => {
  const globalDefault = 60;

  describe('stop-level override takes highest priority', () => {
    it('uses stop override when all three are provided', () => {
      expect(resolveRevisionDuration(45, 90, globalDefault)).toBe(45);
    });

    it('uses stop override even when device type default is larger', () => {
      expect(resolveRevisionDuration(30, 120, globalDefault)).toBe(30);
    });

    it('uses stop override even when global default is larger', () => {
      expect(resolveRevisionDuration(15, null, globalDefault)).toBe(15);
    });
  });

  describe('device type default is the second priority', () => {
    it('uses device type default when no stop override', () => {
      expect(resolveRevisionDuration(null, 90, globalDefault)).toBe(90);
    });

    it('uses device type default when stop override is undefined', () => {
      expect(resolveRevisionDuration(undefined, 45, globalDefault)).toBe(45);
    });

    it('uses device type default when stop override is 0 (invalid)', () => {
      expect(resolveRevisionDuration(0, 45, globalDefault)).toBe(45);
    });

    it('uses device type default over global default', () => {
      expect(resolveRevisionDuration(undefined, 30, globalDefault)).toBe(30);
    });
  });

  describe('global default is the final fallback', () => {
    it('uses global default when stop override and device type default are null', () => {
      expect(resolveRevisionDuration(null, null, globalDefault)).toBe(globalDefault);
    });

    it('uses global default when both are undefined', () => {
      expect(resolveRevisionDuration(undefined, undefined, globalDefault)).toBe(globalDefault);
    });

    it('uses global default when device type default is 0 (invalid)', () => {
      expect(resolveRevisionDuration(null, 0, globalDefault)).toBe(globalDefault);
    });

    it('uses global default when both overrides are 0', () => {
      expect(resolveRevisionDuration(0, 0, globalDefault)).toBe(globalDefault);
    });
  });

  describe('edge cases', () => {
    it('works with all equal values', () => {
      expect(resolveRevisionDuration(60, 60, 60)).toBe(60);
    });

    it('returns globalDefault as-is when globalDefault is only option', () => {
      expect(resolveRevisionDuration(null, null, 120)).toBe(120);
    });

    it('stopOverride = 1 is a valid (minimal) override', () => {
      expect(resolveRevisionDuration(1, 60, globalDefault)).toBe(1);
    });
  });
});
