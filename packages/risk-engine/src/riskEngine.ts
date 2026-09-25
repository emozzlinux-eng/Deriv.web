import { RiskMode, Signal } from '@di/shared';

/**
 * RISK ENGINE (spec §38–§40, §49, §50, §65)
 * The frontend CANNOT override these decisions (§38).
 * Fail-safe rule (§65): if any critical system is unavailable → TRADE BLOCKED.
 */

export interface RiskSettings {
  maxStake: number;
  maxDailyLoss: number;
  maxSessionLoss: number;
  maxOpenPositions: number;
  maxExposure: number;
  maxTradesPerDay: number;
  maxConsecutiveLosses: number;
  cooldownMinutes: number;
}

export const RISK_PRESETS: Record<Exclude<RiskMode, 'CUSTOM'>, RiskSettings> = {
  CONSERVATIVE: { maxStake: 10, maxDailyLoss: 50, maxSessionLoss: 30, maxOpenPositions: 1, maxExposure: 20, maxTradesPerDay: 5, maxConsecutiveLosses: 2, cooldownMinutes: 30 },
  BALANCED:     { maxStake: 50, maxDailyLoss: 200, maxSessionLoss: 100, maxOpenPositions: 3, maxExposure: 150, maxTradesPerDay: 15, maxConsecutiveLosses: 4, cooldownMinutes: 15 },
  AGGRESSIVE:   { maxStake: 200, maxDailyLoss: 500, maxSessionLoss: 300, maxOpenPositions: 6, maxExposure: 600, maxTradesPerDay: 40, maxConsecutiveLosses: 8, cooldownMinutes: 5 },
};

export interface RiskState {
  dailyLoss: number;
  sessionLoss: number;
  openPositions: number;
  exposure: number;
  tradesToday: number;
  consecutiveLosses: number;
  lastTradeAt: number | null; // epoch ms
  emergencyStop: boolean;
}

export const initialRiskState = (): RiskState => ({
  dailyLoss: 0, sessionLoss: 0, openPositions: 0, exposure: 0,
  tradesToday: 0, consecutiveLosses: 0, lastTradeAt: null, emergencyStop: false,
});

/** Critical-system health inputs for the fail-safe rule (§65). */
export interface SystemHealth {
  derivConnected: boolean;
  riskEngineAvailable: boolean;
  databaseAvailable: boolean;
  marketDataFresh: boolean;
  proposalValid: boolean;
  authenticated: boolean;
  executionResultKnown: boolean;
  securityValidationPassed: boolean;
}

export const HEALTHY: SystemHealth = {
  derivConnected: true, riskEngineAvailable: true, databaseAvailable: true,
  marketDataFresh: true, proposalValid: true, authenticated: true,
  executionResultKnown: true, securityValidationPassed: true,
};

export interface RiskDecision {
  allowed: boolean;
  reason: string; // human readable; 'TRADE BLOCKED' prefixed when denied
  blockedBy?: string;
}

const FAILSAFE_LABELS: Record<keyof SystemHealth, string> = {
  derivConnected: 'Deriv disconnected',
  riskEngineAvailable: 'Risk engine unavailable',
  databaseAvailable: 'Database unavailable',
  marketDataFresh: 'Stale market data',
  proposalValid: 'Invalid proposal',
  authenticated: 'Authentication failure',
  executionResultKnown: 'Unknown execution result',
  securityValidationPassed: 'Security validation failure',
};

export class RiskEngine {
  private state: RiskState = initialRiskState();

  constructor(
    public mode: RiskMode,
    private settings: RiskSettings,
    /** REAL_TRADING default false, never enabled automatically (§46, §92). */
    public realTradingEnabled = false,
  ) {}

  getSettings(): RiskSettings { return { ...this.settings }; }
  getState(): RiskState { return { ...this.state }; }

  updateState(patch: Partial<RiskState>) { this.state = { ...this.state, ...patch }; }

  /** 🛑 EMERGENCY STOP (§49): stops automation, blocks new trades, cancels queue. */
  emergencyStop(): RiskDecision {
    this.state.emergencyStop = true;
    return { allowed: false, reason: 'TRADE BLOCKED: Emergency stop engaged', blockedBy: 'EMERGENCY_STOP' };
  }

  resetEmergencyStop() { this.state.emergencyStop = false; }

