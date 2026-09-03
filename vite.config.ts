import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error dukascopy-node cjs import
import { getHistoricalRates } from 'dukascopy-node';

function dukascopyPlugin(): Plugin {
  return {
    name: 'vite-plugin-dukascopy',
    configureServer(server) {
      server.middlewares.use('/api/dukascopy', async (req, res) => {
        try {
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          const rawSym = url.searchParams.get('symbol') || 'eurusd';
          const instrument = rawSym.replace(/[^a-zA-Z]/g, '').toLowerCase();
          const from = url.searchParams.get('from') || '2024-01-01';
          const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
          const timeframe = url.searchParams.get('timeframe') || 'h1';

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
          console.warn('[Dukascopy Vite Plugin Error]:', err);
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
  plugins: [react(), dukascopyPlugin()],
  server: {
    port: 5173,
  },
});

