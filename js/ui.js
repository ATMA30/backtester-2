// ========================================================
//  UI — Toast, Undo/Redo, Modals, R:R Badge, OHLC Snap
//  Depends on: config.js
// ========================================================

// ── DROPDOWN ──────────────────────────────────────────────
function toggleDropdown(menuId) {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const wasShown = menu.classList.contains("show");
  document.querySelectorAll(".tv-dropdown-menu").forEach((m) => m.classList.remove("show"));
  if (!wasShown) menu.classList.add("show");
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".tv-dropdown")) {
    document.querySelectorAll(".tv-dropdown-menu").forEach((m) => m.classList.remove("show"));
  }
});

// ── FULLSCREEN / IMMERSION ─────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    document.getElementById("btn-fullscreen")?.classList.add("active");
    showToast("⛶ Mode Immersion plein écran activé", "info", 2000);
  } else {
    document.exitFullscreen().catch(() => {});
    document.getElementById("btn-fullscreen")?.classList.remove("active");
    showToast("Sortie du mode immersion", "info", 2000);
  }
}

document.addEventListener("fullscreenchange", () => {
  const isFull = !!document.fullscreenElement;
  document.getElementById("btn-fullscreen")?.classList.toggle("active", isFull);
});

// ── TOAST ────────────────────────────────────────────────
function showToast(msg, type = "info", duration = 4000) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</div>
    <div class="toast-body"><div class="toast-msg">${msg}</div></div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>
    <div class="toast-progress"></div>`;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("toast-show")));
  const t = setTimeout(() => {
    toast.classList.remove("toast-show");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, duration);
  toast.querySelector(".toast-close").addEventListener("click", () => clearTimeout(t));
}

// ── UNDO / REDO ──────────────────────────────────────────
function _pushUndo() {
  _undoStack.push(JSON.stringify(drawings));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack = [];
}

function undo() {
  if (!_undoStack.length) { showToast("Rien à annuler", "info", 2000); return; }
  _redoStack.push(JSON.stringify(drawings));
  drawings = JSON.parse(_undoStack.pop());
  exitEditMode();
  drawRedraw();
  saveDrawings();
}

function redo() {
  if (!_redoStack.length) { showToast("Rien à rétablir", "info", 2000); return; }
  _undoStack.push(JSON.stringify(drawings));
  drawings = JSON.parse(_redoStack.pop());
  exitEditMode();
  drawRedraw();
  saveDrawings();
}

// ── INDICATOR CONFIG MODAL ────────────────────────────────
let _indModalType = null;
let _indModalColor = null;

function openIndicatorModal(type) {
  _indModalType = type;
  let defaultPeriod;
  if (type === "RSI") defaultPeriod = "14";
  else if (type === "EMA") defaultPeriod = "21";
  else if (type === "MACD") defaultPeriod = "12,26,9";
  else if (type === "BB") defaultPeriod = "20,2";
  else if (type === "VWAP") defaultPeriod = "0";
  else defaultPeriod = "20";

  _indModalColor = IND_SWATCH_COLORS[customIndicators.length % IND_SWATCH_COLORS.length];

  document.getElementById("ind-modal-title").textContent = `Ajouter ${type}`;
  document.getElementById("ind-period").value = defaultPeriod;

  // Show/hide period field for VWAP
  const periodField = document.getElementById("ind-period-field");
  if (periodField) periodField.style.display = type === "VWAP" ? "none" : "";

  // Update period label for different types
  const periodLabel = document.getElementById("ind-period-label");
  if (periodLabel) {
    if (type === "MACD") periodLabel.textContent = "Périodes (rapide,lente,signal)";
    else if (type === "BB") periodLabel.textContent = "Période,Multiplicateur";
    else periodLabel.textContent = "Période";
  }

  const swatches = document.getElementById("ind-color-swatches");
  swatches.innerHTML = IND_SWATCH_COLORS.map(c =>
    `<div class="ind-color-swatch${c === _indModalColor ? " active" : ""}" style="background:${c}"
      onclick="window._indSelectColor('${c}',this)"></div>`
  ).join("");

  document.getElementById("indicator-modal").classList.add("open");
  setTimeout(() => document.getElementById("ind-period").focus(), 100);
}

window._indSelectColor = function(color, el) {
  _indModalColor = color;
  el.closest(".ind-color-swatches").querySelectorAll(".ind-color-swatch").forEach(s => s.classList.remove("active"));
  el.classList.add("active");
};

function closeIndicatorModal() {
  document.getElementById("indicator-modal").classList.remove("open");
  _indModalType = null;
}

function confirmAddIndicator() {
  if (!_indModalType) return;
  const periodRaw = document.getElementById("ind-period").value.trim();
  const id = _nextDrawId().toString();
  const color = _indModalColor || IND_SWATCH_COLORS[0];

  let ind;

  if (_indModalType === "VWAP") {
    ind = { id, type: "VWAP", period: 0, color, series: null };
  } else if (_indModalType === "MACD") {
    const parts = periodRaw.split(",").map(s => parseInt(s.trim(), 10));
    const fastP = parts[0] || 12, slowP = parts[1] || 26, signalP = parts[2] || 9;
    if (isNaN(fastP) || isNaN(slowP) || isNaN(signalP) || fastP <= 0 || slowP <= 0 || signalP <= 0) {
      showToast("Périodes MACD invalides — format: rapide,lente,signal (ex: 12,26,9)", "error");
      return;
    }
    ind = { id, type: "MACD", period: periodRaw, fastP, slowP, signalP, color, series: null };
  } else if (_indModalType === "BB") {
    const parts = periodRaw.split(",").map(s => parseFloat(s.trim()));
    const period = Math.round(parts[0]) || 20;
    const mult = parts[1] || 2.0;
    if (isNaN(period) || period <= 0) {
      showToast("Période Bollinger invalide", "error");
      return;
    }
    ind = { id, type: "BB", period, multiplier: mult, color, series: null };
  } else {
    const period = parseInt(periodRaw, 10);
    if (isNaN(period) || period <= 0) {
      showToast("Période invalide — entrez un nombre > 0", "error");
      return;
    }
    ind = { id, type: _indModalType, period, color, series: null };
  }

  customIndicators.push(ind);
  updateIndMenu();
  if (allCandles && allCandles.length) renderIndicators(allCandles);
  closeIndicatorModal();

  let label = _indModalType;
  if (_indModalType === "MACD") label = `MACD(${ind.fastP},${ind.slowP},${ind.signalP})`;
  else if (_indModalType === "BB") label = `BB(${ind.period},${ind.multiplier})`;
  else if (_indModalType === "VWAP") label = "VWAP";
  else label = `${_indModalType}(${ind.period})`;
  showToast(`${label} ajouté`, "success", 2500);
}

// ── TRADE HISTORY PANEL ────────────────────────────────────
function toggleTradeHistory() {
  _tradeHistoryOpen = !_tradeHistoryOpen;
  const panel = document.getElementById("trade-history-panel");
  if (_tradeHistoryOpen) {
    panel.classList.add("open");
    updateTradeHistoryPanel();
  } else {
    panel.classList.remove("open");
  }
}

function updateTradeHistoryPanel() {
  if (!_tradeHistoryOpen) return;
  const history = tradeSim ? tradeSim.history : [];
  const count = history.length;
  const wins = history.filter(t => t.pnl > 0);
  const losses = history.filter(t => t.pnl < 0);
  const totalPnl = history.reduce((s, t) => s + t.pnl, 0);
  const best = count ? Math.max(...history.map(t => t.pnl)) : null;

  // Drawdown analysis & Max Run-up
  let maxDrawdown = 0, peak = 0, cumulative = 0;
  let maxRunup = 0, trough = 0;
  history.forEach(t => {
    cumulative += t.pnl;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
    trough = Math.min(trough, cumulative);
    maxRunup = Math.max(maxRunup, cumulative - trough);
  });

  // Avg win/loss ratio
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0)) / losses.length : 0;
  const wlRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : (avgWin > 0 ? 999 : 0);

  // Expectancy (Espérance mathématique par trade)
  const winRate = count ? wins.length / count : 0;
  const lossRate = count ? losses.length / count : 0;
  const expectancy = count ? ((winRate * avgWin) - (lossRate * avgLoss)) : 0;

  // Sharpe Ratio estimation
  let sharpe = "—";
  if (count >= 3) {
    const returns = history.map(t => t.pnl / (tradeSim.balance || 10000));
    const meanR = returns.reduce((a, b) => a + b, 0) / count;
    const variance = returns.reduce((a, b) => a + Math.pow(b - meanR, 2), 0) / (count - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) sharpe = ((meanR / stdDev) * Math.sqrt(252)).toFixed(2);
  }

  // Profit factor
  const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLossesAbs = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const pf = totalLossesAbs > 0 ? (totalWins / totalLossesAbs).toFixed(2) : (totalWins > 0 ? "∞" : "—");

  // Max consecutive losses
  let maxStreak = 0, curStreak = 0;
  history.forEach(t => {
    if (t.pnl < 0) { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
    else curStreak = 0;
  });

  document.getElementById("th-count").textContent = count;
  document.getElementById("th-winrate").textContent = count ? `${Math.round(wins.length / count * 100)}%` : "—";
  const pnlEl = document.getElementById("th-total-pnl");
  pnlEl.textContent = `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`;
  pnlEl.className = "th-stat-val " + (totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : "");
  document.getElementById("th-best").textContent = best !== null ? `$${best.toFixed(2)}` : "—";
  document.getElementById("th-drawdown").textContent = maxDrawdown > 0 ? `-$${maxDrawdown.toFixed(2)}` : "—";
  document.getElementById("th-avg-wl").textContent = count ? `${wlRatio.toFixed(2)}` : "—";

  const pfEl = document.getElementById("th-profit-factor");
  if (pfEl) pfEl.textContent = count ? pf : "—";
  const streakEl = document.getElementById("th-streak");
  if (streakEl) streakEl.textContent = count ? maxStreak : "—";

  const expEl = document.getElementById("th-expectancy");
  if (expEl) expEl.textContent = count ? `${expectancy >= 0 ? "+" : ""}$${expectancy.toFixed(2)}` : "—";
  const sharpeEl = document.getElementById("th-sharpe");
  if (sharpeEl) sharpeEl.textContent = sharpe;

  drawEquityCurve(history);

  const list = document.getElementById("th-list");
  if (!count) {
    list.innerHTML = '<div class="th-empty">Aucun trade fermé</div>';
    return;
  }
  list.innerHTML = [...history].reverse().map(t => {
    const pnlSign = t.pnl >= 0 ? "pos" : "neg";
    const pnlTxt = `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`;
    return `<div class="th-trade-row">
      <span class="th-badge ${t.type === "LONG" ? "long" : "short"}">${t.type}</span>
      <div class="th-trade-info">
        <div class="th-trade-price">E: ${fmt(t.entry)} → X: ${fmt(t.exit)}</div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:1px;">${t.reason} • Qty: ${(t.qty || 1).toFixed(2)}</div>
      </div>
      <span class="th-trade-pnl ${pnlSign}">${pnlTxt}</span>
    </div>`;
  }).join("");
}

// ── DATASETS & SESSIONS MODAL ─────────────────────────────
let _activeDataModalTab = "datasets";

function openDatasetsModal(tab = "datasets") {
  _activeDataModalTab = tab;
  const modal = document.getElementById("datasets-modal");
  renderDatasetsModalContent();
  if (modal) modal.classList.add("open");
}

function closeDatasetsModal() {
  const modal = document.getElementById("datasets-modal");
  if (modal) modal.classList.remove("open");
}

async function renderDatasetsModalContent() {
  const listEl = document.getElementById("datasets-list");
  if (!listEl) return;

  const headerTabs = `
    <div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:10px;">
      <button class="btn-sm ${_activeDataModalTab === 'datasets' ? 'btn-primary' : ''}" 
              onclick="_activeDataModalTab = 'datasets'; renderDatasetsModalContent();">
        📊 Datasets CSV/Live
      </button>
      <button class="btn-sm ${_activeDataModalTab === 'sessions' ? 'btn-primary' : ''}" 
              onclick="_activeDataModalTab = 'sessions'; renderDatasetsModalContent();">
        💾 Sessions Sauvegardées
      </button>
      <button class="btn-sm" style="margin-left:auto;" onclick="promptSaveSession()">
        + Sauvegarder Session
      </button>
    </div>
  `;

  if (_activeDataModalTab === "sessions") {
    if (typeof dbListSessions !== "function") {
      listEl.innerHTML = headerTabs + '<div class="th-empty">IndexedDB non disponible</div>';
      return;
    }
    const sessions = await dbListSessions();
    if (!sessions.length) {
      listEl.innerHTML = headerTabs + `
        <div class="th-empty" style="padding:24px 10px;">
          <div>Aucune session sauvegardée</div>
          <button class="btn-sm btn-primary" style="margin-top:10px;" onclick="promptSaveSession()">Sauvegarder l'état actuel</button>
        </div>
      `;
      return;
    }
    listEl.innerHTML = headerTabs + sessions.map(s => {
      const dStr = new Date(s.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const pnlColor = s.totalPnl >= 0 ? "var(--bull)" : "var(--bear)";
      const pnlSign = s.totalPnl >= 0 ? "+" : "";
      return `
        <div class="dataset-item-row" style="margin-bottom:8px;">
          <div class="dataset-item-info">
            <span class="dataset-item-title">${s.name} <span style="font-size:11px;color:var(--text-muted);font-weight:normal;">(${s.symbol})</span></span>
            <span class="dataset-item-meta">
              ${s.tradeCount} trades • P&L: <strong style="color:${pnlColor}">${pnlSign}$${s.totalPnl.toFixed(2)}</strong> • ${s.drawingsCount} dessins • ${dStr}
            </span>
          </div>
          <div class="dataset-item-actions">
            <button class="btn-sm btn-primary" onclick="loadSavedSession('${s.id}')">Ouvrir</button>
            <button class="btn-sm" onclick="exportSavedSession('${s.id}')" title="Exporter JSON">📤</button>
            <button class="btn-sm btn-danger" onclick="deleteSavedSession('${s.id}')" title="Supprimer">🗑️</button>
          </div>
        </div>
      `;
    }).join("");
    return;
  }

  // Datasets tab
  if (typeof dbListDatasets !== "function") {
    listEl.innerHTML = headerTabs + '<div class="th-empty">IndexedDB non disponible</div>';
    return;
  }
  const datasets = await dbListDatasets();
  if (!datasets.length) {
    listEl.innerHTML = headerTabs + '<div class="th-empty">Aucun jeu de données sauvegardé</div>';
    return;
  }
  listEl.innerHTML = headerTabs + datasets.map(ds => {
    const dStr = new Date(ds.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return `
      <div class="dataset-item-row" style="margin-bottom:8px;">
        <div class="dataset-item-info">
          <span class="dataset-item-title">${ds.symbol}</span>
          <span class="dataset-item-meta">${ds.candleCount.toLocaleString()} bougies • ${dStr}</span>
        </div>
        <div class="dataset-item-actions">
          <button class="btn-sm btn-primary" onclick="loadSavedDataset('${ds.id}')">Charger</button>
          <button class="btn-sm btn-danger" onclick="deleteSavedDataset('${ds.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join("");
}

