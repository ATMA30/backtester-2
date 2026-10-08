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
export function drawClosesOnlyBoundary(rc: RenderContext): void {
  const { ctx, dpr, width, toXY, displayCandles, closesOnlyBefore } = rc;
  if (closesOnlyBefore === null || displayCandles.length === 0) return;

  const refPrice = displayCandles[displayCandles.length - 1].close;
  const x = toXY(closesOnlyBefore, refPrice).x;
  // Boundary left of the view: everything shown is real, nothing to say.
  if (x !== null && x < 0) return;

  ctx.save();
  ctx.font = `600 ${10.5 * dpr}px Inter, sans-serif`;
  const textWidth = ctx.measureText(LABEL).width / dpr;
  const plotRight = width - 70;

  let labelX: number;
  if (x === null || x > plotRight) {
    labelX = 12;
  } else {
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([5 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(x * dpr, 0);
    ctx.lineTo(x * dpr, rc.height * dpr);
    ctx.stroke();
    ctx.setLineDash([]);
    labelX = Math.max(12, x - textWidth - 22);
  }

  const y = 12;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fillRect(labelX * dpr, y * dpr, (textWidth + 16) * dpr, 20 * dpr);
  ctx.fillStyle = COLOR;
  ctx.fillText(LABEL, (labelX + 8) * dpr, (y + 14) * dpr);
  ctx.restore();
}
