import { Candle } from '../types/market';
import { fetchDerivMultiYear } from './derivWs';
import { fetchJson, isAbortError, isTimeoutError } from './http';
import { sanitizeCandles, RawCandleLike } from '../domain/candles';
import { getInstrument } from '../domain/instruments';
import { TimeframeSeconds, secondsForInterval } from '../domain/timeframes';

/** Where a series came from. `simulated` means "generated locally, not market data". */
export type DataProvenance =
  | 'history-api'
  | 'dukascopy'
  | 'yahoo'
  | 'frankfurter'
  | 'binance'
  | 'deriv'
  | 'simulated';

export const PROVENANCE_LABELS: Record<DataProvenance, string> = {
  'history-api': 'API historique',
  dukascopy: 'Dukascopy (ECN suisse)',
  yahoo: 'Yahoo Finance',
  frankfurter: 'BCE / Frankfurter',
  binance: 'Binance',
  deriv: 'Deriv',
  simulated: 'Données simulées',
};

export interface HistoricalSeries {
  readonly candles: Candle[];
  readonly provenance: DataProvenance;
  /**
   * True when the candles were generated locally.
   *
   * This flag is the whole point of the type. Previously `fetchHistoricalData`
   * returned a bare `Candle[]`, and when every provider failed it fell through
   * to a geometric-Brownian-motion generator — so the UI announced
   * "🟢 bougies réelles" over random numbers, and backtests ran on noise. The
   * caller must now decide what to do with a simulated series.
   */
  readonly isSimulated: boolean;
  /** Providers that were tried and failed, for diagnostics. */
  readonly attempted: readonly DataProvenance[];
  /**
   * True when the provider stopped mid-pagination (dropped connection, timeout)
   * and the series is shorter than requested. The UI must say so rather than
   * present a truncated history as complete.
   */
  readonly partial?: boolean;
}

export interface HistoricalRequest {
  readonly symbol: string;
  /** Provider interval label: `'1m'`, `'15m'`, `'1h'`, `'4h'`, `'1d'`, … */
  readonly interval?: string;
  readonly range?: string;
  /** Centre the window on this epoch (seconds) — used to anchor replay. */
  readonly targetTimestamp?: number;
  /** Set false to receive an empty series rather than generated candles. */
  readonly allowSimulated?: boolean;
  readonly signal?: AbortSignal;
  /**
   * Budget for a single upstream request, in milliseconds.
   *
   * Per *provider*, not for the whole call: the chain tries up to three sources
   * in sequence, so the worst case is roughly three times this. It was fixed at
   * the 10 s default with no way to tune it, which meant a screen-blocking
   * 30 s worst case behind a spinner with no cancel.
   */
  readonly timeoutMs?: number;
}

/**
 * What every provider needs from the caller: how to be cancelled, and how long
 * it may take. Bundled rather than threaded as two more positional parameters
 * through six signatures that already carried four each.
 */
interface RequestContext {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Minimum rows before a provider's answer is considered usable. */
const MIN_USABLE_CANDLES = 50;

/**
 * Did the *caller* cancel, as opposed to one provider timing out?
 *
 * The distinction decides whether to try the next provider. A timeout on
 * Dukascopy is a reason to fall back to Frankfurter; a user switching
 * instruments mid-load is a reason to stop entirely. Both surface as an abort
 * rejection, so the caller's own signal is the only reliable discriminator.
 */
function isCallerCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return isAbortError(error) && !isTimeoutError(error);
}

const TARGET_COUNT_BY_RANGE: Readonly<Record<string, number>> = {
  max: 12_000,
  '10y': 8_000,
  '5y': 4_000,
};
const DEFAULT_TARGET_COUNT = 2_000;

const SYNTHETIC_PREFIXES = ['R_', '1HZ', 'BOOM', 'CRASH', 'STEP', 'JUMP'];

function isSynthetic(symbol: string): boolean {
  return SYNTHETIC_PREFIXES.some((p) => symbol.startsWith(p));
}

