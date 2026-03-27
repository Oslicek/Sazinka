import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLastVisitComment, _clearLastVisitCommentCache } from '../useLastVisitComment';
import { makeVisitFixture, makeGetVisitResponse } from '@/test-utils/visitFixtures';

vi.mock('@/services/visitService', () => ({
  listVisits: vi.fn(),
  getVisit: vi.fn(),
}));

vi.mock('@/stores/natsStore', () => ({
  useNatsStore: vi.fn((selector: (s: { isConnected: boolean }) => unknown) =>
    selector({ isConnected: true }),
  ),
}));

import { listVisits, getVisit } from '@/services/visitService';
import { useNatsStore } from '@/stores/natsStore';

const mockListVisits = vi.mocked(listVisits);
const mockGetVisit = vi.mocked(getVisit);
const mockUseNatsStore = vi.mocked(useNatsStore);

function makeVisitRow(id = 'v-1', resultNotes?: string) {
  return makeVisitFixture({ id, customerId: 'c-1', resultNotes: resultNotes ?? undefined });
}

function makeFullVisitResponse(visitId = 'v-1', resultNotes?: string) {
  return makeGetVisitResponse(makeVisitFixture({ id: visitId, resultNotes: resultNotes ?? undefined }));
}

beforeEach(() => {
  vi.clearAllMocks();
  _clearLastVisitCommentCache();
  // Default: connected
  mockUseNatsStore.mockImplementation((selector: (s: { isConnected: boolean }) => unknown) =>
    selector({ isConnected: true }),
  );
});

describe('useLastVisitComment', () => {
  // 1. Calls listVisits with correct filters
  it('calls listVisits with customerId, status=completed, limit=1', async () => {
    mockListVisits.mockResolvedValue({ visits: [], total: 0 });

    renderHook(() => useLastVisitComment('cust-1'));

    await waitFor(() => expect(mockListVisits).toHaveBeenCalledOnce());
    expect(mockListVisits).toHaveBeenCalledWith({
      customerId: 'cust-1',
      status: 'completed',
      limit: 1,
    });
  });

  // 2. Calls getVisit for returned visit id; returns { notes, visit, isLoading: false }
  it('calls getVisit with the returned visit id and populates notes and visit', async () => {
    const row = makeVisitRow('v-1', 'Kotel vyměněn');
    mockListVisits.mockResolvedValue({ visits: [row], total: 1 });
    mockGetVisit.mockResolvedValue(makeFullVisitResponse('v-1', 'Kotel vyměněn'));

    const { result } = renderHook(() => useLastVisitComment('cust-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetVisit).toHaveBeenCalledWith('v-1');
    expect(result.current.notes).toBe('Kotel vyměněn');
    expect(result.current.visit?.id).toBe('v-1');
  });

  // 3. getVisit failure -> fallback to visit-level notes from listVisits row
  it('falls back to visit row notes when getVisit throws', async () => {
    const row = makeVisitRow('v-1', 'Poznámka záloha');
    mockListVisits.mockResolvedValue({ visits: [row], total: 1 });
    mockGetVisit.mockRejectedValue(new Error('network error'));

    const { result } = renderHook(() => useLastVisitComment('cust-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.notes).toBe('Poznámka záloha');
    expect(result.current.visit?.id).toBe('v-1');
  });

  // 4. listVisits failure -> stable empty state, no crash
  it('returns null notes/visit when listVisits throws', async () => {
    mockListVisits.mockRejectedValue(new Error('NATS timeout'));

    const { result } = renderHook(() => useLastVisitComment('cust-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.notes).toBeNull();
    expect(result.current.visit).toBeNull();
  });

  // 5. Customer switch A -> B before A resolves -> A result ignored (stale guard)
  it('ignores stale response when customerId changes before first fetch resolves', async () => {
    let resolveA!: (v: { visits: ReturnType<typeof makeVisitRow>[]; total: number }) => void;
    const promiseA = new Promise<{ visits: ReturnType<typeof makeVisitRow>[]; total: number }>(
      (res) => { resolveA = res; },
    );
    const rowB = makeVisitRow('v-2', 'Customer B note');

    mockListVisits
      .mockReturnValueOnce(promiseA as ReturnType<typeof listVisits>)
      .mockResolvedValueOnce({ visits: [rowB], total: 1 });
    mockGetVisit.mockResolvedValue(makeFullVisitResponse('v-2', 'Customer B note'));

    const { result, rerender } = renderHook(
      ({ customerId }: { customerId: string | null }) => useLastVisitComment(customerId),
      { initialProps: { customerId: 'cust-A' } },
    );

    // Switch to B while A is still pending
    rerender({ customerId: 'cust-B' });

    // Now resolve A — its result should be ignored
    act(() => {
      resolveA({ visits: [makeVisitRow('v-1', 'Customer A note')], total: 1 });
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Final state should reflect B only
    expect(result.current.notes).toBe('Customer B note');
    expect(result.current.visit?.id).toBe('v-2');
  });

  // 6. Same customer twice -> served from cache (no extra network calls)
  it('serves from cache when same customerId is used twice', async () => {
    const row = makeVisitRow('v-1', 'Cached note');
    mockListVisits.mockResolvedValue({ visits: [row], total: 1 });
    mockGetVisit.mockResolvedValue(makeFullVisitResponse('v-1', 'Cached note'));

    const { result, rerender } = renderHook(
      ({ customerId }: { customerId: string }) => useLastVisitComment(customerId),
      { initialProps: { customerId: 'cust-1' } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockListVisits).toHaveBeenCalledTimes(1);

    // Switch away and back
    rerender({ customerId: 'cust-2' });
    rerender({ customerId: 'cust-1' });

    await waitFor(() => expect(result.current.notes).toBe('Cached note'));
    // Still only 1 call for cust-1 (served from cache on second visit)
    const callsForCust1 = mockListVisits.mock.calls.filter(
      (c) => (c[0] as { customerId: string }).customerId === 'cust-1',
    );
    expect(callsForCust1.length).toBe(1);
  });

  // 7. Null customerId -> no fetch, returns empty state
  it('returns empty state without fetching when customerId is null', async () => {
    const { result } = renderHook(() => useLastVisitComment(null));

    // Give React a tick to run effects
    await act(async () => {});

    expect(mockListVisits).not.toHaveBeenCalled();
    expect(result.current.notes).toBeNull();
    expect(result.current.visit).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // 8. isConnected === false -> no fetch, clears state
  it('skips fetch and returns empty state when NATS is disconnected', async () => {
    mockUseNatsStore.mockImplementation((selector: (s: { isConnected: boolean }) => unknown) =>
      selector({ isConnected: false }),
    );

    const { result } = renderHook(() => useLastVisitComment('cust-1'));

    await act(async () => {});

    expect(mockListVisits).not.toHaveBeenCalled();
    expect(result.current.notes).toBeNull();
    expect(result.current.visit).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  // 9. No duplicate listVisits calls
  it('fires listVisits exactly once per unique customerId fetch (no duplicate calls)', async () => {
    const row = makeVisitRow('v-1', 'Note');
    mockListVisits.mockResolvedValue({ visits: [row], total: 1 });
    mockGetVisit.mockResolvedValue(makeFullVisitResponse('v-1', 'Note'));

    renderHook(() => useLastVisitComment('cust-1'));

    await waitFor(() => expect(mockListVisits).toHaveBeenCalledTimes(1));
    expect(mockListVisits).toHaveBeenCalledTimes(1);
  });
});
