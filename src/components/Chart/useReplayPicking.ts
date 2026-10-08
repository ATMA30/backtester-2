import React, { RefObject, useState } from 'react';
import { IChartApi } from 'lightweight-charts';
import { useMarketStore } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { useUIStore } from '../../store/useUIStore';
import { Candle } from '../../types/market';
import { indexAtOrAfter } from '../../domain/candles';
import { asChartTime } from './chartSetup';

export interface HoverCandle {
  readonly x: number;
  readonly time: number;
  readonly candle: Candle;
}

/**
 * Pick the replay's first candle on the chart: the candle under the pointer is
 * previewed, a click starts the replay there.
 */
export function useReplayPicking(chart: IChartApi | null, chartWrapperRef: RefObject<HTMLDivElement | null>) {
  const baseCandles = useMarketStore((m) => m.baseCandles);
  const { isPicking, setStartIndex, setCurrentIndex, setIsActive, setIsPicking } = useReplayStore();
  const showToast = useUIStore((s) => s.showToast);
  const [hoverCandleInfo, setHoverCandleInfo] = useState<HoverCandle | null>(null);

  // ── REPLAY PICK & CUT BAR HANDLER ─────────────────────────
  const handleChartMouseMove = (e: React.MouseEvent) => {
    if (!isPicking || !chart || !baseCandles.length) {
      if (hoverCandleInfo) setHoverCandleInfo(null);
      return;
    }
    const rect = chartWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const time = chart.timeScale().coordinateToTime(mx) as number | null;
    if (time) {
      const found = indexAtOrAfter(baseCandles, time);
      const idx = found === -1 ? baseCandles.length - 1 : found;
      const candle = baseCandles[idx];
      const snappedX = chart.timeScale().timeToCoordinate(asChartTime(candle.time)) ?? mx;
      setHoverCandleInfo({ x: snappedX, time: candle.time, candle });
    }
  };

  const handleChartMouseLeave = () => {
    if (isPicking) {
      setHoverCandleInfo(null);
    }
  };

  const handleChartClick = (e: React.MouseEvent) => {
    if (!isPicking || !chart || !baseCandles.length) return;
    const rect = chartWrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const time = chart.timeScale().coordinateToTime(mx) as number | null;

    if (time) {
      const found = indexAtOrAfter(baseCandles, time);
      // Clamp: `length - 20` went negative on a series shorter than 20 candles,
      // and the negative index propagated into the replay cursor.
      const chosenIdx = found !== -1
        ? found
        : Math.max(0, baseCandles.length - 20);

      setStartIndex(chosenIdx, baseCandles.length);
      setCurrentIndex(chosenIdx, baseCandles.length);
      setIsPicking(false);
      setHoverCandleInfo(null);
      setIsActive(true);
      showToast(`Replay démarré au ${new Date(baseCandles[chosenIdx].time * 1000).toLocaleDateString('fr-FR')}`, 'success');
    }
  };

  return { hoverCandleInfo, handleChartMouseMove, handleChartMouseLeave, handleChartClick };
}
