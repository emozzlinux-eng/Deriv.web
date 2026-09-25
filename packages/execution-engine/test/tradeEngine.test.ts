import { describe, expect, it } from 'vitest';
import { TradeEngine, PaperExecutionAdapter, AuditLog } from '@di/execution-engine';

const okGate = () => ({ allowed: true, reason: 'APPROVED' });
const denyGate = () => ({ allowed: false, reason: 'TRADE BLOCKED: test' });

describe('execution engine (§40, §45, §46, §50)', () => {
  it('paper order fills at approximately last price', async () => {
    const engine = new TradeEngine({ PAPER: new PaperExecutionAdapter(() => 100) }, okGate);
    const res = await engine.submit({ requestId: 'r1', mode: 'PAPER', symbol: 'VOL100', direction: 'BUY', stake: 10 });
    expect(res.status).toBe('FILLED');
    expect(res.fillPrice!).toBeCloseTo(100, 0);
  });

  it('duplicate request_id is executed only once (§50)', async () => {
    const engine = new TradeEngine({ PAPER: new PaperExecutionAdapter(() => 100) }, okGate);
    const order = { requestId: 'dup', mode: 'PAPER' as const, symbol: 'X', direction: 'BUY' as const, stake: 1 };
    expect((await engine.submit(order)).status).toBe('FILLED');
    const second = await engine.submit(order);
    expect(second.status).toBe('BLOCKED');
    expect(second.reason).toMatch(/Duplicate/);
  });

  it('missing request_id is blocked', async () => {
    const engine = new TradeEngine({ PAPER: new PaperExecutionAdapter(() => 100) }, okGate);
    const res = await engine.submit({ requestId: '', mode: 'PAPER', symbol: 'X', direction: 'BUY', stake: 1 });
    expect(res.status).toBe('BLOCKED');
  });

  it('risk gate veto cannot be bypassed by the caller (§38)', async () => {
    const engine = new TradeEngine({ PAPER: new PaperExecutionAdapter(() => 100) }, denyGate);
    const res = await engine.submit({ requestId: 'r9', mode: 'PAPER', symbol: 'X', direction: 'BUY', stake: 1 });
    expect(res.status).toBe('BLOCKED');
    expect(res.reason).toMatch(/TRADE BLOCKED/);
  });

  it('REAL mode is refused by default in paper-only wiring (§46/§92)', async () => {
    const engine = new TradeEngine({ PAPER: new PaperExecutionAdapter(() => 100) }, okGate);
    const res = await engine.submit({ requestId: 'r10', mode: 'REAL', symbol: 'X', direction: 'BUY', stake: 1 });
    expect(res.status).toBe('BLOCKED');
  });

  it('every decision lands in the audit log (§51)', async () => {
    const audit = new AuditLog();
    const engine = new TradeEngine({ PAPER: new PaperExecutionAdapter(() => 100) }, okGate, audit);
    await engine.submit({ requestId: 'a1', mode: 'PAPER', symbol: 'X', direction: 'SELL', stake: 2 });
    const events = audit.all().map((e) => e.event);
    expect(events).toContain('ORDER_REQUEST');
    expect(events).toContain('ORDER_RESULT');
  });
});
