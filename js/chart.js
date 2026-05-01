// ========================================================
//  CHART — initChart, setChartType, tooltip crosshair, renderChart, fmt
//  Depends on: config.js, ui.js, storage.js, indicators.js (renderIndicators)
// ========================================================

// ── CHART INIT ────────────────────────────────────────────
function initChart() {
  const container = document.getElementById("tv-chart");
  chart = LightweightCharts.createChart(container, {
    layout: {
      background: { color: "#060810" },
      textColor: "#64738A",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
    },
    localization: {
      locale: "fr-FR",
      timeFormatter: (t) => {
        const d = new Date(t * 1000);
        return d.toLocaleDateString("fr-FR", {
          weekday: "short", day: "numeric", month: "short",
          year: "numeric", hour: "2-digit", minute: "2-digit",
        });
      },
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.032)", visible: true },
      horzLines: { color: "rgba(255,255,255,0.032)", visible: true },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: "#3B82F6", width: 1, style: 1, labelBackgroundColor: "#3B82F6" },
      horzLine: { color: "#3B82F6", width: 1, style: 1, labelBackgroundColor: "#3B82F6" },
    },
    rightPriceScale: {
      borderColor: "rgba(255,255,255,0.052)",
      scaleMargins: { top: 0.1, bottom: 0.25 },
    },
    timeScale: {
      borderColor: "rgba(255,255,255,0.052)",
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  });

  createMainSeries();

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    color: "#3B82F6",
    visible: showVolume,
  });
  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.82, bottom: 0 },
  });

  if (!showGrid) {
    chart.applyOptions({
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    });
  }

  document.getElementById("btn-volume")?.classList.toggle("active", showVolume);
  document.getElementById("btn-grid")?.classList.toggle("active", showGrid);

  chart.subscribeCrosshairMove(handleCrosshair);

  const ro = new ResizeObserver(() => {
    chart.applyOptions({
      width: container.clientWidth,
      height: container.clientHeight,
    });
    adjustPanes();
  });
  ro.observe(container);
  chart.applyOptions({
    width: container.clientWidth,
    height: container.clientHeight,
  });
  adjustPanes();
}

function createMainSeries() {
  if (mainSeries) {
    chart.removeSeries(mainSeries);
    mainSeries = null;
  }
  if (currentType === "Candlestick") {
    mainSeries = chart.addCandlestickSeries({
      upColor: "#00C46E", downColor: "#F2364A",
      borderUpColor: "#00C46E", borderDownColor: "#F2364A",
      wickUpColor: "#00C46E", wickDownColor: "#F2364A",
    });
  } else if (currentType === "Bar") {
    mainSeries = chart.addBarSeries({
      upColor: "#00C46E", downColor: "#F2364A",
    });
  } else if (currentType === "Line") {
    mainSeries = chart.addLineSeries({
      color: "#3B82F6", lineWidth: 2,
      crosshairMarkerVisible: true, crosshairMarkerRadius: 4,
    });
  } else if (currentType === "Area") {
    mainSeries = chart.addAreaSeries({
      lineColor: "#3B82F6",
      topColor: "rgba(59,130,246,0.22)",
      bottomColor: "rgba(59,130,246,0.01)",
      lineWidth: 2,
    });
  }
}

// ── CHART TYPE ────────────────────────────────────────────
function setChartType(type) {
  currentType = type;
  const mapIcon = { Candlestick: "Chandeliers", Bar: "Barres", Line: "Ligne", Area: "Aire" };
  const labelEl = document.getElementById("label-active-ctype");
  if (labelEl) labelEl.textContent = mapIcon[type];

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
  savePrefs();
}

function toggleGrid() {
  showGrid = !showGrid;
  chart.applyOptions({
    grid: { vertLines: { visible: showGrid }, horzLines: { visible: showGrid } },
  });
  document.getElementById("btn-grid").classList.toggle("active", showGrid);
  savePrefs();
}

function fitContent() {
  chart.timeScale().fitContent();
}

// ── CROSSHAIR TOOLTIP ─────────────────────────────────────
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

let _ttBuilt = false, _ttDate, _ttO, _ttH, _ttL, _ttC, _ttChg;

