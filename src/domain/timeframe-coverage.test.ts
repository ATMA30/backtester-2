import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  describeCoverage,
  finestTimeframeCovering,
  suggestsAlternative,
  timeframeLabel,
} from './timeframe-coverage';
import { TimeframeSeconds } from './timeframes';

const NOW_MS = Date.UTC(2026, 8, 6) ; // 6 septembre 2026
const nowEpoch = Math.floor(NOW_MS / 1000);
const daysAgo = (days: number) => nowEpoch - days * 86_400;

describe('finestTimeframeCovering', () => {
  it('rend le 1m tant que la position tient dans ses 30 jours', () => {
    expect(finestTimeframeCovering(10)?.s).toBe(TimeframeSeconds.M1);
    expect(finestTimeframeCovering(30)?.s).toBe(TimeframeSeconds.M1);
  });

  it('monte d’un palier dès que la limite est franchie', () => {
    expect(finestTimeframeCovering(31)?.s).toBe(TimeframeSeconds.M3);
    expect(finestTimeframeCovering(90)?.s).toBe(TimeframeSeconds.M15);
    expect(finestTimeframeCovering(300)?.s).toBe(TimeframeSeconds.H1);
  });

  it('retombe sur le 1 jour, qui n’a pas de plafond', () => {
    expect(finestTimeframeCovering(5_000)?.s).toBe(TimeframeSeconds.D1);
  });

  it('refuse une ancienneté non finie plutôt que de deviner', () => {
    expect(finestTimeframeCovering(Number.NaN)).toBeNull();
  });

  it('ne descend jamais sous la résolution de la source', () => {
    // Fichier en 4h : proposer le 1h serait une promesse que le clic suivant
    // refuserait, en rouvrant la même boîte de dialogue.
    expect(finestTimeframeCovering(10, TimeframeSeconds.H4)?.s).toBe(TimeframeSeconds.H4);
    expect(finestTimeframeCovering(400, TimeframeSeconds.H4)?.s).toBe(TimeframeSeconds.H4);
    // Au-delà de l'archive du 4h, il faut remonter au 1D.
    expect(finestTimeframeCovering(3_000, TimeframeSeconds.H4)?.s).toBe(TimeframeSeconds.D1);
  });

  it('rend null quand le plancher dépasse toutes les unités connues', () => {
    expect(finestTimeframeCovering(10, TimeframeSeconds.MN1 * 12)).toBeNull();
  });
});

describe('daysBetween', () => {
  it('ne renvoie jamais de durée négative', () => {
    expect(daysBetween(nowEpoch, daysAgo(10))).toBe(0);
  });

  it('compte les jours entiers', () => {
    expect(daysBetween(daysAgo(10), nowEpoch)).toBe(10);
  });
});

