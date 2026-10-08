/** User drawings layer of the drawing canvas, and the live creation preview. */

import { RenderContext } from './context';
import { channelRails, makeChannelPoints } from '../../../domain/geometry';

/** Every saved drawing, selection handles included. */
export function drawDrawings(rc: RenderContext): void {
  const { ctx, dpr, width, height, toXY, instrument, drawings, selectedDrawingId } = rc;
  drawings.forEach((d) => {
    if (d.hidden) return;
    const isSelected = d.id === selectedDrawingId;
    ctx.save();
    ctx.strokeStyle = d.style.color || '#3B82F6';
    ctx.lineWidth = (d.style.width || 2) * dpr;
    ctx.fillStyle = d.style.fill || 'transparent';

    if (d.type === 'trendline' && d.pts.length >= 2) {
      const p0 = toXY(d.pts[0].time, d.pts[0].price);
      const p1 = toXY(d.pts[1].time, d.pts[1].price);
      if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
        ctx.beginPath();
        ctx.moveTo(p0.x * dpr, p0.y * dpr);
        ctx.lineTo(p1.x * dpr, p1.y * dpr);
        ctx.stroke();
      }
    } else if (d.type === 'channel' && d.pts.length >= 2) {
      // Parallel channel: baseline, a rail offset by a constant *price*
      // distance, the band between them, and a dashed median.
      const rails = channelRails(d.pts);
      if (rails) {
        const a0 = toXY(rails.baseline[0].time, rails.baseline[0].price);
        const a1 = toXY(rails.baseline[1].time, rails.baseline[1].price);
        const b0 = toXY(rails.parallel[0].time, rails.parallel[0].price);
        const b1 = toXY(rails.parallel[1].time, rails.parallel[1].price);

        const hasAll =
          a0.x !== null && a0.y !== null && a1.x !== null && a1.y !== null &&
          b0.x !== null && b0.y !== null && b1.x !== null && b1.y !== null;

        if (hasAll) {
          const ax0 = a0.x! * dpr, ay0 = a0.y! * dpr;
          const ax1 = a1.x! * dpr, ay1 = a1.y! * dpr;
          const bx0 = b0.x! * dpr, by0 = b0.y! * dpr;
          const bx1 = b1.x! * dpr, by1 = b1.y! * dpr;

          ctx.beginPath();
          ctx.moveTo(ax0, ay0);
          ctx.lineTo(ax1, ay1);
          ctx.lineTo(bx1, by1);
          ctx.lineTo(bx0, by0);
          ctx.closePath();
          ctx.fillStyle = d.style.fill || 'rgba(59, 130, 246, 0.12)';
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(ax0, ay0);
          ctx.lineTo(ax1, ay1);
          ctx.moveTo(bx0, by0);
          ctx.lineTo(bx1, by1);
          ctx.stroke();

          ctx.save();
          ctx.setLineDash([5 * dpr, 5 * dpr]);
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = Math.max(1, (d.style.width || 2) * 0.6) * dpr;
          ctx.beginPath();
          ctx.moveTo((ax0 + bx0) / 2, (ay0 + by0) / 2);
          ctx.lineTo((ax1 + bx1) / 2, (ay1 + by1) / 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    } else if (d.type === 'ray' && d.pts.length >= 2) {
      const p0 = toXY(d.pts[0].time, d.pts[0].price);
      const p1 = toXY(d.pts[1].time, d.pts[1].price);
      if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const extX = p0.x + dx * 50;
        const extY = p0.y + dy * 50;
        ctx.beginPath();
        ctx.moveTo(p0.x * dpr, p0.y * dpr);
        ctx.lineTo(extX * dpr, extY * dpr);
        ctx.stroke();
      }
    } else if (d.type === 'hline' && d.pts.length >= 1) {
      const p = toXY(d.pts[0].time, d.pts[0].price);
      if (p.y !== null) {
        ctx.beginPath();
        ctx.moveTo(0, p.y * dpr);
        ctx.lineTo(width * dpr, p.y * dpr);
        ctx.stroke();

        ctx.fillStyle = d.style.color || '#2563EB';
        ctx.font = `600 ${10 * dpr}px Inter, sans-serif`;
        // `toFixed(5)` printed an hline on gold as "2451.32000"; every other
        // label in this file already uses the instrument's own precision.
        ctx.fillText(d.pts[0].price.toFixed(instrument.decimals), (width - 70) * dpr, (p.y - 4) * dpr);
      }
    } else if (d.type === 'vline' && d.pts.length >= 1) {
      const p = toXY(d.pts[0].time, d.pts[0].price);
      if (p.x !== null) {
        ctx.beginPath();
        ctx.moveTo(p.x * dpr, 0);
        ctx.lineTo(p.x * dpr, height * dpr);
        ctx.stroke();

        const dObj = new Date(d.pts[0].time * 1000);
        const tLabel = dObj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        ctx.fillStyle = d.style.color || '#2563EB';
        ctx.font = `600 ${9 * dpr}px Inter, sans-serif`;
        ctx.fillText(tLabel, (p.x + 4) * dpr, 20 * dpr);
      }
    } else if (d.type === 'rect' && d.pts.length >= 2) {
      const p0 = toXY(d.pts[0].time, d.pts[0].price);
      const p1 = toXY(d.pts[1].time, d.pts[1].price);
      if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
        const rx = Math.min(p0.x, p1.x) * dpr;
        const ry = Math.min(p0.y, p1.y) * dpr;
        const rw = Math.abs(p1.x - p0.x) * dpr;
        const rh = Math.abs(p1.y - p0.y) * dpr;

        ctx.fillStyle = d.style.fill || 'rgba(59, 130, 246, 0.12)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);
      }
    } else if (d.type === 'fib' && d.pts.length >= 2) {
      const p0 = toXY(d.pts[0].time, d.pts[0].price);
      const p1 = toXY(d.pts[1].time, d.pts[1].price);
      if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
        const levels = [
          { lvl: 0, label: '0.0%', color: '#94A3B8', fill: 'rgba(148, 163, 184, 0.04)' },
          { lvl: 0.236, label: '23.6%', color: '#F43F5E', fill: 'rgba(244, 63, 94, 0.05)' },
          { lvl: 0.382, label: '38.2%', color: '#F59E0B', fill: 'rgba(245, 158, 11, 0.06)' },
          { lvl: 0.5, label: '50.0%', color: '#10B981', fill: 'rgba(16, 185, 129, 0.07)' },
          { lvl: 0.618, label: '61.8% (Golden)', color: '#EAB308', fill: 'rgba(234, 179, 8, 0.10)' },
          { lvl: 0.786, label: '78.6%', color: '#8B5CF6', fill: 'rgba(139, 92, 246, 0.05)' },
          { lvl: 1.0, label: '100.0%', color: '#3B82F6', fill: 'transparent' },
        ];

        const p0y = p0.y;
        const dy = p1.y - p0.y;
        const minX = Math.min(p0.x, p1.x) * dpr;
        const maxX = Math.max(p0.x, p1.x) * dpr;
        const dec = instrument.decimals;

        // 1. Subtle dashed trend impulse anchor line
        ctx.save();
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(p0.x * dpr, p0.y * dpr);
        ctx.lineTo(p1.x * dpr, p1.y * dpr);
        ctx.stroke();
        ctx.restore();

        // 2. Zone fills between Fibonacci levels
        for (let i = 0; i < levels.length - 1; i++) {
          const yA = (p0y + dy * levels[i].lvl) * dpr;
          const yB = (p0y + dy * levels[i + 1].lvl) * dpr;
          const topY = Math.min(yA, yB);
          const height = Math.abs(yB - yA);
          ctx.fillStyle = levels[i].fill;
          ctx.fillRect(minX, topY, maxX - minX, height);
        }

        // 3. Horizontal levels and price badges
        levels.forEach(({ lvl, label, color }) => {
          const ly = (p0y + dy * lvl) * dpr;
          ctx.strokeStyle = color;
          ctx.lineWidth = (lvl === 0 || lvl === 1.0 || lvl === 0.618 ? 1.5 : 1) * dpr;
          ctx.beginPath();
          ctx.moveTo(minX, ly);
          ctx.lineTo(maxX, ly);
          ctx.stroke();

          // Calculate precise price level
          const lvlPrice = d.pts[0].price + (d.pts[1].price - d.pts[0].price) * lvl;
          const labelText = `${label} • ${lvlPrice.toFixed(dec)}`;

          // Badge pill background
          ctx.font = `600 ${8.5 * dpr}px Inter, sans-serif`;
          const textW = ctx.measureText(labelText).width;
          const badgeW = textW + 8 * dpr;
          const badgeH = 14 * dpr;

          ctx.fillStyle = 'rgba(17, 17, 17, 0.95)';
          ctx.fillRect(minX + 6 * dpr, ly - 14 * dpr, badgeW, badgeH);
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.8 * dpr;
          ctx.strokeRect(minX + 6 * dpr, ly - 14 * dpr, badgeW, badgeH);

          ctx.fillStyle = color;
          ctx.fillText(labelText, minX + 10 * dpr, ly - 3.5 * dpr);
        });
      }
    } else if (d.type === 'pos_long' || d.type === 'pos_short') {
      const isLong = d.type === 'pos_long';
      const pEntry = toXY(d.pts[0].time, d.pts[0].price);
      const pTP = toXY(d.pts[1].time, d.pts[1].price);
      const pSL = toXY(d.pts[2].time, d.pts[2].price);

      if (pEntry.x !== null && pEntry.y !== null && pTP.x !== null && pTP.y !== null && pSL.x !== null && pSL.y !== null) {
        const rx = Math.min(pEntry.x, pTP.x) * dpr;
        const rw = Math.max(80, Math.abs(pTP.x - pEntry.x)) * dpr;
        const pip = instrument.pip;
        const dec = instrument.decimals;

        // Target Zone (Green)
        ctx.fillStyle = 'rgba(22, 163, 74, 0.20)';
        ctx.strokeStyle = '#16A34A';
        ctx.lineWidth = 1.5 * dpr;
        const tpY = Math.min(pEntry.y, pTP.y) * dpr;
        const tpH = Math.abs(pTP.y - pEntry.y) * dpr;
        ctx.fillRect(rx, tpY, rw, tpH);
        ctx.strokeRect(rx, tpY, rw, tpH);

        // Stop Zone (Red)
        ctx.fillStyle = 'rgba(220, 38, 38, 0.20)';
        ctx.strokeStyle = '#DC2626';
        ctx.lineWidth = 1.5 * dpr;
        const slY = Math.min(pEntry.y, pSL.y) * dpr;
        const slH = Math.abs(pSL.y - pEntry.y) * dpr;
        ctx.fillRect(rx, slY, rw, slH);
        ctx.strokeRect(rx, slY, rw, slH);

        // Middle Entry line
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(rx, pEntry.y * dpr);
        ctx.lineTo(rx + rw, pEntry.y * dpr);
        ctx.stroke();

        // Metrics: Target Pips, Stop Pips & R:R
        const targetDist = Math.abs(d.pts[1].price - d.pts[0].price);
        const stopDist = Math.abs(d.pts[0].price - d.pts[2].price);
        const targetPips = targetDist / pip;
        const stopPips = stopDist / pip;
        const rr = stopDist > 0 ? (targetDist / stopDist).toFixed(2) : '1.00';

        // R:R Center Badge
        ctx.fillStyle = 'rgba(17, 17, 17, 0.95)';
        ctx.fillRect(rx + 6 * dpr, (pEntry.y - 10) * dpr, 68 * dpr, 20 * dpr);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(rx + 6 * dpr, (pEntry.y - 10) * dpr, 68 * dpr, 20 * dpr);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 ${9.5 * dpr}px Inter, sans-serif`;
        ctx.fillText(`R:R 1:${rr}`, rx + 11 * dpr, (pEntry.y + 4) * dpr);

        // TP Top Label
        ctx.fillStyle = '#16A34A';
        ctx.font = `600 ${8.5 * dpr}px Inter, sans-serif`;
        const tpLabelY = isLong ? tpY - 4 * dpr : tpY + tpH + 11 * dpr;
        ctx.fillText(`TP: ${d.pts[1].price.toFixed(dec)} (+${targetPips.toFixed(1)}p)`, rx + 6 * dpr, tpLabelY);

        // SL Bottom Label
        ctx.fillStyle = '#DC2626';
        ctx.font = `600 ${8.5 * dpr}px Inter, sans-serif`;
        const slLabelY = isLong ? slY + slH + 11 * dpr : slY - 4 * dpr;
        ctx.fillText(`SL: ${d.pts[2].price.toFixed(dec)} (-${stopPips.toFixed(1)}p)`, rx + 6 * dpr, slLabelY);
      }
    } else if (d.type === 'text' && d.pts.length >= 1) {
      const p = toXY(d.pts[0].time, d.pts[0].price);
      if (p.x !== null && p.y !== null) {
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${12 * dpr}px Inter, sans-serif`;
        ctx.fillText(d.style.text || 'Annotation', p.x * dpr, p.y * dpr);
      }
    }

    // Render Handles if selected
    if (isSelected) {
      if (d.type === 'pos_long' || d.type === 'pos_short') {
        const pEntry = toXY(d.pts[0].time, d.pts[0].price);
        const pTP = toXY(d.pts[1].time, d.pts[1].price);
        const pSL = toXY(d.pts[2].time, d.pts[2].price);

        if (pEntry.x !== null && pEntry.y !== null && pTP.x !== null && pTP.y !== null && pSL.x !== null && pSL.y !== null) {
          const leftX = Math.min(pEntry.x, pTP.x) * dpr;
          const rightX = Math.max(pEntry.x, pTP.x) * dpr;
          const centerX = (leftX + rightX) / 2;
          const entryY = pEntry.y * dpr;
          const tpY = pTP.y * dpr;
          const slY = pSL.y * dpr;

          const drawHandleDot = (x: number, y: number, color: string, radius = 5 * dpr) => {
            ctx.fillStyle = '#FFFFFF';
            ctx.strokeStyle = color;
            ctx.lineWidth = 2 * dpr;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          };

          // TP Top Edge Handles (Green)
          drawHandleDot(centerX, tpY, '#00C46E', 5.5 * dpr);
          drawHandleDot(rightX, tpY, '#00C46E', 4.5 * dpr);

          // SL Bottom Edge Handles (Red)
          drawHandleDot(centerX, slY, '#F43F5E', 5.5 * dpr);
          drawHandleDot(rightX, slY, '#F43F5E', 4.5 * dpr);

          // Entry Middle Line Handles (Blue)
          drawHandleDot(leftX, entryY, '#3B82F6', 5.5 * dpr);
          drawHandleDot(rightX, entryY, '#3B82F6', 5.5 * dpr);
        }
      } else {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#3B82F6';
        ctx.lineWidth = 2 * dpr;
        d.pts.forEach((pt) => {
          const p = toXY(pt.time, pt.price);
          if (p.x !== null && p.y !== null) {
            ctx.beginPath();
            ctx.arc(p.x * dpr, p.y * dpr, 4.5 * dpr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        });
      }
    }

    ctx.restore();
  });
}

/** Shape being drawn, following the cursor before the last click. */
export function drawCreationPreview(rc: RenderContext): void {
  const { ctx, dpr, toXY, activeTool, currentStyle, drawPts } = rc;
  if (drawPts.length > 0 && activeTool !== 'cursor') {
    ctx.save();
    ctx.strokeStyle = currentStyle.color || '#3B82F6';
    ctx.lineWidth = (currentStyle.width || 2) * dpr;
    ctx.setLineDash([4 * dpr, 4 * dpr]);

    const p0 = toXY(drawPts[0].time, drawPts[0].price);
    if (drawPts.length >= 2) {
      const p1 = toXY(drawPts[1].time, drawPts[1].price);
      if (p0.x !== null && p0.y !== null && p1.x !== null && p1.y !== null) {
        if (activeTool === 'rect') {
          const rx = Math.min(p0.x, p1.x) * dpr;
          const ry = Math.min(p0.y, p1.y) * dpr;
          const rw = Math.abs(p1.x - p0.x) * dpr;
          const rh = Math.abs(p1.y - p0.y) * dpr;
          ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        } else if (activeTool === 'channel') {
          // Preview the actual band, so the shape the user releases on is the
          // shape they saw — the old preview drew a bare line.
          const preview = channelRails(
            makeChannelPoints(drawPts[0], drawPts[1])
          );
          const b0 = preview && toXY(preview.parallel[0].time, preview.parallel[0].price);
          const b1 = preview && toXY(preview.parallel[1].time, preview.parallel[1].price);

          ctx.beginPath();
          ctx.moveTo(p0.x * dpr, p0.y * dpr);
          ctx.lineTo(p1.x * dpr, p1.y * dpr);
          ctx.stroke();

          if (b0 && b1 && b0.x !== null && b0.y !== null && b1.x !== null && b1.y !== null) {
            ctx.beginPath();
            ctx.moveTo(b0.x * dpr, b0.y * dpr);
            ctx.lineTo(b1.x * dpr, b1.y * dpr);
            ctx.stroke();

            ctx.save();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.10)';
            ctx.beginPath();
            ctx.moveTo(p0.x * dpr, p0.y * dpr);
            ctx.lineTo(p1.x * dpr, p1.y * dpr);
            ctx.lineTo(b1.x * dpr, b1.y * dpr);
            ctx.lineTo(b0.x * dpr, b0.y * dpr);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        } else {
          ctx.beginPath();
          ctx.moveTo(p0.x * dpr, p0.y * dpr);
          ctx.lineTo(p1.x * dpr, p1.y * dpr);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}
