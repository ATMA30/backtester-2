// ========================================================
//  INDICATORS — SMA, EMA, RSI, MACD, Bollinger Bands, VWAP
//  Depends on: config.js, ui.js, chart.js
// ========================================================

function _getCacheKey(type, period, candlesHash) {
  return `${type}:${period}:${candlesHash}`;
}

function _hashCandles(candles) {
  if (!candles?.length) return "0";
  return `${candles.length}:${candles[0].close}:${candles[Math.floor(candles.length/2)].close}:${candles[candles.length-1].close}`;
}

// ── INDICATOR MENU ────────────────────────────────────────
function updateIndMenu() {
  const cont = document.getElementById("active-indicators-list");
  if (!customIndicators.length) {
    cont.innerHTML = `<div style="padding:8px 10px;font-size:11.5px;color:var(--text-muted);font-style:italic;">Aucun indicateur</div>`;
    return;
  }
  cont.innerHTML = customIndicators.map(ind => {
    let label;
    if (ind.type === "MACD") label = `MACD(${ind.fastP},${ind.slowP},${ind.signalP})`;
    else if (ind.type === "BB") label = `BB(${ind.period},${ind.multiplier})`;
    else if (ind.type === "VWAP") label = "VWAP";
    else label = `${ind.type}(${ind.period})`;
    return `
    <div class="ind-item">
      <span class="ind-item-dot" style="background:${ind.color}"></span>
      <span class="ind-item-label">${label}</span>
      <button class="ind-item-remove" onclick="removeIndicator('${ind.id}')">✕</button>
    </div>`;
  }).join("");
}

function adjustPanes() {
  if (!chart) return;
  try {
    const hasRSI  = customIndicators.some(x => x.type === "RSI");
    const hasMACD = customIndicators.some(x => x.type === "MACD");

    if (hasRSI && hasMACD) {
      // 4 zones: candles 0-45%, volume 50-65%, RSI 70-85%, MACD 88-100%
      chart.applyOptions({ rightPriceScale: { autoScale: true, scaleMargins: { top: 0.05, bottom: 0.55 } } });
      if (volumeSeries) chart.priceScale("volume").applyOptions({ autoScale: true, scaleMargins: { top: 0.50, bottom: 0.40 } });
      try { chart.priceScale("rsi").applyOptions({ autoScale: true, scaleMargins: { top: 0.70, bottom: 0.18 } }); } catch (_) {}
      try { chart.priceScale("macd").applyOptions({ autoScale: true, scaleMargins: { top: 0.88, bottom: 0 } }); } catch (_) {}
    } else if (hasRSI) {
      // 3 zones: candles, volume, RSI
      chart.applyOptions({ rightPriceScale: { autoScale: true, scaleMargins: { top: 0.05, bottom: 0.45 } } });
      if (volumeSeries) chart.priceScale("volume").applyOptions({ autoScale: true, scaleMargins: { top: 0.60, bottom: 0.25 } });
      try { chart.priceScale("rsi").applyOptions({ autoScale: true, scaleMargins: { top: 0.80, bottom: 0 } }); } catch (_) {}
      try { chart.priceScale("macd").applyOptions({ scaleMargins: { top: 1, bottom: 0 } }); } catch (_) {}
    } else if (hasMACD) {
      // 3 zones: candles, volume, MACD
      chart.applyOptions({ rightPriceScale: { autoScale: true, scaleMargins: { top: 0.05, bottom: 0.45 } } });
      if (volumeSeries) chart.priceScale("volume").applyOptions({ autoScale: true, scaleMargins: { top: 0.60, bottom: 0.25 } });
      try { chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 1, bottom: 0 } }); } catch (_) {}
      try { chart.priceScale("macd").applyOptions({ autoScale: true, scaleMargins: { top: 0.80, bottom: 0 } }); } catch (_) {}
    } else {
      // 2 zones: candles, volume
      chart.applyOptions({ rightPriceScale: { autoScale: true, scaleMargins: { top: 0.05, bottom: 0.30 } } });
      if (volumeSeries) chart.priceScale("volume").applyOptions({ autoScale: true, scaleMargins: { top: 0.80, bottom: 0 } });
      try { chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 1, bottom: 0 } }); } catch (_) {}
      try { chart.priceScale("macd").applyOptions({ scaleMargins: { top: 1, bottom: 0 } }); } catch (_) {}
    }
  } catch (e) {
    console.error("Pane adjust error:", e);
  }
}

function promptAddIndicator(type) {
  openIndicatorModal(type);
}

