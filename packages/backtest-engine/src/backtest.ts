import { Candle, Timeframe } from '@di/shared';
import { closes, ema, rsi } from '@di/indicator-engine';

/**
 * BACKTEST ENGINE (spec §41)
 * Inputs: historical data, strategy, market, timeframe, risk settings, initial balance.
 * Outputs: P/L, win rate, drawdown, profit factor, avg win/loss, streaks, equity curve.
 * Honesty rules: never fake profitability (§95 #9); do not optimize only for win rate (§41).
 */

export interface BacktestStrategy {
  name: string;
  /** Return +1 to open BUY, -1 to open SELL, 0 to stay flat at bar i. */
  signalAt: (candles: Candle[], i: number) => -1 | 0 | 1;
  exitAfterBars?: number; // default 5
}

export interface BacktestSettings {
  initialBalance: number;
  stake: number;
  maxDailyLoss: number;
  feeRate?: number; // fraction of stake, e.g. 0.001
}

export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
}

export interface BacktestResult {
  strategy: string;
  trades: BacktestTrade[];
  equityCurve: number[];
  stats: {
    netPL: number;
    winRate: number; // % — reported but NOT the sole objective (§41)
    maxDrawdown: number; // currency
    maxDrawdownPct: number;
    profitFactor: number; // grossWin / grossLoss (Infinity if no losses)
    averageWin: number;
    averageLoss: number;
    winningStreak: number;
    losingStreak: number;
    tradeCount: number;
    finalBalance: number;
  };
}

export function emaCrossStrategy(fast = 9, slow = 21, rsiFilter = true): BacktestStrategy {
  return {
    name: `EMA${fast}/${slow} cross${rsiFilter ? ' + RSI filter' : ''}`,
    exitAfterBars: 5,
    signalAt: (candles, i) => {
      if (i < slow + 1) return 0;
      const cl = closes(candles.slice(0, i + 1));
      const f = ema(cl, fast);
      const s = ema(cl, slow);
      const fv = f.at(-1), sv = s.at(-1), fp = f.at(-2), sp = s.at(-2);
      if (fv == null || sv == null || fp == null || sp == null) return 0;
      const r = rsiFilter ? (rsi(cl).at(-1) ?? 50) : 50;
      if (fp <= sp && fv > sv && r > 50) return 1;
      if (fp >= sp && fv < sv && r < 50) return -1;
      return 0;
    },
  };
}

export function backtest(
  candles: Candle[],
  strategy: BacktestStrategy,
  settings: BacktestSettings,
): BacktestResult {
  const fee = settings.feeRate ?? 0;
  const exitAfter = strategy.exitAfterBars ?? 5;
  let balance = settings.initialBalance;
  let dayStartBalance = balance;
  let dayAnchor = Math.floor((candles[0]?.openTime ?? 0) / 86400);
  const trades: BacktestTrade[] = [];
  const equity: number[] = [balance];
  let open: { dir: 1 | -1; entryIdx: number; entryPrice: number } | null = null;

  for (let i = 20; i < candles.length; i++) {
    const day = Math.floor(candles[i].openTime / 86400);
    if (day !== dayAnchor) { dayAnchor = day; dayStartBalance = balance; }

    if (open && (i - open.entryIdx >= exitAfter)) {
      const exitPrice = candles[i].close;
      const move = (exitPrice - open.entryPrice) / open.entryPrice;
      const pnl = settings.stake * move * open.dir - settings.stake * fee;
      balance += pnl;
      trades.push({
        entryIndex: open.entryIdx, exitIndex: i,
        direction: open.dir === 1 ? 'BUY' : 'SELL',
        entryPrice: open.entryPrice, exitPrice, pnl,
      });
      open = null;
      equity.push(balance);
      continue;
    }

    if (!open) {
      // §38-style hard stop: no new entries once daily loss limit is hit.
      if (dayStartBalance - balance >= settings.maxDailyLoss) { equity.push(balance); continue; }
      const sig = strategy.signalAt(candles, i);
      if (sig !== 0) open = { dir: sig, entryIdx: i, entryPrice: candles[i].close };
    }
    equity.push(balance);
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  let peak = equity[0] ?? settings.initialBalance;
  let maxDd = 0;
  for (const e of equity) { peak = Math.max(peak, e); maxDd = Math.max(maxDd, peak - e); }
  let ws = 0, ls = 0, cw = 0, cl = 0;
  for (const t of trades) {
    if (t.pnl > 0) { cw++; cl = 0; } else { cl++; cw = 0; }
    ws = Math.max(ws, cw); ls = Math.max(ls, cl);
  }
  return {
    strategy: strategy.name,
    trades,
    equityCurve: equity,
    stats: {
      netPL: balance - settings.initialBalance,
      winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
      maxDrawdown: maxDd,
      maxDrawdownPct: peak ? (maxDd / peak) * 100 : 0,
      profitFactor: grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss,
      averageWin: wins.length ? grossWin / wins.length : 0,
      averageLoss: losses.length ? grossLoss / losses.length : 0,
      winningStreak: ws,
      losingStreak: ls,
      tradeCount: trades.length,
      finalBalance: balance,
    },
  };
}

export function renderReport(r: BacktestResult): string {
  const s = r.stats;
  return [
    `BACKTEST: ${r.strategy}`,
    `Trades: ${s.tradeCount} | Net P/L: ${s.netPL.toFixed(2)} | Final balance: ${s.finalBalance.toFixed(2)}`,
    `Win rate: ${s.winRate.toFixed(1)}% (note: not the optimization target)`,
    `Profit factor: ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}`,
    `Max drawdown: ${s.maxDrawdown.toFixed(2)} (${s.maxDrawdownPct.toFixed(1)}%)`,
    `Avg win: ${s.averageWin.toFixed(2)} | Avg loss: ${s.averageLoss.toFixed(2)}`,
    `Best streak: ${s.winningStreak} | Worst streak: ${s.losingStreak}`,
  ].join('\n');
}
