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
  showToast(`🎲 Replay aléatoire — départ ${label}`, "info", 3000);
}

function startReplayAtSession(sessionKey) {
  if (!baseCandles || baseCandles.length < 20) {
    showToast("Pas assez de données pour lancer un replay de session.", "warning");
    return;
  }
  const targetHour = sessionKey === "london" ? 8 : sessionKey === "ny" ? 13 : 0;
  
  const n = baseCandles.length;
  const maxIdx = Math.max(10, n - 100);
  let matchedIdx = -1;
  
  for (let i = maxIdx; i >= 10; i--) {
    const d = new Date(baseCandles[i].time * 1000);
    if (d.getUTCHours() === targetHour) {
      matchedIdx = i;
      break;
    }
  }
  
  if (matchedIdx === -1) {
    matchedIdx = Math.floor(n * 0.5);
  }
  
  closeModal();
  document.getElementById("btn-replay").classList.add("active");
  document.getElementById("replay-hint").style.display = "none";
  beginReplay(matchedIdx);
  
  const d = new Date(baseCandles[matchedIdx].time * 1000);
  const label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  showToast(`🎯 Session ${sessionKey.toUpperCase()} — ancrage ${label} UTC`, "success", 3500);
}

function promptReplayDate() {
  if (!baseCandles || baseCandles.length < 20) {
    showToast("Pas d'historique disponible.", "warning");
    return;
  }
  const minD = new Date(baseCandles[0].time * 1000).toISOString().slice(0, 10);
  const maxD = new Date(baseCandles[baseCandles.length - 1].time * 1000).toISOString().slice(0, 10);
  
  const userInput = prompt(`Date de départ (entre ${minD} et ${maxD}) — format AAAA-MM-JJ :`, minD);
  if (!userInput) return;
  
  const targetTime = new Date(userInput).getTime() / 1000;
  if (isNaN(targetTime)) {
    showToast("Date invalide.", "error");
    return;
  }
  
  const idx = snapIndexInBase(targetTime);
  if (idx !== -1) {
    closeModal();
    document.getElementById("btn-replay").classList.add("active");
    document.getElementById("replay-hint").style.display = "none";
    beginReplay(idx);
    const d = new Date(baseCandles[idx].time * 1000);
    showToast(`🎯 Replay ancré au ${d.toLocaleDateString("fr-FR")}`, "success", 3000);
  }
}