async function promptSaveSession() {
  const defaultName = `${currentSymbol} — ${new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  const name = prompt("Nom de la session :", defaultName);
  if (!name) return;

  const id = `sess_${Date.now()}`;
  await dbSaveSession({ id, name });
  showToast(`Session "${name}" sauvegardée !`, "success", 2500);
  _activeDataModalTab = "sessions";
  await renderDatasetsModalContent();
}

async function loadSavedSession(id) {
  if (typeof dbLoadSession !== "function") return;
  const sess = await dbLoadSession(id);
  if (!sess) {
    showToast("Session introuvable", "error");
    return;
  }

  if (sess.activeDatasetId) {
    const ds = await dbGetDataset(sess.activeDatasetId);
    if (ds && ds.candles) {
      baseCandles = ds.candles;
      allCandles = ds.candles;
      sortedTimes = ds.candles.map(c => c.time);
      baseTF = ds.baseTF || detectBaseTF(ds.candles);
    }
  }

  currentSymbol = sess.symbol || currentSymbol;
  document.getElementById("symbol-input").value = currentSymbol;
  document.getElementById("ticker-symbol").textContent = currentSymbol;

  drawings = sess.drawings || [];
  if (sess.tradeSim) {
    tradeSim.balance = sess.tradeSim.balance || 10000;
    tradeSim.positions = sess.tradeSim.positions || [];
    tradeSim.pendingOrders = sess.tradeSim.pendingOrders || [];
    tradeSim.history = sess.tradeSim.history || [];
    document.getElementById("rp-balance").textContent = formatMoney(tradeSim.balance);
    _updateAllTradeMarkers();
  }

  renderChart(allCandles.length ? allCandles : baseCandles, true);
  fitContent();
  drawRedraw();
  updateTradeHistoryPanel();
  closeDatasetsModal();
  showToast(`Session "${sess.name || sess.symbol}" restaurée`, "success", 2500);
}

async function deleteSavedSession(id) {
  if (!confirm("Supprimer cette session ?")) return;
  if (typeof dbDeleteSession !== "function") return;
  await dbDeleteSession(id);
  await renderDatasetsModalContent();
  showToast("Session supprimée", "info", 1500);
}

async function exportSavedSession(id) {
  if (typeof dbLoadSession !== "function") return;
  const sess = await dbLoadSession(id);
  if (!sess) return;
  const blob = new Blob([JSON.stringify(sess, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tradeview_session_${sess.symbol}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Session exportée en JSON", "success", 2000);
}

async function loadSavedDataset(id) {
  if (typeof dbGetDataset !== "function") return;
  const ds = await dbGetDataset(id);
  if (!ds || !ds.candles.length) {
    showToast("Jeu de données introuvable ou vide", "error");
    return;
  }
  currentSymbol = ds.symbol;
  document.getElementById("symbol-input").value = ds.symbol;
  document.getElementById("ticker-symbol").textContent = ds.symbol;
  baseCandles = ds.candles;
  allCandles = ds.candles;
  sortedTimes = ds.candles.map(c => c.time);
  baseTF = ds.baseTF || detectBaseTF(ds.candles);
  window._currentDatasetId = ds.id;
  renderChart(ds.candles, true);
  fitContent();
  closeDatasetsModal();
  showToast(`Dataset ${ds.symbol} chargé (${ds.candles.length.toLocaleString()} bougies)`, "success", 2500);
}

async function deleteSavedDataset(id) {
  if (typeof dbDeleteDataset !== "function") return;
  await dbDeleteDataset(id);
  await renderDatasetsModalContent();
  showToast("Dataset supprimé", "info", 1500);
}

function drawEquityCurve(history) {
  const svg = document.getElementById("equity-curve");
  if (!svg) return;
  svg.innerHTML = "";

  if (!history.length) return;

  const width = svg.getBoundingClientRect().width || svg.clientWidth || 284;
  const height = svg.getBoundingClientRect().height || svg.clientHeight || 60;
  const padding = 4;
  const graphW = width - 2 * padding;
  const graphH = height - 2 * padding;

  let cumulative = 0;
  const equityPoints = history.map(t => { cumulative += t.pnl; return cumulative; });

  const minEq = Math.min(0, ...equityPoints);
  const maxEq = Math.max(0, ...equityPoints);
  const eqRange = maxEq - minEq || 1;

  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", width);
  bg.setAttribute("height", height);
  bg.setAttribute("fill", "#0f1420");
  svg.appendChild(bg);

  const zeroLine = (0 - minEq) / eqRange;
  const zeroY = padding + (1 - zeroLine) * graphH;
  const line0 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line0.setAttribute("x1", padding); line0.setAttribute("y1", zeroY);
  line0.setAttribute("x2", width - padding); line0.setAttribute("y2", zeroY);
  line0.setAttribute("stroke", "rgba(255,255,255,0.1)"); line0.setAttribute("stroke-width", "0.5");
  svg.appendChild(line0);

  const points = equityPoints.map((eq, i) => {
    const x = padding + (i / (equityPoints.length - 1 || 1)) * graphW;
    const y = padding + (1 - (eq - minEq) / eqRange) * graphH;
    return `${x},${y}`;
  }).join(" ");

  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", points);
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", equityPoints[equityPoints.length - 1] >= 0 ? "var(--bull)" : "var(--bear)");
  polyline.setAttribute("stroke-width", "1.5");
  polyline.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(polyline);
}

// ── KEYBOARD SHORTCUTS OVERLAY ────────────────────────────
function closeShortcuts() {
  document.getElementById("shortcuts-overlay").classList.remove("open");
}

// ── R:R BADGE ─────────────────────────────────────────────
function updateRRBadge() {
  const badge = document.getElementById("rr-badge");
  const rrVal = document.getElementById("rr-val");
  if (!badge || !rrVal) return;

  const entry = parseFloat(document.getElementById("trade-entry")?.value);
  const sl = parseFloat(document.getElementById("trade-sl")?.value);
  const tp = parseFloat(document.getElementById("trade-tp")?.value);

  if (isNaN(entry) || isNaN(sl) || isNaN(tp) || sl <= 0 || tp <= 0) {
    badge.classList.remove("visible", "good", "bad");
    return;
  }

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (!risk) { badge.classList.remove("visible", "good", "bad"); return; }

  const rr = (reward / risk).toFixed(2);
  rrVal.textContent = `1:${rr}`;
  badge.classList.add("visible");
  badge.classList.toggle("good", parseFloat(rr) >= 1.5);
  badge.classList.toggle("bad", parseFloat(rr) < 1.0);
}

// ── DRAW MODIFIER KEYS ────────────────────────────────────
// Shift → constrain angle to 0°/45°/90°/135°/180° (TradingView behaviour)
// Ctrl  → snap cursor to nearest OHLC price level
document.addEventListener("keydown", e => {
  if (drawTool === "cursor") return;
  if (e.key === "Shift") {
    _shiftHeld = true;
    document.getElementById("snap-badge").textContent = "⊿ Angle contraint";
    document.getElementById("snap-badge").classList.add("visible");
  }
  if (e.key === "Control" || e.key === "Meta") {
    _ctrlHeld = true;
    document.getElementById("snap-badge").textContent = "⬡ Snap OHLC actif";
    document.getElementById("snap-badge").classList.add("visible");
  }
});
document.addEventListener("keyup", e => {
  if (e.key === "Shift")                  _shiftHeld = false;
  if (e.key === "Control" || e.key === "Meta") _ctrlHeld = false;
  if (!_shiftHeld && !_ctrlHeld)
    document.getElementById("snap-badge").classList.remove("visible");
});

function _snapToOHLC(time, price) {
  if (!allCandles.length) return { time, price };
  const snappedTime = snapTime(time);
  const candle = allCandles.find(c => c.time === snappedTime);
  if (!candle) return { time: snappedTime, price };
  const ohlc = [candle.open, candle.high, candle.low, candle.close];
  const snappedPrice = ohlc.reduce((best, v) => Math.abs(v - price) < Math.abs(best - price) ? v : best, ohlc[0]);
  return { time: snappedTime, price: snappedPrice };
}
