import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareConversionFor } from './fxRates';
import { resetFxRates, usdPerUnitAt } from '../domain/fx-rates';

describe('prepareConversionFor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetFxRates();
  });

  it('loads the ECB series of a cross’s quote currency once', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ rates: { '2024-07-15': { GBP: 0.8 } } }), {
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([prepareConversionFor('EURGBP'), prepareConversionFor('EURGBP')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usdPerUnitAt('GBP', null)).toBeCloseTo(1.25);
  });

  it('needs nothing for USD pairs', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await prepareConversionFor('EURUSD');
    await prepareConversionFor('USDJPY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the table when the ECB is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await prepareConversionFor('GBPJPY')).toBe(false);
    expect(usdPerUnitAt('JPY')).toBeNull();
  });
});
