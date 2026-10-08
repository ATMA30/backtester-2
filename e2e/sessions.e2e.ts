import { expect, test } from '@playwright/test';
import { openApp, startReplay, stores } from './support';

/** Open the saves dialog and save the current state under `name`. */
async function saveSession(page: import('@playwright/test').Page, name: string) {
  await page.getByTitle('Sauvegardes et jeux de données').click();
  // The dialog loads on demand, its list from IndexedDB: wait for either
  // button (empty state or toolbar) rather than test for one too early.
  await page
    .getByRole('button', { name: 'Enregistrer maintenant' })
    .or(page.getByRole('button', { name: 'Enregistrer la session' }))
    .click();
  await page.getByPlaceholder(/Nommez cette session/).fill(name);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}

/** A euro account with an annotated closed trade and two open positions. */
async function buildAccount(page: import('@playwright/test').Page) {
  await openApp(page);
  await startReplay(page);
  await page.locator('.rp-account-btn').click();
  await page.getByRole('radio', { name: /EUR/ }).click();
  await page.locator('#btn-buy').click();
  await page.locator('#rp-step-fwd').click();
  await page.locator('#btn-close-pos').click();
  await page.locator('#btn-history').click();
  await page.locator('.th-trade-row').first().click();
  await page.getByPlaceholder('cassure, retour sur zone…').fill('cassure');
  await page.getByPlaceholder('cassure, retour sur zone…').blur();
  await page.keyboard.press('Escape');
  await page.locator('#btn-buy').click();
  await page.locator('#btn-sell').click();
}

test.describe('sessions sauvegardées', () => {
  test('une session survit au rechargement de la page et se reprend telle quelle', async ({ page }) => {
    await buildAccount(page);
    await saveSession(page, 'Revue EUR');
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.locator('#rows-count')).toHaveText(/\d/, { timeout: 30_000 });
    // Le compte vit en mémoire : rien ne reste avant la reprise.
    expect(await stores(page, (s) => s.trade.getState().openPositions.length)).toBe(0);

    await page.getByTitle('Sauvegardes et jeux de données').click();
    await page.getByRole('button', { name: 'Reprendre' }).click();

    await expect(page.locator('#rp-balance')).toContainText('€');
    await expect(page.locator('#btn-positions')).toContainText('2 positions');
    await page.locator('#btn-history').click();
    await expect(page.locator('.th-trade-setup')).toHaveText('cassure');
  });

  test('une session exportée se réimporte, indépendante de l’originale', async ({ page }, testInfo) => {
    await buildAccount(page);
    await saveSession(page, 'À partager');

    const download = page.waitForEvent('download');
    await page.getByTitle('Exporter cette sauvegarde').click();
    const file = testInfo.outputPath('session.json');
    await (await download).saveAs(file);
    await expect(page.locator('.toast-msg').last()).toContainText('notes de journal');

    await page.getByTitle('Supprimer cette sauvegarde').click();
    await expect(page.getByText('À partager', { exact: true })).toHaveCount(0);

    await page.locator('#datasets-modal input[type="file"]').setInputFiles(file);
    await expect(page.getByText('À partager', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Reprendre' }).click();

    // Le contenu revient, sous de nouveaux identifiants.
    const ids = await stores(page, (s) => s.trade.getState().openPositions.map((p) => (p as { id: string }).id));
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    await page.locator('#btn-history').click();
    await expect(page.locator('.th-trade-setup')).toHaveText('cassure');
  });
});
