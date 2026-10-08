import { Candle } from '../types/market';
import { sanitizeCandles } from '../domain/candles';

/**
 * Deriv market-data WebSocket client (synthetic indices).
 *
 * `app_id=1089` is Deriv's public documentation app id: it authenticates
 * nothing and is not a secret, but it is configuration, so it lives here as a
 * named constant rather than inline in a URL.
 */
const DERIV_WS_ENDPOINTS = [
  'wss://ws.derivws.com/websockets/v3',
  'wss://ws.binaryws.com/websockets/v3',
  'wss://frontend.binaryws.com/websockets/v3',
];

export function getDerivAppId(): string {
  try {
    const saved = localStorage.getItem('deriv_app_id');
    if (saved && /^\d+$/.test(saved.trim())) return saved.trim();
  } catch {
    // Storage unavailable
  }
  return '1089';
}

export function setDerivAppId(appId: string): void {
  try {
    if (appId.trim()) {
      localStorage.setItem('deriv_app_id', appId.trim());
    } else {
      localStorage.removeItem('deriv_app_id');
    }
  } catch {
    // Storage unavailable
  }
}

const CONNECT_TIMEOUT_MS = 6_000;
const REQUEST_TIMEOUT_MS = 8_000;
/** Deriv caps `ticks_history` at 5000 candles per request. */
const MAX_CANDLES_PER_REQUEST = 5_000;
/** Hard ceiling on pagination, so a misbehaving feed cannot loop forever. */
const MAX_BATCHES = 15;

interface DerivCandle {
  epoch?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
}

interface DerivMessage {
  msg_type?: string;
  req_id?: number;
  candles?: DerivCandle[];
  error?: { message?: string; code?: string };
}

export interface DerivHistory {
  readonly candles: Candle[];
  /**
   * True when pagination stopped on an error rather than on the start of the
   * history. The loop used to `break` silently and return what it had, so a
   * dropped connection on page 2 of 15 looked exactly like a complete series.
   */
  readonly partial: boolean;
  readonly error?: string;
}

let nextRequestId = 1;

/**
 * One socket for a whole pagination run.
 *
 * The previous client opened a fresh socket per page — up to fifteen TLS
 * handshakes in sequence, each with its own 8 s timeout, for a worst case of
 * two minutes. Requests now share the socket and are matched on `req_id`.
 */
