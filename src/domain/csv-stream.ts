/**
 * Lecture en flux d'un CSV de bougies.
 *
 * Le chemin d'import classique fait `await file.text()` puis `split(/\r?\n/)` :
 * un fichier de 324 Mo devient une chaîne UTF-16 de ~650 Mo, puis un tableau de
 * 6,6 millions de chaînes. L'onglet meurt avant la première bougie. C'est
 * pourquoi une limite de taille existait — mais refuser un historique 1 minute
 * sur vingt ans revient à refuser l'usage même d'un backtester.
 *
 * Ici le fichier est consommé par morceaux : on ne garde jamais plus qu'un
 * tampon de ligne partielle et les bougies retenues.
 */

import { Candle } from '../types/market';
import { aggregateCandles, detectBaseTF, sanitizeCandles, RawCandleLike } from './candles';
import { TIMEFRAME_VALUES } from './timeframes';
import {
  Delimiter,
  detectDelimiter,
  splitRow,
  inferColumnMapping,
  ColumnRole,
  looksLikeHeader,
  positionalHeader,
  parseNumber,
} from './csv';

/** Longueur maximale d'une ligne : une bougie tient en moins de 200 caractères. */
const MAX_LINE_CHARS = 1_000_000;

/** Taille du lot assaini d'un coup, pour amortir le coût de `sanitizeCandles`. */
const FLUSH_EVERY = 50_000;

export interface StreamCsvOptions {
  /**
   * Nombre maximal de bougies conservées en mémoire.
   *
   * Mesuré : 2 millions de bougies occupent ~2,1 Go de tas pour une limite
   * moteur de ~4,2 Go, et 6,6 millions font tomber l'onglet.
   */
  readonly maxCandles?: number;
  /**
   * Que faire au-delà du plafond.
   *
   * `'downsample'` (défaut) agrège vers l'unité de temps supérieure et conserve
   * **toute la période** du fichier ; `'truncate'` ne garde que les bougies les
   * plus récentes. Perdre vingt ans d'historique pour préserver la minute est
   * rarement le bon arbitrage sur un fichier d'archive.
   */
  readonly overflow?: 'downsample' | 'truncate';
  /** Appelé périodiquement avec le nombre de lignes lues. */
  readonly onProgress?: (linesRead: number) => void;
  readonly signal?: AbortSignal;
  /**
   * Column mapping confirmed by the user in the preview step. Without it the
   * mapping is inferred from the header — the same inference, but unchecked.
   */
  readonly mapping?: Readonly<Record<ColumnRole, string>>;
}

/** First line that could not be read, to tell the user *why* instead of how many. */
export interface RejectedSample {
  /** 1-based line number in the file, header included. */
  readonly line: number;
  readonly text: string;
  readonly reason: 'date' | 'close';
}

export interface StreamCsvResult {
  readonly candles: Candle[];
  readonly linesRead: number;
  /** Lignes écartées faute de champs exploitables. */
  readonly linesRejected: number;
  /** True quand `maxCandles` a forcé l'abandon des bougies les plus anciennes. */
  readonly truncated: boolean;
  /**
   * True quand `signal` a interrompu la lecture avant la fin du fichier.
   *
   * Sans ce drapeau, une lecture annulée renvoyait des bougies partielles
   * exactement comme une lecture complète : l'appelant annonçait « importé »
   * sur un fragment, et rien ne distinguait les deux.
   */
  readonly aborted: boolean;
  /** Résolution finale en secondes ; supérieure à celle du fichier si agrégé. */
  readonly resolutionSeconds: number;
  /** Résolution d'origine détectée dans le fichier. */
  readonly sourceResolutionSeconds: number;
  readonly header: string[];
  /** False when the file had no header row (MT4 exports, for instance). */
  readonly hasHeader: boolean;
  readonly delimiter: Delimiter;
  readonly firstRejected: RejectedSample | null;
}

/**
 * Lit `file` ligne par ligne et renvoie les bougies exploitables.
 *
 * @param parseTimestamp Analyseur de date fourni par l'appelant, pour ne pas
 *   dupliquer ici les formats déjà gérés par l'import.
 */
