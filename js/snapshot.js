// ========================================================
//  SNAPSHOT — HD Chart & Drawing Canvas Merger & Export
//  Combines Lightweight Charts canvas + Drawings overlay canvas
// ========================================================

async function captureChartSnapshot() {
  const chartContainer = document.getElementById("chart-container");
  if (!chartContainer || !chart) return;

  if (typeof playSound === "function") playSound("snap");

  try {
    const width = chartContainer.clientWidth;
    const height = chartContainer.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    // 1. Get official Lightweight Charts screenshot canvas
    let chartCanvas = null;
    if (typeof chart.takeScreenshot === "function") {
      chartCanvas = chart.takeScreenshot();
    }

    // 2. Create offscreen canvas for composite image
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = chartCanvas ? chartCanvas.width : width * dpr;
    compositeCanvas.height = chartCanvas ? chartCanvas.height : height * dpr;
    const ctx = compositeCanvas.getContext("2d");

    // 3. Fill solid background
    ctx.fillStyle = "#060810";
    ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);

    // 4. Draw chart layer
    if (chartCanvas) {
      ctx.drawImage(chartCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
    } else {
      // Fallback
      const canvases = chartContainer.querySelectorAll("canvas:not(#draw-canvas)");
      canvases.forEach((c) => {
        if (c.width > 0 && c.height > 0 && c.style.display !== "none") {
          ctx.drawImage(c, 0, 0, compositeCanvas.width, compositeCanvas.height);
        }
      });
    }

    // 5. Draw drawings canvas layer (#draw-canvas)
    const drawCanvas = document.getElementById("draw-canvas");
    if (drawCanvas && drawCanvas.width > 0 && drawCanvas.height > 0) {
      ctx.drawImage(drawCanvas, 0, 0, compositeCanvas.width, compositeCanvas.height);
    }

    // 6. Draw Watermark / Branding Badge at top left
    ctx.save();
    const scale = compositeCanvas.width / width;
    ctx.fillStyle = "rgba(15, 20, 32, 0.85)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1 * scale;
    const badgeW = 230 * scale;
    const badgeH = 34 * scale;
    const badgeX = 14 * scale;
    const badgeY = 14 * scale;
    const radius = 6 * scale;

    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, radius);
    ctx.fill();
    ctx.stroke();

    ctx.font = `600 ${12 * scale}px 'Inter', sans-serif`;
    ctx.fillStyle = "#4F46E5";
    ctx.fillText("TradeView", badgeX + 10 * scale, badgeY + 21 * scale);

    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("Pro", badgeX + 74 * scale, badgeY + 21 * scale);

    ctx.font = `500 ${10 * scale}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "#94A3B8";
    const tfLabel = (typeof TF_DEFS !== "undefined" && TF_DEFS.find((t) => t.s === activeTF)?.label) || "1D";
    ctx.fillText(`• ${currentSymbol} • ${tfLabel}`, badgeX + 100 * scale, badgeY + 21 * scale);
    ctx.restore();

    // 7. Convert to Blob & open preview modal
    compositeCanvas.toBlob((blob) => {
      if (!blob) {
        showToast("Erreur lors de la génération de l'image", "error");
        return;
      }
      openSnapshotModal(blob, compositeCanvas.toDataURL("image/png"));
    }, "image/png");

  } catch (err) {
    console.error("Snapshot error:", err);
    showToast("Erreur lors de la capture", "error");
  }
}

let _currentSnapshotBlob = null;

function openSnapshotModal(blob, dataUrl) {
  _currentSnapshotBlob = blob;
  const modal = document.getElementById("snapshot-modal");
  const img = document.getElementById("snapshot-preview-img");
  if (img) img.src = dataUrl;
  if (modal) modal.classList.add("open");
}

function closeSnapshotModal() {
  const modal = document.getElementById("snapshot-modal");
  if (modal) modal.classList.remove("open");
  _currentSnapshotBlob = null;
}

async function copySnapshotToClipboard() {
  if (!_currentSnapshotBlob) return;
  try {
    if (navigator.clipboard && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": _currentSnapshotBlob }),
      ]);
      showToast("Image copiée dans le presse-papier ! 📋", "success", 2500);
      closeSnapshotModal();
    } else {
      downloadSnapshotPNG();
    }
  } catch (err) {
    console.warn("Clipboard copy failed, fallback to download:", err);
    downloadSnapshotPNG();
  }
}

function downloadSnapshotPNG() {
  if (!_currentSnapshotBlob) return;
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = URL.createObjectURL(_currentSnapshotBlob);
  a.download = `TradeViewPro_${currentSymbol}_${dateStr}.png`;
  a.click();
  showToast("Image téléchargée 📥", "success", 2500);
  closeSnapshotModal();
}
