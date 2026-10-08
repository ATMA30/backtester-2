/**
 * Single source of truth for instrument metadata (pip size, price precision,
 * contract size, asset class).
 *
 * Before this module the codebase derived pip and decimals inline in ~20 places
 * with three mutually inconsistent heuristics:
 *   - `symbol.includes('JPY') ? 0.01 : 0.0001`  (services, DrawingCanvas, ReplayBar)
 *   - `entry < 200`                             (useTradeStore, to detect forex)
 *   - `symbol.length === 6`                     (ReplayBar, to detect forex)
 * Those disagreed on XAUUSD (6 chars, priced ~2600), on indices, and on crypto,
 * which produced wrong position sizes and wrong price formatting. Everything now
 * resolves through `getInstrument()`.
 */

import { usdPerUnitAt } from './fx-rates';

export type AssetClass = 'forex' | 'metal' | 'energy' | 'index' | 'crypto' | 'synthetic';

/** Display groups, in the order the instrument pickers render them. */
export const MARKET_CATEGORIES = [
  'Forex Majors',
  'Forex Minors',
  'Métaux & Matières',
  'Indices Mondiaux',
  'Indices Synthétiques (Deriv)',
  'Crypto',
  'Personnalisé',
] as const;

export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

export interface InstrumentSpec {
  readonly symbol: string;
  readonly label: string;
  readonly category: MarketCategory;
  readonly assetClass: AssetClass;
  /** Smallest conventional price increment (1 pip / 1 point). */
  readonly pip: number;
  /** Digits to render after the decimal separator. */
  readonly decimals: number;
  /**
   * Units of the base asset in one standard lot. Position sizes are always
   * stored in UNITS so that `pnl = (exit - entry) * units` holds for every
   * asset class; lots are a presentation concern (`unitsToLots`).
   */
  readonly contractSize: number;
  readonly derivSymbol?: string;
  readonly binanceSymbol?: string;
}

/** Catalogue entry before defaults are applied. */
type CatalogEntry = Omit<InstrumentSpec, 'contractSize'> & { contractSize?: number };

const DEFAULT_CONTRACT_SIZE: Record<AssetClass, number> = {
  forex: 100_000,
  metal: 100,
  energy: 1_000,
  index: 1,
  crypto: 1,
  synthetic: 1,
};

function entry(
  symbol: string,
  label: string,
  category: MarketCategory,
  assetClass: AssetClass,
  decimals: number,
  pip: number,
  extra: Partial<Pick<InstrumentSpec, 'derivSymbol' | 'binanceSymbol' | 'contractSize'>> = {}
): CatalogEntry {
  return { symbol, label, category, assetClass, decimals, pip, ...extra };
}

const FOREX_MAJORS: MarketCategory = 'Forex Majors';
const FOREX_MINORS: MarketCategory = 'Forex Minors';
const METALS: MarketCategory = 'Métaux & Matières';
const INDICES: MarketCategory = 'Indices Mondiaux';
const SYNTHETICS: MarketCategory = 'Indices Synthétiques (Deriv)';
const CRYPTO: MarketCategory = 'Crypto';

