import React, { useMemo, useRef, useState } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { Download, X, BookOpen, Info } from 'lucide-react';
import { useUIStore } from '../../store/useUIStore';
import { useTradeStore } from '../../store/useTradeStore';
import { useMarketStore } from '../../store/useMarketStore';
import { formatMoney, unitsToLots } from '../../domain/instruments';
import { Position } from '../../types/trading';
import { csvCell } from '../../domain/csv-export';
import { EMPTY_FILTER, JournalFilter, computeMetrics, filterTrades, formatR, isFilterActive, setupsOf } from '../../domain/journal';
import { JournalFilters } from './journal/JournalFilters';
import { TradeRow } from './journal/TradeRow';
import { isAutoCaptureEnabled, setAutoCaptureEnabled } from '../Chart/useTradeCaptures';

/** Epoch seconds → ISO 8601, readable in any spreadsheet. */
function isoDate(epochSeconds: number | undefined): string {
  return epochSeconds === undefined || !Number.isFinite(epochSeconds)
    ? ''
    : new Date(epochSeconds * 1000).toISOString();
}

/** Min and max of a list, without `Math.min(...list)`. */
function extent(values: readonly number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/** `Infinity` is the honest profit factor for "profits, no losses" — say it. */
function formatProfitFactor(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '—';
  return value.toFixed(2);
}

function signClass(value: number): string {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
}

/** Chronological order: the equity curve and the drawdown must agree. */
function byCloseTime(a: Position, b: Position): number {
  return (a.closeTime ?? a.time) - (b.closeTime ?? b.time);
}

/**
 * One-sentence definitions. The panel assumed a financial expert: "facteur de
 * profit" and "drawdown" were bare labels.
 */
const DEFINITIONS = {
  net: 'Gains moins pertes, sur tous les trades clôturés, frais déduits quand ils sont activés.',
  expectancy:
    'Résultat moyen par trade. En R : gain moyen rapporté au risque pris à l’entrée (1 R = la perte au stop). Au-dessus de 0, la méthode gagne sur la durée.',
  drawdown: 'Plus forte baisse du capital depuis un sommet, en %. Mesure la pire série que vous auriez dû encaisser.',
  winRate: 'Part des trades gagnants. À lire avec l’espérance : 30 % suffit si les gains valent trois fois les pertes.',
  profitFactor: 'Gains bruts divisés par pertes brutes. Au-dessus de 1,5, c’est solide ; sous 1, la méthode perd.',
  avg: 'Gain moyen des trades gagnants, perte moyenne des perdants.',
} as const;

const Stat: React.FC<{ label: string; hint: string; value: string; tone?: string; primary?: boolean }> = ({
  label,
  hint,
  value,
  tone = '',
  primary = false,
}) => (
  <div className={`th-stat${primary ? ' th-stat-primary' : ''}`} title={hint}>
    <div className="th-stat-label">
      {label}
      <Info size={9} strokeWidth={2.4} aria-hidden className="th-stat-hint" />
    </div>
    <div className={`th-stat-val ${tone}`}>{value}</div>
  </div>
);

export const TradeHistoryModal: React.FC = () => {
  const { activeModal, closeModal, showToast } = useUIStore();
  const { closedPositions, getMetrics, initialBalance, accountCurrency } = useTradeStore();
  const currentSymbol = useMarketStore((m) => m.currentSymbol);
  const costsEnabled = useTradeStore((s) => s.costs.enabled);
  const [filter, setFilter] = useState<JournalFilter>(EMPTY_FILTER);
  const [autoCapture, setAutoCapture] = useState(isAutoCaptureEnabled);
  /** One trade open at a time; it stays listed until closed, filter or not. */
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef, activeModal === 'trade-history');

  const setups = useMemo(() => setupsOf(closedPositions), [closedPositions]);
  const matching = useMemo(() => filterTrades(closedPositions, filter), [closedPositions, filter]);
  // Renaming the setup of a trade under a setup filter made it vanish on blur,
  // mid-edit. The open trade stays listed — but out of the statistics — until
  // the trader closes it.
  const listed = useMemo(() => {
    if (expandedId === null || matching.some((t) => t.id === expandedId)) return matching;
    return closedPositions.filter((t) => t.id === expandedId || matching.includes(t));
  }, [closedPositions, matching, expandedId]);
  const trades = matching;

  if (activeModal !== 'trade-history') return null;

  const filtered = isFilterActive(filter);
  // A selection is measured on its own: "what would these trades alone give?"
  const m = filtered ? computeMetrics(trades, initialBalance) : getMetrics();
  const chronological = [...trades].sort(byCloseTime);

  const exportTradeHistory = () => {
    if (!trades.length) return;
    const currency = accountCurrency.toLowerCase();
    const header = `id,symbol,type,entry,exit,lots,open_time_utc,close_time_utc,pnl_${currency},fees_${currency},r_multiple,close_reason,setup,emotion,note\n`;
    const rows = chronological
      .map((p) => {
        const symbol = p.symbol ?? currentSymbol;
        // Des nombres, pas des chaînes : « -12.50 » en texte était neutralisé en
        // « '-12.50 » et toute perte exportée devenait du texte dans le tableur.
        const round2 = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? undefined : Math.round(n * 100) / 100);
        const r = p.riskAmount && p.pnl !== undefined ? round2(p.pnl / p.riskAmount) : undefined;
        return [
          p.id,
          symbol,
          p.type,
          p.entry,
          p.exitPrice,
          round2(unitsToLots(symbol, p.size)),
          isoDate(p.time),
          isoDate(p.closeTime),
          round2(p.pnl),
          round2(p.fees),
          r,
          p.closeReason,
          p.annotation?.setup,
          p.annotation?.emotion,
          p.annotation?.note,
        ]
          .map(csvCell)
          .join(',');
      })
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal_${currentSymbol}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Révoquer au tour suivant : révoquer tout de suite peut annuler le
    // téléchargement sous Firefox et Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`${trades.length} trade(s) exporté(s) en CSV.`, 'success');
  };

  // Equity curve, in the same order as the drawdown computation.
  let running = m.initialBalance;
  const balancePoints: number[] = [running];
  for (const p of chronological) {
    running += p.pnl ?? 0;
    balancePoints.push(running);
  }

  // A spread call over this list throws `RangeError` past ~65k entries.
  const { min, max } = extent(balancePoints);
  const minB = Math.min(min, m.initialBalance);
  const maxB = Math.max(max, m.initialBalance);
  const rangeB = maxB - minB || 1;

  const svgW = 320;
  const svgH = 60;
  const yOf = (b: number) => svgH - ((b - minB) / rangeB) * (svgH - 10) - 5;
  const polylinePts = balancePoints
    .map((b, i) => `${(i / (balancePoints.length - 1 || 1)) * svgW},${yOf(b)}`)
    .join(' ');
  const curveColor = m.totalPnL >= 0 ? 'var(--bull)' : 'var(--bear)';

  return (
    <div id="trade-history-panel" ref={dialogRef} className="open th-panel-layout" role="dialog" aria-label="Journal de trades">
      <div className="th-header">
        <div className="th-title th-title-row">
          <BookOpen size={15} strokeWidth={2} className="th-title-icon" />
          <span>Journal de trades</span>
        </div>
        <div className="th-header-actions">
          <button
            className="th-export th-icon-btn"
            onClick={exportTradeHistory}
            title={filtered ? 'Exporter la sélection en CSV' : 'Exporter en CSV'}
            aria-label={filtered ? 'Exporter la sélection en CSV' : 'Exporter le journal en CSV'}
            disabled={trades.length === 0}
          >
            <Download size={13} strokeWidth={2} />
          </button>
          <button
            className="th-close th-icon-btn"
            onClick={closeModal}
            aria-label="Fermer le journal"
          >
            <X size={14} strokeWidth={2.4} />
          </button>
        </div>
      </div>

      {closedPositions.length > 0 && (
        <JournalFilters filter={filter} onChange={setFilter} setups={setups} shown={trades.length} total={closedPositions.length} />
      )}

      {/* Trois chiffres d'abord : combien, est-ce reproductible, à quel prix. */}
      <div className="th-stats th-stats-primary">
        <Stat label="Résultat net" hint={DEFINITIONS.net} value={formatMoney(m.totalPnL, { signed: true })} tone={signClass(m.totalPnL)} primary />
        <Stat
          label="Espérance"
          hint={DEFINITIONS.expectancy}
          value={m.averageR !== null ? formatR(m.averageR) : formatMoney(m.expectancy, { signed: true })}
          tone={signClass(m.averageR ?? m.expectancy)}
          primary
        />
        <Stat
          label="Drawdown max"
          hint={DEFINITIONS.drawdown}
          value={`${m.maxDrawdown.toFixed(2)} %`}
          tone={m.maxDrawdown > 0 ? 'negative' : ''}
          primary
        />
      </div>

      <div className="th-stats">
        <Stat label="Trades" hint="Nombre de trades clôturés, clôtures partielles comprises." value={String(m.totalTrades)} />
        <Stat label="Taux de réussite" hint={DEFINITIONS.winRate} value={`${m.winRate.toFixed(1)} %`} />
        <Stat label="Facteur de profit" hint={DEFINITIONS.profitFactor} value={formatProfitFactor(m.profitFactor)} />
        <Stat
          label="Gain / perte moyens"
          hint={DEFINITIONS.avg}
          value={`${formatMoney(m.averageWin)} / ${formatMoney(m.averageLoss)}`}
        />
      </div>

      <div id="equity-curve-container" className="th-equity">
        <svg
          id="equity-curve" className="th-equity-svg"
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Courbe du capital : de ${formatMoney(m.initialBalance)} à ${formatMoney(m.balance)}`}
        >
          {/* Capital initial : sans ce repère, une courbe ne dit pas si l'on
              est au-dessus ou en dessous du départ. */}
          <line
            x1={0}
            x2={svgW}
            y1={yOf(m.initialBalance)}
            y2={yOf(m.initialBalance)}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <polyline fill="none" stroke={curveColor} strokeWidth={2} points={polylinePts} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>

      <p className={`th-disclaimer ${costsEnabled ? '' : 'is-warning'}`}>
        {costsEnabled
          ? `Frais inclus : ${formatMoney(m.totalFees)} de spread, commissions et slippage. ${filtered ? 'Capital de la sélection' : 'Solde'} ${formatMoney(m.balance)}.`
          : `Frais désactivés : résultats hors spread, commissions et slippage, un compte réel ferait moins bien. ${filtered ? 'Capital de la sélection' : 'Solde'} ${formatMoney(m.balance)}.`}
      </p>

      <label className="th-capture-toggle">
        <input
          type="checkbox"
          checked={autoCapture}
          onChange={(e) => {
            setAutoCaptureEnabled(e.target.checked);
            setAutoCapture(e.target.checked);
          }}
        />
        <span>Capturer le graphique à chaque clôture</span>
      </label>

      <div className="th-list" id="th-list">
        {closedPositions.length === 0 ? (
          <div className="th-empty">
            Aucun trade clôturé pour l’instant.
            <br />
            Lancez un replay, passez un ordre avec Acheter ou Vendre : il apparaîtra ici à sa clôture.
          </div>
        ) : listed.length === 0 ? (
          <div className="th-empty">Aucun trade ne correspond à ces filtres.</div>
        ) : (
          listed.map((p) => (
            <TradeRow
              key={p.id}
              trade={p}
              fallbackSymbol={currentSymbol}
              setups={setups}
              expanded={p.id === expandedId}
              onToggle={() => setExpandedId((id) => (id === p.id ? null : p.id))}
            />
          ))
        )}
      </div>
    </div>
  );
};
