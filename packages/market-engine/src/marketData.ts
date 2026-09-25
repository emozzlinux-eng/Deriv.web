import { Tick } from '@di/shared';

/**
 * MARKET DATA pipeline front-end (spec §23):
 *   Tick → Normalizer → Candle Engine → Indicator → Analysis → Signal
 * One shared connection feeds all consumers — never one WS per indicator.
 */

export interface RawQuote { symbol: string; epoch: number | string; quote: number | string }

/** Normalizes heterogeneous feed payloads into strict Tick objects. */
export function normalizeTick(raw: RawQuote): Tick | null {
  const epoch = Number(raw.epoch);
  const quote = Number(raw.quote);
  if (!raw.symbol || !Number.isFinite(epoch) || !Number.isFinite(quote)) return null;
  return { symbol: raw.symbol, epoch, quote };
}

/** Staleness detector feeding the fail-safe rule (§65 stale market data). */
export class FreshnessMonitor {
  private lastSeen = new Map<string, number>();
  constructor(private readonly maxAgeSeconds = 90) {}
  touch(tick: Tick) { this.lastSeen.set(tick.symbol, tick.epoch); }
  isFresh(symbol: string, nowEpoch: number): boolean {
    const seen = this.lastSeen.get(symbol);
    return seen !== undefined && nowEpoch - seen <= this.maxAgeSeconds;
  }
}