function targetCountFor(range: string): number {
  return TARGET_COUNT_BY_RANGE[range] ?? DEFAULT_TARGET_COUNT;
}

// ── PROVIDERS ─────────────────────────────────────────────────

/** ECB reference rates via Frankfurter: daily forex closes back to 1999. */
async function fetchFrankfurter(symbol: string, ctx: RequestContext): Promise<Candle[]> {
  if (symbol.length !== 6) return [];
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) return [];

  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({ from: base, to: quote });
  const url = `https://api.frankfurter.dev/v1/1999-01-01..${today}?${params}`;

  const data = await fetchJson<{ rates?: Record<string, Record<string, number>> }>(url, ctx);
  const rates = data?.rates;
  if (!rates || typeof rates !== 'object') return [];

  // Frankfurter publishes one close per day. Open is carried from the previous
  // close; there is no intraday range to report, so high/low equal the body
  // rather than being padded with an invented spread.
  const rows: RawCandleLike[] = [];
  let previousClose: number | null = null;

  for (const day of Object.keys(rates).sort()) {
    const value = rates[day]?.[quote];
    if (value == null) continue;
    const close = Number(value);
    if (!Number.isFinite(close) || close <= 0) continue;

    const open = previousClose ?? close;
    previousClose = close;
    rows.push({
      time: Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000),
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: 0,
    });
  }

  return sanitizeCandles(rows);
}

/** Binance public klines, paged backwards. */
async function fetchBinance(
  symbol: string,
  interval: string,
  targetCount: number,
  targetTimestamp: number | undefined,
  ctx: RequestContext
): Promise<Candle[]> {
  const VALID_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w', '1M'];
  const binanceInterval = VALID_INTERVALS.includes(interval) ? interval : '1d';

  let pair = symbol.toUpperCase();
  if (!pair.endsWith('USDT')) pair += 'USDT';

  const granularity = secondsForInterval(binanceInterval);
  const PAGE_SIZE = 1_000;
  const maxPages = Math.max(1, Math.min(15, Math.ceil(targetCount / PAGE_SIZE)));

  let endTime = targetTimestamp
    ? Math.min(Date.now(), (targetTimestamp + Math.floor(targetCount * 0.3) * granularity) * 1000)
    : Date.now();

  // Accumulate into one array instead of re-spreading the whole history per page.
  const rows: RawCandleLike[] = [];

  for (let page = 0; page < maxPages; page++) {
    if (ctx.signal?.aborted) break;

    const params = new URLSearchParams({
      symbol: pair,
      interval: binanceInterval,
      limit: String(PAGE_SIZE),
      endTime: String(Math.floor(endTime)),
    });

    let klines: unknown;
    try {
      klines = await fetchJson(`https://api.binance.com/api/v3/klines?${params}`, ctx);
    } catch (error) {
      if (isCallerCancellation(error, ctx.signal)) throw error;
      console.warn('[Binance] page fetch failed:', error);
      break;
    }

    if (!Array.isArray(klines) || klines.length === 0) break;

    for (const k of klines) {
      if (!Array.isArray(k)) continue;
      rows.push({ time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] });
    }

    const first = klines[0];
    const firstOpenTime = Array.isArray(first) ? Number(first[0]) : Number.NaN;
    if (!Number.isFinite(firstOpenTime)) break;

    endTime = firstOpenTime - 1;
    if (klines.length < PAGE_SIZE || rows.length >= targetCount) break;
  }

  return sanitizeCandles(rows);
}

/**
 * Version of what `/api/history` returns, sent with every request.
 *
 * Responses are cached (5 min in the browser, a day at the CDN). When their
 * content changes meaning — daily forex switching from ECB closes to real
 * OHLC — cached copies kept serving candles without wicks after the fix. Bump
 * this whenever the server's output changes: the URL, hence the cache key,
 * changes with it.
 */
export const HISTORY_API_VERSION = '3';

