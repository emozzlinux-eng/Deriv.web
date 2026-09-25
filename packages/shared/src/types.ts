/**
 * Shared domain types for DERIV INTELLIGENCE.
 * Core architectural separation (spec §7):
 *   MARKET DATA -> ANALYSIS -> SIGNAL -> RISK -> EXECUTION
 * Each layer communicates only through these types.
 */

export type Direction = 'BUY' | 'SELL';

export type SignalState = 'BUY_SETUP' | 'SELL_SETUP' | 'WAIT' | 'NO_TRADE';

export type MarketRegime =
  | 'TRENDING'
  | 'RANGING'
  | 'BREAKOUT'
  | 'CONSOLIDATING'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'UNCERTAIN';

export type RiskMode = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'CUSTOM';

export type ExecutionMode = 'PAPER' | 'DEMO' | 'REAL';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D';

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1D': 86400,
};

export interface Tick {
  symbol: string;
  epoch: number; // seconds
  quote: number;
}

export interface Candle {
  timeframe: Timeframe;
  openTime: number; // epoch seconds (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
  /** True while the bucket is still collecting ticks (spec §24). */
  incomplete: boolean;
}

export interface SwingPoint {
  kind: 'HH' | 'HL' | 'LH' | 'LL';
  price: number;
  time: number;
}

export interface Level {
  price: number;
  strength: number; // 0..1 normalized touch/reaction score
  touches: number;
  ageBars: number;
  timeframe: Timeframe;
  type: 'SUPPORT' | 'RESISTANCE';
}

export interface Evidence {
  factor: string; // e.g. "EMA alignment"
  direction: Direction | 'NEUTRAL';
  weight: number; // contribution to setup strength (points)
  detail: string;
}

/** Signal output contract (spec §32). Every field mandatory. */
export interface Signal {
  id: string;
  market: string;
  direction: Direction;
  timeframe: Timeframe;
  setup: string;
  strength: number; // 0..100 TECHNICAL SETUP STRENGTH — not win probability (§31)
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  evidence: Evidence[];
  invalidation: string;
  timestamp: number; // epoch ms
  dataQuality: 'FRESH' | 'STALE' | 'DEGRADED';
  state: SignalState;
}

export function strengthLabel(s: number): 'Weak' | 'Moderate' | 'Strong' | 'Very strong' {
  if (s < 40) return 'Weak';
  if (s < 60) return 'Moderate';
  if (s < 75) return 'Strong';
  return 'Very strong';
}
