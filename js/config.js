// ========================================================
//  CONFIG — Global state variables & constants
//  Loaded first: no dependencies
// ========================================================

// Chart instances
let chart = null;
let mainSeries = null;
let volumeSeries = null;

// Data
let rawData = [], parsedHeaders = [], rawRows = [];
let allCandles = [], baseCandles = [], sortedTimes = [];
let currentType = "Candlestick";
let currentSymbol = "DATA";
let showVolume = true, showGrid = true;

// Drawing state
let drawings = [], drawPts = [], drawPreview = null;
let selectedDrawing = null, editingDrawing = null;
let editHandle = null, editDragging = false;
let drawTool = "cursor";
let drawCanvas, drawCtx;
let _clipboard = null;
let _drawingIdCounter = Date.now();
function _nextDrawId() { return ++_drawingIdCounter; }

// Indicators
let customIndicators = [];
const _indicatorCache = new Map();

// TF state
let baseTF = 86400, activeTF = 86400, activeTFType = "intraday";
let baseFlatTimes = null, baseFlatOpens = null, baseFlatHighs = null;
let baseFlatLows = null, baseFlatCloses = null, baseFlatVolumes = null;
let aggWorker = null;

// Trading
const tradeSim = {
  balance: 10000,
  positions: [],
  pendingOrders: [],
  history: [],
  spread: 0,        // spread in price points
  commissionPct: 0, // commission % per trade
};
let _nextTradeId = 1;

// Replay
const replay = {
  active: false, picking: false, playing: false,
  idx: 0, startIdx: 0, speed: 1, rafId: null,
  lastTick: 0, accumulated: 0,
};

// UI state
let _tradeHistoryOpen = false;
let _dom = null;
let _shiftHeld = false; // angle constraint (multiples of 45°)
let _ctrlHeld  = false; // OHLC snap (was Shift)
let _undoStack = [], _redoStack = [];
const MAX_UNDO = 50;

// File parser state
let pendingFile = null, workerPendingHeaders = null, workerPendingSep = null;
let workerPendingIsJson = false, activeWorker = null;

// Separator state
let separatorTF = null;

// Constants
const LS_DRAWINGS = "tvp_drawings";
const LS_PREFS    = "tvp_prefs";
const MAX_DISPLAY = 200000;
const HANDLE_R = 6;
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const DRAW_COLORS = {
  default: "#3B82F6",
  fib: "#F59E0B",
  rect: "rgba(59,130,246,0.10)",
  sel: "#00C46E",
  longProfit: "rgba(0, 210, 106, 0.18)",
  longLoss: "rgba(255, 59, 92, 0.18)",
  longBorder: "#00D26A",
  shortBorder: "#FF3B5C",
};
const IND_SWATCH_COLORS = ["#3B82F6","#00C46E","#F59E0B","#F2364A","#A855F7","#00D4FF","#FF8C00","#ffffff"];

const TF_DEFS = [
  { label: "1m",  s: 60,       tfType: "minute"   },
  { label: "5m",  s: 300,      tfType: "minute"   },
  { label: "15m", s: 900,      tfType: "minute"   },
  { label: "30m", s: 1800,     tfType: "minute"   },
  { label: "1H",  s: 3600,     tfType: "hour"     },
  { label: "4H",  s: 14400,    tfType: "hour"     },
  { label: "1D",  s: 86400,    tfType: "day"      },
  { label: "1W",  s: 604800,   tfType: "week"     },
  { label: "1M",  s: 2592000,  tfType: "month"    },
  { label: "3M",  s: 7776000,  tfType: "quarter"  },
  { label: "1Y",  s: 31536000, tfType: "year"     },
];

// Forex sessions — UTC open/close hours, zone fill + opening line colors
// Session hours are UTC. If your broker data is NOT in UTC (e.g. GMT+2 server time),
// adjust this offset so zones line up with what you see on the chart.
// Default = 0 (UTC) — correct for data downloaded from the internet.
let _forexTzOffset = 0;

const FOREX_SESSIONS = {
  sydney:  { enabled: false, label: "Sydney",   start: 22, end:  7, zone: "rgba(139,92,246,0.032)",  line: "#A78BFA" },
  tokyo:   { enabled: false, label: "Tokyo",    start:  0, end:  9, zone: "rgba(251,146,60,0.032)",  line: "#FB923C" },
  london:  { enabled: false, label: "Londres",  start:  8, end: 17, zone: "rgba(59,130,246,0.038)",  line: "#60A5FA" },
  newyork: { enabled: false, label: "New York", start: 13, end: 22, zone: "rgba(0,210,106,0.035)",   line: "#34D399" },
};

const _SEP_COLORS = {
  "1D": { line: "rgba(91, 142, 255, 0.30)",  label: "rgba(91, 142, 255, 0.65)"  },
  "1W": { line: "rgba(12, 241, 155, 0.28)",  label: "rgba(12, 241, 155, 0.60)"  },
  "1M": { line: "rgba(168, 85, 247, 0.30)",  label: "rgba(168, 85, 247, 0.65)"  },
  "3M": { line: "rgba(240, 185, 11, 0.28)",  label: "rgba(240, 185, 11, 0.60)"  },
  "1Y": { line: "rgba(255, 68, 102, 0.30)",  label: "rgba(255, 68, 102, 0.65)"  },
};

const TOAST_ICONS = {
  success: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  error:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  warning: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  info:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};
