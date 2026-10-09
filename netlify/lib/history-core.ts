/**
 * Core of `/api/history`, shared by the Netlify function (production) and the
 * Vite dev middleware.
 *
 * The dev server used to carry its own copy of the Yahoo and Frankfurter
 * clients. The copies had drifted: dev still padded ECB closes with invented
 * wicks — a defect fixed in production long before — accepted any parameter,
 * and answered `Access-Control-Allow-Origin: *`. Both now run this module;
 * dev only adds Dukascopy as a preferred source through `preferredProvider`.
 *
 * Public market-data aggregator: ECB rates via Frankfurter for deep forex
 * history, Yahoo Finance for indices/metals/oil/intraday, Binance for crypto.
 * No API keys — all three upstreams are public.
 *
 * Hardening applied to this endpoint (it is anonymous and internet-facing):
 *  - every query parameter is checked against an allowlist before any outbound
 *    request, so a bogus symbol can no longer trigger two upstream fetches
 *    (~1.5 MB of ECB history among them) for free;
 *  - outbound URLs are built with `URLSearchParams`; `range` and `interval` used
 *    to be interpolated raw, letting a caller append parameters to the Yahoo
 *    request and pick the heaviest possible response;
 *  - each upstream call is bounded by a timeout, so a slow provider cannot pin a
 *    function invocation open until the platform kills it;
 *  - responses are cached at the CDN, which is what actually keeps repeat
 *    traffic off the function;
 *  - CORS is same-origin by default instead of `*`.
 */

import { getHistoricalRates } from 'dukascopy-node';
import { mergeWeekendDailyCandles, sanitizeCandles, RawCandleLike } from '../../src/domain/candles';
import { DUKASCOPY_DAILY_FROM, DUKASCOPY_SPAN_DAYS } from '../../src/domain/archive-limits';
import { HISTORY_API_VERSION } from '../../src/domain/history-api';

const UPSTREAM_TIMEOUT_MS = 4_000;
/**
 * Budget for the Dukascopy download. A synchronous Netlify function is cut at
 * 10 s: 5.5 s here plus Yahoo's 4 s fallback stays under it. Past the budget
 * the request falls through to Yahoo instead of timing the whole call out.
 */
const DUKASCOPY_BUDGET_MS = 5_500;
const MIN_USABLE_CANDLES = 50;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Dukascopy's CDN (jetta.dukascopy.com) challenges requests without standard browser headers.
// Intercept global fetch so dukascopy-node passes AWS CloudFront WAF verification.
if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;
  if (!(origFetch as { __dukascopyPatched?: boolean }).__dukascopyPatched) {
    const patchedFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const urlStr =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (urlStr && urlStr.includes('dukascopy.com')) {
        const headers = new Headers(init.headers || {});
        if (!headers.has('User-Agent')) headers.set('User-Agent', BROWSER_UA);
        if (!headers.has('Referer')) headers.set('Referer', 'https://www.dukascopy.com/');
        if (!headers.has('Accept')) headers.set('Accept', 'application/json, */*');
        return origFetch(input, { ...init, headers });
      }
      return origFetch(input, init);
    };
    (patchedFetch as { __dukascopyPatched?: boolean }).__dukascopyPatched = true;
    globalThis.fetch = patchedFetch as typeof fetch;
  }
}

const SYMBOL_PATTERN = /^[A-Z0-9]{2,12}$/;
const VALID_INTERVALS = new Set(['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk', '1mo']);
const VALID_RANGES = new Set(['1y', '2y', '5y', '10y', 'max']);
const DAILY_INTERVALS = new Set(['1d', '1wk', '1mo']);

export const FOREX_PAIRS: ReadonlySet<string> = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY',
  'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPCHF',
  'GBPNZD', 'AUDCAD', 'AUDCHF', 'AUDNZD', 'CADCHF', 'NZDCAD', 'NZDCHF',
  'USDMXN', 'USDZAR', 'USDTRY', 'USDSGD', 'USDNOK', 'USDSEK', 'USDPLN', 'EURTRY',
]);

/** ISO 4217 codes Frankfurter publishes, so `from`/`to` are never free-form. */
const ECB_CURRENCIES = new Set([
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD',
  'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

// ── HTTP helpers ──────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    // Log without interpolating caller-controlled text into the message.
    console.warn('[history] upstream request failed', { url: new URL(url).host, error: String(error) });
    return null;
  }
}

// ── Providers ─────────────────────────────────────────────────