/** `source` reported by `/api/history` → the provenance shown to the user. */
const SERVER_SOURCES: Readonly<Record<string, DataProvenance>> = {
  dukascopy: 'dukascopy',
  yahoo: 'yahoo',
  binance: 'binance',
  ecb: 'frankfurter',
};

/** The project's own serverless aggregator. */
async function fetchHistoryApi(
  symbol: string,
  interval: string,
  range: string,
  targetTimestamp: number | undefined,
  ctx: RequestContext
): Promise<ProviderResult> {
  const params = new URLSearchParams({ symbol, interval, range, v: HISTORY_API_VERSION });
  // Arrondi au jour, comme côté serveur : les replays proches partagent le cache.
  if (targetTimestamp !== undefined) params.set('to', String(Math.ceil(targetTimestamp / 86_400) * 86_400));

  const json = await fetchJson<{ candles?: unknown; source?: unknown }>(`/api/history?${params}`, ctx);
  const candles = Array.isArray(json?.candles) ? sanitizeCandles(json.candles as RawCandleLike[]) : [];
  // Say which upstream answered rather than a generic "API historique": a
  // Yahoo fallback (Dukascopy throttled) is shallower, and the user should see it.
  const provenance = typeof json?.source === 'string' ? SERVER_SOURCES[json.source] : undefined;
  return { candles, provenance };
}

/** Deriv synthetics. */
async function fetchDeriv(
  symbol: string,
  granularity: number,
  targetCount: number,
  targetTimestamp: number | undefined,
  ctx: RequestContext
): Promise<ProviderResult> {
  const endEpoch = targetTimestamp
    ? Math.min(Math.floor(Date.now() / 1000), targetTimestamp + Math.floor(targetCount * 0.3) * granularity)
    : undefined;
  return fetchDerivMultiYear(symbol, granularity, targetCount, endEpoch, ctx.signal);
}

// ── SIMULATION (explicitly labelled) ──────────────────────────

/**
 * Geometric Brownian motion with trend regimes.
 *
 * Kept as a last resort so the app is usable offline, but it is now always
 * reported as `isSimulated: true` and never masquerades as market data.
 */
function simulateSeries(symbol: string, candleCount = 600): Candle[] {
  const { pip, decimals } = getInstrument(symbol);
  const basePrice = symbol.includes('JPY')
    ? 155
    : symbol.includes('XAU')
      ? 2_450
      : symbol.includes('BTC')
        ? 65_000
        : 1.085;

  const rows: RawCandleLike[] = [];
  const now = Math.floor(Date.now() / 1000);
  let price = basePrice;
  let trend = (Math.random() - 0.48) * 0.006;
  let regimeLength = Math.floor(15 + Math.random() * 20);

  for (let i = candleCount; i >= 0; i--) {
    if (--regimeLength <= 0) {
      trend = (Math.random() - 0.49) * 0.006;
      regimeLength = Math.floor(12 + Math.random() * 25);
    }

    const volatility = price * (0.004 + Math.random() * 0.006);
    const open = price;
    const close = Math.max(pip * 10, open + price * trend + (Math.random() - 0.5) * 2 * volatility);
    price = close;

    rows.push({
      time: now - i * TimeframeSeconds.D1,
      open: Number(open.toFixed(decimals)),
      high: Number((Math.max(open, close) + Math.random() * volatility * 0.6).toFixed(decimals)),
      low: Number((Math.min(open, close) - Math.random() * volatility * 0.6).toFixed(decimals)),
      close: Number(close.toFixed(decimals)),
      volume: Math.floor(1_200 + Math.random() * 6_000),
    });
  }

  return sanitizeCandles(rows);
}

// ── DISPATCHER ────────────────────────────────────────────────

interface ProviderResult {
  readonly candles: Candle[];
  readonly partial?: boolean;
  /** Overrides the attempt's provenance when the provider knows better. */
  readonly provenance?: DataProvenance;
}

interface ProviderAttempt {
  readonly provenance: DataProvenance;
  readonly run: () => Promise<ProviderResult>;
}

