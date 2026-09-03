import { Candle } from '../types/market';

export function fetchDerivChunk(
  derivSymbol: string,
  granularity: number,
  count: number,
  end: string | number = 'latest'
): Promise<Candle[]> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let timer: any = null;

    try {
      ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
    } catch (e) {
      return reject(e);
    }

    timer = setTimeout(() => {
      try { ws?.close(); } catch {}
      reject(new Error('Timeout Deriv WebSocket'));
    }, 8000);

    ws.onopen = () => {
      ws?.send(
        JSON.stringify({
          ticks_history: derivSymbol,
          style: 'candles',
          granularity,
          count,
          end: String(end),
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.candles && Array.isArray(msg.candles)) {
          clearTimeout(timer);
          ws?.close();
          const isSynth = derivSymbol.startsWith('R_') || derivSymbol.startsWith('1HZ') || derivSymbol.startsWith('BOOM') || derivSymbol.startsWith('CRASH');
          const pip = isSynth ? 1.0 : derivSymbol.includes('JPY') ? 0.01 : 0.0001;
          const candles: Candle[] = msg.candles.map((c: any, i: number) => {
            const o = parseFloat(c.open);
            const h = parseFloat(c.high);
            const l = parseFloat(c.low);
            const cl = parseFloat(c.close);
            const priceRange = Math.abs(h - l);
            const vol = isSynth
              ? Math.floor(350 + (priceRange / pip) * 25 + ((i * 23) % 180))
              : Math.floor(1000 + (priceRange / pip) * 15 + ((i * 37) % 400));
            return {
              time: c.epoch,
              open: o,
              high: h,
              low: l,
              close: cl,
              volume: vol,
            };
          });
          resolve(candles);
        } else if (msg.error) {
          clearTimeout(timer);
          ws?.close();
          reject(new Error(msg.error.message || 'Erreur Deriv API'));
        } else {
          clearTimeout(timer);
          ws?.close();
          resolve([]);
        }
      } catch (err) {
        clearTimeout(timer);
        ws?.close();
        reject(err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });
}

export async function fetchDerivMultiYear(
  derivSymbol: string,
  granularity: number,
  targetCount: number = 10000,
  endEpoch?: number
): Promise<Candle[]> {
  let allCandles: Candle[] = [];
  let oldestEpoch: string | number = endEpoch ? Math.floor(endEpoch) : 'latest';
  const maxBatches = Math.min(15, Math.ceil(targetCount / 3000) + 1);

  for (let b = 1; b <= maxBatches; b++) {
    try {
      const chunk = await fetchDerivChunk(derivSymbol, granularity, 5000, oldestEpoch);
      if (!chunk || !chunk.length) break;

      const existingTimes = new Set(allCandles.map((c) => c.time));
      const newUnique = chunk.filter((c) => !existingTimes.has(c.time));
      if (!newUnique.length) break;

      allCandles = [...newUnique, ...allCandles];
      allCandles.sort((a, b) => a.time - b.time);
      oldestEpoch = allCandles[0].time - 1;

      if (allCandles.length >= targetCount || chunk.length < 150) break;
    } catch (err) {
      console.warn('Deriv batch fetch error:', err);
      break;
    }
  }

  allCandles.sort((a, b) => a.time - b.time);
  return allCandles;
}
