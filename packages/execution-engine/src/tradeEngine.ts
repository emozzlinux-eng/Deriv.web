import { ExecutionMode } from '@di/shared';

/**
 * EXECUTION ENGINE (spec §40, §45, §46, §50, §51, §65)
 * TradeEngine sits above pluggable adapters:
 *   PaperExecutionAdapter / DemoExecutionAdapter / RealExecutionAdapter
 * Ordering is mandatory for every order:
 *   auth → validation → RISK ENGINE → duplicate check → adapter → audit log
 * REAL mode is refused unless explicitly enabled (default false, §46/§92).
 */

export interface OrderRequest {
  requestId: string; // §50 — mandatory idempotency key
  mode: ExecutionMode;
  symbol: string;
  direction: 'BUY' | 'SELL';
  stake: number;
}

export interface ExecutionResult {
  requestId: string;
  status: 'FILLED' | 'BLOCKED' | 'ERROR';
  fillPrice?: number;
  reason?: string;
  timestamp: number;
}

export interface AuditEntry {
  at: number;
  event: string;
  detail: Record<string, unknown>;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  record(event: string, detail: Record<string, unknown> = {}) {
    this.entries.push({ at: Date.now(), event, detail });
  }
  all(): AuditEntry[] { return [...this.entries]; }
}

export interface ExecutionAdapter {
  readonly mode: ExecutionMode;
  execute(order: OrderRequest): Promise<ExecutionResult>;
}

/** Deterministic-ish paper fills at last known price + slippage. Never touches Deriv. */
export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly mode = 'PAPER' as const;
  constructor(private getPrice: (symbol: string) => number | undefined) {}
  async execute(order: OrderRequest): Promise<ExecutionResult> {
    const price = this.getPrice(order.symbol);
    if (price === undefined) {
      return { requestId: order.requestId, status: 'ERROR', reason: 'No market data (fail-safe §65)', timestamp: Date.now() };
    }
    const slippage = price * 0.0001;
    const fill = order.direction === 'BUY' ? price + slippage : price - slippage;
    return { requestId: order.requestId, status: 'FILLED', fillPrice: fill, timestamp: Date.now() };
  }
}

/**
 * DEMO adapter talks to Deriv using a DERIV_APP_ID + demo token held ONLY in the
 * backend (Edge Function). The browser never connects to Deriv directly (§7).
 * This implementation throws until the Supabase Edge Function exists — it does
 * NOT fake execution (§75: do not fake functionality).
 */
export class DemoExecutionAdapter implements ExecutionAdapter {
  readonly mode = 'DEMO' as const;
  async execute(_order: OrderRequest): Promise<ExecutionResult> {
    throw new Error('DemoExecutionAdapter requires the supabase/functions/execute-order edge function (not yet deployed).');
  }
}

/** REAL adapter — refuses everything unless explicitly unlocked server-side. */
export class RealExecutionAdapter implements ExecutionAdapter {
  readonly mode = 'REAL' as const;
  constructor(private readonly unlocked = false) {}
  async execute(order: OrderRequest): Promise<ExecutionResult> {
    if (!this.unlocked) {
      return { requestId: order.requestId, status: 'BLOCKED', reason: 'REAL_TRADING = false (default). Never enabled automatically.', timestamp: Date.now() };
    }
    throw new Error('RealExecutionAdapter requires the supabase/functions/execute-order edge function with recent-auth + MFA checks (§46).');
  }
}

export class RequestAlreadyProcessedError extends Error {}

export class TradeEngine {
  private processed = new Set<string>();

  constructor(
    private adapters: Partial<Record<ExecutionMode, ExecutionAdapter>>,
    /** Callback into the risk engine — returns {allowed, reason}. Frontend cannot override. */
    private riskGate: (order: OrderRequest) => { allowed: boolean; reason: string },
    private audit: AuditLog = new AuditLog(),
  ) {}

  async submit(order: OrderRequest): Promise<ExecutionResult> {
    this.audit.record('ORDER_REQUEST', { requestId: order.requestId, mode: order.mode, symbol: order.symbol, stake: order.stake });

    if (!order.requestId) {
      this.audit.record('ORDER_BLOCKED', { reason: 'Missing request_id' });
      return { requestId: '', status: 'BLOCKED', reason: 'Missing request_id (§50)', timestamp: Date.now() };
    }
    // §50 duplicate trade protection
    if (this.processed.has(order.requestId)) {
      this.audit.record('ORDER_DUPLICATE_REJECTED', { requestId: order.requestId });
      return { requestId: order.requestId, status: 'BLOCKED', reason: 'Duplicate request — already processed', timestamp: Date.now() };
    }

    // §38 risk engine gate
    const decision = this.riskGate(order);
    if (!decision.allowed) {
      this.audit.record('ORDER_BLOCKED_BY_RISK', { requestId: order.requestId, reason: decision.reason });
      return { requestId: order.requestId, status: 'BLOCKED', reason: decision.reason, timestamp: Date.now() };
    }

    const adapter = this.adapters[order.mode];
    if (!adapter) {
      this.audit.record('ORDER_BLOCKED', { requestId: order.requestId, reason: `No adapter for mode ${order.mode}` });
      return { requestId: order.requestId, status: 'BLOCKED', reason: 'Execution mode unavailable (fail-safe §65)', timestamp: Date.now() };
    }

    this.processed.add(order.requestId);
    try {
      const result = await adapter.execute(order);
      this.audit.record('ORDER_RESULT', { requestId: order.requestId, status: result.status, fillPrice: result.fillPrice ?? null });
      return result;
    } catch (err) {
      // Unknown execution result → fail-safe; do not blindly retry.
      this.audit.record('ORDER_ERROR', { requestId: order.requestId, error: String(err) });
      return { requestId: order.requestId, status: 'ERROR', reason: String(err), timestamp: Date.now() };
    }
  }
}
