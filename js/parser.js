// ========================================================
//  PARSER — CSV/JSON parsing, web worker, sample data, export
//  Depends on: config.js, ui.js, chart.js, timeframe.js
// ========================================================

// ── FILE PARSING ─────────────────────────────────────────
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

// ── LARGE FILE PARSER — Web Worker + progress bar ─────────
const _MAX_FILE_BYTES = 500 * 1024 * 1024;

function processFile(file) {
  if (file.size > _MAX_FILE_BYTES) {
    showError(`Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(0)} Mo). Limite: 500 Mo.`);
    return;
  }
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
    rawRows = null;
    populateMapper(headers);
  };
  headReader.readAsText(headSlice);
}

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
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === sep && !inQ) { result.push(cur); cur = ""; continue; }
    cur += c;
  }
  result.push(cur);
  return result;
}

function populateMapper(headers) {
  const fields = ["date", "time", "open", "high", "low", "close", "volume"];
  const selects = {
    date: "#col-date", time: "#col-time", open: "#col-open",
    high: "#col-high", low: "#col-low", close: "#col-close", volume: "#col-volume",
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
    date:   ["date", "timestamp", "datetime", "dt", "open_time", "opentime", "close_time", "ts"],
    time:   ["time", "heure", "hour"],
    open:   ["open", "o", "open_price"],
    high:   ["high", "h", "max", "high_price"],
    low:    ["low", "l", "min", "low_price"],
    close:  ["close", "c", "last", "price", "close_price"],
    volume: ["volume", "vol", "v", "qty", "tickvol"],
  };
  return (maps[field] || []).some((k) => h === k || h.startsWith(k));
}

function showError(msg) {
  showToast(msg, "error");
  const dropEl = document.getElementById("drop-filename");
  if (dropEl) dropEl.textContent = "Erreur — " + msg;
  const dropModal = document.getElementById("modal-drop");
  if (dropModal) dropModal.style.borderColor = "var(--bear)";
}

// ── INLINE WEB WORKER SOURCE ──────────────────────────────
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

  self.postMessage({ type: "progress", done: len, total: len, count: count, phase: "sort" });
  var indices = new Uint32Array(count);
  for (var i = 0; i < count; i++) indices[i] = i;
  indices.sort(function(a, b) { return times[a] - times[b]; });

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

  var fT = rT.subarray(0, n);
  var fO = rO.subarray(0, n);
  var fH = rH.subarray(0, n);
  var fL = rL.subarray(0, n);
  var fC = rC.subarray(0, n);
  var fV = rV.subarray(0, n);

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

function _parseCSVMainThread(file, dateCol, timeCol, openCol, highCol, lowCol, closeCol, volCol) {
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
          candles.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
        }
        if (i % 50000 === 0)
          showProgress(Math.round((i / lines.length) * 100), `Parsing… ${i}/${lines.length}`);
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
      showToast("Erreur parsing : " + err.message, "error");
    }
  };
  reader.onerror = () => {
    hideProgress();
    showToast("Erreur de lecture du fichier.", "error");
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
  currentSymbol = (document.getElementById("symbol-input").value || "DATA").toUpperCase();

  if (!dateCol || !openCol || !highCol || !lowCol || !closeCol) {
    showToast("Veuillez associer toutes les colonnes obligatoires (*)", "warning");
    return;
  }

  closeModal();

  if (rawRows && rawRows.length) {
    showLoading(true);
    setTimeout(() => {
      try {
        const candles = buildCandles(
          rawRows.map((row) => ({
            t: timeCol ? (row[dateCol] + " " + row[timeCol]) : row[dateCol],
            o: row[openCol], h: row[highCol], l: row[lowCol],
            c: row[closeCol], v: volCol ? row[volCol] : 0,
          })),
        );
        if (!candles.length) throw new Error("Aucune donnée valide");
        renderChart(candles);
      } catch (e) {
        showToast(e.message, "error");
      } finally {
        showLoading(false);
      }
    }, 50);
    return;
  }

  if (!pendingFile) return;
  showProgress(0, "Lecture du fichier…");

  if (activeWorker) { activeWorker.terminate(); activeWorker = null; }

  try {
    const blob = new Blob([CSV_WORKER_SRC], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    activeWorker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl);
  } catch (e) {
    hideProgress();
    _parseCSVMainThread(pendingFile, dateCol, timeCol, openCol, highCol, lowCol, closeCol, volCol);
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
        if (!n) throw new Error("Aucune donnée valide");
        showProgress(95, `Construction de ${(n / 1000).toFixed(0)}k bougies…`);

        const times   = new Float64Array(msg.times);
        const opens   = new Float64Array(msg.opens);
        const highs   = new Float64Array(msg.highs);
        const lows    = new Float64Array(msg.lows);
        const closes  = new Float64Array(msg.closes);
        const volumes = new Float64Array(msg.volumes);

        baseFlatTimes   = times;
        baseFlatOpens   = opens;
        baseFlatHighs   = highs;
        baseFlatLows    = lows;
        baseFlatCloses  = closes;
        baseFlatVolumes = volumes;

        const candles = new Array(n);
        for (let i = 0; i < n; i++) {
          candles[i] = { time: times[i], open: opens[i], high: highs[i], low: lows[i], close: closes[i], volume: volumes[i] };
        }

        baseCandles = candles;
        sortedTimes = Array.from(times);
        buildTFButtons(candles);

        let displayed = candles;
        let autoTFLabel = "";

        if (n > MAX_DISPLAY) {
          const targetBars = 100000;
          const neededTF = Math.ceil((times[n - 1] - times[0]) / targetBars);
          const TFS = [60, 300, 900, 1800, 3600, 14400, 86400];
          const autoTF = TFS.find((t) => t >= neededTF) || 86400;
          const TFLABELS = { 60:"1m",300:"5m",900:"15m",1800:"30m",3600:"1H",14400:"4H",86400:"1D" };
          autoTFLabel = TFLABELS[autoTF] || "1D";

          const groups = new Map();
          for (let i = 0; i < n; i++) {
            const b = Math.floor(times[i] / autoTF) * autoTF;
            let g = groups.get(b);
            if (!g) {
              groups.set(b, { time: b, open: opens[i], high: highs[i], low: lows[i], close: closes[i], volume: volumes[i] });
            } else {
              if (highs[i] > g.high) g.high = highs[i];
              if (lows[i] < g.low) g.low = lows[i];
              g.close = closes[i];
              g.volume += volumes[i];
            }
          }
          displayed = Array.from(groups.values()).sort((a, b) => a.time - b.time);
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
        showToast(err.message, "error");
      }
    }
  };

  activeWorker.onerror = (_err) => {
    activeWorker.terminate();
    activeWorker = null;
    hideProgress();
    _parseCSVMainThread(pendingFile, dateCol, timeCol, openCol, highCol, lowCol, closeCol, volCol);
  };

  showProgress(0, "Chargement du fichier…");
  const fileReader = new FileReader();
  fileReader.onload = (ev) => {
    showProgress(5, "Parsing en cours…");
    try {
      activeWorker.postMessage({
        text: ev.target.result, sep: workerPendingSep,
        dateIdx: idx(dateCol), timeIdx,
        openIdx: idx(openCol), highIdx: idx(highCol),
        lowIdx: idx(lowCol), closeIdx: idx(closeCol),
        volIdx: volCol ? idx(volCol) : -1,
      });
    } catch (err) {
      hideProgress();
      showToast("Erreur d'envoi au worker : " + err.message, "error");
    }
  };
  fileReader.onerror = () => {
    hideProgress();
    showToast("Erreur de lecture du fichier.", "error");
  };
  fileReader.readAsText(pendingFile);
}

