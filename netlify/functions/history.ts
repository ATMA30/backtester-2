// Production equivalent of the local dev server.py market-data proxy
// (Frankfurter for 27y forex, Yahoo Finance for indices/metals/oil/intraday,
// Binance for crypto). No API keys, all three sources are public/free.

interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CleanCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const FOREX_MAJORS = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY',
  'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPCHF',
  'GBPNZD', 'AUDCAD', 'AUDCHF', 'AUDNZD', 'CADCHF', 'NZDCAD', 'NZDCHF',
  'USDMXN', 'USDZAR', 'USDTRY', 'USDSGD', 'USDNOK', 'USDSEK', 'USDPLN', 'EURTRY',
]);

async function fetchFrankfurterDeep(symbol: string): Promise<RawCandle[]> {
  const base = symbol.slice(0, 3);
  const target = symbol.slice(3);
  const endDate = new Date().toISOString().slice(0, 10);
  const url = `https://api.frankfurter.dev/v1/1999-01-01..${endDate}?from=${base}&to=${target}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    const rates: Record<string, Record<string, number>> = data?.rates || {};
    const pip = symbol.includes('JPY') ? 0.01 : 0.0001;

    let prevClose: number | null = null;
    const candles: RawCandle[] = [];
    for (const dateStr of Object.keys(rates).sort()) {
      const val = rates[dateStr]?.[target];
      if (val == null) continue;
      const epoch = Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000);
      const close = Number(val);
      const open = prevClose ?? close;
      prevClose = close;

      const change = Math.abs(close - open);
      const spread = Math.max(pip * 15, change * 0.45);
      candles.push({
        time: epoch,
        open,
        high: Math.max(open, close) + spread * 0.65,
        low: Math.min(open, close) - spread * 0.65,
        close,
        volume: 0,
      });
    }
    return candles;
  } catch (e) {
    console.warn(`[Frankfurter Deep Error for ${symbol}]:`, e);
    return [];
  }
}

function yahooSymbolFor(symbol: string): string {
  if (FOREX_MAJORS.has(symbol)) return `${symbol}=X`;
  if (symbol === 'XAUUSD' || symbol === 'GOLD') return 'GC=F';
  if (symbol === 'XAGUSD' || symbol === 'SILVER') return 'SI=F';
  if (symbol === 'USOIL' || symbol === 'WTI') return 'CL=F';
  if (symbol === 'UKOIL' || symbol === 'BRENT') return 'BZ=F';
  if (symbol === 'SPX500') return '^GSPC';
  if (symbol === 'NAS100') return '^IXIC';
  if (symbol.endsWith('USDT')) return symbol.replace('USDT', '-USD');
  return symbol;
}

async function fetchYahoo(symbol: string, rangeStr: string, interval: string): Promise<RawCandle[]> {
  const yahooSym = yahooSymbolFor(symbol);
  let yfInterval = interval;
  let yfRange = rangeStr;

  if (interval === '1h' || interval === '4h') {
    yfInterval = '60m';
    if (['5y', '10y', 'max'].includes(yfRange)) yfRange = '2y';
  } else if (['1m', '5m', '15m', '30m'].includes(interval)) {
    if (['1y', '2y', '5y', '10y', 'max'].includes(yfRange)) {
      yfRange = interval === '1m' ? '7d' : '60d';
    }
  } else if (['1d', '1wk', '1mo'].includes(interval)) {
    if (yfRange === 'max') yfRange = '10y';
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=${yfRange}&interval=${yfInterval}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};

    const candles: RawCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = quote.open?.[i];
      const c = quote.close?.[i];
      if (o == null || c == null || Number(o) <= 0) continue;
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const v = quote.volume?.[i];
      candles.push({
        time: timestamps[i],
        open: Number(o),
        high: h != null ? Number(h) : Math.max(Number(o), Number(c)),
        low: l != null ? Number(l) : Math.min(Number(o), Number(c)),
        close: Number(c),
        volume: v ? Number(v) : 0,
      });
    }
    return candles;
  } catch (e) {
    console.warn(`[Yahoo API Error for ${symbol}]:`, e);
    return [];
  }
}

async function fetchBinance(symbol: string, interval: string): Promise<RawCandle[]> {
  const bInterval = ['1d', '1wk', '1mo'].includes(interval) ? '1d' : ['1h', '4h'].includes(interval) ? '1h' : '15m';
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${bInterval}&limit=1000`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const raw = await res.json();
    if (!Array.isArray(raw)) return [];
    return raw.map((k: any[]) => ({
      time: Math.floor(k[0] / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Math.floor(Number(k[5])),
    }));
  } catch (e) {
    console.warn(`[Binance Error for ${symbol}]:`, e);
    return [];
  }
}

function cleanCandles(candles: RawCandle[], symbol: string): CleanCandle[] {
  if (!candles.length) return [];
  const pip = symbol.includes('JPY') || symbol.includes('XAU') ? 0.01 : 0.0001;
  const seen = new Set<number>();
  const cleaned: CleanCandle[] = [];

  candles.forEach((c, i) => {
    if (!c.time || seen.has(c.time)) return;
    seen.add(c.time);

    const o = Number(c.open);
    let h = Number(c.high ?? o);
    let l = Number(c.low ?? o);
    const close = Number(c.close ?? o);
    if (!(o > 0) || !(close > 0)) return;

    h = Math.max(h, o, close);
    l = Math.min(l, o, close);
    if (h === l) {
      h += pip * 2;
      l -= pip * 2;
    }

    const rawVol = c.volume || 0;
    let volume: number;
    if (rawVol > 0 && rawVol !== 100) {
      volume = Math.floor(rawVol);
    } else {
      const priceRange = Math.abs(h - l);
      const bodyRange = Math.abs(close - o);
      const volFactor = Math.max(1, Math.floor(((priceRange * 0.7 + bodyRange * 0.3) / pip) * 15));
      volume = 1200 + volFactor * 18 + ((i * 47) % 650);
    }

    cleaned.push({
      time: Math.floor(c.time),
      open: Number(o.toFixed(5)),
      high: Number(h.toFixed(5)),
      low: Number(l.toFixed(5)),
      close: Number(close.toFixed(5)),
      volume,
    });
  });

  cleaned.sort((a, b) => a.time - b.time);
  return cleaned;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || 'EURUSD').toUpperCase();
  const interval = url.searchParams.get('interval') || '1d';
  const rangeStr = url.searchParams.get('range') || '10y';

  let candles: RawCandle[] = [];

  const isDailyLike = ['1d', '1wk', '1mo'].includes(interval);
  if (isDailyLike && (['5y', '10y', 'max'].includes(rangeStr) || symbol.length === 6)) {
    if (symbol.length === 6 && !symbol.endsWith('USDT')) {
      candles = await fetchFrankfurterDeep(symbol);
    }
  }

  if (candles.length < 50) {
    candles = await fetchYahoo(symbol, rangeStr, interval);
  }

  if (candles.length < 50 && symbol.endsWith('USDT')) {
    candles = await fetchBinance(symbol, interval);
  }

  const cleaned = cleanCandles(candles, symbol);

  return new Response(
    JSON.stringify({ symbol, interval, range: rangeStr, count: cleaned.length, candles: cleaned }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
};
