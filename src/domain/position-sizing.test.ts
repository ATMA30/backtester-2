import { describe, expect, it } from 'vitest';
import { computePnl, effectiveRiskPercent, riskBasedLots } from './position-sizing';
import { formatMoney, lotsToUnits, quoteToAccountRate } from './instruments';

describe('quoteToAccountRate', () => {
  it('is 1 for instruments quoted in USD', () => {
    expect(quoteToAccountRate('EURUSD', 1.08)).toBe(1);
    expect(quoteToAccountRate('XAUUSD', 2450)).toBe(1);
    expect(quoteToAccountRate('BTCUSDT', 65_000)).toBe(1);
    expect(quoteToAccountRate('R_100', 1234)).toBe(1);
  });

  it('divides by the price when USD is the base currency', () => {
    expect(quoteToAccountRate('USDJPY', 150)).toBeCloseTo(1 / 150);
  });

  it('uses the reference table for crosses', () => {
    expect(quoteToAccountRate('EURGBP', 0.85)).toBeCloseTo(1.27);
  });
});

describe('computePnl — account currency', () => {
  it('converts a USDJPY move into dollars', () => {
    // 1 lot, +1 yen at 151: 100 000 yen ≈ $662, not $100 000.
    const pnl = computePnl('LONG', 150, 151, lotsToUnits('USDJPY', 1), 'USDJPY');
    expect(pnl).toBeCloseTo(100_000 / 151, 2);
  });

  it('leaves a USD-quoted pair unchanged', () => {
    const pnl = computePnl('SHORT', 1.1, 1.09, 100_000, 'EURUSD');
    expect(pnl).toBeCloseTo(1_000, 6);
  });
});

describe('riskBasedLots — account currency', () => {
  it('sizes a USDJPY stop so the loss at the stop is the requested risk', () => {
    // 1% of 10 000 = $100 over a 50-pip (0.50 yen) stop.
    const lots = riskBasedLots('USDJPY', 10_000, 1, 150, 149.5);
    expect(lots).not.toBeNull();
    const loss = -computePnl('LONG', 150, 149.5, lotsToUnits('USDJPY', lots as number), 'USDJPY');
    expect(loss).toBeGreaterThan(95);
    expect(loss).toBeLessThan(105);
  });
});

describe('effectiveRiskPercent', () => {
  it('reveals the real risk once the size is clamped to the minimum lot', () => {
    // $100 account, 0.1% requested, 850-pip stop: 0.01 lot loses $85 = 85%.
    const real = effectiveRiskPercent('EURUSD', 100, 1.085, 1.0, 0.01);
    expect(real).toBeCloseTo(85, 5);
  });
});

describe('formatMoney', () => {
  it('formats with a single, consistent sign convention', () => {
    expect(formatMoney(-12.3)).toBe('-$12.30');
    expect(formatMoney(1234.5, { signed: true })).toBe('+$1,234.50');
    expect(formatMoney(0, { signed: true })).toBe('$0.00');
  });
});
