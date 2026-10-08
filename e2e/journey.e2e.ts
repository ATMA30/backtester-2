import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastToast, openApp, scrollPosition, setSpeed, startReplay, startReplayAt, waitForCandles } from './support';

const here = path.dirname(fileURLToPath(import.meta.url));
const MT4_EXPORT = path.join(here, 'fixtures', 'eurusd-m1-mt4.csv');

test.describe('arrivée', () => {
  test('le guide mène au replay et la provenance des données est affichée', async ({ page }) => {
    await openApp(page, { guide: true });

    const guide = page.getByRole('complementary', { name: 'Premiers pas' });
    await expect(guide).toBeVisible();
    await expect(guide.locator('.onboarding-step.is-current')).toContainText('Choisir un point de départ');
    await expect(page.locator('#status-text')).toContainText('Dukascopy');
  });
});

test.describe('import', () => {
  test('un export MT4 sans en-tête est lu colonne pour colonne', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Données' }).click();
    await page.getByRole('menuitem', { name: 'Importer un fichier' }).click();
    await page.setInputFiles('#file-hidden', MT4_EXPORT);

    // Aperçu interprété : la première bougie est gardée, les colonnes à leur place.
    await expect(page.locator('.import-note')).toContainText('sans ligne d’en-tête');
    const firstRow = page.locator('.import-preview tbody tr').first();
    await expect(firstRow.locator('td').nth(0)).toHaveText('2020-01-02 07:00');
    await expect(firstRow.locator('td').nth(1)).toHaveText('1.121');
    await expect(firstRow.locator('td').nth(4)).toHaveText('1.1208');

    await page.locator('#import-btn').click();
    await expect(page.locator('#rows-count')).toHaveText('300');
    await expect(page.locator('#status-text')).toHaveText('Fichier importé');
  });
});

test.describe('replay et moteur', () => {
  test('un achat paie le spread et les commissions', async ({ page }) => {
    await openApp(page);
    await startReplay(page);
    await page.locator('#btn-buy').click();

    // 1 lot EURUSD : 0,2 pip de spread (2 $) + 2 × 3,50 $ de commission.
    await expect(page.locator('#rp-pnl')).toHaveText('-$9.00');
    await expect(page.locator('.rp-costs-btn')).toContainText('0.2 p');
  });

  test('pas de trade sur une bougie déjà dépassée, pas de sortie avec une position', async ({ page }) => {
    await openApp(page);
    await startReplay(page);
    await page.locator('#btn-buy').click();
    await page.locator('#rp-step-fwd').click();
    await page.locator('#rp-step-fwd').click();
    await page.locator('#rp-step-back').click();

    await page.locator('#btn-close-pos').click();
    await expect(lastToast(page)).toContainText('déjà dépassée');
    await expect(page.locator('#btn-close-pos')).toBeVisible();

    await page.locator('#rp-exit').click();
    await expect(lastToast(page)).toContainText('Quitter le replay impossible');
    await expect(page.locator('#btn-buy')).toBeVisible();
  });

  test('le journal liste le trade clôturé avec ses frais', async ({ page }) => {
    await openApp(page);
    await startReplay(page);
    await page.locator('#btn-buy').click();
    await page.locator('#rp-step-fwd').click();
    await page.locator('#btn-close-pos').click();
    await page.locator('#btn-history').click();

    const journal = page.getByRole('dialog', { name: 'Journal de trades' });
    await expect(journal.locator('.th-trade-row')).toHaveCount(1);
    await expect(journal.locator('.th-trade-row')).toContainText('frais $');
    await expect(journal.locator('.th-disclaimer')).toContainText('Frais inclus');
  });
});

