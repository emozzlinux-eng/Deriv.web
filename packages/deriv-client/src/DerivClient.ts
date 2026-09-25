/**
 * DERIV CLIENT (spec §21–§23)
 * Dedicated, centralized client. Random application components must NOT call
 * raw Deriv WebSocket commands (§21). The browser never talks to Deriv with
 * user credentials — authentication happens server-side (§7, §15).
 *
 * Implements the app_id-based public market-data protocol:
 *   wss://ws.derivws.com/websockets/v3?app_id=<id>
 * Requests carry unique req_id and responses are correlated by it (§22).
 */

export type ConnectionState =
  | 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'AUTHENTICATING'
  | 'AUTHENTICATED' | 'RECONNECTING' | 'ERROR';

export interface DerivTick { symbol: string; epoch: number; quote: number }

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export interface WsLike {
  send(data: string): void;
  close(): void;
  onopen?: (() => void) | null;
  onclose?: (() => void) | null;
  onerror?: ((e: unknown) => void) | null;
  onmessage?: ((ev: { data: string }) => void) | null;
  readyState: number;
}

export class DerivClient {
  private ws: WsLike | null = null;
  private reqId = 0;
  private pending = new Map<number, Pending>();
  private tickSubscribers = new Map<string, Set<(t: DerivTick) => void>>();
  private state: ConnectionState = 'DISCONNECTED';
  private listeners = new Set<(s: ConnectionState) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;

  constructor(
    private readonly appId: string,
    private readonly url = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`,
    /** Injectable for tests; defaults to globalThis.WebSocket. */
    private readonly wsFactory: (url: string) => WsLike = (u) => new (globalThis as any).WebSocket(u),
  ) {}

  get connectionState(): ConnectionState { return this.state; }
  onState(cb: (s: ConnectionState) => void) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  private setState(s: ConnectionState) { this.state = s; this.listeners.forEach((l) => l(s)); }

  connect(): Promise<void> {
    if (this.ws && (this.state === 'CONNECTED' || this.state === 'AUTHENTICATED')) return Promise.resolve();
    this.setState('CONNECTING');
    return new Promise((resolve, reject) => {
      let settled = false;
      try { this.ws = this.wsFactory(this.url); } catch (e) { this.setState('ERROR'); reject(e as Error); return; }
      const ws = this.ws!;
      ws.onopen = () => {
        settled = true;
        this.reconnectAttempts = 0;
        this.setState('CONNECTED');
        this.startHeartbeat();
        resolve();
      };
      ws.onmessage = (ev) => this.handleMessage(ev.data);
      ws.onerror = () => { this.setState('ERROR'); if (!settled) { settled = true; reject(new Error('Deriv WS error')); } };
      ws.onclose = () => { this.stopHeartbeat(); this.scheduleReconnect(); };
    });
  }

  disconnect() {
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.setState('DISCONNECTED');
  }

  private scheduleReconnect() {
    // §22 reconnection with exponential backoff, capped at 30s.
    const delay = Math.min(30000, 500 * 2 ** this.reconnectAttempts++);
    this.setState('RECONNECTING');
    setTimeout(() => { this.connect().catch(() => {}); }, delay);
  }

  private startHeartbeat() {
    this.heartbeat = setInterval(() => { this.sendRaw({ ping: 1 }).catch(() => {}); }, 20000);
  }
  private stopHeartbeat() { if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = null; }

  private handleMessage(raw: string) {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.msg_type === 'ping') return;
    const id = msg.req_id;
    if (typeof id === 'number') {
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg);
      }
    }
    if (msg.msg_type === 'tick' && msg.tick) {
      const subs = this.tickSubscribers.get(msg.tick.symbol);
      const t: DerivTick = { symbol: msg.tick.symbol, epoch: msg.tick.epoch, quote: Number(msg.tick.quote) };
      subs?.forEach((cb) => cb(t));
    }
  }

  private sendRaw(req: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || (this.state !== 'CONNECTED' && this.state !== 'AUTHENTICATED')) {
        reject(new Error('Not connected'));
        return;
      }
      const id = ++this.reqId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ ...req, req_id: id }));
    });
  }

  // ---- Public API surface from spec §21 -------------------------------------
  async authenticate(token: string) {
    // NOTE: token handling belongs server-side in production (§15). Kept here
    // only for a local terminal connecting with a DEMO token.
    this.setState('AUTHENTICATING');
    const res = await this.sendRaw({ authorize: token });
    this.setState('AUTHENTICATED');
    return res.authorize;
  }
  getAccount() { return this.sendRaw({ get_settings: 1 }); }
  getBalance() { return this.sendRaw({ balance: 1 }); }
  async getActiveSymbols() { const r = await this.sendRaw({ active_symbols: 'brief' }); return r.active_symbols; }
  getContracts() { return this.sendRaw({ contracts_for: 'R_100' }); }
  async getTickHistory(symbol: string, count = 500, granularity?: number) {
    const r = await this.sendRaw(
      granularity
        ? { ticks_history: symbol, end: 'latest', count, style: 'candles', granularity, adjust_start_time: 1 }
        : { ticks_history: symbol, end: 'latest', count, style: 'ticks' },
    );
    return r;
  }
  subscribeTicks(symbol: string, cb: (t: DerivTick) => void) {
    // §22 duplicate subscription prevention
    let set = this.tickSubscribers.get(symbol);
    const isNew = !set || set.size === 0;
    if (!set) { set = new Set(); this.tickSubscribers.set(symbol, set); }
    set.add(cb);
    if (isNew) this.sendRaw({ ticks: symbol, subscribe: 1 }).catch(() => {});
    return () => this.unsubscribeTicks(symbol, cb);
  }
  unsubscribeTicks(symbol: string, cb?: (t: DerivTick) => void) {
    const set = this.tickSubscribers.get(symbol);
    if (!set) return;
    if (cb) set.delete(cb);
    if (!cb || set.size === 0) { set.clear(); this.sendRaw({ forget: symbol }).catch(() => {}); }
  }
  getProposal(input: Record<string, unknown>) { return this.sendRaw({ proposal: 1, ...input }); }
  buy(input: Record<string, unknown>) { return this.sendRaw({ buy: 1, price: 0, ...input }); }
  sell(contractId: number) { return this.sendRaw({ sell: contractId, price: 0 }); }
  getOpenContract(contractId: number) { return this.sendRaw({ proposal_open_contract: 1, contract_id: contractId }); }
  getPortfolio() { return this.sendRaw({ portfolio: 1 }); }
}
