import React, { useId, useState } from 'react';
import { Camera, ChevronDown, NotebookPen } from 'lucide-react';
import { useTradeStore } from '../../../store/useTradeStore';
import { formatMoney, formatPrice, unitsToLots } from '../../../domain/instruments';
import { EMOTIONS, Position } from '../../../types/trading';
import { TradeCaptureThumb } from './TradeCaptureThumb';
import { formatR } from '../../../domain/journal';

interface TradeRowProps {
  readonly trade: Position;
  /** Instrument on screen, for trades saved without one. */
  readonly fallbackSymbol: string;
  /** Setups already used, offered as suggestions. */
  readonly setups: readonly string[];
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

/**
 * One closed trade: its figures, and once opened, what the trader writes about
 * it — the setup, how they felt, a note — with the chart at its close.
 */
export const TradeRow: React.FC<TradeRowProps> = ({ trade, fallbackSymbol, setups, expanded, onToggle }) => {
  const annotate = useTradeStore((s) => s.annotate);
  const markScreenshot = useTradeStore((s) => s.markScreenshot);
  // Drafts, written to the store on blur: writing on every keystroke would trim
  // the space the trader just typed between two words.
  const [setupDraft, setSetupDraft] = useState(trade.annotation?.setup ?? '');
  const [noteDraft, setNoteDraft] = useState(trade.annotation?.note ?? '');
  const detailsId = useId();
  const setupListId = useId();

  const symbol = trade.symbol ?? fallbackSymbol;
  const pnl = trade.pnl ?? 0;
  const r = trade.riskAmount ? pnl / trade.riskAmount : null;
  const tone = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : '';
  const closedAt = trade.closeTime ?? trade.time;
  const { annotation } = trade;
  const hasNotes = Boolean(annotation?.setup || annotation?.emotion || annotation?.note);

  return (
    <div className={`th-trade ${expanded ? 'is-expanded' : ''}`}>
      <button
        type="button"
        className="th-trade-row"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className={`th-badge ${trade.type.toLowerCase()}`}>{trade.type === 'LONG' ? 'ACHAT' : 'VENTE'}</span>
        <span className="th-trade-info">
          <span className="th-trade-price">
            {/* Precision comes from the instrument catalogue, never from the
                magnitude of the price. */}
            {formatPrice(symbol, trade.entry)} →{' '}
            {trade.exitPrice === undefined ? '—' : formatPrice(symbol, trade.exitPrice)} ·{' '}
            {unitsToLots(symbol, trade.size).toFixed(2)} lot
          </span>
          <span className="th-trade-meta">
            {new Date(closedAt * 1000).toLocaleString('fr-FR', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' })}{' '}
            UTC · {trade.closeReason === 'TP' ? 'objectif' : trade.closeReason === 'SL' ? 'stop' : 'manuel'}
            {r !== null ? ` · ${formatR(r)}` : ''}
            {trade.fees ? ` · frais ${formatMoney(trade.fees)}` : ''}
          </span>
          {/* Not while open: the badge appearing when the setup field loses
              focus pushed the editor down between mousedown and mouseup, and
              the click meant for an emotion landed beside it. */}
          {annotation?.setup && !expanded && <span className="th-trade-setup">{annotation.setup}</span>}
        </span>
        <span className="th-trade-icons" aria-hidden>
          {hasNotes && <NotebookPen size={11} />}
          {trade.hasScreenshot && <Camera size={11} />}
        </span>
        <span className={`th-trade-pnl ${tone}`}>{formatMoney(pnl, { signed: true })}</span>
        <ChevronDown size={12} className="th-trade-chevron" aria-hidden />
      </button>

      {expanded && (
        <div className="trade-notes" id={detailsId}>
          <label className="trade-notes-field">
            <span>Setup</span>
            <input
              type="text"
              value={setupDraft}
              maxLength={40}
              list={setupListId}
              placeholder="cassure, retour sur zone…"
              onChange={(e) => setSetupDraft(e.target.value)}
              onBlur={() => annotate(trade.id, { setup: setupDraft })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
            <datalist id={setupListId}>
              {setups.map((setup) => (
                <option key={setup} value={setup} />
              ))}
            </datalist>
          </label>

          <div className="trade-notes-field">
            <span id={`${detailsId}-emotion`}>État d’esprit</span>
            <div className="trade-emotions" role="radiogroup" aria-labelledby={`${detailsId}-emotion`}>
              {EMOTIONS.map((emotion) => (
                <button
                  key={emotion}
                  type="button"
                  role="radio"
                  aria-checked={annotation?.emotion === emotion}
                  className={`trade-emotion ${annotation?.emotion === emotion ? 'active' : ''}`}
                  // A second click on the chosen emotion clears it.
                  onClick={() => annotate(trade.id, { emotion: annotation?.emotion === emotion ? undefined : emotion })}
                >
                  {emotion}
                </button>
              ))}
            </div>
          </div>

          <label className="trade-notes-field">
            <span>Note</span>
            <textarea
              value={noteDraft}
              maxLength={2000}
              rows={3}
              placeholder="Ce qui a motivé l’entrée, ce qui s’est passé, ce que vous referiez."
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => annotate(trade.id, { note: noteDraft })}
            />
          </label>

          {trade.hasScreenshot && (
            <TradeCaptureThumb tradeId={trade.id} onDeleted={() => markScreenshot(trade.id, false)} />
          )}
        </div>
      )}
    </div>
  );
};
