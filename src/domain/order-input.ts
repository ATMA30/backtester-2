/**
 * What the order ticket's fields mean: an entry price, a stop or a target
 * typed as a price, an offset in pips (`30p`) or a percentage (`1.5%`).
 *
 * Pure functions of the typed text, so the rules the trader relies on can be
 * read and tested apart from the replay bar.
 */

/**
 * Result of interpreting a price field.
 *
 * The previous implementation guessed between "absolute price" and "pips" with
 * a magnitude heuristic (`num > entry * 0.2 && num < entry * 5` meant price).
 * On EUR/USD that band is [0.217, 5.425], so a trader typing `5` for "5 pips"
 * silently got a stop at the absolute price 5.00 — a level the market never
 * reaches, i.e. a position with no protection at all while the UI claimed one.
 *
 * Interpretation is now explicit: a `p` / `pip` / `pips` suffix means an offset
 * in pips, a `%` suffix means a percentage of entry, anything else is an
 * absolute price. Nothing is inferred from magnitude, and unusable input
 * surfaces an error instead of a silent, wrong order.
 */
export type PriceField =
  | { readonly kind: 'empty' }
  | { readonly kind: 'value'; readonly price: number }
  | { readonly kind: 'error'; readonly message: string };

export const EMPTY_FIELD: PriceField = { kind: 'empty' };

const BLANK_TOKENS = new Set(['', '—', '-', 'marché', 'marche', 'market']);

/** Strip formatting and detect the unit suffix. */
function readNumericInput(raw: string): { value: number; unit: 'price' | 'pips' | 'percent' } | null {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
  if (!cleaned) return null;

  const pipMatch = cleaned.match(/^([+-]?\d*\.?\d+)(?:p|pip|pips)$/);
  if (pipMatch) {
    const value = Number(pipMatch[1]);
    return Number.isFinite(value) ? { value, unit: 'pips' } : null;
  }

  const pctMatch = cleaned.match(/^([+-]?\d*\.?\d+)%$/);
  if (pctMatch) {
    const value = Number(pctMatch[1]);
    return Number.isFinite(value) ? { value, unit: 'percent' } : null;
  }

  // Strict: `Number` rejects trailing garbage that `parseFloat` would swallow
  // (`parseFloat('1.2abc')` === 1.2), which previously produced silent misreads.
  const value = Number(cleaned);
  return Number.isFinite(value) ? { value, unit: 'price' } : null;
}

/** Parse the entry field: blank means "at market". */
export function parseEntryInput(input: string): PriceField {
  if (BLANK_TOKENS.has(input.trim().toLowerCase())) return EMPTY_FIELD;
  const parsed = readNumericInput(input);
  if (!parsed) return { kind: 'error', message: 'Prix d’entrée illisible.' };
  if (parsed.unit !== 'price') {
    return { kind: 'error', message: 'Le prix d’entrée doit être un prix absolu.' };
  }
  if (parsed.value <= 0) return { kind: 'error', message: 'Le prix d’entrée doit être positif.' };
  return { kind: 'value', price: parsed.value };
}

/**
 * Parse a stop-loss or take-profit field.
 * A pips/percent offset is applied in the protective direction for the side,
 * so `30p` is always 30 pips *away* from entry on the correct side.
 */
export function parseProtectionInput(
  input: string,
  target: 'sl' | 'tp',
  isLong: boolean,
  entry: number,
  pip: number
): PriceField {
  if (BLANK_TOKENS.has(input.trim().toLowerCase())) return EMPTY_FIELD;

  const parsed = readNumericInput(input);
  if (!parsed) {
    return { kind: 'error', message: `${target.toUpperCase()} illisible : saisissez un prix, « 30p » ou « 1.5% ».` };
  }
  if (!Number.isFinite(entry) || entry <= 0) {
    return { kind: 'error', message: 'Prix d’entrée indisponible pour calculer un décalage.' };
  }

  if (parsed.unit === 'price') {
    if (parsed.value <= 0) {
      return { kind: 'error', message: `${target.toUpperCase()} invalide : le prix doit être positif.` };
    }
    return { kind: 'value', price: parsed.value };
  }

  const distance =
    parsed.unit === 'pips' ? Math.abs(parsed.value) * pip : (Math.abs(parsed.value) / 100) * entry;
  if (distance <= 0) {
    return { kind: 'error', message: `${target.toUpperCase()} invalide : le décalage doit être non nul.` };
  }

  // A stop sits below entry for a long and above for a short; a target is the mirror.
  const below = target === 'sl' ? isLong : !isLong;
  return { kind: 'value', price: below ? entry - distance : entry + distance };
}

/** Price when the field holds one, otherwise null (blank or invalid). */
export function priceOf(field: PriceField): number | null {
  return field.kind === 'value' ? field.price : null;
}

/**
 * Read a numeric input, keeping the previous value while the field is being
 * retyped.
 *
 * `parseFloat(v) || 1` collapsed two different situations onto the literal 1:
 * an emptied field (mid-edit) and a genuine `0`. Clearing the volume box to
 * type `0.5` therefore committed 1 lot for one keystroke, and `0` was
 * unreachable — the documented `||`-erases-zeros trap.
 */
export function readPositiveNumber(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
