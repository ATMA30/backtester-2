import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleHistoryRequest } from './history-core';

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ time: 1_600_000_000 + i * 3_600, open: 2, high: 3, low: 1, close: 2.5, volume: 10 }));

const dukaRates = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ timestamp: (1_600_000_000 + i * 3_600) * 1000, open: 2, high: 3, low: 1, close: 2.5, volume: 10 }));

describe('handleHistoryRequest — Dukascopy, dev and prod alike', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves Dukascopy first, over the shared span, and says so', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const dukascopy = vi.fn(async () => dukaRates(60));

    const res = await handleHistoryRequest(
      new Request('https://x.test/api/history?symbol=XAUUSD&interval=1h&range=1y&to=1600200000'),
      { dukascopy }
    );
    const body = (await res.json()) as { source: string; candles: unknown[] };

    expect(res.status).toBe(200);
    expect(body.source).toBe('dukascopy');
    expect(body.candles).toHaveLength(60);
    expect(dukascopy).toHaveBeenCalledWith(
      expect.objectContaining({ instrument: 'xauusd', timeframe: 'h1', dates: { from: '2017-09-17', to: '2020-09-16' } })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never reaches a provider with an invalid query', async () => {
    const dukascopy = vi.fn(async () => dukaRates(60));
    const res = await handleHistoryRequest(new Request('https://x.test/api/history?symbol=../etc'), { dukascopy });
    expect(res.status).toBe(400);
    expect(dukascopy).not.toHaveBeenCalled();
  });

  it('falls back to Yahoo when Dukascopy is throttled', async () => {
    const timestamps = rows(60).map((r) => r.time);
    const series = timestamps.map(() => 2);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({
          chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ open: series, high: series, low: series, close: series, volume: series }] } }] },
        }))
      )
    );
    const res = await handleHistoryRequest(new Request('https://x.test/api/history?symbol=XAUUSD&interval=1h&range=1y'), {
      dukascopy: async () => {
        throw new Error('Request failed with status 429');
      },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { source: string }).source).toBe('yahoo');
  });
});

describe('daily forex — real wicks first', () => {
  afterEach(() => vi.unstubAllGlobals());

  const day = 86_400;
  const yahooDaily = (from: number, n: number) => {
    // Yahoo stamps daily forex candles at 23:00 UTC the evening before.
    const timestamps = Array.from({ length: n }, (_, i) => from + i * day - 3_600);
    const open = timestamps.map(() => 0.9);
    return {
      chart: {
        result: [{
          timestamp: timestamps,
          indicators: { quote: [{ open, high: open.map(() => 0.95), low: open.map(() => 0.85), close: open.map(() => 0.91), volume: open.map(() => 0) }] },
        }],
      },
    };
  };
  const ecb = { rates: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [new Date((1_000_000_000 + i * day) * 1000).toISOString().slice(0, 10), { CHF: 0.9 + i / 10_000 }])) };

  it('serves Yahoo OHLC, extended back in time by ECB closes', async () => {
    const start = Math.floor(1_000_000_000 / day) * day + 200 * day;
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes('frankfurter') ? ecb : yahooDaily(start, 100)))
    ));
    const res = await handleHistoryRequest(new Request('https://x.test/api/history?symbol=USDCHF&interval=1d&range=max'), {
      dukascopy: null,
    });
    const { candles } = (await res.json()) as { candles: { time: number; high: number; low: number }[] };

    const real = candles.filter((c) => c.time >= start);
    expect(real).toHaveLength(100);
    // Wicks survive, and dates sit on UTC midnight.
    expect(real.every((c) => c.high === 0.95 && c.low === 0.85 && c.time % day === 0)).toBe(true);
    // Everything before the first real candle comes from the ECB.
    expect(candles.length).toBeGreaterThan(100);
    expect(candles[0].time).toBeLessThan(start);
  });
});
