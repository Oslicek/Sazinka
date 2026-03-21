import { describe, it, expect } from 'vitest';
import { formatMinutesHm } from './timeFormatters';

describe('formatMinutesHm', () => {
  it('formats values under one hour as minutes', () => {
    expect(formatMinutesHm(0)).toBe('0min');
    expect(formatMinutesHm(45)).toBe('45min');
    expect(formatMinutesHm(59)).toBe('59min');
  });

  it('formats exact hours without minute suffix', () => {
    expect(formatMinutesHm(60)).toBe('1h');
    expect(formatMinutesHm(120)).toBe('2h');
  });

  it('formats hours with zero-padded minute remainder', () => {
    expect(formatMinutesHm(125)).toBe('2h 05min');
    expect(formatMinutesHm(90)).toBe('1h 30min');
  });

  it('clamps negative values to zero', () => {
    expect(formatMinutesHm(-5)).toBe('0min');
  });

  it('rounds fractional values to nearest minute', () => {
    expect(formatMinutesHm(1.7)).toBe('2min');
    expect(formatMinutesHm(89.5)).toBe('1h 30min');
  });
});