describe('describeCoverage', () => {
  it('déduit la fenêtre 1m de la règle d’archive quand elle n’est pas fournie', () => {
    const c = describeCoverage({
      cause: 'archive-depth',
      symbol: 'EURUSD',
      requestedSeconds: TimeframeSeconds.M1,
      currentSeconds: TimeframeSeconds.D1,
      cutEpoch: daysAgo(400),
      nowMs: NOW_MS,
    });

    expect(c.availableDays).toBe(30);
    expect(c.window).not.toBeNull();
    expect(daysBetween(c.window!.fromEpoch, c.window!.toEpoch)).toBe(30);
    expect(c.cutAgeDays).toBe(400);
    // 400 jours en arrière, fenêtre ouverte il y a 30 jours : 370 jours d'écart.
    expect(c.shortfallDays).toBe(370);
    // 400 jours : le 1h est la granularité la plus fine encore servie (5 ans).
    expect(c.finestCovering?.s).toBe(TimeframeSeconds.H1);
  });

  it('conserve la fenêtre réelle d’un flux téléchargé', () => {
    const window = { fromEpoch: daysAgo(20), toEpoch: nowEpoch };
    const c = describeCoverage({
      cause: 'feed-window',
      symbol: 'R_25',
      requestedSeconds: TimeframeSeconds.M1,
      currentSeconds: TimeframeSeconds.D1,
      cutEpoch: daysAgo(45),
      window,
      nowMs: NOW_MS,
    });

    expect(c.window).toEqual(window);
    expect(c.shortfallDays).toBe(25);
  });

  it('n’invente pas de fenêtre quand la source est trop grossière', () => {
    const c = describeCoverage({
      cause: 'source-resolution',
      symbol: 'XAUUSD',
      requestedSeconds: TimeframeSeconds.M1,
      currentSeconds: TimeframeSeconds.D1,
      cutEpoch: daysAgo(200),
      nowMs: NOW_MS,
    });

    expect(c.window).toBeNull();
    expect(c.shortfallDays).toBeNull();
  });

  it('propage le plancher de la source jusqu’à la suggestion', () => {
    const c = describeCoverage({
      cause: 'source-resolution',
      symbol: 'XAUUSD',
      requestedSeconds: TimeframeSeconds.M1,
      currentSeconds: TimeframeSeconds.D1,
      cutEpoch: daysAgo(400),
      floorSeconds: TimeframeSeconds.H4,
      nowMs: NOW_MS,
    });
    expect(c.finestCovering?.s).toBe(TimeframeSeconds.H4);
    expect(suggestsAlternative(c)).toBe(true);
  });

  it('porte le nombre de bougies de contexte quand c’est la cause', () => {
    const c = describeCoverage({
      cause: 'not-enough-context',
      symbol: 'EURUSD',
      requestedSeconds: TimeframeSeconds.M5,
      currentSeconds: TimeframeSeconds.H1,
      cutEpoch: daysAgo(2),
      window: { fromEpoch: daysAgo(3), toEpoch: nowEpoch },
      contextBars: 4,
      nowMs: NOW_MS,
    });

    expect(c.contextBars).toBe(4);
    expect(c.requestedLabel).toBe('5m');
    expect(c.currentLabel).toBe('1h');
  });
});

describe('suggestsAlternative', () => {
  const base = {
    symbol: 'EURUSD',
    currentSeconds: TimeframeSeconds.D1,
    nowMs: NOW_MS,
  } as const;

  it('propose une unité plus grossière qui, elle, couvre la position', () => {
    const c = describeCoverage({
      ...base,
      cause: 'archive-depth',
      requestedSeconds: TimeframeSeconds.M1,
      currentSeconds: TimeframeSeconds.W1,
      cutEpoch: daysAgo(400),
    });
    expect(c.finestCovering?.s).toBe(TimeframeSeconds.H1);
    expect(suggestsAlternative(c)).toBe(true);
  });

  it('ne propose pas l’unité déjà affichée', () => {
    const c = describeCoverage({
      ...base,
      cause: 'archive-depth',
      requestedSeconds: TimeframeSeconds.M1,
      currentSeconds: TimeframeSeconds.H1,
      cutEpoch: daysAgo(400),
    });
    expect(c.finestCovering?.s).toBe(TimeframeSeconds.H1);
    expect(suggestsAlternative(c)).toBe(false);
  });

  it('ne propose pas une unité plus fine que celle qui vient d’échouer', () => {
    const c = describeCoverage({
      ...base,
      cause: 'archive-depth',
      requestedSeconds: TimeframeSeconds.H4,
      currentSeconds: TimeframeSeconds.MN1,
      cutEpoch: daysAgo(10),
    });
    // 10 jours : le 1m couvre, mais il est plus fin que le 4H refusé.
    expect(c.finestCovering?.s).toBe(TimeframeSeconds.M1);
    expect(suggestsAlternative(c)).toBe(false);
  });
});

describe('timeframeLabel', () => {
  it('nomme les durées connues', () => {
    expect(timeframeLabel(TimeframeSeconds.M15)).toBe('15m');
    expect(timeframeLabel(TimeframeSeconds.D1)).toBe('1D');
  });

  it('n’invente pas de nom pour une durée inconnue', () => {
    expect(timeframeLabel(42)).toBe('42s');
  });
});
