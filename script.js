// ========================================================
//  STATE & UTILS
// ========================================================
function toggleDropdown(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const wasShown = menu.classList.contains("show");
  document
    .querySelectorAll(".tv-dropdown-menu")
    .forEach((m) => m.classList.remove("show"));
  if (!wasShown) menu.classList.add("show");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".tv-dropdown")) {
    document
      .querySelectorAll(".tv-dropdown-menu")
      .forEach((m) => m.classList.remove("show"));
  }
});

let chart = null;
let mainSeries = null;
let volumeSeries = null;
let rawData = [];
let parsedHeaders = [];
let rawRows = [];
let currentType = "Candlestick";
let showVolume = true;
let showGrid = true;
let currentSymbol = "DATA";
let allCandles = [];

// ========================================================
//  CHART INIT
// ========================================================
function initChart() {
  const container = document.getElementById("tv-chart");
  chart = LightweightCharts.createChart(container, {
    layout: {
      background: { color: "#040508" },
      textColor: "#aeb4c5",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: "#0d111b", visible: true },
      horzLines: { color: "#0d111b", visible: true },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        color: "#2962ff",
        width: 1,
        style: 1,
        labelBackgroundColor: "#2962ff",
      },
      horzLine: {
        color: "#2962ff",
        width: 1,
        style: 1,
        labelBackgroundColor: "#2962ff",
      },
    },
    rightPriceScale: {
      borderColor: "#161a25",
      scaleMargins: { top: 0.1, bottom: 0.25 },
    },
    timeScale: {
      borderColor: "#161a25",
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  });

  // Add main series (candlestick by default)
  createMainSeries();

  // Volume series
  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    color: "#2962ff",
  });
  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
  });

  // Crosshair tooltip
  chart.subscribeCrosshairMove(handleCrosshair);

  // Resize
  const ro = new ResizeObserver(() => {
    chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight,
    });
  });
  ro.observe(container);
  chart.applyOptions({
    width: container.clientWidth,
    height: container.clientHeight,
  });
}

function createMainSeries() {
  if (mainSeries) {
    chart.removeSeries(mainSeries);
    mainSeries = null;
  }
  if (currentType === "Candlestick") {
    mainSeries = chart.addCandlestickSeries({
      upColor: "#0cf19b",
      downColor: "#ff3c4c",
      borderUpColor: "#0cf19b",
      borderDownColor: "#ff3c4c",
      wickUpColor: "#0cf19b",
      wickDownColor: "#ff3c4c",
    });
  } else if (currentType === "Bar") {
    mainSeries = chart.addBarSeries({
      upColor: "#0cf19b",
      downColor: "#ff3c4c",
    });
  } else if (currentType === "Line") {
    mainSeries = chart.addLineSeries({
      color: "#2962ff",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });
  } else if (currentType === "Area") {
    mainSeries = chart.addAreaSeries({
      lineColor: "#2962ff",
      topColor: "rgba(41,98,255, 0.3)",
      bottomColor: "rgba(41,98,255, 0.01)",
      lineWidth: 2,
    });
  }
}

// ========================================================
//  CHART TYPE
// ========================================================
function setChartType(type) {
  currentType = type;
  const mapIcon = {
    Candlestick: "🕯️ Chandeliers",
    Bar: "📊 Barres",
    Line: "📈 Ligne",
    Area: "🌊 Aire",
  };
  const labelEl = document.getElementById("label-active-ctype");
  if (labelEl) labelEl.textContent = mapIcon[type];

  // Highlight active item in menu
  const menuList = document.getElementById("menu-ctype");
  if (menuList) {
    const items = menuList.querySelectorAll(".tv-dropdown-item");
    items.forEach((i) => i.classList.remove("active"));
    items.forEach((i) => {
      if (i.textContent.includes(mapIcon[type])) i.classList.add("active");
    });
  }

  createMainSeries();
  if (allCandles.length) renderChart(allCandles);
}

function toggleVolume() {
  showVolume = !showVolume;
  if (volumeSeries) volumeSeries.applyOptions({ visible: showVolume });
  document.getElementById("btn-volume").classList.toggle("active", showVolume);
}

function toggleGrid() {
  showGrid = !showGrid;
  chart.applyOptions({
    grid: {
      vertLines: { visible: showGrid },
      horzLines: { visible: showGrid },
    },
  });
  document.getElementById("btn-grid").classList.toggle("active", showGrid);
}

function fitContent() {
  chart.timeScale().fitContent();
}

// ========================================================
//  CROSSHAIR TOOLTIP — cached DOM refs, no innerHTML
// ========================================================
// Cached DOM references — resolved once after DOMContentLoaded
let _dom = null;
function domRefs() {
  if (_dom) return _dom;
  _dom = {
    tooltip: document.getElementById("crosshair-tooltip"),
    chartContainer: document.getElementById("chart-container"),
    rowsCount: document.getElementById("rows-count"),
    statusRows: document.getElementById("status-rows"),
    statusRange: document.getElementById("status-range"),
    rangeText: document.getElementById("range-text"),
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    welcomeOverlay: document.getElementById("welcome-overlay"),
  };
  return _dom;
}

// Pre-build tooltip DOM structure once (avoid innerHTML on every crosshair move)
let _ttBuilt = false,
  _ttDate,
  _ttO,
  _ttH,
  _ttL,
  _ttC,
  _ttChg;
function ensureTooltipDOM() {
  if (_ttBuilt) return;
  const tt = domRefs().tooltip;
  tt.innerHTML = `
    <div class="tt-date" style="color:var(--text-muted);margin-bottom:6px;font-size:10px"></div>
    <div class="tt-row"><span class="tt-label">O</span><span class="tt-val tt-o"></span></div>
    <div class="tt-row"><span class="tt-label">H</span><span class="tt-val tt-h" style="color:var(--green)"></span></div>
    <div class="tt-row"><span class="tt-label">L</span><span class="tt-val tt-l" style="color:var(--red)"></span></div>
    <div class="tt-row"><span class="tt-label">C</span><span class="tt-val tt-c"></span></div>
    <div class="tt-row"><span class="tt-label">Var</span><span class="tt-val tt-change tt-chg"></span></div>
  `;
  _ttDate = tt.querySelector(".tt-date");
  _ttO = tt.querySelector(".tt-o");
  _ttH = tt.querySelector(".tt-h");
  _ttL = tt.querySelector(".tt-l");
  _ttC = tt.querySelector(".tt-c");
  _ttChg = tt.querySelector(".tt-chg");
  _ttBuilt = true;
}

// Fast date formatter — cache Intl.DateTimeFormat instance (avoid creating options each call)
const _dateFormatter =
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    })
    : null;

function handleCrosshair(param) {
  const { tooltip, chartContainer } = domRefs();
  if (!mainSeries || !param.time || !param.seriesData.has(mainSeries)) {
    tooltip.style.display = "none";
    return;
  }
  const d = param.seriesData.get(mainSeries);
  if (!d) {
    tooltip.style.display = "none";
    return;
  }

  ensureTooltipDOM();

  const O = d.open ?? d.value ?? 0;
  const H = d.high ?? d.value ?? 0;
  const L = d.low ?? d.value ?? 0;
  const C = d.close ?? d.value ?? 0;
  const chg = O > 0 ? ((C - O) / O) * 100 : 0;
  const chgStr = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";

  _ttDate.textContent =
    typeof param.time === "number"
      ? _dateFormatter
        ? _dateFormatter.format(new Date(param.time * 1000))
        : new Date(param.time * 1000).toLocaleString()
      : String(param.time);
  _ttO.textContent = fmt(O);
  _ttH.textContent = fmt(H);
  _ttL.textContent = fmt(L);
  _ttC.textContent = fmt(C);
  _ttChg.textContent = chgStr;
  _ttChg.className = "tt-val tt-change " + (chg >= 0 ? "up" : "down");

  tooltip.style.display = "block";
  const rect = chartContainer.getBoundingClientRect();
  let x = param.point.x + 12;
  let y = param.point.y - tooltip.offsetHeight / 2;
  if (x + 160 > rect.width) x = param.point.x - 160;
  if (y < 4) y = 4;
  if (y + tooltip.offsetHeight > rect.height - 4)
    y = rect.height - tooltip.offsetHeight - 4;
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";

  // Update topbar OHLCV
  setOHLCV(O, H, L, C, chg);
}

// ========================================================
//  INDICATORS
// ========================================================
// ========================================================
//  INDICATORS
// ========================================================
let customIndicators = [];
const IND_COLORS = ["#ff9800", "#2196f3", "#9c27b0", "#4caf50", "#e91e63", "#00bcd4", "#8bc34a"];

