import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
/**
 * The margin is the user's to choose — dragging the chart while the last
 * candle is on screen sets it, and playback keeps it — within these bounds:
 * never glued to the price scale, never more than most of the screen empty.
 */
const MIN_RIGHT_MARGIN_BARS = 2;
const MAX_RIGHT_MARGIN_RATIO = 0.75;
/** Below this span a restored window is treated as degenerate and refitted. */
const MIN_VISIBLE_BARS = 3;
/**
 * Silence after the last wheel event that ends a trackpad gesture. A trackpad
 * emits a stream of tiny wheel events (and momentum after the fingers lift);
 * a pause this long means the gesture is over.
 */
const WHEEL_GESTURE_IDLE_MS = 220;
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
  /**
   * Bars removed from the left of the series since the snapshot (the replay
   * window sliding forward). The same bar now sits that many indices lower.
   */
  readonly droppedBars?: number;
}

export interface ChartViewportControls {
  /**
   * Record the current view, against the bar count the user is looking at.
   * Call before mutating series data.
   */
  capture: (barCount: number) => ViewportSnapshot;
  /** Restore the recorded view against the new data. Call after `setData`. */
  apply: (snapshot: ViewportSnapshot, candles: readonly Candle[], options?: ApplyOptions) => void;
  /** Fit all data and clear the follow state. */
  fit: () => void;
  /** Scroll back to the last candle and follow it again. */
  resumeFollow: () => void;
}

