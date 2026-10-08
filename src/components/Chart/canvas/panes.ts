/** Indicator pane boundaries layer of the drawing canvas. */

import { RenderContext } from './context';

/** Boundaries of the volume and oscillator panes. */
export function drawPaneSeparators(rc: RenderContext): void {
  const { ctx, dpr, width, height, activeIndicators } = rc;
  const rsiInd = activeIndicators.find((i) => i.type === 'RSI');
  const macdInd = activeIndicators.find((i) => i.type === 'MACD');
  const hasOscillator = Boolean(rsiInd || macdInd);

  // Oscillator Section divider (if active)
  if (hasOscillator) {
    const oscTopY = height * 0.785;

    // Dark background for oscillator pane
    ctx.fillStyle = 'rgba(11, 14, 20, 0.55)';
    ctx.fillRect(0, oscTopY * dpr, width * dpr, (height - oscTopY) * dpr);

    // Dividing line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, oscTopY * dpr);
    ctx.lineTo(width * dpr, oscTopY * dpr);
    ctx.stroke();

    // Title badge
    const label = rsiInd ? `RSI (${rsiInd.period || 14})` : `MACD (${macdInd?.period || 12}, 26)`;
    const badgeColor = rsiInd ? '#A78BFA' : '#3B82F6';

    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(8 * dpr, (oscTopY + 3) * dpr, 68 * dpr, 14 * dpr);
    ctx.strokeStyle = badgeColor;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(8 * dpr, (oscTopY + 3) * dpr, 68 * dpr, 14 * dpr);

    ctx.fillStyle = badgeColor;
    ctx.font = `bold ${8.5 * dpr}px JetBrains Mono, monospace`;
    ctx.fillText(label, 12 * dpr, (oscTopY + 13) * dpr);
  }
  ctx.restore();
}