function updateIndMenu() {
  const cont = document.getElementById("active-indicators-list");
  if (!customIndicators.length) {
    cont.innerHTML = `<div style="padding: 10px; font-size: 12px; color: var(--text-muted); font-style: italic;">Aucun indicateur</div>`;
    return;
  }
  cont.innerHTML = customIndicators.map(ind => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding: 6px 16px; border-bottom: 1px solid var(--border-light);">
      <div style="display:flex; align-items:center; gap:8px;">
         <span style="display:inline-block; width:10px; height:10px; background:${ind.color}; border-radius:50%"></span>
         <span style="font-size:12px;">${ind.type} ${ind.period}</span>
      </div>
      <button onclick="removeIndicator('${ind.id}')" style="background:transparent; border:none; color:var(--red); cursor:pointer; font-size:14px;">✕</button>
    </div>
  `).join("");
}

function adjustPanes() {
  try {
    const hasRSI = customIndicators.some(x => x.type === "RSI");
    if (hasRSI) {
      // Les marges top + bottom ne doivent jamais dépasser 1.0
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.35 } });
      if (volumeSeries) chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.65, bottom: 0.25 } });
      chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
    } else {
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
      if (volumeSeries) chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      try { chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 1, bottom: 0 } }); } catch (err) { }
    }
  } catch (e) {
    console.error("Pane adjust error:", e);
  }
}

function promptAddIndicator(type) {
  const defaultPeriod = type === "RSI" ? 14 : (type === "SMA" ? 20 : 50);
  const p = prompt(`Ajouter ${type}\\nEntrez la période souhaitée (ex: ${defaultPeriod}):`, defaultPeriod);
  if (!p) return;
  const period = parseInt(p, 10);
  if (isNaN(period) || period <= 0) return alert("Période invalide");

  const id = Date.now().toString();
  const color = IND_COLORS[customIndicators.length % IND_COLORS.length];

  const ind = { id, type, period, color, series: null };
  customIndicators.push(ind);

  updateIndMenu();
  if (allCandles && allCandles.length) {
    renderIndicators(allCandles);
  }
}

function removeIndicator(id) {
  const idx = customIndicators.findIndex(x => x.id === id);
  if (idx < 0) return;
  const ind = customIndicators[idx];
  if (ind.series) {
    chart.removeSeries(ind.series);
  }
  customIndicators.splice(idx, 1);
  updateIndMenu();
  adjustPanes();
}

function computeSMA(data, period) {
  const res = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i].close;
    if (i >= period) sum -= data[i - period].close;
    if (i >= period - 1) res.push({ time: data[i].time, value: sum / period });
  }
  return res;
}

function computeEMA(data, period) {
  const res = [];
  if (!data.length) return res;
  let ema = data[0].close;
  const k = 2 / (period + 1);
  for (let i = 0; i < data.length; i++) {
    ema = (data[i].close - ema) * k + ema;
    res.push({ time: data[i].time, value: ema });
  }
  return res;
}

function computeRSI(data, period) {
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
  return res;
}

function renderIndicators(candles) {
  if (!candles || !candles.length) return;

  customIndicators.forEach(ind => {
    if (!ind.series) {
      if (ind.type === "RSI") {
        ind.series = chart.addLineSeries({
          color: ind.color, lineWidth: 2, priceScaleId: "rsi",
          priceLineVisible: false, lastValueVisible: true,
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: 0, maxValue: 100 }
          }),
        });
        ind.series.createPriceLine({ price: 70, color: 'rgba(255,255,255,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
        ind.series.createPriceLine({ price: 30, color: 'rgba(255,255,255,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
      } else {
        ind.series = chart.addLineSeries({
          color: ind.color, lineWidth: 2, priceScaleId: "right",
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        });
      }
    }

    let data = [];
    if (ind.type === "SMA") data = computeSMA(candles, ind.period);
    else if (ind.type === "EMA") data = computeEMA(candles, ind.period);
    else if (ind.type === "RSI") data = computeRSI(candles, ind.period);

    ind._data = data;
    ind.series.setData(data);
  });

  adjustPanes();
}

function updateIndicatorsLive(arr, time) {
  customIndicators.forEach(ind => {
    if (!ind.series) return;

    // Fast path: compute only on the highly relevant recent slice
    let windowSize = 500;
    if (ind.type === "SMA") windowSize = ind.period;
    else if (ind.type === "EMA") windowSize = ind.period * 6;
    else if (ind.type === "RSI") windowSize = ind.period * 10;

    const sliceLen = Math.min(arr.length, Math.max(windowSize, 500));
    const sliced = arr.slice(-sliceLen);

    let data = [];
    if (ind.type === "SMA") data = computeSMA(sliced, ind.period);
    else if (ind.type === "EMA") data = computeEMA(sliced, ind.period);
    else if (ind.type === "RSI") data = computeRSI(sliced, ind.period);

    if (data.length) ind.series.update(data[data.length - 1]);
  });
}

// ========================================================
//  RENDER CHART
// ========================================================
function renderChart(candles) {
  allCandles = candles;
  const n = candles.length;
  const isLine = currentType === "Line" || currentType === "Area";

  // Set data — lightweight-charts accepts objects with extra keys, no need to strip
  if (isLine) {
    // Line/Area requires {time, value}, build with pre-allocated array
    const arr = new Array(n);
    for (let i = 0; i < n; i++)
      arr[i] = { time: candles[i].time, value: candles[i].close };
    mainSeries.setData(arr);
  } else {
    // Candlestick/Bar: pass candle objects directly (extra 'volume' key is ignored)
    mainSeries.setData(candles);
  }

  // Volume — pre-allocate, avoid .map()
  const volData = new Array(n);
  const upColor = "rgba(0,200,150,0.5)",
    downColor = "rgba(255,68,102,0.5)";
  for (let i = 0; i < n; i++) {
    volData[i] = {
      time: candles[i].time,
      value: candles[i].volume || 0,
      color: candles[i].close >= candles[i].open ? upColor : downColor,
    };
  }
  volumeSeries.setData(volData);

  chart.timeScale().fitContent();

  // Stats — single-pass loop
  let hi = -Infinity,
    lo = Infinity;
  for (let i = 0; i < n; i++) {
    if (candles[i].high > hi) hi = candles[i].high;
    if (candles[i].low < lo) lo = candles[i].low;
  }
  const firstClose = candles[0].close;
  const lastClose = candles[n - 1].close;
  const totalChg =
    firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;

  const dom = domRefs();

  // Status
  dom.rowsCount.textContent = n.toLocaleString("fr-FR");
  dom.statusRows.style.display = "";
  dom.statusRange.style.display = "";
  dom.rangeText.textContent =
    dateFromTime(candles[0].time) + " → " + dateFromTime(candles[n - 1].time);
  dom.statusDot.className = "status-dot green";
  dom.statusText.textContent = currentSymbol + " — " + n + " bougies chargées";

  // Hide welcome
  dom.welcomeOverlay.style.opacity = "0";
  setTimeout(() => (dom.welcomeOverlay.style.display = "none"), 400);

  // Render indicators
  renderIndicators(candles);
}

function dateFromTime(t) {
  if (typeof t === "number")
    return new Date(t * 1000).toLocaleDateString("fr-FR");
  return String(t);
}

function renderTable(candles) {
  // table removed
}

function highlightCandle(idx) {
  if (!allCandles[idx]) return;
  const c = allCandles[idx];
  chart.timeScale().scrollToPosition(0, false);
  setOHLCV(c.open, c.high, c.low, c.close, ((c.close - c.open) / c.open) * 100);
}

function setOHLCV(o, h, l, c, chg) {
  // Navigation topbar ohlcv has been removed.
}

// Fast number formatter — avoids toLocaleString (100x slower than manual)
const _fmtCache = new Map();
function fmt(v) {
  if (!v && v !== 0) return "—";
  const n = +v;
  if (n !== n) return "—"; // NaN check without function call
  const abs = n < 0 ? -n : n;
  let s;
  if (abs >= 1000) {
    s = n.toFixed(2);
    // Insert thousand separators manually (fr-FR uses space)
    const parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
    s = parts.join(",");
  } else if (abs >= 1) {
    s = n.toFixed(4);
  } else {
    s = n.toFixed(6);
  }
  return s;
}

// ========================================================
//  FILE PARSING
// ========================================================
let pendingFile = null;

function handleDragOver(e, el) {
  e.preventDefault();
  el.classList.add("dragging");
}
function handleDragLeave(el) {
  el.classList.remove("dragging");
}

function handleDrop(e) {
  e.preventDefault();
  document.querySelector("#drop-zone").classList.remove("dragging");
  const f = e.dataTransfer.files[0];
  if (f) {
    openModal();
    setTimeout(() => processFile(f), 100);
  }
}

function handleDropModal(e) {
  e.preventDefault();
  document.getElementById("modal-drop").classList.remove("dragging");
  const f = e.dataTransfer.files[0];
  if (f) processFile(f);
}

function handleFileSelect(input) {
  const f = input.files[0];
  if (f) processFile(f);
}

// ========================================================
//  LARGE FILE PARSER — Web Worker + progress bar
// ========================================================
let workerPendingHeaders = null; // headers from first-line scan
let workerPendingSep = null;
let workerPendingIsJson = false;
let activeWorker = null;

function processFile(file) {
  pendingFile = file;
  document.getElementById("drop-filename").textContent = `✅ ${file.name}`;
  document.getElementById("modal-drop").style.borderColor = "var(--green)";
  if (!document.getElementById("symbol-input").value)
    document.getElementById("symbol-input").value = file.name
      .replace(/\.[^.]+$/, "")
      .toUpperCase()
      .slice(0, 16);

  const ext = file.name.split(".").pop().toLowerCase();
  workerPendingIsJson = ext === "json";

  if (workerPendingIsJson) {
    // JSON: read full and scan headers from first object
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        let data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) data = data[Object.keys(data)[0]];
        rawRows = data;
        const headers = Object.keys(data[0]);
        parsedHeaders = headers;
        populateMapper(headers);
      } catch (e) {
        showError("JSON invalide: " + e.message);
      }
    };
    reader.readAsText(file);
    return;
  }

  // CSV: read only first 64KB to detect headers, then import on demand
  const headSlice = file.slice(0, 65536);
  const headReader = new FileReader();
  headReader.onload = (ev) => {
    const chunk = ev.target.result;
    const firstLine = chunk.split(/\r?\n/)[0];
    workerPendingSep = detectSep(firstLine);
    const headers = firstLine
      .split(workerPendingSep)
      .map((h) => h.trim().replace(/['"<>]/g, ""));
    workerPendingHeaders = headers;
    parsedHeaders = headers;
    rawRows = null; // signal: use streaming
    populateMapper(headers);
  };
  headReader.readAsText(headSlice);
}

// Legacy — not used for large CSV anymore, kept for tiny files
function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  if (lines.length < 2) return showError("Fichier trop court");
  const sep = detectSep(lines[0]);
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/['"<>]/g, ""));
  parsedHeaders = headers;
  rawRows = lines
    .slice(1)
    .map((l) => {
      const vals = splitLine(l, sep);
      const obj = {};
      headers.forEach(
        (h, i) => (obj[h] = (vals[i] || "").replace(/['"]/g, "").trim()),
      );
      return obj;
    })
    .filter((r) => Object.values(r).some((v) => v));
  populateMapper(headers);
}

function parseJSON(content) {
  try {
    let data = JSON.parse(content);
    if (!Array.isArray(data)) data = data[Object.keys(data)[0]];
    if (!Array.isArray(data) || !data.length) return showError("JSON invalide");
    rawRows = data;
    parsedHeaders = Object.keys(data[0]);
    populateMapper(parsedHeaders);
  } catch (e) {
    showError("JSON invalide: " + e.message);
  }
}

function detectSep(line) {
  const counts = { ",": 0, ";": 0, "\t": 0, "|": 0 };
  Object.keys(counts).forEach((s) => (counts[s] = line.split(s).length - 1));
  return Object.keys(counts).reduce((a, b) => (counts[a] > counts[b] ? a : b));
}

function splitLine(line, sep) {
  const result = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === sep && !inQ) {
      result.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  result.push(cur);
  return result;
}

function populateMapper(headers) {
  const fields = ["date", "time", "open", "high", "low", "close", "volume"];
  const selects = {
    date: "#col-date",
    time: "#col-time",
    open: "#col-open",
    high: "#col-high",
    low: "#col-low",
    close: "#col-close",
    volume: "#col-volume",
  };
  fields.forEach((f) => {
    const sel = document.querySelector(selects[f]);
    let matchedId = null;
    let html = (f === "volume" || f === "time" ? '<option value="">— Aucun —</option>' : "");
    headers.forEach((h) => {
      const isMatch = !matchedId && autoMatch(h, f);
      if (isMatch) matchedId = h;
      html += `<option value="${h}" ${isMatch ? "selected" : ""}>${h}</option>`;
    });
    sel.innerHTML = html;
  });
  document.getElementById("col-mapper").classList.add("visible");
  document.getElementById("import-btn").classList.add("ready");
}

function autoMatch(header, field) {
  const h = header.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const maps = {
    date: [
      "date",
      "time",
      "timestamp",
      "datetime",
      "dt",
      "open_time",
      "opentime",
      "close_time",
      "ts",
    ],
    time: ["time", "heure", "hour"],
    open: ["open", "o", "open_price"],
    high: ["high", "h", "max", "high_price"],
    low: ["low", "l", "min", "low_price"],
    close: ["close", "c", "last", "price", "close_price"],
    volume: ["volume", "vol", "v", "qty", "tickvol"],
  };
  return (maps[field] || []).some((k) => h === k || h.startsWith(k));
}

function showError(msg) {
  document.getElementById("drop-filename").textContent = "❌ " + msg;
  document.getElementById("modal-drop").style.borderColor = "var(--red)";
}

// ========================================================
//  IMPORT — streams large CSV through Web Worker
// ========================================================

// Inline worker source — uses TypedArrays for zero-copy transfer
const CSV_WORKER_SRC = `
self.onmessage = function(e) {
  var d = e.data;
  var text = d.text, sep = d.sep, dateIdx = d.dateIdx, timeIdx = d.timeIdx, openIdx = d.openIdx;
  var highIdx = d.highIdx, lowIdx = d.lowIdx, closeIdx = d.closeIdx, volIdx = d.volIdx;
  var BATCH = 100000, len = text.length;
  var lineStart = 0, lineNum = 0;
  while (lineStart < len && text[lineStart] !== "\\n") lineStart++;
  lineStart++;

  function parseTs(s) {
    s = s.trim();
    if (!s) return null;
    if (/^\\d{9,10}$/.test(s)) return parseInt(s);
    if (/^\\d{13}$/.test(s)) return Math.floor(parseInt(s) / 1000);
    var iso = s.replace(/\\//g, "-").replace(/\\./g, "-");
    if (iso.indexOf(" ") !== -1) iso = iso.replace(" ", "T") + "Z";
    var dd = new Date(iso);
    if (!isNaN(dd.getTime())) return Math.floor(dd.getTime() / 1000);
    var f = new Date(s);
    if (!isNaN(f.getTime())) return Math.floor(f.getTime() / 1000);
    if (/^\\d{8}$/.test(s)) {
      var d2 = new Date(s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8)+"T00:00:00Z");
      if (!isNaN(d2.getTime())) return Math.floor(d2.getTime() / 1000);
    }
    return null;
  }

  // Pre-allocate growable arrays (avoids frequent object creation)
  var cap = 500000;
  var times = new Float64Array(cap);
  var opens = new Float64Array(cap);
  var highs = new Float64Array(cap);
  var lows  = new Float64Array(cap);
  var closes = new Float64Array(cap);
  var vols  = new Float64Array(cap);
  var count = 0;

  function grow() {
    cap = cap * 2;
    var nt = new Float64Array(cap); nt.set(times); times = nt;
    var no = new Float64Array(cap); no.set(opens); opens = no;
    var nh = new Float64Array(cap); nh.set(highs); highs = nh;
    var nl = new Float64Array(cap); nl.set(lows);  lows  = nl;
    var nc = new Float64Array(cap); nc.set(closes); closes = nc;
    var nv = new Float64Array(cap); nv.set(vols);  vols  = nv;
  }

  var pos = lineStart;
  while (pos < len) {
    var end = text.indexOf("\\n", pos);
    if (end === -1) end = len;
    var lineEnd = end;
    if (lineEnd > pos && text[lineEnd - 1] === "\\r") lineEnd--;
    if (lineEnd <= pos) { pos = end + 1; continue; }

    // Inline split — avoid allocating arrays for each line
    var colIdx = 0, colStart = pos;
    var tRaw = "", tTimeRaw = "", oRaw = "", hRaw = "", lRaw = "", cRaw = "", vRaw = "";
    for (var i = pos; i <= lineEnd; i++) {
      if (i === lineEnd || text[i] === sep) {
        if (colIdx === dateIdx)  tRaw = text.slice(colStart, i);
        if (colIdx === timeIdx)  tTimeRaw = text.slice(colStart, i);
        if (colIdx === openIdx)  oRaw = text.slice(colStart, i);
        if (colIdx === highIdx)  hRaw = text.slice(colStart, i);
        if (colIdx === lowIdx)   lRaw = text.slice(colStart, i);
        if (colIdx === closeIdx) cRaw = text.slice(colStart, i);
        if (colIdx === volIdx)   vRaw = text.slice(colStart, i);
        colIdx++;
        colStart = i + 1;
      }
    }
    pos = end + 1;

    var tStr = tRaw.replace(/['"]/g, "");
    if (timeIdx >= 0) tStr += " " + tTimeRaw.replace(/['"]/g, "");
    var t = parseTs(tStr);
    var o = parseFloat(oRaw);
    var h = parseFloat(hRaw);
    var l = parseFloat(lRaw);
    var c = parseFloat(cRaw);
    var v = volIdx >= 0 ? (parseFloat(vRaw) || 0) : 0;
    if (t && !isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c)) {
      if (count >= cap) grow();
      times[count] = t; opens[count] = o; highs[count] = h;
      lows[count] = l; closes[count] = c; vols[count] = v;
      count++;
    }
    lineNum++;
    if (lineNum % BATCH === 0) {
      self.postMessage({ type: "progress", done: pos, total: len, count: count });
    }
  }

  // Sort by time — in-place on typed arrays
  self.postMessage({ type: "progress", done: len, total: len, count: count, phase: "sort" });
  var indices = new Uint32Array(count);
  for (var i = 0; i < count; i++) indices[i] = i;
  indices.sort(function(a, b) { return times[a] - times[b]; });

  // Deduplicate + compact into transferable buffers
  var rT = new Float64Array(count);
  var rO = new Float64Array(count);
  var rH = new Float64Array(count);
  var rL = new Float64Array(count);
  var rC = new Float64Array(count);
  var rV = new Float64Array(count);
  var n = 0, lastT = -1;
  for (var i = 0; i < count; i++) {
    var idx = indices[i];
    if (times[idx] !== lastT) {
      rT[n] = times[idx]; rO[n] = opens[idx]; rH[n] = highs[idx];
      rL[n] = lows[idx]; rC[n] = closes[idx]; rV[n] = vols[idx];
      lastT = times[idx];
      n++;
    }
  }

  // Trim to actual size
  var fT = rT.subarray(0, n);
  var fO = rO.subarray(0, n);
  var fH = rH.subarray(0, n);
  var fL = rL.subarray(0, n);
  var fC = rC.subarray(0, n);
  var fV = rV.subarray(0, n);

  // Copy to transferable buffers (subarray shares the same underlying buffer)
  var bT = new Float64Array(fT).buffer;
  var bO = new Float64Array(fO).buffer;
  var bH = new Float64Array(fH).buffer;
  var bL = new Float64Array(fL).buffer;
  var bC = new Float64Array(fC).buffer;
  var bV = new Float64Array(fV).buffer;

  self.postMessage({
    type: "done",
    totalRaw: count,
    count: n,
    times: bT, opens: bO, highs: bH, lows: bL, closes: bC, volumes: bV
  }, [bT, bO, bH, bL, bC, bV]);
};
`;

// Fallback: main-thread CSV parsing when Worker fails
function _parseCSVMainThread(
  file,
  dateCol,
  timeCol,
  openCol,
  highCol,
  lowCol,
  closeCol,
  volCol,
) {
  showProgress(0, "Parsing (mode principal)…");
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const text = ev.target.result;
      const headers = workerPendingHeaders;
      const sep = workerPendingSep;
      const idx = (col) => headers.indexOf(col);
      const lines = text.split("\n");
      const candles = [];
      const timeI = timeCol ? idx(timeCol) : -1;
      const dateI = idx(dateCol);
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, "");
        if (!line) continue;
        const cols = line.split(sep);

        let tStr = (cols[dateI] || "").replace(/['"]/g, "");
        if (timeI >= 0) tStr += " " + (cols[timeI] || "").replace(/['"]/g, "");
        const t = parseTimestamp(tStr);

        const o = parseFloat(cols[idx(openCol)]);
        const h = parseFloat(cols[idx(highCol)]);
        const l = parseFloat(cols[idx(lowCol)]);
        const c = parseFloat(cols[idx(closeCol)]);
        const v = volCol ? parseFloat(cols[idx(volCol)]) || 0 : 0;
        if (t && !isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(c)) {
          candles.push({
            time: t,
            open: o,
            high: h,
            low: l,
            close: c,
            volume: v,
          });
        }
        if (i % 50000 === 0)
          showProgress(
            Math.round((i / lines.length) * 100),
            `Parsing… ${i}/${lines.length}`,
          );
      }
      candles.sort((a, b) => a.time - b.time);
      const seen = new Set();
      const dedup = candles.filter((c) => {
        if (seen.has(c.time)) return false;
        seen.add(c.time);
        return true;
      });
      if (!dedup.length) throw new Error("Aucune donnée valide");
      baseCandles = dedup;
      sortedTimes = dedup.map((c) => c.time);
      buildTFButtons(dedup);
      renderChart(dedup, true);
      document.getElementById("welcome-overlay").style.display = "none";
      document.getElementById("status-dot").className = "status-dot green";
      document.getElementById("status-text").textContent =
        `${currentSymbol} — ${dedup.length.toLocaleString()} bougies`;
      hideProgress();
    } catch (err) {
      hideProgress();
      alert("Erreur parsing: " + err.message);
    }
  };
  reader.onerror = () => {
    hideProgress();
    alert("Erreur de lecture du fichier.");
  };
  reader.readAsText(file);
}

function importData() {
  const dateCol = document.getElementById("col-date").value;
  let timeCol = document.getElementById("col-time")?.value || "";

  if (timeCol === dateCol) timeCol = "";

  const openCol = document.getElementById("col-open").value;
  const highCol = document.getElementById("col-high").value;
  const lowCol = document.getElementById("col-low").value;
  const closeCol = document.getElementById("col-close").value;
  const volCol = document.getElementById("col-volume").value;
  currentSymbol = (
    document.getElementById("symbol-input").value || "DATA"
  ).toUpperCase();

  if (!dateCol || !openCol || !highCol || !lowCol || !closeCol) {
    alert("Veuillez associer toutes les colonnes obligatoires (*)");
    return;
  }

  closeModal();

  // Small in-memory JSON or pre-loaded data
  if (rawRows && rawRows.length) {
    showLoading(true);
    setTimeout(() => {
      try {
        const candles = buildCandles(
          rawRows.map((row) => ({
            t: timeCol ? (row[dateCol] + " " + row[timeCol]) : row[dateCol],
            o: row[openCol],
            h: row[highCol],
            l: row[lowCol],
            c: row[closeCol],
            v: volCol ? row[volCol] : 0,
          })),
        );
        if (!candles.length) throw new Error("Aucune donnée valide");
        renderChart(candles);
      } catch (e) {
        alert(e.message);
      } finally {
        showLoading(false);
      }
    }, 50);
    return;
  }

  // Large CSV → stream via Web Worker
  if (!pendingFile) return;
  showProgress(0, "Lecture du fichier…");

  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }

  // Create worker from inline Blob to avoid CORS/MIME/path issues
  try {
    const blob = new Blob([CSV_WORKER_SRC], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    activeWorker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
  } catch (e) {
    hideProgress();
    // Fallback: parse on main thread
    _parseCSVMainThread(
      pendingFile,
      dateCol,
      timeCol,
      openCol,
      highCol,
      lowCol,
      closeCol,
      volCol,
    );
    return;
  }

  const headers = workerPendingHeaders;
  const sep = workerPendingSep;
  const idx = (col) => headers.indexOf(col);
  const timeIdx = timeCol ? idx(timeCol) : -1;

  activeWorker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "progress") {
      const pct = Math.round((msg.done / msg.total) * 100);
      const phase = msg.phase === "sort" ? "Tri & dédup…" : `Lecture… ${pct}%`;
      const countK = (msg.count / 1000).toFixed(0);
      showProgress(pct, `${phase} — ${countK}k lignes`);
      return;
    }
    if (msg.type === "done") {
      activeWorker.terminate();
      activeWorker = null;

      try {
        const n = msg.count;
        const totalRaw = msg.totalRaw || n;
        if (!n) throw new Error("Aucune donnée valide");

        showProgress(95, `Construction de ${(n / 1000).toFixed(0)}k bougies…`);

        // Rebuild candle objects from TypedArrays + pre-cache flat arrays
        const times = new Float64Array(msg.times);
        const opens = new Float64Array(msg.opens);
        const highs = new Float64Array(msg.highs);
        const lows = new Float64Array(msg.lows);
        const closes = new Float64Array(msg.closes);
        const volumes = new Float64Array(msg.volumes);

        // Pre-cache flat arrays so ensureBaseFlat() is instant
        baseFlatTimes = times;
        baseFlatOpens = opens;
        baseFlatHighs = highs;
        baseFlatLows = lows;
        baseFlatCloses = closes;
        baseFlatVolumes = volumes;

        const candles = new Array(n);
        for (let i = 0; i < n; i++) {
          candles[i] = {
            time: times[i],
            open: opens[i],
            high: highs[i],
            low: lows[i],
            close: closes[i],
            volume: volumes[i],
          };
        }

        baseCandles = candles;
        sortedTimes = Array.from(times);
        buildTFButtons(candles);

        const MAX_DISPLAY = 200000;
        let displayed = candles;
        let autoTFLabel = "";

        if (n > MAX_DISPLAY) {
          const targetBars = 100000;
          const neededTF = Math.ceil((times[n - 1] - times[0]) / targetBars);
          const TFS = [60, 300, 900, 1800, 3600, 14400, 86400];
          const autoTF = TFS.find((t) => t >= neededTF) || 86400;
          const TFLABELS = {
            60: "1m",
            300: "5m",
            900: "15m",
            1800: "30m",
            3600: "1H",
            14400: "4H",
            86400: "1D",
          };
          autoTFLabel = TFLABELS[autoTF] || "1D";

          // Fast aggregation using flat arrays
          const groups = new Map();
          for (let i = 0; i < n; i++) {
            const b = Math.floor(times[i] / autoTF) * autoTF;
            let g = groups.get(b);
            if (!g) {
              groups.set(b, {
                time: b,
                open: opens[i],
                high: highs[i],
                low: lows[i],
                close: closes[i],
                volume: volumes[i],
              });
            } else {
              if (highs[i] > g.high) g.high = highs[i];
              if (lows[i] < g.low) g.low = lows[i];
              g.close = closes[i];
              g.volume += volumes[i];
            }
          }
          displayed = Array.from(groups.values()).sort(
            (a, b) => a.time - b.time,
          );
        }

        renderChart(displayed, true);
        document.getElementById("welcome-overlay").style.display = "none";
        document.getElementById("status-dot").className = "status-dot green";
        const suffix = autoTFLabel ? ` (affiché en ${autoTFLabel})` : "";
        document.getElementById("status-text").textContent =
          `${currentSymbol} — ${n.toLocaleString()} bougies${suffix}`;
        hideProgress();
      } catch (err) {
        hideProgress();
        alert(err.message);
      }
    }
  };

  activeWorker.onerror = (err) => {
    activeWorker.terminate();
    activeWorker = null;
    hideProgress();
    // Fallback to main thread parsing
    _parseCSVMainThread(
      pendingFile,
      dateCol,
      timeCol,
      openCol,
      highCol,
      lowCol,
      closeCol,
      volCol,
    );
  };

  // Stream full file text to worker
  showProgress(0, "Chargement du fichier…");
  const fileReader = new FileReader();
  fileReader.onload = (ev) => {
    showProgress(5, "Parsing en cours…");
    try {
      activeWorker.postMessage({
        text: ev.target.result,
        sep: workerPendingSep,
        dateIdx: idx(dateCol),
        timeIdx: timeIdx,
        openIdx: idx(openCol),
        highIdx: idx(highCol),
        lowIdx: idx(lowCol),
        closeIdx: idx(closeCol),
        volIdx: volCol ? idx(volCol) : -1,
      });
    } catch (err) {
      hideProgress();
      alert("Erreur d'envoi au worker: " + err.message);
    }
  };
  fileReader.onerror = () => {
    hideProgress();
    alert("Erreur de lecture du fichier.");
  };
  fileReader.readAsText(pendingFile);
}

// ---- progress bar helpers ----
function showProgress(pct, label) {
  let bar = document.getElementById("parse-progress");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "parse-progress";
    bar.innerHTML = `
                  <div id="pp-backdrop"></div>
                  <div id="pp-box">
                    <div id="pp-icon">⚙️</div>
                    <div id="pp-label">Chargement…</div>
                    <div id="pp-track"><div id="pp-fill"></div></div>
                    <div id="pp-pct">0%</div>
                    <button id="pp-cancel" onclick="cancelImport()">Annuler</button>
                  </div>`;
    // Styles
    const s = document.createElement("style");
    s.textContent = `
                  #parse-progress { position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center; }
                  #pp-backdrop { position:absolute;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(4px); }
                  #pp-box { position:relative;background:#1e2438;border:1px solid #2a3352;border-radius:14px;
                    padding:32px 40px;min-width:380px;text-align:center;box-shadow:0 16px 48px rgba(0,0,0,.5); }
                  #pp-icon { font-size:40px;margin-bottom:12px;animation:spin .8s linear infinite;display:inline-block; }
                  #pp-label { color:#8892a4;font-size:13px;margin-bottom:16px;font-family:'Inter',sans-serif; }
                  #pp-track { background:#1a1f2e;border-radius:8px;height:8px;overflow:hidden;margin-bottom:8px; }
                  #pp-fill { height:100%;background:linear-gradient(90deg,#4c7aff,#a855f7);border-radius:8px;
                    transition:width .2s ease;width:0%; }
                  #pp-pct { font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;
                    color:#e8ecf4;margin-bottom:16px; }
                  #pp-cancel { background:transparent;border:1px solid #2a3352;color:#8892a4;
                    padding:6px 20px;border-radius:6px;cursor:pointer;font-family:'Inter',sans-serif;font-size:12px; }
                  #pp-cancel:hover { border-color:#ff4466;color:#ff4466; }
                `;
    document.head.appendChild(s);
    document.body.appendChild(bar);
  }
  document.getElementById("pp-label").textContent = label || "Chargement…";
  document.getElementById("pp-fill").style.width = pct + "%";
  document.getElementById("pp-pct").textContent = pct + "%";
}

function hideProgress() {
  const bar = document.getElementById("parse-progress");
  if (bar) bar.remove();
}

function cancelImport() {
  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }
  hideProgress();
}

function buildCandles(rows) {
  const candles = rows
    .map((r) => ({
      time: parseTimestamp(String(r.t || "")),
      open: parseFloat(r.o),
      high: parseFloat(r.h),
      low: parseFloat(r.l),
      close: parseFloat(r.c),
      volume: parseFloat(r.v) || 0,
    }))
    .filter((c) => c.time && !isNaN(c.open) && !isNaN(c.close));
  candles.sort((a, b) => a.time - b.time);
  const seen = new Set();
  return candles.filter((c) => {
    const k = c.time;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseTimestamp(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;

  // Unix timestamp (seconds)
  if (/^\d{9,10}$/.test(s)) return parseInt(s);
  // Unix timestamp (milliseconds)
  if (/^\d{13}$/.test(s)) return Math.floor(parseInt(s) / 1000);

  let isoStr = s.replace(/\//g, "-").replace(/\./g, "-");
  if (isoStr.indexOf(" ") !== -1) isoStr = isoStr.replace(" ", "T") + "Z";

  // ISO or common date strings
  const d = new Date(isoStr);
  if (!isNaN(d.getTime())) {
    return Math.floor(d.getTime() / 1000);
  }
  const f = new Date(s);
  if (!isNaN(f.getTime())) {
    return Math.floor(f.getTime() / 1000);
  }

  // YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    const d2 = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
    if (!isNaN(d2.getTime())) return Math.floor(d2.getTime() / 1000);
  }
  // Try as a string date for lightweight-charts day format YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function showLoading(show) {
  document.getElementById("loading").classList.toggle("show", show);
}

// ========================================================
//  SAMPLE DATA
// ========================================================
function loadSampleData() {
  currentSymbol = "BTCUSD";
  document.getElementById("symbol-input").value = currentSymbol;
  showLoading(true);

  setTimeout(() => {
    try {
      const candles = generateSampleCandles("2024-01-01", 300, 42000, 0.025);
      renderChart(candles);
    } catch (e) {
      alert("Erreur chargement démo: " + e.message);
    } finally {
      showLoading(false);
    }
  }, 100);
}

function generateSampleCandles(startDate, count, basePrice, volatility) {
  const candles = [];
  let price = basePrice;
  let ts = Math.floor(new Date(startDate).getTime() / 1000);
  const DAY = 86400;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.48) * volatility;
    const open = price;
    price = price * (1 + change);
    const hi = Math.max(open, price) * (1 + Math.random() * volatility * 0.5);
    const lo = Math.min(open, price) * (1 - Math.random() * volatility * 0.5);
    const vol = Math.floor(Math.random() * 50000 + 10000);
    candles.push({
      time: ts,
      open: +open.toFixed(2),
      high: +hi.toFixed(2),
      low: +lo.toFixed(2),
      close: +price.toFixed(2),
      volume: vol,
    });
    ts += DAY;
  }
  return candles;
}

// ========================================================
//  EXPORT CSV
// ========================================================
function exportCSV() {
  if (!allCandles.length) {
    alert("Aucune donnée à exporter");
    return;
  }
  const header = "time,open,high,low,close,volume\n";
  const rows = allCandles
    .map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`)
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${currentSymbol}_data.csv`;
  a.click();
}

// ========================================================
//  MODAL
// ========================================================
function openModal() {
  if (replay.picking || replay.active) exitReplay();

  document.getElementById("modal-overlay").classList.add("open");
  // Reset
  document.getElementById("modal-drop").style.borderColor = "";
  document.getElementById("drop-filename").textContent =
    "Glissez un fichier CSV ou JSON";
  document.getElementById("col-mapper").classList.remove("visible");
  document.getElementById("import-btn").classList.remove("ready");
  document.getElementById("file-hidden").value = "";
  pendingFile = null;
}
function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
}
function closeModalOutside(e) {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
}

// ========================================================
//  MULTI-TIMEFRAME
// ========================================================
// tfType: 'intraday' = simple floor | 'week' = Monday | 'month' = 1st | 'quarter' | 'year'
const TF_DEFS = [
  { label: "1m", s: 60, tfType: "intraday" },
  { label: "5m", s: 300, tfType: "intraday" },
  { label: "15m", s: 900, tfType: "intraday" },
  { label: "30m", s: 1800, tfType: "intraday" },
  { label: "1H", s: 3600, tfType: "intraday" },
  { label: "4H", s: 14400, tfType: "intraday" },
  { label: "1D", s: 86400, tfType: "intraday" },
  { label: "1W", s: 604800, tfType: "week" },
  { label: "1M", s: 2678400, tfType: "month" }, // ~31d, real boundary via calendar
  { label: "3M", s: 7776000, tfType: "quarter" }, // real boundary via calendar
  { label: "1Y", s: 31536000, tfType: "year" }, // real boundary via calendar
];
let baseCandles = [];
let baseTF = 86400;
let activeTF = 86400;
let activeTFType = "intraday";

function detectBaseTF(candles) {
  if (candles.length < 2) return 86400;
  const diffs = [];
  for (let i = 1; i < Math.min(20, candles.length); i++) {
    const d = candles[i].time - candles[i - 1].time;
    if (d > 0) diffs.push(d);
  }
  if (!diffs.length) return 86400;
  diffs.sort((a, b) => a - b);
  return diffs[0];
}

// Max bars the chart can render smoothly
const MAX_DISPLAY = 200000;

// Worker source for background TF aggregation (used for large datasets)
const AGG_WORKER_SRC = `
self.onmessage = function(e) {
    var d = e.data;
    var times = new Float64Array(d.times);
    var opens = new Float64Array(d.opens);
    var highs = new Float64Array(d.highs);
    var lows  = new Float64Array(d.lows);
    var closes = new Float64Array(d.closes);
    var volumes = new Float64Array(d.volumes);
    var tfSec = d.tfSec, tfType = d.tfType, baseTF = d.baseTF, MAX = d.MAX;
    var n = times.length;

    function getBucket(t) {
        if (tfType === 'week') {
            var dd = new Date(t * 1000);
            var day = dd.getUTCDay();
            var diff = (day === 0) ? 6 : day - 1;
            return Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate() - diff) / 1000;
        }
        if (tfType === 'month') {
            var dd = new Date(t * 1000);
            return Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), 1) / 1000;
        }
        if (tfType === 'quarter') {
            var dd = new Date(t * 1000);
            var q = Math.floor(dd.getUTCMonth() / 3);
            return Date.UTC(dd.getUTCFullYear(), q * 3, 1) / 1000;
        }
        if (tfType === 'year') {
            var dd = new Date(t * 1000);
            return Date.UTC(dd.getUTCFullYear(), 0, 1) / 1000;
        }
        return Math.floor(t / tfSec) * tfSec;
    }

    if (!tfSec || tfSec <= baseTF) {
        var start = n > MAX ? n - MAX : 0;
        var sz = n - start;
        var rT = new Float64Array(sz), rO = new Float64Array(sz), rH = new Float64Array(sz);
        var rL = new Float64Array(sz), rC = new Float64Array(sz), rV = new Float64Array(sz);
        for (var i = 0; i < sz; i++) {
            var j = start + i;
            rT[i] = times[j]; rO[i] = opens[j]; rH[i] = highs[j];
            rL[i] = lows[j]; rC[i] = closes[j]; rV[i] = volumes[j];
        }
        var bT=rT.buffer, bO=rO.buffer, bH=rH.buffer, bL=rL.buffer, bC=rC.buffer, bV=rV.buffer;
        self.postMessage({times:bT,opens:bO,highs:bH,lows:bL,closes:bC,volumes:bV,count:sz},[bT,bO,bH,bL,bC,bV]);
        return;
    }

    // Pre-allocate result arrays (max = n, will be trimmed)
    var cap = Math.min(n, 500000);
    var rT = new Float64Array(cap), rO = new Float64Array(cap), rH = new Float64Array(cap);
    var rL = new Float64Array(cap), rC = new Float64Array(cap), rV = new Float64Array(cap);
    var cnt = 0;

    var curBucket = getBucket(times[0]);
    var o = opens[0], h = highs[0], l = lows[0], c = closes[0], v = volumes[0] || 0;

    for (var i = 1; i < n; i++) {
        var b = getBucket(times[i]);
        if (b !== curBucket) {
            if (cnt >= cap) {
                cap *= 2;
                var nt = new Float64Array(cap); nt.set(rT); rT = nt;
                var no = new Float64Array(cap); no.set(rO); rO = no;
                var nh = new Float64Array(cap); nh.set(rH); rH = nh;
                var nl = new Float64Array(cap); nl.set(rL); rL = nl;
                var nc = new Float64Array(cap); nc.set(rC); rC = nc;
                var nv = new Float64Array(cap); nv.set(rV); rV = nv;
            }
            rT[cnt]=curBucket; rO[cnt]=o; rH[cnt]=h; rL[cnt]=l; rC[cnt]=c; rV[cnt]=v;
            cnt++;
            curBucket=b; o=opens[i]; h=highs[i]; l=lows[i]; c=closes[i]; v=volumes[i]||0;
        } else {
            if (highs[i] > h) h = highs[i];
            if (lows[i]  < l) l = lows[i];
            c = closes[i];
            v += volumes[i] || 0;
        }
    }
    if (cnt >= cap) {
        cap *= 2;
        var nt = new Float64Array(cap); nt.set(rT); rT = nt;
        var no = new Float64Array(cap); no.set(rO); rO = no;
        var nh = new Float64Array(cap); nh.set(rH); rH = nh;
        var nl = new Float64Array(cap); nl.set(rL); rL = nl;
        var nc = new Float64Array(cap); nc.set(rC); rC = nc;
        var nv = new Float64Array(cap); nv.set(rV); rV = nv;
    }
    rT[cnt]=curBucket; rO[cnt]=o; rH[cnt]=h; rL[cnt]=l; rC[cnt]=c; rV[cnt]=v;
    cnt++;

    var start = cnt > MAX ? cnt - MAX : 0;
    var sz = cnt - start;
    var fT = new Float64Array(sz), fO = new Float64Array(sz), fH = new Float64Array(sz);
    var fL = new Float64Array(sz), fC = new Float64Array(sz), fV = new Float64Array(sz);
    for (var i = 0; i < sz; i++) {
        var j = start + i;
        fT[i]=rT[j]; fO[i]=rO[j]; fH[i]=rH[j]; fL[i]=rL[j]; fC[i]=rC[j]; fV[i]=rV[j];
    }
    var bT=fT.buffer, bO=fO.buffer, bH=fH.buffer, bL=fL.buffer, bC=fC.buffer, bV=fV.buffer;
    self.postMessage({times:bT,opens:bO,highs:bH,lows:bL,closes:bC,volumes:bV,count:sz},[bT,bO,bH,bL,bC,bV]);
};
`;

// Cache of pre-computed flat arrays from baseCandles (built once, reused)
let baseFlatTimes = null,
  baseFlatOpens = null,
  baseFlatHighs = null;
let baseFlatLows = null,
  baseFlatCloses = null,
  baseFlatVolumes = null;
let aggWorker = null;

function ensureBaseFlat() {
  if (baseFlatTimes && baseFlatTimes.length === baseCandles.length) return;
  const n = baseCandles.length;
  // Single pass — 6 TypedArrays at once, avoid 6x .map() overhead
  const t = new Float64Array(n),
    o = new Float64Array(n),
    h = new Float64Array(n);
  const l = new Float64Array(n),
    c = new Float64Array(n),
    v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cc = baseCandles[i];
    t[i] = cc.time;
    o[i] = cc.open;
    h[i] = cc.high;
    l[i] = cc.low;
    c[i] = cc.close;
    v[i] = cc.volume || 0;
  }
  baseFlatTimes = t;
  baseFlatOpens = o;
  baseFlatHighs = h;
  baseFlatLows = l;
  baseFlatCloses = c;
  baseFlatVolumes = v;
}

// ── Calendar-aware bucket function (main thread version mirrors worker) ──
function getCalendarBucket(t, tfType, tfSec) {
  if (tfType === "week") {
    const d = new Date(t * 1000);
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    return (
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff) /
      1000
    );
  }
  if (tfType === "month") {
    const d = new Date(t * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }
  if (tfType === "quarter") {
    const d = new Date(t * 1000);
    const q = Math.floor(d.getUTCMonth() / 3);
    return Date.UTC(d.getUTCFullYear(), q * 3, 1) / 1000;
  }
  if (tfType === "year") {
    const d = new Date(t * 1000);
    return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
  }
  return Math.floor(t / tfSec) * tfSec;
}

function aggregateCandles(candles, tfSec, tfType) {
  if (!tfSec || tfSec <= baseTF)
    return candles.length > MAX_DISPLAY ? candles.slice(-MAX_DISPLAY) : candles;
  // Linear scan — data already sorted, single pass O(n), no Map needed
  const n = candles.length;
  if (!n) return [];
  const res = [];
  let curBucket = getCalendarBucket(candles[0].time, tfType, tfSec);
  let o = candles[0].open,
    h = candles[0].high,
    l = candles[0].low;
  let c = candles[0].close,
    v = candles[0].volume || 0;
  for (let i = 1; i < n; i++) {
    const b = getCalendarBucket(candles[i].time, tfType, tfSec);
    if (b !== curBucket) {
      res.push({
        time: curBucket,
        open: o,
        high: h,
        low: l,
        close: c,
        volume: v,
      });
      curBucket = b;
      o = candles[i].open;
      h = candles[i].high;
      l = candles[i].low;
      c = candles[i].close;
      v = candles[i].volume || 0;
    } else {
      if (candles[i].high > h) h = candles[i].high;
      if (candles[i].low < l) l = candles[i].low;
      c = candles[i].close;
      v += candles[i].volume || 0;
    }
  }
  res.push({ time: curBucket, open: o, high: h, low: l, close: c, volume: v });
  return res.length > MAX_DISPLAY ? res.slice(-MAX_DISPLAY) : res;
}

function buildTFButtons(candles) {
  baseTF = detectBaseTF(candles);
  activeTF = baseTF;
  baseFlatTimes = null;
  const grp = document.getElementById("tf-group");
  grp.innerHTML = "";

  // Initialize Active Text
  const currentTfDef = TF_DEFS.find((t) => t.s === baseTF) || TF_DEFS[0];
  document.getElementById("label-active-tf").textContent = currentTfDef.label;

  TF_DEFS.forEach((tf) => {
    if (tf.s < baseTF) return;
    const btn = document.createElement("div");
    btn.className = "tv-dropdown-item" + (tf.s === baseTF ? " active" : "");
    btn.textContent = tf.label;
    btn.onclick = () => {
      switchTF(tf.s, tf.tfType, btn);
      toggleDropdown("menu-tf");
    };
    grp.appendChild(btn);
  });
}

function switchTF(tfSec, tfType, btn) {
  activeTF = tfSec;
  activeTFType = tfType;

  document
    .querySelectorAll("#tf-group .tv-dropdown-item")
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");

  const tfDef = TF_DEFS.find((t) => t.s === tfSec);
  if (tfDef)
    document.getElementById("label-active-tf").textContent = tfDef.label;

  const setStatusAgg = (label) => {
    document.getElementById("status-dot").style.background = "var(--yellow)";
    document.getElementById("status-text").textContent = `Agrégation ${label}…`;
  };
  const clearStatusAgg = () => {
    document.getElementById("status-dot").className = "status-dot green";
  };

  if (baseCandles.length > 50000) {
    setStatusAgg(btn.textContent);
    ensureBaseFlat();
    if (aggWorker) {
      aggWorker.terminate();
      aggWorker = null;
    }
    const blob = new Blob([AGG_WORKER_SRC], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    aggWorker = new Worker(url);
    aggWorker.onmessage = (e) => {
      aggWorker.terminate();
      aggWorker = null;
      URL.revokeObjectURL(url);
      clearStatusAgg();
      // Receive TypedArray transferables
      const msg = e.data;
      const n = msg.count;
      const times = new Float64Array(msg.times);
      const opens = new Float64Array(msg.opens);
      const highs = new Float64Array(msg.highs);
      const lows = new Float64Array(msg.lows);
      const closes = new Float64Array(msg.closes);
      const volumes = new Float64Array(msg.volumes);
      const candles = new Array(n);
      for (let i = 0; i < n; i++) {
        candles[i] = {
          time: times[i],
          open: opens[i],
          high: highs[i],
          low: lows[i],
          close: closes[i],
          volume: volumes[i],
        };
      }
      renderChart(candles, true);
      requestAnimationFrame(() => requestAnimationFrame(drawRedraw));
    };
    aggWorker.onerror = (err) => {
      clearStatusAgg();
      alert("Erreur agrégation: " + err.message);
    };
    // Slice arrays up to the current replay index if replay is active
    const endIdx = replay.active ? replay.idx + 1 : baseFlatTimes.length;

    // Send as transferable ArrayBuffers (zero-copy)
    const tBuf = baseFlatTimes.buffer.slice(0, endIdx * 8);
    const oBuf = baseFlatOpens.buffer.slice(0, endIdx * 8);
    const hBuf = baseFlatHighs.buffer.slice(0, endIdx * 8);
    const lBuf = baseFlatLows.buffer.slice(0, endIdx * 8);
    const cBuf = baseFlatCloses.buffer.slice(0, endIdx * 8);
    const vBuf = baseFlatVolumes.buffer.slice(0, endIdx * 8);
    aggWorker.postMessage(
      {
        times: tBuf,
        opens: oBuf,
        highs: hBuf,
        lows: lBuf,
        closes: cBuf,
        volumes: vBuf,
        tfSec,
        tfType,
        baseTF,
        MAX: MAX_DISPLAY,
      },
      [tBuf, oBuf, hBuf, lBuf, cBuf, vBuf],
    );
  } else {
    const targetCandles = replay.active
      ? baseCandles.slice(0, replay.idx + 1)
      : baseCandles;
    const agg = aggregateCandles(targetCandles, tfSec, tfType);
    renderChart(agg, true);
    requestAnimationFrame(() => requestAnimationFrame(drawRedraw));
  }
}

// Override renderChart to also store baseCandles & build TF buttons & update sortedTimes
const _origRenderChart = renderChart;
renderChart = function (candles, isAgg) {
  if (!isAgg) {
    baseCandles = candles;
    buildTFButtons(candles);
  }
  // Build sortedTimes efficiently — data is already sorted from import/aggregation
  // Just extract times without re-sorting (already sorted by time)
  const n = candles.length;
  const st = new Array(n);
  for (let i = 0; i < n; i++) st[i] = candles[i].time;
  sortedTimes = st;
  _origRenderChart(candles);
};

// ========================================================
//  DRAWING ENGINE
// ========================================================
let drawTool = "cursor";
let drawings = [];
let drawPts = [];
let drawPreview = null;
let selectedDrawing = null;
let drawCanvas, drawCtx;
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const DRAW_COLORS = {
  default: "#4c7aff",
  fib: "#ffb443",
  rect: "rgba(76,122,255,0.12)",
  sel: "#00c896",
};

function initDrawCanvas() {
  const container = document.getElementById("chart-container");
  drawCanvas = document.createElement("canvas");
  drawCanvas.id = "draw-canvas";
  drawCanvas.classList.add("cursor-mode"); // start in cursor mode
  container.appendChild(drawCanvas);
  drawCtx = drawCanvas.getContext("2d");
  resizeDrawCanvas();
  new ResizeObserver(resizeDrawCanvas).observe(container);

  // Drawing events: only when canvas is active (drawing tool selected)
  drawCanvas.addEventListener("mousedown", onDrawMouseDown);
  drawCanvas.addEventListener("mousemove", onDrawMouseMove);
  // mouseup only for ESC-like cancel (no longer commits drawings)
  drawCanvas.addEventListener("mouseup", onDrawMouseUp);

  // Cursor selection (click): NEVER blocks chart interactions
  container.addEventListener("mousedown", onCursorContainerClick);
  // Double-click on a drawing: show edit/delete menu
  container.addEventListener("dblclick", onCursorContainerDblClick);
  // Hide context menu on any single click elsewhere
  document.addEventListener("mousedown", (e) => {
    const menu = document.getElementById("draw-ctx-menu");
    if (menu && !menu.contains(e.target)) hideDrawCtxMenu();
  });

  // Redraw on any time-scale change (zoom, scroll, TF switch)
  // Throttle to avoid excessive redraws
  let _drawRedrawPending = false;
  const _throttledDrawRedraw = () => {
    if (_drawRedrawPending) return;
    _drawRedrawPending = true;
    requestAnimationFrame(() => {
      _drawRedrawPending = false;
      drawRedraw();
    });
  };
  chart.timeScale().subscribeVisibleLogicalRangeChange(_throttledDrawRedraw);
  // Only redraw drawings on crosshair if we have drawings (avoid no-op redraws)
  chart.subscribeCrosshairMove(() => {
    if (drawings.length || drawPreview) _throttledDrawRedraw();
  });
}

function resizeDrawCanvas() {
  const c = document.getElementById("chart-container");
  const dpr = window.devicePixelRatio || 1;
  drawCanvas.width = c.clientWidth * dpr;
  drawCanvas.height = c.clientHeight * dpr;
  drawCanvas.style.width = c.clientWidth + "px";
  drawCanvas.style.height = c.clientHeight + "px";
  drawCtx.scale(dpr, dpr);
  drawRedraw();
}

// Sorted array of candle times for fast nearest-time lookup
let sortedTimes = [];

function snapTime(time) {
  // Returns the nearest candle timestamp in the current dataset
  if (!sortedTimes.length) return time;
  let lo = 0,
    hi = sortedTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  // Compare candidate with predecessor
  if (
    lo > 0 &&
    Math.abs(sortedTimes[lo - 1] - time) < Math.abs(sortedTimes[lo] - time)
  )
    return sortedTimes[lo - 1];
  return sortedTimes[lo];
}

function toXY(time, price) {
  let x = chart.timeScale().timeToCoordinate(time);

  if ((x === null || x === undefined) && sortedTimes.length >= 2) {
    // The stored timestamp doesn't exist in the current TF dataset
    // (e.g. a 15min anchor viewed on a 4H chart).
    // Strategy:
    //   - If time is WITHIN the data range → interpolate between the two adjacent bars
    //   - If time is OUTSIDE the data range → extrapolate linearly from the nearest edge

    const n = sortedTimes.length;
    const first = sortedTimes[0],
      last = sortedTimes[n - 1];

    if (time < first) {
      // Before first bar — extrapolate leftward
      const xA = chart.timeScale().timeToCoordinate(sortedTimes[0]);
      const xB = chart.timeScale().timeToCoordinate(sortedTimes[1]);
      if (xA !== null && xB !== null && sortedTimes[1] !== sortedTimes[0]) {
        const ppSec = (xB - xA) / (sortedTimes[1] - sortedTimes[0]);
        x = xA + (time - sortedTimes[0]) * ppSec;
      }
    } else if (time > last) {
      // Beyond last bar — extrapolate rightward
      const xA = chart.timeScale().timeToCoordinate(sortedTimes[n - 2]);
      const xB = chart.timeScale().timeToCoordinate(sortedTimes[n - 1]);
      if (
        xA !== null &&
        xB !== null &&
        sortedTimes[n - 1] !== sortedTimes[n - 2]
      ) {
        const ppSec = (xB - xA) / (sortedTimes[n - 1] - sortedTimes[n - 2]);
        x = xB + (time - sortedTimes[n - 1]) * ppSec;
      }
    } else {
      // WITHIN range — binary-search the two surrounding bars and interpolate
      let lo = 0,
        hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedTimes[mid] < time) lo = mid + 1;
        else hi = mid;
      }
      // sortedTimes[lo] is the first bar >= time
      // sortedTimes[lo-1] is the bar just before (lo > 0 guaranteed — time is within range)
      const tA = sortedTimes[lo - 1],
        tB = sortedTimes[lo];
      const xA = chart.timeScale().timeToCoordinate(tA);
      const xB = chart.timeScale().timeToCoordinate(tB);
      if (xA !== null && xB !== null && tB !== tA) {
        // Linear interpolation: position proportional to elapsed fraction
        x = xA + ((xB - xA) * (time - tA)) / (tB - tA);
      }
    }
  }

  const y = mainSeries ? mainSeries.priceToCoordinate(price) : null;
  return {
    x: x !== null && x !== undefined ? x : null,
    y: y !== null && y !== undefined ? y : null,
  };
}

function validCoord(p) {
  return p && p.x !== null && p.y !== null;
}

function fromXY(x, y) {
  let time = chart.timeScale().coordinateToTime(x);

  // If beyond chart bounds (null), extrapolate using the last interval
  if (!time && sortedTimes.length >= 2) {
    const lastT = sortedTimes[sortedTimes.length - 1];
    const prevT = sortedTimes[sortedTimes.length - 2];
    const lastX = chart.timeScale().timeToCoordinate(lastT);
    const prevX = chart.timeScale().timeToCoordinate(prevT);
    if (lastX !== null && prevX !== null) {
      const barW = lastX - prevX; // px per bar
      const interval = lastT - prevT; // seconds per bar
      if (barW > 0) {
        const barsOff = (x - lastX) / barW; // can be negative
        time = Math.round(lastT + barsOff * interval);
      }
    }
    // Fallback: clamp to last known time
    if (!time) time = lastT;
  }

  const price = mainSeries ? mainSeries.coordinateToPrice(y) : 0;
  return { time: time || null, price };
}

// ---- Edit mode state ----
let editingDrawing = null; // drawing currently being edited
let editHandle = null; // active handle being dragged
let editDragging = false;
const HANDLE_R = 6; // handle radius px

// Compute handle positions for a drawing (screen coords)
function getHandles(d) {
  const W = drawCanvas.width / (window.devicePixelRatio || 1);
  const H = drawCanvas.height / (window.devicePixelRatio || 1);
  const handles = [];
  if (d.type === "hline") {
    const yy = mainSeries ? mainSeries.priceToCoordinate(d.pts[0].price) : null;
    if (yy !== null) {
      handles.push({ ptIdx: 0, axis: "y", x: W * 0.25, y: yy });
      handles.push({ ptIdx: 0, axis: "y", x: W * 0.75, y: yy });
    }
  } else if (d.type === "vline") {
    const p = toXY(d.pts[0].time, d.pts[0].price);
    if (p.x !== null) {
      handles.push({ ptIdx: 0, axis: "x", x: p.x, y: H * 0.25 });
      handles.push({ ptIdx: 0, axis: "x", x: p.x, y: H * 0.75 });
    }
  } else if (d.type === "rect" && d.pts.length >= 2) {
    const p0 = toXY(d.pts[0].time, d.pts[0].price);
    const p1 = toXY(d.pts[1].time, d.pts[1].price);
    if (p0.x !== null && p1.x !== null) {
      // 4 corners
      handles.push({ ptIdx: 0, axis: "xy", x: p0.x, y: p0.y });
      handles.push({ ptIdx: 1, axis: "xy", x: p1.x, y: p1.y });
      handles.push({ ptIdx: "tr", axis: "xy", x: p1.x, y: p0.y }); // top-right
      handles.push({ ptIdx: "bl", axis: "xy", x: p0.x, y: p1.y }); // bottom-left
      // 4 mid-edge handles
      const mx = (p0.x + p1.x) / 2,
        my = (p0.y + p1.y) / 2;
      handles.push({ ptIdx: "mt", axis: "y0", x: mx, y: p0.y }); // mid-top
      handles.push({ ptIdx: "mb", axis: "y1", x: mx, y: p1.y }); // mid-bottom
      handles.push({ ptIdx: "ml", axis: "x0", x: p0.x, y: my }); // mid-left
      handles.push({ ptIdx: "mr", axis: "x1", x: p1.x, y: my }); // mid-right
    }
  } else {
    // trendline, ray, fib, text: handles at each stored point
    d.pts.forEach((pt, i) => {
      const p = toXY(pt.time, pt.price);
      if (p.x !== null && p.y !== null)
        handles.push({ ptIdx: i, axis: "xy", x: p.x, y: p.y });
    });
  }
  return handles;
}

// Returns the CLOSEST handle within threshold (not first in list).
// Prevents wrong handle being picked when several share the same X column.
function findHandle(mx, my, d) {
  let best = null,
    bestDist = HANDLE_R * 3; // slightly relaxed for easy tapping
  for (const h of getHandles(d)) {
    const dist = Math.hypot(mx - h.x, my - h.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = h;
    }
  }
  return best;
}

// Returns pixels-per-second for the current chart zoom.
// Uses getVisibleRange() to get visible bar timestamps, then
// timeToCoordinate() on those — guaranteed to work for visible bars.
function getChartPxPerSec() {
  const ts = chart.timeScale();

  // Method 1: getVisibleRange — most reliable
  try {
    const vr = ts.getVisibleRange();
    if (vr && vr.from && vr.to && vr.to !== vr.from) {
      const xFrom = ts.timeToCoordinate(vr.from);
      const xTo = ts.timeToCoordinate(vr.to);
      if (xFrom !== null && xTo !== null && xFrom !== xTo) {
        return (xTo - xFrom) / (vr.to - vr.from);
      }
    }
  } catch (e) { }

  // Method 2: getVisibleLogicalRange + coordinateToTime
  try {
    const lr = ts.getVisibleLogicalRange();
    if (lr) {
      const w = drawCanvas.width / (window.devicePixelRatio || 1);
      const t0 = ts.coordinateToTime(0);
      const t1 = ts.coordinateToTime(w);
      if (t0 !== null && t1 !== null && t0 !== t1) {
        return w / (t1 - t0);
      }
    }
  } catch (e) { }

  // Method 3: brute-force with sortedTimes visible bars
  if (sortedTimes.length >= 2) {
    for (let i = 0; i < sortedTimes.length - 1; i++) {
      const tA = sortedTimes[i],
        tB = sortedTimes[i + 1];
      const xA = ts.timeToCoordinate(tA);
      const xB = ts.timeToCoordinate(tB);
      if (xA !== null && xB !== null && xA !== xB) {
        return (xB - xA) / (tB - tA);
      }
    }
  }

  // Ultimate fallback: use known bar interval and chart width
  if (sortedTimes.length >= 2) {
    const interval = sortedTimes[1] - sortedTimes[0];
    if (interval > 0) {
      const w = drawCanvas.width / (window.devicePixelRatio || 1);
      // Approximate: chart shows about sortedTimes.length bars in w pixels
      return w / (sortedTimes.length * interval);
    }
  }

  return null;
}

// Swap rect corners so pts[0] is always top-left, pts[1] bottom-right.
// Prevents anchor shift when you drag a corner past its opposite.
function normalizeRect(d) {
  if (d.type !== "rect" || d.pts.length < 2) return;
  const [a, b] = d.pts;
  // Normalize time (X axis)
  if (a.time > b.time) {
    const t = a.time;
    a.time = b.time;
    b.time = t;
  }
  // Normalize price (Y axis — price direction can vary, use > to keep top > bottom)
  if (a.price < b.price) {
    const p = a.price;
    a.price = b.price;
    b.price = p;
  }
}

function enterEditMode(drawing) {
  editingDrawing = drawing;
  selectedDrawing = drawing;
  editHandle = null;
  editDragging = false;
  // Canvas must capture mouse while editing
  drawCanvas.classList.remove("cursor-mode");
  drawCanvas.classList.add("active");
  drawCanvas.style.cursor = "default";
  drawRedraw();
}

function exitEditMode() {
  if (!editingDrawing) return;
  editingDrawing = null;
  editHandle = null;
  editDragging = false;
  drawCanvas.classList.add("cursor-mode");
  drawCanvas.classList.remove("active");
  drawCanvas.style.cursor = "";
  hideDrawCtxMenu();
  drawRedraw();
}

function setDrawTool(tool) {
  exitEditMode(); // exit edit mode if switching tool
  drawTool = tool;
  drawPts = [];
  drawPreview = null;
  document
    .querySelectorAll(".draw-btn")
    .forEach((b) => b.classList.remove("active"));
  const el = document.getElementById("dt-" + tool);
  if (el) el.classList.add("active");
  if (tool === "cursor") {
    drawCanvas.classList.remove("active");
    drawCanvas.classList.add("cursor-mode");
  } else {
    drawCanvas.classList.add("active");
    drawCanvas.classList.remove("cursor-mode");
  }
  drawRedraw();
}

function needsTwo(t) {
  return ["trendline", "ray", "rect", "fib"].includes(t);
}

// Container mousedown: cursor selection (never blocks chart)
function onCursorContainerClick(e) {
  if (editingDrawing) return; // edit mode handles own clicks via canvas
  if (drawTool !== "cursor" || !drawings.length) return;
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left,
    my = e.clientY - rect.top;
  let found = null;
  for (const d of drawings)
    if (isNearDrawing(d, mx, my)) {
      found = d;
      break;
    }
  if (found !== selectedDrawing) {
    selectedDrawing = found;
    drawRedraw();
  }
}

// Container double-click: enter edit mode for the drawing
function onCursorContainerDblClick(e) {
  if (drawTool !== "cursor" || !drawings.length) return;
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left,
    my = e.clientY - rect.top;
  let found = null;
  for (const d of drawings)
    if (isNearDrawing(d, mx, my)) {
      found = d;
      break;
    }
  if (!found) return;
  enterEditMode(found);
  showDrawCtxMenu(e.clientX, e.clientY, found);
}

function showDrawCtxMenu(cx, cy, drawing) {
  let menu = document.getElementById("draw-ctx-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "draw-ctx-menu";
    const s = document.createElement("style");
    s.textContent = `
                  #draw-ctx-menu { position:fixed;z-index:5000;background:#1e2438;border:1px solid #2a3352;
                    border-radius:10px;padding:4px 0;box-shadow:0 8px 28px rgba(0,0,0,.6);min-width:170px;
                    font-family:'Inter',sans-serif; }
                  #draw-ctx-menu .ctx-title { padding:6px 14px 2px;font-size:10px;color:#4a5568;
                    text-transform:uppercase;letter-spacing:.08em; }
                  #draw-ctx-menu button { display:flex;align-items:center;gap:8px;width:100%;border:none;
                    background:transparent;color:#c8d0e0;padding:8px 14px;cursor:pointer;font-size:12px;text-align:left; }
                  #draw-ctx-menu button:hover { background:#2a3352;color:#fff; }
                  #draw-ctx-menu .ctx-sep { height:1px;background:#2a3352;margin:3px 0; }
                  #draw-ctx-menu .ctx-colors { display:flex;gap:6px;padding:8px 14px;flex-wrap:wrap; }
                  #draw-ctx-menu .ctx-color-dot { width:18px;height:18px;border-radius:50%;cursor:pointer;
                    border:2px solid transparent;transition:transform .1s; }
                  #draw-ctx-menu .ctx-color-dot:hover { border-color:#fff;transform:scale(1.2); }
                  #draw-ctx-menu .ctx-hint { padding:2px 14px 6px;font-size:10px;color:#4a5568;font-style:italic; }
                `;
    document.head.appendChild(s);
    document.body.appendChild(menu);
  }
  const colors = [
    "#4c7aff",
    "#00c896",
    "#ffb443",
    "#ff4466",
    "#a855f7",
    "#ffffff",
    "#00d4ff",
    "#ff8c00",
  ];
  menu.innerHTML = `
              <div class="ctx-title">✏️ Mode édition</div>
              <div class="ctx-hint">Glissez les poignées ◯ pour modifier</div>
              <div class="ctx-sep"></div>
              <div class="ctx-title">Couleur</div>
              <div class="ctx-colors">
                ${colors.map((c) => `<div class="ctx-color-dot" style="background:${c};border-color:${(drawing.color || "#4c7aff") === c ? "#fff" : "transparent"}" onclick="window._ctxColorDrawing('${c}')"></div>`).join("")}
              </div>
              <div class="ctx-sep"></div>
              <button onclick="window._ctxDeleteDrawing()">🗑 Supprimer</button>
              <button onclick="exitEditMode()">✕ Quitter l'édition</button>
            `;
  const vw = window.innerWidth,
    vh = window.innerHeight;
  let left = cx + 12,
    top = cy + 12;
  menu.style.display = "block";
  const mw = menu.offsetWidth || 175,
    mh = menu.offsetHeight || 180;
  if (left + mw > vw - 8) left = cx - mw - 8;
  if (top + mh > vh - 8) top = cy - mh - 8;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function hideDrawCtxMenu() {
  const menu = document.getElementById("draw-ctx-menu");
  if (menu) menu.style.display = "none";
}

window._ctxDeleteDrawing = function () {
  const target = editingDrawing || selectedDrawing;
  if (!target) return;
  drawings = drawings.filter((d) => d.id !== target.id);
  selectedDrawing = null;
  exitEditMode(); // also hides menu
  drawRedraw();
};
window._ctxColorDrawing = function (color) {
  const target = editingDrawing || selectedDrawing;
  if (!target) return;
  target.color = color;
  drawRedraw();
  // Re-show menu to update selected color indicator
  const menu = document.getElementById("draw-ctx-menu");
  if (menu && menu.style.display === "block") {
    const dots = menu.querySelectorAll(".ctx-color-dot");
    dots.forEach((dot) => {
      dot.style.borderColor =
        dot.style.background === color ? "#fff" : "transparent";
    });
  }
};

// Canvas mousedown: drawing tool OR edit mode handle drag
function onDrawMouseDown(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left,
    my = e.clientY - rect.top;

  // --- EDIT MODE ---
  if (editingDrawing) {
    const h = findHandle(mx, my, editingDrawing);
    if (h || isNearDrawing(editingDrawing, mx, my)) {
      // ── UNIVERSAL ORIGIN-BASED SNAPSHOT ──
      // Freeze original data at drag start. Every frame computes
      // the total delta from this origin → zero accumulation, zero drift.
      const origPts = editingDrawing.pts.map((p) => ({ ...p }));
      const origRefY = mainSeries
        ? mainSeries.priceToCoordinate(origPts[0].price)
        : my;

      editHandle = {
        ptIdx: h ? h.ptIdx : "all",
        axis: h ? h.axis : "xy",
        startMx: mx,
        startMy: my,
        origPts,
        origRefPriceY: origRefY,
        // For single-handle drags, also snapshot the handle's screen coord
        // so we can convert pixel-delta to time/price correctly per-point
        origHandlePts: h
          ? origPts.map((p) => {
            const c = toXY(p.time, p.price);
            return { sx: c.x, sy: c.y };
          })
          : null,
      };
      editDragging = true;
      drawCanvas.style.cursor = h ? "grabbing" : "move";
    } else {
      exitEditMode();
    }
    return;
  }

  // --- DRAWING TOOL ---
  const pt = fromXY(mx, my);
  if (!pt.time) return;
  if (drawTool === "text") {
    showTextInput(mx, my, pt);
    return;
  }
  if (needsTwo(drawTool)) {
    if (drawPts.length === 0) {
      drawPts.push(pt);
    } else {
      drawings.push({ type: drawTool, pts: [drawPts[0], pt], id: Date.now() });
      drawPts = [];
      drawPreview = null;
      drawRedraw();
      setDrawTool("cursor");
    }
  } else {
    drawings.push({ type: drawTool, pts: [pt], id: Date.now() });
    drawPts = [];
    drawRedraw();
    setDrawTool("cursor");
  }
}

function onDrawMouseMove(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left,
    my = e.clientY - rect.top;

  // --- EDIT MODE DRAG ---
  if (editingDrawing && editDragging && editHandle) {
    const h = editHandle;
    const dPx = mx - h.startMx;
    const dPy = my - h.startMy;

    // Compute px/sec and px/price once per frame
    const pps = getChartPxPerSec();

    // Helper: convert pixel-delta → time-delta
    const pxToTimeDelta = (dpx) => {
      if (!pps || Math.abs(pps) < 0.00001) return 0;
      return dpx / pps;
    };
    // Helper: convert pixel-Y-delta from a reference point → price
    const pxToPriceAt = (refPriceY, dpy) => {
      if (!mainSeries || refPriceY === null) return null;
      return mainSeries.coordinateToPrice(refPriceY + dpy);
    };

    if (h.ptIdx === "all") {
      // ── MOVE ALL: apply same delta to every point ──
      const dt = pxToTimeDelta(dPx);
      let dp = 0;
      if (h.origRefPriceY !== null) {
        const newP = pxToPriceAt(h.origRefPriceY, dPy);
        if (newP !== null) dp = newP - h.origPts[0].price;
      }
      h.origPts.forEach((op, i) => {
        editingDrawing.pts[i].time = Math.round(op.time + dt);
        editingDrawing.pts[i].price = op.price + dp;
      });
    } else {
      // ── SINGLE HANDLE: update only the axes this handle controls ──
      // First, reset ALL pts to original (frozen snapshot)
      h.origPts.forEach((op, i) => {
        editingDrawing.pts[i].time = op.time;
        editingDrawing.pts[i].price = op.price;
      });

      // Then apply the delta ONLY to the affected point+axis
      const dt = pxToTimeDelta(dPx);

      // For price: use origRefPriceY of the affected point
      const priceForPt = (ptIdx) => {
        if (!h.origHandlePts) return null;
        const refY = h.origHandlePts[ptIdx].sy;
        return pxToPriceAt(refY, dPy);
      };

      const pid = h.ptIdx;
      const ax = h.axis;

      if (pid === "tr") {
        // top-right: pts[1].time (x), pts[0].price (y)
        editingDrawing.pts[1].time = Math.round(h.origPts[1].time + dt);
        const p = priceForPt(0);
        if (p !== null) editingDrawing.pts[0].price = p;
      } else if (pid === "bl") {
        editingDrawing.pts[0].time = Math.round(h.origPts[0].time + dt);
        const p = priceForPt(1);
        if (p !== null) editingDrawing.pts[1].price = p;
      } else if (pid === "mt") {
        const p = priceForPt(0);
        if (p !== null) editingDrawing.pts[0].price = p;
      } else if (pid === "mb") {
        const p = priceForPt(1);
        if (p !== null) editingDrawing.pts[1].price = p;
      } else if (pid === "ml") {
        editingDrawing.pts[0].time = Math.round(h.origPts[0].time + dt);
      } else if (pid === "mr") {
        editingDrawing.pts[1].time = Math.round(h.origPts[1].time + dt);
      } else if (typeof pid === "number") {
        // Standard point handle (trendline, ray, fib, text...)
        if (ax === "y" || ax === "xy") {
          const p = priceForPt(pid);
          if (p !== null) editingDrawing.pts[pid].price = p;
        }
        if (ax === "x" || ax === "xy") {
          editingDrawing.pts[pid].time = Math.round(h.origPts[pid].time + dt);
        }
      }
    }

    drawRedraw();
    return;
  }

  // Hover cursor in edit mode
  if (editingDrawing) {
    const h = findHandle(mx, my, editingDrawing);
    drawCanvas.style.cursor = h
      ? "grab"
      : isNearDrawing(editingDrawing, mx, my)
        ? "move"
        : "default";
    return;
  }

  // Normal drawing preview
  if (!drawPts.length) return;
  drawPreview = fromXY(mx, my);
  drawRedraw();
}

function onDrawMouseUp(e) {
  if (editDragging) {
    // Normalize rect corners ONLY when drag finishes (not mid-drag)
    if (editingDrawing && editingDrawing.type === "rect")
      normalizeRect(editingDrawing);
    editDragging = false;
    editHandle = null;
    drawCanvas.style.cursor = editingDrawing ? "default" : "";
  }
}

function isNearDrawing(d, mx, my) {
  const T = 10; // hit threshold in pixels
  if (d.type === "hline") {
    const yy = mainSeries ? mainSeries.priceToCoordinate(d.pts[0].price) : null;
    return yy !== null && Math.abs(my - yy) < T;
  }
  if (d.type === "vline") {
    const p = toXY(d.pts[0].time, d.pts[0].price);
    return p.x !== null && Math.abs(mx - p.x) < T;
  }
  if (d.type === "trendline") {
    const a = toXY(d.pts[0].time, d.pts[0].price);
    const b = toXY(d.pts[1].time, d.pts[1].price);
    if (a.x === null || b.x === null) return false;
    return distToSeg(mx, my, a.x, a.y, b.x, b.y) < T;
  }
  if (d.type === "ray") {
    const a = toXY(d.pts[0].time, d.pts[0].price);
    const b = toXY(d.pts[1].time, d.pts[1].price);
    if (a.x === null || b.x === null) return false;
    // Ray extends infinitely — extend b in the direction a→b
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const mag = Math.hypot(dx, dy) || 1;
    const bFar = { x: a.x + (dx / mag) * 8000, y: a.y + (dy / mag) * 8000 };
    return distToSeg(mx, my, a.x, a.y, bFar.x, bFar.y) < T;
  }
  if (d.type === "rect" && d.pts.length >= 2) {
    const p0 = toXY(d.pts[0].time, d.pts[0].price);
    const p1 = toXY(d.pts[1].time, d.pts[1].price);
    if (p0.x === null || p1.x === null) return false;
    const x0 = Math.min(p0.x, p1.x),
      x1 = Math.max(p0.x, p1.x);
    const y0 = Math.min(p0.y, p1.y),
      y1 = Math.max(p0.y, p1.y);
    const inX = mx >= x0 - T && mx <= x1 + T;
    const inY = my >= y0 - T && my <= y1 + T;
    const nearEdge =
      (Math.abs(mx - x0) < T && inY) ||
      (Math.abs(mx - x1) < T && inY) ||
      (Math.abs(my - y0) < T && inX) ||
      (Math.abs(my - y1) < T && inX);
    const inside = mx > x0 && mx < x1 && my > y0 && my < y1;
    return nearEdge || inside;
  }
  if (d.type === "fib" && d.pts.length >= 2) {
    const p0 = toXY(d.pts[0].time, d.pts[0].price);
    const p1 = toXY(d.pts[1].time, d.pts[1].price);
    if (p0.x === null || p1.x === null) return false;
    const xMin = Math.min(p0.x, p1.x) - T,
      xMax = Math.max(p0.x, p1.x) + T;
    if (mx < xMin || mx > xMax) return false;
    const priceDiff = d.pts[1].price - d.pts[0].price;
    return FIB_LEVELS.some((level) => {
      const price = d.pts[0].price + priceDiff * level;
      const yy = mainSeries ? mainSeries.priceToCoordinate(price) : null;
      return yy !== null && Math.abs(my - yy) < T;
    });
  }
  if (d.type === "text" && d.pts[0]) {
    const p = toXY(d.pts[0].time, d.pts[0].price);
    if (p.x === null) return false;
    // Use a box around the text
    return Math.abs(mx - p.x) < 60 && Math.abs(my - p.y) < 16;
  }
  return false;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay,
    l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function deleteSelectedDrawing() {
  if (!selectedDrawing) return;
  drawings = drawings.filter((d) => d.id !== selectedDrawing.id);
  selectedDrawing = null;
  drawRedraw();
}

function clearAllDrawings() {
  drawings = [];
  selectedDrawing = null;
  drawPts = [];
  drawPreview = null;
  drawRedraw();
}

function drawRedraw() {
  if (!drawCtx) return;
  const W = drawCanvas.width / (window.devicePixelRatio || 1);
  const H = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.clearRect(0, 0, W, H);
  drawings.forEach((d) => drawShape(d, d === selectedDrawing, W, H));
  // Preview while drawing
  if (drawPts.length && drawPreview) {
    drawShape(
      { type: drawTool, pts: [drawPts[0], drawPreview] },
      false,
      W,
      H,
      true,
    );
  }
}

function drawShape(d, selected, W, H, preview) {
  drawCtx.save();
  const isEditing = d === editingDrawing;
  const baseColor = isEditing
    ? "#00e5ff"
    : selected
      ? DRAW_COLORS.sel
      : d.color || DRAW_COLORS.default;
  drawCtx.strokeStyle = baseColor;
  drawCtx.lineWidth = preview ? 1.5 : isEditing ? 2 : selected ? 2.5 : 1.5;
  drawCtx.setLineDash(preview ? [6, 4] : []);

  const p0 = d.pts[0] ? toXY(d.pts[0].time, d.pts[0].price) : null;
  const p1 = d.pts[1] ? toXY(d.pts[1].time, d.pts[1].price) : null;

  if (d.type === "hline") {
    const yy = mainSeries ? mainSeries.priceToCoordinate(d.pts[0].price) : null;
    if (yy === null) {
      drawCtx.restore();
      return;
    }
    drawCtx.beginPath();
    drawCtx.moveTo(0, yy);
    drawCtx.lineTo(W, yy);
    drawCtx.stroke();
    drawLabel(fmt(d.pts[0].price), W - 4, yy, baseColor, "right");
  } else if (d.type === "vline") {
    if (!validCoord(p0)) {
      drawCtx.restore();
      return;
    }
    drawCtx.beginPath();
    drawCtx.moveTo(p0.x, 0);
    drawCtx.lineTo(p0.x, H);
    drawCtx.stroke();
  } else if (d.type === "trendline") {
    if (!validCoord(p0) || !validCoord(p1)) {
      drawCtx.restore();
      return;
    }
    drawCtx.beginPath();
    drawCtx.moveTo(p0.x, p0.y);
    drawCtx.lineTo(p1.x, p1.y);
    drawCtx.stroke();
    if (!isEditing) {
      drawDot(p0.x, p0.y, baseColor);
      drawDot(p1.x, p1.y, baseColor);
    }
  } else if (d.type === "ray") {
    if (!validCoord(p0) || !validCoord(p1)) {
      drawCtx.restore();
      return;
    }
    const dx = p1.x - p0.x,
      dy = p1.y - p0.y;
    const len = Math.max(W, H) * 4,
      mag = Math.hypot(dx, dy) || 1;
    drawCtx.beginPath();
    drawCtx.moveTo(p0.x, p0.y);
    drawCtx.lineTo(p0.x + (dx / mag) * len, p0.y + (dy / mag) * len);
    drawCtx.stroke();
    if (!isEditing) drawDot(p0.x, p0.y, baseColor);
  } else if (d.type === "rect") {
    if (!validCoord(p0) || !validCoord(p1)) {
      drawCtx.restore();
      return;
    }
    drawCtx.fillStyle = d.fillColor || DRAW_COLORS.rect;
    drawCtx.beginPath();
    drawCtx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    drawCtx.fill();
    drawCtx.stroke();
  } else if (d.type === "fib") {
    if (!validCoord(p0) || !validCoord(p1)) {
      drawCtx.restore();
      return;
    }
    drawCtx.strokeStyle = d.color || DRAW_COLORS.fib;
    const priceDiff = d.pts[1].price - d.pts[0].price;
    const xMin = Math.min(p0.x, p1.x),
      xMax = Math.max(p0.x, p1.x);
    FIB_LEVELS.forEach((level) => {
      const price = d.pts[0].price + priceDiff * level;
      const yy = mainSeries ? mainSeries.priceToCoordinate(price) : null;
      if (yy === null) return;
      drawCtx.globalAlpha = 0.7;
      drawCtx.beginPath();
      drawCtx.moveTo(xMin, yy);
      drawCtx.lineTo(xMax, yy);
      drawCtx.stroke();
      drawCtx.globalAlpha = 1;
      drawLabel(
        `${(level * 100).toFixed(1)}%  ${fmt(price)}`,
        xMax + 4,
        yy,
        d.color || DRAW_COLORS.fib,
        "left",
      );
    });
  } else if (d.type === "text" && p0 && d.text) {
    if (!validCoord(p0)) {
      drawCtx.restore();
      return;
    }
    drawCtx.font = `${d.fontSize || 12}px JetBrains Mono, monospace`;
    drawCtx.fillStyle = baseColor;
    drawCtx.fillText(d.text, p0.x, p0.y);
  }

  // --- EDIT HANDLES ---
  if (isEditing && !preview) {
    drawCtx.setLineDash([]);
    getHandles(d).forEach((h) => {
      drawCtx.save();
      drawCtx.beginPath();
      drawCtx.arc(h.x, h.y, HANDLE_R, 0, Math.PI * 2);
      drawCtx.fillStyle = "#1e2438";
      drawCtx.strokeStyle = "#00e5ff";
      drawCtx.lineWidth = 1.5;
      drawCtx.fill();
      drawCtx.stroke();
      drawCtx.restore();
    });
  }

  drawCtx.restore();
}

function drawDot(x, y, color) {
  drawCtx.save();
  drawCtx.fillStyle = color;
  drawCtx.beginPath();
  drawCtx.arc(x, y, 3, 0, Math.PI * 2);
  drawCtx.fill();
  drawCtx.restore();
}

function drawLabel(text, x, y, color, align) {
  drawCtx.save();
  drawCtx.font = "10px JetBrains Mono, monospace";
  drawCtx.fillStyle = color;
  drawCtx.textAlign = align || "left";
  drawCtx.fillText(text, x, y - 3);
  drawCtx.restore();
}

function showTextInput(x, y, pt) {
  const overlay = document.getElementById("text-input-overlay");
  const input = document.getElementById("text-input");
  overlay.style.display = "block";
  overlay.style.left = x + "px";
  overlay.style.top = y - 20 + "px";
  input.value = "";
  input.focus();
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      const txt = input.value.trim();
      if (txt)
        drawings.push({ type: "text", pts: [pt], text: txt, id: Date.now() });
      overlay.style.display = "none";
      drawPts = [];
      drawRedraw();
    }
    if (e.key === "Escape") {
      overlay.style.display = "none";
      drawPts = [];
    }
  };
}

// ========================================================
//  INIT
// ========================================================
window.addEventListener("DOMContentLoaded", () => {
  initChart();
  initDrawCanvas();
  setupPositionDrag();
});

// ========================================================
//  REPLAY ENGINE & TRADING SIMULATOR
// ========================================================
const tradeSim = {
  balance: 10000,
  positions: [], // Array of { id, type, entry, sl, tp, qty, time, entryLine, slLine, tpLine }
  pendingOrders: [],
  history: [],
};

// Global counter for unique IDs
let _nextTradeId = 1;

function _updateAllTradeMarkers() {
  if (!mainSeries) return;
  const markers = [];
  // Trade markers
  tradeSim.positions.forEach(p => {
    markers.push({
      time: p.time,
      position: p.type === 'LONG' ? 'belowBar' : 'aboveBar',
      color: p.type === 'LONG' ? '#2962ff' : '#f0b90b',
      shape: p.type === 'LONG' ? 'arrowUp' : 'arrowDown',
      text: p.type === 'LONG' ? 'Buy ' + p.qty : 'Sell ' + p.qty
    });
  });
  mainSeries.setMarkers(markers);
}

let _tradeDragLine = null;

function setupPositionDrag() {
  const container = document.getElementById("chart-container");

  container.addEventListener("mousedown", (e) => {
    if (!mainSeries || drawTool !== "cursor") return;
    const all = [...tradeSim.positions, ...tradeSim.pendingOrders];
    if (!all.length) return;

    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const threshold = 15;

    for (const p of all) {
      const entryY = mainSeries.priceToCoordinate(p.entry);
      const slY = p.sl ? mainSeries.priceToCoordinate(p.sl) : null;
      const tpY = p.tp ? mainSeries.priceToCoordinate(p.tp) : null;

      if (slY !== null && Math.abs(y - slY) < threshold) {
        _tradeDragLine = { type: "SL", trade: p };
        chart.applyOptions({ handleScroll: false, handleScale: false });
        break;
      } else if (tpY !== null && Math.abs(y - tpY) < threshold) {
        _tradeDragLine = { type: "TP", trade: p };
        chart.applyOptions({ handleScroll: false, handleScale: false });
        break;
      } else if (entryY !== null && Math.abs(y - entryY) < threshold) {
        _tradeDragLine = { type: "ENTRY", trade: p };
        chart.applyOptions({ handleScroll: false, handleScale: false });
        break;
      }
    }
  });

  container.addEventListener("mousemove", (e) => {
    if (!mainSeries || drawTool !== "cursor") return;
    const all = [...tradeSim.positions, ...tradeSim.pendingOrders];
    if (!all.length) return;

    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top;

    if (!_tradeDragLine) {
      let hit = false;
      for (const p of all) {
        const entryY = mainSeries.priceToCoordinate(p.entry);
        const slY = p.sl ? mainSeries.priceToCoordinate(p.sl) : null;
        const tpY = p.tp ? mainSeries.priceToCoordinate(p.tp) : null;

        if (
          (slY !== null && Math.abs(y - slY) < 15) ||
          (tpY !== null && Math.abs(y - tpY) < 15) ||
          (entryY !== null && Math.abs(y - entryY) < 15)
        ) {
          hit = true;
          break;
        }
      }

      if (hit) {
        container.style.cursor = "ns-resize";
      } else if (drawTool === "cursor") {
        container.style.cursor = "crosshair";
      }
      return;
    }

    // Dragging logic
    container.style.cursor = "ns-resize";
    const newPrice = mainSeries.coordinateToPrice(y);
    if (newPrice === null) return;

    const p = _tradeDragLine.trade;
    let dragType = _tradeDragLine.type;

    if (dragType === "ENTRY") {
      if (p.type === "LONG") {
        dragType = newPrice > p.entry ? "TP" : "SL";
      } else {
        dragType = newPrice < p.entry ? "TP" : "SL";
      }
    }

    if (dragType === "SL") {
      if (p.type === "LONG" && newPrice >= p.entry) return;
      if (p.type === "SHORT" && newPrice <= p.entry) return;

      p.sl = newPrice;
      if (!p.slLine) {
        p.slLine = mainSeries.createPriceLine({
          price: newPrice,
          color: "#ff4466",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "SL",
        });
      } else {
        p.slLine.applyOptions({ price: newPrice });
      }
    } else if (dragType === "TP") {
      if (p.type === "LONG" && newPrice <= p.entry) return;
      if (p.type === "SHORT" && newPrice >= p.entry) return;

      p.tp = newPrice;
      if (!p.tpLine) {
        p.tpLine = mainSeries.createPriceLine({
          price: newPrice,
          color: "#00c896",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "TP",
        });
      } else {
        p.tpLine.applyOptions({ price: newPrice });
      }
    }
  });

  document.addEventListener("mouseup", () => {
    if (_tradeDragLine) {
      const p = _tradeDragLine.trade;
      _tradeDragLine = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      if (drawTool === "cursor")
        document.getElementById("chart-container").style.cursor = "crosshair";

      if (p) {
        document.getElementById("trade-sl").value = p.sl ? p.sl.toFixed(5) : "";
        document.getElementById("trade-tp").value = p.tp ? p.tp.toFixed(5) : "";
      }
    }
  });
}

function formatMoney(val) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(val);
}

function updateSimUI(currentPrice) {
  document.getElementById("rp-balance").textContent = formatMoney(tradeSim.balance);
  const pnlEl = document.getElementById("rp-pnl");

  if (tradeSim.positions.length === 0) {
    pnlEl.textContent = "--";
    pnlEl.className = "rp-pnl-val";
    return;
  }

  if (!currentPrice) return;

  let totalPnl = 0;
  tradeSim.positions.forEach(pos => {
    if (pos.type === "LONG") totalPnl += (currentPrice - pos.entry) * pos.qty;
    else totalPnl += (pos.entry - currentPrice) * pos.qty;
  });

  pnlEl.textContent = (totalPnl >= 0 ? "+" : "") + formatMoney(totalPnl);
  pnlEl.className = "rp-pnl-val " + (totalPnl >= 0 ? "profit" : "loss");
}

function _removeLinesFrom(p) {
  if (!p || !mainSeries) return;
  if (p.entryLine) mainSeries.removePriceLine(p.entryLine);
  if (p.slLine) mainSeries.removePriceLine(p.slLine);
  if (p.tpLine) mainSeries.removePriceLine(p.tpLine);
  p.entryLine = null;
  p.slLine = null;
  p.tpLine = null;
}

function removeTradeLines() {
  tradeSim.positions.forEach(p => _removeLinesFrom(p));
  tradeSim.pendingOrders.forEach(p => _removeLinesFrom(p));
}
function _drawTradeLines(p, title) {
  p.entryLine = mainSeries.createPriceLine({
    price: p.entry,
    color: p.type === "LONG" ? "#2962ff" : "#f0b90b",
    lineWidth: 1,
    lineStyle: 2, // Dashed
    axisLabelVisible: true,
    title: `${title} ${p.qty}`,
  });
  if (p.sl) {
    p.slLine = mainSeries.createPriceLine({
      price: p.sl,
      color: "#ff3c4c",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "SL",
    });
  }
  if (p.tp) {
    p.tpLine = mainSeries.createPriceLine({
      price: p.tp,
      color: "#0cf19b",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "TP",
    });
  }
}

function executeTrade(type) {
  if (!replay.active || !mainSeries) return;
  const currentData = baseCandles[replay.idx];
  if (!currentData) return;

  const entryRaw = parseFloat(document.getElementById("trade-entry").value);
  const qty = parseFloat(document.getElementById("trade-qty").value) || 1;
  const slRaw = parseFloat(document.getElementById("trade-sl").value);
  const tpRaw = parseFloat(document.getElementById("trade-tp").value);

  const sl = isNaN(slRaw) || slRaw <= 0 ? null : slRaw;
  const tp = isNaN(tpRaw) || tpRaw <= 0 ? null : tpRaw;
  const entry = isNaN(entryRaw) || entryRaw <= 0 ? currentData.close : entryRaw;

  // Validate SL and TP logic constraints
  if (sl !== null) {
    if (type === "LONG" && sl >= entry) {
      alert("Erreur: Pour un LONG (Achat), le Stop Loss doit être INFÉRIEUR au prix d'entrée.");
      return;
    }
    if (type === "SHORT" && sl <= entry) {
      alert("Erreur: Pour un SHORT (Vente), le Stop Loss doit être SUPÉRIEUR au prix d'entrée.");
      return;
    }
  }
  if (tp !== null) {
    if (type === "LONG" && tp <= entry) {
      alert("Erreur: Pour un LONG (Achat), le Take Profit doit être SUPÉRIEUR au prix d'entrée.");
      return;
    }
    if (type === "SHORT" && tp >= entry) {
      alert("Erreur: Pour un SHORT (Vente), le Take Profit doit être INFÉRIEUR au prix d'entrée.");
      return;
    }
  }

  const trade = {
    id: _nextTradeId++,
    type,
    entry,
    sl,
    tp,
    qty,
    time: currentData.time,
    entryLine: null,
    slLine: null,
    tpLine: null
  };

  if (entry === currentData.close) {
    tradeSim.positions.push(trade);
    _drawTradeLines(trade, type);
    _updateAllTradeMarkers();
  } else {
    tradeSim.pendingOrders.push(trade);
    _drawTradeLines(trade, type + " LIMIT");
  }

  document.getElementById("btn-buy").style.display = "block";
  document.getElementById("btn-sell").style.display = "block";
  document.getElementById("btn-close-pos").style.display = "block";
  document.getElementById("btn-close-pos").textContent = "Fermer Tout";

  updateSimUI(currentData.close);
}

function cancelPending(id = null) {
  if (id === null) {
    tradeSim.pendingOrders.forEach(p => _removeLinesFrom(p));
    tradeSim.pendingOrders = [];
  } else {
    const idx = tradeSim.pendingOrders.findIndex(p => p.id === id);
    if (idx !== -1) {
      _removeLinesFrom(tradeSim.pendingOrders[idx]);
      tradeSim.pendingOrders.splice(idx, 1);
    }
  }
}

function closePosition(reason, closePrice = null, id = null) {
  if (id === null) {
    cancelPending();
    const toClose = [...tradeSim.positions];
    toClose.forEach(p => closePosition(reason, closePrice, p.id));
    return;
  }
  const idx = tradeSim.positions.findIndex(p => p.id === id);
  if (idx === -1) return;
  const pos = tradeSim.positions[idx];
  if (closePrice === null) {
    const currentData = baseCandles[replay.idx];
    closePrice = currentData ? currentData.close : pos.entry;
  }
  let pnl = 0;
  if (pos.type === "LONG") pnl = (closePrice - pos.entry) * pos.qty;
  else pnl = (pos.entry - closePrice) * pos.qty;
  tradeSim.balance += pnl;
  tradeSim.history.push({ ...pos, exit: closePrice, pnl, reason });
  _removeLinesFrom(pos);
  tradeSim.positions.splice(idx, 1);
  _updateAllTradeMarkers();
  if (tradeSim.positions.length === 0 && tradeSim.pendingOrders.length === 0) {
    document.getElementById("btn-close-pos").style.display = "none";
    document.getElementById("trade-sl").value = "";
    document.getElementById("trade-tp").value = "";
  }
  updateSimUI(closePrice);
  const pnlEl = document.getElementById("rp-pnl");
  pnlEl.textContent = `P/L: ${pnl >= 0 ? "+" : ""}${formatMoney(pnl)}`;
  pnlEl.className = "rp-pnl-val " + (pnl >= 0 ? "profit" : "loss");
}

const replay = {
  active: false, // in replay mode
  picking: false, // waiting for user to click start point
  playing: false, // auto-playing
  idx: 0, // current candle index in baseCandles (last visible)
  startIdx: 0, // index chosen by user
  speed: 1, // multiplier
  timer: null, // setInterval handle
  lastTick: 0, // timestamp of last auto-advance (for drift correction)
};

function startReplayMode() {
  if (!baseCandles || baseCandles.length < 2) {
    alert("Chargez des données avant de lancer le replay.");
    return;
  }

  if (replay.picking) {
    replay.picking = false;
    document.getElementById("btn-replay").classList.remove("active");
    const container = document.getElementById("chart-container");
    if (container._replayCrosshairHandler)
      chart.unsubscribeCrosshairMove(container._replayCrosshairHandler);
    if (container._replayClickHandler)
      chart.unsubscribeClick(container._replayClickHandler);
    document.getElementById("replay-hint").style.display = "none";
    let pickLine = document.getElementById("replay-picker-line");
    if (pickLine) pickLine.style.display = "none";
    return;
  }

  if (replay.active) {
    rpPause();
  } else {
    replay.active = false;
  }

  replay.picking = true;

  // Cleanup UI: close any open modals
  closeModal();
  document.getElementById("col-mapper").classList.remove("visible");

  // Show hint
  const hint = document.getElementById("replay-hint");
  hint.style.display = "block";

  // Make the chart container capture clicks
  const container = document.getElementById("chart-container");

  // High-performance vertical line via DOM (prevents Lightweight charts recalculation lag)
  let pickLine = document.getElementById("replay-picker-line");
  if (!pickLine) {
    pickLine = document.createElement("div");
    pickLine.id = "replay-picker-line";
    pickLine.style.position = "absolute";
    pickLine.style.top = "0";
    pickLine.style.bottom = "0";
    pickLine.style.width = "2px";
    pickLine.style.backgroundColor = "rgba(76, 122, 255, 0.8)";
    pickLine.style.pointerEvents = "none";
    pickLine.style.zIndex = "50";
    container.appendChild(pickLine);
  }
  pickLine.style.display = "block";

  container._replayCrosshairHandler = function (param) {
    if (!replay.picking || !param.time || !param.point) {
      if (pickLine) pickLine.style.display = "none";
      return;
    }
    pickLine.style.display = "block";
    pickLine.style.left = param.point.x + "px";
  };
  chart.subscribeCrosshairMove(container._replayCrosshairHandler);

  container._replayClickHandler = function (param) {
    if (!replay.picking) return;

    // Attempt to resolve time
    let best = -1;
    if (param && param.time) {
      best = baseCandles.findIndex((c) => c.time === param.time);
    }

    if (best === -1) {
      // fallback search
      const t = param.time;
      if (t) {
        let diff = Infinity;
        for (let i = 0; i < baseCandles.length; i++) {
          const d = Math.abs(baseCandles[i].time - t);
          if (d < diff) {
            diff = d;
            best = i;
          }
        }
      }
    }

    if (best !== -1) {
      chart.unsubscribeCrosshairMove(container._replayCrosshairHandler);
      chart.unsubscribeClick(container._replayClickHandler);
      if (pickLine) pickLine.style.display = "none";
      beginReplay(best);
    } else {
      alert("Cliquez sur une bougie valide.");
    }
  };

  chart.subscribeClick(container._replayClickHandler);

  document.getElementById("btn-replay").classList.add("active");
}

function evalTradeSimLogic(c) {
  // Check Pending Orders
  for (let i = tradeSim.pendingOrders.length - 1; i >= 0; i--) {
    const p = tradeSim.pendingOrders[i];
    let hit = false;
    if (p.type === "LONG" && c.low <= p.entry) hit = true;
    else if (p.type === "SHORT" && c.high >= p.entry) hit = true;

    if (hit) {
      _removeLinesFrom(p);
      tradeSim.pendingOrders.splice(i, 1);
      p.time = c.time; // Update entry time to current candle
      tradeSim.positions.push(p);
      _drawTradeLines(p, p.type);
      _updateAllTradeMarkers();
    }
  }

  // Check Sl/TP for active positions
  for (let i = tradeSim.positions.length - 1; i >= 0; i--) {
    const p = tradeSim.positions[i];
    if (p.type === "LONG") {
      if (p.sl && c.low <= p.sl) closePosition("SL", p.sl, p.id);
      else if (p.tp && c.high >= p.tp) closePosition("TP", p.tp, p.id);
    } else if (p.type === "SHORT") {
      if (p.sl && c.high >= p.sl) closePosition("SL", p.sl, p.id);
      else if (p.tp && c.low <= p.tp) closePosition("TP", p.tp, p.id);
    }
  }

  updateSimUI(c.close);
}

function _updateReplaySeries() {
  const c = baseCandles[replay.idx];
  let bar = c;

  if (activeTF > baseTF) {
    // Fast live aggregation of the current candle into its bucket
    let o = c.open,
      h = c.high,
      l = c.low,
      closePrice = c.close,
      v = c.volume || 0;
    const bucketTime = getCalendarBucket(c.time, activeTFType, activeTF);
    let foundStart = false;
    for (let i = replay.idx - 1; i >= 0; i--) {
      const bCandle = baseCandles[i];
      if (
        getCalendarBucket(bCandle.time, activeTFType, activeTF) !== bucketTime
      )
        break;
      if (bCandle.high > h) h = bCandle.high;
      if (bCandle.low < l) l = bCandle.low;
      o = bCandle.open;
      v += bCandle.volume || 0;
    }
    bar = {
      time: bucketTime,
      open: o,
      high: h,
      low: l,
      close: closePrice,
      volume: v,
    };
  }

  if (mainSeries) {
    if (currentType === "Line" || currentType === "Area") {
      mainSeries.update({ time: bar.time, value: bar.close });
    } else {
      mainSeries.update(bar);
    }
  }
  if (volumeSeries) {
    volumeSeries.update({
      time: bar.time,
      value: bar.volume || 0,
      color:
        bar.close >= bar.open ? "rgba(0,200,150,0.5)" : "rgba(255,68,102,0.5)",
    });
  }

  if (!sortedTimes.length || sortedTimes[sortedTimes.length - 1] < bar.time) {
    sortedTimes.push(bar.time);
  }

  // Maintain the candles array to compute fast live indicators
  if (allCandles && allCandles.length > 0) {
    if (allCandles[allCandles.length - 1].time === bar.time) {
      allCandles[allCandles.length - 1] = bar;
    } else {
      allCandles.push(bar);
    }
  }

  updateIndicatorsLive(allCandles, bar.time);

  if (drawings.length) {
    requestAnimationFrame(drawRedraw);
  }
}

function beginReplay(startIdx) {
  if (tradeSim.positions.length || tradeSim.pendingOrders.length) {
    removeTradeLines();
    tradeSim.positions = [];
    tradeSim.pendingOrders = [];
    _updateAllTradeMarkers();
    document.getElementById("btn-buy").style.display = "block";
    document.getElementById("btn-sell").style.display = "block";
    document.getElementById("btn-close-pos").style.display = "none";
    document.getElementById("trade-entry").value = "";
    updateSimUI(null);
  }

  replay.picking = false;
  replay.active = true;
  replay.startIdx = startIdx;
  replay.idx = startIdx;
  replay.playing = false;

  // Hide hint, show replay bar
  document.getElementById("replay-hint").style.display = "none";
  document.getElementById("replay-bar").classList.add("visible");
  document.body.classList.add("replay-active");
  document.getElementById("status-replay").style.display = "flex";

  // Scrubber range = startIdx..baseCandles.length-1
  const scrubber = document.getElementById("rp-scrubber");
  scrubber.min = 0;
  scrubber.max = baseCandles.length - 1 - startIdx;
  scrubber.value = 0;

  // Time labels
  document.getElementById("rp-time-end").textContent = fmtDate(
    baseCandles[baseCandles.length - 1].time,
  );

  // Build replay series — shows only up to current idx
  buildReplayChart(startIdx);
  rpUpdateUI();
}

function buildReplayChart(upToIdx) {
  const visible = baseCandles.slice(0, upToIdx + 1);
  if (activeTF > baseTF) {
    const agg = aggregateCandles(visible, activeTF, activeTFType);
    renderChart(agg, true);
  } else {
    renderChart(visible, true);
  }

  // Scroll so the last bar is near the right edge with some space for new bars
  requestAnimationFrame(() => {
    chart.timeScale().scrollToPosition(8, false);
  });
}

function rpStep(dir) {
  const newIdx = replay.idx + dir;
  if (newIdx < replay.startIdx) {
    return;
  }
  if (newIdx >= baseCandles.length) {
    rpPause();
    return;
  }
  replay.idx = newIdx;
  const c = baseCandles[newIdx];

  // Check SL/TP on manual step too
  if (dir > 0) {
    evalTradeSimLogic(c);
  }

  _updateReplaySeries();
  rpUpdateUI();
}

function rpUpdateUI() {
  const idx = replay.idx;
  const c = baseCandles[idx];

  // Scrubber
  const scrubber = document.getElementById("rp-scrubber");
  const val = idx - replay.startIdx;
  scrubber.value = val;
  const pct = (
    (val / (baseCandles.length - 1 - replay.startIdx)) *
    100
  ).toFixed(1);
  scrubber.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)`;

  // Time
  document.getElementById("rp-time-cur").textContent = fmtDate(c.time);

}

