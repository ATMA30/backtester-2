// ========================================================
//  DRAWINGS — Drawing engine + session separators
//  Depends on: config.js, ui.js, storage.js, chart.js
// ========================================================

function initDrawCanvas() {
  const container = document.getElementById("chart-container");
  drawCanvas = document.createElement("canvas");
  drawCanvas.id = "draw-canvas";
  drawCanvas.classList.add("active");
  container.appendChild(drawCanvas);
  drawCtx = drawCanvas.getContext("2d");
  resizeDrawCanvas();
  new ResizeObserver(resizeDrawCanvas).observe(container);

  drawCanvas.addEventListener("mousedown", onDrawMouseDown);
  drawCanvas.addEventListener("mousemove", onDrawMouseMove);
  drawCanvas.addEventListener("mouseup", onDrawMouseUp);
  drawCanvas.addEventListener("dblclick", onCursorContainerDblClick);

  // Dynamic pointer-events routing: when mouse is near a drawing/handle, catch it; otherwise pass to chart for panning
  const updatePointerState = (mx, my) => {
    if (drawTool !== "cursor" || editDragging) {
      drawCanvas.style.pointerEvents = "auto";
      return;
    }
    let near = false;
    if (editingDrawing) {
      if (findHandle(mx, my, editingDrawing) || isNearDrawing(editingDrawing, mx, my)) near = true;
    }
    if (!near && drawings.length) {
      for (const d of drawings) {
        if (isNearDrawing(d, mx, my)) { near = true; break; }
      }
    }
    drawCanvas.style.pointerEvents = near ? "auto" : "none";
  };

  container.addEventListener("mousemove", (e) => {
    const rect = drawCanvas.getBoundingClientRect();
    updatePointerState(e.clientX - rect.left, e.clientY - rect.top);
  });

  document.addEventListener("mousedown", (e) => {
    const menu = document.getElementById("draw-ctx-menu");
    if (menu && !menu.contains(e.target)) hideDrawCtxMenu();
  });

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
  drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawRedraw();
}

function snapTime(time) {
  if (!sortedTimes.length) return time;
  let lo = 0, hi = sortedTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sortedTimes[lo - 1] - time) < Math.abs(sortedTimes[lo] - time))
    return sortedTimes[lo - 1];
  return sortedTimes[lo];
}

