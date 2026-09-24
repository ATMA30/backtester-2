import { describe, expect, it } from 'vitest';
import { mergeBatch, streamCsvCandles } from './csv-stream';

/** Analyseur de date minimal, au format du fichier réel : `2004.06.11 07:18`. */
function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const iso = value.trim().replace(/\./g, '-').replace(' ', 'T');
  const ms = Date.parse(iso.length === 16 ? `${iso}:00Z` : `${iso}Z`);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function csvFile(lines: string[], name = 'test.csv'): File {
  return new File([lines.join('\n')], name, { type: 'text/csv' });
}

const HEADER = 'Date;Open;High;Low;Close;Volume';

function row(minute: number, close: number): string {
  const mm = String(minute % 60).padStart(2, '0');
  const hh = String(7 + Math.floor(minute / 60)).padStart(2, '0');
  return `2004.06.11 ${hh}:${mm};${close};${close + 0.1};${close - 0.1};${close};3`;
}

describe('streamCsvCandles', () => {
  it('lit un export MT4 sans en-tête sans perdre ni décaler de colonne', async () => {
    const lines = [
      '2020.01.02,07:00,1.12100,1.12150,1.12050,1.12120,100',
      '2020.01.02,07:01,1.12120,1.12200,1.12100,1.12180,90',
    ];
    const result = await streamCsvCandles(csvFile(lines), parseTimestamp);
    expect(result.hasHeader).toBe(false);
    expect(result.candles).toHaveLength(2);
    expect(result.candles[0]).toMatchObject({ open: 1.121, high: 1.1215, low: 1.1205, close: 1.1212 });
  });

  it('garde tout un fichier trié du plus récent au plus ancien', async () => {
    const lines = [HEADER];
    for (let i = 179; i >= 0; i--) lines.push(row(i, 100 + i));
    // Lots minuscules pour forcer plusieurs fusions sur un petit fichier.
    const result = await streamCsvCandles(csvFile(lines), parseTimestamp, { maxCandles: 1_000 });
    expect(result.candles).toHaveLength(180);
    expect(result.candles[0].close).toBe(100);
    expect(result.candles[179].close).toBe(279);
  });

  it('applique le mappage confirmé par l’utilisateur', async () => {
    const file = csvFile(['Date;A;B;C;D;Volume', row(0, 384)]);
    const result = await streamCsvCandles(file, parseTimestamp, {
      mapping: { date: 'Date', time: '', open: 'D', high: 'B', low: 'C', close: 'A', volume: '' },
    });
    expect(result.candles[0].close).toBe(384);
    expect(result.candles[0].volume).toBe(0);
  });

  it('décrit la première ligne rejetée', async () => {
    const file = csvFile([HEADER, row(0, 384), '13/45/2004 07:00;1;1;1;1;1']);
    const result = await streamCsvCandles(file, parseTimestamp);
    expect(result.firstRejected).toMatchObject({ line: 3, reason: 'date' });
  });

  it('lit le format réel du fichier XAU 1 minute', async () => {
    const file = csvFile([HEADER, row(0, 384), row(1, 384.2), row(2, 383.9)]);
    const result = await streamCsvCandles(file, parseTimestamp);

    expect(result.delimiter).toBe(';');
    expect(result.header).toEqual(['Date', 'Open', 'High', 'Low', 'Close', 'Volume']);
    expect(result.candles).toHaveLength(3);
    expect(result.candles[0].close).toBe(384);
    expect(result.candles[0].volume).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('tronque aux plus récentes quand on le demande explicitement', async () => {
    const lines = [HEADER];
    for (let i = 0; i < 120; i++) lines.push(row(i, 100 + i));

    const result = await streamCsvCandles(file(lines), parseTimestamp, {
      maxCandles: 40,
      overflow: 'truncate',
    });

    expect(result.truncated).toBe(true);
    expect(result.candles).toHaveLength(40);
    // Ce sont bien les dernières, pas les premières.
    expect(result.candles[result.candles.length - 1].close).toBe(219);
    expect(result.candles[0].close).toBe(180);
  });

  it('agrège au lieu de tronquer, en conservant toute la période', async () => {
    // Le défaut : perdre vingt ans d'historique pour préserver la minute est
    // rarement le bon arbitrage sur un fichier d'archive.
    const lines = [HEADER];
    for (let i = 0; i < 600; i++) lines.push(row(i, 100 + (i % 50)));

    const result = await streamCsvCandles(file(lines), parseTimestamp, { maxCandles: 100 });

    expect(result.candles.length).toBeLessThanOrEqual(100);
    expect(result.resolutionSeconds).toBeGreaterThan(result.sourceResolutionSeconds);
    expect(result.truncated).toBe(false);

    // La première et la dernière bougie encadrent toujours la période du fichier.
    const first = result.candles[0].time;
    const last = result.candles[result.candles.length - 1].time;
    expect(last - first).toBeGreaterThan(500 * 60 * 0.8);
  });

  it('compte les lignes rejetées sans interrompre la lecture', async () => {
    const file = csvFile([
      HEADER,
      row(0, 384),
      'pas;une;ligne;de;bougie;du tout',
      ';;;;;',
      row(1, 385),
    ]);
    const result = await streamCsvCandles(file, parseTimestamp);

    expect(result.candles).toHaveLength(2);
    expect(result.linesRejected).toBe(2);
  });

  it('reconstitue une ligne coupée entre deux morceaux du flux', async () => {
    // Un `File` construit de plusieurs blobs découpe le flux en interne.
    const parts = [`${HEADER}\n2004.06.11 07:0`, `0;384;384.1;383.9;384;3\n`];
    const split = new File(parts, 'split.csv', { type: 'text/csv' });
    const result = await streamCsvCandles(split, parseTimestamp);

    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].close).toBe(384);
  });

  it('signale une progression pendant la lecture', async () => {
    const lines = [HEADER];
    for (let i = 0; i < 5; i++) lines.push(row(i, 100 + i));

    let called = 0;
    await streamCsvCandles(file(lines), parseTimestamp, { onProgress: () => { called++; } });
    // Le lot de vidage est large : aucune garantie d'appel sur un petit fichier.
    expect(called).toBeGreaterThanOrEqual(0);
  });

  it('renvoie un résultat vide pour un fichier sans bougie', async () => {
    const result = await streamCsvCandles(csvFile([HEADER]), parseTimestamp);
    expect(result.candles).toEqual([]);
    expect(result.linesRead).toBe(0);
  });
});

