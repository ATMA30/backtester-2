import { describe, expect, it } from 'vitest';
import {
  TimeframeSeconds,
  getDownloadableBaseTF,
  intervalLabelFor,
  secondsForInterval,
  isKnownTimeframe,
  TIMEFRAME_DEFS,
} from './timeframes';

describe('getDownloadableBaseTF', () => {
  it('maps 1m and 3m to 1m downloadable base', () => {
    expect(getDownloadableBaseTF(TimeframeSeconds.M1)).toEqual({
      baseSeconds: TimeframeSeconds.M1,
      interval: '1m',
    });
    expect(getDownloadableBaseTF(TimeframeSeconds.M3)).toEqual({
      baseSeconds: TimeframeSeconds.M1,
      interval: '1m',
    });
  });

  it('maps 5m, 15m, 30m to their native downloadable intervals', () => {
    expect(getDownloadableBaseTF(TimeframeSeconds.M5)).toEqual({
      baseSeconds: TimeframeSeconds.M5,
      interval: '5m',
    });
    expect(getDownloadableBaseTF(TimeframeSeconds.M15)).toEqual({
      baseSeconds: TimeframeSeconds.M15,
      interval: '15m',
    });
    expect(getDownloadableBaseTF(TimeframeSeconds.M30)).toEqual({
      baseSeconds: TimeframeSeconds.M30,
      interval: '30m',
    });
  });

  it('maps 1h, 2h and 4h to 1h downloadable base', () => {
    expect(getDownloadableBaseTF(TimeframeSeconds.H1)).toEqual({
      baseSeconds: TimeframeSeconds.H1,
      interval: '1h',
    });
    expect(getDownloadableBaseTF(TimeframeSeconds.H2)).toEqual({
      baseSeconds: TimeframeSeconds.H1,
      interval: '1h',
    });
    expect(getDownloadableBaseTF(TimeframeSeconds.H4)).toEqual({
      baseSeconds: TimeframeSeconds.H1,
      interval: '1h',
    });
  });

  it('maps 1D, 1W and 1M to 1d downloadable base', () => {
    expect(getDownloadableBaseTF(TimeframeSeconds.D1)).toEqual({
      baseSeconds: TimeframeSeconds.D1,
      interval: '1d',
    });
    expect(getDownloadableBaseTF(TimeframeSeconds.W1)).toEqual({
      baseSeconds: TimeframeSeconds.D1,
      interval: '1d',
    });
    expect(getDownloadableBaseTF(TimeframeSeconds.MN1)).toEqual({
      baseSeconds: TimeframeSeconds.D1,
      interval: '1d',
    });
  });
});

describe('intervalLabelFor', () => {
  it('disambiguates 1m and 1M', () => {
    expect(intervalLabelFor(TimeframeSeconds.M1)).toBe('1m');
    expect(intervalLabelFor(TimeframeSeconds.MN1)).toBe('1mo');
  });

  it('labels weekly as 1wk', () => {
    expect(intervalLabelFor(TimeframeSeconds.W1)).toBe('1wk');
  });

  it('labels standard timeframes correctly', () => {
    expect(intervalLabelFor(TimeframeSeconds.M5)).toBe('5m');
    expect(intervalLabelFor(TimeframeSeconds.H1)).toBe('1h');
    expect(intervalLabelFor(TimeframeSeconds.H2)).toBe('2h');
    expect(intervalLabelFor(TimeframeSeconds.H4)).toBe('4h');
    expect(intervalLabelFor(TimeframeSeconds.D1)).toBe('1d');
  });
});

describe('secondsForInterval', () => {
  it('parses month vs minute correctly', () => {
    expect(secondsForInterval('1m')).toBe(TimeframeSeconds.M1);
    expect(secondsForInterval('1mo')).toBe(TimeframeSeconds.MN1);
  });

  it('parses week and day correctly', () => {
    expect(secondsForInterval('1w')).toBe(TimeframeSeconds.W1);
    expect(secondsForInterval('1wk')).toBe(TimeframeSeconds.W1);
    expect(secondsForInterval('1d')).toBe(TimeframeSeconds.D1);
  });

  it('parses hourly variations', () => {
    expect(secondsForInterval('60m')).toBe(TimeframeSeconds.H1);
    expect(secondsForInterval('1h')).toBe(TimeframeSeconds.H1);
    expect(secondsForInterval('2h')).toBe(TimeframeSeconds.H2);
    expect(secondsForInterval('4h')).toBe(TimeframeSeconds.H4);
  });
});

describe('isKnownTimeframe', () => {
  it('identifies known timeframes from TIMEFRAME_DEFS', () => {
    for (const def of TIMEFRAME_DEFS) {
      expect(isKnownTimeframe(def.s)).toBe(true);
    }
    expect(isKnownTimeframe(999)).toBe(false);
  });
});
