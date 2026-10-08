import { useEffect } from 'react';
import { IChartApi } from 'lightweight-charts';
import { useMarketStore } from '../../store/useMarketStore';
import { useUIStore } from '../../store/useUIStore';

/** When the snapshot dialog opens, compose the chart and the drawings into one image. */
export function useChartSnapshot(chart: IChartApi | null): void {
  const currentSymbol = useMarketStore((m) => m.currentSymbol);
  const { activeModal, setSnapshotDataUrl } = useUIStore();

  // ── SNAPSHOT CAPTURE ──────────────────────────────────────
  useEffect(() => {
    if (activeModal === 'snapshot' && chart) {
      try {
        const chartCanvas = chart.takeScreenshot();
        const drawCanvas = document.getElementById('draw-canvas') as HTMLCanvasElement | null;

        const outCanvas = document.createElement('canvas');
        outCanvas.width = chartCanvas.width;
        outCanvas.height = chartCanvas.height;
        const ctx = outCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(chartCanvas, 0, 0);
          if (drawCanvas) {
            ctx.drawImage(drawCanvas, 0, 0, outCanvas.width, outCanvas.height);
          }
          const dpr = window.devicePixelRatio || 1;
          ctx.fillStyle = 'rgba(17, 17, 17, 0.90)';
          ctx.fillRect(16 * dpr, (outCanvas.height / dpr - 40) * dpr, 340 * dpr, 28 * dpr);
          ctx.fillStyle = '#16A34A';
          ctx.font = `bold ${12 * dpr}px Inter, sans-serif`;
          ctx.fillText(`TradeView Pro`, 24 * dpr, (outCanvas.height / dpr - 22) * dpr);
          ctx.fillStyle = '#FAFAFA';
          ctx.font = `${11 * dpr}px Inter, sans-serif`;
          ctx.fillText(` • ${currentSymbol} • ${new Date().toLocaleDateString('fr-FR')}`, 115 * dpr, (outCanvas.height / dpr - 22) * dpr);

          setSnapshotDataUrl(outCanvas.toDataURL('image/png'));
        }
      } catch (e) {
        console.warn('Snapshot capture failed:', e);
      }
    }
  }, [activeModal, chart, currentSymbol, setSnapshotDataUrl]);
}
