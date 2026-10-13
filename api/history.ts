/**
 * Vercel Edge Serverless Function for /api/history.
 *
 * Runs globally on Vercel's Edge network (<1ms cold start, zero Node.js/fs dependencies).
 * Aggregates Yahoo Finance (for deep Forex, Metals, Oil, and Indices with REAL OHLC wicks),
 * Binance (for Crypto), and Frankfurter (for ECB 1999-present daily closes).
 */

import {
  aggregateCandles,
  mergeWeekendDailyCandles,
  sanitizeCandles,
  RawCandleLike,
} from '../src/domain/candles';
import { HISTORY_API_VERSION } from '../src/domain/history-api';
import { TimeframeSeconds } from '../src/domain/timeframes';

export const config = {
  runtime: 'edge',
};

const UPSTREAM_TIMEOUT_MS = 5_000;
const MIN_USABLE_CANDLES = 50;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const SYMBOL_PATTERN = /^[A-Z0-9]{2,12}$/;
const VALID_INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w', '1wk', '1mo']);
const VALID_RANGES = new Set(['1y', '2y', '5y', '10y', 'max']);
const DAILY_INTERVALS = new Set(['1d', '1w', '1wk', '1mo']);

const FOREX_PAIRS: ReadonlySet<string> = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY',
  'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPCHF',
  'GBPNZD', 'AUDCAD', 'AUDCHF', 'AUDNZD', 'CADCHF', 'NZDCAD', 'NZDCHF',
  'USDMXN', 'USDZAR', 'USDTRY', 'USDSGD', 'USDNOK', 'USDSEK', 'USDPLN', 'EURTRY',
]);

const ECB_CURRENCIES = new Set([
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD',
  'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

const RANGE_SECONDS: Readonly<Record<string, number>> = {
  '7d': 7 * 86_400,
  '60d': 60 * 86_400,
  '1y': 365 * 86_400,
  '2y': 2 * 365 * 86_400,
  '5y': 5 * 365 * 86_400,
  '10y': 10 * 365 * 86_400,
};

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'application/json, */*',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn('[history edge] fetchJson failed:', { url: new URL(url).host, error: String(error) });
    return null;
  }
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

function yahooWindow(interval: string, range: string): { interval: string; range: string } {
  if (interval === '1h' || interval === '2h' || interval === '4h') {
    return { interval: '60m', range: ['5y', '10y', 'max'].includes(range) ? '2y' : range };
  }
  if (['1m', '3m', '5m', '15m', '30m'].includes(interval)) {
    const capped = ['1y', '2y', '5y', '10y', 'max'].includes(range);
    return {
      interval: interval === '3m' ? '1m' : interval,
      range: capped ? (['1m', '3m'].includes(interval) ? '7d' : '60d') : range,
    };
  }
  if (DAILY_INTERVALS.has(interval)) {
    return { interval: interval === '1w' ? '1wk' : interval, range: range === 'max' ? '10y' : range };
  }
  return { interval, range };
}

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
  const hosts = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com'];
  let data: unknown = null;
  for (const host of hosts) {
    data = await fetchJson(`${host}/v8/finance/chart/${path}?${params}`);
    if (data) break;
  }

  const result = (
    data as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>> } }> } } | null
  )?.chart?.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};

  const rows: RawCandleLike[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    rows.push({
      time: DAILY_INTERVALS.has(interval) ? Math.round(timestamps[i] / 86_400) * 86_400 : timestamps[i],
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: quote.close?.[i],
      volume: quote.volume?.[i],
    });
  }

  // Yahoo Finance's 1m forex feed only publishes single closing snapshots
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

  // In Yahoo Finance's daily forex feed, the upstream vendor recorded morning snapshots
  // for both open and close (average body ~0.5 pips vs 70 pips range). This leaves daily
  // candles with almost zero-height bodies (thin needles/crosses) and wrong directions.
  // In continuous 24/5 forex, the true close of day i is the open of day i+1 (nextOpen).
  if (DAILY_INTERVALS.has(interval)) {
    for (let i = 0; i < rows.length - 1; i++) {
      const cur = rows[i];
      const next = rows[i + 1];
      const nextOpen = typeof next.open === 'number' ? next.open : null;
      const h = typeof cur.high === 'number' ? cur.high : null;
      const l = typeof cur.low === 'number' ? cur.low : null;
      const o = typeof cur.open === 'number' ? cur.open : null;
      const c = typeof cur.close === 'number' ? cur.close : null;

      if (nextOpen !== null && o !== null && h !== null && l !== null) {
        const candleRange = h - l;
        const rawBody = Math.abs((c ?? o) - o);
        // If the candle body is collapsed relative to the daily range (typical in Yahoo forex),
        // reconstruct the close using the next day's open clamped to [low, high].
        if (candleRange > 0 && rawBody / candleRange < 0.25) {
          cur.close = Math.min(h, Math.max(l, nextOpen));
        }
        cur.high = Math.max(cur.high as number, cur.open as number, cur.close as number);
        cur.low = Math.min(cur.low as number, cur.open as number, cur.close as number);
      }
    }
  }

  // Also ensure any candle with identical open and close gets open = prevClose
  let prevClose: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const c = typeof r.close === 'number' ? r.close : null;
    let o = typeof r.open === 'number' ? r.open : null;
    let h = typeof r.high === 'number' ? r.high : null;
    let l = typeof r.low === 'number' ? r.low : null;

    if (c !== null && o !== null) {
      if (Math.abs(o - c) < 0.000001 && prevClose !== null) {
        o = prevClose;
        if (h !== null) h = Math.max(h, o, c);
        if (l !== null) l = Math.min(l, o, c);
        r.open = o;
        r.high = h;
        r.low = l;
      }
      prevClose = c;
    }
  }

  // If the very latest candle is a single-tick snapshot, use the previous close as open
  if (rows.length >= 2) {
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    if (
      last.open === last.close &&
      last.high === last.close &&
      last.low === last.close &&
      typeof prev.close === 'number'
    ) {
      last.open = prev.close;
      last.high = Math.max(last.open, last.close as number);
      last.low = Math.min(last.open, last.close as number);
    }
  }

  return rows;
}

