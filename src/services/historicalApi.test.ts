import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHistoricalSeries } from './historicalApi';

/**
 * Provider-chain semantics.
 *
 * The chain used to rethrow *every* abort, so a single slow upstream cancelled
 * the whole lookup and the caller got an empty (or simulated) series even though
 * a healthy fallback provider was queued right behind it.
 */

function ecbRates(days: number): { rates: Record<string, Record<string, number>> } {
  const rates: Record<string, Record<string, number>> = {};
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    rates[day] = { USD: 1.08 + i * 0.0001 };
  }
  return { rates };
}

function ok(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (n: string) => (n === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}

/** A request that only ever ends by being aborted. */
function hangs(init: { signal: AbortSignal }): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (init.signal.aborted) reject(init.signal.reason);
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchHistoricalSeries', () => {
  it('falls through to the next provider when one times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: { signal: AbortSignal }) => {
        if (url.startsWith('/api/history')) return hangs(init);
        if (url.includes('frankfurter')) return Promise.resolve(ok(ecbRates(80)));
        return Promise.resolve(ok([]));
      })
    );

    const series = await fetchHistoricalSeries({
      symbol: 'EURUSD',
      interval: '1d',
      range: 'max',
      timeoutMs: 20,
    });

    expect(series.isSimulated).toBe(false);
    expect(series.provenance).toBe('frankfurter');
    expect(series.candles.length).toBeGreaterThanOrEqual(50);
    // The timed-out provider was tried, and did not abort the rest of the chain.
    expect(series.attempted).toContain('history-api');
  });

  it('stops immediately when the caller cancels', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => hangs(init)));

    const controller = new AbortController();
    const pending = fetchHistoricalSeries({
      symbol: 'EURUSD',
      interval: '1d',
      range: 'max',
      signal: controller.signal,
    });
    controller.abort();

    // A cancellation must reject rather than quietly fall back to the next
    // provider — or worse, to a generated series the caller never asked for.
    await expect(pending).rejects.toBeDefined();
  });

  it('queues each provider once for a daily forex request', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok([]))));

    const series = await fetchHistoricalSeries({
      symbol: 'EURUSD',
      interval: '1d',
      range: 'max',
      allowSimulated: false,
    });

    // Frankfurter was pushed twice for this exact case, so a failed ECB lookup
    // was retried verbatim after Dukascopy and counted twice in diagnostics.
    const frankfurterAttempts = series.attempted.filter((p) => p === 'frankfurter');
    expect(frankfurterAttempts).toHaveLength(1);
    expect(new Set(series.attempted).size).toBe(series.attempted.length);
  });

  it('never returns generated candles when the caller forbids them', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok([]))));

    const series = await fetchHistoricalSeries({
      symbol: 'EURUSD',
      interval: '1d',
      range: 'max',
      allowSimulated: false,
    });

    expect(series.candles).toEqual([]);
    expect(series.isSimulated).toBe(true);
  });
});