function startReplayMode() {
  if (!baseCandles || baseCandles.length < 2) {
    showToast("Importez des données avant de lancer le replay.", "warning");
    return;
  }

  // If live WebSocket is connected, pause it during replay
  if (typeof _isLiveConnected !== "undefined" && _isLiveConnected) {
    if (typeof pauseLiveStream === "function") pauseLiveStream();
    showToast("⏸ Flux live mis en pause pendant le Replay", "info", 2500);
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
  if (!c) return;
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

// ── FAST REPLAY RENDER SLICE (NO RESETTING ZOOM OR OVERWRITING DRAWINGS) ──
function renderReplaySlice(upToIdx) {
  if (!baseCandles || upToIdx < 0 || upToIdx >= baseCandles.length) return;
  const visible = baseCandles.slice(0, upToIdx + 1);
  const n = visible.length;

  let displayCandles = visible;
  if (activeTF > baseTF) {
    displayCandles = aggregateCandles(visible, activeTF, activeTFType);
  }

  allCandles = displayCandles;
  sortedTimes = displayCandles.map(c => c.time);

  const dn = displayCandles.length;
  if (currentType === "Line" || currentType === "Area") {
    const arr = new Array(dn);
    for (let i = 0; i < dn; i++) arr[i] = { time: displayCandles[i].time, value: displayCandles[i].close };
    mainSeries.setData(arr);
  } else {
    mainSeries.setData(displayCandles);
  }

  if (volumeSeries && showVolume) {
    const volData = new Array(dn);
    const volBull = "rgba(0,210,106,0.45)", volBear = "rgba(255,59,92,0.35)";
    for (let i = 0; i < dn; i++) {
      volData[i] = {
        time: displayCandles[i].time,
        value: displayCandles[i].volume || 0,
        color: displayCandles[i].close >= displayCandles[i].open ? volBull : volBear,
      };
    }
    volumeSeries.setData(volData);
  }

  // Update indicators without wiping cache or throwing
  try {
    renderIndicators(displayCandles);
  } catch (e) {
    console.warn("Indicator render warning in replay:", e);
  }

  // Redraw drawings on overlay canvas
  if (drawings && drawings.length) {
    requestAnimationFrame(drawRedraw);
  }

  // Update topbar ticker
  const lastC = displayCandles[dn - 1];
  if (lastC) {
    const lastChg = lastC.open > 0 ? ((lastC.close - lastC.open) / lastC.open) * 100 : 0;
    if (typeof _updateTopbarTicker === "function") _updateTopbarTicker(lastC.close, lastChg);
  }
}

function _updateReplaySeries() {
  const c = baseCandles[replay.idx];
  if (!c) return;

  if (activeTF > baseTF) {
    // If on higher timeframe, re-slice to maintain accurate aggregation
    renderReplaySlice(replay.idx);
    return;
  }

  // On base timeframe, update bar incrementally
  try {
    if (mainSeries) {
      if (currentType === "Line" || currentType === "Area") {
        mainSeries.update({ time: c.time, value: c.close });
      } else {
        mainSeries.update(c);
      }
    }
    if (volumeSeries && showVolume) {
      volumeSeries.update({
        time: c.time,
        value: c.volume || 0,
        color: c.close >= c.open ? "rgba(0,210,106,0.50)" : "rgba(242,54,74,0.50)",
      });
    }

    if (!sortedTimes.length || sortedTimes[sortedTimes.length - 1] < c.time) {
      sortedTimes.push(c.time);
    }
    if (allCandles && allCandles.length > 0) {
      if (allCandles[allCandles.length - 1].time === c.time) {
        allCandles[allCandles.length - 1] = c;
      } else {
        allCandles.push(c);
      }
    }

    if (typeof updateIndicatorsLive === "function") {
      updateIndicatorsLive(allCandles, c.time);
    }

    if (drawings.length) {
      requestAnimationFrame(drawRedraw);
    }

    if (typeof _updateTopbarTicker === "function") {
      const chg = c.open > 0 ? ((c.close - c.open) / c.open) * 100 : 0;
      _updateTopbarTicker(c.close, chg);
    }
  } catch (err) {
    // If update() fails due to out-of-order time, fallback to full safe slice render
    renderReplaySlice(replay.idx);
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
  scrubber.max = Math.max(1, baseCandles.length - 1 - startIdx);
  scrubber.value = 0;

  document.getElementById("rp-time-end").textContent = fmtDate(baseCandles[baseCandles.length - 1].time);

  buildReplayChart(startIdx);
  rpUpdateUI();
}

function buildReplayChart(upToIdx) {
  renderReplaySlice(upToIdx);
  requestAnimationFrame(() => {
    chart.timeScale().scrollToPosition(8, false);
  });
}

function rpStep(dir) {
  const newIdx = replay.idx + dir;
  if (newIdx < replay.startIdx) return;
  if (newIdx >= baseCandles.length) { rpPause(); return; }

  const prevIdx = replay.idx;
  replay.idx = newIdx;
  const c = baseCandles[newIdx];

  if (dir > 0) {
    evalTradeSimLogic(c);
    if (typeof playSound === "function") playSound("tick");
    _updateReplaySeries();
  } else {
    // Stepping backwards: re-render slice cleanly
    renderReplaySlice(newIdx);
    updateSimUI(c ? c.close : null);
  }
  rpUpdateUI();
}

function rpUpdateUI() {
  const idx = replay.idx;
  const c = baseCandles[idx];
  if (!c) return;
  const scrubber = document.getElementById("rp-scrubber");
  const val = idx - replay.startIdx;
  scrubber.value = val;
  const maxVal = Math.max(1, baseCandles.length - 1 - replay.startIdx);
  const pct = Math.min(100, Math.max(0, (val / maxVal) * 100)).toFixed(1);
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

  const msPerCandle = () => Math.max(20, 500 / replay.speed);
  replay.lastTick = performance.now();
  replay.accumulated = 0;

  const tick = (now) => {
    if (!replay.playing) return;
    try {
      const delta = now - replay.lastTick;
      replay.lastTick = now;
      replay.accumulated = (replay.accumulated || 0) + delta;
      const mpc = msPerCandle();
      let advanced = 0;

      while (replay.accumulated >= mpc && advanced < 15) {
        replay.accumulated -= mpc;
        advanced++;
        if (replay.idx >= baseCandles.length - 1) {
          replay.idx = baseCandles.length - 1;
          rpPause();
          break;
        }
        replay.idx++;
        evalTradeSimLogic(baseCandles[replay.idx]);
      }

      if (replay.accumulated > mpc * 15) replay.accumulated = 0;

      if (advanced > 0) {
        if (advanced > 1 || activeTF > baseTF) {
          renderReplaySlice(replay.idx);
        } else {
          _updateReplaySeries();
        }
        rpUpdateUI();
      }
    } catch (err) {
      console.warn("Replay tick error:", err);
    }

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

  // If live WebSocket was paused, resume it
  if (typeof resumeLiveStream === "function") {
    resumeLiveStream();
  }

  renderChart(baseCandles, true);
  requestAnimationFrame(() => {
    chart.timeScale().fitContent();
  });
}
