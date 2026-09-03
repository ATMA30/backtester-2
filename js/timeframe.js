// ========================================================
//  TIMEFRAME — TF detection, building, switching, resampling
//  Depends on: config.js, ui.js, chart.js, indicators.js
// ========================================================

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

// ── AGG WORKER SOURCE ─────────────────────────────────────
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
        var dd = new Date(t * 1000);
        if (tfSec === 86400) {
            var day = dd.getUTCDay();
            if (day === 0) {
                return Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate() + 1) / 1000;
            }
        }
        if (tfType === 'week') {
            var day = dd.getUTCDay();
            var diff = (day === 0) ? 6 : day - 1;
            return Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate() - diff) / 1000;
        }
        if (tfType === 'month') {
            return Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), 1) / 1000;
        }
        if (tfType === 'quarter') {
            var q = Math.floor(dd.getUTCMonth() / 3);
            return Date.UTC(dd.getUTCFullYear(), q * 3, 1) / 1000;
        }
        if (tfType === 'year') {
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

function ensureBaseFlat() {
  if (baseFlatTimes && baseFlatTimes.length === baseCandles.length) return;
  const n = baseCandles.length;
  const t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n);
  const l = new Float64Array(n), c = new Float64Array(n), v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cc = baseCandles[i];
    t[i] = cc.time; o[i] = cc.open; h[i] = cc.high;
    l[i] = cc.low; c[i] = cc.close; v[i] = cc.volume || 0;
  }
  baseFlatTimes = t; baseFlatOpens = o; baseFlatHighs = h;
  baseFlatLows = l; baseFlatCloses = c; baseFlatVolumes = v;
}

// ── CALENDAR-AWARE BUCKET ─────────────────────────────────
function getCalendarBucket(t, tfType, tfSec) {
  const d = new Date(t * 1000);
  if (tfSec === 86400) {
    const day = d.getUTCDay();
    if (day === 0) {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) / 1000;
    }
  }
  if (tfType === "week") {
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff) / 1000;
  }
  if (tfType === "month") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  }
  if (tfType === "quarter") {
    const q = Math.floor(d.getUTCMonth() / 3);
    return Date.UTC(d.getUTCFullYear(), q * 3, 1) / 1000;
  }
  if (tfType === "year") {
    return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
  }
  return Math.floor(t / tfSec) * tfSec;
}

function aggregateCandles(candles, tfSec, tfType) {
  if (!tfSec || tfSec <= baseTF)
    return candles.length > MAX_DISPLAY ? candles.slice(-MAX_DISPLAY) : candles;
  const n = candles.length;
  if (!n) return [];
  const res = [];
  let curBucket = getCalendarBucket(candles[0].time, tfType, tfSec);
  let o = candles[0].open, h = candles[0].high, l = candles[0].low;
  let c = candles[0].close, v = candles[0].volume || 0;
  for (let i = 1; i < n; i++) {
    const b = getCalendarBucket(candles[i].time, tfType, tfSec);
    if (b !== curBucket) {
      res.push({ time: curBucket, open: o, high: h, low: l, close: c, volume: v });
      curBucket = b;
      o = candles[i].open; h = candles[i].high; l = candles[i].low;
      c = candles[i].close; v = candles[i].volume || 0;
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
  _indicatorCache.clear();
  const grp = document.getElementById("tf-group");
  grp.innerHTML = "";

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
  _indicatorCache.clear();

  document.querySelectorAll("#tf-group .tv-dropdown-item").forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");

  const tfDef = TF_DEFS.find((t) => t.s === tfSec);
  if (tfDef) document.getElementById("label-active-tf").textContent = tfDef.label;

  const setStatusAgg = (label) => {
    document.getElementById("status-dot").style.background = "var(--yellow)";
    document.getElementById("status-text").textContent = `Agrégation ${label}…`;
  };
  const clearStatusAgg = () => {
    document.getElementById("status-dot").className = "status-dot green";
  };

  if (baseCandles.length > 50000) {
    setStatusAgg(btn ? btn.textContent : "");
    ensureBaseFlat();
    if (aggWorker) { aggWorker.terminate(); aggWorker = null; }
    const blob = new Blob([AGG_WORKER_SRC], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    aggWorker = new Worker(url);
    aggWorker.onmessage = (e) => {
      aggWorker.terminate();
      aggWorker = null;
      URL.revokeObjectURL(url);
      clearStatusAgg();
      const msg = e.data;
      const n = msg.count;
      const times   = new Float64Array(msg.times);
      const opens   = new Float64Array(msg.opens);
      const highs   = new Float64Array(msg.highs);
      const lows    = new Float64Array(msg.lows);
      const closes  = new Float64Array(msg.closes);
      const volumes = new Float64Array(msg.volumes);
      const candles = new Array(n);
      for (let i = 0; i < n; i++) {
        candles[i] = { time: times[i], open: opens[i], high: highs[i], low: lows[i], close: closes[i], volume: volumes[i] };
      }
      renderChart(candles, true);
      requestAnimationFrame(() => requestAnimationFrame(drawRedraw));
    };
    aggWorker.onerror = (err) => {
      aggWorker.terminate();
      aggWorker = null;
      URL.revokeObjectURL(url);
      clearStatusAgg();
      showToast("Erreur agrégation : " + err.message, "error");
    };
    const endIdx = replay.active ? replay.idx + 1 : baseFlatTimes.length;
    const tBuf = baseFlatTimes.buffer.slice(0, endIdx * 8);
    const oBuf = baseFlatOpens.buffer.slice(0, endIdx * 8);
    const hBuf = baseFlatHighs.buffer.slice(0, endIdx * 8);
    const lBuf = baseFlatLows.buffer.slice(0, endIdx * 8);
    const cBuf = baseFlatCloses.buffer.slice(0, endIdx * 8);
    const vBuf = baseFlatVolumes.buffer.slice(0, endIdx * 8);
    aggWorker.postMessage(
      { times: tBuf, opens: oBuf, highs: hBuf, lows: lBuf, closes: cBuf, volumes: vBuf, tfSec, tfType, baseTF, MAX: MAX_DISPLAY },
      [tBuf, oBuf, hBuf, lBuf, cBuf, vBuf],
    );
  } else {
    const targetCandles = replay.active ? baseCandles.slice(0, replay.idx + 1) : baseCandles;
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
  const n = candles.length;
  const st = new Array(n);
  for (let i = 0; i < n; i++) st[i] = candles[i].time;
  sortedTimes = st;
  _origRenderChart(candles);
};