const CATALOG: readonly CatalogEntry[] = [
  // ── Forex Majors ──
  entry('EURUSD', 'EUR / USD (Euro / US Dollar)', FOREX_MAJORS, 'forex', 5, 0.0001, { derivSymbol: 'frxEURUSD' }),
  entry('GBPUSD', 'GBP / USD (Livre / US Dollar)', FOREX_MAJORS, 'forex', 5, 0.0001, { derivSymbol: 'frxGBPUSD' }),
  entry('USDJPY', 'USD / JPY (US Dollar / Yen Japonais)', FOREX_MAJORS, 'forex', 3, 0.01, { derivSymbol: 'frxUSDJPY' }),
  entry('USDCHF', 'USD / CHF (US Dollar / Franc Suisse)', FOREX_MAJORS, 'forex', 5, 0.0001, { derivSymbol: 'frxUSDCHF' }),
  entry('AUDUSD', 'AUD / USD (Dollar Aussie / US Dollar)', FOREX_MAJORS, 'forex', 5, 0.0001, { derivSymbol: 'frxAUDUSD' }),
  entry('USDCAD', 'USD / CAD (US Dollar / Dollar Canadien)', FOREX_MAJORS, 'forex', 5, 0.0001, { derivSymbol: 'frxUSDCAD' }),
  entry('NZDUSD', 'NZD / USD (Dollar Kiwi / US Dollar)', FOREX_MAJORS, 'forex', 5, 0.0001, { derivSymbol: 'frxNZDUSD' }),

  // ── Forex Minors ──
  entry('EURGBP', 'EUR / GBP (Euro / Livre)', FOREX_MINORS, 'forex', 5, 0.0001, { derivSymbol: 'frxEURGBP' }),
  entry('EURJPY', 'EUR / JPY (Euro / Yen)', FOREX_MINORS, 'forex', 3, 0.01, { derivSymbol: 'frxEURJPY' }),
  entry('GBPJPY', 'GBP / JPY (Livre / Yen)', FOREX_MINORS, 'forex', 3, 0.01, { derivSymbol: 'frxGBPJPY' }),
  entry('AUDJPY', 'AUD / JPY (Aussie / Yen)', FOREX_MINORS, 'forex', 3, 0.01, { derivSymbol: 'frxAUDJPY' }),
  entry('CADJPY', 'CAD / JPY (Dollar Canadien / Yen)', FOREX_MINORS, 'forex', 3, 0.01, { derivSymbol: 'frxCADJPY' }),
  entry('CHFJPY', 'CHF / JPY (Franc Suisse / Yen)', FOREX_MINORS, 'forex', 3, 0.01, { derivSymbol: 'frxCHFJPY' }),
  entry('NZDJPY', 'NZD / JPY (Kiwi / Yen)', FOREX_MINORS, 'forex', 3, 0.01, { derivSymbol: 'frxNZDJPY' }),
  entry('EURAUD', 'EUR / AUD (Euro / Aussie)', FOREX_MINORS, 'forex', 5, 0.0001, { derivSymbol: 'frxEURAUD' }),
  entry('EURCAD', 'EUR / CAD (Euro / Dollar Canadien)', FOREX_MINORS, 'forex', 5, 0.0001, { derivSymbol: 'frxEURCAD' }),
  entry('EURCHF', 'EUR / CHF (Euro / Franc Suisse)', FOREX_MINORS, 'forex', 5, 0.0001, { derivSymbol: 'frxEURCHF' }),
  entry('GBPAUD', 'GBP / AUD (Livre / Aussie)', FOREX_MINORS, 'forex', 5, 0.0001, { derivSymbol: 'frxGBPAUD' }),
  entry('GBPCAD', 'GBP / CAD (Livre / Dollar Canadien)', FOREX_MINORS, 'forex', 5, 0.0001, { derivSymbol: 'frxGBPCAD' }),
  entry('GBPCHF', 'GBP / CHF (Livre / Franc Suisse)', FOREX_MINORS, 'forex', 5, 0.0001, { derivSymbol: 'frxGBPCHF' }),

  // ── Metals & Energy ──
  entry('XAUUSD', 'XAU / USD (Or / Gold Spot)', METALS, 'metal', 2, 0.01, { derivSymbol: 'frxXAUUSD', contractSize: 100 }),
  entry('XAGUSD', 'XAG / USD (Argent / Silver Spot)', METALS, 'metal', 3, 0.01, { derivSymbol: 'frxXAGUSD', contractSize: 5_000 }),
  entry('USOIL', 'Pétrole Brut WTI (Crude Oil)', METALS, 'energy', 2, 0.01, { contractSize: 1_000 }),
  entry('UKOIL', 'Pétrole Brent (Brent Oil)', METALS, 'energy', 2, 0.01, { contractSize: 1_000 }),

  // ── Indices ──
  entry('SPX500', 'S&P 500 (US 500 Index)', INDICES, 'index', 2, 0.1, { derivSymbol: 'OTC_SPC' }),
  entry('NAS100', 'Nasdaq 100 (US Tech Index)', INDICES, 'index', 2, 0.1, { derivSymbol: 'OTC_NDX' }),

  // ── Deriv synthetics ──
  entry('R_10', 'Volatility 10 Index', SYNTHETICS, 'synthetic', 3, 0.001, { derivSymbol: 'R_10' }),
  entry('R_25', 'Volatility 25 Index', SYNTHETICS, 'synthetic', 3, 0.001, { derivSymbol: 'R_25' }),
  entry('R_50', 'Volatility 50 Index', SYNTHETICS, 'synthetic', 4, 0.0001, { derivSymbol: 'R_50' }),
  entry('R_75', 'Volatility 75 Index', SYNTHETICS, 'synthetic', 4, 0.0001, { derivSymbol: 'R_75' }),
  entry('R_100', 'Volatility 100 Index', SYNTHETICS, 'synthetic', 2, 0.01, { derivSymbol: 'R_100' }),
  entry('1HZ10V', 'Volatility 10 (1s) Index', SYNTHETICS, 'synthetic', 2, 0.01, { derivSymbol: '1HZ10V' }),
  entry('1HZ100V', 'Volatility 100 (1s) Index', SYNTHETICS, 'synthetic', 2, 0.01, { derivSymbol: '1HZ100V' }),
  entry('BOOM500', 'Boom 500 Index', SYNTHETICS, 'synthetic', 3, 0.001, { derivSymbol: 'BOOM500' }),
  entry('CRASH500', 'Crash 500 Index', SYNTHETICS, 'synthetic', 3, 0.001, { derivSymbol: 'CRASH500' }),

  // ── Crypto ──
  entry('BTCUSDT', 'BTC / USDT (Bitcoin)', CRYPTO, 'crypto', 2, 0.1, { binanceSymbol: 'BTCUSDT' }),
  entry('ETHUSDT', 'ETH / USDT (Ethereum)', CRYPTO, 'crypto', 2, 0.01, { binanceSymbol: 'ETHUSDT' }),
  entry('SOLUSDT', 'SOL / USDT (Solana)', CRYPTO, 'crypto', 2, 0.01, { binanceSymbol: 'SOLUSDT' }),
  entry('BNBUSDT', 'BNB / USDT (BNB)', CRYPTO, 'crypto', 2, 0.01, { binanceSymbol: 'BNBUSDT' }),
  entry('XRPUSDT', 'XRP / USDT (Ripple)', CRYPTO, 'crypto', 4, 0.0001, { binanceSymbol: 'XRPUSDT' }),
  entry('ADAUSDT', 'ADA / USDT (Cardano)', CRYPTO, 'crypto', 4, 0.0001, { binanceSymbol: 'ADAUSDT' }),
  entry('DOGEUSDT', 'DOGE / USDT (Dogecoin)', CRYPTO, 'crypto', 5, 0.00001, { binanceSymbol: 'DOGEUSDT' }),
];

