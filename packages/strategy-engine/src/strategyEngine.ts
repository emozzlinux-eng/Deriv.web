import { Candle, RiskMode, Timeframe, ExecutionMode } from '@di/shared';
import { closes, ema, rsi, atr } from '@di/indicator-engine';
import { marketStructure } from '@di/analysis-engine';

/**
 * STRATEGY ENGINE (spec §42–§43)
 * Visual logic builder compiled to an executable predicate tree:
 *   IF / AND / OR / NOT over conditions on
 *   RSI, EMA, MACD, ATR, ADX, Price, Structure, Support, Resistance, Candle, Trend, Volatility
 * Strategy Lab modes: BACKTEST / PAPER / DEMO / REAL — REAL requires explicit activation.
 */

export type Condition =
  | { kind: 'RSI_CROSSES_ABOVE'; level: number }
  | { kind: 'RSI_CROSSES_BELOW'; level: number }
  | { kind: 'EMA_CROSS'; fast: number; slow: number; direction: 'UP' | 'DOWN' }
  | { kind: 'ATR_ABOVE'; value: number }
  | { kind: 'PRICE_ABOVE'; value: number }
  | { kind: 'PRICE_BELOW'; value: number }
  | { kind: 'STRUCTURE'; trend: 'UP' | 'DOWN' | 'RANGE' }
  | { kind: 'SUPPORT_NEAR'; tolerancePct: number }
  | { kind: 'RESISTANCE_NEAR'; tolerancePct: number }
  | { kind: 'CANDLE'; pattern: 'BULLISH' | 'BEARISH' }
  | { kind: 'VOLATILITY'; level: 'HIGH' | 'LOW' };

export type Rule =
  | { op: 'IF'; condition: Condition }
  | { op: 'AND'; args: Rule[] }
  | { op: 'OR'; args: Rule[] }
  | { op: 'NOT'; arg: Rule };

export interface StrategyDefinition {
  id: string;
  name: string;
  market: string;
  timeframe: Timeframe;
  riskMode: RiskMode;
  mode: ExecutionMode;
  entry: Rule;
  exit: Rule;
  createdAt: number;
}

export function evaluateRule(rule: Rule, candles: Candle[], i: number): boolean {
  const cl = closes(candles.slice(0, i + 1));
  const c = candles[i];
  switch (rule.op) {
    case 'AND': return rule.args.every((r) => evaluateRule(r, candles, i));
    case 'OR': return rule.args.some((r) => evaluateRule(r, candles, i));
    case 'NOT': return !evaluateRule(rule.arg, candles, i);
    case 'IF': return evaluateCondition(rule.condition, cl, candles, i);
  }
}

function evaluateCondition(cond: Condition, cl: number[], candles: Candle[], i: number): boolean {
  const last = cl.at(-1) ?? 0;
  switch (cond.kind) {
    case 'RSI_CROSSES_ABOVE': { const r = rsi(cl); const prev = r.at(-2) ?? 50; const now = r.at(-1) ?? 50; return prev <= cond.level && now > cond.level; }
    case 'RSI_CROSSES_BELOW': { const r = rsi(cl); const prev = r.at(-2) ?? 50; const now = r.at(-1) ?? 50; return prev >= cond.level && now < cond.level; }
    case 'EMA_CROSS': {
      const f = ema(cl, cond.fast); const s = ema(cl, cond.slow);
      const [fv, sv, fp, sp] = [f.at(-1), s.at(-1), f.at(-2), s.at(-2)];
      if (fv == null || sv == null || fp == null || sp == null) return false;
      return cond.direction === 'UP' ? fp <= sp && fv > sv : fp >= sp && fv < sv;
    }
    case 'ATR_ABOVE': { const a = atr(candles.slice(0, i + 1)).at(-1) ?? 0; return a > cond.value; }
    case 'PRICE_ABOVE': return last > cond.value;
    case 'PRICE_BELOW': return last < cond.value;
    case 'STRUCTURE': return marketStructure(candles.slice(0, i + 1)).trend === cond.trend;
    case 'SUPPORT_NEAR': { const lo = Math.min(...cl.slice(-20)); return Math.abs(last - lo) / last <= cond.tolerancePct / 100; }
    case 'RESISTANCE_NEAR': { const hi = Math.max(...cl.slice(-20)); return Math.abs(hi - last) / last <= cond.tolerancePct / 100; }
    case 'CANDLE': { const cc = candles[i]; return cond.pattern === 'BULLISH' ? cc.close > cc.open : cc.close < cc.open; }
    case 'VOLATILITY': {
      const w = cl.slice(-20);
      const rng = (Math.max(...w) - Math.min(...w)) / (Math.abs(last) || 1);
      return cond.level === 'HIGH' ? rng > 0.02 : rng < 0.005;
    }
  }
}

/** Pretty-print a rule tree the way the visual builder renders it (§43). */
export function renderRule(rule: Rule, indent = 0): string {
  const pad = '  '.repeat(indent);
  switch (rule.op) {
    case 'IF': return `${pad}IF ${describe(rule.condition)}`;
    case 'NOT': return `${pad}NOT\n${renderRule(rule.arg, indent + 1)}`;
    default:
      return [`${pad}${rule.op}`, ...rule.args.map((a) => renderRule(a, indent + 1))].join('\n');
  }
}

function describe(c: Condition): string {
  switch (c.kind) {
    case 'RSI_CROSSES_ABOVE': return `RSI crosses above ${c.level}`;
    case 'RSI_CROSSES_BELOW': return `RSI crosses below ${c.level}`;
    case 'EMA_CROSS': return `EMA${c.fast} crosses ${c.direction === 'UP' ? 'above' : 'below'} EMA${c.slow}`;
    case 'ATR_ABOVE': return `ATR > ${c.value}`;
    case 'PRICE_ABOVE': return `Price > ${c.value}`;
    case 'PRICE_BELOW': return `Price < ${c.value}`;
    case 'STRUCTURE': return `Structure is ${c.trend}`;
    case 'SUPPORT_NEAR': return `Price near support (±${c.tolerancePct}%)`;
    case 'RESISTANCE_NEAR': return `Price near resistance (±${c.tolerancePct}%)`;
    case 'CANDLE': return `${c.pattern} candle`;
    case 'VOLATILITY': return `Volatility ${c.level}`;
  }
}
