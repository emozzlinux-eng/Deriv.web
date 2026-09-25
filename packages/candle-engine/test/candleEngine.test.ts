import { describe, expect, it } from 'vitest';
import { CandleEngine } from '@di/candle-engine';
import { Tick } from '@di/shared';

const t = (epoch: number, quote: number): Tick => ({ symbol: 'VOL100', epoch, quote });

describe('candle engine (§24)', () => {
  it('aggregates ticks into OHLC buckets with tick counts', () => {
    const e = new CandleEngine(['1m']);
    e.push(t(0, 10));
    e.push(t(30, 12));
    e.push(t(59, 9));
    const closed = e.history('1m', 60);
    expect(closed).toHaveLength(1);
    const c = closed[0];
    expect(c.open).toBe(10);
    expect(c.high).toBe(12);
    expect(c.low).toBe(9);
    expect(c.close).toBe(9);
    expect(c.tickCount).toBe(3);
    expect(c.incomplete).toBe(false);
  });

  it('marks the current bucket incomplete and previous complete', () => {
    const e = new CandleEngine(['5m']);
    e.push(t(100, 5)); // bucket 0..300
    const now = 150;
    const hist = e.history('5m', now);
    expect(hist).toHaveLength(0); // still incomplete at t=150
    e.push(t(301, 6)); // new bucket
    const closed = e.history('5m', 301);
    expect(closed).toHaveLength(1);
    expect(closed[0].openTime).toBe(0);
  });

  it('supports multiple timeframes from one feed', () => {
    const e = new CandleEngine(['1m', '15m']);
    for (let i = 0; i < 100; i++) e.push(t(i * 60, 10 + (i % 5)));
    expect(e.history('1m', 100 * 60).length).toBeGreaterThan(90);
    expect(e.history('15m', 100 * 60).length).toBeGreaterThan(5);
  });
});