function withDefaults(e: CatalogEntry): InstrumentSpec {
  return { ...e, contractSize: e.contractSize ?? DEFAULT_CONTRACT_SIZE[e.assetClass] };
}

/** Catalogue of every instrument the app ships with, in display order. */
export const INSTRUMENTS: readonly InstrumentSpec[] = CATALOG.map(withDefaults);

const BY_SYMBOL: ReadonlyMap<string, InstrumentSpec> = new Map(
  INSTRUMENTS.map((i) => [i.symbol, i])
);

const CURRENCY_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD',
  'MXN', 'ZAR', 'TRY', 'SGD', 'NOK', 'SEK', 'PLN', 'HKD', 'CNH', 'DKK', 'CZK', 'HUF',
]);

function classifyUnknown(symbol: string): AssetClass {
  if (/^(R_|1HZ|BOOM|CRASH|STEP|JUMP)/.test(symbol)) return 'synthetic';
  if (/XAU|GOLD|XAG|SILVER|XPT|XPD/.test(symbol)) return 'metal';
  if (/OIL|WTI|BRENT|NGAS/.test(symbol)) return 'energy';
  if (/USDT$|USDC$|BTC|ETH|SOL|BNB|XRP|ADA|DOGE/.test(symbol)) return 'crypto';
  if (symbol.length === 6 && CURRENCY_CODES.has(symbol.slice(0, 3)) && CURRENCY_CODES.has(symbol.slice(3))) {
    return 'forex';
  }
  return 'index';
}

