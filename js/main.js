// ========================================================
//  MAIN — DOMContentLoaded init + global keyboard shortcuts
//  Loaded last: depends on all other modules
// ========================================================

window.addEventListener("DOMContentLoaded", async () => {
  loadPrefs();
  initChart();
  initDrawCanvas();
  setupPositionDrag();
  _initForexTzSelect(); // Sync UTC offset selector to browser timezone

  // Try restoring previous dataset or session from IndexedDB
  if (typeof dbListDatasets === "function") {
    try {
      const list = await dbListDatasets();
      if (list && list.length > 0) {
        // Load most recent dataset
        await loadSavedDataset(list[0].id);
      }
    } catch (e) {
      console.warn("IndexedDB restore error:", e);
    }
  }

  // Replay bar controls
  document.getElementById("rp-play").addEventListener("click", () => {
    if (!replay.active) return;
    replay.playing ? rpPause() : rpPlay();
  });
  document.getElementById("rp-step-back").addEventListener("click", () => {
    rpPause();
    rpStep(-1);
  });
  document.getElementById("rp-step-fwd").addEventListener("click", () => {
    rpPause();
    rpStep(+1);
  });
  document.getElementById("rp-exit").addEventListener("click", exitReplay);

  document.getElementById("rp-scrubber").addEventListener("input", (e) => {
    if (!replay.active) return;
    rpPause();
    const prevIdx = replay.idx;
    const targetIdx = replay.startIdx + parseInt(e.target.value, 10);
    if (targetIdx > prevIdx) {
      for (let i = prevIdx + 1; i <= targetIdx && i < baseCandles.length; i++) {
        evalTradeSimLogic(baseCandles[i]);
      }
    }
    replay.idx = targetIdx;
    if (typeof renderReplaySlice === "function") {
      renderReplaySlice(targetIdx);
    }
    rpUpdateUI();
  });

  document.querySelectorAll(".rp-speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".rp-speed-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      replay.speed = parseFloat(btn.dataset.speed);
    });
  });

  // R:R badge — update on any input change in trade panel
  ["trade-entry", "trade-sl", "trade-tp"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", updateRRBadge);
  });
});

// ── KEYBOARD SHORTCUTS ────────────────────────────────────
document.addEventListener("keydown", (e) => {
  // Replay shortcuts (highest priority when active)
  if (replay.active && document.activeElement.tagName !== "INPUT") {
    if (e.key === " ") {
      e.preventDefault();
      replay.playing ? rpPause() : rpPlay();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      rpPause();
      rpStep(+1);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      rpPause();
      rpStep(-1);
      return;
    }
  }
  if (e.key === "Escape") {
    if (document.getElementById("live-modal")?.classList.contains("open")) {
      closeLiveModal();
      return;
    }
    if (document.getElementById("datasets-modal")?.classList.contains("open")) {
      closeDatasetsModal();
      return;
    }
    if (document.getElementById("snapshot-modal")?.classList.contains("open")) {
      closeSnapshotModal();
      return;
    }
    if (document.getElementById("indicator-modal").classList.contains("open")) {
      closeIndicatorModal();
      return;
    }
    if (document.getElementById("shortcuts-overlay").classList.contains("open")) {
      closeShortcuts();
      return;
    }
    if (replay.picking || replay.active) {
      exitReplay();
      return;
    }
    if (editingDrawing) {
      exitEditMode();
      return;
    }
    closeModal();
    drawPts = [];
    drawPreview = null;
    drawRedraw();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "o") {
    e.preventDefault();
    openModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "f") {
    e.preventDefault();
    fitContent();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
    e.preventDefault();
    captureChartSnapshot();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    undo();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) {
    e.preventDefault();
    redo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "c") {
    if (selectedDrawing && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      copyDrawing(selectedDrawing);
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "v") {
    if (document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      pasteDrawing();
    }
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    if (document.activeElement.tagName !== "INPUT") {
      if (editingDrawing) {
        window._ctxDeleteDrawing();
        exitEditMode();
      } else deleteSelectedDrawing();
    }
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !replay.active) {
    if (document.activeElement.tagName !== "INPUT") {
      if (e.key === "1") setDrawTool("cursor");
      if (e.key === "2") setDrawTool("trendline");
      if (e.key === "3") setDrawTool("hline");
      if (e.key === "4") setDrawTool("vline");
      if (e.key === "5") setDrawTool("rect");
      if (e.key === "6") setDrawTool("fib");
      if (e.key === "7") setDrawTool("text");
      if (e.key === "8") setDrawTool("channel");
      if (e.key === "9") setDrawTool("pos_long");
      if (e.key === "0") setDrawTool("pos_short");
      if (e.key === "r" || e.key === "R") setDrawTool("ray");
      if (e.key === "b" || e.key === "B") setBreakeven();
      if (e.key === "p" || e.key === "P") captureChartSnapshot();
      if (e.key === "?") document.getElementById("shortcuts-overlay").classList.add("open");
    }
  }
});
