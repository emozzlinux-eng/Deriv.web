import { Candle, Evidence, Signal, Timeframe } from '@di/shared';
import { closes, ema, rsi, macd } from '@di/indicator-engine';
import { marketStructure, patterns, levels, regime } from '@di/analysis-engine';

/**
 * SIGNAL ENGINE (spec §31–§33)
 * Explainable, evidence-based setup-strength scoring.
 * IMPORTANT: strength is TECHNICAL SETUP STRENGTH, not win probability (§31).
 */

export interface MtfRow {
  timeframe: Timeframe;
  trend: 'UP' | 'DOWN' | 'FLAT';
  momentum: 'Strong' | 'Medium' | 'Weak';
  volatility: 'High' | 'Medium' | 'Low';
  setup: '+' | '++' | '0' | '-';
}

/** MULTI-TIMEFRAME MATRIX (spec §25). */
export function mtfMatrix(series: Partial<Record<Timeframe, Candle[]>>): MtfRow[] {
  const rows: MtfRow[] = [];
  for (const [tf, candles] of Object.entries(series) as [Timeframe, Candle[]][]) {
    if (!candles || candles.length < 30) continue;
    const cl = closes(candles);
    const e9 = ema(cl, 9);
    const e21 = ema(cl, 21);
    const a = Array.from({ length: candles.length }, (_, i) => {
      const x = candles[i];
      return { high: x.high, low: x.low, close: x.close, open: x.open, openTime: x.openTime, tickCount: x.tickCount, timeframe: tf, incomplete: false };
    });
    void a;
    const st = marketStructure(candles);
    const r = rsi(cl)[cl.length - 1] ?? 50;
    const m = macd(cl).histogram.at(-1) ?? 0;
    const momentum: MtfRow['momentum'] =
      Math.abs(r - 50) > 20 && Math.abs(m) > 0 ? 'Strong' : Math.abs(r - 50) > 10 ? 'Medium' : 'Weak';
    const rng = Math.max(...cl.slice(-20)) - Math.min(...cl.slice(-20));
    const med = cl.slice(-20).reduce((x, y) => x + y, 0) / 20;
    const vol: MtfRow['volatility'] = rng / med > 0.02 ? 'High' : rng / med > 0.008 ? 'Medium' : 'Low';
    const trend: MtfRow['trend'] =
      (e9.at(-1) ?? 0) > (e21.at(-1) ?? 0) * 1.0005 ? 'UP' : (e9.at(-1) ?? 0) < (e21.at(-1) ?? 0) * 0.9995 ? 'DOWN' : 'FLAT';
    const score =
      (trend === 'UP' ? 1 : trend === 'DOWN' ? -1 : 0) + (st.trend === 'UP' ? 1 : st.trend === 'DOWN' ? -1 : 0);
    rows.push({
      timeframe: tf,
      trend,
      momentum,
      volatility: vol,
      setup: score >= 2 ? '++' : score === 1 ? '+' : score === -1 ? '-' : '0',
    });
  }
  return rows.sort((x, y) => order(x.timeframe) - order(y.timeframe));
}

const order = (tf: Timeframe) => ({ '1m': 1, '5m': 2, '15m': 3, '30m': 4, '1h': 5, '4h': 6, '1D': 7 })[tf];

export interface AnalyzeInput {
  market: string;
  timeframe: Timeframe;
  candles: Candle[];
  mtf?: MtfRow[];
  dataQuality?: Signal['dataQuality'];
}

