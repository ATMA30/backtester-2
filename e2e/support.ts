import { expect, Page } from '@playwright/test';

const DAY = 86_400;

/**
 * Deterministic daily series with real wicks: a seeded random walk, so every
 * run sees the same candles and the same prices.
 */
export function makeCandles(count = 600, start = Date.UTC(2023, 0, 2) / 1000) {
  let seed = 42;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  const candles = [];
  let price = 1.1;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = Math.max(0.5, open + (random() - 0.5) * 0.01);
    const high = Math.max(open, close) + random() * 0.004;
    const low = Math.min(open, close) - random() * 0.004;
    candles.push({
      time: start + i * DAY,
      open: +open.toFixed(5),
      high: +high.toFixed(5),
      low: +low.toFixed(5),
      close: +close.toFixed(5),
      volume: 1_000 + Math.round(random() * 500),
    });
    price = close;
  }
  return candles;
}

/**
 * Serve `/api/history` from fixtures and cut every third-party market feed.
 * A test must never depend on Dukascopy, Yahoo, Binance, the ECB or Deriv.
 */
export async function mockMarket(page: Page, candles = makeCandles()) {
  await page.route('**/api/history**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        symbol: url.searchParams.get('symbol'),
        interval: url.searchParams.get('interval'),
        range: url.searchParams.get('range'),
        source: 'dukascopy',
        extendedWith: null,
        count: candles.length,
        candles,
      }),
    });
  });
  for (const host of ['**/api.frankfurter.dev/**', '**/api.binance.com/**', '**/ws.derivws.com/**']) {
    await page.route(host, (route) => route.abort());
  }
}

/** Load the app on a mocked feed, first-run guide dismissed unless asked. */
export async function openApp(page: Page, { guide = false, candles = makeCandles() }: { guide?: boolean; candles?: ReturnType<typeof makeCandles> } = {}) {
  await mockMarket(page, candles);
  if (!guide) {
    await page.addInitScript(() => localStorage.setItem('onboarding-dismissed-v1', '1'));
  }
  await page.goto('/');
  await expect(page.locator('#rows-count')).toHaveText(/\d/, { timeout: 30_000 });
}

/** Start a replay by clicking the chart at `fraction` of its width. */
export async function startReplay(page: Page, fraction = 0.4) {
  await page.getByRole('button', { name: 'Rejouer' }).click();
  const box = await page.locator('#chart-container').boundingBox();
  if (!box) throw new Error('chart not rendered');
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height * 0.4);
  await expect(page.locator('#btn-buy')).toBeVisible();
}

/** Distance of the view from the last candle, in bars (≈ 6 when following). */
export function scrollPosition(page: Page) {
  return page.evaluate(() =>
    (window as unknown as { __tvChart: { timeScale(): { scrollPosition(): number } } }).__tvChart
      .timeScale()
      .scrollPosition()
  );
}

/** Latest toast text. */
export function lastToast(page: Page) {
  return page.locator('.toast-msg').last();
}

/** Stores exposed by `src/devProbes.ts` (dev server only). */
type Stores = {
  replay: { getState(): { currentIndex: number; isPlaying: boolean; isActive: boolean } };
  trade: { getState(): { openPositions: unknown[]; pendingOrders: unknown[]; closedPositions: { closeReason?: string }[]; balance: number } };
  drawing: { getState(): { drawings: unknown[] } };
};

/** Replay cursor, in base candles. */
export function replayIndex(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __stores: Stores }).__stores.replay.getState().currentIndex);
}

/**
 * Wait until the replay has played `count` more candles than now.
 *
 * What replay tests mean by "a while": a fixed delay played fewer candles on
 * a loaded machine, and the assertion that followed ran too early.
 */
export async function waitForCandles(page: Page, count: number, timeout = 20_000) {
  const start = await replayIndex(page);
  await expect.poll(() => replayIndex(page), { timeout }).toBeGreaterThanOrEqual(start + count);
}

/** Set the replay speed from its menu (`1×`, `8×`, `32×`…). */
export async function setSpeed(page: Page, label: string) {
  await page.locator('[title="Vitesse de lecture"]').click();
  await page.locator('.tv-dropdown-item', { hasText: label }).first().click();
}

/** Start the replay at a UTC day, from the start-point menu. */
export async function startReplayAt(page: Page, isoDay: string) {
  await startReplay(page, 0.5);
  await page.locator('[title="Choisir le point de départ"]').click();
  await page.locator('.rp-date-form input[type="date"]').fill(isoDay);
  await page.locator('.rp-date-form button[type="submit"]').click();
  await expect(page.locator('.rp-date-badge')).toBeVisible();
}

/** Read a store from the page. */
export function stores<T>(page: Page, read: (s: Stores) => T): Promise<T> {
  return page.evaluate(`(${read.toString()})(window.__stores)`) as Promise<T>;
}

/**
 * A scripted daily series from 2023-01-02, flat at 1.1000 (±10 pips) except on
 * the days given: `{ 120: { low: 1.09, close: 1.092 } }` makes day 120 dip.
 * Later days hold the last close. For tests that need a price to be reached on
 * a known candle.
 */
export function scriptedCandles(
  events: Record<number, { open?: number; high?: number; low?: number; close: number }>,
  count = 300
) {
  const start = Date.UTC(2023, 0, 2) / 1000;
  const candles = [];
  let level = 1.1;
  for (let i = 0; i < count; i++) {
    const e = events[i];
    const open = e?.open ?? level;
    const close = e?.close ?? level;
    const high = e?.high ?? Math.max(open, close) + 0.001;
    const low = e?.low ?? Math.min(open, close) - 0.001;
    candles.push({ time: start + i * DAY, open, high, low, close, volume: 1_000 });
    level = close;
  }
  return candles;
}

/** UTC day of candle `index` in `scriptedCandles` / `makeCandles`. */
export function dayOf(index: number): string {
  return new Date((Date.UTC(2023, 0, 2) / 1000 + index * DAY) * 1000).toISOString().slice(0, 10);
}
