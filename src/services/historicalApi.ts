import { Candle } from '../types/market';

export async function fetchHistoricalData(
  symbol: string,
  interval: string = '1d',
  range: string = '10y'
): Promise<Candle[] | null> {
  try {
    const url = `/api/history?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    if (json && Array.isArray(json.candles) && json.candles.length > 0) {
      return json.candles;
    }
  } catch (e) {
    console.warn('Historical API fetch failed:', e);
  }
  return null;
}
