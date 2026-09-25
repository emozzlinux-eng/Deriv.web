// SUPABASE EDGE FUNCTION: execute-order  (spec §7, §15, §38, §46, §50, §51, §65)
// This is the ONLY place that may talk to Deriv with user credentials.
// Pipeline: Auth → Validation → Risk Engine → Duplicate check → Deriv → Audit log.
// JWT verification stays ON — deploying with --no-verify-jwt is FORBIDDEN (§9).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REAL_TRADING = Deno.env.get('REAL_TRADING') === 'true'; // default false (§46/§92)

serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // 1. AUTHENTICATION — never trust frontend authorization (§95 #3)
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (!user || authErr) return json({ status: 'BLOCKED', reason: 'Authentication failure' }, 401, cors); // fail-safe §65

  const body = await req.json().catch(() => null);
  // 2. VALIDATION
  const { request_id, mode, symbol, direction, stake } = body ?? {};
  const validationFail =
    !request_id || typeof request_id !== 'string' ||
    !['DEMO', 'REAL'].includes(mode) ||
    !['BUY', 'SELL'].includes(direction) ||
    typeof stake !== 'number' || stake <= 0 || stake > 1e6 ||
    typeof symbol !== 'string' || !/^[A-Z0-9_]{1,20}$/.test(symbol);
  if (validationFail) return json({ status: 'BLOCKED', reason: 'Validation failed' }, 400, cors);

  await audit(supabase, user.id, 'ORDER_REQUEST', { request_id, mode, symbol, stake });

  // REAL-mode gate: env flag + recent auth and/or MFA (§46)
  if (mode === 'REAL') {
    if (!REAL_TRADING) {
      await audit(supabase, user.id, 'ORDER_BLOCKED', { request_id, reason: 'REAL_TRADING disabled globally' });
      return json({ status: 'BLOCKED', reason: 'Real trading not enabled' }, 403, cors);
    }
    const factors: any[] = (user as any).app_metadata?.factors ?? [];
    const hasMfa = factors.some((f) => f.status === 'verified');
    const lastSignIn = (user as any).last_sign_in_at ? new Date((user as any).last_sign_in_at).getTime() : 0;
    const recentlyAuthenticated = Date.now() - lastSignIn < 15 * 60 * 1000;
    if (!(hasMfa || recentlyAuthenticated)) {
      await audit(supabase, user.id, 'ORDER_BLOCKED', { request_id, reason: 'Recent authentication or MFA required' });
      return json({ status: 'BLOCKED', reason: 'Recent authentication or MFA required for REAL mode' }, 403, cors);
    }
  }

  // 3. RISK ENGINE (server-side; frontend cannot override — §38)
  const { data: profile } = await supabase.from('risk_profiles').select('*').eq('user_id', user.id).eq('name', 'ACTIVE').single();
  if (!profile) {
    await audit(supabase, user.id, 'ORDER_BLOCKED', { request_id, reason: 'Risk engine unavailable' });
    return json({ status: 'BLOCKED', reason: 'TRADE BLOCKED: Risk engine unavailable' }, 409, cors); // fail-safe §65
  }
  if (stake > Number(profile.max_stake)) {
    await audit(supabase, user.id, 'ORDER_BLOCKED_BY_RISK', { request_id, reason: 'max_stake' });
    return json({ status: 'BLOCKED', reason: 'TRADE BLOCKED: exceeds maximum stake' }, 403, cors);
  }
  const { count: openCount } = await supabase.from('positions').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  if ((openCount ?? 0) >= profile.max_open_positions) {
    await audit(supabase, user.id, 'ORDER_BLOCKED_BY_RISK', { request_id, reason: 'max_open_positions' });
    return json({ status: 'BLOCKED', reason: 'TRADE BLOCKED: maximum open positions' }, 403, cors);
  }

  // 4. DUPLICATE TRADE PROTECTION (§50) — unique request_id in DB is the lock
  const { data: existing } = await supabase.from('trades').select('status').eq('request_id', request_id).maybeSingle();
  if (existing) {
    await audit(supabase, user.id, 'ORDER_DUPLICATE_REJECTED', { request_id });
    return json({ status: 'BLOCKED', reason: 'Duplicate request already processed' }, 409, cors);
  }
  const { error: insertErr } = await supabase.from('trades').insert({ user_id: user.id, request_id, symbol, direction, stake, mode, status: 'PENDING' });
  if (insertErr) {
    await audit(supabase, user.id, 'ORDER_BLOCKED', { request_id, reason: 'Database unavailable or duplicate' });
    return json({ status: 'BLOCKED', reason: 'TRADE BLOCKED: database' }, 503, cors); // fail-safe §65
  }

  // 5. EXECUTION against Deriv using server-held tokens only (§15)
  const app_id = Deno.env.get('DERIV_APP_ID');
  const token = Deno.env.get(mode === 'REAL' ? 'DERIV_REAL_TOKEN' : 'DERIV_DEMO_TOKEN');
  if (!app_id || !token) {
    await supabase.from('trades').update({ status: 'BLOCKED' }).eq('request_id', request_id);
    await audit(supabase, user.id, 'ORDER_BLOCKED', { request_id, reason: 'Deriv disconnected' });
    return json({ status: 'BLOCKED', reason: 'TRADE BLOCKED: Deriv credentials unavailable' }, 503, cors);
  }
  try {
    const res = await derivCall(app_id, token, {
      buy: 1, price: 0,
      parameters: {
        amount: stake, basis: 'stake',
        contract_type: direction === 'BUY' ? 'CALL' : 'PUT',
        currency: 'USD', duration: 5, duration_unit: 'm', symbol,
      },
    });
    await supabase.from('trades').update({ status: 'OPEN', deriv_contract_id: String(res.buy.contract_id) }).eq('request_id', request_id);
    await audit(supabase, user.id, 'ORDER_FILLED', { request_id, contract_id: res.buy.contract_id });
    return json({ status: 'FILLED', contract_id: res.buy.contract_id }, 200, cors);
  } catch (err) {
    // Unknown execution result → mark UNKNOWN, never blind-retry (§65)
    await supabase.from('trades').update({ status: 'UNKNOWN' }).eq('request_id', request_id);
    await audit(supabase, user.id, 'ORDER_ERROR', { request_id, error: String(err) });
    return json({ status: 'ERROR', reason: 'Execution result unknown — manual reconciliation required' }, 502, cors);
  }
});

async function derivCall(appId: string, token: string, payload: Record<string, unknown>): Promise<any> {
  const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
  try {
    await open(ws);
    const auth = await rpc(ws, { authorize: token });
    if (auth.error) throw new Error(auth.error.message);
    const res = await rpc(ws, payload);
    if (res.error) throw new Error(res.error.message);
    return res;
  } finally { ws.close(); }
}

function open(ws: WebSocket): Promise<void> {
  return new Promise((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error('ws error'));
    setTimeout(() => rej(new Error('ws timeout')), 8000);
  });
}

let seq = 0;
function rpc(ws: WebSocket, msg: Record<string, unknown>): Promise<any> {
  const id = ++seq;
  return new Promise((res, rej) => {
    const handler = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data);
      if (data.req_id === id) { ws.removeEventListener('message', handler); res(data); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ ...msg, req_id: id }));
    setTimeout(() => rej(new Error('deriv rpc timeout')), 10000);
  });
}

async function audit(sb: any, userId: string, event: string, detail: Record<string, unknown>) {
  // Always log sensitive actions (§95 #12). Never include tokens/passwords.
  await sb.from('audit_logs').insert({ user_id: userId, event, detail });
}

function json(obj: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
