import React from 'react';
import { ChevronDown, Receipt } from 'lucide-react';
import { useTradeStore } from '../../store/useTradeStore';
import { useUIStore } from '../../store/useUIStore';
import { defaultCostSpec, resolveCosts } from '../../domain/trading-costs';
import { formatMoney, getInstrument } from '../../domain/instruments';

/** Empty field → `null` (instrument default); anything else must be ≥ 0. */
function readOptional(raw: string): number | null | undefined {
  if (raw.trim() === '') return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Trading-cost settings for the replay.
 *
 * Every figure the journal shows depends on them, so they sit next to the
 * balance rather than in a settings page: the trader sees at a glance whether
 * the results include costs, and what they are for the instrument on screen.
 */
export const CostsMenu: React.FC<{ symbol: string; price: number }> = ({ symbol, price }) => {
  const costs = useTradeStore((s) => s.costs);
  const setCosts = useTradeStore((s) => s.setCosts);
  const activeDropdown = useUIStore((s) => s.activeDropdown);
  const toggleDropdown = useUIStore((s) => s.toggleDropdown);
  const isOpen = activeDropdown === 'rp-costs';

  const spec = defaultCostSpec(symbol);
  const { pip } = getInstrument(symbol, price);
  const resolved = resolveCosts(symbol, price, costs);
  const spreadPips = pip > 0 ? resolved.spread / pip : 0;
  const defaultSpreadLabel =
    spec.spreadPips !== undefined ? `${spec.spreadPips} pips` : `${spec.spreadBps} pb du prix`;

  const summary = costs.enabled
    ? `${spreadPips.toFixed(1)} p · ${formatMoney(resolved.commissionPerLot)}`
    : 'désactivés';

  return (
    <div className="tv-dropdown rp-costs">
      <button
        type="button"
        className={`rp-costs-btn ${costs.enabled ? '' : 'is-off'}`}
        onClick={() => toggleDropdown('rp-costs')}
        title={`Spread, commission (par lot et par sens) et slippage appliqués aux ordres${costs.enabled ? '' : ' — actuellement désactivés'}`}
        aria-expanded={isOpen}
      >
        <Receipt size={11} strokeWidth={2} aria-hidden />
        <span>Frais {summary}</span>
        <ChevronDown size={9} strokeWidth={2.5} aria-hidden />
      </button>

      {isOpen && (
        <div className="tv-dropdown-menu show rp-costs-menu">
          <div className="dropdown-section-label">Frais de trading</div>

          <label className="rp-costs-toggle">
            <input
              type="checkbox"
              checked={costs.enabled}
              onChange={(e) => setCosts({ enabled: e.target.checked })}
            />
            <span>Inclure les frais dans les résultats</span>
          </label>

          <div className={`rp-costs-fields ${costs.enabled ? '' : 'is-disabled'}`}>
            <label>
              <span>Spread (pips)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                disabled={!costs.enabled}
                placeholder={`défaut : ${defaultSpreadLabel}`}
                defaultValue={costs.spreadPips ?? ''}
                onChange={(e) => {
                  const v = readOptional(e.target.value);
                  if (v !== undefined) setCosts({ spreadPips: v });
                }}
              />
            </label>
            <label>
              <span>Commission ($ par lot et par sens)</span>
              <input
                type="number"
                min="0"
                step="0.5"
                disabled={!costs.enabled}
                placeholder={`défaut : ${spec.commissionPerLot}`}
                defaultValue={costs.commissionPerLot ?? ''}
                onChange={(e) => {
                  const v = readOptional(e.target.value);
                  if (v !== undefined) setCosts({ commissionPerLot: v });
                }}
              />
            </label>
            <label>
              <span>Slippage sur les stops (pips)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                disabled={!costs.enabled}
                defaultValue={costs.slippagePips}
                onChange={(e) => {
                  const v = readOptional(e.target.value);
                  if (v !== undefined) setCosts({ slippagePips: v ?? 0 });
                }}
              />
            </label>
          </div>

          <p className="rp-costs-note">
            Les cours affichés sont des prix vendeur (bid) : un achat paie le spread à l’entrée, une vente à la
            sortie. Champ vide = valeur par défaut de l’instrument.
          </p>
        </div>
      )}
    </div>
  );
};
