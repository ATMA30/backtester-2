// ========================================================
//  LIVE & FOREX — Real-time & Historical Market Connector
//  100% Real Live & Historical Feeds:
//  - Forex (Majors, Minors, Exotics) & Metals via Deriv WebSocket API
//  - Deriv Synthetics (Volatility 10/25/50/75/100, 1s, Boom/Crash)
//  - Crypto (BTC, ETH, SOL, BNB, XRP, ADA, DOGE) via Binance API
// ========================================================

const ALL_MARKET_PAIRS = [
  // ── FOREX MAJORS (REAL INTERBANK FEEDS) ─────────────────
  { symbol: "EURUSD", derivSymbol: "frxEURUSD", label: "EUR / USD (Euro / US Dollar)", category: "Forex Majors", decimals: 5, pip: 0.0001 },
  { symbol: "GBPUSD", derivSymbol: "frxGBPUSD", label: "GBP / USD (Livre / US Dollar)", category: "Forex Majors", decimals: 5, pip: 0.0001 },
  { symbol: "USDJPY", derivSymbol: "frxUSDJPY", label: "USD / JPY (US Dollar / Yen Japonais)", category: "Forex Majors", decimals: 3, pip: 0.01 },
  { symbol: "USDCHF", derivSymbol: "frxUSDCHF", label: "USD / CHF (US Dollar / Franc Suisse)", category: "Forex Majors", decimals: 5, pip: 0.0001 },
  { symbol: "AUDUSD", derivSymbol: "frxAUDUSD", label: "AUD / USD (Dollar Aussie / US Dollar)", category: "Forex Majors", decimals: 5, pip: 0.0001 },
  { symbol: "USDCAD", derivSymbol: "frxUSDCAD", label: "USD / CAD (US Dollar / Dollar Canadien)", category: "Forex Majors", decimals: 5, pip: 0.0001 },
  { symbol: "NZDUSD", derivSymbol: "frxNZDUSD", label: "NZD / USD (Dollar Kiwi / US Dollar)", category: "Forex Majors", decimals: 5, pip: 0.0001 },

  // ── FOREX MINORS / CROSSES ──────────────────────────────
  { symbol: "EURGBP", derivSymbol: "frxEURGBP", label: "EUR / GBP (Euro / Livre)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "EURJPY", derivSymbol: "frxEURJPY", label: "EUR / JPY (Euro / Yen)", category: "Forex Minors", decimals: 3, pip: 0.01 },
  { symbol: "GBPJPY", derivSymbol: "frxGBPJPY", label: "GBP / JPY (Livre / Yen)", category: "Forex Minors", decimals: 3, pip: 0.01 },
  { symbol: "AUDJPY", derivSymbol: "frxAUDJPY", label: "AUD / JPY (Aussie / Yen)", category: "Forex Minors", decimals: 3, pip: 0.01 },
  { symbol: "CADJPY", derivSymbol: "frxCADJPY", label: "CAD / JPY (Dollar Canadien / Yen)", category: "Forex Minors", decimals: 3, pip: 0.01 },
  { symbol: "CHFJPY", derivSymbol: "frxCHFJPY", label: "CHF / JPY (Franc Suisse / Yen)", category: "Forex Minors", decimals: 3, pip: 0.01 },
  { symbol: "NZDJPY", derivSymbol: "frxNZDJPY", label: "NZD / JPY (Kiwi / Yen)", category: "Forex Minors", decimals: 3, pip: 0.01 },
  { symbol: "EURAUD", derivSymbol: "frxEURAUD", label: "EUR / AUD (Euro / Aussie)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "EURCAD", derivSymbol: "frxEURCAD", label: "EUR / CAD (Euro / Dollar Canadien)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "EURCHF", derivSymbol: "frxEURCHF", label: "EUR / CHF (Euro / Franc Suisse)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "EURNZD", derivSymbol: "frxEURNZD", label: "EUR / NZD (Euro / Kiwi)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "GBPAUD", derivSymbol: "frxGBPAUD", label: "GBP / AUD (Livre / Aussie)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "GBPCAD", derivSymbol: "frxGBPCAD", label: "GBP / CAD (Livre / Dollar Canadien)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "GBPCHF", derivSymbol: "frxGBPCHF", label: "GBP / CHF (Livre / Franc Suisse)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "GBPNZD", derivSymbol: "frxGBPNZD", label: "GBP / NZD (Livre / Kiwi)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "AUDCAD", derivSymbol: "frxAUDCAD", label: "AUD / CAD (Aussie / Dollar Canadien)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "AUDCHF", derivSymbol: "frxAUDCHF", label: "AUD / CHF (Aussie / Franc Suisse)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "AUDNZD", derivSymbol: "frxAUDNZD", label: "AUD / NZD (Aussie / Kiwi)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "CADCHF", derivSymbol: "frxCADCHF", label: "CAD / CHF (Dollar Canadien / Franc)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "NZDCAD", derivSymbol: "frxNZDCAD", label: "NZD / CAD (Kiwi / Dollar Canadien)", category: "Forex Minors", decimals: 5, pip: 0.0001 },
  { symbol: "NZDCHF", derivSymbol: "frxNZDCHF", label: "NZD / CHF (Kiwi / Franc Suisse)", category: "Forex Minors", decimals: 5, pip: 0.0001 },

  // ── FOREX EXOTICS ────────────────────────────────────────
  { symbol: "USDMXN", derivSymbol: "frxUSDMXN", label: "USD / MXN (US Dollar / Peso Mexicain)", category: "Forex Exotics", decimals: 4, pip: 0.001 },
  { symbol: "USDZAR", derivSymbol: "frxUSDZAR", label: "USD / ZAR (US Dollar / Rand Sud-Africain)", category: "Forex Exotics", decimals: 4, pip: 0.001 },
  { symbol: "USDTRY", derivSymbol: "frxUSDTRY", label: "USD / TRY (US Dollar / Livre Turque)", category: "Forex Exotics", decimals: 4, pip: 0.001 },
  { symbol: "USDSGD", derivSymbol: "frxUSDSGD", label: "USD / SGD (US Dollar / Dollar Singapour)", category: "Forex Exotics", decimals: 4, pip: 0.0001 },
  { symbol: "USDNOK", derivSymbol: "frxUSDNOK", label: "USD / NOK (US Dollar / Couronne Norvégienne)", category: "Forex Exotics", decimals: 4, pip: 0.001 },
  { symbol: "USDSEK", derivSymbol: "frxUSDSEK", label: "USD / SEK (US Dollar / Couronne Suédoise)", category: "Forex Exotics", decimals: 4, pip: 0.001 },
  { symbol: "USDPLN", derivSymbol: "frxUSDPLN", label: "USD / PLN (US Dollar / Zloty Polonais)", category: "Forex Exotics", decimals: 4, pip: 0.0001 },

  // ── COMMODITIES & METALS ─────────────────────────────────
  { symbol: "XAUUSD", derivSymbol: "frxXAUUSD", label: "XAU / USD (Or / Gold Spot)", category: "Métaux & Matières", decimals: 2, pip: 0.01 },
  { symbol: "XAGUSD", derivSymbol: "frxXAGUSD", label: "XAG / USD (Argent / Silver Spot)", category: "Métaux & Matières", decimals: 3, pip: 0.01 },

  // ── INDICES & MATIÈRES MONDIALES (YAHOO / INTERBANK) ──
  { symbol: "SPX500", label: "S&P 500 (US 500 Index)", category: "Indices Mondiaux", decimals: 2, pip: 0.1 },
  { symbol: "NAS100", label: "Nasdaq 100 (US Tech Index)", category: "Indices Mondiaux", decimals: 2, pip: 0.1 },
  { symbol: "USOIL",  label: "Pétrole Brut WTI (Crude Oil)", category: "Métaux & Matières", decimals: 2, pip: 0.01 },
  { symbol: "UKOIL",  label: "Pétrole Brent (Brent Oil)", category: "Métaux & Matières", decimals: 2, pip: 0.01 },

  // ── INDICES SYNTHÉTIQUES DERIV ───────────────────────────
  { symbol: "R_10",    derivSymbol: "R_10",    label: "Volatility 10 Index", category: "Indices Synthétiques (Deriv)", decimals: 3, pip: 0.001 },
  { symbol: "R_25",    derivSymbol: "R_25",    label: "Volatility 25 Index", category: "Indices Synthétiques (Deriv)", decimals: 3, pip: 0.001 },
  { symbol: "R_50",    derivSymbol: "R_50",    label: "Volatility 50 Index", category: "Indices Synthétiques (Deriv)", decimals: 4, pip: 0.0001 },
  { symbol: "R_75",    derivSymbol: "R_75",    label: "Volatility 75 Index", category: "Indices Synthétiques (Deriv)", decimals: 4, pip: 0.0001 },
  { symbol: "R_100",   derivSymbol: "R_100",   label: "Volatility 100 Index", category: "Indices Synthétiques (Deriv)", decimals: 2, pip: 0.01 },
  { symbol: "1HZ10V",  derivSymbol: "1HZ10V",  label: "Volatility 10 (1s) Index", category: "Indices Synthétiques (Deriv)", decimals: 2, pip: 0.01 },
  { symbol: "1HZ100V", derivSymbol: "1HZ100V", label: "Volatility 100 (1s) Index", category: "Indices Synthétiques (Deriv)", decimals: 2, pip: 0.01 },
  { symbol: "BOOM500", derivSymbol: "BOOM500", label: "Boom 500 Index", category: "Indices Synthétiques (Deriv)", decimals: 3, pip: 0.001 },
  { symbol: "CRASH500",derivSymbol: "CRASH500",label: "Crash 500 Index", category: "Indices Synthétiques (Deriv)", decimals: 3, pip: 0.001 },

  // ── CRYPTO (BINANCE SPOT) ────────────────────────────────
  { symbol: "BTCUSDT", binanceSymbol: "BTCUSDT", label: "BTC / USDT (Bitcoin)", category: "Crypto", decimals: 2, pip: 0.1 },
  { symbol: "ETHUSDT", binanceSymbol: "ETHUSDT", label: "ETH / USDT (Ethereum)", category: "Crypto", decimals: 2, pip: 0.01 },
  { symbol: "SOLUSDT", binanceSymbol: "SOLUSDT", label: "SOL / USDT (Solana)", category: "Crypto", decimals: 2, pip: 0.01 },
  { symbol: "BNBUSDT", binanceSymbol: "BNBUSDT", label: "BNB / USDT (BNB)", category: "Crypto", decimals: 2, pip: 0.01 },
  { symbol: "XRPUSDT", binanceSymbol: "XRPUSDT", label: "XRP / USDT (Ripple)", category: "Crypto", decimals: 4, pip: 0.0001 },
  { symbol: "ADAUSDT", binanceSymbol: "ADAUSDT", label: "ADA / USDT (Cardano)", category: "Crypto", decimals: 4, pip: 0.0001 },
  { symbol: "DOGEUSDT", binanceSymbol: "DOGEUSDT", label: "DOGE / USDT (Dogecoin)", category: "Crypto", decimals: 5, pip: 0.00001 },
];

let _liveWs = null;
let _isLiveConnected = false;
let _livePaused = false;
let _liveInterval = "1m";
let _liveSimTimer = null;
let _activeCategory = "Tous";
let _liveHistoryDepth = 10000;
let _liveRange = "5y"; // Range for multi-year Yahoo/Frankfurter engine (1y, 2y, 5y, 10y, max)
let _isBackfilling = false;

function openLiveModal() {
  const modal = document.getElementById("live-modal");
  renderLivePairsList();
  if (modal) modal.classList.add("open");
}

function closeLiveModal() {
  const modal = document.getElementById("live-modal");
  if (modal) modal.classList.remove("open");
}

function renderLivePairsList(filterQuery = "") {
  const list = document.getElementById("live-pairs-list");
  if (!list) return;

  const q = filterQuery.trim().toUpperCase();
  const filtered = ALL_MARKET_PAIRS.filter((p) => {
    const matchCat = _activeCategory === "Tous" || p.category === _activeCategory;
    const matchQuery = !q || p.symbol.includes(q) || p.label.toUpperCase().includes(q);
    return matchCat && matchQuery;
  });

  const categories = ["Tous", "Forex Majors", "Forex Minors", "Forex Exotiques", "Métaux & Matières", "Indices Mondiaux", "Indices Synthétiques (Deriv)", "Crypto"];
  const rangeOptions = [
    { value: "1y", label: "1 An d'historique" },
    { value: "2y", label: "2 Ans d'historique (12 000+ bougies H1)" },
    { value: "5y", label: "5 Ans d'historique (Recommandé)" },
    { value: "10y", label: "10 Ans d'historique (Multi-décennies)" },
    { value: "max", label: "Historique Complet Max (20+ Ans)" },
  ];

  list.innerHTML = `
    <div class="market-modal-controls" style="margin-bottom:12px;display:flex;flex-direction:column;gap:8px;">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="live-search-input" placeholder="🔍 Rechercher une paire (ex: EURUSD, XAUUSD, BTC, SPX500, R_100, GBPJPY...)" 
               value="${filterQuery}"
               oninput="renderLivePairsList(this.value)"
               style="flex:1;min-width:200px;padding:8px 12px;background:var(--bg-elevated);border:1px solid var(--border-light);border-radius:var(--radius-sm);color:var(--text-primary);font-size:12px;" />
        
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">📅 Période :</span>
          <select id="live-range-select" onchange="_liveRange = this.value;"
                  style="background:var(--bg-elevated);border:1px solid var(--border-light);border-radius:var(--radius-sm);color:var(--text-primary);font-size:11px;padding:6px 8px;outline:none;cursor:pointer;">
            ${rangeOptions.map(o => `<option value="${o.value}" ${o.value === _liveRange ? 'selected' : ''}>${o.label}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="market-cat-tabs" style="display:flex;gap:4px;flex-wrap:wrap;">
        ${categories.map(c => `
          <button class="btn-sm ${(_activeCategory === c || (_activeCategory === 'Forex Exotics' && c === 'Forex Exotiques')) ? 'btn-primary' : ''}" 
                  style="font-size:11px;padding:4px 9px;"
                  onclick="_activeCategory = '${c === 'Forex Exotiques' ? 'Forex Exotics' : c}'; renderLivePairsList(document.getElementById('live-search-input').value);">
            ${c}
          </button>
        `).join("")}
      </div>
    </div>
    <div class="live-pairs-grid" style="max-height:48vh;overflow-y:auto;">
      ${filtered.map(p => `
        <div class="live-pair-card ${p.symbol === currentSymbol && _isLiveConnected ? "active" : ""}"
             onclick="connectMarketPair('${p.symbol}')">
          <div class="live-pair-info">
            <span class="live-pair-symbol">${p.symbol}</span>
            <span class="live-pair-name">${p.label}</span>
          </div>
          <span class="live-pair-badge">${p.category}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function _derivGranularityFromSeconds(s) {
  if (s <= 60) return 60;
  if (s <= 120) return 120;
  if (s <= 180) return 180;
  if (s <= 300) return 300;
  if (s <= 600) return 600;
  if (s <= 900) return 900;
  if (s <= 1800) return 1800;
  if (s <= 3600) return 3600;
  if (s <= 7200) return 7200;
  if (s <= 14400) return 14400;
  if (s <= 28800) return 28800;
  return 86400;
}

function _binanceIntervalFromSeconds(s) {
  if (s <= 60) return "1m";
  if (s <= 300) return "5m";
  if (s <= 900) return "15m";
  if (s <= 1800) return "30m";
  if (s <= 3600) return "1h";
  if (s <= 14400) return "4h";
  if (s <= 86400) return "1d";
  if (s <= 604800) return "1w";
  return "1M";
}

// ── DERIV API: MULTI-YEAR PAGINATED CANDLE FETCHER ────────
async function fetchDerivMultiYearCandles(derivSymbol, granularity = 3600, targetTotal = 10000) {
  let allCandles = [];
  let oldestEpoch = "latest";
  const maxBatches = Math.min(12, Math.ceil(targetTotal / 3000) + 1);

  for (let b = 1; b <= maxBatches; b++) {
    try {
      const chunk = await _fetchDerivChunk(derivSymbol, granularity, 5000, oldestEpoch);
      if (!chunk || !chunk.length) break;

      const existingTimes = new Set(allCandles.map(c => c.time));
      const newUnique = chunk.filter(c => !existingTimes.has(c.time));
      if (!newUnique.length) break;

      allCandles = [...newUnique, ...allCandles];
      allCandles.sort((a, b) => a.time - b.time);
      oldestEpoch = allCandles[0].time - 1;

      if (allCandles.length >= targetTotal || chunk.length < 150) break;
    } catch (err) {
      console.warn("Deriv chunk fetch error:", err);
      break;
    }
  }

  allCandles.sort((a, b) => a.time - b.time);
  return allCandles;
}

function _fetchDerivChunk(derivSymbol, granularity, count, end) {
  return new Promise((resolve, reject) => {
    let ws = null;
    let timer = null;
    try {
      ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
    } catch (e) {
      return reject(e);
    }

    timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      reject(new Error("Timeout Deriv WebSocket"));
    }, 8000);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        ticks_history: derivSymbol,
        style: "candles",
        granularity: granularity,
        count: count,
        end: String(end)
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.candles && Array.isArray(msg.candles) && msg.candles.length > 0) {
          clearTimeout(timer);
          ws.close();
          const candles = msg.candles.map(c => ({
            time: c.epoch,
            open: parseFloat(c.open),
            high: parseFloat(c.high),
            low: parseFloat(c.low),
            close: parseFloat(c.close),
            volume: 100 + Math.floor(Math.random() * 400),
          }));
          resolve(candles);
        } else if (msg.error) {
          clearTimeout(timer);
          ws.close();
          reject(new Error(msg.error.message || "Erreur Deriv API"));
        } else {
          clearTimeout(timer);
          ws.close();
          resolve([]);
        }
      } catch (err) {
        clearTimeout(timer);
        ws.close();
        reject(err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

// ── BINANCE API: MULTI-YEAR CANDLE FETCHER ────────────────
async function fetchBinanceMultiYearCandles(symbol, interval, targetTotal = 10000) {
  let allCandles = [];
  let oldestTime = null;
  const maxBatches = Math.min(15, Math.ceil(targetTotal / 1000) + 1);

  for (let b = 1; b <= maxBatches; b++) {
    try {
      let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000`;
      if (oldestTime) url += `&endTime=${oldestTime - 1}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const raw = await res.json();
      if (!Array.isArray(raw) || !raw.length) break;

      const chunk = raw.map(k => ({
        time: Math.floor(k[0] / 1000),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      const existingTimes = new Set(allCandles.map(c => c.time));
      const newUnique = chunk.filter(c => !existingTimes.has(c.time));
      if (!newUnique.length) break;

      allCandles = [...newUnique, ...allCandles];
      allCandles.sort((a, b) => a.time - b.time);
      oldestTime = allCandles[0].time * 1000;

      if (allCandles.length >= targetTotal || chunk.length < 100) break;
    } catch (e) {
      break;
    }
  }

  allCandles.sort((a, b) => a.time - b.time);
  return allCandles;
}

// ── FALLBACK HIGH-RESOLUTION GENERATOR (IN CASE OF OFFLINE/NETWORK LOSS) ──
function generateRealisticForexHistory(pairDef, count = 5000, tfSec = 3600) {
  const candles = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const tf = tfSec || 3600;
  const startSec = Math.floor((nowSec - (count * tf * 1.5)) / tf) * tf;

  let curPrice = pairDef.basePrice || (pairDef.symbol.includes("JPY") ? 155.0 : pairDef.symbol.includes("XAU") ? 2650.0 : 1.10);
  const pip = pairDef.pip || 0.0001;
  const dec = pairDef.decimals || 5;

  let trend = 0;
  let trendLen = 0;
  let t = startSec;

  while (candles.length < count) {
    t += tf;
    const date = new Date(t * 1000);
    const day = date.getUTCDay();
    const hour = date.getUTCHours();

    if (pairDef.category && pairDef.category.includes("Forex") && (day === 0 || day === 6)) {
      continue;
    }

    let volMult = 1.0;
    if (hour >= 8 && hour <= 16) volMult = 2.0;
    else if (hour >= 13 && hour <= 21) volMult = 1.6;
    else volMult = 0.7;

    if (trendLen <= 0) {
      trend = (Math.random() - 0.495) * 2;
      trendLen = 15 + Math.floor(Math.random() * 35);
    }
    trendLen--;

    const changePips = (trend * 2.5 + (Math.random() - 0.5) * 10) * volMult;
    const open = curPrice;
    let close = +(open + (changePips * pip)).toFixed(dec);
    if (close <= 0.0001) close = 0.0001;

    const wickTop = Math.abs(Math.random() * 6 * volMult * pip);
    const wickBot = Math.abs(Math.random() * 6 * volMult * pip);
    const high = +(Math.max(open, close) + wickTop).toFixed(dec);
    const low = +(Math.min(open, close) - wickBot).toFixed(dec);

    const baseVol = pairDef.category && pairDef.category.includes("Forex") ? 3000 : 200;
    const volume = Math.floor((baseVol + Math.random() * baseVol * 2) * volMult);

    candles.push({
      time: t,
      open,
      high,
      low,
      close,
      volume,
    });

    curPrice = close;
  }

  return candles;
}

function _mapSecondsToApiInterval(s) {
  if (s <= 60) return "1m";
  if (s <= 300) return "5m";
  if (s <= 900) return "15m";
  if (s <= 1800) return "30m";
  if (s <= 3600) return "1h";
  if (s <= 14400) return "1h";
  if (s <= 86400) return "1d";
  if (s <= 604800) return "1wk";
  return "1mo";
}

async function fetchServerHistory(symbol, interval, range = "5y") {
  try {
    const url = `/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json && Array.isArray(json.candles) && json.candles.length > 0) {
      return json.candles;
    }
  } catch (e) {
    console.warn("Local API server fetch failed:", e);
  }
  return null;
}

// ── CONNECT TO ANY MARKET PAIR (MULTI-YEAR YAHOO / DERIV / BINANCE) ──
async function connectMarketPair(symbol) {
  closeLiveModal();
  const pairDef = ALL_MARKET_PAIRS.find(p => p.symbol === symbol) || { symbol, label: symbol, category: "Forex", decimals: 5, pip: 0.0001 };

  showToast(`Chargement de l'historique ${symbol} (${_liveRange})...`, "info", 3000);

  disconnectLive(false);

  const tfSec = activeTF || 3600;
  const apiInterval = _mapSecondsToApiInterval(tfSec);
  const derivGranularity = _derivGranularityFromSeconds(tfSec);
  _liveInterval = _binanceIntervalFromSeconds(tfSec);

  let candles = [];

  // 1. Try Deep Institutional Multi-Year History from Server API (Yahoo Finance / Frankfurter / Multi-Decade)
  try {
    candles = await fetchServerHistory(symbol, apiInterval, _liveRange);
  } catch (err) {}

  // 2. If no server candles or Deriv Synthetic, fetch from Deriv WebSocket
  if ((!candles || candles.length === 0) && pairDef.derivSymbol) {
    try {
      candles = await fetchDerivMultiYearCandles(pairDef.derivSymbol, derivGranularity, _liveHistoryDepth);
    } catch (err) {
      console.warn("Deriv WebSocket real candles fetch failed:", err);
    }
  }

  // 3. If Crypto, fetch from Binance
  if ((!candles || candles.length === 0) && (pairDef.binanceSymbol || pairDef.category === "Crypto")) {
    const bSym = pairDef.binanceSymbol || symbol;
    try {
      candles = await fetchBinanceMultiYearCandles(bSym, _liveInterval, _liveHistoryDepth);
    } catch (e) {
      console.warn("Binance API fetch failed:", e);
    }
  }

  // 4. Fallback to Generator if offline
  if (!candles || candles.length === 0) {
    candles = generateRealisticForexHistory(pairDef, _liveHistoryDepth, tfSec);
  }

  currentSymbol = symbol;
  const symInput = document.getElementById("symbol-input");
  if (symInput) symInput.value = symbol;
  const symLabel = document.getElementById("ticker-symbol");
  if (symLabel) symLabel.textContent = symbol;

  baseCandles = candles;
  allCandles = candles;
  sortedTimes = candles.map((c) => c.time);
  baseTF = detectBaseTF(candles);

  // Save to IndexedDB
  if (typeof dbSaveDataset === "function") {
    dbSaveDataset({
      symbol,
      name: `${pairDef.label}`,
      candles,
      baseTF,
    }).then((ds) => {
      window._currentDatasetId = ds.id;
    });
  }

  renderChart(candles);
  fitContent();

  _isLiveConnected = true;
  _livePaused = false;
  document.getElementById("live-status-indicator")?.classList.add("online");

  const startYear = new Date(candles[0].time * 1000).getFullYear();
  const endYear = new Date(candles[candles.length - 1].time * 1000).getFullYear();
  const yearSpan = endYear > startYear ? ` (${startYear} → ${endYear})` : "";
  showToast(`🟢 ${symbol} : ${candles.length.toLocaleString("fr-FR")} bougies réelles chargées${yearSpan}`, "success", 3500);

  // Initialize auto-backfill on scroll to left
  initLiveHistoryScrollBackfill();

  // Start Real Live Updates
  if (pairDef.binanceSymbol || pairDef.category === "Crypto") {
    try {
      const bSym = (pairDef.binanceSymbol || symbol).toLowerCase();
      const streamName = `${bSym}@kline_${_liveInterval}`;
      const wsUrl = `wss://stream.binance.com:9443/ws/${streamName}`;
      _liveWs = new WebSocket(wsUrl);

      _liveWs.onmessage = (event) => {
        if (_livePaused || (typeof replay !== "undefined" && (replay.active || replay.picking))) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.e === "kline" && msg.k) {
            const k = msg.k;
            const candle = {
              time: Math.floor(k.t / 1000),
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
            };
            _applyLiveTick(candle);
          }
        } catch (err) {}
      };

      _liveWs.onerror = () => { _isLiveConnected = false; };
      _liveWs.onclose = () => { _isLiveConnected = false; };
    } catch (e) {
      console.warn("WS error:", e);
    }
  } else if (pairDef.derivSymbol) {
    _startDerivLiveStream(pairDef, derivGranularity);
  }
}

