/**
 * Computed styles of every element across 29 views of the app, on a mocked
 * market feed — the proof that a CSS or component refactor changes nothing.
 *
 *   npm run dev -- --port 5197          # in another terminal
 *   node scripts/ui-snapshot.mjs before.json
 *   …refactor…
 *   node scripts/ui-snapshot.mjs after.json
 *   node scripts/ui-snapshot.mjs --compare before.json after.json
 *
 * Deterministic by construction: animations off, pointer parked where nothing
 * reacts to hover, `useId()` ids left out of element paths, captures (loaded
 * asynchronously) skipped, and each view taken once the DOM stops changing.
 * Two runs of the same code must give 0 differences before any comparison
 * means anything.
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === '--compare') {
  const [a, b] = [process.argv[3], process.argv[4]].map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const PROPS_ = ['display', 'position', 'color', 'background-color', 'background-image', 'font-size', 'font-weight', 'font-family', 'gap', 'padding', 'margin', 'width', 'height', 'align-items', 'justify-content', 'flex-direction', 'flex-wrap', 'grid-template-columns', 'border', 'border-radius', 'cursor', 'opacity', 'overflow', 'white-space', 'text-align', 'text-transform', 'z-index', 'min-width', 'max-width', 'max-height', 'box-shadow', 'letter-spacing', 'line-height', 'top', 'bottom', 'left', 'right', 'transform', 'visibility', 'outline'];
  let total = 0;
  for (const view of Object.keys(a)) {
    const va = a[view];
    const vb = b[view] ?? {};
    const diffs = [];
    for (const key of new Set([...Object.keys(va), ...Object.keys(vb)])) {
      if (va[key] === vb[key]) continue;
      if (!(key in va) || !(key in vb)) { diffs.push(`${key.slice(-100)} | presence`); continue; }
      const pa = va[key].split('|');
      const pb = vb[key].split('|');
      pa.forEach((x, i) => { if (x !== pb[i]) diffs.push(`${key.slice(-100)} | ${PROPS_[i]}: ${x} -> ${pb[i]}`); });
    }
    total += diffs.length;
    if (diffs.length) console.log(`${view}: ${diffs.length}\n  ${diffs.slice(0, 8).join('\n  ')}`);
  }
  console.log('TOTAL', total);
  process.exit(total === 0 ? 0 : 1);
}

const PROPS = ['display', 'position', 'color', 'background-color', 'background-image', 'font-size', 'font-weight', 'font-family', 'gap', 'padding', 'margin', 'width', 'height', 'align-items', 'justify-content', 'flex-direction', 'flex-wrap', 'grid-template-columns', 'border', 'border-radius', 'cursor', 'opacity', 'overflow', 'white-space', 'text-align', 'text-transform', 'z-index', 'min-width', 'max-width', 'max-height', 'box-shadow', 'letter-spacing', 'line-height', 'top', 'bottom', 'left', 'right', 'transform', 'visibility', 'outline'];

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const candles = []; let p = 1.1;
for (let i = 0; i < 400; i++) { const o = p; const c = o + (rnd() - 0.5) * 0.004; candles.push({ time: 1672617600 + i * 3600, open: +o.toFixed(5), high: +(Math.max(o, c) + rnd() * 0.001).toFixed(5), low: +(Math.min(o, c) - rnd() * 0.001).toFixed(5), close: +c.toFixed(5), volume: 1000 }); p = c; }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1470, height: 860 } });
await page.route('**/api/history**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'dukascopy', candles }) }));
for (const host of ['**/api.frankfurter.dev/**', '**/api.binance.com/**', '**/ws.derivws.com/**', /fonts\.(googleapis|gstatic)\.com/]) await page.route(host, (r) => r.abort());
await page.addInitScript(() => {
  if (!sessionStorage.getItem('seeded')) {
    localStorage.clear();
    sessionStorage.setItem('seeded', '1');
    indexedDB.deleteDatabase('tv_pro_db');
  }
  // Freeze animations and transitions: the snapshot must not depend on timing.
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.head.appendChild(s);
  });
});
await page.goto('http://localhost:5197/');
await page.waitForSelector('#rows-count');
await page.waitForTimeout(1500);

const snaps = {};
const snap = async (name, { keepPointer = false } = {}) => {
  // Park the pointer where nothing reacts to hover.
  if (!keepPointer) await page.mouse.move(1465, 855);
  // Wait for the DOM to settle: lazy dialogs and lists render in several passes.
  let previous = -1;
  for (let k = 0; k < 20; k++) {
    await page.waitForTimeout(250);
    const count = await page.evaluate(() => document.body.getElementsByTagName('*').length);
    if (count === previous) break;
    previous = count;
  }
  snaps[name] = await page.evaluate((PROPS) => {
    const out = {};
    // Toasts come and go, the chart is a canvas, captures load asynchronously.
    const skip = (el) => el.closest('#toast-container') || el.closest('.tv-lightweight-charts') || el.closest('.trade-capture');
    // `useId()` ids (`_r_4_`) change from run to run: they are not part of a path.
    const stableId = (n) => (n.id && !/^_r_|^:r/.test(n.id) ? '#' + n.id : '');
    const pathOf = (el) => { const parts = []; for (let n = el; n && n !== document.body; n = n.parentElement) { const i = n.parentElement ? [...n.parentElement.children].indexOf(n) : 0; parts.unshift(`${n.tagName.toLowerCase()}${stableId(n)}:${i}`); } return parts.join('>'); };
    for (const el of document.body.querySelectorAll('*')) {
      if (skip(el)) continue;
      const cs = getComputedStyle(el);
      out[pathOf(el)] = PROPS.map((q) => cs.getPropertyValue(q)).join('|');
    }
    return out;
  }, PROPS);
};
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };
const away = async () => { await page.mouse.click(700, 300); await page.waitForTimeout(250); };

