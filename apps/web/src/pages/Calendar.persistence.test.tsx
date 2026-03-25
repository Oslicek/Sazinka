/**
 * P1-3 — Calendar page persistence tests
 *
 * Covers:
 *  - currentDate survives unmount/remount via UPP session channel
 *  - selectedDay survives unmount/remount via UPP session channel
 *  - both survive two unmount/remount cycles
 *  - Date serialization roundtrip (year/month/day preserved, no timezone drift)
 *  - corrupted storage falls back gracefully
 *
 * TDD: RED tests written before implementing UPP wiring in Calendar.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { makeEnvelope, makeKey } from '../persistence/core/types';
import { CALENDAR_PROFILE_ID } from '../persistence/profiles/calendarProfile';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@/hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => ({
    breakpoint: 'desktop',
    isPhone: false,
    isMobileUi: false,
    isTouch: false,
  })),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
  useSearch: vi.fn(() => ({})),
  Link: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
    <a {...(props as Record<string, unknown>)}>{children}</a>
  ),
}));

vi.mock('../stores/natsStore', () => ({
  useNatsStore: vi.fn((selector?: (s: { isConnected: boolean }) => unknown) => {
    const state = { isConnected: true };
    return selector ? selector(state) : state;
  }),
}));

const TEST_USER_ID = 'calendar-test-user';

vi.mock('../stores/authStore', () => ({
  useAuthStore: vi.fn((selector?: (s: { user: { id: string } | null }) => unknown) => {
    const state = { user: { id: TEST_USER_ID } };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('../services/calendarService', () => ({
  listCalendarItems: vi.fn().mockResolvedValue({ items: [] }),
}));

vi.mock('../services/crewService', () => ({
  listCrews: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/routeService', () => ({
  listRoutesForDate: vi.fn().mockResolvedValue({ routes: [] }),
}));

vi.mock('../components/calendar', () => ({
  CalendarGrid: () => <div data-testid="calendar-grid" />,
}));

vi.mock('../components/calendar/DayCell', () => ({
  DayCell: () => <div data-testid="day-cell" />,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

import * as calendarService from '../services/calendarService';

function seedUpp(controlId: string, value: unknown) {
  const key = makeKey({ userId: TEST_USER_ID, profileId: CALENDAR_PROFILE_ID, controlId });
  sessionStorage.setItem(key, JSON.stringify(makeEnvelope(value, 'session')));
}

import { Calendar } from './Calendar';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Calendar page — persistence (P1-3)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(calendarService.listCalendarItems).mockResolvedValue({ items: [] });
  });

  // ── currentDate persistence ────────────────────────────────────────────────

  describe('currentDate persistence', () => {
    it('restores persisted currentDate on remount — data fetch uses correct month', async () => {
      // Seed February 2026; also seed month layout so range assertion is deterministic
      seedUpp('currentDateKey', '2026-02-15');
      seedUpp('layoutMode', 'month');

      render(<Calendar />);

      await waitFor(() => {
        expect(calendarService.listCalendarItems).toHaveBeenCalledWith(
          expect.objectContaining({ startDate: '2026-02-01' }),
        );
      });
    });

    it('survives two unmount/remount cycles', async () => {
      seedUpp('currentDateKey', '2026-02-15');
      seedUpp('layoutMode', 'month');

      const { unmount: unmount1 } = render(<Calendar />);
      await waitFor(() => {
        expect(calendarService.listCalendarItems).toHaveBeenCalledWith(
          expect.objectContaining({ startDate: '2026-02-01' }),
        );
      });
      unmount1();
      vi.clearAllMocks();

      render(<Calendar />);
      await waitFor(() => {
        expect(calendarService.listCalendarItems).toHaveBeenCalledWith(
          expect.objectContaining({ startDate: '2026-02-01' }),
        );
      });
    });

    it('date serialization roundtrip — year/month/day preserved without timezone drift', async () => {
      // Seed a specific date and verify the correct month boundary is used
      seedUpp('currentDateKey', '2026-11-20');
      seedUpp('layoutMode', 'month');

      render(<Calendar />);

      await waitFor(() => {
        expect(calendarService.listCalendarItems).toHaveBeenCalledWith(
          expect.objectContaining({ startDate: '2026-11-01', endDate: '2026-11-30' }),
        );
      });
    });

    it('corrupted storage falls back to current date range', async () => {
      const key = makeKey({
        userId: TEST_USER_ID,
        profileId: CALENDAR_PROFILE_ID,
        controlId: 'currentDateKey',
      });
      sessionStorage.setItem(key, 'not-a-valid-envelope');
      seedUpp('layoutMode', 'month');

      const today = new Date();
      const expectedStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;

      render(<Calendar />);

      await waitFor(() => {
        expect(calendarService.listCalendarItems).toHaveBeenCalledWith(
          expect.objectContaining({ startDate: expectedStart }),
        );
      });
    });
  });

  // ── selectedDay persistence ────────────────────────────────────────────────

  describe('selectedDay persistence', () => {
    it('restores persisted selectedDay — details panel visible on remount', async () => {
      seedUpp('selectedDayKey', '2026-03-15');

      const { container } = render(<Calendar />);

      await waitFor(() => {
        // Day details panel renders when selectedDay is set + layoutMode is 'month'
        expect(container.querySelector('[class*="detailsOverlay"]')).toBeInTheDocument();
      });
    });

    it('survives two unmount/remount cycles', async () => {
      seedUpp('selectedDayKey', '2026-03-15');

      const { unmount: unmount1, container: c1 } = render(<Calendar />);
      await waitFor(() => {
        expect(c1.querySelector('[class*="detailsOverlay"]')).toBeInTheDocument();
      });
      unmount1();

      const { container: c2 } = render(<Calendar />);
      await waitFor(() => {
        expect(c2.querySelector('[class*="detailsOverlay"]')).toBeInTheDocument();
      });
    });

    it('no panel when selectedDayKey is empty (default)', async () => {
      const { container } = render(<Calendar />);

      // Give effects time to run
      await waitFor(() => {
        expect(calendarService.listCalendarItems).toHaveBeenCalled();
      });

      expect(container.querySelector('[class*="detailsOverlay"]')).toBeNull();
    });
  });

  // ── Both together ──────────────────────────────────────────────────────────

  it('currentDate and selectedDay survive together — no clobbering', async () => {
    seedUpp('currentDateKey', '2026-02-15');
    seedUpp('selectedDayKey', '2026-02-20');
    seedUpp('layoutMode', 'month');

    const { container } = render(<Calendar />);

    await waitFor(() => {
      expect(calendarService.listCalendarItems).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: '2026-02-01' }),
      );
    });
    await waitFor(() => {
      expect(container.querySelector('[class*="detailsOverlay"]')).toBeInTheDocument();
    });
  });
});

// ─── layoutMode persistence (BUG-FIX) ──────────────────────────────────────

describe('Calendar page — layoutMode persistence', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.mocked(calendarService.listCalendarItems).mockResolvedValue({ items: [] });
  });

  it('default layoutMode on desktop (no URL, no persisted value) is week', async () => {
    const { container } = render(<Calendar />);

    await waitFor(() => {
      expect(calendarService.listCalendarItems).toHaveBeenCalled();
    });

    // Week view renders weekHeader; month view renders CalendarGrid
    expect(container.querySelector('[class*="weekHeader"]')).toBeInTheDocument();
  });

  it('restores persisted layoutMode=month on remount', async () => {
    seedUpp('layoutMode', 'month');

    const { container } = render(<Calendar />);

    await waitFor(() => {
      expect(calendarService.listCalendarItems).toHaveBeenCalled();
    });

    // Month view renders CalendarGrid — no weekHeader
    expect(container.querySelector('[class*="weekHeader"]')).toBeNull();
    expect(container.querySelector('[data-testid="calendar-grid"]')).toBeInTheDocument();
  });

  it('restores persisted layoutMode=day on remount', async () => {
    seedUpp('layoutMode', 'day');

    const { container } = render(<Calendar />);

    await waitFor(() => {
      expect(calendarService.listCalendarItems).toHaveBeenCalled();
    });

    expect(container.querySelector('[class*="dayView"]')).toBeInTheDocument();
  });

  it('multi-cycle: layoutMode=month persists across two unmount/remount cycles', async () => {
    seedUpp('layoutMode', 'month');

    const { unmount: u1, container: c1 } = render(<Calendar />);
    await waitFor(() => expect(calendarService.listCalendarItems).toHaveBeenCalled());
    expect(c1.querySelector('[data-testid="calendar-grid"]')).toBeInTheDocument();
    u1();
    vi.clearAllMocks();

    const { container: c2 } = render(<Calendar />);
    await waitFor(() => expect(calendarService.listCalendarItems).toHaveBeenCalled());
    expect(c2.querySelector('[data-testid="calendar-grid"]')).toBeInTheDocument();
  });

  it('corrupted layoutMode storage falls back to week', async () => {
    const key = makeKey({
      userId: TEST_USER_ID,
      profileId: CALENDAR_PROFILE_ID,
      controlId: 'layoutMode',
    });
    sessionStorage.setItem(key, '{ bad json');

    const { container } = render(<Calendar />);

    await waitFor(() => {
      expect(calendarService.listCalendarItems).toHaveBeenCalled();
    });

    expect(container.querySelector('[class*="weekHeader"]')).toBeInTheDocument();
  });
});
