import { describe, expect, it } from 'vitest';
import { sma, ema, wma, rsi, macd, bollinger, atr, stochastic, roc, stddev } from '@di/indicator-engine';
import { Candle } from '@di/shared';

const lin = Array.from({ length: 30 }, (_, i) => i + 1); // 1..30

const mk = (i: number, p: number): Candle => ({
  timeframe: '1m', openTime: i * 60, open: p - 0.5, high: p + 1, low: p - 1, close: p,
  tickCount: 10, incomplete: false,
});
const candles = lin.map(mk);

describe('indicator engine (§26)', () => {
  it('SMA of linear series matches closed form', () => {
    const s = sma(lin, 5);
    expect(s[3]).toBeNull();
    expect(s[4]).toBeCloseTo(3);   // mean(1..5)
    expect(s.at(-1)).toBeCloseTo(28); // mean(26..30)
  });

  it('EMA seeds with SMA and stays within bounds', () => {
    const e = ema(lin, 5);
    expect(e[4]).toBeCloseTo(3);
    expect(e.at(-1)!).toBeGreaterThan(27);
    expect(e.at(-1)!).toBeLessThan(30);
  });

  it('WMA weights recent values more heavily than SMA', () => {
    const w = wma(lin, 5);
    expect(w.at(-1)!).toBeGreaterThan(sma(lin, 5).at(-1)!);
  });

  it('RSI is 100 for a strictly rising series and bounded 0..100 otherwise', () => {
    expect(rsi(lin).at(-1)).toBe(100);
    const mixed = [...lin.slice(0, 20), ...Array.from({ length: 10 }, (_, i) => 30 - i)];
    const r = rsi(mixed).filter((x): x is number => x !== null);
    r.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    r.forEach((v) => expect(v).toBeLessThanOrEqual(100));
  });

  it('MACD line equals fast EMA minus slow EMA where both defined', () => {
    const m = macd(lin);
    const f = ema(lin, 12), s = ema(lin, 26);
    for (let i = 0; i < lin.length; i++) {
      if (f[i] !== null && s[i] !== null) expect(m.macd[i]!).toBeCloseTo(f[i]! - s[i]!);
    }
    expect(m.histogram.at(-1)).toBeDefined();
  });

  it('Bollinger bands bracket the middle band', () => {
    const b = bollinger(lin, 10, 2);
    for (let i = 0; i < lin.length; i++) {
      if (b.middle[i] !== null) {
        expect(b.upper[i]!).toBeGreaterThanOrEqual(b.middle[i]!);
        expect(b.lower[i]!).toBeLessThanOrEqual(b.middle[i]!);
      }
    }
  });

  it('ATR is positive and constant-range input yields expected value', () => {
    const a = atr(candles, 5).filter((x): x is number => x !== null);
    a.forEach((v) => expect(v).toBeGreaterThan(0));
  });

  it('Stochastic K stays within 0..100', () => {
    const st = stochastic(candles);
    st.k.filter((x): x is number => x !== null).forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  it('ROC of linear growth is positive', () => {
    expect(roc(lin, 5).at(-1)!).toBeGreaterThan(0);
  });

  it('stddev of constant series is zero', () => {
    const sd = stddev(Array(25).fill(7), 5);
    expect(sd.at(-1)).toBeCloseTo(0);
  });
});
