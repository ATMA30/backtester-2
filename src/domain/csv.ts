/**
 * Delimited-text parsing for the dataset importer.
 *
 * Replaces `line.split(separator)`, which mis-parsed any row containing a
 * quoted field with the separator inside it (`"Company, Inc",1.05,…` shifted
 * every subsequent column by one) and detected the separator from the header
 * alone — a space-delimited file scored zero for every candidate and fell back
 * to a comma, yielding a single column and zero usable candles.
 */

export const SUPPORTED_DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof SUPPORTED_DELIMITERS)[number];

export interface CsvTable {
  readonly header: string[];
  readonly rows: string[][];
  readonly delimiter: Delimiter;
  /** False when the file had no header and positional names were supplied. */
  readonly hasHeader: boolean;
}

/**
 * Pick the delimiter that splits the sampled lines most consistently.
 * Consistency matters more than raw count: a price column full of decimal
 * commas can out-count the real delimiter on a single line.
 */
export function detectDelimiter(lines: readonly string[]): Delimiter {
  const sample = lines.slice(0, 20);
  let best: Delimiter = ',';
  let bestScore = -1;

  for (const delimiter of SUPPORTED_DELIMITERS) {
    const counts = sample.map((line) => splitRow(line, delimiter).length);
    const fields = counts[0] ?? 0;
    if (fields < 2) continue;

    const consistent = counts.filter((c) => c === fields).length;
    // Favour many columns, but only when most rows agree on the count.
    const score = consistent * 100 + fields;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/** Split one row, honouring RFC 4180 quoting (`""` is an escaped quote). */
export function splitRow(line: string, delimiter: Delimiter): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  // Suivi incrémental : `field.trim() === ''` à chaque guillemet rendait la
  // ligne quadratique ; 400 000 caractères de guillemets gelaient l'onglet 10 s.
  let fieldHasContent = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          fieldHasContent = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !fieldHasContent) {
      inQuotes = true;
      field = '';
    } else if (char === delimiter) {
      fields.push(field.trim());
      field = '';
      fieldHasContent = false;
    } else {
      field += char;
      if (char !== ' ' && char !== '\t') fieldHasContent = true;
    }
  }

  fields.push(field.trim());
  return fields;
}

/**
 * Parse delimited text into a header and rows.
 *
 * The first line is treated as a header only when it *looks* like one. MT4 and
 * most broker exports have no header at all: the first candle was consumed as
 * column names, the next ones were mapped positionally from the wrong offset —
 * `close` received the low — and nothing warned. A headerless file now gets
 * positional names (`date`, `time`, `open`…) and keeps its first row.
 *
 * @param maxRows Hard cap on retained rows, so a pathologically large file
 *   cannot exhaust memory during import.
 */
export function parseCsv(text: string, maxRows = 500_000): CsvTable {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [], delimiter: ',', hasHeader: true };

  const delimiter = detectDelimiter(lines);
  const first = splitRow(lines[0], delimiter).map(stripQuotes);
  const hasHeader = looksLikeHeader(first);
  const header = hasHeader ? first : positionalHeader(first);

  const rows: string[][] = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length && rows.length < maxRows; i++) {
    rows.push(splitRow(lines[i], delimiter));
  }

  return { header, rows, delimiter, hasHeader };
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

// ── VALUES ────────────────────────────────────────────────────

/**
 * Parse a numeric cell, tolerating quotes, `<>` wrappers, a decimal comma and
 * a thousands separator (`1,234.56`).
 */
