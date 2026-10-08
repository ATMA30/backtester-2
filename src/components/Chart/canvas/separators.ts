/** Period separators layer of the drawing canvas. */

import { RenderContext } from './context';

/** Vertical separators at each period boundary (day, week, month…). */
export function drawPeriodSeparators(rc: RenderContext): void {
  const { ctx, dpr, width, height, startIdx, endIdx, displayCandles, toXY, separatorTF } = rc;
  if (separatorTF && displayCandles.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1 * dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);

    for (let i = startIdx; i <= endIdx; i++) {
      const prev = displayCandles[i - 1];
      const curr = displayCandles[i];
      const d0 = new Date(prev.time * 1000);
      const d1 = new Date(curr.time * 1000);

      let isBoundary = false;
      let label = '';

      if (separatorTF === '1D') {
        isBoundary = d1.getUTCDate() !== d0.getUTCDate() || curr.time - prev.time >= 86400;
        label = d1.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      } else if (separatorTF === '1W') {
        isBoundary = d1.getUTCDay() < d0.getUTCDay() || curr.time - prev.time >= 604800;
        label = `Semaine ${d1.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
      } else if (separatorTF === '1M') {
        isBoundary = d1.getUTCMonth() !== d0.getUTCMonth() || curr.time - prev.time >= 2592000;
        label = d1.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      } else if (separatorTF === '1Y') {
        isBoundary = d1.getUTCFullYear() !== d0.getUTCFullYear();
        label = `${d1.getUTCFullYear()}`;
      }

      if (isBoundary) {
        const p = toXY(curr.time, curr.close);
        if (p.x !== null && p.x >= 0 && p.x <= width) {
          ctx.beginPath();
          ctx.moveTo(p.x * dpr, 0);
          ctx.lineTo(p.x * dpr, height * dpr);
          ctx.stroke();

          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.font = `bold ${9 * dpr}px JetBrains Mono, monospace`;
          ctx.fillText(label, (p.x + 4) * dpr, (height - 8) * dpr);
        }
      }
    }
    ctx.restore();
  }
}