test.describe('défilement pendant la lecture', () => {
  test('reculer au trackpad reste dans l’historique, et un clic ramène au présent', async ({ page }) => {
    await openApp(page);
    // Loin de la fin : à 8×, un départ dans la vue visible épuisait la série.
    await startReplayAt(page, '2023-03-01');
    await setSpeed(page, '8×');
    await page.locator('#rp-play').click();
    await waitForCandles(page, 3);
    await expect.poll(() => scrollPosition(page)).toBeGreaterThan(3);

    // Une série de petits événements `wheel`, comme un glissé à deux doigts.
    const box = await page.locator('#chart-container').boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.4);
    for (let i = 0; i < 90; i++) {
      await page.mouse.wheel(-3, 0);
      await page.waitForTimeout(16);
    }
    // Des bougies arrivent pendant ce temps : la vue doit rester en arrière.
    await waitForCandles(page, 10);
    expect(await scrollPosition(page)).toBeLessThan(0);

    // De retour au présent, à la marge choisie en dernier (au moins 2 bougies),
    // et la vue suit de nouveau les bougies qui arrivent.
    await page.locator('.chart-follow-btn').click();
    await expect.poll(() => scrollPosition(page)).toBeGreaterThanOrEqual(2);
    await expect(page.locator('.chart-follow-btn')).toHaveCount(0);
    await waitForCandles(page, 10);
    expect(await scrollPosition(page)).toBeGreaterThanOrEqual(2);
  });
});

test.describe('marge à droite pendant la lecture', () => {
  /** Glisser horizontalement le graphique de `dx` pixels (négatif = vers la gauche). */
  async function drag(page: import('@playwright/test').Page, dx: number) {
    const box = await page.locator('#chart-container').boundingBox();
    const x = box!.x + box!.width * 0.5;
    const y = box!.y + box!.height * 0.45;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 12 });
    await page.mouse.up();
  }

  /** Largeur d'une bougie à l'écran, en pixels. */
  function barSpacing(page: import('@playwright/test').Page) {
    return page.evaluate(() =>
      (window as unknown as { __tvChart: { timeScale(): { options(): { barSpacing: number } } } }).__tvChart
        .timeScale()
        .options().barSpacing
    );
  }

  /** Glisser de `bars` bougies, lecture en pause pendant le geste (négatif = plus de marge). */
  async function dragBars(page: import('@playwright/test').Page, bars: number) {
    await page.locator('#rp-play').click();
    await drag(page, Math.round(bars * (await barSpacing(page))));
    await page.locator('#rp-play').click();
  }

  /** Replay lancé à 8×, quelques bougies déjà jouées. */
  async function playing(page: import('@playwright/test').Page) {
    await openApp(page);
    await startReplayAt(page, '2023-03-01');
    await setSpeed(page, '8×');
    await page.locator('#rp-play').click();
    await waitForCandles(page, 3);
  }

  test('la marge choisie en glissant est gardée pendant le défilement', async ({ page }) => {
    await playing(page);

    // Vers la gauche : plus de vide entre la dernière bougie et l'échelle.
    await dragBars(page, -8);
    await waitForCandles(page, 2);
    const chosen = await scrollPosition(page);
    expect(chosen).toBeGreaterThan(10);

    await waitForCandles(page, 15);
    // Toujours la même marge, quinze bougies ajoutées entre-temps.
    expect(Math.abs((await scrollPosition(page)) - chosen)).toBeLessThan(1.5);
    await expect(page.locator('.chart-follow-btn')).toHaveCount(0);
  });

  test('coller la bougie à l’échelle laisse quand même une marge minimale', async ({ page }) => {
    await playing(page);

    // Un recul jusqu'au bord : la dernière bougie reste à l'écran, contre l'échelle.
    await dragBars(page, (await scrollPosition(page)) - 1);
    await waitForCandles(page, 10);
    const position = await scrollPosition(page);
    expect(position).toBeGreaterThanOrEqual(2);
    expect(position).toBeLessThan(7);
    await expect(page.locator('.chart-follow-btn')).toHaveCount(0);
  });

  test('contre la marge minimale, une molette cran par cran passe dans l’historique', async ({ page }) => {
    await playing(page);
    // La bougie collée à l'échelle : suivi à la marge minimale.
    await dragBars(page, (await scrollPosition(page)) - 1);
    await waitForCandles(page, 5);
    // `scrollPosition` compte depuis la dernière bougie : la marge minimale
    // de 2 bougies s'y lit 3.
    await expect.poll(() => scrollPosition(page)).toBeLessThan(3.5);
    await expect(page.locator('.chart-follow-btn')).toHaveCount(0);

    // Des crans espacés de 350 ms : chacun est un geste à part, d'une fraction
    // de bougie. Ramenés un par un à la marge minimale, ils ne quittaient
    // jamais le présent. À 1×, aucune bougie n'arrive pendant un cran : seule
    // la règle de fin de geste décide.
    await setSpeed(page, '1×');
    const box = await page.locator('#chart-container').boundingBox();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.4);
    // (La bibliothèque regroupe les événements : un cran isolé peut ne rien
    // déplacer, d'où six crans.)
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(-10, 0);
      await page.waitForTimeout(350);
    }
    await expect(page.locator('.chart-follow-btn')).toBeVisible();
    // Et la vue ne suit plus : la dernière bougie reste hors de l'écran.
    await waitForCandles(page, 3);
    expect(await scrollPosition(page)).toBeLessThan(0);
  });

  test('pousser la dernière bougie hors de l’écran passe en lecture de l’historique', async ({ page }) => {
    await playing(page);

    // Bien au-delà du bord : la dernière bougie sort de l'écran.
    await dragBars(page, (await scrollPosition(page)) + 10);
    await waitForCandles(page, 10);
    expect(await scrollPosition(page)).toBeLessThan(0);
    await expect(page.locator('.chart-follow-btn')).toBeVisible();
  });
});

