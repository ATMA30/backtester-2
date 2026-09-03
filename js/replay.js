// ========================================================
//  REPLAY ENGINE — startReplayMode, controls, tick loop
//  Depends on: config.js, ui.js, chart.js, timeframe.js, trading.js
// ========================================================

function startReplayRandom() {
  if (!baseCandles || baseCandles.length < 20) {
    showToast("Pas assez de données pour un replay aléatoire.", "warning");
    return;
  }
  if (replay.active) exitReplay();

  // Leave at least 30% of candles to play — randomise inside the first 70%
  // but always after the first 10% so there's some visible context.
  const n = baseCandles.length;
  const minIdx = Math.max(1, Math.floor(n * 0.10));
  const maxIdx = Math.floor(n * 0.70);
  const idx = minIdx + Math.floor(Math.random() * (maxIdx - minIdx + 1));

  closeModal();
  document.getElementById("btn-replay").classList.add("active");
  document.getElementById("replay-hint").style.display = "none";
  beginReplay(idx);

  const d = new Date(baseCandles[idx].time * 1000);
  const label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  showToast(`Replay aléatoire — départ ${label}`, "info", 3000);
}

function startReplayMode() {
  if (!baseCandles || baseCandles.length < 2) {
    showToast("Importez des données avant de lancer le replay.", "warning");
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

  if (replay.active) rpPause();
  else replay.active = false;

  replay.picking = true;

  closeModal();
  document.getElementById("col-mapper").classList.remove("visible");

  const hint = document.getElementById("replay-hint");
  hint.style.display = "block";

  const container = document.getElementById("chart-container");

  let pickLine = document.getElementById("replay-picker-line");
  if (!pickLine) {
    pickLine = document.createElement("div");
    pickLine.id = "replay-picker-line";
    pickLine.style.cssText = "position:absolute;top:0;bottom:0;width:2px;background:rgba(76,122,255,0.8);pointer-events:none;z-index:50;";
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
    let best = -1;
    if (param && param.time) {
      best = baseCandles.findIndex((c) => c.time === param.time);
    }
    if (best === -1) {
      const t = param.time;
      if (t) {
        let diff = Infinity;
        for (let i = 0; i < baseCandles.length; i++) {
          const d = Math.abs(baseCandles[i].time - t);
          if (d < diff) { diff = d; best = i; }
        }
      }
    }
    if (best !== -1) {
      chart.unsubscribeCrosshairMove(container._replayCrosshairHandler);
      chart.unsubscribeClick(container._replayClickHandler);
      if (pickLine) pickLine.style.display = "none";
      beginReplay(best);
    } else {
      showToast("Cliquez sur une bougie valide pour démarrer le replay.", "info", 2500);
    }
  };

  chart.subscribeClick(container._replayClickHandler);
  document.getElementById("btn-replay").classList.add("active");
}

function evalTradeSimLogic(c) {
  for (let i = tradeSim.pendingOrders.length - 1; i >= 0; i--) {
    const p = tradeSim.pendingOrders[i];
    let hit = false;
    if (p.type === "LONG" && c.low <= p.entry) hit = true;
    else if (p.type === "SHORT" && c.high >= p.entry) hit = true;
    if (hit) {
      _removeLinesFrom(p);
      tradeSim.pendingOrders.splice(i, 1);
      p.time = c.time;
      tradeSim.positions.push(p);
      _drawTradeLines(p, p.type);
      _updateAllTradeMarkers();
    }
  }

  const toClose = [];
  for (const p of tradeSim.positions) {
    if (p.type === "LONG") {
      if (p.sl && c.low <= p.sl) toClose.push({ id: p.id, reason: "SL", price: p.sl });
      else if (p.tp && c.high >= p.tp) toClose.push({ id: p.id, reason: "TP", price: p.tp });
    } else if (p.type === "SHORT") {
      if (p.sl && c.high >= p.sl) toClose.push({ id: p.id, reason: "SL", price: p.sl });
      else if (p.tp && c.low <= p.tp) toClose.push({ id: p.id, reason: "TP", price: p.tp });
    }
  }
  toClose.forEach(({ id, reason, price }) => closePosition(reason, price, id));

  updateSimUI(c.close);
}

function _updateReplaySeries() {
  const c = baseCandles[replay.idx];
  let bar = c;

  if (activeTF > baseTF) {
    let o = c.open, h = c.high, l = c.low, closePrice = c.close, v = c.volume || 0;
    const bucketTime = getCalendarBucket(c.time, activeTFType, activeTF);
    for (let i = replay.idx - 1; i >= replay.startIdx; i--) {
      const bCandle = baseCandles[i];
      if (getCalendarBucket(bCandle.time, activeTFType, activeTF) !== bucketTime) break;
      if (bCandle.high > h) h = bCandle.high;
      if (bCandle.low < l) l = bCandle.low;
      o = bCandle.open;
      v += bCandle.volume || 0;
    }
    bar = { time: bucketTime, open: o, high: h, low: l, close: closePrice, volume: v };
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
      color: bar.close >= bar.open ? "rgba(0,196,110,0.50)" : "rgba(242,54,74,0.50)",
    });
  }

  if (!sortedTimes.length || sortedTimes[sortedTimes.length - 1] < bar.time) {
    sortedTimes.push(bar.time);
  }

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

  document.getElementById("replay-hint").style.display = "none";
  document.getElementById("replay-bar").classList.add("visible");
  document.body.classList.add("replay-active");
  document.getElementById("status-replay").style.display = "flex";

  const scrubber = document.getElementById("rp-scrubber");
  scrubber.min = 0;
  scrubber.max = baseCandles.length - 1 - startIdx;
  scrubber.value = 0;

  document.getElementById("rp-time-end").textContent = fmtDate(baseCandles[baseCandles.length - 1].time);

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
  requestAnimationFrame(() => {
    chart.timeScale().scrollToPosition(8, false);
  });
}

