import { IChartApi, UTCTimestamp } from 'lightweight-charts';
import { ActiveIndicator } from '../../types/market';

/**
 * Narrow an epoch-seconds number to lightweight-charts' branded `Time`.
 *
 * One documented conversion point instead of the `time: c.time as any` casts
 * that were scattered through the data and drawing layers.
 */
export const asChartTime = (epochSeconds: number): UTCTimestamp => epochSeconds as UTCTimestamp;

/** Split the chart's height between price, volume and indicator panes. */
export function applyResponsiveScaleMargins(
  chart: IChartApi | null,
  showVolume: boolean,
  activeIndicators: readonly ActiveIndicator[]
) {
  if (!chart) return;
  const hasSubPanes = activeIndicators.some((i) => i.type === 'RSI' || i.type === 'MACD');

  let priceMargins: { top: number; bottom: number };
  let volumeMargins: { top: number; bottom: number };
  let subPaneMargins: { top: number; bottom: number };

  if (!showVolume && !hasSubPanes) {
    // 1. Full clean screen: No volume, no indicator (100% chart height for candles)
    priceMargins = { top: 0.04, bottom: 0.04 };
    volumeMargins = { top: 1.0, bottom: 0.0 };
    subPaneMargins = { top: 1.0, bottom: 0.0 };
  } else if (showVolume && !hasSubPanes) {
    // 2. Volume only: Price takes top 80% (bottom: 0.20), Volume takes 82%-99% (top: 0.82)
    // Guaranteed 2% buffer: Candlesticks can NEVER touch or encounter volume bars!
    priceMargins = { top: 0.04, bottom: 0.20 };
    volumeMargins = { top: 0.82, bottom: 0.01 };
    subPaneMargins = { top: 1.0, bottom: 0.0 };
  } else if (!showVolume && hasSubPanes) {
    // 3. Indicator only: Price takes top 75%, Sub-pane takes bottom 23%
    priceMargins = { top: 0.04, bottom: 0.25 };
    volumeMargins = { top: 1.0, bottom: 0.0 };
    subPaneMargins = { top: 0.77, bottom: 0.02 };
  } else {
    // 4. Both Volume and Indicator:
    // Candlesticks: strictly stop at 64% from top (bottom: 0.36)
    // Guaranteed 2% buffer between 64% and 66%
    // Volume: strictly confined to 66% - 77% (top: 0.66, bottom: 0.23)
    // Guaranteed 1.5% separator between 77% and 78.5%
    // Indicator: strictly confined to 78.5% - 98% (top: 0.785, bottom: 0.02)
    // MATHEMATICALLY IMPOSSIBLE FOR PRICE TO TOUCH OR MEET VOLUME!
    priceMargins = { top: 0.04, bottom: 0.36 };
    volumeMargins = { top: 0.66, bottom: 0.23 };
    subPaneMargins = { top: 0.785, bottom: 0.02 };
  }

  try {
    chart.priceScale('right').applyOptions({ scaleMargins: priceMargins });
    chart.priceScale('volume').applyOptions({ scaleMargins: volumeMargins });
    if (hasSubPanes) {
      activeIndicators.forEach((ind) => {
        if (ind.type === 'RSI') {
          chart.priceScale('rsi_pane').applyOptions({ scaleMargins: subPaneMargins, autoScale: true });
        } else if (ind.type === 'MACD') {
          chart.priceScale('macd_pane').applyOptions({ scaleMargins: subPaneMargins, autoScale: true });
        }
      });
    }
  } catch (err) {
    console.warn('scaleMargins error:', err);
  }
}
