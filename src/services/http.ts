/**
 * HTTP helpers for the market-data providers.
 *
 * Every provider call previously used a bare `fetch` with no timeout and no
 * content-type check. Two consequences were live in production:
 *  - a slow or hanging upstream blocked the loader indefinitely, with the
 *    spinner stuck on screen and no way to recover but a reload;
 *  - `/api/dukascopy` has no serverless implementation, so Netlify's SPA
 *    catch-all answered it with `200 text/html`. `res.ok` passed, `res.json()`
 *    threw, the error was swallowed, and the caller silently fell through to
 *    generated data. `fetchJson` now treats a non-JSON body as a failure.
 */

/** Default budget for a single provider request. */
export const DEFAULT_TIMEOUT_MS = 10_000;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchJsonOptions {
  readonly timeoutMs?: number;
  /** Caller-owned signal; aborting it cancels the request. */
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

/**
 * Abort reason for the timeout branch.
 *
 * It must be a `DOMException`, not a plain `Error`: `controller.abort(reason)`
 * makes `fetch` reject with *that exact value*, so aborting with `new Error(…)`
 * produced a rejection that `isAbortError` could not recognise. Callers then
 * treated a caller-driven cancellation as an ordinary provider failure and kept
 * querying the remaining providers after the request had been cancelled.
 */
function timeoutReason(timeoutMs: number): DOMException {
  return new DOMException(`Timeout après ${timeoutMs} ms`, 'TimeoutError');
}

/** Combine a caller signal with a timeout, without requiring `AbortSignal.any`. */
function withTimeout(timeoutMs: number, external?: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutReason(timeoutMs)), timeoutMs);

  // `abort()` with no argument yields the standard `AbortError` DOMException,
  // which is what we want when the caller aborted without giving a reason.
  const onExternalAbort = () => {
    if (external?.reason === undefined) controller.abort();
    else controller.abort(external.reason);
  };

  if (external) {
    if (external.aborted) onExternalAbort();
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
}

/**
 * GET a JSON document, bounded by a timeout and validated as JSON.
 * Throws `HttpError` on a non-2xx status, a non-JSON body, or a timeout.
 */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: external, headers } = options;
  const { signal, dispose } = withTimeout(timeoutMs, external);

  try {
    const response = await fetch(url, { signal, headers });
    if (!response.ok) {
      throw new HttpError(`HTTP ${response.status}`, response.status, url);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) {
      throw new HttpError(
        `Réponse non JSON (${contentType || 'type inconnu'}) — endpoint probablement absent`,
        response.status,
        url
      );
    }

    return (await response.json()) as T;
  } finally {
    dispose();
  }
}

/**
 * True when a rejection means "this request was cancelled", from either a
 * timeout or the caller's own signal.
 *
 * Matched structurally rather than with `instanceof DOMException`: the reason
 * travels across realms (a worker, a polyfilled `AbortController`, jsdom) where
 * the `DOMException` identity differs, and an `instanceof` test then silently
 * reports "not an abort" for a genuine cancellation.
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** True specifically for the timeout branch, which callers may want to retry. */
export function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'TimeoutError'
  );
}