function ensureTooltipDOM() {
  if (_ttBuilt) return;
  const tt = domRefs().tooltip;
  tt.innerHTML = `
    <div class="tt-date"></div>
    <div class="tt-row"><span class="tt-label">O</span><span class="tt-val tt-o"></span></div>
    <div class="tt-row"><span class="tt-label">H</span><span class="tt-val tt-h" style="color:var(--bull)"></span></div>
    <div class="tt-row"><span class="tt-label">L</span><span class="tt-val tt-l" style="color:var(--bear)"></span></div>
    <div class="tt-row"><span class="tt-label">C</span><span class="tt-val tt-c"></span></div>
    <div class="tt-row"><span class="tt-label">Var</span><span class="tt-val tt-chg"></span></div>
  `;
  _ttDate = tt.querySelector(".tt-date");
  _ttO = tt.querySelector(".tt-o");
  _ttH = tt.querySelector(".tt-h");
  _ttL = tt.querySelector(".tt-l");
  _ttC = tt.querySelector(".tt-c");
  _ttChg = tt.querySelector(".tt-chg");
  _ttBuilt = true;
}

const _dateFormatter =
  typeof Intl !== "undefined"
    ? new Intl.DateTimeFormat("fr-FR", {
        weekday: "long", day: "numeric", month: "short",
        year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : null;

function handleCrosshair(param) {
  const { tooltip, chartContainer } = domRefs();
  if (!mainSeries || !param.time || !param.seriesData.has(mainSeries)) {
    tooltip.style.display = "none";
    return;
  }
  const d = param.seriesData.get(mainSeries);
  if (!d) { tooltip.style.display = "none"; return; }

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
  _ttChg.className = "tt-val tt-chg tt-change " + (chg >= 0 ? "up" : "down");

  tooltip.style.display = "block";
  const rect = chartContainer.getBoundingClientRect();
  let x = param.point.x + 12;
  let y = param.point.y - tooltip.offsetHeight / 2;
  if (x + 160 > rect.width) x = param.point.x - 160;
  if (y < 4) y = 4;
  if (y + tooltip.offsetHeight > rect.height - 4)
    y = rect.height - tooltip.offsetHeight - 4;
  tooltip.style.position = "absolute";
  tooltip.style.left = "0";
  tooltip.style.top = "0";
  tooltip.style.transform = `translate(${x}px, ${y}px)`;
}

// ── RENDER CHART ──────────────────────────────────────────
function renderChart(candles) {
  allCandles = candles;
  const n = candles.length;
  const isLine = currentType === "Line" || currentType === "Area";

  if (isLine) {
    const arr = new Array(n);
    for (let i = 0; i < n; i++)
      arr[i] = { time: candles[i].time, value: candles[i].close };
    mainSeries.setData(arr);
  } else {
    mainSeries.setData(candles);
  }

  const volData = new Array(n);
  const upColor = "rgba(0,196,110,0.50)", downColor = "rgba(242,54,74,0.50)";
  for (let i = 0; i < n; i++) {
    volData[i] = {
      time: candles[i].time,
      value: candles[i].volume || 0,
      color: candles[i].close >= candles[i].open ? upColor : downColor,
    };
  }
  volumeSeries.setData(volData);

  chart.timeScale().fitContent();

  let hi = -Infinity, lo = Infinity;
  for (let i = 0; i < n; i++) {
    if (candles[i].high > hi) hi = candles[i].high;
    if (candles[i].low < lo) lo = candles[i].low;
  }
  const dom = domRefs();

  dom.rowsCount.textContent = n.toLocaleString("fr-FR");
  dom.statusRows.style.display = "";
  dom.statusRange.style.display = "";
  dom.rangeText.textContent =
    dateFromTime(candles[0].time) + " → " + dateFromTime(candles[n - 1].time);
  dom.statusDot.className = "status-dot green";
  dom.statusText.textContent = currentSymbol + " — " + n + " bougies chargées";

  dom.welcomeOverlay.style.opacity = "0";
  setTimeout(() => (dom.welcomeOverlay.style.display = "none"), 400);

  renderIndicators(candles);
  loadDrawings();
  drawRedraw();
  savePrefs();
  showToast(`${currentSymbol} — ${n.toLocaleString("fr-FR")} bougies chargées`, "success", 3000);
}

function dateFromTime(t) {
  if (typeof t === "number")
    return new Date(t * 1000).toLocaleDateString("fr-FR");
  return String(t);
}

// Fast number formatter
const _thousandSepRx = /\B(?=(\d{3})+(?!\d))/g;
function fmt(v) {
  if (!v && v !== 0) return "—";
  const n = +v;
  if (n !== n) return "—";
  const abs = n < 0 ? -n : n;
  let s;
  if (abs >= 1000) {
    s = n.toFixed(2);
    const parts = s.split(".");
    parts[0] = parts[0].replace(_thousandSepRx, " ");
    s = parts.join(",");
  } else if (abs >= 1) {
    s = n.toFixed(4);
  } else {
    s = n.toFixed(6);
  }
  return s;
}