/**
 * Precision fallback for symbols outside the catalogue (user-imported datasets).
 * Derived from the asset class, refined by a reference price when one is known —
 * an instrument quoted at 65 000 never needs five decimals, one quoted at 1.08 does.
 */
function inferSpec(symbol: string, referencePrice?: number): InstrumentSpec {
  const assetClass = classifyUnknown(symbol);
  const hasRef = typeof referencePrice === 'number' && Number.isFinite(referencePrice) && referencePrice > 0;

  let decimals: number;
  if (assetClass === 'forex') {
    decimals = symbol.slice(3) === 'JPY' || symbol.includes('JPY') ? 3 : 5;
  } else if (hasRef) {
    decimals = referencePrice >= 1_000 ? 2 : referencePrice >= 10 ? 3 : referencePrice >= 1 ? 4 : 5;
  } else {
    decimals = 2;
  }

  return {
    symbol,
    label: symbol,
    category: 'Personnalisé',
    assetClass,
    decimals,
    pip: 10 ** -Math.max(0, decimals - 1),
    contractSize: DEFAULT_CONTRACT_SIZE[assetClass],
  };
}

/**
 * Resolve instrument metadata. Never returns null: unknown symbols (imported
 * datasets, ad-hoc tickers) get a documented, deterministic inferred spec so
 * callers never have to re-implement a fallback heuristic.
 *
 * @param referencePrice Optional recent price, used only to refine the decimal
 *   precision of symbols absent from the catalogue.
 */
export function getInstrument(symbol: string, referencePrice?: number): InstrumentSpec {
  const normalized = (symbol || '').trim().toUpperCase();
  return BY_SYMBOL.get(normalized) ?? inferSpec(normalized, referencePrice);
}

/** Pip size for a symbol. Prefer `getInstrument` when several fields are needed. */
export function pipOf(symbol: string, referencePrice?: number): number {
  return getInstrument(symbol, referencePrice).pip;
}

/** Format a price with the instrument's conventional precision. */
export function formatPrice(symbol: string, price: number): string {
  if (!Number.isFinite(price)) return '—';
  return price.toFixed(getInstrument(symbol, price).decimals);
}

// ── ACCOUNT CURRENCY ─────────────────────────────────────────

/**
 * Currencies an account can be denominated in: those the ECB publishes against
 * the dollar, so every conversion has a daily rate behind it.
 */
export const ACCOUNT_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD'] as const;
export type AccountCurrency = (typeof ACCOUNT_CURRENCIES)[number];

