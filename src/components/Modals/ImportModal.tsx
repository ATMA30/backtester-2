import React, { useState, useRef } from 'react';
import { UploadCloud, X, FileSpreadsheet } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore, detectBaseTF } from '../../store/useMarketStore';
import { Candle } from '../../types/market';

function parseTimestamp(val: any): number | null {
  if (val === undefined || val === null) return null;
  const s = String(val).trim().replace(/['"<>]/g, '');
  if (!s) return null;

  // Numeric timestamp (seconds or milliseconds, integer or float)
  const numVal = parseFloat(s);
  if (!isNaN(numVal) && String(numVal).length >= 9) {
    if (numVal > 900000000 && numVal < 2500000000) {
      return Math.floor(numVal);
    }
    if (numVal >= 900000000000 && numVal < 2500000000000) {
      return Math.floor(numVal / 1000);
    }
  }

  // Replace dots and slashes: "2023.01.15" or "2023/01/15" -> "2023-01-15"
  let isoStr = s.replace(/\./g, '-');

  // Handle DD/MM/YYYY or DD-MM-YYYY format
  const dmyMatch = isoStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(.*)$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    const rest = dmyMatch[4] || '';
    isoStr = `${year}-${month}-${day}${rest}`;
  }

  // Handle space separator between date and time: "2023-01-15 14:00:00" -> "2023-01-15T14:00:00Z"
  if (isoStr.includes(' ')) {
    isoStr = isoStr.replace(' ', 'T');
    if (!isoStr.endsWith('Z')) isoStr += 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) {
    isoStr += 'T00:00:00Z';
  }

  const d = new Date(isoStr);
  if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);

  const f = new Date(s);
  if (!isNaN(f.getTime())) return Math.floor(f.getTime() / 1000);

  // Compact YYYYMMDD format
  if (/^\d{8}$/.test(s)) {
    const d2 = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`);
    if (!isNaN(d2.getTime())) return Math.floor(d2.getTime() / 1000);
  }

  return null;
}

function parseNumber(val: any): number {
  if (val === undefined || val === null) return NaN;
  const str = String(val).trim().replace(/['"<>]/g, '').replace(',', '.');
  return parseFloat(str);
}

function cleanHeaderName(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

function autoMatchColumn(header: string, field: string): boolean {
  const h = cleanHeaderName(header);
  const maps: Record<string, string[]> = {
    date: ['date', 'timestamp', 'datetime', 'dt', 'time', 'open_time', 'opentime', 'close_time', 'ts', 'time_utc', 'gmt_time'],
    time: ['time', 'heure', 'hour', 'timestamp_time'],
    open: ['open', 'o', 'open_price', 'ouv', 'ouverture', 'openprice', 'first'],
    high: ['high', 'h', 'max', 'high_price', 'haut', 'maximum', 'highprice'],
    low: ['low', 'l', 'min', 'low_price', 'bas', 'minimum', 'lowprice'],
    close: ['close', 'c', 'last', 'price', 'close_price', 'clot', 'cloture', 'closeprice'],
    volume: ['volume', 'vol', 'v', 'qty', 'tickvol', 'tick_volume', 'volum', 'quantite'],
  };
  return (maps[field] || []).some((k) => h === k || h.startsWith(k) || h.endsWith(k));
}

export const ImportModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const { setBaseCandles, setSymbol, setTimeframe, triggerFitContent } = useMarketStore();

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
    const suggestedSymbol = file.name.replace(/\.[^/.]+$/, '').replace(/_FULL|_H1|_D1|_M15|_M5|_M1/gi, '').toUpperCase().slice(0, 16);
    if (!symbolInput) {
      setSymbolInput(suggestedSymbol);
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      if (file.name.endsWith('.json')) {
        try {
          let parsed = JSON.parse(text);
          if (!Array.isArray(parsed) && typeof parsed === 'object') {
            parsed = parsed.candles || parsed.data || parsed[Object.keys(parsed)[0]];
          }
          if (Array.isArray(parsed) && parsed.length > 0) {
            const sym = symbolInput || suggestedSymbol;
            const validCandles: Candle[] = parsed
              .map((p) => ({
                time: parseTimestamp(p.time || p.date || p.timestamp) || 0,
                open: parseNumber(p.open || p.o),
                high: parseNumber(p.high || p.h),
                low: parseNumber(p.low || p.l),
                close: parseNumber(p.close || p.c),
                volume: parseNumber(p.volume || p.vol || p.v) || 100,
              }))
              .filter((c) => c.time > 0 && !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close));

            if (validCandles.length > 0) {
              validCandles.sort((a, b) => a.time - b.time);
              const btf = detectBaseTF(validCandles);
              setSymbol(sym);
              setBaseCandles(validCandles, btf);
              setTimeframe(btf);
              triggerFitContent();
              closeModal();
              showToast(`🟢 ${sym} : ${validCandles.length.toLocaleString()} bougies importées !`, 'success', 3500);
              return;
            }
          }
        } catch {
          showToast('Erreur de lecture du fichier JSON', 'error');
        }
        return;
      }

      // CSV Parsing
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        showToast('Fichier CSV vide ou incomplet', 'warning');
        return;
      }

      // Detect separator: comma, semicolon, tab, pipe
      const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
      const headerLine = lines[0];
      Object.keys(counts).forEach((sep) => {
        counts[sep] = headerLine.split(sep).length - 1;
      });
      const bestSep = Object.keys(counts).reduce((a, b) => (counts[a] > counts[b] ? a : b));

      const header = headerLine.split(bestSep).map((h) => h.trim().replace(/^["']|["']$/g, ''));
      setColumns(header);

      const parsedRows = lines.slice(1).map((l) =>
        l.split(bestSep).map((v) => v.trim().replace(/^["']|["']$/g, ''))
      );
      setRawRows(parsedRows);

      // Match date and other columns
      const matchedDate = header.find((h) => autoMatchColumn(h, 'date')) || header[0] || '';
      // Only set time column if there is a DISTINCT time column different from date
      const matchedTime = header.find((h) => h !== matchedDate && autoMatchColumn(h, 'time')) || '';

      const mapping = {
        date: matchedDate,
        time: matchedTime,
        open: header.find((h) => autoMatchColumn(h, 'open')) || header[1] || '',
        high: header.find((h) => autoMatchColumn(h, 'high')) || header[2] || '',
        low: header.find((h) => autoMatchColumn(h, 'low')) || header[3] || '',
        close: header.find((h) => autoMatchColumn(h, 'close')) || header[4] || '',
        volume: header.find((h) => autoMatchColumn(h, 'volume')) || '',
      };
      setColMapping(mapping);
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    if (!rawRows.length || !columns.length) {
      showToast('Veuillez sélectionner ou glisser un fichier CSV/JSON', 'warning');
      return;
    }

    const dateColName = colMapping.date || columns.find((h) => autoMatchColumn(h, 'date')) || columns[0];
    const timeColName = colMapping.time;
    const openColName = colMapping.open || columns.find((h) => autoMatchColumn(h, 'open')) || columns[1];
    const highColName = colMapping.high || columns.find((h) => autoMatchColumn(h, 'high')) || columns[2];
    const lowColName = colMapping.low || columns.find((h) => autoMatchColumn(h, 'low')) || columns[3];
    const closeColName = colMapping.close || columns.find((h) => autoMatchColumn(h, 'close')) || columns[4];
    const volColName = colMapping.volume;

    const dateIdx = columns.indexOf(dateColName);
    // Never concatenate if time column is same as date column or not specified
    const timeIdx = timeColName && timeColName !== dateColName ? columns.indexOf(timeColName) : -1;
    const openIdx = columns.indexOf(openColName);
    const highIdx = columns.indexOf(highColName);
    const lowIdx = columns.indexOf(lowColName);
    const closeIdx = columns.indexOf(closeColName);
    const volIdx = volColName ? columns.indexOf(volColName) : -1;

    const candles: Candle[] = [];
    const seenTimes = new Set<number>();

    for (const r of rawRows) {
      if (!r || r.length === 0) continue;
      let tStr = r[dateIdx];
      if (timeIdx !== -1 && r[timeIdx]) {
        tStr = `${tStr} ${r[timeIdx]}`;
      }
      const parsedTime = parseTimestamp(tStr);

      const o = parseNumber(r[openIdx]);
      const h = parseNumber(r[highIdx]);
      const l = parseNumber(r[lowIdx]);
      const cl = parseNumber(r[closeIdx]);
      const v = volIdx !== -1 ? parseNumber(r[volIdx]) || 100 : 100;

      if (parsedTime !== null && parsedTime > 0 && !isNaN(o) && !isNaN(h) && !isNaN(l) && !isNaN(cl)) {
        if (!seenTimes.has(parsedTime)) {
          seenTimes.add(parsedTime);
          candles.push({ time: parsedTime, open: o, high: h, low: l, close: cl, volume: v });
        }
      }
    }

    candles.sort((a, b) => a.time - b.time);

    if (candles.length > 0) {
      const sym = symbolInput.trim() || fileName.replace(/\.[^/.]+$/, '').toUpperCase();
      const btf = detectBaseTF(candles);
      setSymbol(sym);
      setBaseCandles(candles, btf);
      setTimeframe(btf);
      triggerFitContent();
      closeModal();
      showToast(`🟢 ${sym} : ${candles.length.toLocaleString()} bougies affichées sur le graphique !`, 'success', 3500);
    } else {
      showToast('Impossible de lire les données. Vérifiez l’association des colonnes Date/Open/High/Low/Close.', 'error', 4500);
    }
  };

  return (
    <div id="modal-overlay" className="open" style={{ display: 'flex' }} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
      <div id="modal">
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UploadCloud size={16} strokeWidth={2} style={{ color: '#38BDF8' }} />
            <span>Importer des données</span>
          </div>
          <button className="modal-close" onClick={closeModal} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="symbol-row">
          <input
            type="text"
            id="symbol-input"
            placeholder="Symbole (ex : VOLATILITY 100, EURUSD…)"
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
          style={{ cursor: 'pointer' }}
        >
          <div className="drop-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FileSpreadsheet size={32} strokeWidth={1.5} style={{ color: '#38BDF8' }} />
          </div>
          <div className="drop-text" id="drop-filename">{fileName}</div>
          <div className="drop-hint">ou cliquez pour parcourir vos fichiers</div>
          <div className="drop-formats">
            <span className="fmt-badge">CSV</span>
            <span className="fmt-badge">JSON</span>
          </div>
        </div>

        <input
          type="file"
          id="file-hidden"
          ref={fileInputRef}
          accept=".csv,.json,.txt"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.[0]) handleFile(e.target.files[0]);
          }}
        />

        {columns.length > 0 && (
          <div id="col-mapper" style={{ display: 'block', marginTop: '12px' }}>
            <div className="col-map-title" style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Associer les colonnes
            </div>
            <div className="col-map-grid">
              {(['date', 'time', 'open', 'high', 'low', 'close', 'volume'] as const).map((col) => (
                <div key={col} className="col-map-item">
                  <label>{col.toUpperCase()} {col !== 'time' && col !== 'volume' ? '*' : ''}</label>
                  <select
                    value={colMapping[col]}
                    onChange={(e) => setColMapping({ ...colMapping, [col]: e.target.value })}
                  >
                    <option value="">
                      {col === 'time' ? '— Aucun (Date complète ou timestamp) —' : col === 'volume' ? '— Aucun (Défaut 100) —' : '— Sélectionner —'}
                    </option>
                    {columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          id="import-btn"
          className={columns.length > 0 ? 'ready' : ''}
          onClick={handleImport}
          style={{
            marginTop: '16px',
            width: '100%',
            height: '38px',
            background: columns.length > 0 ? 'var(--accent)' : 'var(--bg-elevated)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
            cursor: columns.length > 0 ? 'pointer' : 'default',
          }}
        >
          Afficher le graphique
        </button>
      </div>
    </div>
  );
};
