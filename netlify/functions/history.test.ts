import { afterEach, describe, expect, it, vi } from 'vitest';
import handler from './history';

// The entry point runs the real Dukascopy client: keep tests offline, and let
// the Yahoo path under test answer.
vi.mock('dukascopy-node', () => ({ getHistoricalRates: vi.fn(async () => []) }));

function yahooReply() {
  const timestamps = Array.from({ length: 60 }, (_, i) => 1_600_000_000 + i * 3_600);
  const series = timestamps.map((_, i) => 100 + i);
  return {
    chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ open: series, high: series, low: series, close: series, volume: series }] } }] },
  };
}

describe('/api/history', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('anchors the Yahoo window on `to` instead of ignoring it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(yahooReply()), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await handler(new Request('https://x.test/api/history?symbol=XAUUSD&interval=1h&range=1y&to=1600200000'));
    expect(res.status).toBe(200);
    const calledUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    // Arrondi à la fin du jour UTC pour mutualiser le cache CDN.
    expect(calledUrl).toContain('period2=1600214400');
    expect(calledUrl).toContain('period1=');
    expect(calledUrl).not.toContain('range=');
  });

  it('rejects a malformed `to`', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const res = await handler(new Request('https://x.test/api/history?symbol=EURUSD&to=yesterday'));
    expect(res.status).toBe(400);
  });
});