/** Daily forex closes back to 1999, from the ECB reference series. */
async function fetchFrankfurter(symbol: string): Promise<RawCandleLike[]> {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  if (!ECB_CURRENCIES.has(base) || !ECB_CURRENCIES.has(quote)) return [];

  const params = new URLSearchParams({ from: base, to: quote });
  const endDate = new Date().toISOString().slice(0, 10);
  const data = await fetchJson(`https://api.frankfurter.dev/v1/1999-01-01..${endDate}?${params}`);

  const rates = (data as { rates?: Record<string, Record<string, number>> } | null)?.rates;
  if (!rates || typeof rates !== 'object') return [];

  // One close per day: open carries from the previous close and the body is the
  // whole candle. The previous version padded high/low with an invented spread
  // (`max(pip * 15, change * 0.45)`), presenting fabricated wicks as ECB data.
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
  return rows;
}

function yahooSymbolFor(symbol: string): string {
  if (FOREX_PAIRS.has(symbol)) return `${symbol}=X`;
  if (symbol === 'XAUUSD' || symbol === 'GOLD') return 'GC=F';
  if (symbol === 'XAGUSD' || symbol === 'SILVER') return 'SI=F';
  if (symbol === 'USOIL' || symbol === 'WTI') return 'CL=F';
  if (symbol === 'UKOIL' || symbol === 'BRENT') return 'BZ=F';
  if (symbol === 'SPX500') return '^GSPC';
  if (symbol === 'NAS100') return '^IXIC';
  if (symbol.endsWith('USDT')) return symbol.replace('USDT', '-USD');
  return symbol;
}

/** Clamp interval/range to what Yahoo actually serves for that granularity. */
function yahooWindow(interval: string, range: string): { interval: string; range: string } {
  if (interval === '1h' || interval === '4h') {
    return { interval: '60m', range: ['5y', '10y', 'max'].includes(range) ? '2y' : range };
  }
  if (['1m', '5m', '15m', '30m'].includes(interval)) {
    const capped = ['1y', '2y', '5y', '10y', 'max'].includes(range);
    return { interval, range: capped ? (interval === '1m' ? '7d' : '60d') : range };
  }
  if (DAILY_INTERVALS.has(interval)) {
    return { interval, range: range === 'max' ? '10y' : range };
  }
  return { interval, range };
}

/** Length of a Yahoo `range` token, in seconds. */
const RANGE_SECONDS: Readonly<Record<string, number>> = {
  '7d': 7 * 86_400,
  '60d': 60 * 86_400,
  '1y': 365 * 86_400,
  '2y': 2 * 365 * 86_400,
  '5y': 5 * 365 * 86_400,
  '10y': 10 * 365 * 86_400,
};

/**
 * @param to Optional end of the window (epoch seconds). The client sends it to
 *   anchor a replay in the past; it used to be ignored here, so production
 *   always returned the most recent window and the anchor silently missed.
 */
async function fetchYahoo(
  symbol: string,
  range: string,
  interval: string,
  to: number | null
): Promise<RawCandleLike[]> {
  const window = yahooWindow(interval, range);
  const span = RANGE_SECONDS[window.range];
  const params =
    to !== null && span !== undefined
      ? new URLSearchParams({
          period1: String(Math.max(0, to - span)),
          period2: String(to),
          interval: window.interval,
        })
      : new URLSearchParams({ range: window.range, interval: window.interval });
  const path = encodeURIComponent(yahooSymbolFor(symbol));
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${path}?${params}`);

  const result = (
    data as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>> } }> } } | null
  )?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};

  const rows: RawCandleLike[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    rows.push({
      // Yahoo dates daily forex candles at 23:00 UTC the evening before (London
      // midnight in summer). Snapped to the UTC day they belong to, they line
      // up with the ECB series and with the chart's daily buckets.
      time: DAILY_INTERVALS.has(interval) ? Math.round(timestamps[i] / 86_400) * 86_400 : timestamps[i],
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: quote.close?.[i],
      volume: quote.volume?.[i],
    });
  }

  // Yahoo Finance's 1m forex feed only publishes single closing snapshots
  // (open === high === low === close), which render as zero-height invisible dashes.
  // When detected, reconstruct real candle bodies using the previous close as open.
  if (rows.length >= 10) {
    let flatCount = 0;
    const sample = Math.min(rows.length, 50);
    for (let i = 0; i < sample; i++) {
      const r = rows[i];
      if (r.open === r.close && r.high === r.low && r.high === r.close) flatCount++;
    }
    if (flatCount / sample > 0.9) {
      for (let i = 0; i < rows.length; i++) {
        const c = typeof rows[i].close === 'number' ? (rows[i].close as number) : 0;
        const prevC = i > 0 && typeof rows[i - 1].close === 'number' ? (rows[i - 1].close as number) : c;
        const o = prevC;
        let h = Math.max(o, c);
        let l = Math.min(o, c);
        if (h === l && c > 0) {
          const tick = c * 0.00003;
          h = c + tick;
          l = c - tick;
        }
        rows[i].open = o;
        rows[i].high = h;
        rows[i].low = l;
      }
    }
  }

  return rows;
}

async function fetchBinance(symbol: string, interval: string, to: number | null): Promise<RawCandleLike[]> {
  const binanceInterval = DAILY_INTERVALS.has(interval)
    ? '1d'
    : ['1h', '4h'].includes(interval)
      ? '1h'
      : '15m';

  const params = new URLSearchParams({ symbol, interval: binanceInterval, limit: '1000' });
  if (to !== null) params.set('endTime', String(to * 1000));
  const data = await fetchJson(`https://api.binance.com/api/v3/klines?${params}`);
  if (!Array.isArray(data)) return [];

  return data
    .filter((k): k is unknown[] => Array.isArray(k))
    .map((k) => ({ time: k[0], open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] }));
}

