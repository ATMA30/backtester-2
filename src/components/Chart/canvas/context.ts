import { ISeriesApi } from 'lightweight-charts';
import { ActiveIndicator, Candle, ForexSessionConfig, SeparatorTF } from '../../../types/market';
import { Drawing, DrawingStyle, DrawingTool, Point } from '../../../types/drawing';
import { PendingOrder, Position } from '../../../types/trading';
import { InstrumentSpec } from '../../../domain/instruments';

/**
 * Everything a canvas layer may read, passed explicitly.
 *
 * The layers used to be one 980-line `redraw` closure inside `DrawingCanvas`,
 * reading component state, store slices and refs implicitly. Each layer is now
 * a function of this object alone: what it depends on is visible in its
 * destructuring line, and it can be read — and changed — in isolation.
 */
export interface RenderContext {
  readonly ctx: CanvasRenderingContext2D;
  /** Device pixel ratio: canvas coordinates are CSS pixels × `dpr`. */
  readonly dpr: number;
  /** Canvas size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Visible slice of `displayCandles` (with a small margin on each side). */
  readonly startIdx: number;
  readonly endIdx: number;
  readonly displayCandles: readonly Candle[];
  /** Chart projection of a (time, price) point, in CSS pixels. */
  readonly toXY: (time: number, price: number) => { x: number | null; y: number | null };
  readonly getBarSpacingPx: () => number;
  readonly mainSeries: ISeriesApi<'Candlestick' | 'Bar' | 'Line' | 'Area'>;
  readonly instrument: InstrumentSpec;
  readonly currentSymbol: string;
  readonly separatorTF: SeparatorTF;
  readonly forexSessions: ForexSessionConfig;
  readonly activeTF: number;
  readonly baseTF: number;
  readonly openPositions: readonly Position[];
  readonly pendingOrders: readonly PendingOrder[];
  readonly activeIndicators: readonly ActiveIndicator[];
  readonly drawings: readonly Drawing[];
  readonly selectedDrawingId: string | null;
  readonly activeTool: DrawingTool;
  readonly currentStyle: DrawingStyle;
  /** Points already placed for the drawing being created. */
  readonly drawPts: readonly Point[];
  /** First real candle when the series begins with closes only, else `null`. */
  readonly closesOnlyBefore: number | null;
}