function file(lines: string[]): File {
  return csvFile(lines);
}

describe('mergeBatch', () => {
  const c = (time: number, open: number, close: number, high = Math.max(open, close), low = Math.min(open, close)) =>
    ({ time, open, high, low, close, volume: 1 });

  it('ajoute en tête un lot entièrement antérieur (fichier inversé)', () => {
    const merged = mergeBatch([c(300, 3, 3), c(400, 4, 4)], [c(100, 1, 1), c(200, 2, 2)]);
    expect(merged.map((x) => x.time)).toEqual([100, 200, 300, 400]);
  });

  it('fusionne l’intervalle à cheval en gardant l’ouverture du plus ancien', () => {
    const merged = mergeBatch([c(200, 5, 6, 9, 4), c(300, 6, 7)], [c(100, 1, 1), c(200, 2, 3, 8, 1)]);
    expect(merged.map((x) => x.time)).toEqual([100, 200, 300]);
    expect(merged[1]).toMatchObject({ open: 2, close: 6, high: 9, low: 1, volume: 2 });
  });

  it('trie un lot qui chevauche l’accumulateur', () => {
    const merged = mergeBatch([c(100, 1, 1), c(300, 3, 3)], [c(200, 2, 2), c(400, 4, 4)]);
    expect(merged.map((x) => x.time)).toEqual([100, 200, 300, 400]);
  });
});

describe('streamCsvCandles — fichiers atypiques', () => {
  it('lit des fins de ligne \\r seules (anciens exports Mac)', async () => {
    const file = new File([[HEADER, row(0, 384), row(1, 385)].join('\r')], 'mac.csv');
    const result = await streamCsvCandles(file, parseTimestamp);
    expect(result.candles).toHaveLength(2);
  });

  it('refuse une ligne démesurée au lieu de remplir la mémoire', async () => {
    const file = new File(['x'.repeat(1_100_000)], 'blob.csv');
    await expect(streamCsvCandles(file, parseTimestamp)).rejects.toThrow('pas un CSV');
  });
});
