import { Candle } from '@di/shared';

/**
 * INDICATOR ENGINE (spec §26) — modular indicators.
 * Trend: SMA, EMA, WMA, Supertrend, ADX.
 * Momentum: RSI, MACD, Stochastic, CCI, ROC.
 * Volatility: ATR, Bollinger Bands, standard deviation.
 * All functions are pure and operate on closed-candle series.
 */

const closes = (c: Candle[]) => c.map((x) => x.close);

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function wma(values: number[], period: number): (number | null)[] {
  const denom = (period * (period + 1)) / 2;
  return values.map((_, i) => {
    if (i < period - 1) return null;
    let acc = 0;
    for (let j = 0; j < period; j++) acc += values[i - period + 1 + j] * (j + 1);
    return acc / denom;
  });
}

export function roc(values: number[], period: number): (number | null)[] {
  return values.map((v, i) =>
    i >= period && values[i - period] !== 0 ? ((v - values[i - period]) / values[i - period]) * 100 : null,
  );
}

/** Wilder-smoothed RSI (Wilder 1978). */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    avgGain += Math.max(d, 0) / period;
    avgLoss += Math.max(-d, 0) / period;
  }
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const line = values.map((_, i) =>
    ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null,
  );
  const firstIdx = line.findIndex((v) => v !== null);
  const dense = line.slice(firstIdx) as number[];
  const sigDense = ema(dense, signalPeriod);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  dense.forEach((_, i) => (signal[firstIdx + i] = sigDense[i]));
  const histogram = line.map((v, i) => (v !== null && signal[i] !== null ? v - (signal[i] as number) : null));
  return { macd: line, signal, histogram };
}

export interface StochasticResult {
  k: (number | null)[];
  d: (number | null)[];
}

export function stochastic(c: Candle[], kPeriod = 14, dPeriod = 3): StochasticResult {
  const k: (number | null)[] = c.map((_, i) => {
    if (i < kPeriod - 1) return null;
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, c[j].high);
      ll = Math.min(ll, c[j].low);
    }
    return hh === ll ? 50 : ((c[i].close - ll) / (hh - ll)) * 100;
  });
  const dense = k.filter((v): v is number => v !== null);
  const dDense = sma(dense, dPeriod);
  const d: (number | null)[] = new Array(c.length).fill(null);
  let offset = k.findIndex((v) => v !== null);
  dense.forEach((_, i) => (d[offset + i] = dDense[i]));
  return { k, d };
}

export function cci(c: Candle[], period = 20): (number | null)[] {
  const tp = c.map((x) => (x.high + x.low + x.close) / 3);
  return tp.map((_, i) => {
    if (i < period - 1) return null;
    const slice = tp.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const md = slice.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    return md === 0 ? 0 : (tp[i] - mean) / (0.015 * md);
  });
}

export function trueRanges(c: Candle[]): number[] {
  return c.map((x, i) =>
    i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)),
  );
}

/** Wilder ATR. */
export function atr(c: Candle[], period = 14): (number | null)[] {
  const tr = trueRanges(c);
  const out: (number | null)[] = new Array(c.length).fill(null);
  if (c.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < tr.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export interface BollingerResult {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
}

export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const m = middle[i] as number;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / period);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { middle, upper, lower };
}

export function stddev(values: number[], period: number): (number | null)[] {
  const m = sma(values, period);
  return values.map((_, i) => {
    if (m[i] === null) return null;
    const slice = values.slice(i - period + 1, i + 1);
    const mean = m[i] as number;
    return Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  });
}

export interface AdxResult {
  adx: (number | null)[];
  plusDi: (number | null)[];
  minusDi: (number | null)[];
}

/** Wilder ADX/DMI. */
export function adx(c: Candle[], period = 14): AdxResult {
  const n = c.length;
  const plusDi: (number | null)[] = new Array(n).fill(null);
  const minusDi: (number | null)[] = new Array(n).fill(null);
  const dx: number[] = [];
  let sPlus = 0;
  let sMinus = 0;
  let sTr = 0;
  for (let i = 1; i < n; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    const pdm = up > down && up > 0 ? up : 0;
    const ndm = down > up && down > 0 ? down : 0;
    const tr = trueRanges(c)[i];
    if (i <= period) {
      sPlus += pdm;
      sMinus += ndm;
      sTr += tr;
      if (i === period) {
        // smoothed state initialized
      } else continue;
    } else {
      sPlus = sPlus - sPlus / period + pdm;
      sMinus = sMinus - sMinus / period + ndm;
      sTr = sTr - sTr / period + tr;
    }
    const p = sTr === 0 ? 0 : (100 * sPlus) / sTr;
    const m = sTr === 0 ? 0 : (100 * sMinus) / sTr;
    plusDi[i] = p;
    minusDi[i] = m;
    dx.push(p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m));
  }
  const adxOut: (number | null)[] = new Array(n).fill(null);
  let prevAdx: number | null = null;
  let idx = period + 1;
  for (let j = 0; j < dx.length; j++, idx++) {
    if (j < period) {
      if (j === period - 1) prevAdx = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
      else continue;
    } else {
      prevAdx = ((prevAdx as number) * (period - 1) + dx[j]) / period;
    }
    adxOut[idx] = prevAdx;
  }
  return { adx: adxOut, plusDi, minusDi };
}

export interface SupertrendResult {
  value: (number | null)[];
  direction: ('UP' | 'DOWN' | null)[];
}

export function supertrend(c: Candle[], period = 10, mult = 3): SupertrendResult {
  const atrV = atr(c, period);
  const value: (number | null)[] = new Array(c.length).fill(null);
  const direction: ('UP' | 'DOWN' | null)[] = new Array(c.length).fill(null);
  let ub = NaN;
  let lb = NaN;
  let prevFinalUb = NaN;
  let prevFinalLb = NaN;
  let dir: 'UP' | 'DOWN' = 'UP';
  for (let i = 0; i < c.length; i++) {
    const a = atrV[i];
    if (a === null) continue;
    const hl2 = (c[i].high + c[i].low) / 2;
    ub = hl2 + mult * a;
    lb = hl2 - mult * a;
    const finalUb = Number.isNaN(prevFinalUb) || ub < prevFinalUb || c[i - 1]?.close > prevFinalUb ? ub : prevFinalUb;
    const finalLb = Number.isNaN(prevFinalLb) || lb > prevFinalLb || c[i - 1]?.close < prevFinalLb ? lb : prevFinalLb;
    if (c[i].close > finalUb) dir = 'UP';
    else if (c[i].close < finalLb) dir = 'DOWN';
    value[i] = dir === 'UP' ? finalLb : finalUb;
    direction[i] = dir;
    prevFinalUb = finalUb;
    prevFinalLb = finalLb;
  }
  return { value, direction };
}

export { closes };