function snapIndexInBase(time) {
  if (!baseCandles || !baseCandles.length) return -1;
  let lo = 0, hi = baseCandles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (baseCandles[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(baseCandles[lo - 1].time - time) < Math.abs(baseCandles[lo].time - time)) {
    return lo - 1;
  }
  return lo;
}

function getBarSpacingPx() {
  const ts = chart.timeScale();
  const times = sortedTimes && sortedTimes.length ? sortedTimes : (baseCandles ? baseCandles.map(c => c.time) : []);
  if (!times || times.length < 2) return 8;

  const n = times.length;
  let x1 = null, i1 = -1, x2 = null, i2 = -1;
  for (let i = n - 1; i >= 0; i--) {
    const cx = ts.timeToCoordinate(times[i]);
    if (cx !== null && cx !== undefined) {
      if (x1 === null) { x1 = cx; i1 = i; }
      else             { x2 = cx; i2 = i; break; }
    }
  }
  if (x1 !== null && x2 !== null && i1 !== i2) {
    const sp = Math.abs(x1 - x2) / Math.abs(i1 - i2);
    if (sp > 0.1 && sp < 500) return sp;
  }
  return 8;
}

function toXY(time, price) {
  const ts = chart.timeScale();
  let x = ts.timeToCoordinate(time);

  if ((x === null || x === undefined) && sortedTimes.length >= 1) {
    const n = sortedTimes.length;
    const lastTime = sortedTimes[n - 1];
    const firstTime = sortedTimes[0];
    const lastX = ts.timeToCoordinate(lastTime);
    const firstX = ts.timeToCoordinate(firstTime);
    const barSpacing = getBarSpacingPx();
    const tf = activeTF || baseTF || 60;

    // Check if time is in full baseCandles (replay future or historical)
    if (typeof baseCandles !== "undefined" && baseCandles && baseCandles.length > 0) {
      const maxBaseTime = baseCandles[baseCandles.length - 1].time;
      const minBaseTime = baseCandles[0].time;
      const currentLastIdx = snapIndexInBase(lastTime);

      if (time <= maxBaseTime && time >= minBaseTime) {
        const targetIdx = snapIndexInBase(time);
        if (targetIdx !== -1 && currentLastIdx !== -1 && lastX !== null && lastX !== undefined) {
          const barDelta = targetIdx - currentLastIdx;
          x = lastX + barDelta * barSpacing;
        }
      } else if (time > maxBaseTime) {
        // Future past the end of all baseCandles without clamping
        const lastBaseIdx = baseCandles.length - 1;
        const extraBars = Math.round((time - maxBaseTime) / tf);
        const barDelta = (lastBaseIdx - currentLastIdx) + extraBars;
        if (lastX !== null && lastX !== undefined) {
          x = lastX + barDelta * barSpacing;
        }
      }
    }

    if (x === null || x === undefined) {
      if (lastX !== null && lastX !== undefined) {
        const barDelta = (time - lastTime) / tf;
        x = lastX + barDelta * barSpacing;
      } else if (firstX !== null && firstX !== undefined) {
        const barDelta = (time - firstTime) / tf;
        x = firstX + barDelta * barSpacing;
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

  if (!time && sortedTimes.length >= 1) {
    const ts = chart.timeScale();
    const n = sortedTimes.length;
    const lastTime = sortedTimes[n - 1];
    const lastX = ts.timeToCoordinate(lastTime);
    const barSpacing = getBarSpacingPx();
    const tf = activeTF || baseTF || 60;

    if (lastX !== null && lastX !== undefined && barSpacing > 0.01) {
      const barsOff = Math.round((x - lastX) / barSpacing);
      if (typeof baseCandles !== "undefined" && baseCandles && baseCandles.length > 0) {
        const lastIdxInBase = snapIndexInBase(lastTime);
        const targetIdx = lastIdxInBase + barsOff;
        if (targetIdx >= 0 && targetIdx < baseCandles.length) {
          time = baseCandles[targetIdx].time;
        } else if (targetIdx >= baseCandles.length) {
          // Future space beyond the end of data without clamping
          const maxBaseTime = baseCandles[baseCandles.length - 1].time;
          const extraBars = targetIdx - (baseCandles.length - 1);
          time = maxBaseTime + extraBars * tf;
        } else {
          time = baseCandles[0].time + targetIdx * tf;
        }
      } else {
        time = lastTime + barsOff * tf;
      }
    }
    if (!time) time = lastTime;
  }

  const price = mainSeries ? mainSeries.coordinateToPrice(y) : 0;
  return { time: time || null, price };
}

// ── HANDLES ───────────────────────────────────────────────
function getHandles(d) {
  const W = drawCanvas.width / (window.devicePixelRatio || 1);
  const H = drawCanvas.height / (window.devicePixelRatio || 1);
  const ptXY = (pt) => pt._x !== undefined ? { x: pt._x, y: pt._y } : toXY(pt.time, pt.price);
  const handles = [];

  if (d.type === "hline") {
    const yy = d.pts[0]._y !== undefined
      ? d.pts[0]._y
      : (mainSeries ? mainSeries.priceToCoordinate(d.pts[0].price) : null);
    if (yy !== null) {
      handles.push({ ptIdx: 0, axis: "y", x: W * 0.25, y: yy });
      handles.push({ ptIdx: 0, axis: "y", x: W * 0.75, y: yy });
    }
  } else if (d.type === "vline") {
    const p = ptXY(d.pts[0]);
    if (p.x !== null) {
      handles.push({ ptIdx: 0, axis: "x", x: p.x, y: H * 0.25 });
      handles.push({ ptIdx: 0, axis: "x", x: p.x, y: H * 0.75 });
    }
  } else if (d.type === "rect" && d.pts.length >= 2) {
    const p0 = ptXY(d.pts[0]);
    const p1 = ptXY(d.pts[1]);
    if (p0.x !== null && p1.x !== null) {
      handles.push({ ptIdx: 0,    axis: "xy", x: p0.x, y: p0.y });
      handles.push({ ptIdx: 1,    axis: "xy", x: p1.x, y: p1.y });
      handles.push({ ptIdx: "tr", axis: "xy", x: p1.x, y: p0.y });
      handles.push({ ptIdx: "bl", axis: "xy", x: p0.x, y: p1.y });
      const cmx = (p0.x + p1.x) / 2, cmy = (p0.y + p1.y) / 2;
      handles.push({ ptIdx: "mt", axis: "y0", x: cmx,  y: p0.y });
      handles.push({ ptIdx: "mb", axis: "y1", x: cmx,  y: p1.y });
      handles.push({ ptIdx: "ml", axis: "x0", x: p0.x, y: cmy  });
      handles.push({ ptIdx: "mr", axis: "x1", x: p1.x, y: cmy  });
    }
  } else if (d.type === "channel" && d.pts.length >= 2) {
    const cp0 = ptXY(d.pts[0]);
    const cp1 = ptXY(d.pts[1]);
    if (cp0.x === null || cp1.x === null) return handles;

    handles.push({ ptIdx: 0, axis: "xy", x: cp0.x, y: cp0.y });
    handles.push({ ptIdx: 1, axis: "xy", x: cp1.x, y: cp1.y });

    if (d.pts.length >= 3) {
      const cp2 = ptXY(d.pts[2]);
      if (cp2.x !== null) {
        const dx = cp1.x - cp0.x, dy = cp1.y - cp0.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        const dist = (cp2.x - cp0.x) * nx + (cp2.y - cp0.y) * ny;

        // C3 = P0 + width·normal — handle for adjusting perpendicular width
        const c3x = cp0.x + dist * nx, c3y = cp0.y + dist * ny;
        handles.push({ ptIdx: "w", axis: "w", x: c3x, y: c3y });

        // Rotation handle — 28px outside the midpoint of the bottom edge
        const sign = dist >= 0 ? -1 : 1;
        const midX = (cp0.x + cp1.x) / 2, midY = (cp0.y + cp1.y) / 2;
        handles.push({
          ptIdx: "rot", axis: "rot",
          x: midX + sign * nx * 28,
          y: midY + sign * ny * 28,
        });
      }
    }
  } else if ((d.type === "pos_long" || d.type === "pos_short") && d.pts.length >= 3) {
    const p0 = ptXY(d.pts[0]); // Entry
    const p1 = ptXY(d.pts[1]); // TP + EndTime
    const p2 = ptXY(d.pts[2]); // SL
    if (p0.x !== null && p1.x !== null) {
      const midX = (p0.x + p1.x) / 2;
      handles.push({ ptIdx: 0, axis: "y", x: p0.x, y: p0.y }); // Entry handle
      if (p1.y !== null) handles.push({ ptIdx: 1, axis: "y", x: midX, y: p1.y }); // TP handle
      if (p2.y !== null) handles.push({ ptIdx: 2, axis: "y", x: midX, y: p2.y }); // SL handle
      handles.push({ ptIdx: "time", axis: "x", x: p1.x, y: p0.y }); // Width handle
    }
  } else {
    d.pts.forEach((pt, i) => {
      const p = ptXY(pt);
      if (p.x !== null && p.y !== null)
        handles.push({ ptIdx: i, axis: "xy", x: p.x, y: p.y });
    });
  }
  return handles;
}

function findHandle(mx, my, d) {
  let best = null, bestDist = HANDLE_R * 3;
  for (const h of getHandles(d)) {
    const threshold = h.ptIdx === "rot" ? HANDLE_R * 5 : HANDLE_R * 3;
    const dist = Math.hypot(mx - h.x, my - h.y);
    if (dist < threshold && dist < bestDist) { bestDist = dist; best = h; }
  }
  return best;
}

function normalizeRect(d) {
  if (d.type !== "rect" || d.pts.length < 2) return;
  const [a, b] = d.pts;
  if (a.time > b.time) { const t = a.time; a.time = b.time; b.time = t; }
  if (a.price < b.price) { const p = a.price; a.price = b.price; b.price = p; }
}

function enterEditMode(drawing) {
  editingDrawing = drawing;
  selectedDrawing = drawing;
  editHandle = null;
  editDragging = false;
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
  exitEditMode();
  drawTool = tool;
  drawPts = [];
  drawPreview = null;
  document.querySelectorAll(".draw-btn").forEach((b) => b.classList.remove("active"));
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

function needsTwo(t)   { return ["trendline","ray","rect","fib"].includes(t); }
function needsThree(t) { return t === "channel"; }

// Snap pixel position to nearest 45° angle from anchor (p0x,p0y)
function _constrainAngle45(p0x, p0y, px, py) {
  const dx = px - p0x, dy = py - p0y;
  const angle   = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const dist    = Math.hypot(dx, dy);
  return { x: p0x + dist * Math.cos(snapped), y: p0y + dist * Math.sin(snapped) };
}

// ── MOUSE EVENTS ──────────────────────────────────────────
function onCursorContainerClick(e) {
  if (editingDrawing) return;
  if (drawTool !== "cursor" || !drawings.length) return;
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let found = null;
  for (const d of drawings) if (isNearDrawing(d, mx, my)) { found = d; break; }
  if (found !== selectedDrawing) { selectedDrawing = found; drawRedraw(); }
}

function onCursorContainerDblClick(e) {
  if (drawTool !== "cursor" || !drawings.length) return;
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let found = null;
  for (const d of drawings) if (isNearDrawing(d, mx, my)) { found = d; break; }
  if (!found) return;
  enterEditMode(found);
  showDrawCtxMenu(e.clientX, e.clientY, found);
}

function showDrawCtxMenu(cx, cy, drawing) {
  const menu = document.getElementById("draw-ctx-menu");
  if (!menu) return;
  const colors = ["#3B82F6","#00C46E","#F59E0B","#F2364A","#A855F7","#ffffff","#00D4FF","#FF8C00"];
  const activeColor = drawing.color || "#3B82F6";
  const isPos = drawing.type === "pos_long" || drawing.type === "pos_short";

  menu.innerHTML = `
    <div class="ctx-section-label">Mode édition</div>
    <div class="ctx-hint">Glissez les ◯ pour modifier</div>
    ${isPos ? `
    <div class="ctx-sep"></div>
    <button onclick="executeTradeFromDrawing(editingDrawing || selectedDrawing)" style="background:var(--primary);color:#fff;font-weight:600;margin-bottom:4px;">
      ⚡ Exécuter cet Ordre
    </button>
    ` : ""}
    <div class="ctx-sep"></div>
    <div class="ctx-section-label">Couleur</div>
    <div class="ctx-colors">
      ${colors.map(c => `<div class="ctx-color-dot${c === activeColor ? " active" : ""}" style="background:${c}" onclick="window._ctxColorDrawing('${c}')"></div>`).join("")}
    </div>
    <div class="ctx-sep"></div>
    <button onclick="window._ctxDeleteDrawing()" class="ctx-danger">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      Supprimer
    </button>
    <button onclick="exitEditMode()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      Quitter l'édition
    </button>`;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = cx + 12, top = cy + 12;
  menu.style.display = "block";
  const mw = menu.offsetWidth || 196, mh = menu.offsetHeight || 200;
  if (left + mw > vw - 8) left = cx - mw - 8;
  if (top + mh > vh - 8) top = cy - mh - 8;
  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function executeTradeFromDrawing(d) {
  if (!d || (d.type !== "pos_long" && d.type !== "pos_short")) return;
  const isLong = d.type === "pos_long";
  const entry = d.pts[0].price;
  const tp = d.pts[1].price;
  const sl = d.pts[2].price;

  const entryEl = document.getElementById("trade-entry");
  const tpEl = document.getElementById("trade-tp");
  const slEl = document.getElementById("trade-sl");

  if (entryEl) entryEl.value = entry.toFixed(5);
  if (tpEl) tpEl.value = tp.toFixed(5);
  if (slEl) slEl.value = sl.toFixed(5);

  if (typeof updateRRBadge === "function") updateRRBadge();

  if (typeof executeTrade === "function") {
    executeTrade(isLong ? "LONG" : "SHORT");
  }
  hideDrawCtxMenu();
  exitEditMode();
}

function hideDrawCtxMenu() {
  const menu = document.getElementById("draw-ctx-menu");
  if (menu) menu.style.display = "none";
}

window._ctxDeleteDrawing = function () {
  const target = editingDrawing || selectedDrawing;
  if (!target) return;
  _pushUndo();
  drawings = drawings.filter((d) => d.id !== target.id);
  selectedDrawing = null;
  exitEditMode();
  drawRedraw();
  saveDrawings();
};

window._ctxColorDrawing = function (color) {
  const target = editingDrawing || selectedDrawing;
  if (!target) return;
  target.color = color;
  drawRedraw();
  const menu = document.getElementById("draw-ctx-menu");
  if (menu && menu.style.display === "block") {
    const dots = menu.querySelectorAll(".ctx-color-dot");
    dots.forEach((dot) => {
      dot.style.borderColor = dot.style.background === color ? "#fff" : "transparent";
    });
  }
};

function copyDrawing(d) {
  if (!d) return;
  _clipboard = JSON.parse(JSON.stringify(d));
  showToast("Dessin copié", "success", 1500);
}

function pasteDrawing() {
  if (!_clipboard) { showToast("Rien à coller", "warning"); return; }
  const offset = (Math.random() - 0.5) * 100 * (activeTF || 60);
  const pasted = JSON.parse(JSON.stringify(_clipboard));
  pasted.id = _nextDrawId();
  pasted.pts = pasted.pts.map((p) => ({
    time: Math.max(0, p.time + offset),
    price: p.price,
  }));
  _pushUndo();
  drawings.push(pasted);
  saveDrawings();
  drawRedraw();
  showToast("Dessin collé", "success", 1500);
}

let _drawMouseDownPos = null;

function onDrawMouseDown(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  if (drawTool === "cursor") {
    let found = null;
    let h = null;
    if (editingDrawing) {
      h = findHandle(mx, my, editingDrawing);
      if (h || isNearDrawing(editingDrawing, mx, my)) {
        found = editingDrawing;
      }
    }
    if (!found && drawings.length) {
      for (const d of drawings) {
        if (isNearDrawing(d, mx, my)) {
          found = d;
          h = findHandle(mx, my, d);
          break;
        }
      }
    }

    if (found) {
      enterEditMode(found);
      const origPts = found.pts.map((p) => ({ ...p }));
      let origCenter = null;
      if (found.type === "channel" && origPts.length >= 2) {
        const cp0 = toXY(origPts[0].time, origPts[0].price);
        const cp1 = toXY(origPts[1].time, origPts[1].price);
        if (cp0.x !== null && cp1.x !== null)
          origCenter = { x: (cp0.x + cp1.x) / 2, y: (cp0.y + cp1.y) / 2 };
      }

      editHandle = {
        ptIdx: h ? h.ptIdx : "all",
        axis: h ? h.axis : "xy",
        startMx: mx, startMy: my,
        origPts,
        origHandlePts: origPts.map((p) => {
          const c = toXY(p.time, p.price);
          return { sx: c.x ?? 0, sy: c.y ?? 0 };
        }),
        origCenter,
      };
      editDragging = true;
      drawCanvas.style.cursor = h ? "grabbing" : "move";
      e.stopPropagation();
      return;
    } else {
      exitEditMode();
      selectedDrawing = null;
      drawRedraw();
      return;
    }
  }

  // Active drawing tool (trendline, rect, fib, ray, channel, pos_long, pos_short, etc.)
  exitEditMode();
  let pt = fromXY(mx, my);
  if (!pt.time) return;
  if (drawTool === "text") { showTextInput(mx, my, pt); return; }

  // Ctrl = snap to nearest OHLC
  const _applySnap = (p) => {
    if (_ctrlHeld) { const s = _snapToOHLC(p.time, p.price); p.time = s.time; p.price = s.price; }
    return p;
  };
  // Shift = constrain to 45° multiples from first point
  const _applyAngle = (p, pxMouse, pyMouse) => {
    if (_shiftHeld && drawPts.length >= 1) {
      const p0 = drawPts[0];
      const pp0 = toXY(p0.time, p0.price);
      if (pp0.x !== null) {
        const c = _constrainAngle45(pp0.x, pp0.y, pxMouse, pyMouse);
        const r = fromXY(c.x, c.y);
        if (r.time) { p.time = r.time; p.price = r.price; }
      }
    }
    return p;
  };

  if (drawTool === "pos_long" || drawTool === "pos_short") {
    const isLong = drawTool === "pos_long";
    const entryPrice = pt.price;
    const entryTime = pt.time;
    const tfSpan = (activeTF || 60) * 35;
    const tpPrice = isLong ? entryPrice * 1.02 : entryPrice * 0.98;
    const slPrice = isLong ? entryPrice * 0.99 : entryPrice * 1.01;
    _pushUndo();
    const newPosDraw = {
      type: drawTool,
      pts: [
        { time: entryTime, price: entryPrice },
        { time: entryTime + tfSpan, price: tpPrice },
        { time: entryTime + tfSpan, price: slPrice }
      ],
      id: _nextDrawId(),
      color: isLong ? "#00D26A" : "#FF3B5C"
    };
    drawings.push(newPosDraw);
    drawPts = []; drawPreview = null; _drawMouseDownPos = null;
    drawRedraw(); saveDrawings();
    setDrawTool("cursor");
    enterEditMode(newPosDraw);
    showToast(`Outil ${isLong ? "Long" : "Short"} placé — ajustez les poignées`, "info", 2500);
    return;
  }

  if (needsTwo(drawTool)) {
    if (drawPts.length === 0) {
      drawPts.push(_applySnap(pt));
      _drawMouseDownPos = { x: mx, y: my };
    } else {
      pt = _applySnap(_applyAngle(pt, mx, my));
      _pushUndo();
      drawings.push({ type: drawTool, pts: [drawPts[0], pt], id: _nextDrawId(), color: DRAW_COLORS.default });
      drawPts = []; drawPreview = null; _drawMouseDownPos = null;
      drawRedraw(); saveDrawings(); setDrawTool("cursor");
    }
  } else if (needsThree(drawTool)) {
    if (drawPts.length === 0) {
      drawPts.push(_applySnap(pt));
      _drawMouseDownPos = { x: mx, y: my };
    } else if (drawPts.length === 1) {
      drawPts.push(_applySnap(_applyAngle(pt, mx, my)));
      _drawMouseDownPos = { x: mx, y: my };
    } else {
      pt = _applySnap(pt);
      _pushUndo();
      drawings.push({ type: drawTool, pts: [drawPts[0], drawPts[1], pt], id: _nextDrawId(), color: DRAW_COLORS.default });
      drawPts = []; drawPreview = null; _drawMouseDownPos = null;
      drawRedraw(); saveDrawings(); setDrawTool("cursor");
    }
  } else {
    drawPts = [];
    _pushUndo();
    drawings.push({ type: drawTool, pts: [_applySnap(pt)], id: _nextDrawId(), color: DRAW_COLORS.default });
    drawRedraw(); saveDrawings(); setDrawTool("cursor");
  }
}

// ── CHANNEL DRAG (dedicated, bypasses the general reset-based system) ──────
function _dragChannel(mx, my) {
  const h   = editHandle;
  const pid = h.ptIdx;
  const pts = editingDrawing.pts;

  // Write new pixel position AND time/price into a single pt
  const _put = (i, nx, ny) => {
    if (!pts[i]) return;
    const r = fromXY(nx, ny);
    if (r.time) { pts[i].time = r.time; pts[i].price = r.price; }
    pts[i]._x = nx; pts[i]._y = ny;
  };

  if (pid === "all") {
    const dx = mx - h.startMx, dy = my - h.startMy;
    h.origHandlePts.forEach((op, i) => _put(i, op.sx + dx, op.sy + dy));

  } else if (typeof pid === "number") {
    // Corner — delta from mousedown position
    const op = h.origHandlePts[pid];
    _put(pid, op.sx + (mx - h.startMx), op.sy + (my - h.startMy));

  } else if (pid === "w") {
    // Width: project mouse directly onto the perpendicular of the original P0-P1
    const b0 = h.origHandlePts[0], b1 = h.origHandlePts[1];
    const ddx = b1.sx - b0.sx, ddy = b1.sy - b0.sy;
    const ll  = Math.hypot(ddx, ddy) || 1;
    const nnx = -ddy / ll, nny = ddx / ll;
    const dist = (mx - b0.sx) * nnx + (my - b0.sy) * nny;
    _put(2, b0.sx + dist * nnx, b0.sy + dist * nny);

  } else if (pid === "rot" && h.origCenter) {
    // Rotation: pivot all pts around the original rectangle center
    const cen        = h.origCenter;
    const origAngle  = Math.atan2(h.startMy - cen.y, h.startMx - cen.x);
    const delta      = Math.atan2(my - cen.y, mx - cen.x) - origAngle;
    const cos = Math.cos(delta), sin = Math.sin(delta);
    h.origHandlePts.forEach((op, i) => {
      _put(i,
        cen.x + (op.sx - cen.x) * cos - (op.sy - cen.y) * sin,
        cen.y + (op.sx - cen.x) * sin + (op.sy - cen.y) * cos,
      );
    });
  }

  drawRedraw();
}

function onDrawMouseMove(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;

  // Channel has its own drag system — bypass the general reset-based flow
  if (editingDrawing && editDragging && editHandle && editingDrawing.type === "channel") {
    _dragChannel(mx, my);
    return;
  }

  if (editingDrawing && editDragging && editHandle) {
    const h = editHandle;
    const dPx = mx - h.startMx;
    const dPy = my - h.startMy;

    const pixelToTime = (origSx, dpx) => {
      // fromXY extrapolates beyond the last candle via _visibleBarPair;
      // coordinateToTime() returns null past the data edge causing the handle to snap back.
      return fromXY(origSx + dpx, 0).time ?? null;
    };
    const pixelToPrice = (origSy, dpy) => {
      if (!mainSeries) return null;
      return mainSeries.coordinateToPrice(origSy + dpy);
    };

    if (h.ptIdx === "all") {
      h.origPts.forEach((_op, i) => {
        const ox = h.origHandlePts[i].sx, oy = h.origHandlePts[i].sy;
        const t = pixelToTime(ox, dPx);
        const p = pixelToPrice(oy, dPy);
        if (t !== null) editingDrawing.pts[i].time  = t;
        if (p !== null) editingDrawing.pts[i].price = p;
        editingDrawing.pts[i]._x = ox + dPx;
        editingDrawing.pts[i]._y = oy + dPy;
      });
    } else {
      h.origPts.forEach((op, i) => {
        editingDrawing.pts[i].time  = op.time;
        editingDrawing.pts[i].price = op.price;
        delete editingDrawing.pts[i]._x;
        delete editingDrawing.pts[i]._y;
      });

      const applyX = (ptIdx) => {
        const t = pixelToTime(h.origHandlePts[ptIdx].sx, dPx);
        if (t !== null) editingDrawing.pts[ptIdx].time = t;
      };
      const applyY = (ptIdx) => {
        const p = pixelToPrice(h.origHandlePts[ptIdx].sy, dPy);
        if (p !== null) editingDrawing.pts[ptIdx].price = p;
      };
      const setPixel = (ptIdx, moveX, moveY) => {
        editingDrawing.pts[ptIdx]._x = h.origHandlePts[ptIdx].sx + (moveX ? dPx : 0);
        editingDrawing.pts[ptIdx]._y = h.origHandlePts[ptIdx].sy + (moveY ? dPy : 0);
      };

      const pid = h.ptIdx;
      const ax  = h.axis;

      if (pid === "tr") {
        applyX(1); applyY(0);
        setPixel(1, true, false); setPixel(0, false, true);
      } else if (pid === "bl") {
        applyX(0); applyY(1);
        setPixel(0, true, false); setPixel(1, false, true);
      } else if (pid === "mt") {
        applyY(0); setPixel(0, false, true);
      } else if (pid === "mb") {
        applyY(1); setPixel(1, false, true);
      } else if (pid === "ml") {
        applyX(0); setPixel(0, true, false);
      } else if (pid === "mr") {
        applyX(1); setPixel(1, true, false);
      } else if (pid === "time") {
        applyX(1); applyX(2);
        setPixel(1, true, false); setPixel(2, true, false);
      } else if (typeof pid === "number") {
        if (ax === "y" || ax === "xy") applyY(pid);
        if (ax === "x" || ax === "xy") applyX(pid);
        setPixel(pid, ax === "x" || ax === "xy", ax === "y" || ax === "xy");
      }
    }

    drawRedraw();
    return;
  }

  if (editingDrawing) {
    const h = findHandle(mx, my, editingDrawing);
    drawCanvas.style.cursor = h
      ? "grab"
      : isNearDrawing(editingDrawing, mx, my)
        ? "move"
        : "default";
    return;
  }

  if (drawTool === "cursor" && !editDragging) {
    let near = false;
    for (const d of drawings) {
      if (isNearDrawing(d, mx, my)) { near = true; break; }
    }
    drawCanvas.style.cursor = near ? "move" : "default";
    return;
  }

  if (!drawPts.length) return;
  let preview = fromXY(mx, my);
  let px = mx, py = my;

  // Shift: constrain angle to 45° multiples from first anchor
  if (_shiftHeld && drawPts.length >= 1) {
    const p0  = drawPts[0];
    const pp0 = toXY(p0.time, p0.price);
    if (pp0.x !== null) {
      const c = _constrainAngle45(pp0.x, pp0.y, mx, my);
      px = c.x; py = c.y;
      const r = fromXY(px, py);
      if (r.time) { preview.time = r.time; preview.price = r.price; }
    }
  }

  // Ctrl: snap to nearest OHLC
  if (_ctrlHeld && preview.time) {
    const s = _snapToOHLC(preview.time, preview.price);
    preview = { time: s.time, price: s.price };
    // No _x/_y — let toXY render snapped position
  } else {
    preview._x = px;
    preview._y = py;
  }

  drawPreview = preview;
  drawRedraw();
}

function onDrawMouseUp(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const mx = e ? e.clientX - rect.left : 0;
  const my = e ? e.clientY - rect.top : 0;

  if (editDragging) {
    if (editingDrawing && editingDrawing.type === "rect") normalizeRect(editingDrawing);
    if (editingDrawing)
      editingDrawing.pts.forEach(p => { delete p._x; delete p._y; });
    editDragging = false;
    editHandle = null;
    drawCanvas.style.cursor = editingDrawing ? "default" : "";
    saveDrawings();
    drawRedraw();
    return;
  }

  // Handle Drag-to-Draw Release (e.g. click-drag-release to draw trendline or rectangle)
  if (drawTool !== "cursor" && needsTwo(drawTool) && drawPts.length === 1 && _drawMouseDownPos) {
    const dist = Math.hypot(mx - _drawMouseDownPos.x, my - _drawMouseDownPos.y);
    if (dist > 15) {
      let pt = fromXY(mx, my);
      if (pt.time) {
        if (_ctrlHeld) { const s = _snapToOHLC(pt.time, pt.price); pt.time = s.time; pt.price = s.price; }
        _pushUndo();
        drawings.push({ type: drawTool, pts: [drawPts[0], pt], id: _nextDrawId(), color: DRAW_COLORS.default });
        drawPts = []; drawPreview = null; _drawMouseDownPos = null;
        drawRedraw(); saveDrawings(); setDrawTool("cursor");
      }
    }
  }
}

// ── HIT TESTING ───────────────────────────────────────────
function isNearDrawing(d, mx, my) {
  const T = 10;
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
    const dx = b.x - a.x, dy = b.y - a.y;
    const mag = Math.hypot(dx, dy) || 1;
    const bFar = { x: a.x + (dx / mag) * 8000, y: a.y + (dy / mag) * 8000 };
    return distToSeg(mx, my, a.x, a.y, bFar.x, bFar.y) < T;
  }
  if (d.type === "rect" && d.pts.length >= 2) {
    const p0 = toXY(d.pts[0].time, d.pts[0].price);
    const p1 = toXY(d.pts[1].time, d.pts[1].price);
    if (p0.x === null || p1.x === null) return false;
    const x0 = Math.min(p0.x, p1.x), x1 = Math.max(p0.x, p1.x);
    const y0 = Math.min(p0.y, p1.y), y1 = Math.max(p0.y, p1.y);
    const inX = mx >= x0 - T && mx <= x1 + T;
    const inY = my >= y0 - T && my <= y1 + T;
    const nearEdge =
      (Math.abs(mx - x0) < T && inY) || (Math.abs(mx - x1) < T && inY) ||
      (Math.abs(my - y0) < T && inX) || (Math.abs(my - y1) < T && inX);
    const inside = mx > x0 && mx < x1 && my > y0 && my < y1;
    return nearEdge || inside;
  }
  if ((d.type === "pos_long" || d.type === "pos_short") && d.pts.length >= 3) {
    const p0 = toXY(d.pts[0].time, d.pts[0].price);
    const p1 = toXY(d.pts[1].time, d.pts[1].price);
    const p2 = toXY(d.pts[2].time, d.pts[2].price);
    if (p0.x === null || p1.x === null || p2.y === null || p1.y === null || p0.y === null) return false;
    const minX = Math.min(p0.x, p1.x) - T, maxX = Math.max(p0.x, p1.x) + T;
    const minY = Math.min(p0.y, p1.y, p2.y) - T, maxY = Math.max(p0.y, p1.y, p2.y) + T;
    return mx >= minX && mx <= maxX && my >= minY && my <= maxY;
  }
  if (d.type === "fib" && d.pts.length >= 2) {
    const p0 = toXY(d.pts[0].time, d.pts[0].price);
    const p1 = toXY(d.pts[1].time, d.pts[1].price);
    if (p0.x === null || p1.x === null) return false;
    const xMin = Math.min(p0.x, p1.x) - T, xMax = Math.max(p0.x, p1.x) + T;
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
    return Math.abs(mx - p.x) < 60 && Math.abs(my - p.y) < 16;
  }
  if (d.type === "channel" && d.pts.length >= 2) {
    const cp0 = toXY(d.pts[0].time, d.pts[0].price);
    const cp1 = toXY(d.pts[1].time, d.pts[1].price);
    if (cp0.x === null || cp1.x === null) return false;
    // Near the main axis line
    if (distToSeg(mx, my, cp0.x, cp0.y, cp1.x, cp1.y) < T) return true;
    if (d.pts[2]) {
      const cp2 = toXY(d.pts[2].time, d.pts[2].price);
      if (cp2.x !== null) {
        const dxM = cp1.x - cp0.x, dyM = cp1.y - cp0.y;
        const lenM = Math.hypot(dxM, dyM) || 1;
        const nxM = -dyM / lenM, nyM = dxM / lenM;
        const dist = (cp2.x - cp0.x) * nxM + (cp2.y - cp0.y) * nyM;
        // Near the parallel line or inside the channel
        const c2 = { x: cp0.x + dist*nxM, y: cp0.y + dist*nyM };
        const c3 = { x: cp1.x + dist*nxM, y: cp1.y + dist*nyM };
        if (distToSeg(mx, my, c2.x, c2.y, c3.x, c3.y) < T) return true;
        // Inside the parallelogram (cross-product sign test)
        const side = (mx - cp0.x) * nxM + (my - cp0.y) * nyM;
        return side >= 0 && side <= Math.abs(dist) &&
               distToSeg(mx, my, cp0.x, cp0.y, cp1.x, cp1.y) < Math.abs(dist);
      }
    }
    return false;
  }
  return false;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function deleteSelectedDrawing() {
  if (!selectedDrawing) return;
  _pushUndo();
  drawings = drawings.filter((d) => d.id !== selectedDrawing.id);
  selectedDrawing = null;
  drawRedraw();
  saveDrawings();
}

function clearAllDrawings() {
  if (drawings.length) _pushUndo();
  drawings = [];
  selectedDrawing = null;
  drawPts = [];
  drawPreview = null;
  drawRedraw();
  saveDrawings();
}

// ── DRAW REDRAW (with Viewport Culling Optimization) ──────
function drawRedraw() {
  if (!drawCtx) return;
  const W = drawCanvas.width / (window.devicePixelRatio || 1);
  const H = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.clearRect(0, 0, W, H);
  drawForexSessions(W, H);   // ① zones forex (fond, derrière tout)
  drawSeparators(W, H);      // ② séparateurs de session

  const ts = chart ? chart.timeScale() : null;

  drawings.forEach((d) => {
    // Spatial Culling: Skip drawings entirely off-screen
    if (d.type !== "hline" && d.type !== "ray" && d.pts && d.pts.length && ts) {
      let isVisible = false;
      for (const pt of d.pts) {
        const cx = ts.timeToCoordinate(pt.time);
        if (cx !== null && cx >= -150 && cx <= W + 150) {
          isVisible = true;
          break;
        }
      }
      if (!isVisible && d.pts.length >= 2) {
        const c0 = ts.timeToCoordinate(d.pts[0].time);
        const c1 = ts.timeToCoordinate(d.pts[1].time);
        if (c0 !== null && c1 !== null && Math.min(c0, c1) <= W && Math.max(c0, c1) >= 0) {
          isVisible = true;
        }
      }
      // If still not visible and not selected/editing, skip rendering
      if (!isVisible && d !== selectedDrawing && d !== editingDrawing) return;
    }

    drawShape(d, d === selectedDrawing, W, H);
  });

  if (drawPts.length && drawPreview) {
    if (needsThree(drawTool) && drawPts.length === 2) {
      // 3rd point preview (channel width)
      drawShape({ type: drawTool, pts: [drawPts[0], drawPts[1], drawPreview] }, false, W, H, true);
    } else {
      drawShape({ type: drawTool, pts: [drawPts[0], drawPreview] }, false, W, H, true);
    }
  }
}

function drawAngleDistance(p0, p1, color) {
  if (!p0 || !p1 || p0.x === null || p1.x === null) return;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const dist = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const midX = (p0.x + p1.x) / 2, midY = (p0.y + p1.y) / 2;
  drawCtx.save();
  drawCtx.font = "10px JetBrains Mono";
  drawCtx.fillStyle = color;
  drawCtx.globalAlpha = 0.8;
  const text = `${dist.toFixed(0)}px · ${angle.toFixed(1)}°`;
  const metrics = drawCtx.measureText(text);
  const labelW = metrics.width + 6;
  drawCtx.fillRect(midX - labelW / 2, midY - 12, labelW, 14);
  drawCtx.globalAlpha = 1;
  drawCtx.fillStyle = "#1a1f2e";
  drawCtx.fillText(text, midX - labelW / 2 + 3, midY - 2);
  drawCtx.restore();
}

function drawShape(d, selected, W, H, preview) {
  drawCtx.save();
  const isEditing = d === editingDrawing;
  const baseColor = isEditing ? "#60A5FA" : selected ? DRAW_COLORS.sel : d.color || DRAW_COLORS.default;
  drawCtx.strokeStyle = baseColor;
  drawCtx.lineWidth = preview ? 1.5 : isEditing ? 2 : selected ? 2.5 : 1.5;
  drawCtx.setLineDash(preview ? [6, 4] : []);

  const _pt2xy = (pt) => pt._x !== undefined ? { x: pt._x, y: pt._y } : toXY(pt.time, pt.price);
  const p0 = d.pts[0] ? _pt2xy(d.pts[0]) : null;
  const p1 = d.pts[1] ? _pt2xy(d.pts[1]) : null;

  if (d.type === "hline") {
    const yy = mainSeries ? mainSeries.priceToCoordinate(d.pts[0].price) : null;
    if (yy === null) { drawCtx.restore(); return; }
    drawCtx.beginPath();
    drawCtx.moveTo(0, yy);
    drawCtx.lineTo(W, yy);
    drawCtx.stroke();
    drawLabel(fmt(d.pts[0].price), W - 4, yy, baseColor, "right");
  } else if (d.type === "vline") {
    if (!validCoord(p0)) { drawCtx.restore(); return; }
    drawCtx.beginPath();
    drawCtx.moveTo(p0.x, 0);
    drawCtx.lineTo(p0.x, H);
    drawCtx.stroke();
  } else if (d.type === "trendline") {
    if (!validCoord(p0) || !validCoord(p1)) { drawCtx.restore(); return; }
    drawCtx.beginPath();
    drawCtx.moveTo(p0.x, p0.y);
    drawCtx.lineTo(p1.x, p1.y);
    drawCtx.stroke();
    if (!isEditing) { drawDot(p0.x, p0.y, baseColor); drawDot(p1.x, p1.y, baseColor); }
    if (preview) drawAngleDistance(p0, p1, baseColor);
  } else if (d.type === "ray") {
    if (!validCoord(p0) || !validCoord(p1)) { drawCtx.restore(); return; }
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.max(W, H) * 4, mag = Math.hypot(dx, dy) || 1;
    drawCtx.beginPath();
    drawCtx.moveTo(p0.x, p0.y);
    drawCtx.lineTo(p0.x + (dx / mag) * len, p0.y + (dy / mag) * len);
    drawCtx.stroke();
    if (!isEditing) drawDot(p0.x, p0.y, baseColor);
    if (preview) drawAngleDistance(p0, p1, baseColor);
  } else if (d.type === "rect") {
    if (!validCoord(p0) || !validCoord(p1)) { drawCtx.restore(); return; }
    drawCtx.fillStyle = d.fillColor || DRAW_COLORS.rect;
    drawCtx.beginPath();
    drawCtx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    drawCtx.fill();
    drawCtx.stroke();
    if (preview) drawAngleDistance(p0, p1, baseColor);
  } else if (d.type === "fib") {
    if (!validCoord(p0) || !validCoord(p1)) { drawCtx.restore(); return; }
    drawCtx.strokeStyle = d.color || DRAW_COLORS.fib;
    const priceDiff = d.pts[1].price - d.pts[0].price;
    const xMin = Math.min(p0.x, p1.x), xMax = Math.max(p0.x, p1.x);
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
      drawLabel(`${(level * 100).toFixed(1)}%  ${fmt(price)}`, xMax + 4, yy, d.color || DRAW_COLORS.fib, "left");
    });
  } else if (d.type === "text" && p0 && d.text) {
    if (!validCoord(p0)) { drawCtx.restore(); return; }
    drawCtx.font = `${d.fontSize || 12}px JetBrains Mono, monospace`;
    drawCtx.fillStyle = baseColor;
    drawCtx.fillText(d.text, p0.x, p0.y);

  } else if (d.type === "channel") {
    if (!validCoord(p0) || !validCoord(p1)) { drawCtx.restore(); return; }

    // The 3rd point defines the perpendicular width of the channel
    const p2raw = d.pts[2] ? _pt2xy(d.pts[2]) : null;

    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len; // unit normal (perpendicular)

    if (!validCoord(p2raw)) {
      // Only 2 pts set (mid-drawing) — show the main line
      drawCtx.beginPath();
      drawCtx.moveTo(p0.x, p0.y);
      drawCtx.lineTo(p1.x, p1.y);
      drawCtx.stroke();
      if (!isEditing) {
        drawDot(p0.x, p0.y, baseColor);
        drawDot(p1.x, p1.y, baseColor);
      }
    } else {
      // Project p2 onto the normal to get signed channel width
      const dist = (p2raw.x - p0.x) * nx + (p2raw.y - p0.y) * ny;

      const c0 = { x: p0.x,            y: p0.y            };
      const c1 = { x: p1.x,            y: p1.y            };
      const c2 = { x: p1.x + dist*nx,  y: p1.y + dist*ny  };
      const c3 = { x: p0.x + dist*nx,  y: p0.y + dist*ny  };

      // During edit: ultra-transparent fill so candles stay readable
      const fillAlpha = isEditing ? "0.03" : (preview ? "0.05" : "0.08");
      drawCtx.fillStyle = d.fillColor ||
        (baseColor === DRAW_COLORS.default
          ? `rgba(59,130,246,${fillAlpha})`
          : baseColor.replace(/[\d.]+\)$/, `${fillAlpha})`));

      drawCtx.beginPath();
      drawCtx.moveTo(c0.x, c0.y);
      drawCtx.lineTo(c1.x, c1.y);
      drawCtx.lineTo(c2.x, c2.y);
      drawCtx.lineTo(c3.x, c3.y);
      drawCtx.closePath();
      drawCtx.fill();

      // Border — slightly more transparent during edit too
      drawCtx.globalAlpha = isEditing ? 0.55 : 1;
      drawCtx.beginPath();
      drawCtx.moveTo(c0.x, c0.y);
      drawCtx.lineTo(c1.x, c1.y);
      drawCtx.lineTo(c2.x, c2.y);
      drawCtx.lineTo(c3.x, c3.y);
      drawCtx.closePath();
      drawCtx.stroke();
      drawCtx.globalAlpha = 1;

      // Middle axis line (dashed, subtle)
      drawCtx.save();
      drawCtx.setLineDash([5, 4]);
      drawCtx.globalAlpha = isEditing ? 0.25 : 0.35;
      drawCtx.beginPath();
      drawCtx.moveTo((c0.x+c3.x)/2, (c0.y+c3.y)/2);
      drawCtx.lineTo((c1.x+c2.x)/2, (c1.y+c2.y)/2);
      drawCtx.stroke();
      drawCtx.restore();
    }
    if (preview) drawAngleDistance(p0, p1, baseColor);

  } else if ((d.type === "pos_long" || d.type === "pos_short") && p0 && p1) {
    if (!validCoord(p0) || !validCoord(p1)) { drawCtx.restore(); return; }
    const p2 = d.pts[2] ? _pt2xy(d.pts[2]) : null;
    if (!validCoord(p2)) { drawCtx.restore(); return; }

    const isLong = d.type === "pos_long";
    const entryPrice = d.pts[0].price;
    const tpPrice = d.pts[1].price;
    const slPrice = d.pts[2].price;

    const leftX = p0.x;
    const rightX = p1.x;
    const width = Math.max(30, rightX - leftX);

    const entryY = p0.y;
    const tpY = p1.y;
    const slY = p2.y;

    const profitDist = Math.abs(tpPrice - entryPrice);
    const lossDist = Math.abs(entryPrice - slPrice);
    const rr = lossDist > 0 ? (profitDist / lossDist).toFixed(2) : "—";
    const profitPct = ((profitDist / entryPrice) * 100).toFixed(2);
    const lossPct = ((lossDist / entryPrice) * 100).toFixed(2);

    const currentBal = (typeof tradeSim !== "undefined" && tradeSim.balance) ? tradeSim.balance : 10000;
    const riskDollar = currentBal * 0.02;
    const profitDollar = lossDist > 0 ? riskDollar * (profitDist / lossDist) : 0;

    // 1. Profit (TP) Box - Green
    const tpBoxTop = Math.min(entryY, tpY);
    const tpBoxH = Math.abs(entryY - tpY);
    drawCtx.fillStyle = "rgba(0, 210, 106, 0.18)";
    drawCtx.strokeStyle = "#00D26A";
    drawCtx.lineWidth = 1;
    drawCtx.beginPath();
    drawCtx.rect(leftX, tpBoxTop, width, tpBoxH);
    drawCtx.fill();
    drawCtx.stroke();

    // 2. Loss (SL) Box - Red
    const slBoxTop = Math.min(entryY, slY);
    const slBoxH = Math.abs(entryY - slY);
    drawCtx.fillStyle = "rgba(255, 59, 92, 0.18)";
    drawCtx.strokeStyle = "#FF3B5C";
    drawCtx.lineWidth = 1;
    drawCtx.beginPath();
    drawCtx.rect(leftX, slBoxTop, width, slBoxH);
    drawCtx.fill();
    drawCtx.stroke();

    // 3. Middle Entry Line
    drawCtx.strokeStyle = isLong ? "#60A5FA" : "#F59E0B";
    drawCtx.lineWidth = 1.8;
    drawCtx.beginPath();
    drawCtx.moveTo(leftX, entryY);
    drawCtx.lineTo(rightX, entryY);
    drawCtx.stroke();

    // 4. Labels inside boxes
    drawCtx.font = "bold 10px 'JetBrains Mono', monospace";

    // TP Label
    drawCtx.fillStyle = "#00D26A";
    const tpText = `TP: +${fmt(profitDist)} (+${profitPct}%)  R:R: 1:${rr}  (+$${profitDollar.toFixed(0)})`;
    drawCtx.fillText(tpText, leftX + 6, tpBoxTop + 13);

    // SL Label
    drawCtx.fillStyle = "#FF3B5C";
    const slText = `SL: -${fmt(lossDist)} (-${lossPct}%)  (-$${riskDollar.toFixed(0)})`;
    drawCtx.fillText(slText, leftX + 6, slBoxTop + slBoxH - 5);

    // Entry label
    drawCtx.fillStyle = "#E2E8F0";
    drawCtx.font = "10px 'JetBrains Mono', monospace";
    drawCtx.fillText(`Entrée: ${fmt(entryPrice)}`, leftX + 6, isLong ? entryY + 12 : entryY - 4);

    // Quick trade action badge
    if (isEditing || selected) {
      const badgeW = 110;
      const badgeH = 20;
      const bx = rightX - badgeW - 4;
      const by = entryY - badgeH / 2;
      drawCtx.fillStyle = "#1E293B";
      drawCtx.strokeStyle = "#4F46E5";
      drawCtx.lineWidth = 1;
      drawCtx.beginPath();
      drawCtx.roundRect(bx, by, badgeW, badgeH, 4);
      drawCtx.fill();
      drawCtx.stroke();

      drawCtx.fillStyle = "#818CF8";
      drawCtx.font = "600 10px 'Inter', sans-serif";
      drawCtx.fillText("⚡ Placer Ordre", bx + 12, by + 14);
    }
  }

  // EDIT HANDLES
  if (isEditing && !preview) {
    drawCtx.setLineDash([]);
    getHandles(d).forEach((h) => {
      drawCtx.save();

      if (h.ptIdx === "rot") {
        // ── Rotation handle: gold ring + arc arrow ──
        const R = HANDLE_R + 2;
        drawCtx.beginPath();
        drawCtx.arc(h.x, h.y, R, 0, Math.PI * 2);
        drawCtx.fillStyle = "rgba(13,17,23,0.9)";
        drawCtx.strokeStyle = "#F59E0B";
        drawCtx.lineWidth = 1.5;
        drawCtx.fill();
        drawCtx.stroke();
        // Small rotation arc arrow inside
        drawCtx.strokeStyle = "#F59E0B";
        drawCtx.lineWidth = 1.5;
        drawCtx.beginPath();
        drawCtx.arc(h.x, h.y, R - 3, 0.4, Math.PI * 1.7);
        drawCtx.stroke();
        // Arrow head at end of arc
        const aEnd = Math.PI * 1.7;
        const ax2 = h.x + (R-3) * Math.cos(aEnd), ay2 = h.y + (R-3) * Math.sin(aEnd);
        drawCtx.beginPath();
        drawCtx.moveTo(ax2, ay2 - 3);
        drawCtx.lineTo(ax2 + 3, ay2);
        drawCtx.lineTo(ax2 - 2, ay2 + 2);
        drawCtx.stroke();

      } else if (h.ptIdx === "w") {
        // ── Width handle: diamond shape ──
        const R = HANDLE_R;
        drawCtx.beginPath();
        drawCtx.moveTo(h.x,     h.y - R);
        drawCtx.lineTo(h.x + R, h.y    );
        drawCtx.lineTo(h.x,     h.y + R);
        drawCtx.lineTo(h.x - R, h.y    );
        drawCtx.closePath();
        drawCtx.fillStyle = "#0D1117";
        drawCtx.strokeStyle = "#00D26A";
        drawCtx.lineWidth = 1.5;
        drawCtx.fill();
        drawCtx.stroke();

      } else {
        // ── Standard handle: circle ──
        drawCtx.beginPath();
        drawCtx.arc(h.x, h.y, HANDLE_R, 0, Math.PI * 2);
        drawCtx.fillStyle = "#0D1117";
        drawCtx.strokeStyle = "#3B82F6";
        drawCtx.lineWidth = 1.5;
        drawCtx.fill();
        drawCtx.stroke();
      }

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
      if (txt) {
        _pushUndo();
        drawings.push({ type: "text", pts: [pt], text: txt, id: _nextDrawId(), color: DRAW_COLORS.default });
        saveDrawings();
      }
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

// ── SESSION SEPARATORS ────────────────────────────────────
function _fmtSepLabel(bucket, tfType) {
  const d = new Date(bucket * 1000);
  if (tfType === "year") return String(d.getUTCFullYear());
  if (tfType === "quarter") {
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `T${q} '${String(d.getUTCFullYear()).slice(2)}`;
  }
  if (tfType === "month") {
    return d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  if (tfType === "week") {
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
    return `S${week}`;
  }
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

// ── FOREX SESSIONS ────────────────────────────────────────
function _inForexSession(utcHour, utcMin, startH, endH) {
  // Offset applied only to session boundaries, NOT to the candle hour.
  // Effect: zone shifts on the UTC axis when checkbox is ticked.
  //   offset=0  → NY zone starts at 13h UTC (matches UTC data)
  //   offset=+2 → NY zone starts at 15h UTC (matches local clock on UTC chart)
  const s = (((startH + _forexTzOffset) % 24 + 24) % 24) * 60;
  const e = (((endH   + _forexTzOffset) % 24 + 24) % 24) * 60;
  const m = utcHour * 60 + utcMin;
  return s < e ? (m >= s && m < e) : (m >= s || m < e);
}

const _BROWSER_TZ_OFFSET = -(new Date().getTimezoneOffset()) / 60; // e.g. +2 for UTC+2

function toggleForexLocalTz() {
  const cb = document.getElementById("forex-local-tz");
  if (!cb) return;

  _forexTzOffset = cb.checked ? _BROWSER_TZ_OFFSET : 0;

  const info = document.getElementById("forex-tz-info");
  if (info) {
    info.textContent = cb.checked
      ? `Fuseau local : UTC${_BROWSER_TZ_OFFSET >= 0 ? "+" : ""}${_BROWSER_TZ_OFFSET}`
      : "Données en UTC (défaut)";
  }
  drawRedraw();
}

function _initForexTzSelect() {
  // Nothing to pre-select — default is UTC (offset 0, checkbox unchecked)
}

function toggleForexSession(key) {
  if (key === "all") {
    const anyOn = Object.values(FOREX_SESSIONS).some(s => s.enabled);
    Object.keys(FOREX_SESSIONS).forEach(k => { FOREX_SESSIONS[k].enabled = !anyOn; });
    Object.keys(FOREX_SESSIONS).forEach(k => {
      const el = document.getElementById("forex-" + k);
      if (el) el.checked = FOREX_SESSIONS[k].enabled;
    });
  } else {
    FOREX_SESSIONS[key].enabled = !FOREX_SESSIONS[key].enabled;
    const el = document.getElementById("forex-" + key);
    if (el) el.checked = FOREX_SESSIONS[key].enabled;
  }

  const anyEnabled = Object.values(FOREX_SESSIONS).some(s => s.enabled);
  document.getElementById("btn-forex")?.classList.toggle("active", anyEnabled);
  drawRedraw();
}

function drawForexSessions(W, H) {
  if (!sortedTimes.length || !chart || activeTF > 14400) return;

  const active = Object.values(FOREX_SESSIONS).filter(s => s.enabled);
  if (!active.length) return;

  const ts = chart.timeScale();
  const vr = ts.getVisibleRange();
  if (!vr) return;

  // Find visible index range with 1-bar margin on each side
  let lo = 0, hi = sortedTimes.length - 1;
  while (lo < hi - 1 && sortedTimes[lo + 1] < vr.from) lo++;
  while (hi > lo + 1 && sortedTimes[hi - 1] > vr.to)   hi--;
  const scanLo = Math.max(0, lo - 1);
  const scanHi = Math.min(sortedTimes.length - 1, hi + 1);

  active.forEach(sess => {
    const opens = []; // {x} positions where session opens (for lines + labels)
    let zoneX0 = null;

    // ── PASS 1: zones ──────────────────────────────────
    for (let i = scanLo; i <= scanHi; i++) {
      const t  = sortedTimes[i];
      const d  = new Date(t * 1000);
      const cur  = _inForexSession(d.getUTCHours(), d.getUTCMinutes(), sess.start, sess.end);
      const prev = i > 0
        ? (() => { const pd = new Date(sortedTimes[i - 1] * 1000);
                   return _inForexSession(pd.getUTCHours(), pd.getUTCMinutes(), sess.start, sess.end); })()
        : false;

      const x = ts.timeToCoordinate(t);

      if (cur && !prev) {
        // Session opens — mark zone start
        zoneX0 = (i < lo) ? 0 : (x ?? 0);
        if (x !== null && i >= lo) opens.push(x);
      }

      if (!cur && prev && zoneX0 !== null) {
        // Session closes — flush zone
        const x1 = x ?? W;
        if (x1 > zoneX0) {
          drawCtx.save();
          drawCtx.fillStyle = sess.zone;
          drawCtx.fillRect(zoneX0, 0, x1 - zoneX0, H);
          drawCtx.restore();
        }
        zoneX0 = null;
      }
    }
    // Flush zone still open at right edge
    if (zoneX0 !== null) {
      drawCtx.save();
      drawCtx.fillStyle = sess.zone;
      drawCtx.fillRect(zoneX0, 0, W - zoneX0, H);
      drawCtx.restore();
    }

    // ── PASS 2: opening lines + labels ─────────────────
    opens.forEach(x => {
      drawCtx.save();

      // Dashed vertical line
      drawCtx.beginPath();
      drawCtx.strokeStyle = sess.line;
      drawCtx.lineWidth    = 1;
      drawCtx.globalAlpha  = 0.55;
      drawCtx.setLineDash([4, 3]);
      drawCtx.moveTo(x, 0);
      drawCtx.lineTo(x, H);
      drawCtx.stroke();

      // Label badge at top
      drawCtx.setLineDash([]);
      drawCtx.globalAlpha = 1;
      drawCtx.font = "700 8px 'JetBrains Mono', monospace";
      const text  = sess.label.toUpperCase();
      const tw    = drawCtx.measureText(text).width;
      // Place forex labels on a second row (y≈26) so they never collide
      // with the separator date labels that sit at y≈4
      const hasSep = separatorTF !== null;
      const ly = hasSep ? 26 : 12;
      const lx = x + 4;
      // Background pill
      drawCtx.fillStyle = "rgba(6,8,16,0.82)";
      drawCtx.beginPath();
      drawCtx.roundRect?.(lx - 2, ly - 9, tw + 6, 12, 2) ??
        drawCtx.rect(lx - 2, ly - 9, tw + 6, 12);
      drawCtx.fill();
      // Text
      drawCtx.fillStyle = sess.line;
      drawCtx.fillText(text, lx + 1, ly);

      drawCtx.restore();
    });
  });
}

function getAutoSeparatorDef() {
  const tf = activeTF || baseTF || 86400;
  // TradingView standard automatic period separator hierarchy:
  // - Intraday <= 15m (60s to 900s) -> Daily separators (1D)
  // - Intraday 30m to 4h (1800s to 14400s) -> Weekly separators (1W)
  // - Daily 1D (86400s) -> Monthly separators (1M)
  // - Weekly 1W (604800s) -> Yearly separators (1Y)
  // - Monthly 1M -> Yearly separators (1Y)
  if (tf <= 900) return TF_DEFS.find(t => t.label === "1D") || { label: "1D", tfType: "day", s: 86400 };
  if (tf <= 14400) return TF_DEFS.find(t => t.label === "1W") || { label: "1W", tfType: "week", s: 604800 };
  if (tf <= 86400) return TF_DEFS.find(t => t.label === "1M") || { label: "1M", tfType: "month", s: 2592000 };
  return TF_DEFS.find(t => t.label === "1Y") || { label: "1Y", tfType: "year", s: 31536000 };
}

function drawSeparators(W, H) {
  if (!separatorTF || !sortedTimes || !sortedTimes.length || !chart) return;

  const activeSep = (separatorTF === "auto" || separatorTF === true) ? getAutoSeparatorDef() : separatorTF;
  if (!activeSep) return;

  const { label: tfLabel, tfType, s } = activeSep;
  const palette = _SEP_COLORS[tfLabel] || { line: "rgba(130,148,210,0.32)", label: "rgba(150,170,230,0.65)" };

  const ts = chart.timeScale();
  const vr = ts.getVisibleRange();
  if (!vr) return;

  // Scan only visible index range (+ 1 bar margin)
  let lo = 0, hi = sortedTimes.length - 1;
  while (lo < hi - 1 && sortedTimes[lo + 1] < vr.from) lo++;
  while (hi > lo + 1 && sortedTimes[hi - 1] > vr.to)   hi--;
  const scanLo = Math.max(0, lo - 1);
  const scanHi = Math.min(sortedTimes.length - 1, hi + 1);

  drawCtx.save();
  drawCtx.lineWidth = 1;
  drawCtx.setLineDash([4, 5]);
  drawCtx.font = "bold 9px 'JetBrains Mono', monospace";
  drawCtx.textBaseline = "top";

  let lastBucket = getCalendarBucket(sortedTimes[scanLo], tfType, s);
  for (let i = scanLo + 1; i <= scanHi; i++) {
    const bucket = getCalendarBucket(sortedTimes[i], tfType, s);
    if (bucket === lastBucket) continue;
    lastBucket = bucket;

    const x = ts.timeToCoordinate(sortedTimes[i]);
    if (x === null || x < 0 || x > W) continue;

    drawCtx.strokeStyle = palette.line;
    drawCtx.beginPath();
    drawCtx.moveTo(x, 0);
    drawCtx.lineTo(x, H);
    drawCtx.stroke();

    drawCtx.fillStyle = palette.label;
    const periodLabel = _fmtSepLabel(bucket, tfType);
    drawCtx.fillText(periodLabel, x + 3, 4);
  }

  drawCtx.restore();
}

function setSeparatorTF(tfLabel) {
  if (tfLabel === null) {
    separatorTF = null;
  } else if (tfLabel === "auto") {
    separatorTF = "auto";
  } else {
    const tfd = TF_DEFS.find(t => t.label === tfLabel);
    separatorTF = tfd || null;
  }

  const btn = document.getElementById("btn-sep");
  if (btn) btn.classList.toggle("active", separatorTF !== null);

  const menu = document.getElementById("menu-sep");
  if (menu) {
    menu.querySelectorAll(".tv-dropdown-item").forEach(item => {
      item.classList.toggle("active", item.dataset.tf === (tfLabel === null ? "null" : tfLabel));
    });
  }

  drawRedraw();
}
