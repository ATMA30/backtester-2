import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney, quoteToAccountRate, setAccountCurrency } from './instruments';
import { registerUsdRates, resetFxRates } from './fx-rates';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

describe('quoteToAccountRate — account not in USD', () => {
  afterEach(() => {
    setAccountCurrency('USD');
    resetFxRates();
  });

  it('prices exactly with the pair itself when it links the two currencies', () => {
    setAccountCurrency('EUR');
    // EURUSD: a dollar is worth 1 / price euros.
    expect(quoteToAccountRate('EURUSD', 1.25)).toBeCloseTo(0.8, 12);
    // EURGBP: quote GBP, base is the account → 1 / price.
    expect(quoteToAccountRate('EURGBP', 0.8)).toBeCloseTo(1.25, 12);
    // EURJPY on a JPY account: already in the account currency.
    setAccountCurrency('JPY');
    expect(quoteToAccountRate('EURJPY', 160)).toBe(1);
  });

  it('goes through the dollar with the ECB rate of the day for the other leg', () => {
    registerUsdRates('EUR', [[day('2022-09-27'), 0.96], [day('2024-07-16'), 1.09]]);
    setAccountCurrency('EUR');
    // USDJPY: the yen leg comes from the pair (1 / 150 $), the euro leg from the ECB.
    expect(quoteToAccountRate('USDJPY', 150, day('2022-09-28'))).toBeCloseTo(1 / 150 / 0.96, 12);
    // Gold is quoted in dollars.
    expect(quoteToAccountRate('XAUUSD', 2400, day('2024-07-20'))).toBeCloseTo(1 / 1.09, 12);
  });

  it('falls back on the reference table without an ECB series', () => {
    setAccountCurrency('GBP');
    expect(quoteToAccountRate('BTCUSDT', 60_000)).toBeCloseTo(1 / 1.27, 12);
  });
});

describe('formatMoney', () => {
  afterEach(() => setAccountCurrency('USD'));

  it('writes the account currency', () => {
    setAccountCurrency('EUR');
    expect(formatMoney(-12.3)).toBe('-€12.30');
    setAccountCurrency('JPY');
    expect(formatMoney(1234.5, { signed: true })).toBe('+¥1,234.50');
    setAccountCurrency('CHF');
    expect(formatMoney(5)).toBe('CHF\u00a05.00');
  });

  it('writes another account’s currency when asked (a saved session)', () => {
    setAccountCurrency('USD');
    expect(formatMoney(-3.5, { currency: 'EUR' })).toBe('-€3.50');
    expect(formatMoney(3.5, { signed: true, currency: 'GBP' })).toBe('+£3.50');
  });
});
