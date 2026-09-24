import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson, isAbortError, isTimeoutError, HttpError } from './http';

/** Minimal `Response` stand-in — only what `fetchJson` reads. */
function jsonResponse(body: unknown, contentType = 'application/json'): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('isAbortError', () => {
  it('recognises the standard AbortError from an un-reasoned abort', () => {
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(controller.signal.reason)).toBe(true);
  });

  it('recognises a timeout abort', () => {
    expect(isAbortError(new DOMException('too slow', 'TimeoutError'))).toBe(true);
    expect(isTimeoutError(new DOMException('too slow', 'TimeoutError'))).toBe(true);
  });

  it('separates a timeout from a caller cancellation', () => {
    const controller = new AbortController();
    controller.abort();
    // Both are aborts, but only one is a timeout — the provider chain uses this
    // to decide whether to try the next source or give up entirely.
    expect(isTimeoutError(controller.signal.reason)).toBe(false);
  });

  it('is not fooled by an ordinary failure', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(new TypeError('network'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });

  it('matches structurally, across realms', () => {
    // A DOMException built in a worker or a polyfilled AbortController fails an
    // `instanceof DOMException` test while being a genuine cancellation.
    expect(isAbortError({ name: 'AbortError', message: 'aborted' })).toBe(true);
  });
});

describe('fetchJson', () => {
  it('rejects a non-JSON body rather than letting `.json()` throw later', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('<!doctype html>', 'text/html')));
    // This is the SPA catch-all case: a missing /api route answers 200 text/html.
    await expect(fetchJson('/api/missing')).rejects.toBeInstanceOf(HttpError);
  });

  it('rejects a non-2xx status with the status attached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, headers: { get: () => null } } as unknown as Response)
    );
    await expect(fetchJson('/api/history')).rejects.toMatchObject({ status: 502 });
  });

  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ candles: [1, 2] })));
    await expect(fetchJson<{ candles: number[] }>('/api/history')).resolves.toEqual({ candles: [1, 2] });
  });

  it('aborts with a recognisable TimeoutError once the budget elapses', async () => {
    // `fetch` here never settles on its own: only the timeout can end it.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason));
          })
      )
    );

    const pending = fetchJson('/slow', { timeoutMs: 10 });
    await expect(pending).rejects.toSatisfy(isTimeoutError);
  });

  it('propagates the caller’s own abort as a cancellation, not a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason));
          })
      )
    );

    const controller = new AbortController();
    const pending = fetchJson('/slow', { signal: controller.signal, timeoutMs: 60_000 });
    controller.abort();

    await expect(pending).rejects.toSatisfy((e: unknown) => isAbortError(e) && !isTimeoutError(e));
  });

  it('honours a signal that is already aborted before the call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            if (init.signal.aborted) reject(init.signal.reason);
            init.signal.addEventListener('abort', () => reject(init.signal.reason));
          })
      )
    );

    const controller = new AbortController();
    controller.abort();
    await expect(fetchJson('/x', { signal: controller.signal })).rejects.toSatisfy(isAbortError);
  });
});