/** Providers that return everything or nothing. */
const whole = (candles: Promise<Candle[]>): Promise<ProviderResult> => candles.then((c) => ({ candles: c }));

/**
 * Ordered providers to try for a symbol, best source first.
 * Adding a data source means adding an entry here — no branching to edit.
 */
function providersFor(
  request: Required<Pick<HistoricalRequest, 'symbol' | 'interval' | 'range'>> & {
    targetTimestamp?: number;
  },
  ctx: RequestContext
): ProviderAttempt[] {
  const { symbol, interval, range, targetTimestamp } = request;
  const targetCount = targetCountFor(range);
  const granularity = secondsForInterval(interval);
  const instrument = getInstrument(symbol);
  const attempts: ProviderAttempt[] = [];

  if (instrument.assetClass === 'synthetic' || isSynthetic(symbol)) {
    attempts.push({
      provenance: 'deriv',
      run: () => fetchDeriv(symbol, granularity, targetCount, targetTimestamp, ctx),
    });
    return attempts;
  }

  attempts.push({
    provenance: 'history-api',
    run: () => fetchHistoryApi(symbol, interval, range, targetTimestamp, ctx),
  });

  switch (instrument.assetClass) {
    case 'crypto':
      attempts.push({
        provenance: 'binance',
        run: () => whole(fetchBinance(symbol, interval, targetCount, targetTimestamp, ctx)),
      });
      break;

    // Metals and indices: `/api/history` already runs Dukascopy, then Yahoo.
    // The client used to retry Dukascopy through `/api/dukascopy`, a route
    // that only ever existed on the dev server.

    case 'forex': {
      // The ECB series was once pushed *twice* for daily requests, re-running a
      // provider that had just failed and reporting it twice in `attempted`.
      const frankfurter: ProviderAttempt = {
        provenance: 'frankfurter',
        run: () => whole(fetchFrankfurter(symbol, ctx)),
      };
      // Last resort when `/api/history` is down: the ECB publishes closes
      // only (no wicks), but it answers from the browser without a proxy.
      attempts.push(frankfurter);
      break;
    }

    default:
      break;
  }

  return attempts;
}

/**
 * Load a historical series, trying each provider for the symbol in order.
 *
 * Always resolves: when no provider yields usable data the result carries
 * `isSimulated: true` (or an empty series when `allowSimulated` is false), so
 * the caller can tell the user what they are looking at.
 */
export async function fetchHistoricalSeries(request: HistoricalRequest): Promise<HistoricalSeries> {
  const symbol = request.symbol.toUpperCase();
  const interval = request.interval ?? '1d';
  const range = request.range ?? 'max';
  const { targetTimestamp, signal, timeoutMs, allowSimulated = true } = request;
  const ctx: RequestContext = { signal, timeoutMs };

  const attempted: DataProvenance[] = [];

  for (const provider of providersFor({ symbol, interval, range, targetTimestamp }, ctx)) {
    if (signal?.aborted) break;
    attempted.push(provider.provenance);

    try {
      const { candles, partial, provenance } = await provider.run();
      if (candles.length >= MIN_USABLE_CANDLES) {
        return { candles, provenance: provenance ?? provider.provenance, isSimulated: false, attempted, partial };
      }
    } catch (error) {
      // A provider timing out is a reason to try the next one; the caller
      // cancelling is a reason to stop. Previously both were rethrown, so one
      // slow upstream aborted the whole chain and the series came back empty.
      if (isCallerCancellation(error, signal)) throw error;
      console.warn(`[historicalApi] ${provider.provenance} failed for ${symbol}:`, error);
    }
  }

  if (!allowSimulated) {
    return { candles: [], provenance: 'simulated', isSimulated: true, attempted };
  }

  console.warn(
    `[historicalApi] No real data for ${symbol} (${interval}); falling back to a simulated series.`
  );
  return { candles: simulateSeries(symbol), provenance: 'simulated', isSimulated: true, attempted };
}
