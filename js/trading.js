// ========================================================
//  TRADING — tradeSim, executeTrade, closePosition, position drag, journal
//  Depends on: config.js, ui.js, chart.js
// ========================================================

function _updateAllTradeMarkers() {
  if (!mainSeries) return;
  const markers = [];
  tradeSim.positions.forEach(p => {
    markers.push({
      time: p.time,
      position: p.type === "LONG" ? "belowBar" : "aboveBar",
      color: p.type === "LONG" ? "#3B82F6" : "#F59E0B",
      shape: p.type === "LONG" ? "arrowUp" : "arrowDown",
      text: p.type === "LONG" ? "Buy " + p.qty : "Sell " + p.qty,
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
        ) { hit = true; break; }
      }
      container.style.cursor = hit ? "ns-resize" : drawTool === "cursor" ? "crosshair" : "";
      return;
    }

    container.style.cursor = "ns-resize";
    const newPrice = mainSeries.coordinateToPrice(y);
    if (newPrice === null) return;

    const p = _tradeDragLine.trade;
    let dragType = _tradeDragLine.type;

    if (dragType === "ENTRY") {
      if (p.type === "LONG") dragType = newPrice > p.entry ? "TP" : "SL";
      else dragType = newPrice < p.entry ? "TP" : "SL";
    }

    if (dragType === "SL") {
      if (p.type === "LONG" && newPrice >= p.entry) return;
      if (p.type === "SHORT" && newPrice <= p.entry) return;
      p.sl = newPrice;
      if (!p.slLine) {
        p.slLine = mainSeries.createPriceLine({ price: newPrice, color: "#F2364A", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" });
      } else {
        p.slLine.applyOptions({ price: newPrice });
      }
    } else if (dragType === "TP") {
      if (p.type === "LONG" && newPrice <= p.entry) return;
      if (p.type === "SHORT" && newPrice >= p.entry) return;
      p.tp = newPrice;
      if (!p.tpLine) {
        p.tpLine = mainSeries.createPriceLine({ price: newPrice, color: "#00C46E", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TP" });
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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
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
    color: p.type === "LONG" ? "#3B82F6" : "#F59E0B",
    lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
    title: `${title} ×${p.qty}`,
  });
  if (p.sl) {
    p.slLine = mainSeries.createPriceLine({ price: p.sl, color: "#F2364A", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" });
  }
  if (p.tp) {
    p.tpLine = mainSeries.createPriceLine({ price: p.tp, color: "#00C46E", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TP" });
  }
}

function executeTrade(type) {
  if (!replay.active || !mainSeries) return;
  const currentData = baseCandles[replay.idx];
  if (!currentData) return;

  const entryRaw = parseFloat(document.getElementById("trade-entry").value);
  const slRaw = parseFloat(document.getElementById("trade-sl").value);
  const tpRaw = parseFloat(document.getElementById("trade-tp").value);

  const sl = isNaN(slRaw) || slRaw <= 0 ? null : slRaw;
  const tp = isNaN(tpRaw) || tpRaw <= 0 ? null : tpRaw;
  const entry = isNaN(entryRaw) || entryRaw <= 0 ? currentData.close : entryRaw;

  // Position sizing: % of capital
  const riskPct = parseFloat(document.getElementById("trade-risk-pct")?.value) || 2;
  const autoQty = (tradeSim.balance * riskPct / 100) / entry;
  const qty = parseFloat(document.getElementById("trade-qty").value) || autoQty;

  // Validate SL/TP logic
  if (sl !== null) {
    if (type === "LONG" && sl >= entry) {
      showToast("SL invalide — pour un LONG, le Stop Loss doit être sous le prix d'entrée.", "error");
      return;
    }
    if (type === "SHORT" && sl <= entry) {
      showToast("SL invalide — pour un SHORT, le Stop Loss doit être au-dessus du prix d'entrée.", "error");
      return;
    }
  }
  if (tp !== null) {
    if (type === "LONG" && tp <= entry) {
      showToast("TP invalide — pour un LONG, le Take Profit doit être au-dessus du prix d'entrée.", "error");
      return;
    }
    if (type === "SHORT" && tp >= entry) {
      showToast("TP invalide — pour un SHORT, le Take Profit doit être sous le prix d'entrée.", "error");
      return;
    }
  }

  const trade = {
    id: _nextTradeId++, type, entry, sl, tp, qty,
    time: currentData.time,
    entryLine: null, slLine: null, tpLine: null,
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
  const isLimit = entry !== currentData.close;
  showToast(`${type} ${isLimit ? "LIMIT " : ""}@${fmt(entry)} ×${qty.toFixed(2)}`, "info", 2500);
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
  updateTradeHistoryPanel();
  const pnlSign = pnl >= 0 ? "success" : "error";
  showToast(`Position fermée — ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${reason})`, pnlSign, 3500);
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

function exportTradeHistory() {
  if (!tradeSim || !tradeSim.history.length) { showToast("Aucun trade à exporter", "warning"); return; }
  const header = "Type,Entry,Exit,Qty,P&L,R:R,Reason\n";
  const rows = tradeSim.history.map(t => {
    const riskDiff = t.sl ? Math.abs(t.entry - t.sl) : 0;
    const rewardDiff = t.tp ? Math.abs(t.tp - t.entry) : 0;
    const rr = riskDiff > 0 ? (rewardDiff / riskDiff).toFixed(2) : "—";
    return `${t.type},"${(+t.entry).toFixed(6)}","${(+t.exit).toFixed(6)}","${(+(t.qty||1)).toFixed(4)}","${(+t.pnl).toFixed(2)}","${rr}","${(t.reason || "").replace(/"/g, '""')}"`;
  }).join("\n");

  const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${currentSymbol}_trades_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  showToast(`${tradeSim.history.length} trades exportés`, "success", 2500);
}
