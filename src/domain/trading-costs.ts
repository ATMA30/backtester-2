/**
 * Trading costs: spread, commission and slippage.
 *
 * The engine used to fill every order at the exact displayed price and charge
 * nothing, so every backtest was systematically optimistic — a scalping method
 * that looked profitable could lose money on any real account. Prices in the
 * data are treated as **bid**; buying pays the ask (`bid + spread`), selling
 * receives the bid. Commission is charged per lot and per side; slippage is an
 * adverse offset on orders that execute at market (market entries, stop
 * orders, stop losses) — never on limit fills.
 *
 * Defaults are those of a typical retail ECN account. They are deliberately
 * conservative and the user can override every value.
 */

import { AssetClass, getInstrument, quoteToAccountRate, unitsToLots } from './instruments';
import { PositionType } from '../types/trading';

/** How the spread of an instrument is expressed. */
export interface CostSpec {
  /** Spread in pips (forex, metals, indices), or… */
  readonly spreadPips?: number;
  /** …in basis points of the price (crypto, synthetics). */
  readonly spreadBps?: number;
  /** Commission in account currency, per standard lot, per side. */
  readonly commissionPerLot: number;
}

const DEFAULTS_BY_CLASS: Readonly<Record<AssetClass, CostSpec>> = {
  forex: { spreadPips: 1.0, commissionPerLot: 3.5 },
  metal: { spreadPips: 20, commissionPerLot: 3.5 },
  energy: { spreadPips: 3, commissionPerLot: 0 },
  index: { spreadPips: 5, commissionPerLot: 0 },
  crypto: { spreadBps: 2, commissionPerLot: 0 },
  synthetic: { spreadBps: 1, commissionPerLot: 0 },
};

/** Per-instrument spreads where the class default is too far off. */
const OVERRIDES: Readonly<Record<string, Partial<CostSpec>>> = {
  EURUSD: { spreadPips: 0.2 },
  GBPUSD: { spreadPips: 0.5 },
  USDJPY: { spreadPips: 0.3 },
  USDCHF: { spreadPips: 0.5 },
  AUDUSD: { spreadPips: 0.4 },
  USDCAD: { spreadPips: 0.5 },
  NZDUSD: { spreadPips: 0.6 },
  EURGBP: { spreadPips: 0.5 },
  EURJPY: { spreadPips: 0.7 },
  GBPJPY: { spreadPips: 1.5 },
  XAGUSD: { spreadPips: 3 },
  NAS100: { spreadPips: 10 },
};

/** Default cost spec for a symbol. */
export function defaultCostSpec(symbol: string): CostSpec {
  const { assetClass, symbol: normalized } = getInstrument(symbol);
  return { ...DEFAULTS_BY_CLASS[assetClass], ...OVERRIDES[normalized] };
}

/** User preferences. `null` means "use the instrument default". */
export interface CostSettings {
  readonly enabled: boolean;
  readonly spreadPips: number | null;
  readonly commissionPerLot: number | null;
  readonly slippagePips: number;
}

export const DEFAULT_COST_SETTINGS: CostSettings = {
  enabled: true,
  spreadPips: null,
  commissionPerLot: null,
  slippagePips: 0,
};

/** Costs resolved for one instrument, in price units and account currency. */
export interface ResolvedCosts {
  /** Ask minus bid, in price units, at the given price. */
  readonly spread: number;
  /** Adverse offset on market executions, in price units. */
  readonly slippage: number;
  readonly commissionPerLot: number;
}

const NO_COSTS: ResolvedCosts = { spread: 0, slippage: 0, commissionPerLot: 0 };

function nonNegative(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

export function resolveCosts(symbol: string, price: number, settings: CostSettings): ResolvedCosts {
  if (!settings.enabled) return NO_COSTS;
  const { pip } = getInstrument(symbol, price);
  const spec = defaultCostSpec(symbol);

  const spreadPips = nonNegative(settings.spreadPips);
  const spread =
    spreadPips !== null
      ? spreadPips * pip
      : spec.spreadPips !== undefined
        ? spec.spreadPips * pip
        : Number.isFinite(price) && price > 0
          ? (price * (spec.spreadBps ?? 0)) / 10_000
          : 0;

  return {
    spread,
    slippage: (nonNegative(settings.slippagePips) ?? 0) * pip,
    commissionPerLot: nonNegative(settings.commissionPerLot) ?? spec.commissionPerLot,
  };
}

/** Price paid to open at market: the ask for a buy, the bid for a sell, minus slippage. */
export function marketEntryPrice(type: PositionType, bid: number, costs: ResolvedCosts): number {
  return type === 'LONG' ? bid + costs.spread + costs.slippage : bid - costs.slippage;
}

/** Price received to close at market: the bid for a long, the ask for a short. */
export function marketExitPrice(type: PositionType, bid: number, costs: ResolvedCosts): number {
  return type === 'LONG' ? bid - costs.slippage : bid + costs.spread + costs.slippage;
}

/** Commission for `units` on one side, in account currency. */
export function commissionFor(symbol: string, units: number, costs: ResolvedCosts): number {
  const fee = unitsToLots(symbol, units) * costs.commissionPerLot;
  return Number.isFinite(fee) && fee > 0 ? fee : 0;
}

/**
 * Account-currency cost of trading one unit round trip, beyond the stop
 * distance itself: the spread paid on entry and the two commissions. Used by
 * risk sizing so that "risk 1 %" still means 1 % once costs are counted.
 */
export function roundTripCostPerUnit(symbol: string, price: number, costs: ResolvedCosts): number {
  const perUnitSpread = (costs.spread + costs.slippage) * quoteToAccountRate(symbol, price);
  const perUnitCommission = (2 * costs.commissionPerLot) / getInstrument(symbol).contractSize;
  const total = perUnitSpread + perUnitCommission;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/** Validate costs read back from storage — untrusted like any persisted data. */
export function parseCostSettings(value: unknown): CostSettings {
  if (!value || typeof value !== 'object') return DEFAULT_COST_SETTINGS;
  const v = value as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' ? nonNegative(x) : null);
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : true,
    spreadPips: num(v.spreadPips),
    commissionPerLot: num(v.commissionPerLot),
    slippagePips: num(v.slippagePips) ?? 0,
  };
}
