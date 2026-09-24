import { describe, expect, it } from 'vitest';
import { formatPrice, getInstrument, lotsToUnits, unitsToLots } from './instruments';
import { MIN_LOT, riskBasedLots, resolveSizeUnits, validateOrder } from './position-sizing';

describe('getInstrument', () => {
  it('returns catalogue metadata for a known symbol', () => {
    const eurusd = getInstrument('EURUSD');
    expect(eurusd.assetClass).toBe('forex');
    expect(eurusd.pip).toBe(0.0001);
    expect(eurusd.decimals).toBe(5);
    expect(eurusd.contractSize).toBe(100_000);
  });

  it('classifies gold as a metal rather than forex', () => {
    // Regression: XAUUSD is six characters, so `symbol.length === 6` classified
    // it as a forex pair and the gold sizing branch became dead code.
    expect(getInstrument('XAUUSD').assetClass).toBe('metal');
    expect(getInstrument('XAUUSD').contractSize).toBe(100);
  });

  it('uses three decimals for JPY pairs', () => {
    expect(getInstrument('USDJPY').decimals).toBe(3);
    expect(getInstrument('USDJPY').pip).toBe(0.01);
  });

  it('never scales low-priced crypto like forex', () => {
    // Regression: `entry < 200` treated DOGEUSDT (~$0.16) as a forex pair.
    expect(getInstrument('DOGEUSDT').assetClass).toBe('crypto');
    expect(getInstrument('DOGEUSDT').contractSize).toBe(1);
  });

  it('is case-insensitive and trims input', () => {
    expect(getInstrument('  eurusd ').symbol).toBe('EURUSD');
  });

  it('infers a spec for an unknown imported symbol', () => {
    const custom = getInstrument('MYDATA', 1234.5);
    expect(custom.category).toBe('Personnalisé');
    expect(custom.decimals).toBe(2);
    expect(Number.isFinite(custom.pip)).toBe(true);
  });

  it('recognises an unlisted currency pair as forex', () => {
    expect(getInstrument('EURSEK').assetClass).toBe('forex');
  });
});

describe('formatPrice', () => {
  it('uses the instrument precision rather than a magnitude guess', () => {
    expect(formatPrice('EURUSD', 1.08523)).toBe('1.08523');
    expect(formatPrice('USDJPY', 155.1234)).toBe('155.123');
    expect(formatPrice('BTCUSDT', 65123.456)).toBe('65123.46');
  });

  it('renders a placeholder for a non-finite price', () => {
    expect(formatPrice('EURUSD', Number.NaN)).toBe('—');
  });
});

describe('lot conversion', () => {
  it('round-trips lots through units', () => {
    expect(lotsToUnits('EURUSD', 0.5)).toBe(50_000);
    expect(unitsToLots('EURUSD', 50_000)).toBe(0.5);
    expect(lotsToUnits('BTCUSDT', 0.5)).toBe(0.5);
  });
});

describe('riskBasedLots', () => {
  it('sizes a forex trade from risk% and stop distance', () => {
    // 1% of 10 000 = $100 over a 20-pip stop => 50 000 units => 0.5 lot.
    expect(riskBasedLots('EURUSD', 10_000, 1, 1.085, 1.083)).toBe(0.5);
  });

  it('sizes gold with the metal contract size, not the forex one', () => {
    // $100 risked over a $10 stop = 10 oz = 0.1 lot of 100 oz.
    expect(riskBasedLots('XAUUSD', 10_000, 1, 2450, 2440)).toBe(0.1);
  });

  it('never returns less than the minimum lot', () => {
    expect(riskBasedLots('EURUSD', 10, 0.1, 1.085, 1.0)).toBe(MIN_LOT);
  });

  it('returns null when the inputs cannot yield a size', () => {
    expect(riskBasedLots('EURUSD', 10_000, 1, 1.085, null)).toBeNull();
    expect(riskBasedLots('EURUSD', 10_000, 1, 1.085, 1.085)).toBeNull();
    expect(riskBasedLots('EURUSD', 0, 1, 1.085, 1.08)).toBeNull();
  });
});

describe('resolveSizeUnits', () => {
  const base = {
    symbol: 'EURUSD',
    balance: 10_000,
    riskPercent: 1,
    defaultQuantityLots: 1,
    entry: 1.085,
    sl: 1.083,
  };

  it('gives an explicit lot size precedence over risk sizing', () => {
    expect(resolveSizeUnits({ ...base, explicitLots: 0.2 })).toBe(20_000);
  });

  it('treats an explicit zero as zero, not as "use the default"', () => {
    // Regression: `customSize || quantity` silently replaced 0 with the default.
    expect(resolveSizeUnits({ ...base, explicitLots: 0 })).toBe(0);
  });

  it('falls back to risk sizing, then to the default quantity', () => {
    expect(resolveSizeUnits(base)).toBe(50_000);
    expect(resolveSizeUnits({ ...base, sl: null })).toBe(100_000);
  });
});

describe('validateOrder', () => {
  const draft = { type: 'LONG' as const, entry: 1.085, sl: null, tp: null, sizeUnits: 1000 };

  it('accepts a well-formed order', () => {
    expect(validateOrder({ ...draft, sl: 1.08, tp: 1.09 })).toEqual({ ok: true });
  });

  it('rejects a long stop placed above the entry', () => {
    expect(validateOrder({ ...draft, sl: 1.09 })).toEqual({ ok: false, reason: 'SL_WRONG_SIDE' });
  });

  it('rejects a short stop placed below the entry', () => {
    expect(validateOrder({ ...draft, type: 'SHORT', sl: 1.08 })).toEqual({
      ok: false,
      reason: 'SL_WRONG_SIDE',
    });
  });

  it('rejects non-finite and non-positive values', () => {
    expect(validateOrder({ ...draft, entry: Number.NaN })).toEqual({
      ok: false,
      reason: 'NON_FINITE_PRICE',
    });
    expect(validateOrder({ ...draft, entry: 0 })).toEqual({
      ok: false,
      reason: 'NON_POSITIVE_PRICE',
    });
    expect(validateOrder({ ...draft, sizeUnits: 0 })).toEqual({
      ok: false,
      reason: 'NON_POSITIVE_SIZE',
    });
  });
});