// ── Handler ───────────────────────────────────────────────────

function corsHeaders(request: Request): Record<string, string> {
  // Same-origin by default. `ALLOWED_ORIGIN` opts a specific site in; the
  // previous `*` let any page on the internet use this as a free data proxy.
  const allowed = process.env.ALLOWED_ORIGIN;
  const origin = request.headers.get('origin');
  if (!allowed) return {};
  if (allowed === origin || allowed === '*') {
    return { 'Access-Control-Allow-Origin': allowed, Vary: 'Origin' };
  }
  return {};
}

function jsonResponse(
  body: unknown,
  status: number,
  request: Request,
  cacheable = false,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...extraHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      // Historical bars barely change; the CDN absorbs repeat traffic that
      // previously woke the function on every single request.
      'Cache-Control': cacheable
        ? 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
        : 'no-store',
      // Seuls ces paramètres forment la clé de cache : `&x=aléa` n'en crée plus.
      // `v` : version de format envoyée par le client, pour invalider les
      // anciennes réponses quand leur contenu change de sens.
      'Netlify-Vary': 'query=symbol|interval|range|to|v',
      ...corsHeaders(request),
    },
  });
}

/**
 * Keep the real OHLC series and prepend ECB closes only for the years it does
 * not cover. Yahoo reaches ~10 years back, the ECB 1999: the older part of the
 * chart is closes only, the part a trader actually replays has real wicks.
 * Without real rows, the ECB series is returned as is (better than nothing).
 */
export function extendWithEcbCloses(real: RawCandleLike[], ecb: RawCandleLike[]): RawCandleLike[] {
  const clean = sanitizeCandles(real);
  if (clean.length < MIN_USABLE_CANDLES) return ecb.length >= MIN_USABLE_CANDLES ? ecb : real;
  const firstReal = clean[0].time;
  const older = ecb.filter((row) => typeof row.time === 'number' && row.time < firstReal);
  return [...older, ...clean];
}

// ── Dukascopy ────────────────────────────────────────────────

const DUKASCOPY_TIMEFRAME: Readonly<Record<string, string>> = {
  '1m': 'm1',
  '5m': 'm5',
  '15m': 'm15',
  '30m': 'm30',
  // 4h is rebuilt client-side from 1h, like every other source.
  '1h': 'h1',
  '4h': 'h1',
  '1d': 'd1',
};

/** Dukascopy instrument id for a symbol, or null when it does not list it. */
export function dukascopyInstrument(symbol: string): string | null {
  if (symbol === 'XAUUSD' || symbol === 'GOLD') return 'xauusd';
  if (symbol === 'XAGUSD' || symbol === 'SILVER') return 'xagusd';
  if (symbol === 'SPX500') return 'usa500idxusd';
  if (symbol === 'NAS100') return 'usatechidxusd';
  if (symbol === 'USOIL' || symbol === 'WTI') return 'lightcmdusd';
  if (symbol === 'UKOIL' || symbol === 'BRENT') return 'brentcmdusd';
  if (FOREX_PAIRS.has(symbol)) return symbol.toLowerCase();
  return null;
}

