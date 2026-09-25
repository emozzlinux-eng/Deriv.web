import { describe, expect, it } from 'vitest';
import { analyzeSignal, explain, mtfMatrix } from '@di/signal-engine';
import { backtest, emaCrossStrategy } from '@di/backtest-engine';
import { evaluateRule, renderRule } from '@di/strategy-engine';
import { marketStructure, swings, levels } from '@di/analysis-engine';
import { Candle, Signal } from '@di/shared';

// Build a deterministic rising-then-pullback series of 120 candles.
const mkSeries = (): Candle[] =>
  Array.from({ length: 120 }, (_, i) => {
    const base = 100 + i * 0.5 + Math.sin(i / 7) * 2;
    return {
      timeframe: '15m' as const, openTime: i * 900,
      open: base - 0.2, high: base + 0.8, low: base - 0.8, close: base,
      tickCount: 50, incomplete: false,
    };
  });

describe('signal engine (§31–§33)', () => {
  it('produces a fully-populated signal contract (§32)', () => {
    const s = analyzeSignal({ market: 'VOL100', timeframe: '15m', candles: mkSeries() });
    for (const key of ['market', 'direction', 'timeframe', 'setup', 'strength', 'riskLevel', 'evidence', 'invalidation', 'timestamp', 'dataQuality', 'state'] as (keyof Signal)[]) {
      expect(s[key]).toBeDefined();
    }
    expect(s.strength).toBeGreaterThanOrEqual(0);
    expect(s.strength).toBeLessThanOrEqual(100);
    expect(['BUY_SETUP', 'SELL_SETUP', 'WAIT', 'NO_TRADE']).toContain(s.state);
  });

  it('rising series yields bullish evidence and BUY direction', () => {
    const s = analyzeSignal({ market: 'VOL100', timeframe: '15m', candles: mkSeries() });
    expect(s.direction).toBe('BUY');
    expect(s.evidence.some((e) => e.factor === 'EMA alignment')).toBe(true);
  });

  it('insufficient data returns NO_TRADE (§64)', () => {
    const s = analyzeSignal({ market: 'X', timeframe: '5m', candles: mkSeries().slice(0, 5) });
    expect(s.state).toBe('NO_TRADE');
  });

  it('explain() renders WHY text including invalidation and strength disclaimer (§33)', () => {
    const s = analyzeSignal({ market: 'VOL100', timeframe: '15m', candles: mkSeries() });
    const text = explain(s);
    expect(text).toContain('Invalidation');
    expect(text).toContain('NOT win probability');
  });

  it('MTF matrix has one row per usable timeframe (§25)', () => {
    const rows = mtfMatrix({ '5m': mkSeries(), '15m': mkSeries(), '1h': mkSeries().slice(0, 40) });
    expect(rows.length).toBe(3);
    expect(rows.map((r) => r.timeframe)).toEqual(['5m', '15m', '1h']);
  });
});

describe('analysis engine (§27, §29)', () => {
  it('detects higher highs on rising series', () => {
    const sw = swings(mkSeries());
    expect(sw.some((p) => p.kind === 'HH')).toBe(true);
    expect(marketStructure(mkSeries()).trend).toBe('UP');
  });
  it('levels carry price/strength/touches/age/timeframe/type fields (§29)', () => {
    const lv = levels(mkSeries(), '15m');
    if (lv.length) {
      const l = lv[0];
      expect(l).toHaveProperty('price'); expect(l).toHaveProperty('strength');
      expect(l).toHaveProperty('touches'); expect(l).toHaveProperty('ageBars');
      expect(l.type === 'SUPPORT' || l.type === 'RESISTANCE').toBe(true);
    }
  });
});

describe('backtest engine (§41)', () => {
  it('runs on synthetic-but-deterministic candles and reports all metrics', () => {
    const r = backtest(mkSeries(), emaCrossStrategy(), { initialBalance: 1000, stake: 10, maxDailyLoss: 100 });
    expect(r.stats.tradeCount).toBeGreaterThanOrEqual(0);
    for (const k of ['netPL', 'winRate', 'maxDrawdown', 'profitFactor', 'averageWin', 'averageLoss', 'winningStreak', 'losingStreak', 'finalBalance']) {
      expect(k in r.stats).toBe(true);
    }
    expect(r.equityCurve.length).toBeGreaterThan(0);
  });
});

describe('strategy engine (§43)', () => {
  it('evaluates IF/AND/OR/NOT trees', () => {
    const series = mkSeries();
    const rule = { op: 'AND' as const, args: [
      { op: 'IF' as const, condition: { kind: 'CANDLE' as const, pattern: 'BULLISH' as const } },
      { op: 'NOT' as const, arg: { op: 'IF' as const, condition: { kind: 'PRICE_BELOW' as const, value: 50 } } },
      { op: 'OR' as const, args: [
        { op: 'IF' as const, condition: { kind: 'STRUCTURE' as const, trend: 'UP' as const } },
        { op: 'IF' as const, condition: { kind: 'PRICE_ABOVE' as const, value: 1e9 } },
      ] },
    ] };
    expect(evaluateRule(rule, series, series.length - 1)).toBe(true);
    expect(renderRule(rule)).toContain('IF bullish candle');
  });
});
