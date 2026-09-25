import { Candle, MarketRegime, SwingPoint, Level } from '@di/shared';
import { atr, closes, ema, rsi, sma, stddev } from '@di/indicator-engine';

/**
 * ANALYSIS ENGINE (spec §27–§30)
 * - Market structure: HH/HL/LH/LL, BOS, CHoCH, swings, range/consolidation/expansion
 * - Price action patterns (single patterns are never a complete decision — §28)
 * - Support/resistance levels with price/strength/touches/age/timeframe/type
 * - Market regime detection
 */

export function swings(candles: Candle[], lookback = 2): SwingPoint[] {
  const pts: SwingPoint[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  // Interior pivots dominate their full neighbourhood; the final bar is always
  // evaluated so a rising/falling window registers its terminal swing point.
  for (let i = 0; i < candles.length; i++) {
    const interior = i >= lookback && i <= candles.length - 1 - lookback;
    if (!interior && i !== candles.length - 1) continue;
    const window = candles.slice(i - lookback, i + lookback + 1);
    const isHigh = window.every((c) => c.high <= candles[i].high);
    const isLow = window.every((c) => c.low >= candles[i].low);
    if (isHigh) {
      const kind = lastHigh === null ? 'HH' : candles[i].high > lastHigh ? 'HH' : 'LH';
      pts.push({ kind, price: candles[i].high, time: candles[i].openTime });
      lastHigh = candles[i].high;
    }
    if (isLow) {
      const kind = lastLow === null ? 'HL' : candles[i].low > lastLow ? 'HL' : 'LL';
      pts.push({ kind, price: candles[i].low, time: candles[i].openTime });
      lastLow = candles[i].low;
    }
  }
  return pts.sort((a, b) => a.time - b.time);
}

export interface StructureResult {
  trend: 'UP' | 'DOWN' | 'RANGE';
  bos: 'BULL' | 'BEAR' | null; // Break of Structure
  choch: 'BULL' | 'BEAR' | null; // Change of Character
}

/**
 * Market structure (spec §27): swing points are noisy, so the trend call is
 * made on a smoothed backbone (EMA9 vs EMA21) confirmed by higher highs /
 * higher lows (or lower) in the recent swing sequence.
 */
export function marketStructure(candles: Candle[]): StructureResult {
  const sw = swings(candles);
  const cl = closes(candles);
  const e9 = ema(cl, 9).at(-1);
  const e21 = ema(cl, 21).at(-1);
  if (e9 == null || e21 == null) return { trend: 'RANGE', bos: null, choch: null };
  const spreadPct = ((e9 - e21) / Math.abs(e21 || 1)) * 100;

  const recentHighs = sw.filter((s) => s.kind === 'HH' || s.kind === 'LH').slice(-3);
  const recentLows = sw.filter((s) => s.kind === 'HL' || s.kind === 'LL').slice(-3);
  const hh =
    recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price > recentHighs[0].price;
  const hl = recentLows.length >= 2 && recentLows[recentLows.length - 1].price > recentLows[0].price;
  const lh =
    recentHighs.length >= 2 && recentHighs[recentHighs.length - 1].price < recentHighs[0].price;
  const ll = recentLows.length >= 2 && recentLows[recentLows.length - 1].price < recentLows[0].price;

  const trend: StructureResult['trend'] =
    spreadPct > 0.15 && (hh || hl) ? 'UP' : spreadPct < -0.15 && (lh || ll) ? 'DOWN' : 'RANGE';

  const last = candles[candles.length - 1];
  const prevHigh = recentHighs.length ? recentHighs[recentHighs.length - 1].price : null;
  const prevLow = recentLows.length ? recentLows[recentLows.length - 1].price : null;
  const bos =
    prevHigh !== null && last.close > prevHigh && trend === 'UP'
      ? 'BULL'
      : prevLow !== null && last.close < prevLow && trend === 'DOWN'
        ? 'BEAR'
        : null;
  const choch =
    trend === 'DOWN' && prevHigh !== null && last.close > prevHigh
      ? 'BULL'
      : trend === 'UP' && prevLow !== null && last.close < prevLow
        ? 'BEAR'
        : null;
  return { trend, bos, choch };
}

export type PatternName =
  | 'DOJI' | 'HAMMER' | 'SHOOTING_STAR' | 'BULL_ENGULF' | 'BEAR_ENGULF'
  | 'INSIDE_BAR' | 'PIN_BAR' | 'MOMENTUM_CANDLE' | 'REJECTION' | 'BREAKOUT_CANDLE';

export function bodyRatio(c: Candle): number {
  const range = c.high - c.low;
  return range === 0 ? 0 : Math.abs(c.close - c.open) / range;
}

export function patterns(candles: Candle[]): { index: number; name: PatternName }[] {
  const out: { index: number; name: PatternName }[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const range = c.high - c.low || 1e-9;
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.close, c.open);
    const lowerWick = Math.min(c.close, c.open) - c.low;
    if (body / range < 0.1) out.push({ index: i, name: 'DOJI' });
    if (lowerWick > 2 * body && upperWick < body) out.push({ index: i, name: 'HAMMER' });
    if (upperWick > 2 * body && lowerWick < body) out.push({ index: i, name: 'SHOOTING_STAR' });
    if (c.close > c.open && p.close < p.open && c.close >= p.open && c.open <= p.close)
      out.push({ index: i, name: 'BULL_ENGULF' });
    if (c.close < c.open && p.close > p.open && c.close <= p.open && c.open >= p.close)
      out.push({ index: i, name: 'BEAR_ENGULF' });
    if (c.high <= p.high && c.low >= p.low) out.push({ index: i, name: 'INSIDE_BAR' });
    if (Math.max(upperWick, lowerWick) > 2.5 * body) out.push({ index: i, name: 'PIN_BAR' });
    if (body / range > 0.75) out.push({ index: i, name: 'MOMENTUM_CANDLE' });
    if (Math.max(upperWick, lowerWick) / range > 0.6) out.push({ index: i, name: 'REJECTION' });
    const priorHigh = Math.max(...candles.slice(Math.max(0, i - 20), i).map((x) => x.high));
    if (c.close > priorHigh) out.push({ index: i, name: 'BREAKOUT_CANDLE' });
  }
  return out;
}

