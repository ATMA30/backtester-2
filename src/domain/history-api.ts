/**
 * Version of what `/api/history` returns, sent with every request and checked
 * by the server.
 *
 * Responses are cached (5 min in the browser, a day at the CDN). When their
 * content changes meaning — daily forex switching from ECB closes to real
 * OHLC — cached copies kept serving candles without wicks after the fix. Bump
 * this whenever the server's output changes: the URL, hence the cache key,
 * changes with it.
 *
 * Shared by the client and the function: the server refuses any other value,
 * since `v` is part of the CDN cache key and `&v=<random>` bypassed the cache
 * at will — the very flood of provider requests that rounding `to` prevents.
 */
export const HISTORY_API_VERSION = '5';
