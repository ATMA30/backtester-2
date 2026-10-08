import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockMarket, startReplay } from './support';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The policy exactly as Netlify serves it, so the test cannot drift from it. */
function productionCsp(): string {
  const toml = readFileSync(path.join(here, '..', 'netlify.toml'), 'utf8');
  const match = toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('no Content-Security-Policy in netlify.toml');
  return match[1];
}

test('le build de production tourne sous la CSP de Netlify sans aucune violation', async ({ page }) => {
  const csp = productionCsp();
  expect(csp).not.toContain("'unsafe-inline'");

  await page.addInitScript(() => {
    localStorage.setItem('onboarding-dismissed-v1', '1');
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__cspViolations.push(`${e.effectiveDirective} ← ${e.blockedURI || 'inline'} ${e.sample}`);
    });
  });
  await mockMarket(page);
  // Google Fonts are third-party: the policy allows them, the test does not need them.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  // Serve every document with the production policy.
  await page.route(
    (url) => !url.pathname.startsWith('/api/') && !/\.\w+$/.test(url.pathname),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    }
  );

  await page.goto('/');
  await expect(page.locator('#rows-count')).toHaveText(/\d/, { timeout: 30_000 });

  // The chart, its attribution logo, a menu, a dialog and the replay bar: every
  // part of the UI that sets styles.
  await expect(page.locator('#tv-attr-logo')).toHaveCSS('position', 'absolute');
  await page.getByRole('button', { name: 'Données' }).click();
  await page.getByRole('menuitem', { name: 'Importer un fichier' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await startReplay(page);
  await page.locator('#btn-buy').click();
  await expect(page.locator('#rp-pnl')).toBeVisible();

  const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
  expect(violations).toEqual([]);
});
