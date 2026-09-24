import { describe, expect, it } from 'vitest';
import {
  detectDateOrder,
  detectDelimiter,
  inferColumnMapping,
  looksLikeHeader,
  matchColumn,
  parseCsv,
  parseNumber,
  parseTimestamp,
  splitRow,
} from './csv';

describe('splitRow', () => {
  it('keeps a quoted field containing the delimiter intact', () => {
    // Regression: a naive `split(',')` shifted every column after the quote.
    expect(splitRow('"Acme, Inc",1.05,1.10', ',')).toEqual(['Acme, Inc', '1.05', '1.10']);
  });

  it('unescapes doubled quotes', () => {
    expect(splitRow('"say ""hi""",2', ',')).toEqual(['say "hi"', '2']);
  });

  it('preserves empty fields', () => {
    expect(splitRow('a,,c', ',')).toEqual(['a', '', 'c']);
  });
});

describe('detectDelimiter', () => {
  it('detects semicolons over decimal commas', () => {
    // European export: `1,05` would make the comma look like the delimiter.
    const lines = ['date;open;close', '2024-01-01;1,05;1,07', '2024-01-02;1,07;1,09'];
    expect(detectDelimiter(lines)).toBe(';');
  });

  it('detects tabs', () => {
    expect(detectDelimiter(['date\topen\tclose', '2024-01-01\t1\t2'])).toBe('\t');
  });

  it('prefers the delimiter that splits rows consistently', () => {
    const lines = ['date,open,close', '2024-01-01,1.05,1.07', '2024-01-02,1.07,1.09'];
    expect(detectDelimiter(lines)).toBe(',');
  });
});

describe('parseCsv', () => {
  it('returns a header and rows, skipping blank lines', () => {
    const table = parseCsv('date,close\n\n2024-01-01,1.05\n2024-01-02,1.07\n');
    expect(table.header).toEqual(['date', 'close']);
    expect(table.rows).toEqual([
      ['2024-01-01', '1.05'],
      ['2024-01-02', '1.07'],
    ]);
  });

  it('caps the number of retained rows', () => {
    const text = ['h'].concat(Array.from({ length: 100 }, (_, i) => String(i))).join('\n');
    expect(parseCsv(text, 10).rows).toHaveLength(10);
  });

  it('handles an empty document', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [], delimiter: ',', hasHeader: true });
  });
});

describe('matchColumn', () => {
  it('does not mistake open_time for the opening price', () => {
    // Regression: prefix matching on the single-letter alias `o` picked
    // `open_time` as the open price, so every row parsed as NaN.
    const header = ['open_time', 'open', 'high', 'low', 'close', 'volume'];
    expect(matchColumn(header, 'open', ['open_time'])).toBe('open');
    expect(matchColumn(header, 'date')).toBe('open_time');
  });

  it('does not mistake a "count" column for close', () => {
    expect(matchColumn(['date', 'count', 'close'], 'close')).toBe('close');
    expect(matchColumn(['date', 'count'], 'close')).toBeNull();
  });

  it('accepts single-letter headers on an exact match', () => {
    expect(matchColumn(['t', 'o', 'h', 'l', 'c'], 'open')).toBe('o');
  });

  it('returns null when nothing matches', () => {
    expect(matchColumn(['alpha', 'beta'], 'volume')).toBeNull();
  });
});

describe('inferColumnMapping', () => {
  it('maps a conventional OHLCV header', () => {
    const mapping = inferColumnMapping(['Date', 'Open', 'High', 'Low', 'Close', 'Volume']);
    expect(mapping).toMatchObject({
      date: 'Date',
      open: 'Open',
      high: 'High',
      low: 'Low',
      close: 'Close',
      volume: 'Volume',
    });
  });

  it('keeps a separate time column distinct from the date column', () => {
    const mapping = inferColumnMapping(['Date', 'Time', 'Open', 'High', 'Low', 'Close']);
    expect(mapping.date).toBe('Date');
    expect(mapping.time).toBe('Time');
  });

  it('leaves fields empty rather than inventing positional columns that do not exist', () => {
    // Regression: `header[4]` on a three-column file yielded `undefined`, whose
    // `indexOf` is -1, and every row was silently discarded.
    const mapping = inferColumnMapping(['when', 'price']);
    expect(mapping.close).toBe('price');
    expect(mapping.high).toBe('');
    expect(mapping.low).toBe('');
  });
});