test.describe('mise en page', () => {
  for (const [width, positions] of [[1470, 1], [1180, 1], [1000, 1], [820, 1], [1180, 2], [820, 2]] as const) {
    test(`la barre de replay tient sans déborder à ${width} px avec ${positions} position(s)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 860 });
      await openApp(page);
      await startReplay(page);
      await page.locator('#btn-buy').click();
      // Deux positions : « Clôturer 50 % » laisse place au menu des positions.
      if (positions === 2) await page.locator('#btn-sell').click();

      const layout = await page.evaluate(() => {
        const bar = document.getElementById('replay-bar')!;
        const offscreen = [...bar.querySelectorAll('button, input')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
        }).length;
        return { overflow: bar.scrollWidth - bar.clientWidth, offscreen };
      });
      expect(layout.overflow).toBe(0);
      expect(layout.offscreen).toBe(0);
      // Le graphique s'arrête au-dessus de la barre flottante. La barre grandit
      // quand la position s'ouvre et le graphique suit une image plus tard
      // (ResizeObserver → `--replay-bar-h`) : on attend que ça se stabilise.
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.getElementById('replay-bar')!.getBoundingClientRect().top -
              document.getElementById('tv-chart')!.getBoundingClientRect().bottom
          )
        )
        .toBeGreaterThanOrEqual(0);
    });
  }
});

test.describe('accessibilité', () => {
  test('les menus se pilotent au clavier', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Données' }).click();
    const item = page.getByRole('menuitem', { name: 'Importer un fichier' });
    // Un vrai bouton : focusable et activable avec Entrée (c'était un `div`).
    await item.focus();
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Importer un fichier' })).toBeVisible();
  });

  test('une séance forex se coche au clavier', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Séances de marché' }).click();
    const tokyo = page.getByRole('checkbox', { name: /Tokyo/ });
    const before = await tokyo.isChecked();
    await tokyo.focus();
    await page.keyboard.press('Space');
    await expect(tokyo).toBeChecked({ checked: !before });
  });
});
