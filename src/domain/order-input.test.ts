import { describe, expect, it } from 'vitest';
import { parseEntryInput, parseProtectionInput, priceOf, readPositiveNumber } from './order-input';

const PIP = 0.0001;

describe('parseEntryInput', () => {
  it('reads a blank or "marché" as an order at market', () => {
    for (const text of ['', '  ', '—', 'Marché', 'market']) expect(parseEntryInput(text)).toEqual({ kind: 'empty' });
  });

  it('reads an absolute price, with a comma or spaces', () => {
    expect(parseEntryInput('1,0850')).toEqual({ kind: 'value', price: 1.085 });
    expect(parseEntryInput(' 1 085.5 ')).toEqual({ kind: 'value', price: 1085.5 });
  });

  it('refuses an offset, garbage and a non-positive price', () => {
    expect(parseEntryInput('30p').kind).toBe('error');
    expect(parseEntryInput('1.2abc').kind).toBe('error');
    expect(parseEntryInput('0').kind).toBe('error');
  });
});

describe('parseProtectionInput', () => {
  it('puts a pip offset on the protective side for each direction', () => {
    expect(priceOf(parseProtectionInput('30p', 'sl', true, 1.1, PIP))).toBeCloseTo(1.097, 10);
    expect(priceOf(parseProtectionInput('30p', 'sl', false, 1.1, PIP))).toBeCloseTo(1.103, 10);
    expect(priceOf(parseProtectionInput('60 pips', 'tp', true, 1.1, PIP))).toBeCloseTo(1.106, 10);
    expect(priceOf(parseProtectionInput('60pip', 'tp', false, 1.1, PIP))).toBeCloseTo(1.094, 10);
  });

  it('reads a percentage of the entry', () => {
    expect(priceOf(parseProtectionInput('1%', 'sl', true, 2000, 0.01))).toBeCloseTo(1980, 10);
  });

  it('never guesses a unit from the magnitude: `5` is the price 5', () => {
    // The old heuristic read "5" as pips on some pairs and as a price on others.
    expect(parseProtectionInput('5', 'sl', true, 1.1, PIP)).toEqual({ kind: 'value', price: 5 });
  });

  it('explains what it cannot read', () => {
    const field = parseProtectionInput('abc', 'sl', true, 1.1, PIP);
    expect(field.kind === 'error' && field.message).toContain('SL illisible');
    expect(parseProtectionInput('0p', 'tp', true, 1.1, PIP).kind).toBe('error');
    expect(parseProtectionInput('30p', 'sl', true, Number.NaN, PIP).kind).toBe('error');
  });
});

describe('readPositiveNumber', () => {
  it('keeps the previous value while the field is emptied, and accepts a real 0', () => {
    expect(readPositiveNumber('', 1)).toBe(1);
    expect(readPositiveNumber('0', 1)).toBe(0);
    expect(readPositiveNumber('0.5', 1)).toBe(0.5);
    expect(readPositiveNumber('-2', 1)).toBe(1);
  });
});