interface ChartViewport extends ChartViewportControls {
  /** False while the user looks at history instead of following the tail. */
  isFollowing: boolean;
  /** Stable object for effect dependencies (excludes `isFollowing`). */
  controller: ChartViewportControls;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function useChartViewport(chart: IChartApi | null): ChartViewport {
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
  /** True between pointer-down on the chart and pointer-up: a drag in progress. */
  const isDraggingRef = useRef(false);
  /** Same for a trackpad / wheel gesture, which never fires a pointer-down. */
  const isWheelingRef = useRef(false);
  const wheelTimerRef = useRef<number | null>(null);
  /** Right margin, in bars, when the current gesture began (see `adoptView`). */
  const gestureStartMarginRef = useRef<number | null>(null);
  /**
   * Mirror of `followRef` for rendering: the chart shows a "back to the
   * present" button while the user is looking at history during playback.
   */
  const [isFollowing, setIsFollowing] = useState(true);
  /** Blank bars playback keeps right of the last candle — set by the user's pan. */
  const followOffsetRef = useRef(RIGHT_MARGIN_BARS);

  const setFollow = useCallback((value: boolean) => {
    followRef.current = value;
    setIsFollowing(value);
  }, []);

  /**
   * Read the view where the user left it, once their gesture is over.
   *
   * Last candle still on screen: they are watching the present, at the margin
   * they just chose — playback keeps that gap to the price scale instead of
   * snapping back to a fixed six bars. Last candle pushed off screen: they are
   * reading history, and playback leaves the view alone until they come back.
   */
  const adoptView = useCallback(
    (range: LogicalRange, count: number, startMargin: number | null = null) => {
      const lastBar = count - 1;
      const lastBarOnScreen = range.to >= lastBar + 0.5 && range.from <= lastBar;
      if (!lastBarOnScreen) {
        setFollow(false);
        return;
      }
      // Pushing past the edge. A gesture that starts with the last candle
      // already against the minimum margin and moves further back wants
      // history. Clamped back to the minimum, a slow wheel — one notch per
      // gesture, each a fraction of a bar — could never leave the present.
      //
      // The last candle must then actually leave the screen: while it is
      // visible, the library shifts the view by itself on every new bar, and
      // the chart would keep following under a « Revenir au présent » button.
      const margin = range.to - count;
      if (startMargin !== null && startMargin <= MIN_RIGHT_MARGIN_BARS + 0.5 && margin < startMargin - 0.05) {
        if (chart) {
          // Half the last bar past the right edge.
          const shift = margin + 1.5;
          try {
            chart.timeScale().setVisibleLogicalRange({ from: range.from - shift, to: range.to - shift });
          } catch (error) {
            console.warn('[viewport] setVisibleLogicalRange failed:', error);
          }
        }
        setFollow(false);
        return;
      }
      const span = range.to - range.from;
      followOffsetRef.current = clamp(
        range.to - count,
        MIN_RIGHT_MARGIN_BARS,
        Math.max(MIN_RIGHT_MARGIN_BARS, span * MAX_RIGHT_MARGIN_RATIO)
      );
      setFollow(true);
    },
    [chart, setFollow]
  );

  const setLogicalRange = useCallback(
    (chartApi: IChartApi, from: number, to: number) => {
      try {
        chartApi.timeScale().setVisibleLogicalRange({ from, to });
      } catch (error) {
        console.warn('[viewport] setVisibleLogicalRange failed:', error);
      }
    },
    []
  );

  // No range-change subscription on purpose. The library shifts the view by
  // itself when bars are appended, and those events look exactly like a user
  // pan: read as one, against a bar count one tick stale, each widened the
  // remembered right margin by a bar — the gap to the price scale grew by a
  // candle per tick. Only real gestures (drag, wheel, trackpad, pinch) change
  // the follow state or the margin, and they are judged once they end, below.

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

    /** Where the gesture starts from, for `adoptView` to tell a push past the edge. */
    const recordStart = () => {
      const range = chart.timeScale().getVisibleLogicalRange();
      const count = lastBarCountRef.current;
      gestureStartMarginRef.current = range && count > 0 ? range.to - count : null;
    };

    const handlePointerDown = () => {
      isDraggingRef.current = true;
      recordStart();
    };

    const handlePointerUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;

      const count = lastBarCountRef.current;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range || count === 0) return;
      // Auto-scroll was suspended for the whole drag, so the view is exactly
      // where the hand left it: judge that, once.
      adoptView(range, count, gestureStartMarginRef.current);
    };

    /**
     * Trackpad and wheel: the same rule as a drag.
     *
     * A two-finger swipe fires no pointer-down, only a stream of tiny wheel
     * events, each moving the view by a fraction of a bar. Judged one by one
     * against the 2-bar pan threshold, none of them released auto-scroll, and
     * the next tick pulled the chart back to the present: going back in time
     * during playback was impossible with a trackpad. The gesture now suspends
     * auto-scroll until it goes quiet, then is judged on its total movement.
     */
    const endWheelGesture = () => {
      wheelTimerRef.current = null;
      isWheelingRef.current = false;

      const count = lastBarCountRef.current;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range || count === 0) return;

      // Zoom or pan, the rule is the same: is the last candle still on screen?
      adoptView(range, count, gestureStartMarginRef.current);
    };

    const handleWheel = () => {
      if (!isWheelingRef.current) recordStart();
      isWheelingRef.current = true;
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
      wheelTimerRef.current = window.setTimeout(endWheelGesture, WHEEL_GESTURE_IDLE_MS);
    };

    surface.addEventListener('pointerdown', handlePointerDown);
    // Capture phase: the library handles the wheel on its own node, and the
    // drawing overlay may stop propagation; the capture listener sees it first.
    surface.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    // On window: a drag routinely ends outside the chart, and a pointer-up we
    // never see would leave auto-scroll suspended for good.
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      surface.removeEventListener('pointerdown', handlePointerDown);
      surface.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
    };
  }, [chart, adoptView]);

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
        view.logical === null || barCount === 0
          ? true
          : followRef.current && !isDraggingRef.current && !isWheelingRef.current;

      return { ...view, barCount, wasFollowingTail };
    },
    [readCurrentView]
  );

  const fit = useCallback(() => {
    if (!chart) return;
    chart.timeScale().fitContent();
    followOffsetRef.current = RIGHT_MARGIN_BARS;
    setFollow(true);
  }, [chart, setFollow]);

  const apply = useCallback(
    (snapshot: ViewportSnapshot, candles: readonly Candle[], options: ApplyOptions = {}) => {
      if (!chart || candles.length === 0) return;

      const count = candles.length;
      const { refit = false, keepTimeWindow = false, followTail = false, droppedBars = 0 } = options;

      // Range events fired from here on are measured against the new series.
      lastBarCountRef.current = count;
      if (refit) {
        followOffsetRef.current = RIGHT_MARGIN_BARS;
        setFollow(true);
      }

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
        const margin = followOffsetRef.current;
        const span = clamp(bars, MIN_VISIBLE_BARS, Math.max(MIN_VISIBLE_BARS, count + margin));
        const to = count + margin;
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

        if (barsInWindow > 250) {
          // Too dense to be readable (e.g. jumping from 1D down to 1m or 5m):
          // cramming thousands of bars makes candles hair-thin and invisible.
          // Show a readable tail around the anchor / last candle instead.
          const anchor = lastIndex === -1 ? count : lastIndex;
          const to_ = Math.min(count + RIGHT_MARGIN_BARS, anchor + RIGHT_MARGIN_BARS);
          setLogicalRange(chart, Math.max(0, to_ - DEFAULT_VISIBLE_BARS), to_);
          return;
        }

        try {
          chart.timeScale().setVisibleRange({
            from: clamp(from, firstTime, lastTime) as UTCTimestamp,
            to: clamp(to, firstTime, lastTime) as UTCTimestamp,
          });
        } catch (error) {
          console.warn('[viewport] setVisibleRange failed, refitting:', error);
          showTail(DEFAULT_VISIBLE_BARS);
        }
        return;
      }

      // ── Replay playback: follow the last candle, but only if the user is
      // actually watching the edge. Panning back into history opts out until
      // they scroll forward again.
      if (followTail) {
        if (snapshot.wasFollowingTail) showTail(span);
        // Otherwise: leave the viewport exactly where the user put it — on the
        // same bars, which moved down by however many were dropped on the left.
        else if (droppedBars > 0) {
          setLogicalRange(chart, snapshot.logical.from - droppedBars, snapshot.logical.to - droppedBars);
        }
        return;
      }

      // ── Data appended without a mode change: hold the current bar indices,
      // unless the view has drifted entirely off the series.
      const isOffscreen = snapshot.logical.from >= count || snapshot.logical.to <= 0;
      if (isOffscreen) showTail(span);
    },
    [chart, fit, setLogicalRange, setFollow]
  );

  /** Jump back to the last candle and follow it again, keeping the zoom. */
  const resumeFollow = useCallback(() => {
    if (!chart) return;
    const count = lastBarCountRef.current;
    const range = chart.timeScale().getVisibleLogicalRange();
    const span = range ? range.to - range.from : DEFAULT_VISIBLE_BARS;
    // Back at the margin the user last chose, not a fixed one.
    const to = count + followOffsetRef.current;
    setLogicalRange(chart, to - span, to);
    setFollow(true);
  }, [chart, setLogicalRange, setFollow]);

  // Memoised: the returned object goes into the chart effect's dependency
  // array, so a fresh identity per render would re-run `setData` every time.
  // `isFollowing` is deliberately left out of that object's identity: the
  // data effect reads the follow state through `capture`, not through it.
  const controller = useMemo(
    () => ({ capture, apply, fit, resumeFollow }),
    [capture, apply, fit, resumeFollow]
  );
  return { ...controller, isFollowing, controller };
}
