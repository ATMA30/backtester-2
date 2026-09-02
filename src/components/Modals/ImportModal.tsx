import React, { useState, useRef } from 'react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore } from '../../store/useMarketStore';
import { Candle } from '../../types/market';

export const ImportModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const { setBaseCandles, setSymbol } = useMarketStore();

  const [symbolInput, setSymbolInput] = useState('');
  const [fileName, setFileName] = useState('Glissez un fichier CSV ou JSON');
  const [columns, setColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [colMapping, setColMapping] = useState({
    date: '',
    time: '',
    open: '',
    high: '',
    low: '',
    close: '',
    volume: '',
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (activeModal !== 'import') return null;

  const handleFile = (file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      if (file.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const sym = symbolInput || file.name.replace(/\.[^/.]+$/, '').toUpperCase();
            setSymbol(sym);
            setBaseCandles(parsed);
            closeModal();
            showToast(`🟢 ${sym} : ${parsed.length} bougies importées !`, 'success');
          }
        } catch (err) {
          showToast('Erreur de parsing JSON', 'error');
        }
        return;
      }

      // CSV Parsing
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) return;

      const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
      const header = lines[0].split(sep).map((h) => h.trim().replace(/^["']|["']$/g, ''));
      setColumns(header);

      const parsedRows = lines.slice(1).map((l) => l.split(sep).map((v) => v.trim().replace(/^["']|["']$/g, '')));
      setRawRows(parsedRows);

      // Auto-detect columns
      const lower = header.map((h) => h.toLowerCase());
      const mapping = {
        date: header[lower.findIndex((h) => h.includes('date') || h.includes('time') || h.includes('timestamp'))] || header[0] || '',
        time: header[lower.findIndex((h) => h === 'time' || h === 'heure')] || '',
        open: header[lower.findIndex((h) => h.includes('open') || h.includes('ouv'))] || header[1] || '',
        high: header[lower.findIndex((h) => h.includes('high') || h.includes('haut'))] || header[2] || '',
        low: header[lower.findIndex((h) => h.includes('low') || h.includes('bas'))] || header[3] || '',
        close: header[lower.findIndex((h) => h.includes('close') || h.includes('clot'))] || header[4] || '',
        volume: header[lower.findIndex((h) => h.includes('vol'))] || '',
      };
      setColMapping(mapping);
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!rawRows.length || !columns.length) {
      showToast('Veuillez sélectionner un fichier', 'warning');
      return;
    }

    const dateIdx = columns.indexOf(colMapping.date);
    const timeIdx = columns.indexOf(colMapping.time);
    const openIdx = columns.indexOf(colMapping.open);
    const highIdx = columns.indexOf(colMapping.high);
    const lowIdx = columns.indexOf(colMapping.low);
    const closeIdx = columns.indexOf(colMapping.close);
    const volIdx = columns.indexOf(colMapping.volume);

    const candles: Candle[] = [];

    for (const r of rawRows) {
      let tStr = r[dateIdx];
      if (timeIdx !== -1 && r[timeIdx]) tStr += ' ' + r[timeIdx];
      const parsedTime = Math.floor(new Date(tStr).getTime() / 1000) || (isNaN(Number(tStr)) ? 0 : Number(tStr));

      const o = parseFloat(r[openIdx]);
      const h = parseFloat(r[highIdx]);
      const l = parseFloat(r[lowIdx]);
      const cl = parseFloat(r[closeIdx]);
      const v = volIdx !== -1 ? parseFloat(r[volIdx]) || 100 : 100;

      if (!isNaN(parsedTime) && !isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(cl)) {
        candles.push({ time: parsedTime, open: o, high: h, low: l, close: cl, volume: v });
      }
    }

    candles.sort((a, b) => a.time - b.time);

    if (candles.length > 0) {
      const sym = symbolInput || fileName.replace(/\.[^/.]+$/, '').toUpperCase();
      setSymbol(sym);
      setBaseCandles(candles);
      closeModal();
      showToast(`🟢 ${sym} : ${candles.length.toLocaleString()} bougies importées avec succès !`, 'success');
    } else {
      showToast('Aucune donnée valide trouvée dans le fichier', 'error');
    }
  };

  return (
    <div id="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div id="modal">
        <div className="modal-header">
          <div className="modal-title">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Importer des données
          </div>
          <button className="modal-close" onClick={closeModal}>✕</button>
        </div>

        <div className="symbol-row">
          <input
            type="text"
            id="symbol-input"
            placeholder="Symbole  (ex : EURUSD, BTCUSD…)"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
          />
        </div>

        <div
          id="modal-drop"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
          }}
        >
          <div className="drop-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <polyline points="13 2 13 9 20 9" />
            </svg>
          </div>
          <div className="drop-text" id="drop-filename">{fileName}</div>
          <div className="drop-hint">ou cliquez pour sélectionner</div>
          <div className="drop-formats">
            <span className="fmt-badge">CSV</span>
            <span className="fmt-badge">JSON</span>
          </div>
        </div>

        <input
          type="file"
          id="file-hidden"
          ref={fileInputRef}
          accept=".csv,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.[0]) handleFile(e.target.files[0]);
          }}
        />

        {columns.length > 0 && (
          <div id="col-mapper" style={{ display: 'block' }}>
            <div className="col-map-title">Associer les colonnes</div>
            <div className="col-map-grid">
              {(['date', 'time', 'open', 'high', 'low', 'close', 'volume'] as const).map((col) => (
                <div key={col} className="col-map-item">
                  <label>{col.toUpperCase()} {col !== 'time' && col !== 'volume' ? '*' : ''}</label>
                  <select
                    value={colMapping[col]}
                    onChange={(e) => setColMapping({ ...colMapping, [col]: e.target.value })}
                  >
                    <option value="">— Sélectionner —</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <button id="import-btn" onClick={handleImport}>
          Afficher le graphique
        </button>
      </div>
    </div>
  );
};
