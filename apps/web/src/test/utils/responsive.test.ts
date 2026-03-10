import { describe, it, expect, vi, afterEach } from 'vitest';
import { setViewport, mockMatchMedia, VIEWPORTS } from './responsive';

describe('responsive test utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setViewport', () => {
    it('updates window.innerWidth and innerHeight', () => {
      setViewport(390, 844);
      expect(window.innerWidth).toBe(390);
      expect(window.innerHeight).toBe(844);
    });

    it('dispatches a resize event', () => {
      const listener = vi.fn();
      window.addEventListener('resize', listener);
      setViewport(1280, 800);
      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener('resize', listener);
    });
  });

  describe('mockMatchMedia', () => {
    it('matches max-width query when width is within range', () => {
      mockMatchMedia(390);
      const result = window.matchMedia('(max-width: 639px)');
      expect(result.matches).toBe(true);
    });

    it('does not match max-width query when width exceeds it', () => {
      mockMatchMedia(1280);
      const result = window.matchMedia('(max-width: 639px)');
      expect(result.matches).toBe(false);
    });

    it('matches min-width query when width meets minimum', () => {
      mockMatchMedia(1280);
      const result = window.matchMedia('(min-width: 1024px)');
      expect(result.matches).toBe(true);
    });

    it('does not match min-width query when width is below minimum', () => {
      mockMatchMedia(768);
      const result = window.matchMedia('(min-width: 1024px)');
      expect(result.matches).toBe(false);
    });
  });

  describe('VIEWPORTS', () => {
    it('desktop viewport is >= 1024px wide', () => {
      expect(VIEWPORTS.desktop.width).toBeGreaterThanOrEqual(1024);
    });

    it('tablet viewport is between 640px and 1023px', () => {
      expect(VIEWPORTS.tablet.width).toBeGreaterThanOrEqual(640);
      expect(VIEWPORTS.tablet.width).toBeLessThanOrEqual(1023);
    });

    it('phone viewport is <= 639px wide', () => {
      expect(VIEWPORTS.phone.width).toBeLessThanOrEqual(639);
    });
  });
});