describe('headerless files', () => {
  const MT4 = '2020.01.02,00:00,1.12100,1.12150,1.12050,1.12120,100\n2020.01.02,00:01,1.12120,1.12200,1.12100,1.12180,90\n';

  it('keeps the first candle of an MT4 export instead of reading it as a header', () => {
    const table = parseCsv(MT4);
    expect(table.hasHeader).toBe(false);
    expect(table.rows).toHaveLength(2);
    expect(table.header).toEqual(['date', 'time', 'open', 'high', 'low', 'close', 'volume']);
  });

  it('maps an MT4 export column for column', () => {
    const mapping = inferColumnMapping(parseCsv(MT4).header);
    expect(mapping).toMatchObject({ date: 'date', time: 'time', open: 'open', close: 'close' });
  });

  it('still recognises real headers, including MT5 angle brackets', () => {
    expect(looksLikeHeader(['Date', 'Open', 'High', 'Low', 'Close'])).toBe(true);
    expect(looksLikeHeader(['<DATE>', '<TIME>', '<OPEN>', '<CLOSE>'])).toBe(true);
    expect(looksLikeHeader(['2023-01-15T00:00:00Z', '1.05', '1.06', '1.04', '1.055'])).toBe(false);
  });

  it('falls back to unclaimed columns, never to the time column', () => {
    const mapping = inferColumnMapping(['Date', 'Time', 'p1', 'p2', 'p3', 'p4']);
    expect(mapping).toMatchObject({ open: 'p1', high: 'p2', low: 'p3', close: 'p4' });
  });
});

describe('parseTimestamp', () => {
  it('reads European and American dates according to the file order', () => {
    const march4 = Date.UTC(2024, 2, 4) / 1000;
    expect(parseTimestamp('04/03/2024', 'DMY')).toBe(march4);
    expect(parseTimestamp('03/04/2024', 'MDY')).toBe(march4);
  });

  it('rejects an impossible date instead of reinterpreting it in local time', () => {
    expect(parseTimestamp('03/25/2024', 'DMY')).toBeNull();
  });

  it('reads MT4, ISO, compact and epoch forms as UTC', () => {
    const t = Date.UTC(2020, 0, 2, 7, 5) / 1000;
    expect(parseTimestamp('2020.01.02 07:05')).toBe(t);
    expect(parseTimestamp('2020-01-02T07:05:00')).toBe(t);
    expect(parseTimestamp('2020-01-02 7:05')).toBe(t);
    expect(parseTimestamp(String(t))).toBe(t);
    expect(parseTimestamp(String(t * 1000))).toBe(t);
    expect(parseTimestamp('20200102')).toBe(Date.UTC(2020, 0, 2) / 1000);
    expect(parseTimestamp('Jan 2, 2020')).toBe(Date.UTC(2020, 0, 2) / 1000);
  });
});

describe('detectDateOrder', () => {
  it('decides from a value above 12', () => {
    expect(detectDateOrder(['01/02/2024', '25/02/2024'])).toBe('DMY');
    expect(detectDateOrder(['01/02/2024', '02/25/2024'])).toBe('MDY');
  });

  it('reports an ambiguous sample', () => {
    expect(detectDateOrder(['01/02/2024', '03/04/2024'])).toBeNull();
  });
});

describe('parseNumber', () => {
  it('handles decimal commas and thousands separators', () => {
    expect(parseNumber('1,0852')).toBe(1.0852);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('"2 450.5"')).toBe(2450.5);
    expect(parseNumber('abc')).toBeNaN();
  });
});

describe('splitRow — performance', () => {
  it('reste linéaire sur une ligne pleine de guillemets', () => {
    const line = 'a' + '"'.repeat(400_000);
    const started = performance.now();
    splitRow(line, ',');
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('parseNumber — conventions européennes', () => {
  it('lit un point de milliers et une virgule décimale', () => {
    expect(parseNumber('65.432,10')).toBe(65432.1);
    expect(parseNumber('1.234.567,5')).toBe(1234567.5);
  });
});