/** Support/resistance detection (spec §29). */
export function levels(candles: Candle[], timeframe: Candle['timeframe'], toleranceAtrMult = 0.3): Level[] {
  const sw = swings(candles);
  const atrSeries = atr(candles);
  const atrNow = atrSeries[atrSeries.length - 1] ?? 0;
  const tol = atrNow * toleranceAtrMult;
  const groups: { prices: number[]; type: 'SUPPORT' | 'RESISTANCE' }[] = [];
  for (const s of sw) {
    const type = s.kind === 'HH' || s.kind === 'LH' ? 'RESISTANCE' : 'SUPPORT';
    const g = groups.find((x) => x.type === type && Math.abs(x.prices[x.prices.length - 1] - s.price) <= tol);
    if (g) g.prices.push(s.price);
    else groups.push({ prices: [s.price], type });
  }
  const now = candles[candles.length - 1]?.openTime ?? 0;
  return groups
    .filter((g) => g.prices.length >= 2)
    .map((g) => {
      const price = g.prices.reduce((a, b) => a + b, 0) / g.prices.length;
      return {
        price,
        touches: g.prices.length,
        strength: Math.min(1, g.prices.length / 6),
        ageBars: Math.round((now - Math.min(...g.prices)) / (atrNow || 1)) % 1000,
        timeframe,
        type: g.type,
      };
    })
    .sort((a, b) => b.strength - a.strength);
}

/** Market regime detection (spec §30). */
export function regime(candles: Candle[]): MarketRegime {
  if (candles.length < 30) return 'UNCERTAIN';
  const cl = closes(candles);
  const sd = stddev(cl, 20);
  const sdNow = sd[sd.length - 1] ?? 0;
  const sdPrev = sd.slice(0, 20).reduce((a: number, b) => a + (b ?? 0), 0) / Math.max(1, sd.slice(0, 20).filter(Boolean).length);
  const ma20 = sma(cl, 20);
  const m = ma20[ma20.length - 1] ?? 0;
  const slope = ((m - (ma20[ma20.length - 11] ?? m)) / (Math.abs(ma20[ma20.length - 11] || 1))) * 100;
  const r = rsi(cl);
  const rv = r[r.length - 1] ?? 50;
  const recentRange = Math.max(...cl.slice(-10)) - Math.min(...cl.slice(-10));
  if (sdPrev > 0 && sdNow / sdPrev > 2) return 'HIGH_VOLATILITY';
  if (recentRange < (atr(candles)[candles.length - 1] ?? Infinity) * 2) return 'CONSOLIDATING';
  if (Math.abs(slope) > 1.5 && (rv > 55 || rv < 45)) return 'TRENDING';
  if (sdPrev > 0 && sdNow / sdPrev < 0.5) return 'LOW_VOLATILITY';
  const st = marketStructure(candles);
  if (st.bos) return 'BREAKOUT';
  if (st.trend === 'RANGE') return 'RANGING';
  return 'UNCERTAIN';
}