/** Produce an explainable signal (or WAIT/NO_TRADE) for one timeframe series. */
export function analyzeSignal(input: AnalyzeInput): Signal {
  const { market, timeframe, candles } = input;
  const base: Omit<Signal, 'direction' | 'state' | 'strength' | 'evidence' | 'setup' | 'invalidation'> = {
    id: `${market}:${timeframe}:${candles.at(-1)?.openTime ?? Date.now()}`,
    market,
    timeframe,
    riskLevel: 'MEDIUM',
    timestamp: Date.now(),
    dataQuality: input.dataQuality ?? 'FRESH',
  };
  if (!candles || candles.length < 30) {
    return { ...base, direction: 'BUY', state: 'NO_TRADE', setup: 'Insufficient data', strength: 0, evidence: [], invalidation: 'n/a' };
  }
  const cl = closes(candles);
  const e9 = ema(cl, 9).at(-1) ?? 0;
  const e21 = ema(cl, 21).at(-1) ?? 0;
  const e50 = ema(cl, 50).at(-1) ?? e21;
  const r = rsi(cl).at(-1) ?? 50;
  const hist = macd(cl).histogram.at(-1) ?? 0;
  const st = marketStructure(candles);
  const pats = patterns(candles.slice(-5)).map((p) => p.name);
  const lv = levels(candles, timeframe);
  const reg = regime(candles);

  const bullEvidence: Evidence[] = [];
  const bearEvidence: Evidence[] = [];
  const add = (arr: Evidence[], factor: string, weight: number, detail: string) =>
    arr.push({ factor, direction: arr === bullEvidence ? 'BUY' : 'SELL', weight, detail });

  if (e9 > e21 && e21 > e50) add(bullEvidence, 'EMA alignment', 15, `EMA9 ${e9.toFixed(2)} > EMA21 > EMA50`);
  if (e9 < e21 && e21 < e50) add(bearEvidence, 'EMA alignment', 15, `EMA9 ${e9.toFixed(2)} < EMA21 < EMA50`);
  if (st.trend === 'UP') add(bullEvidence, 'Market structure', 20, 'Higher highs & higher lows');
  if (st.trend === 'DOWN') add(bearEvidence, 'Market structure', 20, 'Lower highs & lower lows');
  if (st.bos === 'BULL') add(bullEvidence, 'Break of structure', 10, 'Swing high reclaimed');
  if (st.bos === 'BEAR') add(bearEvidence, 'Break of structure', 10, 'Swing low lost');
  if (r > 55 && hist > 0) add(bullEvidence, 'Momentum confirmation', 15, `RSI ${r.toFixed(0)}, MACD hist positive`);
  if (r < 45 && hist < 0) add(bearEvidence, 'Momentum confirmation', 15, `RSI ${r.toFixed(0)}, MACD hist negative`);
  if (pats.includes('HAMMER') || pats.includes('BULL_ENGULF')) add(bullEvidence, 'Price action', 10, pats.join(', '));
  if (pats.includes('SHOOTING_STAR') || pats.includes('BEAR_ENGULF')) add(bearEvidence, 'Price action', 10, pats.join(', '));
  const last = cl[cl.length - 1];
  const sup = lv.find((l) => l.type === 'SUPPORT' && last > l.price && last - l.price < (last - Math.min(...cl.slice(-20))) * 0.5);
  const res = lv.find((l) => l.type === 'RESISTANCE' && last < l.price && l.price - last < (Math.max(...cl.slice(-20)) - last) * 0.5);
  if (sup) add(bullEvidence, 'Support holding', 10, `Level ${sup.price.toFixed(2)} (${sup.touches} touches)`);
  if (res) add(bearEvidence, 'Resistance capping', 10, `Level ${res.price.toFixed(2)} (${res.touches} touches)`);
  const upRows = (input.mtf ?? []).filter((x) => x.setup.startsWith('+')).length;
  const dnRows = (input.mtf ?? []).filter((x) => x.setup === '-').length;
  if (upRows >= 2) add(bullEvidence, 'Multi-timeframe alignment', 15, `${upRows} timeframes bullish`);
  if (dnRows >= 2) add(bearEvidence, 'Multi-timeframe alignment', 15, `${dnRows} timeframes bearish`);
  if (reg === 'HIGH_VOLATILITY') add(bullEvidence.length >= bearEvidence.length ? bullEvidence : bearEvidence, 'Regime caution', -10, 'HIGH_VOLATILITY regime reduces confidence');

  const bull = bullEvidence.reduce((a, e) => a + e.weight, 0);
  const bear = bearEvidence.reduce((a, e) => a + e.weight, 0);
  const direction = bull >= bear ? 'BUY' : 'SELL';
  const strength = Math.min(100, Math.max(bull, bear));
  const evidence = direction === 'BUY' ? bullEvidence : bearEvidence;
  let state: Signal['state'] = 'WAIT';
  if (strength >= 60) state = direction === 'BUY' ? 'BUY_SETUP' : 'SELL_SETUP';
  if (strength < 25) state = 'NO_TRADE';
  const invalidation =
    direction === 'BUY'
      ? 'Previous swing low breaks.'
      : 'Previous swing high breaks.';
  return {
    ...base,
    direction,
    state,
    strength,
    evidence,
    setup: st.trend === 'RANGE' ? 'Range reaction' : 'Trend continuation',
    invalidation,
    riskLevel: reg === 'HIGH_VOLATILITY' || reg === 'UNCERTAIN' ? 'HIGH' : reg === 'TRENDING' ? 'LOW' : 'MEDIUM',
  };
}

/** Render the §33 explainable-analysis text block. */
export function explain(s: Signal): string {
  const lines = [
    s.market,
    '',
    `SETUP: ${s.setup}`,
    `STATE: ${s.state}`,
    '',
    'Evidence:',
    ...(s.evidence.length
      ? s.evidence.map((e) => `\u2713 ${e.factor} \u2014 ${e.detail} (+${e.weight})`)
      : ['\u2014 none \u2014']),
    '',
    `Invalidation: ${s.invalidation}`,
    '',
    `Strength: ${s.strength}/100 (technical setup strength, NOT win probability)`,
    `Data quality: ${s.dataQuality}`,
  ];
  return lines.join('\n');
}