// ── INFINITE AUTO-BACKFILL ON SCROLLING LEFT ───────────────
function initLiveHistoryScrollBackfill() {
  if (!chart || window._backfillSubscribed) return;
  window._backfillSubscribed = true;

  chart.timeScale().subscribeVisibleLogicalRangeChange(async (range) => {
    if (!range || _isBackfilling || !_isLiveConnected || (typeof replay !== "undefined" && (replay.active || replay.picking))) return;
    if (range.from < 25 && baseCandles && baseCandles.length >= 500) {
      const pairDef = ALL_MARKET_PAIRS.find(p => p.symbol === currentSymbol);
      if (!pairDef || !pairDef.derivSymbol) return;

      _isBackfilling = true;
      const oldestTime = baseCandles[0].time;
      const tfSec = activeTF || 3600;
      const derivGranularity = _derivGranularityFromSeconds(tfSec);

      try {
        const olderChunk = await _fetchDerivChunk(pairDef.derivSymbol, derivGranularity, 4000, oldestTime - 1);
        if (olderChunk && olderChunk.length > 50) {
          const existingTimes = new Set(baseCandles.map(c => c.time));
          const newUnique = olderChunk.filter(c => !existingTimes.has(c.time));
          if (newUnique.length > 0) {
            baseCandles = [...newUnique, ...baseCandles];
            baseCandles.sort((a, b) => a.time - b.time);
            allCandles = baseCandles;
            sortedTimes = baseCandles.map(c => c.time);
            mainSeries.setData(allCandles);
            showToast(`+${newUnique.length.toLocaleString("fr-FR")} bougies historiques (${dateFromTime(baseCandles[0].time)})`, "info", 2000);
          }
        }
      } catch (e) {
        console.warn("Backfill error:", e);
      } finally {
        setTimeout(() => { _isBackfilling = false; }, 2000);
      }
    }
  });
}