// ── PROGRESS BAR HELPERS ──────────────────────────────────
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
  if (activeWorker) { activeWorker.terminate(); activeWorker = null; }
  hideProgress();
}

function buildCandles(rows) {
  const candles = rows
    .map((r) => ({
      time: parseTimestamp(String(r.t || "")),
      open: parseFloat(r.o), high: parseFloat(r.h),
      low: parseFloat(r.l), close: parseFloat(r.c),
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
  if (/^\d{9,10}$/.test(s)) return parseInt(s);
  if (/^\d{13}$/.test(s)) return Math.floor(parseInt(s) / 1000);

  let isoStr = s.replace(/\//g, "-").replace(/\./g, "-");
  if (isoStr.indexOf(" ") !== -1) isoStr = isoStr.replace(" ", "T") + "Z";

  const d = new Date(isoStr);
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  const f = new Date(s);
  if (!isNaN(f.getTime())) return Math.floor(f.getTime() / 1000);

  if (/^\d{8}$/.test(s)) {
    const d2 = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
    if (!isNaN(d2.getTime())) return Math.floor(d2.getTime() / 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d4 = new Date(s + "T00:00:00Z");
    if (!isNaN(d4.getTime())) return Math.floor(d4.getTime() / 1000);
  }
  return null;
}

function showLoading(show) {
  document.getElementById("loading").classList.toggle("show", show);
}

// ── SAMPLE DATA ───────────────────────────────────────────
function loadSampleData() {
  currentSymbol = "BTCUSD";
  document.getElementById("symbol-input").value = currentSymbol;
  showLoading(true);
  setTimeout(() => {
    try {
      const candles = generateSampleCandles("2024-01-01", 300, 42000, 0.025);
      renderChart(candles);
    } catch (e) {
      showToast("Erreur chargement démo : " + e.message, "error");
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
      time: ts, open: +open.toFixed(2), high: +hi.toFixed(2),
      low: +lo.toFixed(2), close: +price.toFixed(2), volume: vol,
    });
    ts += DAY;
  }
  return candles;
}

// ── EXPORT CSV ────────────────────────────────────────────
function exportCSV() {
  if (!allCandles.length) { showToast("Aucune donnée à exporter", "warning"); return; }
  const header = "time,open,high,low,close,volume\n";
  const rows = allCandles
    .map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`)
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${currentSymbol}_data.csv`;
  a.click();
  showToast(`${currentSymbol}_data.csv exporté`, "success", 2500);
}

// ── MODAL ─────────────────────────────────────────────────
function openModal() {
  if (replay.picking || replay.active) exitReplay();
  document.getElementById("modal-overlay").classList.add("open");
  document.getElementById("modal-drop").style.borderColor = "";
  document.getElementById("drop-filename").textContent = "Glissez un fichier CSV ou JSON";
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
