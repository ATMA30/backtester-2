import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import https from 'https';
// @ts-expect-error dukascopy-node cjs import
import { getHistoricalRates } from 'dukascopy-node';

const FOREX_MAJORS = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'CADJPY', 'CHFJPY', 'NZDJPY',
  'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPCHF',
  'GBPNZD', 'AUDCAD', 'AUDCHF', 'AUDNZD', 'CADCHF', 'NZDCAD', 'NZDCHF',
  'USDMXN', 'USDZAR', 'USDTRY', 'USDSGD', 'USDNOK', 'USDSEK', 'USDPLN', 'EURTRY',
]);

function fetchYahooBackend(symbol: string, range: string, interval: string): Promise<any[]> {

  let ySym = symbol;
  if (FOREX_MAJORS.has(symbol)) ySym = `${symbol}=X`;
  else if (symbol === 'XAUUSD' || symbol === 'GOLD') ySym = 'GC=F';
  else if (symbol === 'XAGUSD' || symbol === 'SILVER') ySym = 'SI=F';
  else if (symbol === 'SPX500') ySym = '^GSPC';
  else if (symbol === 'NAS100') ySym = '^IXIC';
  else if (symbol.endsWith('USDT')) ySym = symbol.replace('USDT', '-USD');

  let yfInterval = interval;
  let yfRange = range;
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

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=${yfRange}&interval=${yfInterval}`;

  return new Promise((resolve) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const r = json.chart?.result?.[0];
            if (!r) return resolve([]);
            const timestamps = r.timestamp || [];
            const quote = r.indicators?.quote?.[0] || {};
            const candles = [];
            for (let i = 0; i < timestamps.length; i++) {
              const o = quote.open?.[i];
              const c = quote.close?.[i];
              if (o != null && c != null && Number(o) > 0) {
                candles.push({
                  time: timestamps[i],
                  open: Number(o),
                  high: Number(quote.high?.[i] || Math.max(Number(o), Number(c))),
                  low: Number(quote.low?.[i] || Math.min(Number(o), Number(c))),
                  close: Number(c),
                  volume: quote.volume ? Number(quote.volume[i] || 0) : 0,
                });
              }
            }
            resolve(candles);
          } catch {
            resolve([]);
          }
        });
      })
      .on('error', () => resolve([]));
  });
}

function marketDataPlugin(): Plugin {
  return {
    name: 'vite-plugin-market-data',
    configureServer(server) {
      // 1. /api/history (Exact replacement of python server with real Forex, Metals & Indices)
      server.middlewares.use('/api/history', async (req, res) => {
        try {
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          const symbol = (url.searchParams.get('symbol') || 'EURUSD').toUpperCase();
          const interval = url.searchParams.get('interval') || '1d';
          const rangeStr = url.searchParams.get('range') || '10y';

          let candles: any[] = [];

          // If daily Forex, use BCE official
          if (interval === '1d' && symbol.length === 6 && !symbol.endsWith('USDT') && !symbol.includes('XAU') && !symbol.includes('XAG')) {
            const base = symbol.slice(0, 3);
            const target = symbol.slice(3);
            const today = new Date().toISOString().slice(0, 10);
            try {
              const frankRes = await fetch(`https://api.frankfurter.dev/v1/1999-01-01..${today}?from=${base}&to=${target}`);
              if (frankRes.ok) {
                const data = await frankRes.json();
                const rates = data.rates || {};
                let prevClose: number | null = null;
                const pip = symbol.includes('JPY') ? 0.01 : 0.0001;
                for (const dStr of Object.keys(rates).sort()) {
                  const val = rates[dStr]?.[target];
                  if (val != null) {
                    const epoch = Math.floor(new Date(`${dStr}T00:00:00Z`).getTime() / 1000);
                    const closeP = Number(val);
                    const openP = prevClose !== null ? prevClose : closeP;
                    prevClose = closeP;
                    const change = Math.abs(closeP - openP);
                    const spread = Math.max(pip * 15.0, change * 0.45);
                    candles.push({
                      time: epoch,
                      open: openP,
                      high: Math.max(openP, closeP) + spread * 0.65,
                      low: Math.min(openP, closeP) - spread * 0.65,
                      close: closeP,
                      volume: 0,
                    });
                  }
                }
              }
            } catch (err) {
              console.warn('Frankfurter error:', err);
            }
          }

          // If Spot Gold, Silver or Forex Intraday, use Swiss Bank Dukascopy (real ECN ticks & volumes matching TradingView!)
          const isForexIntraday = interval !== '1d' && FOREX_MAJORS.has(symbol);
          const isMetals = symbol === 'XAUUSD' || symbol === 'GOLD' || symbol === 'XAGUSD' || symbol === 'SILVER';

          if (isMetals || isForexIntraday) {
            try {
              let inst = symbol.toLowerCase();
              if (symbol === 'GOLD' || symbol === 'XAUUSD') inst = 'xauusd';
              else if (symbol === 'SILVER' || symbol === 'XAGUSD') inst = 'xagusd';

              const tf = interval === '1d' ? 'd1' : interval === '1h' ? 'h1' : interval === '15m' ? 'm15' : interval === '5m' ? 'm5' : 'm1';
              const toD = new Date().toISOString().slice(0, 10);
              const now = new Date();
              const fromD =
                interval === '1m'
                  ? new Date(now.getTime() - 7 * 86400 * 1000).toISOString().slice(0, 10)
                  : interval === '5m' || interval === '3m'
                  ? new Date(now.getTime() - 30 * 86400 * 1000).toISOString().slice(0, 10)
                  : interval === '15m' || interval === '30m'
                  ? new Date(now.getTime() - 60 * 86400 * 1000).toISOString().slice(0, 10)
                  : interval === '1h' || interval === '4h'
                  ? new Date(now.getTime() - 365 * 86400 * 1000).toISOString().slice(0, 10)
                  : '2016-01-01';

              const rates = await getHistoricalRates({
                instrument: inst,
                dates: { from: fromD, to: toD },
                timeframe: tf as any,
                format: 'json',
              });
              if (Array.isArray(rates) && rates.length > 50) {
                candles = rates.map((r: any) => ({
                  time: Math.floor(r.timestamp / 1000),
                  open: Number(r.open),
                  high: Number(r.high),
                  low: Number(r.low),
                  close: Number(r.close),
                  volume: Math.floor(Number(r.volume || 0)),
                }));
              }
            } catch (err) {
              console.warn('[Dukascopy Spot Error]:', err);
            }
          }

          // Fallback to Yahoo Finance (exact server.py behavior)
          if (candles.length < 50) {
            candles = await fetchYahooBackend(symbol, rangeStr, interval);
          }

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ symbol, interval, range: rangeStr, count: candles.length, candles }));
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      // 2. /api/dukascopy (Swiss Bank ultra-deep ECN feed)
      server.middlewares.use('/api/dukascopy', async (req, res) => {
        try {
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          const rawSym = url.searchParams.get('symbol') || 'eurusd';
          const instrument = rawSym.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
          const timeframe = url.searchParams.get('timeframe') || 'h1';
          const now = new Date();
          const defaultFrom =
            timeframe === 'm1'
              ? new Date(now.getTime() - 7 * 86400 * 1000).toISOString().slice(0, 10)
              : timeframe === 'm5' || timeframe === 'm15' || timeframe === 'm30'
              ? new Date(now.getTime() - 60 * 86400 * 1000).toISOString().slice(0, 10)
              : '2024-01-01';

          const from = url.searchParams.get('from') || defaultFrom;
          const to = url.searchParams.get('to') || now.toISOString().slice(0, 10);

          const data = await getHistoricalRates({
            instrument,
            dates: { from, to },
            timeframe: timeframe as any,
            format: 'json',
          });

          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify(data));
        } catch (err: any) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), marketDataPlugin()],
  server: {
    port: 5173,
  },
});