function rpStep(dir) {
  const newIdx = replay.idx + dir;
  if (newIdx < replay.startIdx) return;
  if (newIdx >= baseCandles.length) { rpPause(); return; }
  replay.idx = newIdx;
  const c = baseCandles[newIdx];
  if (dir > 0) evalTradeSimLogic(c);
  _updateReplaySeries();
  rpUpdateUI();
}

function rpUpdateUI() {
  const idx = replay.idx;
  const c = baseCandles[idx];
  const scrubber = document.getElementById("rp-scrubber");
  const val = idx - replay.startIdx;
  scrubber.value = val;
  const pct = ((val / (baseCandles.length - 1 - replay.startIdx)) * 100).toFixed(1);
  scrubber.style.background = `linear-gradient(to right, var(--accent) ${pct}%, var(--border) ${pct}%)`;
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

  const msPerCandle = () => 600 / replay.speed;
  replay.lastTick = performance.now();
  replay.accumulated = 0;

  const tick = (now) => {
    if (!replay.playing) return;
    const delta = now - replay.lastTick;
    replay.lastTick = now;
    replay.accumulated = (replay.accumulated || 0) + delta;
    const mpc = msPerCandle();
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
      evalTradeSimLogic(baseCandles[replay.idx]);
      _updateReplaySeries();
    }
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
  weekday: "short", day: "2-digit", month: "short",
  year: "numeric", hour: "2-digit", minute: "2-digit",
  timeZone: "UTC",
});

function fmtDate(t) {
  return _fastDateFormatter.format(new Date(t * 1000));
}

function exitReplay() {
  rpPause();

  if (tradeSim.history.length) {
    const wins = tradeSim.history.filter(t => t.pnl > 0).length;
    const total = tradeSim.history.length;
    const pnl = tradeSim.history.reduce((s, t) => s + t.pnl, 0);
    const pnlStr = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
    const type = pnl >= 0 ? "success" : "error";
    showToast(`Session terminée — ${total} trades · W:${wins}/${total} · P&L ${pnlStr}`, type, 5000);
  }

  if (_tradeHistoryOpen) toggleTradeHistory();
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

  const container = document.getElementById("chart-container");
  if (container._replayClickHandler) {
    chart.unsubscribeClick(container._replayClickHandler);
    container._replayClickHandler = null;
  }
  if (container._replayCrosshairHandler) {
    chart.unsubscribeCrosshairMove(container._replayCrosshairHandler);
    container._replayCrosshairHandler = null;
  }

  renderChart(baseCandles, true);
  requestAnimationFrame(() => {
    chart.timeScale().fitContent();
  });
}