class DerivSession {
  private readonly pending = new Map<
    number,
    { resolve: (m: DerivMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private closed = false;

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => this.onMessage(event);
    socket.onclose = () => this.failAll(new Error('Connexion Deriv fermée'));
    socket.onerror = () => this.failAll(new Error('Erreur de connexion Deriv WebSocket'));
  }

  static async open(signal?: AbortSignal): Promise<DerivSession> {
    const appId = getDerivAppId();
    let lastError: Error = new Error('Impossible de joindre les serveurs Deriv WebSocket');

    for (const base of DERIV_WS_ENDPOINTS) {
      if (signal?.aborted) throw new Error('Requête Deriv annulée');
      const url = `${base}?app_id=${appId}`;
      try {
        const session = await DerivSession.tryConnect(url, signal);
        return session;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[Deriv] Échec connexion vers ${base}:`, lastError.message);
      }
    }

    throw lastError;
  }

  private static tryConnect(url: string, signal?: AbortSignal): Promise<DerivSession> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Requête Deriv annulée'));
        return;
      }
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const fail = (message: string) => {
        cleanup();
        try {
          socket.close();
        } catch {
          // Already closing.
        }
        reject(new Error(message));
      };
      const onAbort = () => fail('Requête Deriv annulée');
      const timer = setTimeout(() => fail(`Timeout de connexion Deriv (${CONNECT_TIMEOUT_MS} ms)`), CONNECT_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, { once: true });

      socket.onopen = () => {
        cleanup();
        resolve(new DerivSession(socket));
      };
      socket.onerror = () => fail('Erreur de connexion Deriv WebSocket');
      socket.onclose = () => fail('Connexion Deriv fermée avant ouverture');
    });
  }

  request(payload: Record<string, unknown>, signal?: AbortSignal): Promise<DerivMessage> {
    if (this.closed) return Promise.reject(new Error('Connexion Deriv fermée'));
    const reqId = nextRequestId++;

    return new Promise((resolve, reject) => {
      const onAbort = () => settle(() => reject(new Error('Requête Deriv annulée')));
      const settle = (action: () => void) => {
        const entry = this.pending.get(reqId);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(reqId);
        signal?.removeEventListener('abort', onAbort);
        action();
      };

      const timer = setTimeout(
        () => settle(() => reject(new Error(`Timeout Deriv WebSocket (${REQUEST_TIMEOUT_MS} ms)`))),
        REQUEST_TIMEOUT_MS
      );
      this.pending.set(reqId, {
        resolve: (m) => settle(() => resolve(m)),
        reject: (e) => settle(() => reject(e)),
        timer,
      });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        this.socket.send(JSON.stringify({ ...payload, req_id: reqId }));
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  close(): void {
    this.closed = true;
    this.failAll(new Error('Connexion Deriv fermée'));
    try {
      this.socket.close();
    } catch {
      // Already closing.
    }
  }

  private onMessage(event: MessageEvent): void {
    let message: DerivMessage;
    try {
      message = JSON.parse(String(event.data)) as DerivMessage;
    } catch {
      return; // Not ours to interpret — wait for a well-formed reply or the timeout.
    }
    // Ignore anything that is not the answer to one of our requests: an
    // unrelated envelope used to resolve as "no data available".
    if (message.req_id === undefined) return;
    const entry = this.pending.get(message.req_id);
    if (!entry) return;
    if (message.error) entry.reject(new Error(message.error.message || 'Erreur Deriv API'));
    else entry.resolve(message);
  }

  private failAll(error: Error): void {
    this.closed = true;
    for (const entry of [...this.pending.values()]) entry.reject(error);
  }
}

/** Deriv does not publish volume for synthetics; it stays at zero, never invented. */
function toCandles(raw: DerivCandle[]): Candle[] {
  return sanitizeCandles(
    raw.map((c) => ({ time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close, volume: 0 }))
  );
}

/**
 * Page backwards through history until `targetCount` candles are collected.
 *
 * Deduplication uses one long-lived `Set` and the result is sorted once at the
 * end, rather than rebuilding and re-sorting the whole array on every batch.
 */
export async function fetchDerivMultiYear(
  derivSymbol: string,
  granularity: number,
  targetCount: number = 10_000,
  endEpoch?: number,
  signal?: AbortSignal
): Promise<DerivHistory> {
  const session = await DerivSession.open(signal);
  const collected: Candle[] = [];
  const seen = new Set<number>();
  let oldestEpoch: string | number = endEpoch ? Math.floor(endEpoch) : 'latest';
  let partial = false;
  let error: string | undefined;

  const batches = Math.min(MAX_BATCHES, Math.ceil(targetCount / MAX_CANDLES_PER_REQUEST) + 1);

  try {
    for (let batch = 0; batch < batches; batch++) {
      if (signal?.aborted) throw new Error('Requête Deriv annulée');

      let chunk: Candle[];
      try {
        const reply = await session.request(
          {
            ticks_history: derivSymbol,
            style: 'candles',
            granularity,
            count: MAX_CANDLES_PER_REQUEST,
            end: String(oldestEpoch),
          },
          signal
        );
        chunk = Array.isArray(reply.candles) ? toCandles(reply.candles) : [];
      } catch (failure) {
        if (signal?.aborted) throw failure;
        console.warn('[Deriv] batch fetch failed:', failure);
        // Nothing yet: a genuine failure the caller must see. Something already:
        // keep it, but say it is incomplete.
        if (collected.length === 0) throw failure;
        partial = true;
        error = failure instanceof Error ? failure.message : String(failure);
        break;
      }

      let added = 0;
      let oldestInChunk = Number.POSITIVE_INFINITY;
      for (const candle of chunk) {
        if (seen.has(candle.time)) continue;
        seen.add(candle.time);
        collected.push(candle);
        added++;
        if (candle.time < oldestInChunk) oldestInChunk = candle.time;
      }

      // No new candles means the feed has no more history to give.
      if (added === 0 || !Number.isFinite(oldestInChunk)) break;

      oldestEpoch = oldestInChunk - 1;
      if (collected.length >= targetCount) break;
    }
  } finally {
    session.close();
  }

  collected.sort((a, b) => a.time - b.time);
  return { candles: collected, partial, error };
}
