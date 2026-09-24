import { useCallback, useEffect, useMemo, useRef } from 'react';
import { IChartApi, LogicalRange, UTCTimestamp } from 'lightweight-charts';
import { Candle } from '../../types/market';

/**
 * Explicit viewport controller for the price chart.
 *
 * The previous logic lived inline in the data effect and read
 * `getVisibleLogicalRange()` *after* `setData()` had already replaced the
 * series. That value is no longer the range the user was looking at — it is
 * whatever the library recomputed for the new data — so every decision was made
 * on a corrupted input. Two symptoms followed:
 *
 *  - **Replay**: the auto-follow branch fired whenever `visible.to <= count + 1`,
 *    which is true as soon as the user pans back into history. Scrolling back to
 *    study a setup snapped the view to the last candle on the very next tick.
 *  - **Timeframe switch**: the saved window was restored with `setVisibleRange`
 *    inside an empty `catch {}`. Whenever the old window did not intersect the
 *    new series the call threw, the failure was swallowed, and the viewport
 *    stayed wherever `setData` had left it — often far off-screen.
 *
 * The controller separates the two phases explicitly: `capture()` records the
 * user's intent *before* the data changes, `apply()` restores it afterwards.
 */

/** How many bars to show when the viewport has to be rebuilt from scratch. */
const DEFAULT_VISIBLE_BARS = 90;
/** Blank bars kept to the right of the last candle, so it is never glued to the edge. */
const RIGHT_MARGIN_BARS = 6;
/** Below this span a restored window is treated as degenerate and refitted. */
const MIN_VISIBLE_BARS = 3;
/**
 * Backward pan, in bars, that releases auto-scroll.
 *
 * It must be *small*. The previous rule compared the right edge to
 * `barCount - 1 - 2` while auto-scroll parks that edge at `barCount + 6`: nine
 * bars of slack. Any shorter drag was read as "still at the tail" and the next
 * tick shoved the view forward again — at 32x, fifty times a second, so the
 * chart fought the drag and the user could not get back into history at all.
 * Two bars is just enough to absorb the one-bar staleness of `lastBarCountRef`
 * between two ticks.
 */
const PAN_RELEASE_BARS = 2;
/** Relative span change above which a range event is a zoom, not a pan. */
const ZOOM_SPAN_EPSILON = 0.02;
/**
 * Fewest bars a preserved time window may resolve to.
 *
 * Holding the exact wall-clock window across a big granularity jump is right in
 * spirit but useless in practice: three months of daily bars becomes three
 * monthly candles. Below this count the window is widened, keeping its right
 * edge, so the user still sees structure.
 */
const MIN_BARS_AFTER_TF_SWITCH = 24;

export interface ViewportSnapshot {
  readonly logical: LogicalRange | null;
  readonly timeWindow: { from: number; to: number } | null;
  readonly barCount: number;
  /** True when the view was sitting at the right edge of the series. */
  readonly wasFollowingTail: boolean;
}

export interface ApplyOptions {
  /** Rebuild the viewport from scratch (new symbol, first load, explicit fit). */
  readonly refit?: boolean;
  /** Keep the same wall-clock window rather than the same bar indices. */
  readonly keepTimeWindow?: boolean;
  /** Auto-scroll with the last candle while the user is following the tail. */
  readonly followTail?: boolean;
}

