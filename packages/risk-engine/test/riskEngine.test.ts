import { describe, expect, it } from 'vitest';
import { RiskEngine, RISK_PRESETS, HEALTHY, RequestIdStore } from '@di/risk-engine';

const sig = (strength = 80) => ({ strength, dataQuality: 'FRESH' as const });

describe('risk engine (§38, §49, §50, §65)', () => {
  it('approves a strong signal within limits', () => {
    const r = new RiskEngine('CONSERVATIVE', RISK_PRESETS.CONSERVATIVE);
    const d = r.evaluate(sig(80), 5);
    expect(d.allowed).toBe(true);
  });

  it('blocks trades below the setup-strength threshold — signals cannot bypass risk (§95 #6)', () => {
    const r = new RiskEngine('CONSERVATIVE', RISK_PRESETS.CONSERVATIVE);
    const d = r.evaluate(sig(30), 5);
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/^TRADE BLOCKED/);
  });

  it('blocks when stake exceeds maximum', () => {
    const r = new RiskEngine('CONSERVATIVE', RISK_PRESETS.CONSERVATIVE);
    expect(r.evaluate(sig(), 999).allowed).toBe(false);
  });

  it('fail-safe: any unavailable critical system blocks trading (§65)', () => {
    const r = new RiskEngine('BALANCED', RISK_PRESETS.BALANCED);
    for (const key of Object.keys(HEALTHY) as (keyof typeof HEALTHY)[]) {
      const unhealthy = { ...HEALTHY, [key]: false };
      const d = r.evaluate(sig(), 10, unhealthy);
      expect(d.allowed).toBe(false);
      expect(d.blockedBy).toBe('FAIL_SAFE');
    }
  });

  it('stale market data blocks trading even if health flags pass', () => {
    const r = new RiskEngine('BALANCED', RISK_PRESETS.BALANCED);
    const d = r.evaluate({ strength: 90, dataQuality: 'STALE' }, 10);
    expect(d.allowed).toBe(false);
  });

  it('daily loss limit blocks further trades', () => {
    const r = new RiskEngine('CONSERVATIVE', RISK_PRESETS.CONSERVATIVE);
    r.updateState({ dailyLoss: RISK_PRESETS.CONSERVATIVE.maxDailyLoss });
    expect(r.evaluate(sig(), 5).allowed).toBe(false);
  });

  it('emergency stop blocks everything until reset (§49)', () => {
    const r = new RiskEngine('BALANCED', RISK_PRESETS.BALANCED);
    r.emergencyStop();
    expect(r.evaluate(sig(), 10).allowed).toBe(false);
    r.resetEmergencyStop();
    expect(r.evaluate(sig(), 10).allowed).toBe(true);
  });

  it('cooldown blocks an immediate second trade (§38)', () => {
    const r = new RiskEngine('CONSERVATIVE', RISK_PRESETS.CONSERVATIVE);
    r.recordTradeOpened(5);
    const d = r.evaluate(sig(), 5);
    expect(d.allowed).toBe(false);
    expect(d.blockedBy).toBe('COOLDOWN');
  });

  it('duplicate request ids are rejected once (§50)', () => {
    const store = new RequestIdStore();
    expect(store.tryClaim('abc')).toBe(true);
    expect(store.tryClaim('abc')).toBe(false);
    expect(store.tryClaim('')).toBe(false);
  });
});
