import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDerivMultiYear } from './derivWs';

/** Minimal WebSocket stand-in: answers each request from a scripted list. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static script: Array<(req: { req_id: number; end: string }) => unknown> = [];

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent = 0;

  constructor() {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(raw: string) {
    const req = JSON.parse(raw) as { req_id: number; end: string };
    const answer = FakeSocket.script[this.sent++];
    queueMicrotask(() => {
      const reply = answer?.(req);
      if (reply === 'close') this.onclose?.();
      else this.onmessage?.({ data: JSON.stringify(reply) });
    });
  }

  close() {}
}

const page = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => ({ epoch: from + i * 60, open: 1, high: 2, low: 0.5, close: 1.5 }));

describe('fetchDerivMultiYear', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('pages over a single socket', async () => {
    FakeSocket.script = [
      (r) => ({ req_id: r.req_id, candles: page(1_700_060_000, 5_000) }),
      (r) => ({ req_id: r.req_id, candles: page(1_699_000_000, 5_000) }),
    ];
    const result = await fetchDerivMultiYear('R_100', 60, 10_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(result.candles).toHaveLength(10_000);
    expect(result.partial).toBe(false);
    expect(result.candles[0].time).toBeLessThan(result.candles[1].time);
  });

  it('reports a history cut short by a dropped connection', async () => {
    FakeSocket.script = [(r) => ({ req_id: r.req_id, candles: page(1_700_060_000, 5_000) }), () => 'close'];
    const result = await fetchDerivMultiYear('R_100', 60, 10_000);
    expect(result.candles).toHaveLength(5_000);
    expect(result.partial).toBe(true);
  });

  it('fails outright when the first page fails', async () => {
    FakeSocket.script = [(r) => ({ req_id: r.req_id, error: { message: 'InvalidSymbol' } })];
    await expect(fetchDerivMultiYear('R_XX', 60, 10_000)).rejects.toThrow('InvalidSymbol');
  });
});