function removeIndicator(id) {
  const idx = customIndicators.findIndex(x => x.id === id);
  if (idx < 0) return;
  const ind = customIndicators[idx];

  // Handle multi-series indicators
  if (ind.series && typeof ind.series === "object" && !ind.series.setData) {
    // BB or MACD — series is an object with named keys
    Object.values(ind.series).forEach(s => {
      if (s && typeof s.removePriceLine !== "undefined") {
        try { chart.removeSeries(s); } catch (_) {}
      }
    });
  } else if (ind.series) {
    try { chart.removeSeries(ind.series); } catch (_) {}
  }

  customIndicators.splice(idx, 1);
  updateIndMenu();
  adjustPanes();
}

// ── COMPUTE FUNCTIONS ─────────────────────────────────────
function computeSMA(data, period) {
  const cacheKey = _getCacheKey("SMA", period, _hashCandles(data));
  if (_indicatorCache.has(cacheKey)) return _indicatorCache.get(cacheKey);

  const res = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) res.push({ time: data[i].time, value: sum / period });
  }
  _indicatorCache.set(cacheKey, res);
  return res;
}

function computeEMA(data, period) {
  const cacheKey = _getCacheKey("EMA", period, _hashCandles(data));
  if (_indicatorCache.has(cacheKey)) return _indicatorCache.get(cacheKey);

  const res = [];
  if (data.length < period) return res;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += data[i].close;
  let ema = seed / period;
  const k = 2 / (period + 1);
  res.push({ time: data[period - 1].time, value: ema });
  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
    res.push({ time: data[i].time, value: ema });
  }
  _indicatorCache.set(cacheKey, res);
  return res;
}

function computeRSI(data, period) {
  const cacheKey = _getCacheKey("RSI", period, _hashCandles(data));
  if (_indicatorCache.has(cacheKey)) return _indicatorCache.get(cacheKey);

  const res = [];
  if (data.length <= period) return res;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  res.push({ time: data[period].time, value: 100 - (100 / (1 + rs)) });

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    res.push({ time: data[i].time, value: 100 - (100 / (1 + rs)) });
  }
  _indicatorCache.set(cacheKey, res);
  return res;
}

function computeMACD(data, fastP, slowP, signalP) {
  const cacheKey = _getCacheKey("MACD", `${fastP}_${slowP}_${signalP}`, _hashCandles(data));
  if (_indicatorCache.has(cacheKey)) return _indicatorCache.get(cacheKey);

  const fastEMA = computeEMA(data, fastP);
  const slowEMA = computeEMA(data, slowP);
  const slowMap = new Map(slowEMA.map(d => [d.time, d.value]));
  const macdLine = fastEMA
    .filter(d => slowMap.has(d.time))
    .map(d => ({ time: d.time, value: d.value - slowMap.get(d.time) }));

  // Build synthetic candle data for EMA computation on MACD line
  const macdData = macdLine.map(d => ({ time: d.time, close: d.value, open: 0, high: 0, low: 0 }));
  const signalLine = computeEMA(macdData, signalP);
  const signalMap = new Map(signalLine.map(d => [d.time, d.value]));

  const histogram = macdLine
    .filter(d => signalMap.has(d.time))
    .map(d => ({
      time: d.time,
      value: d.value - signalMap.get(d.time),
      macd: d.value,
      signal: signalMap.get(d.time),
    }));

  const result = { macdLine, signalLine, histogram };
  _indicatorCache.set(cacheKey, result);
  return result;
}

