import { describe, expect, it } from 'vitest';
import { archiveLimitFor, checkArchiveDepth, estimateCoverage, DUKASCOPY_SPAN_DAYS } from './archive-limits';
import { TIMEFRAME_DEFS, TimeframeSeconds } from './timeframes';

const NOW = Date.UTC(2026, 0, 1);
const daysAgo = (days: number) => Math.floor(NOW / 1000) - days * 86_400;

describe('archiveLimitFor', () => {
  it('promises exactly the depth the server downloads', () => {
    // The UI used to promise five hourly years that only the dev server
    // delivered. Both now read `DUKASCOPY_SPAN_DAYS`.
    expect(archiveLimitFor(TimeframeSeconds.M1)?.maxAgeDays).toBe(DUKASCOPY_SPAN_DAYS['1m']);
    expect(archiveLimitFor(TimeframeSeconds.M5)?.maxAgeDays).toBe(DUKASCOPY_SPAN_DAYS['5m']);
    expect(archiveLimitFor(TimeframeSeconds.M15)?.maxAgeDays).toBe(DUKASCOPY_SPAN_DAYS['15m']);
    expect(archiveLimitFor(TimeframeSeconds.M30)?.maxAgeDays).toBe(DUKASCOPY_SPAN_DAYS['30m']);
    expect(archiveLimitFor(TimeframeSeconds.H4)?.maxAgeDays).toBe(DUKASCOPY_SPAN_DAYS['1h']);
  });

  it('picks the first bracket a timeframe falls into', () => {
    // 3m sits between 1m and 5m: it must inherit the 5m depth, not the 1m one.
    expect(archiveLimitFor(TimeframeSeconds.M3)?.label).toBe('5m');
    expect(archiveLimitFor(TimeframeSeconds.H1)?.label).toBe('1H/4H');
  });

  it('leaves daily and above uncapped', () => {
    expect(archiveLimitFor(TimeframeSeconds.D1)).toBeNull();
    expect(archiveLimitFor(TimeframeSeconds.W1)).toBeNull();
  });
});

describe('checkArchiveDepth', () => {
  it('allows anything when replay is off', () => {
    expect(checkArchiveDepth(TimeframeSeconds.M1, null, NOW).allowed).toBe(true);
  });

  it('allows a cut inside the provider window', () => {
    expect(checkArchiveDepth(TimeframeSeconds.M1, daysAgo(10), NOW).allowed).toBe(true);
    expect(checkArchiveDepth(TimeframeSeconds.M15, daysAgo(100), NOW).allowed).toBe(true);
  });

  it('refuses a cut older than the provider serves, and says why', () => {
    const result = checkArchiveDepth(TimeframeSeconds.M1, daysAgo(200), NOW);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain('1m');
    expect(result.message).toContain('30 jours');
    expect(result.message).toContain('200 jours');
  });

  it('never blocks a daily switch, however old the cut', () => {
    expect(checkArchiveDepth(TimeframeSeconds.D1, daysAgo(9000), NOW).allowed).toBe(true);
  });

  it('treats the boundary day as allowed', () => {
    expect(checkArchiveDepth(TimeframeSeconds.M1, daysAgo(30), NOW).allowed).toBe(true);
    expect(checkArchiveDepth(TimeframeSeconds.M1, daysAgo(31), NOW).allowed).toBe(false);
  });

  it('ignores a non-finite cut rather than producing a nonsense message', () => {
    expect(checkArchiveDepth(TimeframeSeconds.M1, Number.NaN, NOW).allowed).toBe(true);
  });
});

describe('estimateCoverage', () => {
  it('réduit la profondeur demandée au plafond réel de la source', () => {
    // Le cas qui piégeait : « Maximum disponible » en 5 min affichait « max »
    // alors que la source s'arrête à 60 jours.
    const c = estimateCoverage(TimeframeSeconds.M5, 'max', TIMEFRAME_DEFS);
    expect(c.effectiveDays).toBe(60);
    expect(c.cappedByProvider).toBe(true);
  });

  it('respecte une demande plus courte que le plafond', () => {
    const c = estimateCoverage(TimeframeSeconds.H1, '1y', TIMEFRAME_DEFS);
    expect(c.effectiveDays).toBe(365);
    expect(c.cappedByProvider).toBe(false);
  });

  it('ne plafonne jamais le journalier', () => {
    const c = estimateCoverage(TimeframeSeconds.D1, 'max', TIMEFRAME_DEFS);
    expect(c.cappedByProvider).toBe(false);
  });

  it('ne propose que des unités de temps plus larges', () => {
    // On agrège vers le haut sans recharger ; descendre exige un nouveau flux.
    const c = estimateCoverage(TimeframeSeconds.M15, 'max', TIMEFRAME_DEFS);
    expect(c.upgradableTo).toContain('30m');
    expect(c.upgradableTo).toContain('1D');
    expect(c.upgradableTo).not.toContain('5m');
    expect(c.upgradableTo).not.toContain('15m');
  });

  it('ne propose rien au-delà de l’unité la plus large', () => {
    expect(estimateCoverage(TimeframeSeconds.MN1, 'max', TIMEFRAME_DEFS).upgradableTo).toEqual([]);
  });
});
