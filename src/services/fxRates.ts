import { fetchJson } from './http';
import { hasUsdRates, registerUsdRates } from '../domain/fx-rates';
import { getAccountCurrency, quoteCurrencyOf } from '../domain/instruments';

/** Loads in flight, so two quick symbol changes share one download. */
const inFlight = new Map<string, Promise<boolean>>();

/**
 * Load the ECB history of `currency` against USD into the conversion registry.
 * Resolves `false` when the ECB does not publish it or the request fails: the
 * conversion then keeps the reference table, as before.
 */
export function ensureUsdRates(currency: string): Promise<boolean> {
  const code = currency.toUpperCase();
  if (code === 'USD' || hasUsdRates(code)) return Promise.resolve(true);
  const pending = inFlight.get(code);
  if (pending) return pending;

  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({ from: 'USD', to: code });
  const load = fetchJson<{ rates?: Record<string, Record<string, number>> }>(
    `https://api.frankfurter.dev/v1/1999-01-01..${today}?${params}`,
    { timeoutMs: 8_000 }
  )
    .then((data) => {
      const points: [number, number][] = [];
      for (const [day, row] of Object.entries(data?.rates ?? {})) {
        const perUsd = Number(row?.[code]);
        // The ECB quotes units of `code` per dollar; we store dollars per unit.
        if (Number.isFinite(perUsd) && perUsd > 0) points.push([Date.parse(`${day}T00:00:00Z`) / 1000, 1 / perUsd]);
      }
      registerUsdRates(code, points);
      return hasUsdRates(code);
    })
    .catch((error) => {
      console.warn(`[fxRates] ECB rates unavailable for ${code}, keeping the reference table:`, error);
      return false;
    })
    .finally(() => inFlight.delete(code));

  inFlight.set(code, load);
  return load;
}

/**
 * Prepare the conversion of `symbol`'s P&L into the account currency.
 *
 * Only the legs the pair cannot price by itself need a series: EURUSD converts
 * to a EUR or USD account with its own price, EURGBP to a EUR account too, but
 * EURGBP to a USD account needs GBP, and USDJPY to a EUR account needs EUR.
 */
export function prepareConversionFor(symbol: string): Promise<boolean> {
  const pair = (symbol || '').trim().toUpperCase();
  const quote = quoteCurrencyOf(pair) ?? 'USD';
  const account = getAccountCurrency();
  const isPair = quoteCurrencyOf(pair) !== null;
  const base = isPair ? pair.slice(0, 3) : null;
  if (quote === account || base === account) return Promise.resolve(true);

  const pricedByPair = (currency: string) =>
    isPair && ((base === currency && quote === 'USD') || (base === 'USD' && quote === currency));
  const needed = [quote, account].filter((c) => c !== 'USD' && !pricedByPair(c));
  return Promise.all(needed.map(ensureUsdRates)).then((loaded) => loaded.every(Boolean));
}
