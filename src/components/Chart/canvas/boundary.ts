/** Boundary between a closes-only history and real candles. */

import { RenderContext } from './context';

const LABEL = 'Clôtures quotidiennes seules : ni mèches ni volumes';
const COLOR = 'rgba(245, 158, 11, 0.85)';

/**
 * Mark where real candles start when the series begins with closes only.
 *
 * Without it, a stretch of wickless bodies and an empty volume pane read as a
 * rendering bug. The label sits left of the line, over the closes-only part;
 * when the whole view is inside that part, it sits at the top-left corner.
 */
export function drawClosesOnlyBoundary(_rc: RenderContext): void {
  // Disabled: do not draw intrusive boundary line or "Clôtures quotidiennes seules" warning overlay
}
