import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { makeCandles, openApp, replayIndex, startReplay, stores } from './support';

const drawingCount = (page: import('@playwright/test').Page) =>
  stores(page, (s) => s.drawing.getState().drawings.length);

/** A point of the chart, as fractions of its size. */
async function at(page: import('@playwright/test').Page, fx: number, fy: number): Promise<[number, number]> {
  const box = (await page.locator('#chart-container').boundingBox())!;
  return [box.x + box.width * fx, box.y + box.height * fy];
}

test.describe('tracés', () => {
  test('une ligne se trace, s’annule, se rétablit, se supprime, et persiste au rechargement', async ({ page }) => {
    await openApp(page);
    await page.keyboard.press('2');
    await page.mouse.click(...(await at(page, 0.2, 0.3)));
    await page.mouse.click(...(await at(page, 0.4, 0.5)));
    await expect.poll(() => drawingCount(page)).toBe(1);

    await page.keyboard.press('Control+z');
    await expect.poll(() => drawingCount(page)).toBe(0);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => drawingCount(page)).toBe(1);

    // Sélection par son milieu, puis Suppr.
    await page.keyboard.press('1');
    await page.mouse.click(...(await at(page, 0.3, 0.4)));
    await expect(page.locator('#drawing-floating-toolbar')).toBeVisible();
    await page.keyboard.press('Delete');
    await expect.poll(() => drawingCount(page)).toBe(0);

    // Un rectangle, gardé après rechargement.
    await page.keyboard.press('5');
    const [x, y] = await at(page, 0.55, 0.25);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 120, y + 80, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => drawingCount(page)).toBe(1);
    // L'écriture dans localStorage est regroupée : attendre qu'elle ait eu lieu.
    await expect
      .poll(() => page.evaluate(() => (localStorage.getItem('tv_pro_drawings') ?? '').includes('"rect"')))
      .toBe(true);
    await page.reload();
    await expect(page.locator('#rows-count')).toHaveText(/\d/, { timeout: 30_000 });
    await expect.poll(() => drawingCount(page)).toBe(1);
  });
});

test.describe('indicateurs', () => {
  test('une EMA s’ajoute depuis sa boîte de réglage, puis se retire', async ({ page }) => {
    await openApp(page);
    await page.locator('#btn-indicators').click();
    await page.locator('.tv-dropdown-item', { hasText: 'Moyenne Mobile Exponentielle' }).click();
    await expect(page.locator('#indicator-modal')).toBeVisible();
    await page.getByRole('button', { name: 'Ajouter l’indicateur' }).click();
    await expect(page.locator('#indicator-modal')).toHaveCount(0);

    await page.locator('#btn-indicators').click();
    const active = page.locator('#active-indicators-list');
    await expect(active).toContainText('EMA (');
    await expect(page.locator('#btn-indicators')).toContainText('1');
    await active.getByTitle('Retirer cet indicateur').click();
    await expect(active).toContainText('Aucun indicateur actif');
  });
});

test.describe('unités de temps', () => {
  // 600 bougies horaires à partir d'un lundi minuit : 150 bougies de 4 h.
  const hourly = makeCandles(600).map((c, i) => ({ ...c, time: Date.UTC(2023, 0, 2) / 1000 + i * 3_600 }));

  test('passer en 4 h agrège les bougies chargées, revenir en 1 h les rend', async ({ page }) => {
    await openApp(page, { candles: hourly });
    await expect(page.locator('#rows-count')).toHaveText('600');
    await page.locator('#btn-active-tf').click();
    await page.locator('.tf-option', { hasText: /^4h/ }).click();
    await expect(page.locator('#rows-count')).toHaveText('150');
    await expect(page.locator('#btn-active-tf')).toContainText('4h');

    await page.locator('#btn-active-tf').click();
    await page.locator('.tf-option', { hasText: /^1h/ }).click();
    await expect(page.locator('#rows-count')).toHaveText('600');
  });

  test('en replay, changer d’unité garde le curseur', async ({ page }) => {
    await openApp(page, { candles: hourly });
    await startReplay(page, 0.5);
    const cursor = await replayIndex(page);
    await page.locator('#btn-active-tf').click();
    await page.locator('.tf-option', { hasText: /^4h/ }).click();
    await expect(page.locator('#btn-active-tf')).toContainText('4h');
    expect(await replayIndex(page)).toBe(cursor);
    // Rien au-delà du curseur : la dernière bougie 4 h contient la bougie du curseur.
    await expect(page.locator('#rows-count')).toHaveText(String(Math.floor(cursor / 4) + 1));
  });
});

test.describe('clavier', () => {
  test('Espace lance et arrête la lecture, les flèches avancent et reculent d’une bougie', async ({ page }) => {
    await openApp(page);
    await startReplay(page, 0.4);
    const start = await replayIndex(page);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => replayIndex(page)).toBe(start + 2);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => replayIndex(page)).toBe(start + 1);

    await page.keyboard.press(' ');
    await expect(page.locator('#rp-play')).toHaveClass(/playing/);
    await page.keyboard.press(' ');
    await expect(page.locator('#rp-play')).not.toHaveClass(/playing/);
  });

  test('Échap annule le choix du départ, ? ouvre les raccourcis', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Rejouer' }).click();
    await expect(page.locator('#replay-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#replay-hint')).toHaveCount(0);

    await page.keyboard.press('?');
    await expect(page.locator('#shortcuts-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcuts-overlay')).toHaveCount(0);
  });
});

test.describe('export du journal', () => {
  test('le CSV contient les annotations, et une formule y reste du texte', async ({ page }, testInfo) => {
    await openApp(page);
    await startReplay(page);
    await page.locator('#btn-buy').click();
    await page.locator('#rp-step-fwd').click();
    await page.locator('#btn-close-pos').click();
    await page.locator('#btn-history').click();
    await page.locator('.th-trade-row').first().click();
    await page.getByPlaceholder('cassure, retour sur zone…').fill('cassure');
    await page.getByRole('radio', { name: 'calme' }).click();
    await page.getByLabel('Note').fill('=HYPERLINK("https://evil.test","clic")');
    await page.getByLabel('Note').blur();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter le journal en CSV' }).click();
    const file = testInfo.outputPath('journal.csv');
    await (await download).saveAs(file);
    const [header, row] = readFileSync(file, 'utf8').split('\n');

    expect(header).toBe(
      'id,symbol,type,entry,exit,lots,open_time_utc,close_time_utc,pnl_usd,fees_usd,r_multiple,close_reason,setup,emotion,note'
    );
    expect(row).toContain('"cassure","calme"');
    // Apostrophe en tête : le tableur l'affiche comme du texte.
    expect(row).toContain(`"'=HYPERLINK(""https://evil.test"",""clic"")"`);
    // Les montants restent des nombres (une perte ne devient pas « '-9.00 »).
    expect(row).toMatch(/,-\d+(\.\d+)?,/);
  });
});