function computeBollinger(data, period, stdDevMultiplier) {
  const cacheKey = _getCacheKey("BB", `${period}_${stdDevMultiplier}`, _hashCandles(data));
  if (_indicatorCache.has(cacheKey)) return _indicatorCache.get(cacheKey);

  const sma = computeSMA(data, period);
  const result = sma.map((s, i) => {
    // Align slice: SMA at index i corresponds to data[i] to data[i + period - 1]
    const dataIdx = i + (data.length - sma.length);
    const slice = data.slice(dataIdx - period + 1, dataIdx + 1);
    const variance = slice.reduce((acc, c) => acc + Math.pow(c.close - s.value, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
      time: s.time,
      middle: s.value,
      upper: s.value + stdDevMultiplier * stdDev,
      lower: s.value - stdDevMultiplier * stdDev,
    };
  });
  _indicatorCache.set(cacheKey, result);
  return result;
}

function computeVWAP(data) {
  const cacheKey = _getCacheKey("VWAP", 0, _hashCandles(data));
  if (_indicatorCache.has(cacheKey)) return _indicatorCache.get(cacheKey);

  let cumulativeTPV = 0, cumulativeVol = 0;
  const result = data
    .filter(c => c.volume > 0)
    .map(c => {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumulativeTPV += typicalPrice * c.volume;
      cumulativeVol += c.volume;
      return { time: c.time, value: cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : typicalPrice };
    });

  _indicatorCache.set(cacheKey, result);
  return result;
}

// ── RENDER INDICATORS ─────────────────────────────────────
function renderIndicators(candles) {
  if (!candles || !candles.length) return;

  customIndicators.forEach(ind => {
    if (ind.type === "MACD") {
      if (!ind.series) {
        // Create 3 series for MACD panel
        const macdSeries = chart.addLineSeries({
          color: ind.color, lineWidth: 1.5, priceScaleId: "macd",
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        });
        const signalSeries = chart.addLineSeries({
          color: "#F59E0B", lineWidth: 1, priceScaleId: "macd",
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        const histSeries = chart.addHistogramSeries({
          priceScaleId: "macd",
          priceLineVisible: false, lastValueVisible: false,
        });
        // Add zero line
        macdSeries.createPriceLine({ price: 0, color: "rgba(255,255,255,0.3)", lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
        ind.series = { macd: macdSeries, signal: signalSeries, hist: histSeries };
      }
      const result = computeMACD(candles, ind.fastP, ind.slowP, ind.signalP);
      ind.series.macd.setData(result.macdLine);
      ind.series.signal.setData(result.signalLine);
      const histData = result.histogram.map(d => ({
        time: d.time,
        value: d.value,
        color: d.value >= 0 ? "rgba(0,196,110,0.7)" : "rgba(242,54,74,0.7)",
      }));
      ind.series.hist.setData(histData);

    } else if (ind.type === "BB") {
      if (!ind.series) {
        const upperSeries = chart.addLineSeries({
          color: ind.color, lineWidth: 1, priceScaleId: "right",
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          lineStyle: 1, // dashed
        });
        const middleSeries = chart.addLineSeries({
          color: ind.color, lineWidth: 1.5, priceScaleId: "right",
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        });
        const lowerSeries = chart.addLineSeries({
          color: ind.color, lineWidth: 1, priceScaleId: "right",
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          lineStyle: 1, // dashed
        });
        ind.series = { upper: upperSeries, middle: middleSeries, lower: lowerSeries };
      }
      const result = computeBollinger(candles, ind.period, ind.multiplier || 2.0);
      ind.series.upper.setData(result.map(d => ({ time: d.time, value: d.upper })));
      ind.series.middle.setData(result.map(d => ({ time: d.time, value: d.middle })));
      ind.series.lower.setData(result.map(d => ({ time: d.time, value: d.lower })));

    } else if (ind.type === "VWAP") {
      if (!ind.series) {
        ind.series = chart.addLineSeries({
          color: ind.color, lineWidth: 1.5, priceScaleId: "right",
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        });
      }
      const data = computeVWAP(candles);
      ind._data = data;
      ind.series.setData(data);

    } else if (ind.type === "RSI") {
      if (!ind.series) {
        ind.series = chart.addLineSeries({
          color: ind.color, lineWidth: 2, priceScaleId: "rsi",
          priceLineVisible: false, lastValueVisible: true,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        });
        ind.series.createPriceLine({ price: 70, color: "rgba(255,255,255,0.4)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        ind.series.createPriceLine({ price: 30, color: "rgba(255,255,255,0.4)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      }
      const data = computeRSI(candles, ind.period);
      ind._data = data;
      ind.series.setData(data);

    } else {
      // SMA, EMA
      if (!ind.series) {
        ind.series = chart.addLineSeries({
          color: ind.color, lineWidth: 2, priceScaleId: "right",
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        });
      }
      let data = [];
      if (ind.type === "SMA") data = computeSMA(candles, ind.period);
      else if (ind.type === "EMA") data = computeEMA(candles, ind.period);
      ind._data = data;
      ind.series.setData(data);
    }
  });

  adjustPanes();
}

function updateIndicatorsLive(arr, time) {
  customIndicators.forEach(ind => {
    // Multi-series indicators: skip live update for simplicity (complex state)
    if (ind.type === "MACD" || ind.type === "BB") return;
    if (!ind.series || typeof ind.series !== "object" || !ind.series.update) return;

    let windowSize = 500;
    if (ind.type === "SMA") windowSize = ind.period;
    else if (ind.type === "EMA") windowSize = ind.period * 6;
    else if (ind.type === "RSI") windowSize = ind.period * 10;
    else if (ind.type === "VWAP") windowSize = arr.length; // VWAP is cumulative

    const sliceLen = Math.min(arr.length, Math.max(windowSize, 500));
    const sliced = arr.slice(-sliceLen);

    let data = [];
    if (ind.type === "SMA") data = computeSMA(sliced, ind.period);
    else if (ind.type === "EMA") data = computeEMA(sliced, ind.period);
    else if (ind.type === "RSI") data = computeRSI(sliced, ind.period);
    else if (ind.type === "VWAP") data = computeVWAP(sliced);

    if (data.length) ind.series.update(data[data.length - 1]);
  });
}