export async function streamCsvCandles(
  file: File,
  parseTimestamp: (value: unknown) => number | null,
  options: StreamCsvOptions = {}
): Promise<StreamCsvResult> {
  const { maxCandles = 500_000, overflow = 'downsample', onProgress, signal, mapping } = options;

  let buffer = '';
  let header: string[] = [];
  let hasHeader = true;
  let firstRejected: RejectedSample | null = null;
  let delimiter: Delimiter = ',';
  let indices: Record<ColumnRole, number> | null = null;

  let linesRead = 0;
  let linesRejected = 0;
  let truncated = false;
  let aborted = false;
  /** Octets de texte déjà consommés, pour estimer la taille totale. */
  let bytesRead = 0;

  let pending: RawCandleLike[] = [];
  let candles: Candle[] = [];

  /** Résolution courante du tableau accumulé, en secondes. */
  let resolution = 0;
  let sourceResolution = 0;
  /**
   * Résolution cible décidée une fois pour toutes, depuis une estimation du
   * nombre total de lignes.
   *
   * Agréger au fil de l'eau sur-agrège : chaque dépassement du plafond déclenche
   * un palier supplémentaire, irréversible, alors que le fichier n'est lu qu'en
   * partie. Mesuré sur 6,6 M de lignes 1 minute, cela terminait en 2 h là où une
   * seule passe suffit pour tenir en 5 min.
   */
  let plannedResolution = 0;

  /** Estimation du nombre total de lignes, d'après la taille du fichier. */
  const estimateTotalLines = (bytesRead: number, linesSeen: number): number => {
    if (linesSeen === 0 || bytesRead === 0) return 0;
    return Math.round((file.size / bytesRead) * linesSeen);
  };

  /**
   * Vide le tampon dans le tableau accumulé.
   *
   * Le lot entrant est ramené à la résolution cible **avant** d'être fusionné.
   * Sans cela, les bougies brutes s'accumulaient à la résolution du fichier,
   * refaisaient déborder le plafond, et chaque débordement montait d'un palier :
   * un fichier 1 minute finissait en 4 h là où 15 min suffisait.
   */
  const flush = () => {
    if (pending.length === 0) return;

    const clean = sanitizeCandles(pending);
    pending = [];
    if (clean.length === 0) return;

    const batch =
      plannedResolution > sourceResolution && sourceResolution > 0
        ? aggregateCandles(clean, plannedResolution, sourceResolution)
        : clean;

    candles = mergeBatch(candles, batch);

    if (candles.length <= maxCandles) return;

    if (overflow === 'truncate') {
      candles.splice(0, candles.length - maxCandles);
      truncated = true;
      return;
    }

    // Un petit fichier n'atteint jamais le lot de planification : c'est ici
    // qu'on apprend sa résolution d'origine, avant de la faire monter.
    if (sourceResolution === 0 && candles.length >= 2) {
      sourceResolution = detectBaseTF(candles, TIMEFRAME_VALUES);
    }
    if (resolution === 0) resolution = sourceResolution;

    // Repli si l'estimation initiale s'est révélée trop optimiste : on monte
    // d'un palier à la fois jusqu'à tenir.
    while (candles.length > maxCandles) {
      const next = TIMEFRAME_VALUES.find((tf) => tf > resolution);
      if (next === undefined) {
        candles.splice(0, candles.length - maxCandles);
        truncated = true;
        return;
      }
      candles = aggregateCandles(candles, next, resolution);
      resolution = next;
      plannedResolution = next;
    }
  };

  const headerLines: string[] = [];

  const consumeLine = (line: string) => {
    if (!line.trim()) return;

    // Les premières lignes servent à détecter le séparateur de façon fiable.
    if (headerLines.length < 8 && header.length === 0) {
      headerLines.push(line);
      if (headerLines.length < 8) return;

      resolveHeader();
      return;
    }

    consumeDataLine(line);
  };

  /** Pick delimiter, header and column indices from the buffered first lines. */
  function resolveHeader() {
    delimiter = detectDelimiter(headerLines);
    const first = splitRow(headerLines[0], delimiter).map((h) => h.replace(/^["']|["']$/g, ''));
    hasHeader = looksLikeHeader(first);
    header = hasHeader ? first : positionalHeader(first);
    // Le mappage confirmé ne vaut que pour un fichier du même format : sur un
    // autre en-tête (import multi-fichiers), on retombe sur l'inférence.
    const fits = mapping && Object.values(mapping).every((name) => !name || header.includes(name));
    const roles = fits && mapping ? mapping : inferColumnMapping(header);
    const at = (name: string) => (name ? header.indexOf(name) : -1);
    const dateIdx = at(roles.date);
    const timeIdx = at(roles.time);
    indices = {
      date: dateIdx,
      // Jamais « date + date » quand la colonne heure est la colonne date.
      time: timeIdx === dateIdx ? -1 : timeIdx,
      open: at(roles.open),
      high: at(roles.high),
      low: at(roles.low),
      close: at(roles.close),
      volume: at(roles.volume),
    };
    // Les lignes tamponnées sont de vraies données — la première aussi quand le
    // fichier n'a pas d'en-tête.
    for (const buffered of hasHeader ? headerLines.slice(1) : headerLines) consumeDataLine(buffered);
  }

  function consumeDataLine(line: string) {
    if (!indices) return;
    linesRead++;

    const cells = splitRow(line, delimiter);
    const dateCell = cells[indices.date];
    const stamp =
      indices.time !== -1 && cells[indices.time] ? `${dateCell} ${cells[indices.time]}` : dateCell;

    const time = parseTimestamp(stamp);
    const close = parseNumber(cells[indices.close]);
    if (time === null || !Number.isFinite(close)) {
      linesRejected++;
      firstRejected ??= {
        line: linesRead + (hasHeader ? 1 : 0),
        text: line.slice(0, 120),
        reason: time === null ? 'date' : 'close',
      };
      return;
    }

    pending.push({
      time,
      open: parseNumber(cells[indices.open]),
      high: parseNumber(cells[indices.high]),
      low: parseNumber(cells[indices.low]),
      close,
      volume: indices.volume !== -1 ? parseNumber(cells[indices.volume]) || 0 : 0,
    });

    if (pending.length >= FLUSH_EVERY) {
      // Une fois le premier lot connu, on sait combien de lignes contient le
      // fichier et donc quelle résolution finale visera l'import.
      if (plannedResolution === 0 && bytesRead > 0) {
        const total = estimateTotalLines(bytesRead, linesRead);
        const sample = sanitizeCandles(pending.slice(0, 200));
        const detected = sample.length >= 2 ? detectBaseTF(sample, TIMEFRAME_VALUES) : 0;

        if (detected > 0 && total > maxCandles && overflow === 'downsample') {
          const factorNeeded = total / maxCandles;
          plannedResolution =
            TIMEFRAME_VALUES.find((tf) => tf >= detected * factorNeeded) ??
            TIMEFRAME_VALUES[TIMEFRAME_VALUES.length - 1];
        }
        if (detected > 0) {
          sourceResolution = sourceResolution || detected;
          resolution = plannedResolution > 0 ? plannedResolution : detected;
        }
      }

      flush();
      onProgress?.(linesRead);
    }
  }

  for await (const chunk of readTextChunks(file, signal)) {
    // `text.length` compte des unités UTF-16 ; `file.size` compte des octets.
    // Rapporter l'un à l'autre surestimait le nombre total de lignes sur tout
    // fichier non-ASCII, et la résolution cible partait un palier trop haut.
    bytesRead += chunk.bytes;
    // `\r` seul termine aussi une ligne (anciens exports Mac). Un CRLF coupé
    // entre deux morceaux produit au pire une ligne vide, ignorée.
    buffer += chunk.text.replace(/\r\n?/g, '\n');
    let newlineAt = buffer.indexOf('\n');
    while (newlineAt !== -1) {
      const line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      consumeLine(line);
      newlineAt = buffer.indexOf('\n');
    }
    // Sans saut de ligne, le tampon grossissait jusqu'à ~1 Go avant de lever.
    if (buffer.length > MAX_LINE_CHARS) {
      throw new Error(`Ligne de plus de ${MAX_LINE_CHARS.toLocaleString('fr-FR')} caractères : ce fichier n'est pas un CSV de bougies.`);
    }
  }

  {
    // Dernière ligne sans saut final, puis en-tête jamais résolu (fichier court).
    if (buffer.trim()) consumeLine(buffer.replace(/\r$/, ''));
    if (header.length === 0 && headerLines.length > 0) resolveHeader();

    flush();
  }

  if (signal?.aborted) aborted = true;

  if (resolution === 0 && candles.length >= 2) {
    resolution = detectBaseTF(candles, TIMEFRAME_VALUES);
    sourceResolution = resolution;
  }

  return {
    candles,
    linesRead,
    linesRejected,
    truncated,
    aborted,
    header,
    hasHeader,
    delimiter,
    firstRejected,
    resolutionSeconds: resolution,
    sourceResolutionSeconds: sourceResolution || resolution,
  };
}

/**
 * Fusionne un lot trié dans l'accumulateur trié.
 *
 * Un lot entièrement postérieur est ajouté en queue, un lot entièrement
 * antérieur en tête. Le second cas est celui des exports triés du plus récent
 * au plus ancien (Investing.com, par exemple) : chaque lot y précède le
 * précédent, et l'ancienne version l'ignorait purement et simplement — un
 * fichier de 2 M de lignes en gardait 50 000, annoncées comme un succès.
 * Un lot qui chevauche l'accumulateur (fichier en désordre) passe par un tri
 * complet.
 */
export function mergeBatch(candles: Candle[], batch: Candle[]): Candle[] {
  if (batch.length === 0) return candles;
  const first = candles[0];
  const last = candles[candles.length - 1];
  const batchFirst = batch[0];
  const batchLast = batch[batch.length - 1];

  if (!last || batchFirst.time > last.time) {
    for (const candle of batch) candles.push(candle);
    return candles;
  }

  if (batchFirst.time === last.time) {
    // Même intervalle à cheval sur deux lots : fusionner, sans écraser
    // l'ouverture déjà enregistrée.
    foldInto(last, batchFirst);
    for (let i = 1; i < batch.length; i++) candles.push(batch[i]);
    return candles;
  }

  if (batchLast.time < first.time) return batch.concat(candles);

  if (batchLast.time === first.time) {
    // Même chevauchement, dans l'autre sens : le lot porte l'ouverture.
    const merged = { ...batchLast };
    foldInto(merged, first);
    return batch.slice(0, -1).concat([merged], candles.slice(1));
  }

  return sanitizeCandles(candles.concat(batch));
}

/** Étend `into` (plus ancien) avec `later` (même intervalle, plus récent). */
function foldInto(into: Candle, later: Candle): void {
  if (later.high > into.high) into.high = later.high;
  if (later.low < into.low) into.low = later.low;
  into.close = later.close;
  into.volume += later.volume;
}

/** Taille des morceaux lus quand `Blob.stream()` n'est pas disponible. */
const SLICE_BYTES = 4 * 1024 * 1024;

/**
 * Découpe le fichier en morceaux de texte décodés.
 *
 * `Blob.stream()` est le chemin rapide, mais il manque sur les Safari plus
 * anciens et sous jsdom. Le repli par `slice()` lit le même fichier morceau par
 * morceau sans jamais le matérialiser en entier — le décodeur est conservé
 * entre les morceaux pour recoller les caractères multi-octets coupés à la
 * frontière.
 */
async function* readTextChunks(
  file: File,
  signal?: AbortSignal
): AsyncGenerator<{ text: string; bytes: number }> {
  const decoder = new TextDecoder('utf-8');

  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    try {
      for (;;) {
        if (signal?.aborted) return;
        const { done, value } = await reader.read();
        if (done) break;
        yield { text: decoder.decode(value, { stream: true }), bytes: value.byteLength };
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    for (let offset = 0; offset < file.size; offset += SLICE_BYTES) {
      if (signal?.aborted) return;
      const end = Math.min(offset + SLICE_BYTES, file.size);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      yield { text: decoder.decode(bytes, { stream: true }), bytes: bytes.byteLength };
    }
  }

  const rest = decoder.decode();
  if (rest) yield { text: rest, bytes: 0 };
}