interface ChartViewport {
  /**
   * Record the current view, against the bar count the user is looking at.
   * Call before mutating series data.
   */
  capture: (barCount: number) => ViewportSnapshot;
  /** Restore the recorded view against the new data. Call after `setData`. */
  apply: (snapshot: ViewportSnapshot, candles: readonly Candle[], options?: ApplyOptions) => void;
  /** Fit all data and clear the follow state. */
  fit: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function useChartViewport(chart: IChartApi | null): ChartViewport {
  /**
   * Set while we drive the time scale ourselves, so the range subscription can
   * tell our own writes from a genuine pan or zoom by the user.
   */
  const isProgrammaticRef = useRef(false);
  /**
   * Whether auto-scroll should keep the last candle in view.
   *
   * This is *remembered from the user's own gesture*, not recomputed from the
   * geometry on each tick. The previous code kept a `userPannedAway` ref that
   * was written in three places and read in none: there was no memory of intent
   * at all, and the decision was re-derived every tick from a threshold that
   * did not match where auto-scroll parks the view.
   */
  const followRef = useRef(true);
  /** Bar count the currently displayed range is measured against. */
  const lastBarCountRef = useRef(0);
  /** Span of the last range we saw, to tell a zoom from a pan. */
  const lastSpanRef = useRef(0);
  /** True between pointer-down on the chart and pointer-up: a drag in progress. */
  const isDraggingRef = useRef(false);
  /** Right edge of the view when the current drag started, in bar indices. */
  const dragStartToRef = useRef<number | null>(null);

  const setLogicalRange = useCallback(
    (chartApi: IChartApi, from: number, to: number) => {
      isProgrammaticRef.current = true;
      try {
        chartApi.timeScale().setVisibleLogicalRange({ from, to });
      } catch (error) {
        console.warn('[viewport] setVisibleLogicalRange failed:', error);
      } finally {
        lastSpanRef.current = to - from;
        // Release on the next frame: the library emits the range event
        // asynchronously, after this call returns.
        requestAnimationFrame(() => {
          isProgrammaticRef.current = false;
        });
      }
    },
    []
  );

  // Track genuine user interaction with the time scale.
  useEffect(() => {
    if (!chart) return;

    const handleRangeChange = (range: LogicalRange | null) => {
      const previousSpan = lastSpanRef.current;
      if (range) lastSpanRef.current = range.to - range.from;
      if (isProgrammaticRef.current || !range) return;

      const count = lastBarCountRef.current;
      if (count === 0) return;

      const span = range.to - range.from;
      const isZoom =
        previousSpan > 0 && Math.abs(span - previousSpan) > Math.max(1, previousSpan * ZOOM_SPAN_EPSILON);

      if (isZoom) {
        // Zooming must not silently stop playback from following. The wheel is
        // anchored on the cursor, so zooming in mid-chart moves the right edge
        // backwards; judging that by position alone cut auto-scroll off the
        // moment the user leaned in to read the current candle. Keep following
        // as long as the last candle is still framed — at the new zoom level.
        followRef.current = range.to >= count - 1 && range.from <= count - 1;
        return;
      }

      // Mid-drag the geometry says nothing: auto-scroll re-parks the edge
      // between two mouse-move events, so the gesture never accumulates and
      // every sample reads as "still at the tail". The release is decided once,
      // on pointer-up, below.
      if (isDraggingRef.current) return;

      // Constant span: this is a deliberate pan. Compare against where
      // auto-scroll parks the edge, not against the last bar index.
      followRef.current = range.to >= count + RIGHT_MARGIN_BARS - PAN_RELEASE_BARS;
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
  }, [chart]);

  /**
   * Grabbing the chart suspends auto-scroll for the whole gesture.
   *
   * This is the only rule that survives fast playback. At 32x a tick fires
   * every 20 ms — several times *between* two mouse-move events — and each one
   * shoves the view back to the last candle. A distance threshold therefore
   * measures a value that is continuously reset: the user drags, the chart
   * snaps back, and history is unreachable. So we stop reading the geometry
   * during the drag and read it once, when the pointer is released.
   */
  useEffect(() => {
    if (!chart) return;
    const element = chart.chartElement();
    if (!element) return;
    // The parent, not the chart element: the drawing overlay is painted on top
    // of the library's own node and swallows the press, so a listener bound to
    // `chartElement()` never fires once. Their common parent sees both.
    const surface = element.parentElement ?? element;

    const handlePointerDown = () => {
      isDraggingRef.current = true;
      dragStartToRef.current = chart.timeScale().getVisibleLogicalRange()?.to ?? null;
    };

    const handlePointerUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;

      const startTo = dragStartToRef.current;
      dragStartToRef.current = null;

      const count = lastBarCountRef.current;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range || count === 0) return;

      // Measure the gesture itself, not the distance to the tail: the tail
      // moves while the drag is in progress, so a fixed target would make the
      // same gesture release or not depending on playback speed.
      const barsMovedBack = startTo === null ? 0 : startTo - range.to;
      if (barsMovedBack > PAN_RELEASE_BARS) {
        followRef.current = false;
        return;
      }
      // A plain click, or a drag forward: keep following if we are back at the
      // edge where auto-scroll parks the view.
      followRef.current = range.to >= count + RIGHT_MARGIN_BARS - PAN_RELEASE_BARS;
    };

    surface.addEventListener('pointerdown', handlePointerDown);
    // On window: a drag routinely ends outside the chart, and a pointer-up we
    // never see would leave auto-scroll suspended for good.
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      surface.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [chart]);

  const readCurrentView = useCallback((): Omit<ViewportSnapshot, 'barCount' | 'wasFollowingTail'> => {
    if (!chart) return { logical: null, timeWindow: null };

    const timeScale = chart.timeScale();
    const logical = timeScale.getVisibleLogicalRange();

    let timeWindow: { from: number; to: number } | null = null;
    try {
      const visible = timeScale.getVisibleRange();
      if (visible && typeof visible.from === 'number' && typeof visible.to === 'number') {
        timeWindow = { from: visible.from as number, to: visible.to as number };
      }
    } catch {
      // No data yet — there is no visible range to record.
    }

    return { logical, timeWindow };
  }, [chart]);

  const capture = useCallback(
    (barCount: number): ViewportSnapshot => {
      const view = readCurrentView();
      lastBarCountRef.current = barCount;
      // "Following the tail" is what decides whether replay may auto-scroll.
      // With no view yet there is nothing to preserve, so follow by default.
      const wasFollowingTail =
        view.logical === null || barCount === 0 ? true : followRef.current && !isDraggingRef.current;

      return { ...view, barCount, wasFollowingTail };
    },
    [readCurrentView]
  );

  const fit = useCallback(() => {
    if (!chart) return;
    isProgrammaticRef.current = true;
    try {
      chart.timeScale().fitContent();
    } finally {
      requestAnimationFrame(() => {
        isProgrammaticRef.current = false;
      });
    }
    followRef.current = true;
  }, [chart]);

  const apply = useCallback(
    (snapshot: ViewportSnapshot, candles: readonly Candle[], options: ApplyOptions = {}) => {
      if (!chart || candles.length === 0) return;

      const count = candles.length;
      const { refit = false, keepTimeWindow = false, followTail = false } = options;

      // Range events fired from here on are measured against the new series.
      lastBarCountRef.current = count;
      if (refit) followRef.current = true;

      /**
       * Show the last `bars` bars, right margin included.
       *
       * The margin must sit *inside* the requested width. Writing
       * `from = count - bars, to = count + margin` yields a window of
       * `bars + margin`, and during replay that value is measured back out on
       * the next tick and grown again — the view widened by 6 bars per candle,
       * so a 40-bar zoom decayed to 280 bars within seconds.
       */
      const showTail = (bars: number) => {
        const span = clamp(bars, MIN_VISIBLE_BARS, Math.max(MIN_VISIBLE_BARS, count + RIGHT_MARGIN_BARS));
        const to = count + RIGHT_MARGIN_BARS;
        setLogicalRange(chart, to - span, to);
      };

      if (refit || !snapshot.logical) {
        if (count <= DEFAULT_VISIBLE_BARS) fit();
        else showTail(DEFAULT_VISIBLE_BARS);
        return;
      }

      const previousSpan = snapshot.logical.to - snapshot.logical.from;
      const span = Number.isFinite(previousSpan) && previousSpan >= MIN_VISIBLE_BARS
        ? previousSpan
        : DEFAULT_VISIBLE_BARS;

      // ── Timeframe switch: same wall-clock window, different bar indices ──
      if (keepTimeWindow && snapshot.timeWindow) {
        const firstTime = candles[0].time;
        const lastTime = candles[count - 1].time;
        const { from, to } = snapshot.timeWindow;

        // No overlap between the old window and the new series: restoring it
        // would park the viewport in empty space, which is exactly the "where
        // did my chart go" symptom. Fall back to a sane view instead.
        if (to < firstTime || from > lastTime) {
          showTail(DEFAULT_VISIBLE_BARS);
          return;
        }

        // How many of the new bars actually fall inside the old window?
        const firstIndex = candles.findIndex((c) => c.time >= from);
        const lastIndex = candles.findIndex((c) => c.time > to);
        const barsInWindow =
          (lastIndex === -1 ? count : lastIndex) - (firstIndex === -1 ? count : firstIndex);

        if (barsInWindow < MIN_BARS_AFTER_TF_SWITCH) {
          // Too coarse to be readable: keep the right edge, widen the span.
          const anchor = lastIndex === -1 ? count : lastIndex;
          const to_ = Math.min(count + RIGHT_MARGIN_BARS, anchor + RIGHT_MARGIN_BARS);
          setLogicalRange(chart, to_ - MIN_BARS_AFTER_TF_SWITCH, to_);
          return;
        }

        isProgrammaticRef.current = true;
        try {
          chart.timeScale().setVisibleRange({
            from: clamp(from, firstTime, lastTime) as UTCTimestamp,
            to: clamp(to, firstTime, lastTime) as UTCTimestamp,
          });
        } catch (error) {
          console.warn('[viewport] setVisibleRange failed, refitting:', error);
          showTail(DEFAULT_VISIBLE_BARS);
        } finally {
          requestAnimationFrame(() => {
            isProgrammaticRef.current = false;
          });
        }
        return;
      }

      // ── Replay playback: follow the last candle, but only if the user is
      // actually watching the edge. Panning back into history opts out until
      // they scroll forward again.
      if (followTail) {
        if (snapshot.wasFollowingTail) showTail(span);
        // Otherwise: leave the viewport exactly where the user put it.
        return;
      }

      // ── Data appended without a mode change: hold the current bar indices,
      // unless the view has drifted entirely off the series.
      const isOffscreen = snapshot.logical.from >= count || snapshot.logical.to <= 0;
      if (isOffscreen) showTail(span);
    },
    [chart, fit, setLogicalRange]
  );

  // Memoised: the returned object goes into the chart effect's dependency
  // array, so a fresh identity per render would re-run `setData` every time.
  return useMemo(() => ({ capture, apply, fit }), [capture, apply, fit]);
}
