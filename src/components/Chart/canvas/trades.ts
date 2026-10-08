/** Position and pending order layers of the drawing canvas. */

import { RenderContext } from './context';
import { unitsToLots } from '../../../domain/instruments';
import { Position } from '../../../types/trading';
import { positionBadgeOffsets } from './positionLayout';

/** Entry, stop and target lines of every open position, with their badges. */
export function drawOpenPositions(rc: RenderContext): void {
  const { mainSeries, openPositions, width } = rc;
  if (!mainSeries) return;
  const offsets = positionBadgeOffsets(openPositions, (price) => mainSeries.priceToCoordinate(price));
  for (const position of openPositions) drawPosition(rc, position, width - (offsets.get(position.id) ?? 0));
}

/** One position; its badges end at `right` (see `positionLayout`), its lines span the chart. */
function drawPosition(rc: RenderContext, activePosition: Position, right: number): void {
  const { ctx, dpr, width, mainSeries, instrument, currentSymbol } = rc;
  if (mainSeries) {
    ctx.save();
    const isLong = activePosition.type === 'LONG';
    const dec = instrument.decimals;
    const pip = instrument.pip;
    const entryY = mainSeries.priceToCoordinate(activePosition.entry);
    const slY = activePosition.sl ? mainSeries.priceToCoordinate(activePosition.sl) : null;
    const tpY = activePosition.tp ? mainSeries.priceToCoordinate(activePosition.tp) : null;

    if (entryY !== null && entryY !== undefined) {
      ctx.strokeStyle = isLong ? '#16A34A' : '#DC2626';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([6 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, entryY * dpr);
      ctx.lineTo(width * dpr, entryY * dpr);
      ctx.stroke();

      // Main Entry Badge
      const hasNoSl = !activePosition.sl;
      const hasNoTp = !activePosition.tp;
      const bw = 175 + (hasNoSl ? 34 : 0) + (hasNoTp ? 34 : 0);
      const bx = right - bw - 10;
      const by = entryY - 11;
      ctx.fillStyle = isLong ? 'rgba(22, 163, 74, 0.95)' : 'rgba(220, 38, 38, 0.95)';
      ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);

      ctx.fillStyle = '#000000';
      ctx.font = `600 ${9.5 * dpr}px Inter, sans-serif`;
      // `size` is in base-asset units (see `types/trading`), so printing it
      // with an "L" suffix announced 100 000 L for a one-lot EUR/USD position.
      const lots = unitsToLots(activePosition.symbol ?? currentSymbol, activePosition.size);
      ctx.fillText(`${isLong ? '▲ ACHAT' : '▼ VENTE'} ${lots.toFixed(2)} L @ ${activePosition.entry.toFixed(dec)}`, (bx + 6) * dpr, (entryY + 4) * dpr);

      let chipOffset = 36;
      // Close Button [✕] inside badge
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect((right - chipOffset) * dpr, (by + 2) * dpr, 18 * dpr, 18 * dpr);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${11 * dpr}px sans-serif`;
      ctx.fillText('✕', (right - chipOffset + 5) * dpr, (entryY + 4) * dpr);

      // Optional "+TP" button chip if no TP
      if (hasNoTp) {
        chipOffset += 32;
        ctx.fillStyle = 'rgba(22, 163, 74, 0.45)';
        ctx.fillRect((right - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 0.8 * dpr;
        ctx.strokeRect((right - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 ${8.5 * dpr}px Inter, sans-serif`;
        ctx.fillText('+TP', (right - chipOffset + 4) * dpr, (entryY + 4) * dpr);
      }

      // Optional "+SL" button chip if no SL
      if (hasNoSl) {
        chipOffset += 32;
        ctx.fillStyle = 'rgba(220, 38, 38, 0.45)';
        ctx.fillRect((right - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 0.8 * dpr;
        ctx.strokeRect((right - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 ${8.5 * dpr}px Inter, sans-serif`;
        ctx.fillText('+SL', (right - chipOffset + 4) * dpr, (entryY + 4) * dpr);
      }
    }

    if (slY !== null && slY !== undefined && activePosition.sl) {
      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, slY * dpr);
      ctx.lineTo(width * dpr, slY * dpr);
      ctx.stroke();

      const slPips = Math.abs(activePosition.entry - activePosition.sl) / pip;
      // Wide enough for « SL: 1.08985 (-60.0p) » and the ✕ beside it.
      const bw = 170;
      const bx = right - bw - 10;
      const by = slY - 11;
      ctx.fillStyle = 'rgba(220, 38, 38, 0.92)';
      ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `600 ${9.5 * dpr}px Inter, sans-serif`;
      ctx.fillText(`🛑 SL: ${activePosition.sl.toFixed(dec)} (-${slPips.toFixed(1)}p)`, (bx + 6) * dpr, (slY + 4) * dpr);

      // Clear SL Button [✕]
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect((right - 32) * dpr, (by + 2) * dpr, 18 * dpr, 18 * dpr);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${11 * dpr}px sans-serif`;
      ctx.fillText('✕', (right - 27) * dpr, (slY + 4) * dpr);
    }

    if (tpY !== null && tpY !== undefined && activePosition.tp) {
      ctx.strokeStyle = '#16A34A';
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.moveTo(0, tpY * dpr);
      ctx.lineTo(width * dpr, tpY * dpr);
      ctx.stroke();

      const tpPips = Math.abs(activePosition.tp - activePosition.entry) / pip;
      // Wide enough for « SL: 1.08985 (-60.0p) » and the ✕ beside it.
      const bw = 170;
      const bx = right - bw - 10;
      const by = tpY - 11;
      ctx.fillStyle = 'rgba(22, 163, 74, 0.92)';
      ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);

      ctx.fillStyle = '#000000';
      ctx.font = `600 ${9.5 * dpr}px Inter, sans-serif`;
      ctx.fillText(`🎯 TP: ${activePosition.tp.toFixed(dec)} (+${tpPips.toFixed(1)}p)`, (bx + 6) * dpr, (tpY + 4) * dpr);

      // Clear TP Button [✕]
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect((right - 32) * dpr, (by + 2) * dpr, 18 * dpr, 18 * dpr);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${11 * dpr}px sans-serif`;
      ctx.fillText('✕', (right - 27) * dpr, (tpY + 4) * dpr);
    }
    ctx.restore();
  }
}

/** Pending orders: target price and their own stop / target. */
export function drawPendingOrders(rc: RenderContext): void {
  const { ctx, dpr, width, mainSeries, instrument, pendingOrders } = rc;
  if (pendingOrders && pendingOrders.length > 0 && mainSeries) {
    ctx.save();
    for (const order of pendingOrders) {
      const isLong = order.type === 'LONG';
      const dec = instrument.decimals;
      const pip = instrument.pip;
      const orderY = mainSeries.priceToCoordinate(order.targetPrice);
      const slY = order.sl ? mainSeries.priceToCoordinate(order.sl) : null;
      const tpY = order.tp ? mainSeries.priceToCoordinate(order.tp) : null;

      if (orderY !== null && orderY !== undefined) {
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(0, orderY * dpr);
        ctx.lineTo(width * dpr, orderY * dpr);
        ctx.stroke();

        const hasNoSl = !order.sl;
        const hasNoTp = !order.tp;
        const bw = 185 + (hasNoSl ? 34 : 0) + (hasNoTp ? 34 : 0);
        const bx = width - bw - 10;
        const by = orderY - 11;
        ctx.fillStyle = '#2563EB';
        ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1 * dpr;
        ctx.strokeRect(bx * dpr, by * dpr, bw * dpr, 22 * dpr);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 ${9.5 * dpr}px Inter, sans-serif`;
        ctx.fillText(`${isLong ? 'Achat' : 'Vente'} ${order.orderType === 'LIMIT' ? 'limite' : 'stop'} · ${order.targetPrice.toFixed(dec)}`, (bx + 6) * dpr, (orderY + 4) * dpr);

        let chipOffset = 36;
        // Cancel Button [✕]
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 18 * dpr, 18 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${11 * dpr}px sans-serif`;
        ctx.fillText('✕', (width - chipOffset + 5) * dpr, (orderY + 4) * dpr);

        if (hasNoTp) {
          chipOffset += 32;
          ctx.fillStyle = 'rgba(22, 163, 74, 0.45)';
          ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 0.8 * dpr;
          ctx.strokeRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `600 ${8.5 * dpr}px Inter, sans-serif`;
          ctx.fillText('+TP', (width - chipOffset + 4) * dpr, (orderY + 4) * dpr);
        }

        if (hasNoSl) {
          chipOffset += 32;
          ctx.fillStyle = 'rgba(220, 38, 38, 0.45)';
          ctx.fillRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 0.8 * dpr;
          ctx.strokeRect((width - chipOffset) * dpr, (by + 2) * dpr, 28 * dpr, 18 * dpr);
          ctx.fillStyle = '#FFFFFF';
          ctx.font = `600 ${8.5 * dpr}px Inter, sans-serif`;
          ctx.fillText('+SL', (width - chipOffset + 4) * dpr, (orderY + 4) * dpr);
        }
      }

      if (slY !== null && slY !== undefined && order.sl) {
        ctx.strokeStyle = '#DC2626';
        ctx.lineWidth = 1.2 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(0, slY * dpr);
        ctx.lineTo(width * dpr, slY * dpr);
        ctx.stroke();

        const slPips = Math.abs(order.targetPrice - order.sl) / pip;
        const bw = 140;
        const bx = width - bw - 10;
        const by = slY - 11;
        ctx.fillStyle = 'rgba(220, 38, 38, 0.88)';
        ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 20 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 ${9 * dpr}px Inter, sans-serif`;
        ctx.fillText(`🛑 SL: ${order.sl.toFixed(dec)} (-${slPips.toFixed(1)}p)`, (bx + 6) * dpr, (slY + 3) * dpr);

        // Cancel SL [✕]
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect((width - 30) * dpr, (by + 2) * dpr, 16 * dpr, 16 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${10 * dpr}px sans-serif`;
        ctx.fillText('✕', (width - 26) * dpr, (slY + 3) * dpr);
      }

      if (tpY !== null && tpY !== undefined && order.tp) {
        ctx.strokeStyle = '#16A34A';
        ctx.lineWidth = 1.2 * dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(0, tpY * dpr);
        ctx.lineTo(width * dpr, tpY * dpr);
        ctx.stroke();

        const tpPips = Math.abs(order.tp - order.targetPrice) / pip;
        const bw = 140;
        const bx = width - bw - 10;
        const by = tpY - 11;
        ctx.fillStyle = 'rgba(22, 163, 74, 0.88)';
        ctx.fillRect(bx * dpr, by * dpr, bw * dpr, 20 * dpr);
        ctx.fillStyle = '#000000';
        ctx.font = `600 ${9 * dpr}px Inter, sans-serif`;
        ctx.fillText(`🎯 TP: ${order.tp.toFixed(dec)} (+${tpPips.toFixed(1)}p)`, (bx + 6) * dpr, (tpY + 3) * dpr);

        // Cancel TP [✕]
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect((width - 30) * dpr, (by + 2) * dpr, 16 * dpr, 16 * dpr);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold ${10 * dpr}px sans-serif`;
        ctx.fillText('✕', (width - 26) * dpr, (tpY + 3) * dpr);
      }
    }
    ctx.restore();
  }
}