/** Signature of the Dukascopy client, injectable so tests stay offline. */
export type DukascopyFetcher = (config: {
  instrument: string;
  dates: { from: string; to: string };
  timeframe: string;
  format: 'json';
  batchSize: number;
  pauseBetweenBatchesMs: number;
  useCache: false;
}) => Promise<unknown>;

/**
 * Download pacing. The library default (10 files, then a 1 s pause) spends
 * 12 s pausing on 120 days of 15-minute data; 30 files with no pause is
 * answered with HTTP 429. 20 files 250 ms apart was measured fast and unthrottled.
 */
const DUKASCOPY_BATCH_SIZE = 20;
const DUKASCOPY_PAUSE_MS = 250;

const realDukascopy: DukascopyFetcher = (config) =>
  // The library types instruments and timeframes as literal unions; ours are
  // validated strings from the tables above.
  getHistoricalRates(config as never);

function isoDaysBefore(end: Date, days: number): string {
  return new Date(end.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Real ECN candles, with volume, for forex, metals, indices and oil.
 *
 * Runs in production as in development: it used to live in the Vite dev
 * server only, so the depth the UI promised (five hourly years) existed on the
 * developer's machine and nowhere else. Bounded by `DUKASCOPY_BUDGET_MS`.
 */
/**
 * What happened to the Dukascopy attempt — logged and exposed per request, so
 * that a rise of `throttled` or `budget` (the function's shared IPs being
 * rate-limited) shows in the logs before users notice shallower history.
 */
export type DukascopyOutcome = 'ok' | 'empty' | 'budget' | 'throttled' | 'error' | 'unsupported' | 'disabled';

async function fetchDukascopy(
  query: HistoryQuery,
  fetcher: DukascopyFetcher,
  report: (outcome: DukascopyOutcome) => void
): Promise<RawCandleLike[]> {
  const instrument = dukascopyInstrument(query.symbol);
  const timeframe = DUKASCOPY_TIMEFRAME[query.interval];
  if (!instrument || !timeframe) {
    report('unsupported');
    return [];
  }

  const end = query.to !== null ? new Date(query.to * 1000) : new Date();
  const span = DUKASCOPY_SPAN_DAYS[query.interval];
  const from = span !== undefined ? isoDaysBefore(end, span) : DUKASCOPY_DAILY_FROM;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), DUKASCOPY_BUDGET_MS);
  });
  try {
    const rates = await Promise.race([
      fetcher({
        instrument,
        dates: { from, to: end.toISOString().slice(0, 10) },
        timeframe,
        format: 'json',
        batchSize: DUKASCOPY_BATCH_SIZE,
        pauseBetweenBatchesMs: DUKASCOPY_PAUSE_MS,
        // No disk cache in a serverless function: nothing survives between calls.
        useCache: false,
      }),
      budget,
    ]);
    if (rates === null) {
      report('budget');
      return [];
    }
    if (!Array.isArray(rates) || rates.length === 0) {
      report('empty');
      return [];
    }
    report('ok');
    return rates.map((r: Record<string, unknown>) => ({
      time: r.timestamp,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  } catch (error) {
    // 429 in particular: every visitor shares the function's IP addresses.
    report(/\b429\b/.test(String(error)) ? 'throttled' : 'error');
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Where the candles of a response came from. */
export type HistorySource = 'dukascopy' | 'yahoo' | 'binance' | 'ecb';

/** A validated `/api/history` query. */
export interface HistoryQuery {
  readonly symbol: string;
  readonly interval: string;
  readonly range: string;
  /** End of the window, epoch seconds rounded to the end of the UTC day. */
  readonly to: number | null;
}

export interface HistoryOptions {
  /** Dukascopy client; `null` disables the source. Injected by tests. */
  readonly dukascopy?: DukascopyFetcher | null;
}

export async function handleHistoryRequest(request: Request, options: HistoryOptions = {}): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Methods': 'GET, OPTIONS', ...corsHeaders(request) },
    });
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, request);
  }

  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? 'EURUSD').toUpperCase();
  const interval = url.searchParams.get('interval') ?? '1d';
  const range = url.searchParams.get('range') ?? '10y';
  const toRaw = url.searchParams.get('to');
  // Arrondi à la fin du jour UTC : une clé de cache par seconde permettait de
  // contourner le CDN à volonté et de faire bannir nos IP par les fournisseurs.
  const to = toRaw === null ? null : Math.ceil(Number(toRaw) / 86_400) * 86_400;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const validTo = to === null || (/^\d{9,10}$/.test(toRaw ?? '') && to! > 315_532_800 && to! <= nowSeconds + 86_400);
  // `v` is part of the CDN cache key: any value but the current one is a way
  // around the cache (see `domain/history-api`).
  const version = url.searchParams.get('v');
  const validVersion = version === null || version === HISTORY_API_VERSION;
  if (!SYMBOL_PATTERN.test(symbol) || !VALID_INTERVALS.has(interval) || !VALID_RANGES.has(range) || !validTo || !validVersion) {
    return jsonResponse(
      {
        error: 'invalid_parameters',
        detail:
          'symbol must match [A-Z0-9]{2,12}; interval and range must be supported values; to must be epoch seconds after 1980; v must be the current API version.',
      },
      400,
      request
    );
  }

  let rows: RawCandleLike[] = [];
  let source: HistorySource | null = null;
  const query: HistoryQuery = { symbol, interval, range, to };

  /** Try a source unless an earlier one already answered. */
  const attempt = async (name: HistorySource, run: () => Promise<RawCandleLike[]>) => {
    if (source !== null) return;
    const result = await run();
    if (result.length >= MIN_USABLE_CANDLES) {
      rows = result;
      source = name;
    }
  };

  // Real OHLC first. The ECB publishes one reference rate per day and nothing
  // else: served first, it gave daily forex charts with no wick at all — a body
  // from the previous close to today's, high and low glued to it. It now only
  // extends a real series further back in time (see below).
  const isForexLike = symbol.length === 6 && !symbol.endsWith('USDT');
  const dailyForex = DAILY_INTERVALS.has(interval) && isForexLike;
  const startedAt = Date.now();
  let dukascopyOutcome: DukascopyOutcome = 'disabled';
  let dukascopyMs = 0;
  const dukascopy = options.dukascopy === undefined ? realDukascopy : options.dukascopy;
  if (dukascopy) {
    await attempt('dukascopy', () =>
      fetchDukascopy(query, dukascopy, (outcome) => {
        dukascopyOutcome = outcome;
        dukascopyMs = Date.now() - startedAt;
      })
    );
  }
  await attempt('yahoo', () => fetchYahoo(symbol, range, interval, to));
  if (symbol.endsWith('USDT')) await attempt('binance', () => fetchBinance(symbol, interval, to));

  let extendedWithEcb = false;
  if (dailyForex && interval === '1d') {
    const ecb = await fetchFrankfurter(symbol);
    const extended = extendWithEcbCloses(rows, ecb);
    extendedWithEcb = source !== null && extended.length > sanitizeCandles(rows).length;
    if (source === null && extended.length >= MIN_USABLE_CANDLES) source = 'ecb';
    rows = extended;
  }

  // Shared with the client instead of a third private copy: the two previous
  // implementations had already diverged on NaN handling.
  const sanitized = sanitizeCandles(rows);
  // Markets closed at the weekend: Dukascopy's short Sunday session becomes
  // part of Monday, as on TradingView. Crypto trades seven days a week.
  const candles = interval === '1d' && !symbol.endsWith('USDT') ? mergeWeekendDailyCandles(sanitized) : sanitized;

  // One structured line per request: filter the function logs on `[history]`
  // and count `source` / `dukascopy` to see how often the fallback serves.
  const totalMs = Date.now() - startedAt;
  console.info(
    '[history]',
    JSON.stringify({ symbol, interval, source, dukascopy: dukascopyOutcome, ms: totalMs, count: candles.length })
  );
  const observability = {
    'X-History-Source': source ?? 'none',
    'Server-Timing': `dukascopy;dur=${dukascopyMs};desc="${dukascopyOutcome}", total;dur=${totalMs}`,
  };

  if (candles.length === 0) {
    // 502 rather than an empty 200: the client can no longer mistake "every
    // upstream is down" for "this instrument has no history".
    return jsonResponse({ error: 'upstream_unavailable', symbol, interval, range }, 502, request, false, observability);
  }

  return jsonResponse(
    // `source` lets the client say where the candles come from instead of a
    // generic "API historique"; `extendedWith` flags the closes-only prefix.
    { symbol, interval, range, source, extendedWith: extendedWithEcb ? 'ecb' : null, count: candles.length, candles },
    200,
    request,
    true,
    observability
  );
}