async function fetchFrankfurter(symbol: string): Promise<RawCandleLike[]> {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  if (!ECB_CURRENCIES.has(base) || !ECB_CURRENCIES.has(quote)) return [];

  const params = new URLSearchParams({ from: base, to: quote });
  const endDate = new Date().toISOString().slice(0, 10);
  const data = await fetchJson(`https://api.frankfurter.dev/v1/1999-01-01..${endDate}?${params}`);

  const rates = (data as { rates?: Record<string, Record<string, number>> } | null)?.rates;
  if (!rates || typeof rates !== 'object') return [];

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

function extendWithEcbCloses(real: RawCandleLike[], ecb: RawCandleLike[]): RawCandleLike[] {
  const clean = sanitizeCandles(real);
  if (clean.length < MIN_USABLE_CANDLES) return ecb.length >= MIN_USABLE_CANDLES ? ecb : real;
  const firstReal = clean[0].time;
  const older = ecb.filter((row) => typeof row.time === 'number' && row.time < firstReal);
  return [...older, ...clean];
}

function buildResponse(body: unknown, status: number, cacheable = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': cacheable
        ? 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
        : 'no-store',
    },
  });
}

export async function handleHistory(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (request.method !== 'GET') {
    return buildResponse({ error: 'method_not_allowed' }, 405);
  }

  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? 'EURUSD').toUpperCase();
  const interval = url.searchParams.get('interval') ?? '1d';
  const range = url.searchParams.get('range') ?? '10y';
  const toRaw = url.searchParams.get('to');
  const to = toRaw === null ? null : Math.ceil(Number(toRaw) / 86_400) * 86_400;
  const nowSeconds = Math.floor(Date.now() / 1000);

  const validTo = to === null || (/^\d{9,10}$/.test(toRaw ?? '') && to! > 315_532_800 && to! <= nowSeconds + 86_400);
  const version = url.searchParams.get('v');
  const validVersion = version === null || version === HISTORY_API_VERSION;

  if (!SYMBOL_PATTERN.test(symbol) || !VALID_INTERVALS.has(interval) || !VALID_RANGES.has(range) || !validTo || !validVersion) {
    return buildResponse(
      {
        error: 'invalid_parameters',
        detail: 'symbol must match [A-Z0-9]{2,12}; interval and range must be supported values; to must be epoch seconds; v must match current version.',
      },
      400
    );
  }

  let rows: RawCandleLike[] = [];
  let source: 'yahoo' | 'binance' | 'ecb' | null = null;
  const isForexLike = symbol.length === 6 && !symbol.endsWith('USDT');
  const dailyForex = DAILY_INTERVALS.has(interval) && isForexLike;

  // 1. Primary: Yahoo Finance (Full OHLC wicks for Forex, Metals, Oil, Indices)
  if (!symbol.endsWith('USDT')) {
    const yahooRows = await fetchYahoo(symbol, range, interval, to);
    if (yahooRows.length >= MIN_USABLE_CANDLES) {
      rows = yahooRows;
      source = 'yahoo';
    }
  }

  // 2. Crypto: Binance
  if (symbol.endsWith('USDT')) {
    const binanceRows = await fetchBinance(symbol, interval, to);
    if (binanceRows.length >= MIN_USABLE_CANDLES) {
      rows = binanceRows;
      source = 'binance';
    } else {
      const yahooRows = await fetchYahoo(symbol, range, interval, to);
      if (yahooRows.length >= MIN_USABLE_CANDLES) {
        rows = yahooRows;
        source = 'yahoo';
      }
    }
  }

  // 3. For Daily Forex: extend back to 1999 using Frankfurter ECB closes
  let extendedWithEcb = false;
  if (dailyForex && interval === '1d') {
    const ecb = await fetchFrankfurter(symbol);
    const extended = extendWithEcbCloses(rows, ecb);
    extendedWithEcb = source !== null && extended.length > sanitizeCandles(rows).length;
    if (source === null && extended.length >= MIN_USABLE_CANDLES) {
      source = 'ecb';
    }
    rows = extended;
  }

  const sanitized = sanitizeCandles(rows);
  let processed = sanitized;
  if (interval === '2h') {
    processed = aggregateCandles(sanitized, TimeframeSeconds.H2, TimeframeSeconds.H1);
  } else if (interval === '4h') {
    processed = aggregateCandles(sanitized, TimeframeSeconds.H4, TimeframeSeconds.H1);
  } else if (interval === '3m') {
    processed = aggregateCandles(sanitized, TimeframeSeconds.M3, TimeframeSeconds.M1);
  } else if (interval === '1w' || interval === '1wk') {
    processed = aggregateCandles(sanitized, TimeframeSeconds.W1, TimeframeSeconds.D1);
  } else if (interval === '1mo') {
    processed = aggregateCandles(sanitized, TimeframeSeconds.MN1, TimeframeSeconds.D1);
  }

  const candles = interval === '1d' && !symbol.endsWith('USDT') ? mergeWeekendDailyCandles(processed) : processed;

  if (candles.length === 0) {
    return buildResponse({ error: 'upstream_unavailable', symbol, interval, range }, 502);
  }

  return buildResponse(
    {
      symbol,
      interval,
      range,
      source,
      extendedWith: extendedWithEcb ? 'ecb' : null,
      count: candles.length,
      candles,
    },
    200,
    true
  );
}

/**
 * Default handler compatible with Vercel Edge Runtime, Node.js Serverless and Web Standards.
 */
export default async function handler(req: any, res?: any): Promise<Response | void> {
  try {
    if (req instanceof Request || (req?.headers && typeof req.headers.get === 'function')) {
      return await handleHistory(req);
    }

    // Node Serverless fallback (if runtime is not edge)
    const origin = req.headers?.origin || '';
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost';
    const proto = req.headers?.['x-forwarded-proto'] || 'https';
    const rawUrl = req.url || '/api/history';
    const fullUrl = rawUrl.startsWith('http') ? rawUrl : `${proto}://${host}${rawUrl}`;

    const webReq = new Request(fullUrl, {
      method: req.method || 'GET',
      headers: origin ? { origin } : undefined,
    });

    const response = await handleHistory(webReq);

    if (res && typeof res.setHeader === 'function') {
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(await response.text());
      return;
    }

    return response;
  } catch (error: any) {
    console.error('[api/history crash]', error);
    const errorBody = {
      error: 'internal_server_error',
      message: String(error?.message || error),
    };
    if (res && typeof res.setHeader === 'function') {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(errorBody));
      return;
    }
    return buildResponse(errorBody, 500);
  }
}

export { handler as GET };