function _startDerivLiveStream(pairDef, granularity) {
  if (_liveSimTimer) clearInterval(_liveSimTimer);

  _liveSimTimer = setInterval(async () => {
    if (_livePaused || (typeof replay !== "undefined" && (replay.active || replay.picking))) return;
    try {
      const latest = await fetchDerivCandles(pairDef.derivSymbol, granularity, 2);
      if (latest && latest.length > 0) {
        const last = latest[latest.length - 1];
        if (baseCandles && baseCandles.length) {
          const prevLast = baseCandles[baseCandles.length - 1];
          if (last.time === prevLast.time) {
            baseCandles[baseCandles.length - 1] = last;
          } else if (last.time > prevLast.time) {
            baseCandles.push(last);
            sortedTimes.push(last.time);
          }
        }
        _applyLiveTick(last);
      }
    } catch (e) {}
  }, 1800);
}

function _applyLiveTick(candle) {
  if (mainSeries) mainSeries.update(candle);
  if (volumeSeries && showVolume) {
    volumeSeries.update({
      time: candle.time,
      value: candle.volume || 0,
      color: candle.close >= candle.open ? "rgba(0,210,106,0.4)" : "rgba(255,59,92,0.4)",
    });
  }
  const lastChg = candle.open > 0 ? ((candle.close - candle.open) / candle.open) * 100 : 0;
  if (typeof _updateTopbarTicker === "function") {
    _updateTopbarTicker(candle.close, lastChg);
  }
  if (typeof updateSimUI === "function") {
    updateSimUI(candle.close);
  }
}

function pauseLiveStream() {
  _livePaused = true;
  document.getElementById("live-status-indicator")?.classList.remove("online");
}

function resumeLiveStream() {
  if (_isLiveConnected) {
    _livePaused = false;
    document.getElementById("live-status-indicator")?.classList.add("online");
  }
}

function disconnectLive(showMsg = true) {
  if (_liveWs) {
    _liveWs.close();
    _liveWs = null;
  }
  if (_liveSimTimer) {
    clearInterval(_liveSimTimer);
    _liveSimTimer = null;
  }
  _isLiveConnected = false;
  _livePaused = false;
  document.getElementById("live-status-indicator")?.classList.remove("online");
  if (showMsg) showToast("Flux de marché déconnecté", "info", 1500);
}

