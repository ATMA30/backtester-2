import React, { useEffect, useRef, useState } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { UploadCloud, X, FileSpreadsheet, Loader2, AlertTriangle } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useMarketStore, detectBaseTF } from '../../store/useMarketStore';
import { useReplayStore } from '../../store/useReplayStore';
import { Candle } from '../../types/market';
import { sanitizeCandles, RawCandleLike } from '../../domain/candles';
import {
  ColumnRole,
  CsvTable,
  DateOrder,
  detectDateOrder,
  hasSlashDates,
  inferColumnMapping,
  parseCsv,
  parseNumber,
  parseTimestamp,
} from '../../domain/csv';
import { RejectedSample, streamCsvCandles } from '../../domain/csv-stream';
import { TIMEFRAME_DEFS } from '../../domain/timeframes';

/** Libellé de la zone de dépôt tant qu'aucun fichier n'est choisi. */
const DEFAULT_DROP_LABEL = 'Glissez un fichier CSV ou JSON';

/**
 * Les CSV sont toujours lus en flux, donc la limite ne protège plus que d'un
 * fichier manifestement hors sujet. Un historique 1 minute sur vingt ans pèse
 * ~325 Mo : c'est un jeu de données légitime pour un backtester.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Le JSON n'a pas de lecteur en flux : `file.text()` puis `JSON.parse`
 * matérialisent tout le fichier, deux fois. Au-delà de ~100 Mo l'onglet tombe ;
 * le CSV, lu en flux, est la voie pour les gros historiques.
 */
const MAX_JSON_BYTES = 100 * 1024 * 1024;

/** Octets lus pour l'aperçu : assez pour ~2 000 lignes, jamais tout le fichier. */
const PREVIEW_BYTES = 256 * 1024;
const PREVIEW_ROWS = 5;

/**
 * Bougies gardées en mémoire au maximum.
 *
 * Mesuré dans Chrome : 2 000 000 bougies occupent ~2,1 Go de tas pour une
 * limite moteur de ~4,2 Go, et 6,6 millions font tomber l'onglet. 1,2 million
 * laisse une marge confortable au graphique, aux indicateurs et au replay.
 * Au-delà, la période complète est conservée : c'est la résolution qui baisse.
 */
const MAX_STREAMED_CANDLES = 1_200_000;
const MAX_FILES = 20;

const ROLES: readonly ColumnRole[] = ['date', 'time', 'open', 'high', 'low', 'close', 'volume'];
const ROLE_LABELS: Record<ColumnRole, string> = {
  date: 'Date',
  time: 'Heure',
  open: 'Ouverture',
  high: 'Plus haut',
  low: 'Plus bas',
  close: 'Clôture',
  volume: 'Volume',
};

const DATE_FORMATS_HINT = 'AAAA-MM-JJ, JJ/MM/AAAA, MM/JJ/AAAA ou horodatage Unix';

type Mapping = Record<ColumnRole, string>;

interface Preview {
  readonly table: CsvTable;
  readonly slashDates: boolean;
  /** Ordre prouvé par l'échantillon, ou `null` s'il reste ambigu. */
  readonly detectedOrder: DateOrder | null;
}