function rpPlay() {
  if (replay.idx >= baseCandles.length - 1) {
    replay.idx = baseCandles.length - 1;
    rpPause();
    return;
  }
  replay.playing = true;
  document.getElementById("rp-play").textContent = "⏸";
  document.getElementById("rp-play").classList.add("playing");

  // Base interval = 1 candle/sec at 1× (we use requestAnimationFrame for smoothness)
  const msPerCandle = () => 600 / replay.speed;
  replay.lastTick = performance.now();
  replay.accumulated = 0;

  const tick = (now) => {
    if (!replay.playing) return;
    const delta = now - replay.lastTick;
    replay.lastTick = now;
    replay.accumulated = (replay.accumulated || 0) + delta;
    const mpc = msPerCandle();
    // Process at most a few candles per frame to avoid freezing the UI
    let advanced = 0;
    while (replay.accumulated >= mpc && advanced < 10) {
      replay.accumulated -= mpc;
      advanced++;

      if (replay.idx >= baseCandles.length - 1) {
        replay.idx = baseCandles.length - 1;
        rpPause();
        break;
      }
      replay.idx++;

      // TRADING SIMULATOR CHECK
      evalTradeSimLogic(baseCandles[replay.idx]);
      _updateReplaySeries();
    }
    // Cap accumulated to avoid drift buildup
    if (replay.accumulated > mpc * 10) replay.accumulated = 0;
    if (advanced > 0) rpUpdateUI();
    if (replay.playing) {
      replay.rafId = requestAnimationFrame(tick);
    }
  };
  replay.rafId = requestAnimationFrame(tick);
}

