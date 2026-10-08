import React from 'react';
import { Link2 } from 'lucide-react';
import { useMarketStore } from '../../store/useMarketStore';
import { useTradeStore } from '../../store/useTradeStore';
import { formatMoney, formatPrice } from '../../domain/instruments';
import { readPositiveNumber } from '../../domain/order-input';
import { OrderTicket } from './useOrderTicket';

/**
 * Entry, stop, target, risk and volume — in the order a decision is made — and
 * the one line that says what the order really risks.
 */
export const OrderTicketFields: React.FC<{ ticket: OrderTicket }> = ({ ticket }) => {
  const currentSymbol = useMarketStore((m) => m.currentSymbol);
  const { balance, riskPercent, quantity, setRiskPercent, setQuantity } = useTradeStore();
  const { entryInput, setEntryInput, slInput, setSlInput, tpInput, setTpInput, pip, riskEntry, riskStop, realRisk, riskOverrun } = ticket;

  // ── BLOC 3 : SAISIE D'ORDRE ──
  // Ordonné selon la chaîne de décision réelle : entrée → stop → objectif
  // → risque → volume. L'ordre précédent (risque, volume, puis entrée et
  // stop) demandait le volume avant les deux valeurs qui le déterminent.
  // Les règles de saisie remontent des infobulles vers les placeholders.
  return (
    <div className="rp-order-grid">
      <div className="rp-order-row">
      <div className="rp-input-subgroup">
        <div className="rp-input-box">
          <span className="rp-input-label">Entrée</span>
          <input
            type="text"
            id="trade-entry"
            placeholder="Au marché"
            aria-describedby="hint-entry"
            value={entryInput}
            onChange={(e) => setEntryInput(e.target.value)}
          />
        </div>

        <div className="rp-input-box">
          <span className="rp-input-label sl">Stop</span>
          <input
            type="text"
            id="trade-sl"
            placeholder="prix ou 30p"
            aria-describedby="hint-protection"
            value={slInput}
            onChange={(e) => setSlInput(e.target.value)}
          />
        </div>

        <div className="rp-input-box">
          <span className="rp-input-label tp">Objectif</span>
          <input
            type="text"
            id="trade-tp"
            placeholder="prix ou 60p"
            aria-describedby="hint-protection"
            value={tpInput}
            onChange={(e) => setTpInput(e.target.value)}
          />
        </div>
      </div>

      <div className="rp-input-subgroup">
        <div className="rp-input-box">
          <span className="rp-input-label">Risque %</span>
          <input
            type="number"
            id="trade-risk-pct"
            value={riskPercent}
            step="0.5"
            min="0.1"
            max="100"
            onChange={(e) => setRiskPercent(readPositiveNumber(e.target.value, riskPercent))}
          />
        </div>

        <div className="rp-sync-icon" aria-hidden="true">
          <Link2 size={12} strokeWidth={2.2} />
        </div>

        <div className="rp-input-box">
          <span className="rp-input-label">Volume</span>
          <input
            type="number"
            id="trade-qty"
            value={quantity}
            step="0.1"
            min="0.01"
            aria-describedby="hint-volume"
            onChange={(e) => setQuantity(readPositiveNumber(e.target.value, quantity))}
          />
        </div>
      </div>
      </div>

      {/* Une seule ligne visible, celle qui change la décision : ce que
          l'ordre risque vraiment. La syntaxe n'apparaît que tant qu'aucun
          stop n'est saisi ; les aides complètes restent décrites pour les
          lecteurs d'écran (`aria-describedby`). Trois aides permanentes
          faisaient une ligne plus large que la barre. */}
      <div className="rp-order-hints">
        <span id="hint-entry" className="sr-only">Entrée vide : ordre au marché. Un autre prix crée un ordre en attente.</span>
        <span id="hint-protection" className="sr-only">Stop et objectif : un prix, un nombre de pips comme 30p, ou un pourcentage comme 1,5 %.</span>
        <span id="hint-volume" className={`derived ${riskOverrun ? 'is-warning' : ''}`}>
          {realRisk === null || riskStop === null
            ? 'Stop et objectif : un prix, 30p ou 1,5 % · entrée vide = au marché · le volume suit le risque.'
            : `${
                // Saisie relative (« 30p », « 1,5 % ») : le côté du stop dépend
                // du bouton qui sera cliqué, donc on donne la distance, pas un
                // prix qui serait faux pour une vente.
                /[p%]/i.test(slInput)
                  ? `Stop à ${(Math.abs(riskEntry - riskStop) / pip).toFixed(1)} pips de l’entrée`
                  : `Stop ${formatPrice(currentSymbol, riskStop)}`
              } · perte au stop ${formatMoney((balance * realRisk) / 100)} (${realRisk.toFixed(1)} %)${
                riskOverrun ? ' — au-dessus du risque demandé : volume au lot minimum.' : ''
              }`}
        </span>
      </div>
    </div>
  );
};