/** Libellé lisible d'une résolution, ex. 3600 → « 1h ». */
function labelForSeconds(seconds: number): string {
  return TIMEFRAME_DEFS.find((d) => d.s === seconds)?.label ?? `${Math.round(seconds / 60)} min`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} Mo`;
}

function isJson(file: File): boolean {
  return file.name.toLowerCase().endsWith('.json');
}

function suggestSymbol(file: File): string {
  return file.name
    .replace(/\.[^/.]+$/, '')
    .replace(/_(FULL|MT4|MT5|H1|H4|D1|M30|M15|M5|M1|DATA)(?=_|$)/gi, '')
    .toUpperCase()
    .slice(0, 16);
}

/** Reject oversized input before reading it into memory. */
function screenFiles(files: File[]): { accepted: File[]; rejected: string[] } {
  const accepted: File[] = [];
  const rejected: string[] = [];

  for (const file of files.slice(0, MAX_FILES)) {
    const limit = isJson(file) ? MAX_JSON_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) {
      rejected.push(
        isJson(file)
          ? `${file.name} (${formatBytes(file.size)} : un JSON se lit d’un bloc, limite ${formatBytes(limit)} — exportez-le en CSV)`
          : `${file.name} (${formatBytes(file.size)} > ${formatBytes(limit)})`
      );
    } else {
      accepted.push(file);
    }
  }
  if (files.length > MAX_FILES) {
    rejected.push(`${files.length - MAX_FILES} fichier(s) au-delà de la limite de ${MAX_FILES}`);
  }
  return { accepted, rejected };
}

/** Lit le début du fichier, sans la dernière ligne si elle est coupée. */
async function readHead(file: File): Promise<string> {
  const text = await file.slice(0, PREVIEW_BYTES).text();
  if (file.size <= PREVIEW_BYTES) return text;
  const lastBreak = text.lastIndexOf('\n');
  return lastBreak > 0 ? text.slice(0, lastBreak) : text;
}

async function readJsonRows(file: File): Promise<RawCandleLike[]> {
  const parsed: unknown = JSON.parse(await file.text());
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? ((parsed as Record<string, unknown>).candles ?? (parsed as Record<string, unknown>).data)
      : null;
  if (!Array.isArray(list)) return [];

  return list.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      time: parseTimestamp(row.time ?? row.date ?? row.timestamp),
      open: parseNumber(row.open ?? row.o),
      high: parseNumber(row.high ?? row.h),
      low: parseNumber(row.low ?? row.l),
      close: parseNumber(row.close ?? row.c),
      // `|| 0`, not `|| 100`: a genuine zero volume is data, not a gap to paper
      // over with an invented figure.
      volume: parseNumber(row.volume ?? row.vol ?? row.v) || 0,
    };
  });
}

/** Une ligne rejetée, dite en clair avec la suite à donner. */
function describeRejection(sample: RejectedSample): string {
  const excerpt = sample.text.length > 60 ? `${sample.text.slice(0, 60)}…` : sample.text;
  return sample.reason === 'date'
    ? `ligne ${sample.line}, date illisible (« ${excerpt} »). Formats acceptés : ${DATE_FORMATS_HINT}.`
    : `ligne ${sample.line}, clôture illisible (« ${excerpt} »). Vérifiez la colonne Clôture et le séparateur décimal.`;
}

export const ImportModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const { setBaseCandles, setSymbol, setTimeframe, triggerFitContent, setDataSource } = useMarketStore();

  const [symbolInput, setSymbolInput] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>('DMY');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamProgress, setStreamProgress] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // `App` ne monte cette modale que tant qu'elle est ouverte : la fermer la
  // démonte, et fermer pendant une lecture l'annule. Avant, l'import se
  // poursuivait et remplaçait le graphique plus tard, sans prévenir.
  useEffect(() => () => abortRef.current?.abort(), []);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, activeModal === 'import');

  if (activeModal !== 'import') return null;

  const dropLabel =
    files.length === 0
      ? DEFAULT_DROP_LABEL
      : files.length === 1
        ? files[0].name
        : `${files.length} fichiers : ${files.map((f) => f.name).slice(0, 2).join(', ')}${files.length > 2 ? '…' : ''}`;

  /** Remplace le jeu de données courant. Point de sortie unique des imports. */
  const commitSeries = (candles: Candle[], symbol: string, message: string, isWarning: boolean) => {
    const btf = detectBaseTF(candles);
    useReplayStore.getState().resetReplay();
    setSymbol(symbol);
    setBaseCandles(candles, btf, true);
    setDataSource('Fichier importé', false);
    setTimeframe(btf);
    triggerFitContent();
    closeModal();
    showToast(message, isWarning ? 'warning' : 'success', isWarning ? 8000 : 4000);
  };

  const importJson = async (file: File, symbol: string) => {
    try {
      const candles = sanitizeCandles(await readJsonRows(file));
      if (candles.length === 0) {
        showToast(
          `Aucune bougie exploitable dans ${file.name}. Attendu : un tableau d’objets { time, open, high, low, close }.`,
          'error',
          6000
        );
        return;
      }
      commitSeries(candles, symbol, `${symbol} importé · ${candles.length.toLocaleString('fr-FR')} bougies`, false);
    } catch (error) {
      console.warn('[ImportModal] JSON import failed:', error);
      showToast(`${file.name} n’est pas un JSON valide. Vérifiez qu’il n’est pas tronqué.`, 'error', 6000);
    }
  };

  /** Étape 1 : choix des fichiers, puis aperçu du premier CSV. */
  const handleFiles = async (picked: File[]) => {
    if (picked.length === 0 || isStreaming) return;

    const { accepted, rejected } = screenFiles(picked);
    if (rejected.length > 0) {
      showToast(`Fichier(s) ignoré(s) : ${rejected.join(' ; ')}`, 'warning', 8000);
    }
    if (accepted.length === 0) return;

    const symbol = symbolInput.trim() || suggestSymbol(accepted[0]);
    setSymbolInput(symbol);
    setFiles(accepted);

    // Un JSON seul n'a pas de colonnes à associer : import direct.
    if (accepted.length === 1 && isJson(accepted[0])) {
      setPreview(null);
      setMapping(null);
      await importJson(accepted[0], symbol);
      return;
    }

    const firstCsv = accepted.find((f) => !isJson(f));
    if (!firstCsv) {
      // Que des JSON : rien à associer, fusion directe.
      setPreview(null);
      setMapping(null);
      const merged: Candle[] = [];
      for (const file of accepted) {
        if (merged.length >= MAX_STREAMED_CANDLES) break;
        try {
          for (const candle of await readJsonRows(file)) merged.push(candle as Candle);
        } catch (error) {
          console.warn('[ImportModal] JSON read failed:', file.name, error);
        }
      }
      const candles = sanitizeCandles(merged);
      if (candles.length === 0) {
        showToast('Aucune bougie exploitable dans ces fichiers JSON.', 'error', 6000);
        return;
      }
      commitSeries(
        candles,
        symbol,
        `${symbol} · ${accepted.length} fichiers fusionnés · ${candles.length.toLocaleString('fr-FR')} bougies`,
        false
      );
      return;
    }

    try {
      const table = parseCsv(await readHead(firstCsv), 2_000);
      if (table.header.length === 0 || table.rows.length === 0) {
        showToast(`${firstCsv.name} est vide ou ne contient qu’une ligne.`, 'warning', 5000);
        return;
      }
      if (table.header.length < 2) {
        showToast(
          'Une seule colonne détectée : vérifiez le séparateur (virgule, point-virgule, tabulation ou barre verticale).',
          'warning',
          6000
        );
      }

      const inferred = inferColumnMapping(table.header);
      const dateIdx = table.header.indexOf(inferred.date);
      const dateSamples = table.rows.map((r) => r[dateIdx] ?? '');
      const detectedOrder = detectDateOrder(dateSamples);

      setPreview({ table, slashDates: hasSlashDates(dateSamples), detectedOrder });
      setMapping(inferred);
      setDateOrder(detectedOrder ?? 'DMY');
    } catch (error) {
      console.warn('[ImportModal] preview failed:', error);
      showToast(`Lecture impossible : ${firstCsv.name}. Le fichier est peut-être verrouillé ou corrompu.`, 'error', 6000);
    }
  };

  /** Étape 2 : lecture complète, en flux, avec le mappage confirmé. */
  const handleImport = async () => {
    if (files.length === 0 || !mapping) {
      showToast('Choisissez d’abord un fichier CSV ou JSON.', 'warning');
      return;
    }
    if (!mapping.date || !mapping.close) {
      showToast('Associez au moins les colonnes Date et Clôture.', 'error', 5000);
      return;
    }

    const symbol = symbolInput.trim() || suggestSymbol(files[0]);
    const controller = new AbortController();
    abortRef.current = controller;
    const readTimestamp = (value: unknown) => parseTimestamp(value, dateOrder);

    const collected: Candle[] = [];
    const failed: string[] = [];
    let linesRead = 0;
    let linesRejected = 0;
    let firstRejected: RejectedSample | null = null;
    let downsampledTo = 0;
    let truncated = false;
    let skippedForMemory = 0;

    setIsStreaming(true);
    try {
      for (const [index, file] of files.entries()) {
        if (controller.signal.aborted) break;
        const position = files.length > 1 ? ` (${index + 1}/${files.length})` : '';
        setStreamProgress(`Lecture de ${file.name}${position} · ${formatBytes(file.size)}…`);

        try {
          if (isJson(file)) {
            // Boucle et non `push(...rows)` : l'étalement lève `RangeError`
            // au-delà d'environ 150 000 éléments, et le fichier passait pour
            // « illisible ».
            for (const candle of sanitizeCandles(await readJsonRows(file))) collected.push(candle);
            // Même plafond global que le CSV : 20 JSON de 100 Mo tenaient sinon
            // en mémoire. On cesse de lire plutôt que de couper au hasard.
            if (collected.length >= MAX_STREAMED_CANDLES) {
              skippedForMemory = files.length - index - 1;
              break;
            }
            continue;
          }

          const result = await streamCsvCandles(file, readTimestamp, {
            // Le plafond vaut pour la fusion, pas par fichier : sinon N
            // fichiers au plafond dépassent la limite d'un facteur N.
            maxCandles: Math.max(1, Math.floor(MAX_STREAMED_CANDLES / files.length)),
            overflow: 'downsample',
            mapping,
            signal: controller.signal,
            onProgress: (lines) =>
              setStreamProgress(`${file.name}${position} · ${lines.toLocaleString('fr-FR')} lignes lues…`),
          });

          for (const candle of result.candles) collected.push(candle);
          linesRead += result.linesRead;
          linesRejected += result.linesRejected;
          firstRejected ??= result.firstRejected;
          truncated ||= result.truncated;
          if (result.resolutionSeconds > result.sourceResolutionSeconds && result.sourceResolutionSeconds > 0) {
            downsampledTo = Math.max(downsampledTo, result.resolutionSeconds);
          }
        } catch (error) {
          console.warn('[ImportModal] failed to read', file.name, error);
          failed.push(file.name);
        }
      }
    } finally {
      setIsStreaming(false);
      setStreamProgress('');
      abortRef.current = null;
    }

    // Annulé : ne rien charger. L'ancienne branche disait « non importées »
    // après avoir déjà remplacé le graphique.
    if (controller.signal.aborted) {
      showToast('Import annulé : le graphique n’a pas été modifié.', 'info', 3500);
      return;
    }

    // Un seul passage assainit l'ordre, les doublons entre fichiers et les NaN.
    const merged = files.length > 1 ? sanitizeCandles(collected) : collected;

    if (merged.length === 0) {
      showToast(
        firstRejected
          ? `Aucune bougie exploitable — ${describeRejection(firstRejected)}`
          : failed.length > 0
            ? `Aucune donnée exploitable. Fichiers illisibles : ${failed.join(', ')}.`
            : 'Aucune bougie exploitable : vérifiez l’association des colonnes.',
        'error',
        9000
      );
      return;
    }

    const count = merged.length.toLocaleString('fr-FR');
    const parts = [
      files.length > 1 ? `${symbol} · ${files.length} fichiers fusionnés · ${count} bougies` : `${symbol} importé · ${count} bougies`,
    ];
    if (downsampledTo > 0) {
      parts.push(`agrégées en ${labelForSeconds(downsampledTo)} pour tenir en mémoire — toute la période est conservée`);
    } else if (truncated) {
      parts.push(`plus récentes seulement (limite mémoire, ${linesRead.toLocaleString('fr-FR')} lignes lues)`);
    }
    if (linesRejected > 0 && firstRejected) {
      parts.push(`${linesRejected.toLocaleString('fr-FR')} ligne(s) ignorée(s), 1re : ${describeRejection(firstRejected)}`);
    }
    if (failed.length > 0) parts.push(`illisible(s) : ${failed.join(', ')}`);
    if (skippedForMemory > 0) {
      parts.push(`limite mémoire atteinte : ${skippedForMemory} fichier(s) suivant(s) non lu(s)`);
    }

    commitSeries(
      merged,
      symbol,
      parts.join(' · '),
      linesRejected > 0 || failed.length > 0 || truncated || skippedForMemory > 0
    );
  };

  const cancelImport = () => abortRef.current?.abort();

  // ── Aperçu interprété ──
  const previewRows = (() => {
    if (!preview || !mapping) return [];
    const { header, rows } = preview.table;
    const at = (role: ColumnRole) => (mapping[role] ? header.indexOf(mapping[role]) : -1);
    const idx = Object.fromEntries(ROLES.map((r) => [r, at(r)])) as Record<ColumnRole, number>;

    return rows.slice(0, PREVIEW_ROWS).map((cells) => {
      const dateCell = cells[idx.date] ?? '';
      const timeCell = idx.time !== -1 && idx.time !== idx.date ? cells[idx.time] : '';
      const time = parseTimestamp(timeCell ? `${dateCell} ${timeCell}` : dateCell, dateOrder);
      const num = (role: ColumnRole) => (idx[role] === -1 ? Number.NaN : parseNumber(cells[idx[role]]));
      const open = num('open');
      const high = num('high');
      const low = num('low');
      const close = num('close');
      const inconsistent = Number.isFinite(high) && Number.isFinite(low) && high < low;
      return {
        date: time === null ? null : new Date(time * 1000).toISOString().slice(0, 16).replace('T', ' '),
        open,
        high,
        low,
        close,
        volume: num('volume'),
        inconsistent,
      };
    });
  })();

  const cell = (value: number, invalid = false) => (
    <td className={invalid || !Number.isFinite(value) ? 'is-invalid' : undefined}>
      {Number.isFinite(value) ? value : '—'}
    </td>
  );

  const canImport = files.length > 0 && mapping !== null && !isStreaming;

  return (
    <div
      id="modal-overlay"
      className="open import-overlay"
      onClick={(e) => {
        // Fermer démonte la modale et annule la lecture en cours.
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div id="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-header">
          <div className="modal-title modal-title-row" id="import-title">
            <UploadCloud size={16} strokeWidth={2} className="modal-title-icon" />
            <span>Importer un fichier</span>
          </div>
          <button className="modal-close modal-close-btn" onClick={closeModal} aria-label="Fermer">
            <X size={15} strokeWidth={2.4} />
          </button>
        </div>

        <div className="symbol-row">
          <input
            type="text"
            id="symbol-input"
            placeholder="Nom de l’instrument — ex. EURUSD"
            aria-label="Nom de l’instrument"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
          />
        </div>

        {/* Un gros fichier prend plusieurs secondes : sans retour, l'import
            passe pour un échec silencieux — et sans bouton, il ne s'arrête pas. */}
        {isStreaming && (
          <div className="import-progress" role="status" aria-live="polite">
            <Loader2 size={13} strokeWidth={2.2} className="import-spinner" aria-hidden />
            <span className="import-progress-text">{streamProgress || 'Lecture en cours…'}</span>
            <button type="button" className="btn-sm" onClick={cancelImport}>
              Annuler
            </button>
          </div>
        )}

        <button type="button"
          id="modal-drop"
          aria-label="Choisir un ou plusieurs fichiers CSV ou JSON"
          disabled={isStreaming}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void handleFiles(Array.from(e.dataTransfer.files || []));
          }}
          style={{ cursor: isStreaming ? 'wait' : 'pointer' }}
        >
          <div className="drop-icon import-drop-icon-center">
            <FileSpreadsheet size={32} strokeWidth={1.5} className="import-drop-glyph" />
          </div>
          <div className="drop-text" id="drop-filename">{dropLabel}</div>
          <div className="drop-hint">ou cliquez pour sélectionner un ou plusieurs fichiers</div>
          <div className="drop-formats">
            <span className="fmt-badge">CSV</span>
            <span className="fmt-badge">JSON</span>
            <span className="fmt-badge import-multi-badge">Multi-fichiers</span>
          </div>
        </button>

        <input
          type="file"
          id="file-hidden"
          ref={fileInputRef}
          accept=".csv,.json,.txt"
          multiple className="file-input-hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files || []);
            // Vider *avant* de traiter : le champ doit être neuf même si
            // l'utilisateur reprend le même fichier juste après un échec.
            e.target.value = '';
            void handleFiles(picked);
          }}
        />

        {preview && mapping && (
          <div id="col-mapper" className="visible">
            {!preview.table.hasHeader && (
              <p className="import-note">
                <AlertTriangle size={12} strokeWidth={2.2} aria-hidden />
                Fichier sans ligne d’en-tête (export MT4 ou courtier) : colonnes associées par position.
                Vérifiez l’aperçu.
              </p>
            )}

            <div className="col-map-title">Associer les colonnes</div>
            <div className="col-map-grid">
              {ROLES.map((role) => (
                <div key={role} className="col-map-item">
                  <label htmlFor={`map-${role}`}>
                    {ROLE_LABELS[role]} {role === 'date' || role === 'close' ? '*' : ''}
                  </label>
                  <select
                    id={`map-${role}`}
                    value={mapping[role]}
                    onChange={(e) => setMapping({ ...mapping, [role]: e.target.value })}
                  >
                    <option value="">
                      {role === 'time'
                        ? '— Aucune (date complète ou horodatage) —'
                        : role === 'volume'
                          ? '— Aucun (pas de volume) —'
                          : '— Aucune —'}
                    </option>
                    {preview.table.header.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ))}

              {preview.slashDates && (
                <div className="col-map-item">
                  <label htmlFor="map-date-order">
                    Format des dates{preview.detectedOrder === null ? ' — à confirmer' : ''}
                  </label>
                  <select
                    id="map-date-order"
                    value={dateOrder}
                    onChange={(e) => setDateOrder(e.target.value as DateOrder)}
                  >
                    <option value="DMY">JJ/MM/AAAA (européen)</option>
                    <option value="MDY">MM/JJ/AAAA (américain)</option>
                  </select>
                </div>
              )}
            </div>

            {/* Ce que l'import va réellement lire. Des listes de noms de
                colonnes ne montraient pas qu'un mappage était décalé. */}
            <div className="col-map-title">Aperçu interprété</div>
            <div className="import-preview-wrap">
              <table className="import-preview">
                <thead>
                  <tr>
                    <th>Date (UTC)</th>
                    <th>O</th>
                    <th>H</th>
                    <th>L</th>
                    <th>C</th>
                    <th>V</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td className={r.date === null ? 'is-invalid' : undefined}>{r.date ?? 'illisible'}</td>
                      {cell(r.open)}
                      {cell(r.high, r.inconsistent)}
                      {cell(r.low, r.inconsistent)}
                      {cell(r.close)}
                      <td>{Number.isFinite(r.volume) ? r.volume : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button
          id="import-btn"
          className={canImport ? 'ready' : ''}
          onClick={() => void handleImport()}
          disabled={!canImport}
          style={{
            marginTop: '16px',
            width: '100%',
            height: '38px',
            background: canImport ? 'var(--accent)' : 'var(--bg-elevated)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontWeight: 600,
            cursor: canImport ? 'pointer' : 'default',
          }}
        >
          {isStreaming ? 'Lecture en cours…' : 'Importer'}
        </button>
      </div>
    </div>
  );
};
