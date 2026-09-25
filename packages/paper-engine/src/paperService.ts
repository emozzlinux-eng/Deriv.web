import { Candle, Signal } from '@di/shared';
import { RiskEngine, RiskSettings, RISK_PRESETS } from '@di/risk-engine';
import { TradeEngine, PaperExecutionAdapter, AuditLog, OrderRequest } from '@di/execution-engine';
import { CandleEngine } from '@di/candle-engine';
import { DerivClient } from '@di/deriv-client';
import { FreshnessMonitor, normalizeTick } from '@di/market-engine';
import { analyzeSignal, mtfMatrix } from '@di/signal-engine';
import { backtest, BacktestResult } from '@di/backtest-engine';

/**
 * PAPER ENGINE (spec §40, §45) — wires the whole pipeline in PAPER mode:
 *   ANALYSIS → PAPER → BACKTEST → DEMO → REAL
 * Each mode independently controlled; this orchestrator is PAPER-only and
 * refuses to be pointed at REAL unless explicitly unlocked server-side.
 */
export class PaperTradingService {
  readonly candles = new CandleEngine(['1m', '5m', '15m', '1h']);
  readonly freshness = new FreshnessMonitor();
  readonly risk: RiskEngine;
  readonly audit = new AuditLog();
  readonly engine: TradeEngine;
  private lastPrice = new Map<string, number>();
  private journal: { signal: Signal; order: OrderRequest; result: unknown }[] = [];

  constructor(settings: RiskSettings = RISK_PRESETS.CONSERVATIVE) {
    this.risk = new RiskEngine('CONSERVATIVE', settings, false);
    const paper = new PaperExecutionAdapter((s) => this.lastPrice.get(s));
    this.engine = new TradeEngine(
      { PAPER: paper }, // DEMO/REAL adapters intentionally absent in paper service
      (order) => {
        const decision = this.risk.evaluate(
          { strength: this.lastSignalStrength, dataQuality: this.freshness.isFresh(order.symbol, Math.floor(Date.now() / 1000)) ? 'FRESH' : 'STALE' },
          order.stake,
          {
            derivConnected: true,
            riskEngineAvailable: true,
            databaseAvailable: true,
            marketDataFresh: this.freshness.isFresh(order.symbol, Math.floor(Date.now() / 1000)),
            proposalValid: true,
            authenticated: true,
            executionResultKnown: true,
            securityValidationPassed: true,
          },
        );
        return decision;
      },
      this.audit,
    );
  }

  private lastSignalStrength = 0;

  ingestTick(raw: { symbol: string; epoch: number | string; quote: number | string }) {
    const t = normalizeTick(raw as any);
    if (!t) return;
    this.freshness.touch(t);
    this.lastPrice.set(t.symbol, t.quote);
    this.candles.push(t);
  }

  /** Run analysis for a symbol/timeframe and produce an explainable signal. */
  evaluate(symbol: string, timeframe: '1m' | '5m' | '15m' | '1h' = '15m'): Signal {
    const now = Math.floor(Date.now() / 1000);
    const series = this.candles.history(timeframe, now);
    const mtf = mtfMatrix({ '5m': this.candles.history('5m', now), '15m': series, '1h': this.candles.history('1h', now) });
    const fresh = this.freshness.isFresh(symbol, now);
    const sig = analyzeSignal({
      market: symbol,
      timeframe,
      candles: series,
      mtf,
      dataQuality: fresh ? 'FRESH' : 'STALE',
    });
    this.lastSignalStrength = sig.strength;
    return sig;
  }

  async placePaperTrade(signal: Signal, stake: number): Promise<unknown> {
    const order: OrderRequest = {
      requestId: `paper:${signal.id}:${Date.now()}`,
      mode: 'PAPER',
      symbol: signal.market,
      direction: signal.direction,
      stake,
    };
    const result = await this.engine.submit(order);
    if (result.status === 'FILLED') this.risk.recordTradeOpened(stake);
    this.journal.push({ signal, order, result });
    return result;
  }

  get journalEntries() { return [...this.journal]; }

  backtest(symbol: string, timeframe: '1m' | '5m' | '15m' | '1h', strategy: Parameters<typeof backtest>[1], initialBalance = 1000): BacktestResult {
    void symbol;
    const series: Candle[] = this.candles.history(timeframe, Math.floor(Date.now() / 1000));
    return backtest(series, strategy, { initialBalance, stake: this.risk.getSettings().maxStake, maxDailyLoss: this.risk.getSettings().maxDailyLoss });
  }
}

export function attachDerivFeed(client: DerivClient, service: PaperTradingService, symbols: string[]) {
  return symbols.map((s) => client.subscribeTicks(s, (t) => service.ingestTick(t)));
}
