import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleHistoryRequest } from './netlify/lib/history-core';

/** Node request → Fetch `Request`, so dev runs the production handler unchanged. */
function toWebRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (value !== undefined) headers.set(name, value);
  }
  // Connect strips the mount path from `req.url`; `originalUrl` keeps it.
  const path = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/';
  return new Request(new URL(path, `http://${req.headers.host ?? 'localhost'}`), {
    method: req.method,
    headers,
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(await response.text());
}

function marketDataPlugin(): Plugin {
  return {
    name: 'vite-plugin-market-data',
    configureServer(server) {
      // /api/history — the production handler itself (`netlify/lib/history-core`),
      // Dukascopy included, with the same spans, budget and fallbacks. The dev
      // server used to carry its own Yahoo/Frankfurter/Dukascopy copies, which
      // had drifted: invented wicks, no validation, `Access-Control-Allow-Origin: *`,
      // and five hourly years of Dukascopy that production never had. There is
      // no dev-only route any more: what runs here is what runs on Netlify.
      server.middlewares.use('/api/history', async (req, res) => {
        try {
          const response = await handleHistoryRequest(toWebRequest(req));
          await sendWebResponse(res, response);
        } catch (err) {
          console.warn('[dev /api/history]', err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'upstream_failure' }));
        }
      });

      // Any other /api/* route: 404 JSON, as `netlify.toml` does in production.
      // Vite's SPA fallback answered `200 text/html` here, the very trap that
      // once hid a missing endpoint behind a successful status.
      server.middlewares.use('/api', (_req, res) => {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), marketDataPlugin()],
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes far less often than the app: separate chunks stay
        // cached across deploys instead of being re-downloaded in one 700 KB file.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('lightweight-charts') || id.includes('fancy-canvas')) return 'charts';
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react';
          return 'vendor';
        },
      },
    },
  },
});

