/**
 * Collision-free identifiers for trades, orders and drawings.
 *
 * The codebase previously used `'trade_' + Date.now()` in a dozen places. Two
 * objects created within the same millisecond — routine when a pending order is
 * filled in the same tick as a drawing is placed, or when a loop creates several
 * — shared an id, so `removeDrawing(id)` deleted both and `updatePendingOrder(id)`
 * edited both.
 */

let counter = 0;

/** Fallback for environments without `crypto.randomUUID` (older Safari, jsdom). */
function fallbackId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
}

/** Unique id, optionally namespaced (`newId('trade')` → `trade_…`). */
export function newId(prefix?: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : fallbackId();
  return prefix ? `${prefix}_${uuid}` : uuid;
}
