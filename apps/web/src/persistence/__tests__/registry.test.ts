/**
 * Phase 3 — Plugin registry tests.
 */
import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../plugins/registry';
import { DatePlugin } from '../plugins/DatePlugin';
import { EnumPlugin } from '../plugins/EnumPlugin';

describe('PluginRegistry', () => {
  it('register and get returns the registered plugin', () => {
    const registry = new PluginRegistry();
    const plugin = new DatePlugin();
    registry.register('date', plugin);
    expect(registry.get('date')).toBe(plugin);
  });

  it('get returns undefined for unregistered id', () => {
    const registry = new PluginRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('register throws on duplicate id', () => {
    const registry = new PluginRegistry();
    registry.register('date', new DatePlugin());
    expect(() => registry.register('date', new DatePlugin())).toThrow();
  });

  it('different plugins can be registered with different ids', () => {
    const registry = new PluginRegistry();
    registry.register('date', new DatePlugin());
    registry.register('sortOrder', new EnumPlugin(['asc', 'desc'], 'asc'));
    expect(registry.get('date')).toBeInstanceOf(DatePlugin);
    expect(registry.get('sortOrder')).toBeInstanceOf(EnumPlugin);
  });

  it('has returns true for registered plugin', () => {
    const registry = new PluginRegistry();
    registry.register('date', new DatePlugin());
    expect(registry.has('date')).toBe(true);
  });

  it('has returns false for unregistered plugin', () => {
    const registry = new PluginRegistry();
    expect(registry.has('nope')).toBe(false);
  });
});
