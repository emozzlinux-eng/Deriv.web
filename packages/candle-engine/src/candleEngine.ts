import { Candle, Tick, Timeframe, TIMEFRAME_SECONDS } from '@di/shared';

/**
 * CANDLE ENGINE (spec §24)
 * Builds candles from ticks for one or more configurable timeframes.
 * Tracks O/H/L/C, timestamp and tick count, and clearly identifies
 * incomplete candles. Architecture allows adding timeframes later.
 */
export class CandleEngine {
  private buckets = new Map<Timeframe, Map<number, Candle>>();

  constructor(private readonly timeframes: Timeframe[]) {
    for (const tf of timeframes) this.buckets.set(tf, new Map());
  }

  push(tick: Tick): Candle[] {
    const emitted: Candle[] = [];
    for (const tf of this.timeframes) {
      const size = TIMEFRAME_SECONDS[tf];
      const bucket = Math.floor(tick.epoch / size) * size;
      const map = this.buckets.get(tf)!;
      let c = map.get(bucket);
      if (!c) {
        // Close (mark complete) any younger-opened previous bucket implicitly:
        c = {
          timeframe: tf,
          openTime: bucket,
          open: tick.quote,
          high: tick.quote,
          low: tick.quote,
          close: tick.quote,
          tickCount: 0,
          incomplete: true,
        };
        map.set(bucket, c);
      }
      c.high = Math.max(c.high, tick.quote);
      c.low = Math.min(c.low, tick.quote);
      c.close = tick.quote;
      c.tickCount += 1;
      c.incomplete = tick.epoch < bucket + size;
      emitted.push({ ...c });
    }
    return emitted;
  }

  /** Latest completed candle for a timeframe, if any. */
  lastClosed(tf: Timeframe, nowEpoch: number): Candle | undefined {
    const closed = this.history(tf, nowEpoch);
    return closed[closed.length - 1];
  }

  /** All completed candles for a timeframe, oldest first. */
  history(tf: Timeframe, nowEpoch: number): Candle[] {
    const map = this.buckets.get(tf);
    if (!map) return [];
    return [...map.values()]
      .filter((c) => c.openTime + TIMEFRAME_SECONDS[tf] <= nowEpoch)
      .sort((a, b) => a.openTime - b.openTime)
      .map((c) => ({ ...c, incomplete: false }));
  }
}