await snap('first-run');
await page.getByRole('button', { name: /Masquer|Fermer le guide|Plus tard/ }).first().click().catch(() => {});
await page.evaluate(() => localStorage.setItem('onboarding-dismissed-v1', '1'));
await snap('main');
for (const [name, sel] of [['m-sep', '#btn-sep'], ['m-forex', '#btn-forex'], ['m-more', '#btn-more'], ['m-tf', '#btn-active-tf'], ['m-ctype', '#btn-active-ctype'], ['m-ind', '#btn-indicators'], ['m-data', '#upload-btn']]) {
  await page.locator(sel).click(); await snap(name); await away();
}
await page.getByRole('button', { name: 'Données' }).click();
await page.getByRole('menuitem', { name: 'Importer un fichier' }).click();
await page.setInputFiles('#file-hidden', fileURLToPath(new URL('../e2e/fixtures/eurusd-m1-mt4.csv', import.meta.url)));
await page.waitForSelector('.import-preview');
await snap('import'); await esc();
await page.getByTitle('Choisir l’instrument et la source de données').click(); await page.locator('#live-modal').waitFor(); await snap('live'); await esc();
await page.getByTitle('Sauvegardes et jeux de données').click(); await page.locator('#datasets-modal').waitFor(); await snap('datasets'); await esc();
await page.keyboard.press('?'); await page.locator('#shortcuts-overlay').waitFor(); await snap('shortcuts'); await esc();
await page.locator('#btn-indicators').click();
await page.locator('.tv-dropdown-item', { hasText: 'EMA' }).first().click();
await page.locator('#indicator-modal').waitFor();
await snap('indicator-config'); await esc();

// Drawings: a rectangle, then a long position, each selected with its toolbar.
{
  const c = await page.locator('#chart-container').boundingBox();
  await page.keyboard.press('5');
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.3); await page.mouse.down();
  await page.mouse.move(c.x + c.width * 0.4, c.y + c.height * 0.45, { steps: 6 }); await page.mouse.up();
  // Select it by its top edge.
  await page.mouse.click(c.x + c.width * 0.35, c.y + c.height * 0.3);
  await page.locator('#drawing-floating-toolbar').waitFor();
  await snap('drawing-selected');
  await page.keyboard.press('9');
  await page.mouse.click(c.x + c.width * 0.6, c.y + c.height * 0.5);
  await page.waitForTimeout(300);
  // Select it by its body if placing it did not.
  if (!(await page.locator('#drawing-floating-toolbar').count())) await page.mouse.click(c.x + c.width * 0.61, c.y + c.height * 0.49);
  await page.locator('#drawing-floating-toolbar').waitFor();
  await snap('position-drawing-selected');
  await page.keyboard.press('Escape');
}
await page.getByRole('button', { name: 'Rejouer' }).click();
const box = await page.locator('#chart-container').boundingBox();
// Picking the start: the tooltip follows the pointer over the chart.
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 3 });
await page.getByText(/Démarrer ici/).waitFor();
await snap('picking', { keepPointer: true });
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
await page.waitForSelector('#btn-buy');
await snap('replay');
await page.locator('[title="Choisir le point de départ"]').click(); await snap('rp-anchor'); await away();
await page.locator('[title="Vitesse de lecture"]').click(); await snap('rp-speed'); await away();
await page.locator('.rp-costs-btn').click(); await snap('costs'); await away();
await page.locator('.rp-account-btn').click(); await snap('account'); await away();
await page.locator('#trade-sl').fill('20p');
await page.locator('#btn-buy').click(); await snap('position');
await page.locator('#btn-sell').click();
await page.locator('#btn-positions').click(); await snap('positions'); await away();
await page.locator('#btn-close-pos').click();
await page.locator('#btn-close-pos').waitFor({ state: 'detached' });
await page.locator('#btn-history').click();
await page.locator('.th-trade').nth(1).waitFor();
await snap('journal');
await page.locator('.th-trade-row').first().click(); await snap('journal-open');
await page.locator('.journal-filters select').selectOption({ index: 1 }).catch(() => {});
await page.getByRole('radio', { name: 'Achats' }).click(); await snap('journal-filtered');
await page.keyboard.press('Escape');
// A saved session: its card is the densest block of the saves dialog.
await page.getByTitle('Sauvegardes et jeux de données').click();
await page.locator('#datasets-modal').waitFor();
await page.getByRole('button', { name: 'Enregistrer maintenant' }).click();
await page.getByPlaceholder(/Nommez cette session/).fill('Test snapshot');
await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
await page.getByText('Test snapshot', { exact: true }).waitFor();
await snap('datasets-session');
await page.keyboard.press('Escape');
// A pending order, far below the market: the orders menu lists it.
const bid = await page.evaluate(() => Number(document.getElementById('ticker-price')?.textContent));
await page.locator('#trade-sl').fill('');
await page.locator('#trade-entry').fill((bid * 0.98).toFixed(5));
await page.locator('#btn-buy').click();
await page.locator('.rp-pending-orders-btn').click();
await snap('rp-orders');

writeFileSync(process.argv[2], JSON.stringify(snaps));
console.log(Object.keys(snaps).length, 'views', Object.values(snaps).reduce((n, v) => n + Object.keys(v).length, 0), 'elements');
await browser.close();
