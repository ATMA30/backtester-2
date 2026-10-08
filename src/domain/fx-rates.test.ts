import { afterEach, describe, expect, it } from 'vitest';
import { registerUsdRates, resetFxRates, setConversionClock, usdPerUnitAt } from './fx-rates';
import { quoteToAccountRate } from './instruments';
import { computePnl } from './position-sizing';

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;

describe('fx-rates', () => {
  afterEach(() => resetFxRates());

  it('converts a cross at the rate of the candle’s own day', () => {
    registerUsdRates('GBP', [[day('2022-09-26'), 1.07], [day('2024-07-15'), 1.3]]);
    expect(quoteToAccountRate('EURGBP', 0.86, day('2022-09-27'))).toBe(1.07);
    expect(quoteToAccountRate('EURGBP', 0.86, day('2024-07-16'))).toBe(1.3);
  });

  it('follows the replay clock when no time is given', () => {
    registerUsdRates('JPY', [[day('2020-01-01'), 0.0092], [day('2024-06-01'), 0.0064]]);
    setConversionClock(day('2020-06-01'));
    // 1 lot GBPJPY, +1 yen: 100 000 yen × 0.0092.
    expect(computePnl('LONG', 140, 141, 100_000, 'GBPJPY')).toBeCloseTo(920, 6);
  });

  it('keeps the reference table until the series is loaded', () => {
    expect(quoteToAccountRate('EURGBP', 0.86)).toBeCloseTo(1.27);
    expect(usdPerUnitAt('GBP')).toBeNull();
  });

  it('never touches USD-quoted or USD-based pairs', () => {
    registerUsdRates('JPY', [[day('2020-01-01'), 0.001]]);
    expect(quoteToAccountRate('USDJPY', 150)).toBeCloseTo(1 / 150);
    expect(quoteToAccountRate('EURUSD', 1.1)).toBe(1);
  });
});