export function parseNumber(value: unknown): number {
  if (value === undefined || value === null) return Number.NaN;
  let text = String(value).trim().replace(/['"<>\s]/g, '');
  if (!text) return Number.NaN;
  if (text.includes(',') && text.includes('.')) {
    // Le dernier séparateur est le décimal : `1,234.56` (US) comme `65.432,10`
    // (allemand, suisse, Excel FR). Supposer le sens US donnait NaN au second,
    // et une clôture NaN rejetait toute la ligne.
    text =
      text.lastIndexOf(',') > text.lastIndexOf('.')
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
  } else {
    text = text.replace(',', '.');
  }
  return Number(text);
}

/** Order of day and month in `xx/xx/yyyy` dates. */
export type DateOrder = 'DMY' | 'MDY';

const SLASH_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(.*)$/;

/**
 * Decide, once for the whole file, whether `03/04/2024` is the 3rd of April or
 * the 4th of March.
 *
 * The importer used to guess per row: DMY first, and when that failed (day
 * > 12) `new Date(string)` — which reads MDY *in local time*. A US file thus
 * mixed both readings, and sorting then shuffled the candles silently.
 *
 * @returns the order proven by a value above 12, or `null` when the sample is
 *   ambiguous (every part ≤ 12) or contradicts itself.
 */
export function detectDateOrder(values: readonly string[]): DateOrder | null {
  let dmy = 0;
  let mdy = 0;
  for (const value of values) {
    const match = SLASH_DATE.exec(String(value).trim().replace(/['"<>]/g, ''));
    if (!match) continue;
    if (Number(match[1]) > 12) dmy++;
    if (Number(match[2]) > 12) mdy++;
  }
  if (dmy > 0 && mdy === 0) return 'DMY';
  if (mdy > 0 && dmy === 0) return 'MDY';
  return null;
}

/** True when the sample holds `xx/xx/yyyy` dates at all. */
export function hasSlashDates(values: readonly string[]): boolean {
  return values.some((v) => SLASH_DATE.test(String(v).trim().replace(/['"<>]/g, '')));
}

const pad2 = (value: string): string => value.padStart(2, '0');

/**
 * Parse a timestamp cell to epoch seconds (UTC), or `null`.
 *
 * Accepted: Unix seconds or milliseconds, `YYYYMMDD`, ISO 8601,
 * `YYYY.MM.DD[ HH:MM[:SS]]`, `YYYY/MM/DD…`, `DD/MM/YYYY…` or `MM/DD/YYYY…`
 * according to `dateOrder`, and textual months (`Jan 15, 2023`). Anything
 * without an explicit zone is read as UTC — never in the reader's local time,
 * which shifted every candle by the user's offset.
 */
export function parseTimestamp(value: unknown, dateOrder: DateOrder = 'DMY'): number | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().replace(/['"<>]/g, '');
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 900_000_000 && n < 2_500_000_000) return Math.floor(n);
    if (n >= 900_000_000_000 && n < 2_500_000_000_000) return Math.floor(n / 1000);
    if (/^\d{8}$/.test(s)) return parseTimestamp(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
    return null;
  }

  let iso = s.replace(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/, (_, y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`);

  const slash = SLASH_DATE.exec(iso);
  if (slash) {
    const [day, month] = dateOrder === 'DMY' ? [slash[1], slash[2]] : [slash[2], slash[1]];
    if (Number(month) > 12 || Number(day) > 31) return null;
    iso = `${slash[3]}-${pad2(month)}-${pad2(day)}${slash[4]}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    iso = iso.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T').replace(/T(\d):/, 'T0$1:');
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00:00';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso += ':00';
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso += 'Z';
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }

  // Textual month names: read as UTC unless the text names a zone.
  if (/[a-z]{3}/i.test(s)) {
    const hasZone = /(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})$/i.test(s);
    const ms = Date.parse(hasZone ? s : `${s} UTC`);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }

  return null;
}

// ── HEADER DETECTION ──────────────────────────────────────────

/** A cell that reads as a column name: letters, and neither a number nor a date. */
function isHeaderLikeCell(cell: string): boolean {
  const text = cell.trim();
  if (!text || !/[a-z]/i.test(text)) return false;
  return Number.isNaN(parseNumber(text)) && parseTimestamp(text) === null;
}

/** True when a first row is a header rather than a first candle. */
export function looksLikeHeader(cells: readonly string[]): boolean {
  const filled = cells.filter((c) => c.trim().length > 0);
  if (filled.length === 0) return false;
  const named = filled.filter(isHeaderLikeCell).length;
  return named * 2 >= filled.length;
}

/**
 * Column names for a headerless file, from the shape of its first row.
 * `date,time,O,H,L,C,V` (MT4) when the second cell is a clock time, otherwise
 * `date,O,H,L,C,V`. Extra columns are named by position.
 */
export function positionalHeader(firstRow: readonly string[]): string[] {
  const hasClock = /^\d{1,2}:\d{2}(:\d{2})?$/.test((firstRow[1] ?? '').trim());
  const names = hasClock
    ? ['date', 'time', 'open', 'high', 'low', 'close', 'volume']
    : ['date', 'open', 'high', 'low', 'close', 'volume'];
  return firstRow.map((_, i) => names[i] ?? `col${i + 1}`);
}

/** Column roles the importer maps onto. */
export type ColumnRole = 'date' | 'time' | 'open' | 'high' | 'low' | 'close' | 'volume';

/**
 * Header aliases per role, most specific first.
 *
 * Single-letter aliases are matched only on an exact header name. The previous
 * matcher accepted any header that merely *started or ended* with an alias, so
 * `open_time` was picked as the opening **price** (it starts with `o`) and every
 * row was then discarded as non-numeric.
 */
const COLUMN_ALIASES: Readonly<Record<ColumnRole, readonly string[]>> = {
  date: ['date', 'timestamp', 'datetime', 'opentime', 'open_time', 'gmt_time', 'time_utc', 'ts', 'dt'],
  time: ['time', 'heure', 'hour', 'timestamp_time'],
  open: ['open', 'openprice', 'open_price', 'ouverture', 'ouv', 'first', 'o'],
  high: ['high', 'highprice', 'high_price', 'haut', 'maximum', 'max', 'h'],
  low: ['low', 'lowprice', 'low_price', 'bas', 'minimum', 'min', 'l'],
  close: ['close', 'closeprice', 'close_price', 'cloture', 'clot', 'last', 'price', 'c'],
  volume: ['volume', 'tick_volume', 'tickvol', 'quantite', 'volum', 'vol', 'qty', 'v'],
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/** Score a header against a role: 3 exact, 2 prefix, 1 contains, 0 no match. */
function scoreHeader(header: string, role: ColumnRole): number {
  const normalized = normalizeHeader(header);
  if (!normalized) return 0;

  for (const alias of COLUMN_ALIASES[role]) {
    const key = normalizeHeader(alias);
    if (normalized === key) return 3;
    // Single letters are far too ambiguous for anything but an exact match:
    // `count` would otherwise resolve to `close`.
    if (key.length === 1) continue;
    if (normalized.startsWith(key) || normalized.endsWith(key)) return 2;
    if (normalized.includes(key)) return 1;
  }
  return 0;
}

/**
 * Best header for a role, or `null` when nothing matches.
 * `exclude` keeps a header (typically the date column) from being reused.
 */
export function matchColumn(
  header: readonly string[],
  role: ColumnRole,
  exclude: readonly string[] = []
): string | null {
  let best: string | null = null;
  let bestScore = 0;

  for (const candidate of header) {
    if (exclude.includes(candidate)) continue;
    const score = scoreHeader(candidate, role);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Map every role at once.
 *
 * OHLC roles no alias matched fall back to the columns nobody claimed, in
 * order — never to a fixed offset. `header[1]` as "open" picked the time
 * column whenever a file had a separate one.
 */
export function inferColumnMapping(header: readonly string[]): Record<ColumnRole, string> {
  const date = matchColumn(header, 'date') ?? header[0] ?? '';
  const time = matchColumn(header, 'time', [date]) ?? '';
  const claimed = [date, time].filter(Boolean);

  const named: Partial<Record<ColumnRole, string>> = {};
  for (const role of ['open', 'high', 'low', 'close', 'volume'] as const) {
    const found = matchColumn(header, role, claimed);
    if (found) {
      named[role] = found;
      claimed.push(found);
    }
  }

  const unclaimed = header.filter((h) => !claimed.includes(h));
  const next = (): string => unclaimed.shift() ?? '';

  return {
    date,
    time,
    open: named.open ?? next(),
    high: named.high ?? next(),
    low: named.low ?? next(),
    close: named.close ?? next(),
    volume: named.volume ?? '',
  };
}
