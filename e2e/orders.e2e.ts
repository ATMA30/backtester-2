import { expect, test } from '@playwright/test';
import { dayOf, openApp, scriptedCandles, setSpeed, startReplayAt, stores } from './support';

/**
 * Stops, targets and pending orders, on a series whose moves are known: flat at
 * 1.1000, a dip to 1.0900 on day 120 (then 1.0920), a spike to 1.1050 on day 130.
 */
const candles = scriptedCandles({
  120: { open: 1.1, low: 1.09, close: 1.092 },
  130: { open: 1.092, high: 1.105, close: 1.093 },
});

const closed = (page: import('@playwright/test').Page) =>
  stores(page, (s) => s.trade.getState().closedPositions.length);

test.describe('ordres pendant la lecture', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { candles });
    await startReplayAt(page, dayOf(100));
  });

  test('le stop d’un achat se déclenche sur la bougie qui l’atteint', async ({ page }) => {
    await page.locator('#trade-sl').fill('50p');
    await page.locator('#btn-buy').click();
    await setSpeed(page, '32×');
    await page.locator('#rp-play').click();
    await expect.poll(() => closed(page), { timeout: 20_000 }).toBe(1);
    await page.locator('#rp-play').click();

    await page.locator('#btn-history').click();
    const row = page.locator('.th-trade').first();
    await expect(row).toContainText('stop');
    // Sortie au stop, 1.0950 : la bougie ouvre à 1.1000, au-dessus.
    await expect(row).toContainText('→ 1.09500');
    await expect(row.locator('.th-trade-pnl')).toHaveText(/^-\$/);
  });

  test('un achat limite attend son prix, puis devient une position', async ({ page }) => {
    await page.locator('#trade-entry').fill('1.0950');
    await page.locator('#btn-buy').click();
    await expect(page.locator('.rp-pending-orders-btn')).toContainText('1 en attente');
    expect(await stores(page, (s) => s.trade.getState().openPositions.length)).toBe(0);

    await setSpeed(page, '32×');
    await page.locator('#rp-play').click();
    await expect
      .poll(() => stores(page, (s) => s.trade.getState().openPositions.length), { timeout: 20_000 })
      .toBe(1);
    await page.locator('#rp-play').click();
    await expect(page.locator('.rp-pending-orders-btn')).toHaveCount(0);
    const entry = await stores(page, (s) => (s.trade.getState().openPositions[0] as { entry: number }).entry);
    expect(entry).toBeCloseTo(1.095, 6);
  });

  test('l’objectif d’un achat se déclenche au pic', async ({ page }) => {
    // Après le creux : entrée vers 1.0920, objectif 100 pips plus haut.
    await page.locator('[title="Choisir le point de départ"]').click();
    await page.locator('.rp-date-form input[type="date"]').fill(dayOf(122));
    await page.locator('.rp-date-form button[type="submit"]').click();
    await page.locator('#trade-tp').fill('100p');
    await page.locator('#btn-buy').click();
    await setSpeed(page, '32×');
    await page.locator('#rp-play').click();
    await expect.poll(() => closed(page), { timeout: 20_000 }).toBe(1);
    await page.locator('#rp-play').click();

    await page.locator('#btn-history').click();
    await expect(page.locator('.th-trade').first()).toContainText('objectif');
    await expect(page.locator('.th-trade-pnl').first()).toHaveText(/^\+\$/);
  });
});