export function isAccountCurrency(value: unknown): value is AccountCurrency {
  return typeof value === 'string' && (ACCOUNT_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Currency the simulated account is denominated in.
 *
 * Module state, like the conversion clock of `fx-rates`: sizing, costs and P&L
 * all convert through `quoteToAccountRate`, and threading the currency through
 * each of their signatures would let one call site forget it. The trade store
 * is the only writer (`setAccountCurrency`), so the two cannot disagree.
 */
let accountCurrency: AccountCurrency = 'USD';

export function getAccountCurrency(): AccountCurrency {
  return accountCurrency;
}

export function setAccountCurrency(currency: AccountCurrency): void {
  accountCurrency = currency;
}

/**
 * Approximate value of one unit of each currency, in USD.
 *
 * Only used when no ECB rate is loaded and the instrument's own price cannot
 * give the conversion. A reference table off by a few percent is a far smaller
 * error than the one it replaced: the P&L was booked in the *quote* currency
 * and displayed in dollars, so one lot of USDJPY moving by one yen showed
 * +$100 000 instead of about +$640.
 */
const APPROX_USD_PER_UNIT: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  CHF: 1.12,
  AUD: 0.66,
  CAD: 0.73,
  NZD: 0.6,
  MXN: 0.055,
  ZAR: 0.054,
  TRY: 0.03,
  SGD: 0.74,
  NOK: 0.093,
  SEK: 0.095,
  PLN: 0.25,
  HKD: 0.128,
  CNH: 0.138,
  DKK: 0.145,
  CZK: 0.043,
  HUF: 0.0027,
};

/** Quote currency of a forex pair, or `null` for instruments quoted in USD. */
export function quoteCurrencyOf(symbol: string): string | null {
  const normalized = (symbol || '').trim().toUpperCase();
  if (getInstrument(normalized).assetClass !== 'forex') return null;
  return normalized.slice(3, 6);
}

/**
 * USD value of one unit of `currency`, as exactly as `symbol` allows: its own
 * price when it pairs that currency with the dollar (EURUSD for EUR, USDJPY for
 * JPY), the ECB rate of the day otherwise, the reference table as a last resort.
 */
function usdPerUnit(currency: string, symbol: string, price: number, time?: number | null): number {
  if (currency === 'USD') return 1;
  const pair = (symbol || '').trim().toUpperCase();
  if (quoteCurrencyOf(pair) !== null && Number.isFinite(price) && price > 0) {
    if (pair.slice(0, 3) === currency && pair.slice(3, 6) === 'USD') return price;
    if (pair.slice(0, 3) === 'USD' && pair.slice(3, 6) === currency) return 1 / price;
  }
  return usdPerUnitAt(currency, time) ?? APPROX_USD_PER_UNIT[currency] ?? 1;
}

/**
 * Multiplier turning an amount in the instrument's quote currency into the
 * account currency.
 *
 * - quote in the account currency (EURUSD on a USD account) → 1;
 * - base in the account currency (USDJPY on a USD account, EURGBP on a EUR
 *   one) → `1 / price`, exact at that price;
 * - anything else goes through the dollar, `usdPerUnit(quote) /
 *   usdPerUnit(account)`, each leg exact when the pair provides it and taken
 *   from the ECB rate of that day otherwise.
 *
 * Instruments that are not forex pairs (metals, indices, crypto, synthetics)
 * are quoted in USD.
 *
 * @param price Price of the instrument at which the amount is realised.
 */
export function quoteToAccountRate(symbol: string, price: number, time?: number | null): number {
  const account = accountCurrency;
  const quote = quoteCurrencyOf(symbol) ?? 'USD';
  if (quote === account) return 1;

  const base = (symbol || '').trim().toUpperCase().slice(0, 3);
  if (quoteCurrencyOf(symbol) !== null && base === account && Number.isFinite(price) && price > 0) return 1 / price;

  const rate = usdPerUnit(quote, symbol, price, time) / usdPerUnit(account, symbol, price, time);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/**
 * Format an amount in the account currency: `+$1,234.56`, `-€12.00`.
 * `currency` for an amount of another account (a saved session).
 */
export function formatMoney(
  amount: number,
  { signed = false, currency = accountCurrency }: { signed?: boolean; currency?: AccountCurrency } = {}
): string {
  if (!Number.isFinite(amount)) return '—';
  const abs = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  const sign = amount < 0 ? '-' : signed && amount > 0 ? '+' : '';
  return `${sign}${abs}`;
}

/** Convert a size expressed in base-asset units into standard lots. */
export function unitsToLots(symbol: string, units: number): number {
  const { contractSize } = getInstrument(symbol);
  return contractSize > 0 ? units / contractSize : units;
}

/** Convert standard lots into base-asset units. */
export function lotsToUnits(symbol: string, lots: number): number {
  return lots * getInstrument(symbol).contractSize;
}
