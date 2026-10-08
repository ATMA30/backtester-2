import { expect, test } from '@playwright/test';
import { openApp, startReplay } from './support';

test.describe('plusieurs positions', () => {
  test('achat et vente cohabitent, chacune se gère depuis le menu des positions', async ({ page }) => {
    await openApp(page);
    await startReplay(page);
    await page.locator('#btn-buy').click();
    await expect(page.locator('#btn-close-pos')).toHaveText('Fermer');

    await page.locator('#btn-sell').click();
    // Plus d'action ambiguë : « Clôturer 50 % » cède la place au menu.
    await expect(page.locator('#btn-scale-50')).toHaveCount(0);
    await expect(page.locator('#btn-close-pos')).toHaveText('Tout fermer');
    await page.locator('#btn-positions').click();
    const rows = page.locator('.rp-position-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Achat');
    await expect(rows.nth(1)).toContainText('Vente');

    // Fermer la vente seule : la barre revient aux boutons directs.
    await rows.nth(1).getByRole('button', { name: 'Fermer' }).click();
    await expect(page.locator('#btn-scale-50')).toBeVisible();
    await page.locator('#btn-close-pos').click();
    await expect(page.locator('#btn-close-pos')).toHaveCount(0);

    await page.locator('#btn-history').click();
    await expect(page.locator('.th-trade-pnl')).toHaveCount(2);
  });
});

test.describe('devise du compte', () => {
  test('un compte en euros affiche et comptabilise en euros', async ({ page }) => {
    await openApp(page);
    await startReplay(page);
    await page.locator('.rp-account-btn').click();
    await page.getByRole('radio', { name: /EUR/ }).click();
    await expect(page.locator('#rp-balance')).toHaveText('€10,000.00');

    await page.locator('#btn-buy').click();
    await expect(page.locator('#rp-pnl')).toHaveText(/^-€\d/);
  });

  test('changer de devise avec un journal demande confirmation', async ({ page }) => {
    await openApp(page);
    await startReplay(page);
    await page.locator('#btn-buy').click();
    await page.locator('#btn-close-pos').click();

    await page.locator('.rp-account-btn').click();
    await page.getByRole('radio', { name: /EUR/ }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Confirmer le changement de devise' });
    await expect(confirm).toContainText('1 trade(s) au journal');
    await confirm.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.locator('#rp-balance')).toContainText('$');

    await page.getByRole('radio', { name: /EUR/ }).click();
    await page.getByRole('button', { name: 'Passer en EUR' }).click();
    await expect(page.locator('#rp-balance')).toHaveText('€10,000.00');
    await page.locator('#btn-history').click();
    await expect(page.locator('.th-trade-pnl')).toHaveCount(0);
  });
});
