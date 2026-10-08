import { useEffect } from 'react';
import { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { onPositionClosed, useTradeStore } from '../../store/useTradeStore';
import { useMarketStore } from '../../store/useMarketStore';
import { saveCapture } from '../../services/db';
import { getCalendarBucket } from '../../domain/candles';
import { formatPrice } from '../../domain/instruments';
import { Position } from '../../types/trading';

const PREFERENCE_KEY = 'journal-auto-capture-v1';

/** Whether a trade's close captures the chart. On unless the trader turned it off. */
export function isAutoCaptureEnabled(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoCaptureEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREFERENCE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage unavailable: the choice lasts for this session.
  }
}

/**
 * The chart, the trader's drawings and the trade's path, in one image.
 *
 * Once a position closes, its lines leave the chart: a plain screenshot would
 * show the market but not the trade. The entry and the exit are drawn back on,
 * joined, with their prices.
 */
function composeCapture(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'>,
  trade: Position,
  symbol: string,
  activeTF: number
): HTMLCanvasElement {
  const shot = chart.takeScreenshot();
  const out = document.createElement('canvas');
  out.width = shot.width;
  out.height = shot.height;
  const ctx = out.getContext('2d');
  if (!ctx) return shot;
  ctx.drawImage(shot, 0, 0);

  const overlay = document.getElementById('draw-canvas');
  if (overlay instanceof HTMLCanvasElement && overlay.width > 0) {
    ctx.drawImage(overlay, 0, 0, out.width, out.height);
  }

  const cssWidth = chart.chartElement().clientWidth || out.width;
  const scale = out.width / cssWidth;
  const x = (time: number) => {
    const bucket = activeTF > 0 ? getCalendarBucket(time, activeTF) : time;
    return chart.timeScale().timeToCoordinate(bucket as UTCTimestamp);
  };
  const entryY = series.priceToCoordinate(trade.entry);
  const exitY = trade.exitPrice === undefined ? null : series.priceToCoordinate(trade.exitPrice);
  const entryX = x(trade.time);
  const exitX = trade.closeTime === undefined ? null : x(trade.closeTime);
  const won = (trade.pnl ?? 0) >= 0;

  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineWidth = 1.5;
  ctx.font = '600 11px Inter, sans-serif';
  if (entryY !== null && exitY !== null && entryX !== null && exitX !== null) {
    ctx.strokeStyle = won ? '#16A34A' : '#DC2626';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(entryX, entryY);
    ctx.lineTo(exitX, exitY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const mark = (px: number | null, py: number | null, label: string, color: string) => {
    if (py === null) return;
    const cx = px ?? 12;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FAFAFA';
    ctx.fillText(label, cx + 8, py - 6);
  };
  const side = trade.type === 'LONG' ? 'Achat' : 'Vente';
  mark(entryX, entryY, `${side} ${formatPrice(symbol, trade.entry)}`, '#2563EB');
  if (trade.exitPrice !== undefined) {
    mark(exitX, exitY, `Sortie ${formatPrice(symbol, trade.exitPrice)}`, won ? '#16A34A' : '#DC2626');
  }
  ctx.restore();
  return out;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  // WebP is a third of the PNG size for a chart; browsers without it return PNG.
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
}

/**
 * Capture the chart each time a trade closes, and attach the image to it.
 *
 * Deferred by one frame, so the capture shows the candle that closed the trade
 * rather than the one before it.
 */
export function useTradeCaptures(
  chart: IChartApi | null,
  series: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'> | null
): void {
  useEffect(() => {
    if (!chart || !series) return;
    return onPositionClosed((trade) => {
      if (!isAutoCaptureEnabled()) return;
      requestAnimationFrame(() => {
        void (async () => {
          try {
            const { currentSymbol, activeTF } = useMarketStore.getState();
            const blob = await toBlob(composeCapture(chart, series, trade, trade.symbol ?? currentSymbol, activeTF));
            if (!blob) return;
            const saved = await saveCapture(trade.id, blob);
            if (saved.ok) useTradeStore.getState().markScreenshot(trade.id, true);
          } catch (error) {
            // A capture is a convenience: failing it must never touch the trade.
            console.warn('[capture] chart capture failed:', error);
          }
        })();
      });
    });
  }, [chart, series]);
}