function rpPause() {
  replay.playing = false;
  if (replay.rafId) {
    cancelAnimationFrame(replay.rafId);
    replay.rafId = null;
  }
  document.getElementById("rp-play").textContent = "▶";
  document.getElementById("rp-play").classList.remove("playing");
}

const _fastDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

function fmtDate(t) {
  return _fastDateFormatter.format(new Date(t * 1000));
}

function exitReplay() {
  rpPause();

  // Close any open position and reset trading simulator
  removeTradeLines();
  tradeSim.positions = [];
  tradeSim.pendingOrders = [];
  _updateAllTradeMarkers();

  document.getElementById("trade-entry").value = "";
  tradeSim.balance = 10000;
  tradeSim.history = [];
  document.getElementById("btn-buy").style.display = "block";
  document.getElementById("btn-sell").style.display = "block";
  document.getElementById("btn-close-pos").style.display = "none";
  updateSimUI(null);
  document.getElementById("rp-balance").textContent = formatMoney(10000);

  replay.active = false;
  replay.picking = false;
  document.getElementById("replay-hint").style.display = "none";
  document.getElementById("replay-bar").classList.remove("visible");
  document.body.classList.remove("replay-active");
  document.getElementById("status-replay").style.display = "none";
  document.getElementById("btn-replay").classList.remove("active");

  // Remove pending chart handlers (added via chart.subscribeClick/subscribeCrosshairMove)
  const container = document.getElementById("chart-container");
  if (container._replayClickHandler) {
    chart.unsubscribeClick(container._replayClickHandler);
    container._replayClickHandler = null;
  }
  if (container._replayCrosshairHandler) {
    chart.unsubscribeCrosshairMove(container._replayCrosshairHandler);
    container._replayCrosshairHandler = null;
  }

  // Restore full chart
  renderChart(baseCandles, true);
  requestAnimationFrame(() => {
    chart.timeScale().fitContent();
  });
}