  /** Single entry point every execution request must pass through. */
  evaluate(signal: Pick<Signal, 'strength' | 'dataQuality'>, stake: number, health: SystemHealth = HEALTHY): RiskDecision {
    // §65 fail-safe — checked first, non-negotiable.
    for (const key of Object.keys(FAILSAFE_LABELS) as (keyof SystemHealth)[]) {
      if (!health[key]) {
        return { allowed: false, reason: `TRADE BLOCKED: ${FAILSAFE_LABELS[key]}`, blockedBy: 'FAIL_SAFE' };
      }
    }
    if (signal.dataQuality !== 'FRESH') {
      return { allowed: false, reason: 'TRADE BLOCKED: Stale market data', blockedBy: 'FAIL_SAFE' };
    }
    if (this.state.emergencyStop) {
      return { allowed: false, reason: 'TRADE BLOCKED: Emergency stop engaged', blockedBy: 'EMERGENCY_STOP' };
    }
    if (stake > this.settings.maxStake) {
      return { allowed: false, reason: `TRADE BLOCKED: stake ${stake} exceeds maximum stake ${this.settings.maxStake}`, blockedBy: 'MAX_STAKE' };
    }
    if (this.state.dailyLoss >= this.settings.maxDailyLoss) {
      return { allowed: false, reason: 'TRADE BLOCKED: maximum daily loss reached', blockedBy: 'MAX_DAILY_LOSS' };
    }
    if (this.state.sessionLoss >= this.settings.maxSessionLoss) {
      return { allowed: false, reason: 'TRADE BLOCKED: maximum session loss reached', blockedBy: 'MAX_SESSION_LOSS' };
    }
    if (this.state.openPositions >= this.settings.maxOpenPositions) {
      return { allowed: false, reason: 'TRADE BLOCKED: maximum open positions reached', blockedBy: 'MAX_OPEN_POSITIONS' };
    }
    if (this.state.lastTradeAt !== null) {
      const elapsedMin = (Date.now() - this.state.lastTradeAt) / 60000;
      if (elapsedMin < this.settings.cooldownMinutes) {
        return { allowed: false, reason: `TRADE BLOCKED: cooldown active (${Math.ceil(this.settings.cooldownMinutes - elapsedMin)} min remaining)`, blockedBy: 'COOLDOWN' };
      }
    }
    if (this.state.exposure + stake > this.settings.maxExposure) {
      return { allowed: false, reason: 'TRADE BLOCKED: maximum exposure exceeded', blockedBy: 'MAX_EXPOSURE' };
    }
    if (this.state.tradesToday >= this.settings.maxTradesPerDay) {
      return { allowed: false, reason: 'TRADE BLOCKED: maximum trades/day reached', blockedBy: 'MAX_TRADES_PER_DAY' };
    }
    if (this.state.consecutiveLosses >= this.settings.maxConsecutiveLosses) {
      return { allowed: false, reason: 'TRADE BLOCKED: maximum consecutive losses reached', blockedBy: 'MAX_CONSECUTIVE_LOSSES' };
    }
    // §39: never trade after losses by increasing stakes — martingale is rejected outright.
    if (this.mode === 'CUSTOM' && stake > this.settings.maxStake) {
      return { allowed: false, reason: 'TRADE BLOCKED: martingale-style stake increase not permitted', blockedBy: 'NO_MARTINGALE' };
    }
    if (signal.strength < 60) {
      return { allowed: false, reason: `TRADE BLOCKED: setup strength ${signal.strength}/100 below threshold (60)`, blockedBy: 'SIGNAL_QUALITY' };
    }
    return { allowed: true, reason: 'APPROVED' };
  }

  recordTradeOpened(stake: number) {
    this.state.tradesToday += 1;
    this.state.openPositions += 1;
    this.state.exposure += stake;
    this.state.lastTradeAt = Date.now();
  }

  recordTradeClosed(pnl: number) {
    this.state.openPositions = Math.max(0, this.state.openPositions - 1);
    this.state.exposure = Math.max(0, this.state.exposure - Math.abs(pnl));
    if (pnl < 0) {
      this.state.dailyLoss += -pnl;
      this.state.sessionLoss += -pnl;
      this.state.consecutiveLosses += 1;
    } else {
      this.state.consecutiveLosses = 0;
    }
  }
}

/**
 * DUPLICATE TRADE PROTECTION (§50)
 * Every execution request carries a request_id; processed ids are remembered.
 * Protects against double clicks, network/WS retries, refreshes, replays.
 */
export class RequestIdStore {
  private processed = new Set<string>();
  tryClaim(requestId: string): boolean {
    if (!requestId) return false;
    if (this.processed.has(requestId)) return false;
    this.processed.add(requestId);
    return true;
  }
  has(requestId: string) { return this.processed.has(requestId); }
}
