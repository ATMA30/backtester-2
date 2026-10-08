import { expect, test } from '@playwright/test';
import { openApp, startReplay } from './support';

test.describe('journal de trading', () => {
  test('une clôture capture le graphique, le trade s’annote et se filtre', async ({ page }) => {
    await openApp(page);
    await startReplay(page);
    await page.locator('#btn-buy').click();
    await page.locator('#rp-step-fwd').click();
    await page.locator('#btn-close-pos').click();
    await page.locator('#btn-sell').click();
    await page.locator('#rp-step-fwd').click();
    await page.locator('#btn-close-pos').click();

    await page.locator('#btn-history').click();
    const trades = page.locator('.th-trade');
    await expect(trades).toHaveCount(2);

    // La vente, la plus récente, est en tête : on la qualifie.
    const sale = trades.first();
    await sale.locator('.th-trade-row').click();
    await expect(sale.locator('.trade-capture-thumb img')).toBeVisible();
    await sale.getByLabel('Setup').fill('cassure de range');
    await sale.getByRole('radio', { name: 'hésitant' }).click();
    await sale.getByLabel('Note').fill('Entrée avant la clôture de la bougie.');
    await sale.getByLabel('Note').blur();
    // Saisir le setup puis cliquer une émotion : le clic ne doit pas se perdre.
    await expect(sale.getByRole('radio', { name: 'hésitant' })).toHaveAttribute('aria-checked', 'true');
    await sale.locator('.th-trade-row').click();
    await expect(sale.locator('.th-trade-setup')).toHaveText('cassure de range');

    // Filtre par setup : la sélection a ses propres statistiques.
    await page.locator('.journal-filters select').selectOption('cassure de range');
    await expect(trades).toHaveCount(1);
    await expect(page.locator('.journal-filter-summary')).toContainText('1 trade sur 2');
    await page.getByRole('radio', { name: 'Achats' }).click();
    await expect(page.locator('.th-empty')).toHaveText('Aucun trade ne correspond à ces filtres.');
    await page.getByRole('button', { name: 'Tout afficher' }).click();
    await expect(trades).toHaveCount(2);

    // Agrandir la capture, hors du panneau.
    await sale.locator('.th-trade-row').click();
    await sale.locator('.trade-capture-thumb').click();
    const viewer = page.getByRole('dialog', { name: 'Capture du graphique' });
    await expect(viewer).toBeVisible();
    const box = await viewer.boundingBox();
    expect(box?.width).toBeGreaterThan(1000);
  });
});
