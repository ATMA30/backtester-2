// ========================================================
//  STORAGE — localStorage persistence
//  Depends on: config.js
// ========================================================

function saveDrawings() {
  try { localStorage.setItem(LS_DRAWINGS, JSON.stringify(drawings)); } catch (e) {}
}

function loadDrawings() {
  try {
    const d = localStorage.getItem(LS_DRAWINGS);
    if (d) drawings = JSON.parse(d);
  } catch (e) {}
}

function savePrefs() {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify({
      symbol: currentSymbol, type: currentType,
      volume: showVolume, grid: showGrid,
    }));
  } catch (e) {}
}

function loadPrefs() {
  try {
    const p = localStorage.getItem(LS_PREFS);
    if (!p) return;
    const prefs = JSON.parse(p);
    if (prefs.symbol) currentSymbol = prefs.symbol;
    if (prefs.type) currentType = prefs.type;
    if (prefs.volume === false) showVolume = false;
    if (prefs.grid === false) showGrid = false;
  } catch (e) {}
}
