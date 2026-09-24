/**
 * `/api/history` — Netlify Functions v2 entry point.
 *
 * All the logic lives in `netlify/lib/history-core.ts`, shared with the Vite
 * dev server so that development exercises the same validation, providers and
 * headers as production.
 */

import { handleHistoryRequest } from '../lib/history-core';

/**
 * Netlify Functions v2 route configuration.
 *
 * Declared locally rather than importing `@netlify/functions`: the package is
 * not a runtime dependency here and this is the only type needed from it.
 */
interface NetlifyFunctionConfig {
  path: string;
  rateLimit?: {
    windowSize: number;
    windowLimit: number;
    aggregateBy?: Array<'ip' | 'domain'>;
    action?: 'rate_limit' | 'rewrite';
  };
}

export default (request: Request): Promise<Response> => handleHistoryRequest(request);

export const config: NetlifyFunctionConfig = {
  path: '/api/history',
  rateLimit: {
    windowSize: 60,
    windowLimit: 60,
    aggregateBy: ['ip', 'domain'],
    action: 'rate_limit',
  },
};