// Replay bar controls
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("rp-play").addEventListener("click", () => {
    if (!replay.active) return;
    replay.playing ? rpPause() : rpPlay();
  });
  document.getElementById("rp-step-back").addEventListener("click", () => {
    rpPause();
    rpStep(-1);
  });
  document.getElementById("rp-step-fwd").addEventListener("click", () => {
    rpPause();
    rpStep(+1);
  });
  document.getElementById("rp-exit").addEventListener("click", exitReplay);

  document.getElementById("rp-scrubber").addEventListener("input", (e) => {
    if (!replay.active) return;
    rpPause();
    const targetIdx = replay.startIdx + parseInt(e.target.value, 10);
    replay.idx = targetIdx;
    // Rebuild from startIdx to targetIdx (slice, fast)
    const visible = baseCandles.slice(0, targetIdx + 1);
    renderChart(visible, true);
    rpUpdateUI();
  });

  document.querySelectorAll(".rp-speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".rp-speed-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      replay.speed = parseFloat(btn.dataset.speed);
    });
  });
});

// ========================================================
//  KEYBOARD SHORTCUTS
// ========================================================
document.addEventListener("keydown", (e) => {
  // Replay shortcuts (highest priority when active)
  if (replay.active && document.activeElement.tagName !== "INPUT") {
    if (e.key === " ") {
      e.preventDefault();
      replay.playing ? rpPause() : rpPlay();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      rpPause();
      rpStep(+1);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      rpPause();
      rpStep(-1);
      return;
    }
  }
  if (e.key === "Escape") {
    if (replay.picking || replay.active) {
      exitReplay();
      return;
    }
    if (editingDrawing) {
      exitEditMode();
      return;
    }
    closeModal();
    drawPts = [];
    drawPreview = null;
    drawRedraw();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "o") {
    e.preventDefault();
    openModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "f") {
    e.preventDefault();
    fitContent();
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (document.activeElement.tagName !== "INPUT") {
      if (editingDrawing) {
        window._ctxDeleteDrawing();
        exitEditMode();
      } else deleteSelectedDrawing();
    }
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !replay.active) {
    if (e.key === "1") setDrawTool("cursor");
    if (e.key === "2") setDrawTool("trendline");
    if (e.key === "3") setDrawTool("hline");
    if (e.key === "4") setDrawTool("vline");
    if (e.key === "5") setDrawTool("rect");
    if (e.key === "6") setDrawTool("fib");
    if (e.key === "7") setDrawTool("text");
  }
});
